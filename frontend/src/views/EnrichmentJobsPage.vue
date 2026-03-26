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
  useMessage,
} from "naive-ui";
import type { DataTableColumns, SelectOption } from "naive-ui";
import { useIntervalFn } from "@vueuse/core";
import { useProjectStore } from "../stores/project";
import {
  fetchEnrichmentBatchDetail,
  type EnrichmentBatchDetailBatch,
  type EnrichmentBatchDetailRun,
} from "../composables/useEnrichmentBatchDetail";

interface QueueTaskRow {
  id: string;
  project_id: string;
  agent_name: string;
  operation_name: string | null;
  company_id: string | null;
  contact_id: string | null;
  meta: Record<string, unknown>;
  status: string;
  attempts: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
  last_error: string | null;
  enrichment_agent_run_id: string | null;
  claimed_by?: string | null;
}

interface AgentRunRow {
  id: string;
  queue_task_id: string;
  project_id: string;
  agent_name: string;
  operation_name: string | null;
  company_id: string | null;
  contact_id: string | null;
  batch_id?: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  input: Record<string, unknown>;
  meta?: Record<string, unknown>;
  created_at: string;
}

const projectStore = useProjectStore();
const message = useMessage();

const activeTab = ref<"queue" | "runs">("queue");
const page = ref(1);
const pageSize = ref(25);
const PAGE_SIZES = [10, 25, 50, 100];

const queueStatusFilter = ref("");
const runStatusFilter = ref("");

const queueRows = ref<QueueTaskRow[]>([]);
const queueTotal = ref(0);
const runsRows = ref<AgentRunRow[]>([]);
const runsTotal = ref(0);
const loading = ref(false);
const errorText = ref("");
const actingId = ref<string | null>(null);

const detailOpen = ref(false);
const detailTitle = ref("");
const detailBody = ref("");

const POLL_MS = 6000;
const { pause: pausePoll, resume: resumePoll } = useIntervalFn(
  () => {
    void loadActiveTab(false);
  },
  POLL_MS,
  { immediate: false }
);

const queueStatusOptions: SelectOption[] = [
  { label: "All statuses", value: "" },
  { label: "Queued", value: "queued" },
  { label: "Running", value: "running" },
  { label: "Done", value: "done" },
  { label: "Error", value: "error" },
  { label: "Cancelled", value: "cancelled" },
];

const runStatusOptions: SelectOption[] = [
  { label: "All statuses", value: "" },
  { label: "Running", value: "running" },
  { label: "Success", value: "success" },
  { label: "Error", value: "error" },
];

function statusTagType(
  status: string
): "default" | "info" | "success" | "warning" | "error" {
  switch (status) {
    case "queued":
      return "default";
    case "running":
      return "info";
    case "done":
    case "success":
      return "success";
    case "error":
      return "error";
    case "cancelled":
      return "warning";
    default:
      return "default";
  }
}

function entityLabel(row: { company_id: string | null; contact_id: string | null }): string {
  if (row.company_id) return `company ${row.company_id.slice(0, 8)}…`;
  if (row.contact_id) return `contact ${row.contact_id.slice(0, 8)}…`;
  return "—";
}

/** Prefer human-readable worker; queue `claimed_by` may be a worker UUID from RPC. */
function isProbablyUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function queueWorkerDisplay(row: QueueTaskRow): string {
  const m = row.meta;
  if (m && typeof m.worker_name === "string" && m.worker_name.trim()) {
    return m.worker_name.trim();
  }
  const cb = row.claimed_by?.trim();
  if (cb && !isProbablyUuid(cb)) return cb;
  if (cb) return cb;
  return "—";
}

function runWorkerName(row: AgentRunRow): string {
  const m = row.meta;
  if (m && typeof m.worker_name === "string" && m.worker_name.trim()) return m.worker_name.trim();
  const inp = row.input;
  if (inp && typeof inp === "object" && inp !== null) {
    const w = (inp as Record<string, unknown>).worker_name;
    if (typeof w === "string" && w.trim()) return w.trim();
  }
  return "—";
}

function openJson(title: string, payload: unknown) {
  detailTitle.value = title;
  detailBody.value =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  detailOpen.value = true;
}

const batchDetailOpen = ref(false);
const batchDetailLoading = ref(false);
const batchDetailError = ref("");
const batchDetailBatch = ref<EnrichmentBatchDetailBatch | null>(null);
const batchDetailRuns = ref<EnrichmentBatchDetailRun[]>([]);

const batchRowDetailOpen = ref(false);
const batchRowDetailTitle = ref("");
const batchRowDetailBody = ref("");

function openBatchRowDetail(title: string, body: string) {
  batchRowDetailTitle.value = title;
  batchRowDetailBody.value = body;
  batchRowDetailOpen.value = true;
}

function entityLabelBatchRow(r: EnrichmentBatchDetailRun): string {
  if (r.company_id) return `company ${r.company_id.slice(0, 8)}…`;
  if (r.contact_id) return `contact ${r.contact_id.slice(0, 8)}…`;
  return "—";
}

function batchRunStatusTagType(
  status: string
): "default" | "info" | "success" | "warning" | "error" {
  switch (status) {
    case "running":
      return "info";
    case "success":
      return "success";
    case "error":
      return "error";
    default:
      return "default";
  }
}

const batchDetailColumns = computed<DataTableColumns<EnrichmentBatchDetailRun>>(() => [
  {
    title: "Entity",
    key: "entity",
    width: 200,
    ellipsis: { tooltip: true },
    render: (row) => entityLabelBatchRow(row),
  },
  {
    title: "Status",
    key: "status",
    width: 96,
    render: (row) =>
      h(
        NTag,
        { size: "small", type: batchRunStatusTagType(row.status), bordered: false },
        () => row.status
      ),
  },
  {
    title: "Error",
    key: "error",
    ellipsis: { tooltip: true },
    render: (row) => row.error?.trim() || "—",
  },
  {
    title: "",
    key: "actions",
    width: 120,
    render: (row) =>
      h(
        NButton,
        {
          size: "tiny",
          quaternary: true,
          disabled: row.status !== "success" && row.status !== "error",
          onClick: () => {
            if (row.status === "success") {
              const raw = row.resultPreview;
              const text =
                raw === undefined
                  ? "(no result)"
                  : typeof raw === "string"
                    ? raw
                    : JSON.stringify(raw, null, 2);
              openBatchRowDetail(`Result · ${entityLabelBatchRow(row)}`, text);
            } else if (row.status === "error") {
              openBatchRowDetail(`Error · ${entityLabelBatchRow(row)}`, row.error ?? "(no message)");
            }
          },
        },
        { default: () => (row.status === "success" ? "View result" : row.status === "error" ? "View error" : "—") }
      ),
  },
]);

async function openBatchDetailModal(batchId: string) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId || !batchId) return;
  batchDetailOpen.value = true;
  batchDetailLoading.value = true;
  batchDetailError.value = "";
  batchDetailBatch.value = null;
  batchDetailRuns.value = [];
  try {
    const data = await fetchEnrichmentBatchDetail(projectId, batchId);
    batchDetailBatch.value = data.batch;
    batchDetailRuns.value = data.runs;
  } catch (e) {
    batchDetailError.value = e instanceof Error ? e.message : "Failed to load batch";
  } finally {
    batchDetailLoading.value = false;
  }
}

const queueColumns = computed<DataTableColumns<QueueTaskRow>>(() => [
  {
    title: "Status",
    key: "status",
    width: 100,
    render: (row) =>
      h(NTag, { size: "small", type: statusTagType(row.status), bordered: false }, () => row.status),
  },
  { title: "Agent", key: "agent_name", width: 140, ellipsis: { tooltip: true } },
  {
    title: "Entity",
    key: "entity",
    width: 200,
    ellipsis: { tooltip: true },
    render: (row) => entityLabel(row),
  },
  {
    title: "Worker",
    key: "claimed_by",
    width: 160,
    ellipsis: { tooltip: true },
    render: (row) => queueWorkerDisplay(row),
  },
  { title: "Attempts", key: "attempts", width: 72 },
  {
    title: "Updated",
    key: "updated_at",
    width: 160,
    render: (row) => row.updated_at?.replace("T", " ").slice(0, 19) ?? "—",
  },
  {
    title: "",
    key: "actions",
    width: 200,
    fixed: "right",
    render: (row) => {
      const canStop = row.status === "queued" || row.status === "running";
      const canRestart =
        row.status === "done" || row.status === "error" || row.status === "cancelled";
      return h(
        "div",
        { style: "display:flex;gap:4px;flex-wrap:wrap;align-items:center" },
        [
          canStop
            ? h(
                NButton,
                {
                  size: "tiny",
                  type: "warning",
                  loading: actingId.value === row.id,
                  disabled: actingId.value !== null && actingId.value !== row.id,
                  onClick: () => stopTask(row),
                },
                { default: () => "Stop" }
              )
            : null,
          canRestart
            ? h(
                NButton,
                {
                  size: "tiny",
                  type: "primary",
                  quaternary: true,
                  loading: actingId.value === row.id,
                  disabled: actingId.value !== null && actingId.value !== row.id,
                  onClick: () => restartTask(row),
                },
                { default: () => "Restart" }
              )
            : null,
          h(
            NButton,
            {
              size: "tiny",
              quaternary: true,
              onClick: () => openJson(`Queue task ${row.id}`, row),
            },
            { default: () => "JSON" }
          ),
        ].filter(Boolean) as ReturnType<typeof h>[]
      );
    },
  },
]);

const runsColumns = computed<DataTableColumns<AgentRunRow>>(() => [
  {
    title: "Status",
    key: "status",
    width: 88,
    render: (row) =>
      h(NTag, { size: "small", type: statusTagType(row.status), bordered: false }, () => row.status),
  },
  { title: "Agent", key: "agent_name", width: 130, ellipsis: { tooltip: true } },
  {
    title: "Entity",
    key: "entity",
    width: 180,
    render: (row) => entityLabel(row),
  },
  {
    title: "Worker",
    key: "worker",
    width: 160,
    ellipsis: { tooltip: true },
    render: (row) => runWorkerName(row),
  },
  {
    title: "Batch",
    key: "batch_id",
    width: 120,
    ellipsis: { tooltip: true },
    render: (row) => {
      const bid = row.batch_id?.trim();
      if (!bid) return "—";
      return h(
        NButton,
        {
          size: "tiny",
          quaternary: true,
          title: bid,
          onClick: () => void openBatchDetailModal(bid),
        },
        { default: () => `${bid.slice(0, 8)}…` }
      );
    },
  },
  {
    title: "Queue task",
    key: "queue_task_id",
    width: 100,
    ellipsis: { tooltip: true },
    render: (row) => row.queue_task_id.slice(0, 8) + "…",
  },
  {
    title: "Started",
    key: "started_at",
    width: 160,
    render: (row) => row.started_at?.replace("T", " ").slice(0, 19) ?? "—",
  },
  {
    title: "Finished",
    key: "finished_at",
    width: 160,
    render: (row) => row.finished_at?.replace("T", " ").slice(0, 19) ?? "—",
  },
  {
    title: "",
    key: "actions",
    width: 140,
    fixed: "right",
    render: (row) =>
      h(
        "div",
        { style: "display:flex;gap:4px;flex-wrap:wrap;align-items:center" },
        [
          row.status === "running"
            ? h(
                NButton,
                {
                  size: "tiny",
                  type: "warning",
                  loading: actingId.value === row.queue_task_id,
                  disabled: actingId.value !== null && actingId.value !== row.queue_task_id,
                  onClick: () => stopByQueueTaskId(row.queue_task_id),
                },
                { default: () => "Stop task" }
              )
            : null,
          h(
            NButton,
            {
              size: "tiny",
              quaternary: true,
              onClick: () => openJson(`Run ${row.id}`, row),
            },
            { default: () => "JSON" }
          ),
        ].filter(Boolean) as ReturnType<typeof h>[]
      ),
  },
]);

async function loadQueue(showSpinner = true) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) return;
  if (showSpinner) loading.value = true;
  errorText.value = "";
  try {
    const off = (page.value - 1) * pageSize.value;
    const q = new URLSearchParams({
      projectId,
      limit: String(pageSize.value),
      offset: String(off),
    });
    const st = queueStatusFilter.value.trim();
    if (st) q.set("status", st);
    const r = await fetch(`/api/enrichment/queue?${q}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to load queue");
    queueRows.value = (j.data ?? []) as QueueTaskRow[];
    queueTotal.value = Number(j.total ?? 0);
  } catch (e) {
    queueRows.value = [];
    queueTotal.value = 0;
    errorText.value = e instanceof Error ? e.message : "Load failed";
  } finally {
    loading.value = false;
  }
}

async function loadRuns(showSpinner = true) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) return;
  if (showSpinner) loading.value = true;
  errorText.value = "";
  try {
    const off = (page.value - 1) * pageSize.value;
    const q = new URLSearchParams({
      projectId,
      limit: String(pageSize.value),
      offset: String(off),
    });
    const st = runStatusFilter.value.trim();
    if (st) q.set("status", st);
    const r = await fetch(`/api/enrichment/runs?${q}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to load runs");
    runsRows.value = (j.data ?? []) as AgentRunRow[];
    runsTotal.value = Number(j.total ?? 0);
  } catch (e) {
    runsRows.value = [];
    runsTotal.value = 0;
    errorText.value = e instanceof Error ? e.message : "Load failed";
  } finally {
    loading.value = false;
  }
}

async function loadActiveTab(showSpinner = true) {
  if (activeTab.value === "queue") await loadQueue(showSpinner);
  else await loadRuns(showSpinner);
}

async function stopTask(row: QueueTaskRow) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) return;
  actingId.value = row.id;
  try {
    const r = await fetch("/api/enrichment/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, queueTaskId: row.id }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Stop failed");
    message.success("Task stopped.");
    await loadActiveTab(false);
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Stop failed");
  } finally {
    actingId.value = null;
  }
}

async function stopByQueueTaskId(queueTaskId: string) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) return;
  actingId.value = queueTaskId;
  try {
    const r = await fetch("/api/enrichment/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, queueTaskId }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Stop failed");
    message.success("Task stopped.");
    await loadActiveTab(false);
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Stop failed");
  } finally {
    actingId.value = null;
  }
}

async function restartTask(row: QueueTaskRow) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) return;
  actingId.value = row.id;
  try {
    const r = await fetch("/api/enrichment/restart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, queueTaskId: row.id }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Restart failed");
    message.success(`Re-queued (new task ${String(j.newTaskId ?? "").slice(0, 8)}…).`);
    await loadQueue(false);
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Restart failed");
  } finally {
    actingId.value = null;
  }
}

watch(activeTab, () => {
  page.value = 1;
  void loadActiveTab();
});

watch([page, pageSize], () => {
  void loadActiveTab();
});

watch(queueStatusFilter, () => {
  page.value = 1;
  if (activeTab.value === "queue") void loadQueue();
});

watch(runStatusFilter, () => {
  page.value = 1;
  if (activeTab.value === "runs") void loadRuns();
});

watch(
  () => projectStore.selectedProjectId,
  (id) => {
    page.value = 1;
    if (id) void loadActiveTab();
  }
);

onMounted(() => {
  void loadActiveTab();
  resumePoll();
});

onUnmounted(() => {
  pausePoll();
});
</script>

<template>
  <div class="jobs-page">
    <NCard title="Enrichment jobs" class="main-card">
      <template #header-extra>
        <NSpace size="small" align="center">
          <NButton size="small" quaternary @click="loadActiveTab()">Refresh</NButton>
          <NPagination
            v-model:page="page"
            v-model:page-size="pageSize"
            :item-count="activeTab === 'queue' ? queueTotal : runsTotal"
            :page-sizes="PAGE_SIZES"
            show-size-picker
            size="small"
          />
        </NSpace>
      </template>

      <p class="hint">
        Queue tasks are what workers claim; runs are each execution attempt. Stop cancels queued work or marks an active run as stopped. Restart clones a
        <strong>finished</strong> queue row into a new queued task.
      </p>

      <NTabs v-model:value="activeTab" type="line" animated>
        <NTabPane name="queue" tab="Queue">
          <NSpace class="filters" align="center" :size="12">
            <span class="muted">Status</span>
            <NSelect v-model:value="queueStatusFilter" :options="queueStatusOptions" size="small" style="width: 180px" />
          </NSpace>
        </NTabPane>
        <NTabPane name="runs" tab="Runs">
          <NSpace class="filters" align="center" :size="12">
            <span class="muted">Status</span>
            <NSelect v-model:value="runStatusFilter" :options="runStatusOptions" size="small" style="width: 180px" />
          </NSpace>
        </NTabPane>
      </NTabs>

      <NAlert v-if="errorText" type="error" class="alert-block" :show-icon="true">
        {{ errorText }}
      </NAlert>

      <NSpin :show="loading">
        <NEmpty
          v-if="!loading && !errorText && activeTab === 'queue' && queueRows.length === 0"
          description="No queue tasks for this project."
        />
        <NEmpty
          v-else-if="!loading && !errorText && activeTab === 'runs' && runsRows.length === 0"
          description="No runs for this project."
        />
        <NDataTable
          v-else-if="activeTab === 'queue' && queueRows.length > 0"
          :columns="queueColumns"
          :data="queueRows"
          :row-key="(r: QueueTaskRow) => r.id"
          :scroll-x="1100"
          size="small"
          striped
          bordered
        />
        <NDataTable
          v-else-if="activeTab === 'runs' && runsRows.length > 0"
          :columns="runsColumns"
          :data="runsRows"
          :row-key="(r: AgentRunRow) => r.id"
          :scroll-x="1320"
          size="small"
          striped
          bordered
        />
      </NSpin>
    </NCard>

    <NModal v-model:show="detailOpen" preset="card" :title="detailTitle" style="width: min(720px, 92vw)" :mask-closable="true">
      <pre class="detail-pre">{{ detailBody }}</pre>
    </NModal>

    <NModal
      v-model:show="batchDetailOpen"
      preset="card"
      :title="batchDetailBatch ? `Batch · ${batchDetailBatch.agent_name}` : 'Batch detail'"
      style="width: min(900px, 96vw)"
      :mask-closable="true"
    >
      <NSpin :show="batchDetailLoading">
        <NAlert v-if="batchDetailError" type="error" :show-icon="true">{{ batchDetailError }}</NAlert>
        <template v-else-if="batchDetailBatch">
          <div class="batch-detail-header">
            <span
              >Worker: <strong>{{ batchDetailBatch.worker_name }}</strong></span
            >
            <span class="muted">{{
              batchDetailBatch.created_at?.replace("T", " ").slice(0, 19)
            }}</span>
            <span class="muted"><code>{{ batchDetailBatch.id }}</code></span>
          </div>
          <NDataTable
            v-if="batchDetailRuns.length"
            :columns="batchDetailColumns"
            :data="batchDetailRuns"
            :row-key="(r: EnrichmentBatchDetailRun) => r.id"
            size="small"
            striped
            bordered
            :scroll-x="720"
          />
          <NEmpty v-else description="No runs linked to this batch." />
        </template>
      </NSpin>
    </NModal>

    <NModal
      v-model:show="batchRowDetailOpen"
      preset="card"
      :title="batchRowDetailTitle"
      style="width: min(640px, 92vw)"
      :mask-closable="true"
    >
      <pre class="detail-pre">{{ batchRowDetailBody }}</pre>
    </NModal>
  </div>
</template>

<style scoped>
.jobs-page {
  padding: 1rem 1.25rem 2rem;
}
.main-card {
  max-width: 1400px;
  margin: 0 auto;
}
.hint {
  margin: 0 0 1rem;
  font-size: 0.875rem;
  opacity: 0.8;
  line-height: 1.45;
}
.filters {
  margin: 0.5rem 0 0.75rem;
}
.muted {
  font-size: 0.8rem;
  opacity: 0.7;
}
.alert-block {
  margin: 0.75rem 0;
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

.batch-detail-header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  align-items: baseline;
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
}
</style>
