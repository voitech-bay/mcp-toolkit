<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  h,
  onMounted,
  onUnmounted,
  inject,
  nextTick,
  type Ref,
} from "vue";
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
  NSpin,
  NTag,
  NPagination,
  NSelect,
  NInput,
  NInputNumber,
  NSwitch,
  NPopconfirm,
  useMessage,
} from "naive-ui";
import type { DataTableColumns, DataTableRowKey, SelectOption } from "naive-ui";
import { useIntervalFn } from "@vueuse/core";
import { PlayIcon, RefreshCwIcon, ClockIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";
import {
  useEnrichmentRealtime,
  type EnrichmentDataPayload,
  type EnrichmentBatchStartedPayload,
} from "../composables/useEnrichmentRealtime";
import type { WorkerEntry } from "../composables/useWorkers";

type EntityTab = "company" | "contact";

type EnrichmentAgentCellStatus = "planned" | "queued" | "running" | "success" | "error";

type EnrichmentRunPhase = "batch_wait" | "working";

interface EnrichmentAgentCellState {
  status: EnrichmentAgentCellStatus;
  updatedAt: string | null;
  error?: string | null;
  resultPreview?: unknown;
  workerName?: string | null;
  /** When status is `running`: batch accumulator vs. executing agent. */
  runPhase?: EnrichmentRunPhase;
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
  prompt?: string;
  batch_size?: number;
  is_active: boolean;
}

interface EnrichmentAgentRegistryRow {
  name: string;
  entity_type: string;
  operation_name: string | null;
  prompt: string;
  batch_size: number;
  is_active: boolean;
  created_at: string;
}

const projectStore = useProjectStore();
const message = useMessage();

/** Shared with App.vue (single workers WebSocket). */
const enrichmentWorkers = inject<Ref<WorkerEntry[]>>(
  "workersRegistry",
  ref<WorkerEntry[]>([])
);

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

/** Per-cell POST /api/enrichment/enqueue (Run / Rerun). */
const cellEnqueueLoading = ref<Record<string, boolean>>({});

function cellEnqueueKey(row: EnrichmentTableRow, agentName: string): string {
  return `${rowKey(row)}::${agentName}`;
}

const manageAgentsOpen = ref(false);
const registryRows = ref<EnrichmentAgentRegistryRow[]>([]);
const registryLoading = ref(false);
const registryError = ref("");
const updatingAgentName = ref<string | null>(null);

type AgentModalMode = "create" | "edit";
const agentModalOpen = ref(false);
const agentModalMode = ref<AgentModalMode>("create");
const agentFormName = ref("");
const agentFormEntityType = ref<"company" | "contact" | "both">("company");
const agentFormOperation = ref("");
const agentFormPrompt = ref("");
const agentFormBatchSize = ref<number | null>(1);
const agentFormActive = ref(true);
const savingAgent = ref(false);

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

/** Tasks held in worker memory waiting to form a batch (sum across all workers). */
const workerBatchBufferCount = computed(() =>
  enrichmentWorkers.value.reduce(
    (sum, w) => sum + w.pendingBatches.reduce((s, p) => s + p.count, 0),
    0
  )
);

/** Tooltip: per-agent buffer vs target batch size from workers. */
const workerBatchBufferDetail = computed(() => {
  const parts: string[] = [];
  for (const w of enrichmentWorkers.value) {
    for (const p of w.pendingBatches) {
      parts.push(`${p.agentName}: ${p.count}/${p.batchSize}`);
    }
  }
  return parts.join(" · ");
});

/** Configured agent batch sizes (DB) for agents on this tab. */
const agentBatchSizeSummary = computed(() => {
  const sizes = agents.value.map((a) => Math.max(1, Number(a.batch_size) || 1));
  if (sizes.length === 0) return "";
  const uniq = [...new Set(sizes)].sort((a, b) => a - b);
  if (uniq.length === 1) return String(uniq[0]);
  return uniq.join(" · ");
});

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

/** Row ids on the current page that can be enqueued (same rules as row checkboxes). */
const enqueueableRowIdsOnPage = computed(() =>
  rows.value.filter((r) => !rowEnrichmentInProgress(r)).map((r) => rowKey(r))
);

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

function resetAgentForm() {
  agentFormName.value = "";
  agentFormEntityType.value = "company";
  agentFormOperation.value = "";
  agentFormPrompt.value = "";
  agentFormBatchSize.value = 1;
  agentFormActive.value = true;
}

function openCreateAgentModal() {
  agentModalMode.value = "create";
  resetAgentForm();
  agentModalOpen.value = true;
}

function openEditAgentModal(row: EnrichmentAgentRegistryRow) {
  agentModalMode.value = "edit";
  agentFormName.value = row.name;
  agentFormEntityType.value = row.entity_type as "company" | "contact" | "both";
  agentFormOperation.value = row.operation_name ?? "";
  agentFormPrompt.value = row.prompt ?? "";
  agentFormBatchSize.value = Math.max(1, Number(row.batch_size) || 1);
  agentFormActive.value = row.is_active;
  agentModalOpen.value = true;
}

function truncatePromptText(s: string, max = 56): string {
  const t = s?.trim() ?? "";
  if (!t) return "—";
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

async function submitAgentModal() {
  const name = agentFormName.value.trim();
  if (!name) {
    message.warning("Agent name is required.");
    return;
  }
  const bs = agentFormBatchSize.value;
  const batchSize = typeof bs === "number" && Number.isFinite(bs) ? Math.floor(bs) : 1;
  if (batchSize < 1) {
    message.warning("Batch size must be at least 1.");
    return;
  }
  savingAgent.value = true;
  try {
    const payload = {
      name,
      entity_type: agentFormEntityType.value,
      operation_name: agentFormOperation.value.trim() || null,
      prompt: agentFormPrompt.value,
      batch_size: batchSize,
      is_active: agentFormActive.value,
    };
    const isCreate = agentModalMode.value === "create";
    const r = await fetch("/api/enrichment/agents/registry", {
      method: isCreate ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? (isCreate ? "Create failed" : "Update failed"));
    message.success(isCreate ? "Agent created." : "Agent updated.");
    agentModalOpen.value = false;
    await fetchRegistry();
    await fetchAgents();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Save failed");
  } finally {
    savingAgent.value = false;
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

async function enqueueForIds(ids: string[]) {
  const projectId = projectStore.selectedProjectId;
  const agent = enqueueAgentName.value?.trim();
  if (!projectId || !agent) {
    message.warning("Select an agent.");
    return;
  }
  const filtered = ids.map((k) => String(k)).filter(Boolean);
  if (filtered.length === 0) {
    message.warning("No rows to enqueue.");
    return;
  }
  enqueueLoading.value = true;
  try {
    const body: Record<string, unknown> = {
      projectId,
      entityType: activeTab.value,
      agentName: agent,
    };
    if (activeTab.value === "company") body.companyIds = filtered;
    else body.contactIds = filtered;
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

async function enqueueSelected() {
  await enqueueForIds(checkedRowKeys.value.map((k) => String(k)));
}

/** Per-agent header "run all on page" loading state. */
const headerEnqueueLoading = ref<Record<string, boolean>>({});

/** Staggered row wave after header “run all on page” succeeds. */
const rowWaveActive = ref(false);
const ROW_WAVE_STAGGER_MS = 42;
const ROW_WAVE_DURATION_MS = 520;
let rowWaveClearTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleRowWaveAfterHeaderRun() {
  if (rowWaveClearTimer) {
    clearTimeout(rowWaveClearTimer);
    rowWaveClearTimer = undefined;
  }
  rowWaveActive.value = true;
  const n = rows.value.length;
  const totalMs = Math.min(n * ROW_WAVE_STAGGER_MS + ROW_WAVE_DURATION_MS + 100, 4500);
  rowWaveClearTimer = setTimeout(() => {
    rowWaveActive.value = false;
    rowWaveClearTimer = undefined;
  }, totalMs);
}

async function enqueueForAgentAllOnPage(agentName: string) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) {
    message.warning("Select a project.");
    return;
  }
  const name = agentName.trim();
  if (!name) return;
  const ids = enqueueableRowIdsOnPage.value;
  if (ids.length === 0) {
    message.warning("No rows to enqueue.");
    return;
  }
  headerEnqueueLoading.value = { ...headerEnqueueLoading.value, [name]: true };
  try {
    const op = agents.value.find((a) => a.name === name)?.operation_name?.trim();
    const body: Record<string, unknown> = {
      projectId,
      entityType: activeTab.value,
      agentName: name,
    };
    if (activeTab.value === "company") body.companyIds = ids;
    else body.contactIds = ids;
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
    await nextTick();
    scheduleRowWaveAfterHeaderRun();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Enqueue failed");
  } finally {
    const next = { ...headerEnqueueLoading.value };
    delete next[name];
    headerEnqueueLoading.value = next;
  }
}

async function enqueueOne(row: EnrichmentTableRow, agentName: string) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) {
    message.warning("Select a project.");
    return;
  }
  const entityId =
    activeTab.value === "company" ? row.entity.company_id : row.entity.uuid ?? row.entity.id;
  const idStr = typeof entityId === "string" ? entityId : String(entityId ?? "");
  if (!idStr) {
    message.warning("Missing row id.");
    return;
  }
  const k = cellEnqueueKey(row, agentName);
  cellEnqueueLoading.value = { ...cellEnqueueLoading.value, [k]: true };
  try {
    const op = agents.value.find((a) => a.name === agentName)?.operation_name?.trim();
    const body: Record<string, unknown> = {
      projectId,
      entityType: activeTab.value,
      agentName,
    };
    if (activeTab.value === "company") body.companyIds = [idStr];
    else body.contactIds = [idStr];
    if (op) body.operationName = op;
    const r = await fetch("/api/enrichment/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Enqueue failed");
    message.success("Queued.");
    await fetchTable(false);
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Enqueue failed");
  } finally {
    const next = { ...cellEnqueueLoading.value };
    delete next[k];
    cellEnqueueLoading.value = next;
  }
}

const registryColumns = computed<DataTableColumns<EnrichmentAgentRegistryRow>>(() => [
  { title: "Name", key: "name", width: 160, ellipsis: { tooltip: true } },
  { title: "Entity", key: "entity_type", width: 72 },
  {
    title: "Operation",
    key: "operation_name",
    width: 120,
    ellipsis: { tooltip: true },
    render: (row) => row.operation_name ?? "—",
  },
  {
    title: "Prompt",
    key: "prompt",
    minWidth: 140,
    render: (row) => {
      const full = row.prompt?.trim() ?? "";
      if (!full) return "—";
      const short = truncatePromptText(full, 56);
      return h("span", { title: full, style: "cursor: default" }, short);
    },
  },
  {
    title: "Batch size",
    key: "batch_size",
    width: 84,
    align: "right",
    render: (row) => String(row.batch_size ?? 1),
  },
  {
    title: "Active",
    key: "is_active",
    width: 80,
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
  {
    title: "",
    key: "actions",
    width: 72,
    render: (row) =>
      h(
        NButton,
        {
          size: "tiny",
          quaternary: true,
          onClick: () => openEditAgentModal(row),
        },
        { default: () => "Edit" }
      ),
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

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

/** Prefer showing a human worker name; hide UUIDs if the API still sends them. */
function workerDisplayName(state: EnrichmentAgentCellState | undefined): string | null {
  const w = state?.workerName?.trim();
  if (!w) return null;
  if (isUuidLike(w)) return null;
  return w;
}

function renderAgentCell(
  agentName: string,
  state: EnrichmentAgentCellState | undefined,
  row: EnrichmentTableRow
) {
  const s = state?.status ?? "planned";
  const k = cellEnqueueKey(row, agentName);
  const enqueueBusy = !!cellEnqueueLoading.value[k];

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

  function runIconBtn(
    title: string,
    type: "default" | "primary" | "success" | "error" | "info" = "default",
    icon: "play" | "refresh" = "refresh"
  ) {
    const Icon = icon === "play" ? PlayIcon : RefreshCwIcon;
    return h(NButton, {
      size: "tiny",
      circle: true,
      tertiary: true,
      type,
      renderIcon: () => h(Icon, { size: 14 }),
      title,
      disabled: enqueueBusy,
      loading: enqueueBusy,
      onClick: (e: MouseEvent) => {
        e.stopPropagation();
        void enqueueOne(row, agentName);
      },
    });
  }

  if (s === "planned") {
    return h("div", { class: "enrichment-agent-cell enrichment-agent-cell--planned" }, [
      h("span", { class: "enrichment-agent-cell__status enrichment-agent-cell__status--muted" }, "No data"),
      runIconBtn("Run", "default", "play"),
    ]);
  }
  if (s === "queued") {
    return h("div", { class: "enrichment-agent-cell enrichment-agent-cell--queued" }, [
      h("div", { class: "enrichment-agent-cell__main-row" }, [
        h("span", { class: "enrichment-agent-cell__status enrichment-agent-cell__status--queued" }, "Queued"),
        h(
          NTag,
          {
            size: "small",
            type: "warning",
            bordered: false,
            round: true,
            class: "enrichment-agent-cell__queue-tag",
          },
          { default: () => "Waiting for worker" }
        ),
      ]),
    ]);
  }
  if (s === "running") {
    const w = workerDisplayName(state);
    const phase: EnrichmentRunPhase = state?.runPhase ?? "working";
    const workerTag = w
      ? h(
          NTag,
          {
            size: "small",
            type: "info",
            bordered: false,
            round: true,
            title: `Worker: ${w}`,
            class: "enrichment-agent-cell__worker-tag",
            style: { maxWidth: "10rem" },
          },
          { default: () => w }
        )
      : null;

    if (phase === "batch_wait") {
      return h("div", { class: "enrichment-agent-cell enrichment-agent-cell--running-batch" }, [
        h("div", { class: "enrichment-agent-cell__main-row" }, [
          h(ClockIcon, { size: 16, class: "enrichment-agent-cell__phase-icon enrichment-agent-cell__phase-icon--batch" }),
          h(
            "span",
            { class: "enrichment-agent-cell__status enrichment-agent-cell__status--running-batch" },
            "Agent waiting batch"
          ),
          workerTag,
        ]),
      ]);
    }

    return h("div", { class: "enrichment-agent-cell enrichment-agent-cell--running-working" }, [
      h("div", { class: "enrichment-agent-cell__main-row" }, [
        h(
          "span",
          { class: "enrichment-agent-cell__status enrichment-agent-cell__status--running-working" },
          "Agent working"
        ),
        workerTag,
      ]),
    ]);
  }
  if (s === "success") {
    return h(
      "div",
      {
        class: "enrichment-agent-cell enrichment-agent-cell--done enrichment-agent-cell--clickable",
        onClick: onClickSuccess,
      },
      [
        h("span", { class: "enrichment-agent-cell__label enrichment-agent-cell__label--success" }, "Result"),
        runIconBtn("Rerun", "default"),
      ]
    );
  }
  if (s === "error") {
    return h(
      "div",
      {
        class: "enrichment-agent-cell enrichment-agent-cell--failed enrichment-agent-cell--clickable",
        onClick: onClickError,
      },
      [
        h("span", { class: "enrichment-agent-cell__label enrichment-agent-cell__label--error" }, "Error"),
        runIconBtn("Rerun", "error"),
      ]
    );
  }
  return h("span", { style: "opacity:0.45" }, "—");
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
    sticky: true,
  },
]);

const agentColumns = computed<DataTableColumns<EnrichmentTableRow>>(() => {
  void cellEnqueueLoading.value;
  void enqueueableRowIdsOnPage.value;
  void headerEnqueueLoading.value;
  const names = agentNames.value;
  const opByName = new Map(agents.value.map((a) => [a.name, a.operation_name]));
  const batchByName = new Map(agents.value.map((a) => [a.name, Math.max(1, Number(a.batch_size) || 1)]));
  return names.map((name) => ({
    title: () => {
      const nRows = enqueueableRowIdsOnPage.value.length;
      const busy = !!headerEnqueueLoading.value[name];
      const batchN = batchByName.get(name) ?? 1;
      return h("div", { class: "enrichment-col-head" }, [
        h("div", { class: "enrichment-col-head__left" }, [
          h("span", { class: "enrichment-col-head__name", title: opByName.get(name) ?? undefined }, name),
          h(
            NTag,
            {
              size: "tiny",
              bordered: false,
              round: true,
              type: "info",
              class: "enrichment-col-head__batch",
            },
            { default: () => String(batchN) }
          ),
        ]),
        
        h(
          NPopconfirm,
          {
            showIcon: false,
            positiveText: "Run",
            negativeText: "Cancel",
            onPositiveClick: () => {
              void enqueueForAgentAllOnPage(name);
            },
          },
          {
            trigger: () =>
              h(NButton, {
                size: "tiny",
                circle: true,
                disabled: agentsLoading.value || nRows === 0,
                loading: busy,
                title: `Run ${name} for all rows on this page`,
                renderIcon: () => h(PlayIcon, { size: 14 }),
                onClick: (e: MouseEvent) => {
                  e.stopPropagation();
                },
              }),
            default: () =>
              h("div", { class: "enrichment-col-head-confirm" }, [
                h(
                  "p",
                  { class: "enrichment-col-head-confirm__line" },
                  `Run “${name}” for ${nRows} row(s) on this page?`
                ),
              ]),
          }
        ),
      ]);
    },
    key: `agent:${name}`,
    resizable: true,
    minWidth: 150,
    align: "center" as const,
    render: (row: EnrichmentTableRow) => renderAgentCell(name, row.agentStates[name], row),
  }));
});

const columns = computed(() => [
  ...selectionColumn.value,
  ...baseColumns.value,
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
  if (rowWaveClearTimer) {
    clearTimeout(rowWaveClearTimer);
    rowWaveClearTimer = undefined;
  }
});

const enrichmentTableParams = computed(() => ({
  entityType: activeTab.value,
  limit: pageSize.value,
  offset: (page.value - 1) * pageSize.value,
}));

function applyEnrichmentFromSocket(p: EnrichmentDataPayload) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId || p.projectId !== projectId) return;
  if (p.entityType !== activeTab.value) return;
  if (p.limit !== pageSize.value || p.offset !== (page.value - 1) * pageSize.value) return;
  total.value = Number(p.total ?? 0);
  agentNames.value = Array.isArray(p.agentNames) ? p.agentNames : [];
  rows.value = (p.rows ?? []) as EnrichmentTableRow[];
  agents.value = (p.agents ?? []) as EnrichmentAgentInfo[];
  pruneCheckedRowKeys();
  const err = p.error;
  if (err && typeof err === "string") {
    message.warning(err);
  }
}

function applyBatchStartedFromSocket(p: EnrichmentBatchStartedPayload) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId || p.projectId !== projectId) return;
  const agentName = p.agentName;
  if (!agentName) return;
  const tab = activeTab.value;
  const idSet = new Set<string>();
  for (const it of p.items) {
    if (tab === "company") {
      if (it.companyId) idSet.add(it.companyId);
    } else if (it.contactId) {
      idSet.add(it.contactId);
    }
  }
  if (idSet.size === 0) return;
  const wn = p.workerName ?? null;
  rows.value = rows.value.map((row) => {
    const eid =
      tab === "company"
        ? (row.entity.company_id as string | undefined)
        : (row.entity.uuid as string | undefined);
    if (!eid || !idSet.has(eid)) return row;
    const prev = row.agentStates[agentName];
    if (!prev) return row;
    return {
      ...row,
      agentStates: {
        ...row.agentStates,
        [agentName]: {
          ...prev,
          status: "running",
          runPhase: "working",
          workerName: wn ?? prev.workerName ?? null,
          updatedAt: new Date().toISOString(),
        },
      },
    };
  });
}

const { connected: enrichmentRealtimeConnected } = useEnrichmentRealtime(
  computed(() => projectStore.selectedProjectId),
  enrichmentTableParams,
  {
    onEnrichmentData: applyEnrichmentFromSocket,
    onBatchStarted: applyBatchStartedFromSocket,
    pausePoll,
    resumePoll,
    onSafetyPoll: () => {
      void fetchTable(false);
      void fetchAgents();
    },
  }
);
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
          <NSpace v-if="workerBatchBufferCount > 0 || agentBatchSizeSummary" size="small" align="center" wrap>
            <NTag
              v-if="workerBatchBufferCount > 0"
              size="small"
              type="warning"
              :bordered="true"
              :title="workerBatchBufferDetail || 'Tasks accumulating before batch run'"
            >
              Worker batch {{ workerBatchBufferCount }}
            </NTag>
            <NTag
              v-if="agentBatchSizeSummary"
              size="small"
              :bordered="true"
              title="Configured batch_size on each agent (how many entities per LLM call when full)"
            >
              Agent batch {{ agentBatchSizeSummary }}
            </NTag>
          </NSpace>
          <span v-if="enrichmentRealtimeConnected" class="muted enrichment-live">Live</span>
          <span v-if="tableLoading && rows.length > 0" class="muted">Refreshing…</span>
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

      <NEmpty
        v-if="tableLoading && rows.length === 0 && !tableError"
        description="Loading…"
      />
      <NEmpty v-else-if="!tableLoading && !tableError && rows.length === 0" description="No rows for this project." />
      <NDataTable
        v-else-if="rows.length > 0"
        v-model:checked-row-keys="checkedRowKeys"
        class="enrichment-data-table"
        :columns="columns"
        :data="rows"
        :row-key="(r: EnrichmentTableRow) => rowKey(r)"
        :scroll-x="Math.max(900, 200 + columns.length * 120)"
        size="small"
        striped
        bordered
      />
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
      style="width: min(900px, 96vw)"
      :mask-closable="true"
    >
      <div class="registry-toolbar">
        <NButton size="small" type="primary" @click="openCreateAgentModal">New agent</NButton>
      </div>
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
          :scroll-x="720"
          :max-height="360"
        />
      </NSpin>
    </NModal>

    <NModal
      v-model:show="agentModalOpen"
      preset="card"
      :title="agentModalMode === 'create' ? 'New agent' : `Edit · ${agentFormName}`"
      style="width: min(520px, 94vw)"
      :mask-closable="true"
      :segmented="{ content: true, footer: 'soft' }"
      @after-leave="resetAgentForm"
    >
      <NSpace vertical :size="14" class="agent-modal-form">
        <div class="agent-modal-field">
          <div class="agent-modal-label">Name</div>
          <NInput
            v-model:value="agentFormName"
            placeholder="Unique agent name (primary key)"
            size="small"
            :disabled="agentModalMode === 'edit'"
          />
        </div>
        <div class="agent-modal-field">
          <div class="agent-modal-label">Entity type</div>
          <NSelect v-model:value="agentFormEntityType" :options="entityTypeOptions" size="small" style="width: 100%" />
        </div>
        <div class="agent-modal-field">
          <div class="agent-modal-label">Operation label</div>
          <NInput v-model:value="agentFormOperation" placeholder="Optional label for this operation" size="small" clearable />
        </div>
        <div class="agent-modal-field">
          <div class="agent-modal-label">Prompt</div>
          <NInput
            v-model:value="agentFormPrompt"
            type="textarea"
            placeholder="Instructions for the enrichment agent"
            size="small"
            :autosize="{ minRows: 4, maxRows: 14 }"
          />
        </div>
        <div class="agent-modal-field agent-modal-field--inline">
          <div class="agent-modal-field-grow">
            <div class="agent-modal-label">Batch size</div>
            <NInputNumber
              v-model:value="agentFormBatchSize"
              :min="1"
              :step="1"
              :precision="0"
              size="small"
              placeholder="1"
              style="width: 100%"
            />
          </div>
          <div class="agent-modal-field-switch">
            <div class="agent-modal-label">Active</div>
            <NSwitch v-model:value="agentFormActive" size="small" />
          </div>
        </div>
      </NSpace>
      <template #footer>
        <NSpace justify="end" size="small">
          <NButton size="small" @click="agentModalOpen = false">Cancel</NButton>
          <NButton
            type="primary"
            size="small"
            :loading="savingAgent"
            :disabled="!agentFormName.trim()"
            @click="submitAgentModal"
          >
            {{ agentModalMode === 'create' ? 'Create' : 'Save' }}
          </NButton>
        </NSpace>
      </template>
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
.registry-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.75rem;
}
.agent-modal-form {
  width: 100%;
}
.agent-modal-field {
  width: 100%;
}
.agent-modal-field--inline {
  display: flex;
  gap: 1rem;
  align-items: flex-end;
}
.agent-modal-field-grow {
  flex: 1;
  min-width: 0;
}
.agent-modal-field-switch {
  flex-shrink: 0;
  padding-bottom: 2px;
}
.agent-modal-label {
  font-size: 0.75rem;
  opacity: 0.75;
  margin-bottom: 0.35rem;
}
.muted {
  font-size: 0.875rem;
  opacity: 0.65;
}
.selection-hint {
  margin-left: 0.25rem;
}
.enrichment-live {
  font-weight: 600;
  color: var(--n-success-color, #63e2b7);
  margin-right: 0.35rem;
}
.alert-block {
  margin-bottom: 0.75rem;
}

.enrichment-page :deep(.enrichment-agent-cell) {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  column-gap: calc(var(--n-td-padding) + 6px);
  row-gap: calc(var(--n-td-padding) / 2 + 4px);
  min-height: 40px;
  padding: calc(var(--n-td-padding) + 2px) calc(var(--n-td-padding) + 4px);
  border-radius: calc(var(--n-border-radius) * 2 + 2px);
  box-sizing: border-box;
  text-align: left;
}
.enrichment-page :deep(.enrichment-agent-cell--clickable) {
  cursor: pointer;
}
.enrichment-page :deep(.enrichment-agent-cell__label) {
  font-size: var(--n-font-size);
  line-height: var(--n-line-height);
  font-weight: var(--n-th-font-weight);
  flex-shrink: 0;
}
.enrichment-page :deep(.enrichment-agent-cell__label--success) {
  color: var(--n-th-icon-color-active);
}
.enrichment-page :deep(.enrichment-agent-cell__label--error) {
  color: var(--n-td-text-color);
}
.enrichment-page :deep(.enrichment-agent-cell--planned) {
  background: color-mix(in srgb, var(--n-th-icon-color) 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--n-border-color) 45%, transparent);
}
.enrichment-page :deep(.enrichment-col-head__batch) {
  flex-shrink: 0;
  font-size: 10px;
  padding: 0 6px;
  line-height: 1.35;
}
.enrichment-page :deep(.enrichment-agent-cell--queued) {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  column-gap: 8px;
  row-gap: 4px;
  background: color-mix(in srgb, rgb(251, 191, 36) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, rgb(245, 158, 11) 34%, transparent);
}
.enrichment-page :deep(.enrichment-agent-cell__status--queued) {
  color: rgba(253, 224, 71, 0.95);
}
.enrichment-page :deep(.enrichment-agent-cell__queue-tag) {
  flex-shrink: 0;
  max-width: min(100%, 11rem);
}
.enrichment-page :deep(.enrichment-agent-cell--running-batch) {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  column-gap: 8px;
  row-gap: 4px;
  background: color-mix(in srgb, rgb(167, 139, 250) 16%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, rgb(167, 139, 250) 36%, transparent);
}
.enrichment-page :deep(.enrichment-agent-cell--running-working) {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  column-gap: 8px;
  row-gap: 4px;
  background: color-mix(in srgb, rgb(96, 165, 250) 16%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, rgb(96, 165, 250) 38%, transparent);
}
.enrichment-page :deep(.enrichment-agent-cell__status--running-batch) {
  color: rgba(216, 201, 255, 0.96);
}
.enrichment-page :deep(.enrichment-agent-cell__status--running-working) {
  color: rgba(186, 220, 255, 0.95);
}
.enrichment-page :deep(.enrichment-agent-cell__phase-icon--batch) {
  color: rgba(196, 181, 253, 0.95);
  flex-shrink: 0;
}
.enrichment-page :deep(.enrichment-agent-cell__worker-tag) {
  flex-shrink: 0;
  max-width: min(100%, 10rem);
}
.enrichment-page :deep(.enrichment-agent-cell__main-row) {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.enrichment-page :deep(.enrichment-agent-cell--done) {
  background: color-mix(in srgb, var(--n-th-icon-color-active) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--n-loading-color) 28%, transparent);
}
.enrichment-page :deep(.enrichment-agent-cell--failed) {
  background: color-mix(in srgb, var(--n-border-color-modal) 35%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--n-border-color-popover) 55%, transparent);
}
.enrichment-page :deep(.enrichment-agent-cell__row) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: calc(var(--n-td-padding) + 4px);
}
.enrichment-page :deep(.enrichment-agent-cell__status) {
  font-size: 12px;
  font-weight: var(--n-th-font-weight);
  color: var(--n-td-text-color);
}
.enrichment-page :deep(.enrichment-agent-cell__status--muted) {
  font-size: 12px;
  color: var(--n-th-icon-color);
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

<style>
.enrichment-col-head {
  justify-content: space-between;
  display: flex;
  align-items: center;
  padding-right: 12px;
}

.enrichment-col-head__left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.enrichment-col-head-confirm {
  max-width: 260px;
  font-size: 13px;
  line-height: 1.45;
}
.enrichment-col-head-confirm__line {
  margin: 0;
}
</style>
