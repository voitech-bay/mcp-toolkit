<script setup lang="ts">
import { ref, computed, watch, h, onMounted, onUnmounted } from "vue";
import {
  NCard,
  NDataTable,
  NTabs,
  NTabPane,
  NButton,
  NSpace,
  NAlert,
  NEmpty,
  NModal,
  NTag,
  NSpin,
  NPagination,
  NSelect,
  NInput,
  NSwitch,
  NDivider,
  useMessage,
} from "naive-ui";
import type { DataTableColumns, DataTableRowKey, SelectOption } from "naive-ui";
import { useIntervalFn } from "@vueuse/core";
import { Table2Icon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";

type EntityTab = "company" | "contact";

type EnrichmentAgentCellStatus = "planned" | "queued" | "running" | "success" | "error";

interface EnrichmentAgentCellState {
  status: EnrichmentAgentCellStatus;
  updatedAt: string | null;
  error?: string | null;
  resultPreview?: unknown;
  workerName?: string | null;
}

interface EnrichmentRunStats {
  totalRuns: number;
  runsSuccess: number;
  runsError: number;
  runsRunning: number;
  queueQueued: number;
  queueRunning: number;
  errorSamples: string[];
}

interface EnrichmentTableRow {
  entity: Record<string, unknown>;
  agentStates: Record<string, EnrichmentAgentCellState>;
  runStats: EnrichmentRunStats;
}

interface EnrichmentAgentInfo {
  name: string;
  entity_type: string;
  operation_name: string | null;
  is_active: boolean;
}

interface EnrichmentAgentRegistryRow {
  name: string;
  entity_type: string;
  operation_name: string | null;
  is_active: boolean;
  created_at: string;
}

const projectStore = useProjectStore();
const message = useMessage();

/** Base columns shown for each entity tab (fixed set). */
const COMPANY_BASE_KEYS: readonly string[] = [
  "name",
  "domain",
  "linkedin_url",
  "tags",
  "contact_count",
  "status",
];

const CONTACT_BASE_KEYS: readonly string[] = [
  "first_name",
  "last_name",
  "company_name",
  "position",
  "work_email",
  "created_at",
];

const activeTab = ref<EntityTab>("company");
const checkedRowKeys = ref<DataTableRowKey[]>([]);

const agents = ref<EnrichmentAgentInfo[]>([]);
const agentsLoading = ref(false);
const agentsError = ref("");

const enqueueAgentName = ref<string | null>(null);
const enqueueOperationName = ref("");
const enqueueLoading = ref(false);

const manageAgentsOpen = ref(false);
const registryRows = ref<EnrichmentAgentRegistryRow[]>([]);
const registryLoading = ref(false);
const registryError = ref("");
const updatingAgentName = ref<string | null>(null);

const newAgentName = ref("");
const newAgentEntityType = ref<"company" | "contact" | "both">("company");
const newAgentOperation = ref("");
const newAgentActive = ref(true);
const creatingAgent = ref(false);

const entityTypeOptions: SelectOption[] = [
  { label: "Company", value: "company" },
  { label: "Contact", value: "contact" },
  { label: "Both", value: "both" },
];

const agentSelectOptions = computed<SelectOption[]>(() =>
  agents.value.map((a) => ({
    label: `${a.name} (${a.entity_type})`,
    value: a.name,
  }))
);

const rows = ref<EnrichmentTableRow[]>([]);
const total = ref(0);
const agentNames = ref<string[]>([]);
const tableLoading = ref(false);
const tableError = ref("");

const page = ref(1);
const pageSize = ref(25);
const PAGE_SIZES = [10, 25, 50, 100];

const POLL_MS = 8000;
const { pause: pausePoll, resume: resumePoll } = useIntervalFn(
  () => {
    void fetchTable(false);
  },
  POLL_MS,
  { immediate: false }
);

const detailOpen = ref(false);
const detailTitle = ref("");
const detailBody = ref("");

function openDetail(title: string, body: string) {
  detailTitle.value = title;
  detailBody.value = body;
  detailOpen.value = true;
}

function formatCellValue(key: string, val: unknown): string {
  if (val == null) return "—";
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) {
    if (key === "tags") return val.map((x) => String(x)).join(", ");
    if (val.length === 0) return "—";
    return JSON.stringify(val);
  }
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function columnTitle(key: string): string {
  const map: Record<string, string> = {
    company_id: "Company ID",
    project_company_id: "Project company link",
    contact_count: "Contacts",
    linkedin_url: "LinkedIn",
    work_email: "Work email",
    personal_email: "Personal email",
    connections_number: "Connections",
    uuid: "Contact ID",
    contacts_preview: "Contacts preview",
    hypotheses: "Hypotheses",
  };
  return map[key] ?? key.replace(/_/g, " ");
}

function rowKey(row: EnrichmentTableRow): string {
  const e = row.entity;
  if (activeTab.value === "company") {
    const id = e.company_id;
    return typeof id === "string" ? id : String(id ?? "");
  }
  const id = e.uuid ?? e.id;
  return typeof id === "string" ? id : String(id ?? "");
}

/** Row is busy if any agent is queued or running (checkbox disabled). */
function rowEnrichmentInProgress(row: EnrichmentTableRow): boolean {
  for (const st of Object.values(row.agentStates)) {
    if (st.status === "queued" || st.status === "running") return true;
  }
  return false;
}

function pruneCheckedRowKeys() {
  const byKey = new Map(rows.value.map((r) => [rowKey(r), r]));
  checkedRowKeys.value = checkedRowKeys.value.filter((k) => {
    const row = byKey.get(String(k));
    if (!row) return false;
    return !rowEnrichmentInProgress(row);
  });
}

async function fetchAgents() {
  if (!projectStore.selectedProjectId) return;
  agentsLoading.value = true;
  agentsError.value = "";
  try {
    const r = await fetch(`/api/enrichment/agents?entityType=${encodeURIComponent(activeTab.value)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to load agents");
    agents.value = (j.data ?? []) as EnrichmentAgentInfo[];
  } catch (e) {
    agents.value = [];
    agentsError.value = e instanceof Error ? e.message : "Failed to load agents";
  } finally {
    agentsLoading.value = false;
  }
}

watch(agents, (list) => {
  if (enqueueAgentName.value && !list.some((a) => a.name === enqueueAgentName.value)) {
    enqueueAgentName.value = null;
  }
});

async function fetchRegistry() {
  registryLoading.value = true;
  registryError.value = "";
  try {
    const r = await fetch("/api/enrichment/agents/registry");
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to load agents registry");
    registryRows.value = (j.data ?? []) as EnrichmentAgentRegistryRow[];
  } catch (e) {
    registryRows.value = [];
    registryError.value = e instanceof Error ? e.message : "Failed to load registry";
  } finally {
    registryLoading.value = false;
  }
}

async function openManageAgents() {
  manageAgentsOpen.value = true;
  await fetchRegistry();
}

async function createRegistryAgent() {
  const name = newAgentName.value.trim();
  if (!name) {
    message.warning("Agent name is required.");
    return;
  }
  creatingAgent.value = true;
  try {
    const r = await fetch("/api/enrichment/agents/registry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        entity_type: newAgentEntityType.value,
        operation_name: newAgentOperation.value.trim() || null,
        is_active: newAgentActive.value,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Create failed");
    message.success("Agent created.");
    newAgentName.value = "";
    newAgentOperation.value = "";
    newAgentEntityType.value = "company";
    newAgentActive.value = true;
    await fetchRegistry();
    await fetchAgents();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Create failed");
  } finally {
    creatingAgent.value = false;
  }
}

async function setRegistryAgentActive(row: EnrichmentAgentRegistryRow, isActive: boolean) {
  if (isActive === row.is_active) return;
  updatingAgentName.value = row.name;
  try {
    const r = await fetch("/api/enrichment/agents/registry", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: row.name, is_active: isActive }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Update failed");
    row.is_active = isActive;
    message.success("Agent updated.");
    await fetchAgents();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Update failed");
    await fetchRegistry();
  } finally {
    updatingAgentName.value = null;
  }
}

async function enqueueSelected() {
  const projectId = projectStore.selectedProjectId;
  const agent = enqueueAgentName.value?.trim();
  if (!projectId || !agent) {
    message.warning("Select an agent.");
    return;
  }
  const ids = checkedRowKeys.value.map((k) => String(k));
  if (ids.length === 0) {
    message.warning("Select one or more rows.");
    return;
  }
  enqueueLoading.value = true;
  try {
    const body: Record<string, unknown> = {
      projectId,
      entityType: activeTab.value,
      agentName: agent,
    };
    if (activeTab.value === "company") body.companyIds = ids;
    else body.contactIds = ids;
    const op = enqueueOperationName.value.trim();
    if (op) body.operationName = op;
    const r = await fetch("/api/enrichment/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Enqueue failed");
    const n = Number(j.inserted ?? 0);
    message.success(`Queued ${n} task(s).`);
    checkedRowKeys.value = [];
    await fetchTable(false);
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Enqueue failed");
  } finally {
    enqueueLoading.value = false;
  }
}

const registryColumns = computed<DataTableColumns<EnrichmentAgentRegistryRow>>(() => [
  { title: "Name", key: "name", width: 180, ellipsis: { tooltip: true } },
  { title: "Entity", key: "entity_type", width: 88 },
  {
    title: "Operation",
    key: "operation_name",
    ellipsis: { tooltip: true },
    render: (row) => row.operation_name ?? "—",
  },
  {
    title: "Active",
    key: "is_active",
    width: 88,
    render: (row) =>
      h(NSwitch, {
        value: row.is_active,
        loading: updatingAgentName.value === row.name,
        disabled: updatingAgentName.value !== null && updatingAgentName.value !== row.name,
        onUpdateValue: (v: boolean) => {
          void setRegistryAgentActive(row, v);
        },
      }),
  },
]);

async function fetchTable(showSpinner = true) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) return;
  if (showSpinner) tableLoading.value = true;
  tableError.value = "";
  try {
    const off = (page.value - 1) * pageSize.value;
    const q = new URLSearchParams({
      entityType: activeTab.value,
      projectId,
      limit: String(pageSize.value),
      offset: String(off),
    });
    const r = await fetch(`/api/enrichment-table?${q}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to load enrichment table");
    total.value = Number(j.total ?? 0);
    agentNames.value = Array.isArray(j.agentNames) ? j.agentNames : [];
    rows.value = (j.rows ?? []) as EnrichmentTableRow[];
    pruneCheckedRowKeys();
    if (j.error && typeof j.error === "string") {
      message.warning(j.error);
    }
  } catch (e) {
    rows.value = [];
    total.value = 0;
    agentNames.value = [];
    tableError.value = e instanceof Error ? e.message : "Failed to load table";
  } finally {
    tableLoading.value = false;
  }
}

function renderAgentCell(agentName: string, state: EnrichmentAgentCellState | undefined) {
  const s = state?.status ?? "planned";
  const onClickSuccess = () => {
    const raw = state?.resultPreview;
    const text =
      raw === undefined
        ? "(no result payload)"
        : typeof raw === "string"
          ? raw
          : JSON.stringify(raw, null, 2);
    openDetail(`Result · ${agentName}`, text);
  };
  const onClickError = () => {
    openDetail(`Error · ${agentName}`, state?.error ?? "(no message)");
  };

  if (s === "planned") {
    return h("span", { style: "opacity:0.45" }, "—");
  }
  if (s === "queued") {
    return h(
      NTag,
      {
        size: "small",
        type: "default",
        bordered: false,
        title: "Waiting for a worker to pick this up",
      },
      { default: () => "Queued" }
    );
  }
  if (s === "running") {
    const w = state?.workerName?.trim();
    return h(
      "div",
      { class: "enrichment-cell enrichment-cell--running" },
      [
        h(NSpin, { size: 14 }),
        h(
          "div",
          { class: "enrichment-cell-running-text" },
          [
            h(NTag, { size: "small", type: "info", bordered: false }, { default: () => "Running" }),
            ...(w ? [h("span", { class: "enrichment-worker-hint", title: `Worker: ${w}` }, w)] : []),
          ]
        ),
      ]
    );
  }
  if (s === "success") {
    return h(
      NButton,
      {
        size: "tiny",
        quaternary: true,
        type: "success",
        onClick: onClickSuccess,
      },
      { default: () => "Worked" }
    );
  }
  if (s === "error") {
    return h(
      NButton,
      {
        size: "tiny",
        quaternary: true,
        type: "error",
        onClick: onClickError,
      },
      { default: () => "Error" }
    );
  }
  return h("span", { style: "opacity:0.45" }, "—");
}

function renderEnrichmentSummary(row: EnrichmentTableRow) {
  const s = row.runStats;
  if (!s) {
    return h("span", { style: "opacity:0.45" }, "—");
  }
  /** Rows still in the queue (no worker yet). */
  const waiting = s.queueQueued;
  /** Claimed by a worker or a run row executing. */
  const executing = s.queueRunning + s.runsRunning;
  const children: ReturnType<typeof h>[] = [
    h("div", { class: "enrichment-sum-line" }, [
      h("strong", {}, String(s.totalRuns)),
      " runs · ",
      h("span", { class: "enrichment-sum-ok" }, `${s.runsSuccess} ok`),
      " · ",
      h("span", { class: "enrichment-sum-err" }, `${s.runsError} err`),
    ]),
  ];
  if (waiting > 0) {
    children.push(
      h(
        NTag,
        {
          size: "small",
          type: "default",
          bordered: false,
          class: "enrichment-sum-waiting",
          title: "Tasks are in the queue; start a worker to process them.",
        },
        { default: () => `Waiting (${waiting})` }
      )
    );
  }
  if (executing > 0) {
    children.push(
      h(
        NTag,
        {
          size: "small",
          type: "info",
          bordered: false,
          class: "enrichment-sum-executing",
          title: "A worker has claimed these tasks or a run is active.",
        },
        { default: () => `Executing (${executing})` }
      )
    );
  }
  if (s.errorSamples.length > 0) {
    children.push(
      h(
        NButton,
        {
          size: "tiny",
          quaternary: true,
          type: "error",
          class: "enrichment-sum-errors-btn",
          onClick: () =>
            openDetail(
              "Enrichment errors",
              s.errorSamples.map((e, i) => `${i + 1}. ${e}`).join("\n\n")
            ),
        },
        { default: () => `Errors (${s.errorSamples.length})` }
      )
    );
  }
  return h("div", { class: "enrichment-summary-col" }, children);
}

const baseColumns = computed<DataTableColumns<EnrichmentTableRow>>(() => {
  const keys = activeTab.value === "company" ? COMPANY_BASE_KEYS : CONTACT_BASE_KEYS;
  const cols: DataTableColumns<EnrichmentTableRow> = [];
  for (const key of keys) {
    cols.push({
      title: columnTitle(key),
      key: `base:${key}`,
      width: key === "name" || key === "company_name" ? 200 : 140,
      ellipsis: { tooltip: true },
      render: (row) => formatCellValue(key, row.entity[key]),
    });
  }
  return cols;
});

const selectionColumn = computed<DataTableColumns<EnrichmentTableRow>>(() => [
  {
    type: "selection",
    disabled: (row) => rowEnrichmentInProgress(row),
  },
]);

const enrichmentSummaryColumn = computed<DataTableColumns<EnrichmentTableRow>>(() => [
  {
    title: "Enrichment",
    key: "enrichment:summary",
    width: 240,
    render: (row) => renderEnrichmentSummary(row),
  },
]);

const agentColumns = computed<DataTableColumns<EnrichmentTableRow>>(() => {
  const names = agentNames.value;
  const opByName = new Map(agents.value.map((a) => [a.name, a.operation_name]));
  return names.map((name) => ({
    title: () =>
      h("span", { title: opByName.get(name) ?? undefined }, [
        h(Table2Icon, { size: 12, style: "margin-right:4px;vertical-align:middle;opacity:0.7" }),
        name,
      ]),
    key: `agent:${name}`,
    width: 130,
    align: "center" as const,
    render: (row: EnrichmentTableRow) => renderAgentCell(name, row.agentStates[name]),
  }));
});

const columns = computed(() => [
  ...selectionColumn.value,
  ...baseColumns.value,
  ...enrichmentSummaryColumn.value,
  ...agentColumns.value,
]);

watch(
  () => activeTab.value,
  () => {
    checkedRowKeys.value = [];
    enqueueAgentName.value = null;
    enqueueOperationName.value = "";
    void fetchAgents();
    page.value = 1;
    void fetchTable();
  }
);

watch(
  () => projectStore.selectedProjectId,
  (id) => {
    checkedRowKeys.value = [];
    if (id) {
      void fetchAgents();
      page.value = 1;
      void fetchTable();
    }
  }
);

watch([page, pageSize], () => {
  checkedRowKeys.value = [];
  void fetchTable();
});

onMounted(() => {
  void fetchAgents();
  void fetchTable();
  resumePoll();
});

onUnmounted(() => {
  pausePoll();
});
</script>

<template>
  <div class="enrichment-page">
    <NCard title="Enrichment table" class="main-card">
      <template #header-extra>
        <NSpace size="small" align="center">
          <NButton size="small" quaternary @click="fetchTable()">Refresh</NButton>
          <NPagination
            v-model:page="page"
            v-model:page-size="pageSize"
            :item-count="total"
            :page-sizes="PAGE_SIZES"
            show-size-picker
            size="small"
          />
        </NSpace>
      </template>

      <NTabs v-model:value="activeTab" type="line" animated>
        <NTabPane name="company" tab="Company enrichment">
          <p class="tab-hint">Project companies with per-agent queue and result state.</p>
        </NTabPane>
        <NTabPane name="contact" tab="Contact enrichment">
          <p class="tab-hint">Project contacts with per-agent queue and result state.</p>
        </NTabPane>
      </NTabs>

      <div class="toolbar toolbar-main">
        <NSpace wrap align="center" :size="10">
          <NSelect
            v-model:value="enqueueAgentName"
            :options="agentSelectOptions"
            :loading="agentsLoading"
            :disabled="!agentSelectOptions.length"
            placeholder="Agent…"
            filterable
            clearable
            size="small"
            style="min-width: 220px"
          />
          <NInput
            v-model:value="enqueueOperationName"
            placeholder="Operation (optional)"
            size="small"
            clearable
            style="width: 180px"
          />
          <NButton
            type="primary"
            size="small"
            :loading="enqueueLoading"
            :disabled="!enqueueAgentName || checkedRowKeys.length === 0"
            @click="enqueueSelected"
          >
            Enqueue selected
          </NButton>
          <NButton size="small" quaternary @click="openManageAgents">Manage agents</NButton>
        </NSpace>
        <div class="toolbar-meta">
          <span v-if="agentsLoading" class="muted">Loading agents…</span>
          <span v-else-if="agents.length" class="muted">{{ agents.length }} active agent(s) for this tab</span>
          <span v-if="checkedRowKeys.length" class="muted selection-hint">{{ checkedRowKeys.length }} selected</span>
        </div>
      </div>

      <NAlert v-if="agentsError" type="warning" class="alert-block" :show-icon="true">
        {{ agentsError }}
      </NAlert>
      <NAlert v-if="tableError" type="error" class="alert-block" :show-icon="true">
        {{ tableError }}
      </NAlert>

      <NSpin :show="tableLoading">
        <NEmpty v-if="!tableLoading && !tableError && rows.length === 0" description="No rows for this project." />
        <NDataTable
          v-else-if="rows.length > 0"
          v-model:checked-row-keys="checkedRowKeys"
          :columns="columns"
          :data="rows"
          :row-key="(r: EnrichmentTableRow) => rowKey(r)"
          :scroll-x="Math.max(900, 200 + columns.length * 120)"
          size="small"
          striped
          bordered
        />
      </NSpin>
    </NCard>

    <NModal
      v-model:show="detailOpen"
      preset="card"
      :title="detailTitle"
      style="width: min(720px, 92vw)"
      :mask-closable="true"
    >
      <pre class="detail-pre">{{ detailBody }}</pre>
    </NModal>

    <NModal
      v-model:show="manageAgentsOpen"
      preset="card"
      title="Enrichment agents"
      style="width: min(720px, 96vw)"
      :mask-closable="true"
    >
      <NAlert v-if="registryError" type="error" class="alert-block" :show-icon="true">
        {{ registryError }}
      </NAlert>
      <NSpin :show="registryLoading">
        <NDataTable
          :columns="registryColumns"
          :data="registryRows"
          :row-key="(r: EnrichmentAgentRegistryRow) => r.name"
          size="small"
          striped
          bordered
          :max-height="360"
        />
      </NSpin>
      <NDivider />
      <div class="new-agent-form">
        <div class="new-agent-title">Add agent</div>
        <NSpace vertical :size="10" style="width: 100%">
          <NSpace wrap :size="8">
            <NInput v-model:value="newAgentName" placeholder="Name (primary key)" size="small" style="min-width: 200px" />
            <NSelect
              v-model:value="newAgentEntityType"
              :options="entityTypeOptions"
              size="small"
              style="width: 140px"
            />
            <NInput v-model:value="newAgentOperation" placeholder="Operation label (optional)" size="small" style="min-width: 200px" />
            <span class="muted small-label">Active</span>
            <NSwitch v-model:value="newAgentActive" size="small" />
          </NSpace>
          <NButton type="primary" size="small" :loading="creatingAgent" :disabled="!newAgentName.trim()" @click="createRegistryAgent">
            Create agent
          </NButton>
        </NSpace>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.enrichment-page {
  padding: 1rem 1.25rem 2rem;
}
.main-card {
  max-width: 1600px;
  margin: 0 auto;
}
.tab-hint {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
  opacity: 0.75;
}
.toolbar {
  margin: 0.5rem 0 1rem;
}
.toolbar-main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
}
.toolbar-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.new-agent-form {
  margin-top: 0.25rem;
}
.new-agent-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.75;
  margin-bottom: 0.5rem;
}
.small-label {
  font-size: 0.75rem;
  align-self: center;
}
.muted {
  font-size: 0.875rem;
  opacity: 0.65;
}
.selection-hint {
  margin-left: 0.25rem;
}
.alert-block {
  margin-bottom: 0.75rem;
}

/* Running agent cell — :deep() so h() nodes inside the table still match */
.enrichment-page :deep(.enrichment-cell--running) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: min(100%, 8rem);
  min-height: 30px;
  padding: 4px 10px;
  margin: 0 auto;
  border-radius: 8px;
  background: color-mix(in srgb, var(--n-primary-color) 16%, transparent);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--n-primary-color) 45%, transparent),
    0 0 0 1px color-mix(in srgb, var(--n-primary-color) 20%, transparent);
  animation: enrichment-running-pulse 1.4s ease-in-out infinite;
}
@keyframes enrichment-running-pulse {
  0%,
  100% {
    background: color-mix(in srgb, var(--n-primary-color) 14%, transparent);
  }
  50% {
    background: color-mix(in srgb, var(--n-primary-color) 24%, transparent);
  }
}

.enrichment-page :deep(.enrichment-summary-col) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  font-size: 12px;
  line-height: 1.35;
  max-width: 260px;
}
.enrichment-page :deep(.enrichment-sum-line) {
  white-space: normal;
}
.enrichment-page :deep(.enrichment-sum-ok) {
  color: var(--n-success-color);
}
.enrichment-page :deep(.enrichment-sum-err) {
  color: var(--n-error-color);
}
.enrichment-page :deep(.enrichment-sum-progress) {
  max-width: 100%;
}
.enrichment-page :deep(.enrichment-sum-errors-btn) {
  align-self: flex-start;
}
.enrichment-page :deep(.enrichment-sum-waiting) {
  margin-top: 2px;
}
.enrichment-page :deep(.enrichment-sum-executing) {
  margin-top: 2px;
}
.enrichment-page :deep(.enrichment-cell-running-text) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}
.enrichment-page :deep(.enrichment-worker-hint) {
  font-size: 10px;
  line-height: 1.2;
  opacity: 0.88;
  max-width: 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.8rem;
  line-height: 1.45;
  max-height: 60vh;
  overflow: auto;
}
</style>
