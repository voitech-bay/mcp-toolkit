<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, h } from "vue";
import {
  NCard, NButton, NInput, NAlert, NSpin, NTag,
  NCollapse, NCollapseItem, NDataTable, NText, NTooltip,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import {
  CheckCircle2Icon, AlertTriangleIcon, RefreshCwIcon,
  PlayIcon, KeyIcon, EyeIcon, EyeOffIcon, HistoryIcon,
} from "lucide-vue-next";
import type { SyncRun, PreflightResult, SyncWsMessage, SyncLogEntry } from "../types";
import { useProjectStore } from "../stores/project";

// --- State ---
const message = useMessage();
const projectStore = useProjectStore();

const selectedProjectId = computed(() => projectStore.selectedProjectId);
const selectedProject = computed(() => projectStore.selectedProject);


const credBaseUrl = ref(projectStore.selectedProject?.source_api_base_url ?? "");
const credApiKey = ref("");
const showApiKey = ref(false);
const savingCreds = ref(false);

const preflight = ref<PreflightResult | null>(null);
const preflightLoading = ref(false);
const preflightError = ref("");

const syncing = ref(false);
const activeRunId = ref<string | null>(null);
const elapsedSeconds = ref(0);
const syncComplete = ref(false);
const logEntries = ref<SyncLogEntry[]>([]);
const logPanelEl = ref<HTMLElement | null>(null);
const progress = ref({ contacts: 0, linkedin_messages: 0, senders: 0 });

const historyLoading = ref(false);
const history = ref<SyncRun[]>([]);

let ws: WebSocket | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

// --- Computed ---
const activeSyncRun = computed(() => preflight.value?.activeSyncRun ?? null);
const anotherSyncRunning = computed(() => {
  const run = activeSyncRun.value;
  return run != null && run.project_id !== selectedProjectId.value;
});
const thisSyncRunning = computed(() => {
  const run = activeSyncRun.value;
  return run != null && run.project_id === selectedProjectId.value;
});

const canSync = computed(() => {
  if (!selectedProject.value) return false;
  if (!selectedProject.value.api_key_set) return false;
  if (syncing.value) return false;
  if (activeSyncRun.value != null) return false;
  return true;
});

const elapsedLabel = computed(() => {
  const s = elapsedSeconds.value;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
});

const showLogPanel = computed(() => logEntries.value.length > 0 || syncing.value);

// --- Helpers ---
function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function latestCreatedAt(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "—";
  const sorted = rows
    .map((r) => r.created_at as string)
    .filter(Boolean)
    .sort()
    .reverse();
  return sorted[0] ? new Date(sorted[0]).toLocaleString() : "—";
}

// --- API ---
async function loadPreflight() {
  if (!selectedProjectId.value) return;
  preflightLoading.value = true;
  preflightError.value = "";
  try {
    const r = await fetch(`/api/sync-preflight?projectId=${selectedProjectId.value}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Preflight check failed");
    preflight.value = data;
  } catch (e) {
    preflightError.value = e instanceof Error ? e.message : "Preflight check failed";
  } finally {
    preflightLoading.value = false;
  }
}

async function saveCredentials() {
  if (!selectedProjectId.value) return;
  savingCreds.value = true;
  try {
    const body: { apiKey?: string; baseUrl?: string } = {};
    if (credApiKey.value.trim()) body.apiKey = credApiKey.value.trim();
    if (credBaseUrl.value !== undefined) body.baseUrl = credBaseUrl.value.trim() || undefined;
    const r = await fetch(`/api/projects/${selectedProjectId.value}/credentials`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Failed to save credentials");
    message.success("Credentials saved");
    credApiKey.value = "";
    await projectStore.loadProjects();
    await loadPreflight();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to save credentials");
  } finally {
    savingCreds.value = false;
  }
}

async function loadHistory() {
  if (!selectedProjectId.value) return;
  historyLoading.value = true;
  try {
    const r = await fetch(`/api/sync-history?projectId=${selectedProjectId.value}&limit=10`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Failed to load history");
    history.value = data.data ?? [];
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to load sync history");
  } finally {
    historyLoading.value = false;
  }
}

function connectWs(runId: string) {
  if (ws) ws.close();
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${window.location.host}/api/sync-ws?runId=${runId}`);

  ws.onmessage = (evt) => {
    const event = JSON.parse(evt.data as string) as SyncWsMessage;
    if (event.type === "log") {
      logEntries.value.push(event.entry);
      if (event.entry.kind === "upsert" && event.entry.table_name && event.entry.row_count) {
        const t = event.entry.table_name.toLowerCase();
        if (t.includes("contact")) progress.value.contacts += event.entry.row_count;
        else if (t.includes("linkedin") || t.includes("message")) progress.value.linkedin_messages += event.entry.row_count;
        else if (t.includes("sender")) progress.value.senders += event.entry.row_count;
      }
      scrollLog();
    } else if (event.type === "complete") {
      syncComplete.value = true;
      syncing.value = false;
      activeRunId.value = null;
      stopElapsed();
      message.success("Sync completed!");
      loadPreflight();
      loadHistory();
    }
  };

  ws.onerror = () => {
    message.error("WebSocket error — check console");
    syncing.value = false;
    stopElapsed();
  };
}

async function startSync() {
  if (!selectedProjectId.value) return;
  syncing.value = true;
  syncComplete.value = false;
  logEntries.value = [];
  progress.value = { contacts: 0, linkedin_messages: 0, senders: 0 };
  elapsedSeconds.value = 0;
  try {
    const r = await fetch("/api/supabase-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: selectedProjectId.value }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Failed to start sync");
    activeRunId.value = data.runId;
    elapsedTimer = setInterval(() => elapsedSeconds.value++, 1000);
    connectWs(data.runId);
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to start sync");
    syncing.value = false;
  }
}

function stopElapsed() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

async function scrollLog() {
  await nextTick();
  if (logPanelEl.value) {
    logPanelEl.value.scrollTop = logPanelEl.value.scrollHeight;
  }
}

// --- Watch ---
watch(selectedProjectId, async (id) => {
  preflight.value = null;
  history.value = [];
  logEntries.value = [];
  syncComplete.value = false;
  if (!id) return;
  credBaseUrl.value = projectStore.selectedProject?.source_api_base_url ?? "";
  credApiKey.value = "";
  await Promise.all([loadPreflight(), loadHistory()]);
});

onMounted(async () => {
  if (projectStore.projects.length === 0) await projectStore.loadProjects();
  if (selectedProjectId.value) {
    credBaseUrl.value = projectStore.selectedProject?.source_api_base_url ?? "";
    await Promise.all([loadPreflight(), loadHistory()]);
  }
});
onUnmounted(() => {
  if (ws) ws.close();
  stopElapsed();
});

// --- History table columns ---
const historyColumns = computed<DataTableColumns<SyncRun>>(() => [
  {
    type: "expand",
    expandable: (row) => row.log_entries.length > 0,
    renderExpand(row) {
      return h("div", { class: "log-expand" }, [
        ...row.log_entries.map((e) =>
          h("div", { class: `log-entry log-${e.level}` }, [
            h("span", { class: "log-time" }, new Date(e.created_at).toLocaleTimeString()),
            h("span", { class: `log-badge log-badge-${e.level}` }, e.level.toUpperCase()),
            e.table_name ? h("span", { class: "log-table" }, e.table_name) : null,
            h("span", { class: "log-msg" }, e.message),
            e.row_count != null ? h("span", { class: "log-rows" }, `(${e.row_count} rows)`) : null,
          ].filter(Boolean))
        ),
      ]);
    },
  },
  {
    title: "Started",
    key: "started_at",
    width: 180,
    render: (row) => formatDate(row.started_at),
  },
  {
    title: "Duration",
    key: "duration",
    width: 100,
    render: (row) => formatDuration(row.started_at, row.finished_at),
  },
  {
    title: "Status",
    key: "status",
    width: 110,
    render: (row) => {
      const typeMap: Record<string, "success" | "error" | "warning" | "info"> = {
        success: "success",
        error: "error",
        partial: "warning",
        running: "info",
      };
      return h(NTag, { type: typeMap[row.status] ?? "default", size: "small", round: true }, { default: () => row.status });
    },
  },
  {
    title: "Summary",
    key: "result_summary",
    render: (row) => {
      if (row.error) return h(NText, { depth: 3, style: "color: var(--n-error-color)" }, { default: () => row.error ?? "" });
      const s = row.result_summary;
      if (!s) return h(NText, { depth: 3 }, { default: () => "—" });
      const parts: string[] = [];
      for (const [k, v] of Object.entries(s)) {
        const val = v as Record<string, number>;
        if (val && typeof val === "object") {
          parts.push(`${k}: ${val.upserted ?? 0} upserted`);
        }
      }
      return h(NText, { depth: 3 }, { default: () => parts.join(" · ") || "—" });
    },
  },
]);

// --- Preflight table rows ---
const preflightRows = computed(() => {
  const counts = preflight.value?.counts;
  const latest = preflight.value?.latest;
  return [
    {
      label: "Contacts",
      count: counts?.contacts ?? "—",
      latest: latestCreatedAt(latest?.contacts ?? []),
      sample: (latest?.contacts ?? []).slice(0, 3),
    },
    {
      label: "LinkedIn Messages",
      count: counts?.linkedin_messages ?? "—",
      latest: latestCreatedAt(latest?.linkedin_messages ?? []),
      sample: (latest?.linkedin_messages ?? []).slice(0, 3),
    },
    {
      label: "Senders",
      count: counts?.senders ?? "—",
      latest: latestCreatedAt(latest?.senders ?? []),
      sample: (latest?.senders ?? []).slice(0, 3),
    },
  ];
});
</script>

<template>
  <div class="sync-page">
    <!-- Credentials (when project selected) -->
    <NCollapse v-if="selectedProject" display-directive="show">
      <NCollapseItem name="credentials">
        <template #header>
          <div class="collapse-header">
            <KeyIcon :size="15" />
            <span>API Credentials</span>
            <NTag v-if="selectedProject.api_key_set" type="success" size="small" round>Key set</NTag>
            <NTag v-else type="error" size="small" round>No key</NTag>
          </div>
        </template>
        <div class="credentials-form">
          <div class="form-row">
            <label class="form-label">Base URL</label>
            <NInput
              v-model:value="credBaseUrl"
              placeholder="https://api.example.com"
              clearable
            />
          </div>
          <div class="form-row">
            <label class="form-label">API Key</label>
            <NInput
              v-model:value="credApiKey"
              :type="showApiKey ? 'text' : 'password'"
              placeholder="Enter new API key (leave blank to keep existing)"
              clearable
            >
              <template #suffix>
                <NButton text size="tiny" @click="showApiKey = !showApiKey">
                  <EyeIcon v-if="!showApiKey" :size="14" />
                  <EyeOffIcon v-else :size="14" />
                </NButton>
              </template>
            </NInput>
          </div>
          <NButton
            type="primary"
            :loading="savingCreds"
            :disabled="!credApiKey.trim() && !credBaseUrl.trim()"
            @click="saveCredentials"
          >
            Save Credentials
          </NButton>
        </div>
      </NCollapseItem>
    </NCollapse>

    <!-- Pre-Sync Check Panel -->
    <NCard v-if="selectedProject" class="section">
      <template #header>
        <div class="card-header-row">
          <span class="section-title">Pre-Sync Check</span>
          <NButton size="small" quaternary :loading="preflightLoading" @click="loadPreflight">
            <RefreshCwIcon :size="13" />
            &nbsp;Refresh
          </NButton>
        </div>
      </template>

      <NAlert v-if="!selectedProject.api_key_set" type="warning" class="mb" :show-icon="true">
        <template #icon><AlertTriangleIcon :size="16" /></template>
        No API key configured for this project. Sync will fall back to environment variables.
      </NAlert>

      <NAlert v-if="preflightError" type="error" class="mb">{{ preflightError }}</NAlert>

      <NSpin :show="preflightLoading">
        <div v-if="preflight" class="preflight-table">
          <table class="data-table">
            <thead>
              <tr>
                <th>Table</th>
                <th class="num">Rows</th>
                <th>Latest Created At</th>
                <th>Sample (latest 3)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in preflightRows" :key="row.label">
                <td><strong>{{ row.label }}</strong></td>
                <td class="num">{{ row.count }}</td>
                <td class="muted">{{ row.latest }}</td>
                <td>
                  <div class="sample-rows">
                    <NTooltip
                      v-for="(s, i) in row.sample"
                      :key="i"
                      :delay="200"
                      style="max-width: 400px"
                    >
                      <template #trigger>
                        <span class="sample-pill">row {{ i + 1 }}</span>
                      </template>
                      <pre class="sample-json">{{ JSON.stringify(s, null, 2) }}</pre>
                    </NTooltip>
                    <span v-if="!row.sample.length" class="muted">—</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="preflight.countsError" class="muted hint">Counts error: {{ preflight.countsError }}</div>
          <div v-if="preflight.latestError" class="muted hint">Latest rows error: {{ preflight.latestError }}</div>
        </div>
        <div v-else-if="!preflightLoading" class="muted hint">Select a project to run preflight check.</div>
      </NSpin>
    </NCard>

    <!-- Sync Control -->
    <NCard v-if="selectedProject" class="section">
      <template #header>
        <span class="section-title">Sync Control</span>
      </template>

      <div class="sync-control">
        <div class="sync-status">
          <template v-if="syncing">
            <NSpin :size="16" />
            <NText>Syncing project <strong>{{ selectedProject.name }}</strong> — {{ elapsedLabel }}</NText>
          </template>
          <template v-else-if="anotherSyncRunning">
            <AlertTriangleIcon :size="16" class="warn-icon" />
            <NText>Another sync is running (run ID: {{ activeSyncRun?.id?.slice(0, 8) }}…)</NText>
          </template>
          <template v-else-if="thisSyncRunning">
            <NSpin :size="16" />
            <NText>Sync is running for this project</NText>
          </template>
          <template v-else-if="syncComplete">
            <CheckCircle2Icon :size="16" class="success-icon" />
            <NText>Sync complete</NText>
          </template>
          <template v-else>
            <span class="idle-dot" />
            <NText depth="3">Idle</NText>
          </template>
        </div>

        <NButton
          type="primary"
          :disabled="!canSync"
          :loading="syncing"
          size="large"
          @click="startSync"
        >
          <template #icon><PlayIcon :size="15" /></template>
          Start Sync
        </NButton>
      </div>

      <div v-if="!selectedProject.api_key_set && !syncing" class="muted hint" style="margin-top:.5rem">
        API key not set — configure credentials above before syncing.
      </div>
    </NCard>

    <!-- Real-Time Log Panel -->
    <NCard v-if="showLogPanel" class="section log-card">
      <template #header>
        <div class="card-header-row">
          <span class="section-title">Sync Log</span>
          <div v-if="logEntries.length > 0" class="progress-summary">
            <NTag size="small" type="info">Contacts: {{ progress.contacts }}</NTag>
            <NTag size="small" type="info">Messages: {{ progress.linkedin_messages }}</NTag>
            <NTag size="small" type="info">Senders: {{ progress.senders }}</NTag>
          </div>
        </div>
      </template>
      <div ref="logPanelEl" class="log-panel">
        <div v-if="syncing && logEntries.length === 0" class="log-waiting">
          <NSpin :size="18" />
          <span>Waiting for log entries…</span>
        </div>
        <div
          v-for="(entry, i) in logEntries"
          :key="i"
          :class="['log-entry', `log-${entry.level}`, entry.kind === 'upsert' ? 'log-upsert' : '']"
        >
          <span class="log-time">{{ new Date(entry.created_at).toLocaleTimeString() }}</span>
          <span :class="['log-badge', `log-badge-${entry.level}`, entry.kind === 'upsert' ? 'log-badge-upsert' : '']">
            {{ entry.kind === "upsert" ? "UPSERT" : entry.level.toUpperCase() }}
          </span>
          <span v-if="entry.table_name" class="log-table">{{ entry.table_name }}</span>
          <span class="log-msg">{{ entry.message }}</span>
          <span v-if="entry.row_count != null" class="log-rows">({{ entry.row_count }} rows)</span>
        </div>
      </div>
    </NCard>

    <!-- Sync History -->
    <NCard v-if="selectedProject" class="section">
      <template #header>
        <div class="card-header-row">
          <div class="card-header-left">
            <HistoryIcon :size="15" />
            <span class="section-title">Sync History</span>
          </div>
          <NButton size="small" quaternary :loading="historyLoading" @click="loadHistory">
            <RefreshCwIcon :size="13" />
            &nbsp;Refresh
          </NButton>
        </div>
      </template>

      <NSpin :show="historyLoading">
        <NDataTable
          v-if="history.length > 0"
          :columns="historyColumns"
          :data="history"
          :row-key="(row: SyncRun) => row.id"
          size="small"
          :bordered="false"
          :single-line="false"
        />
        <div v-else-if="!historyLoading" class="muted hint">
          No sync history for this project yet.
        </div>
      </NSpin>
    </NCard>
  </div>
</template>

<style scoped>
.sync-page {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.section {
  border-radius: 12px;
}

.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
}

.card-header-left {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.section-title {
  font-weight: 600;
  font-size: 0.95rem;
}

.collapse-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
}

.muted {
  opacity: 0.6;
}

.hint {
  font-size: 0.85rem;
  padding: 0.5rem 0;
}

.no-project {
  padding: 2rem 0;
  text-align: center;
  font-size: 1rem;
}

.mb {
  margin-bottom: 1rem;
}

/* Credentials form */
.credentials-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.25rem 0;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.form-label {
  min-width: 80px;
  font-size: 0.875rem;
  opacity: 0.8;
}

/* Preflight table */
.preflight-table {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.data-table th {
  text-align: left;
  padding: 0.5rem 0.75rem;
  opacity: 0.7;
  font-weight: 500;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

.data-table td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid rgba(128, 128, 128, 0.1);
  vertical-align: top;
}

.data-table .num {
  text-align: right;
}

.sample-rows {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.sample-pill {
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.15);
  font-size: 0.78rem;
  cursor: pointer;
  transition: background 0.15s;
}

.sample-pill:hover {
  background: rgba(128, 128, 128, 0.3);
}

.sample-json {
  font-size: 0.75rem;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Sync control */
.sync-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.sync-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.idle-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(128, 128, 128, 0.4);
  flex-shrink: 0;
}

.success-icon {
  color: #18a058;
}

.warn-icon {
  color: #f0a020;
}

/* Log panel */
.log-card :deep(.n-card__content) {
  padding: 0;
}

.log-panel {
  height: 380px;
  overflow-y: auto;
  font-family: "Menlo", "Consolas", monospace;
  font-size: 0.78rem;
  padding: 0.5rem 0;
}

.log-waiting {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem 1rem;
  opacity: 0.6;
}

.log-entry {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  padding: 2px 1rem;
  line-height: 1.6;
  transition: background 0.1s;
}

.log-entry:hover {
  background: rgba(128, 128, 128, 0.08);
}

.log-entry.log-error {
  color: #e88080;
}

.log-entry.log-upsert {
  color: #78c89a;
}

.log-time {
  opacity: 0.5;
  flex-shrink: 0;
  font-size: 0.72rem;
}

.log-badge {
  display: inline-block;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.log-badge-info {
  background: rgba(99, 99, 230, 0.2);
  color: #9090f0;
}

.log-badge-error {
  background: rgba(208, 48, 80, 0.2);
  color: #e88080;
}

.log-badge-upsert {
  background: rgba(24, 160, 88, 0.2);
  color: #78c89a;
}

.log-table {
  opacity: 0.6;
  font-size: 0.72rem;
  flex-shrink: 0;
}

.log-msg {
  flex: 1;
  word-break: break-word;
}

.log-rows {
  opacity: 0.6;
  flex-shrink: 0;
}

/* Progress summary */
.progress-summary {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

/* History expanded log */
:deep(.log-expand) {
  padding: 0.5rem 1rem;
  font-family: "Menlo", "Consolas", monospace;
  font-size: 0.77rem;
  max-height: 300px;
  overflow-y: auto;
}

:deep(.log-expand .log-entry) {
  display: flex;
  gap: 0.4rem;
  align-items: baseline;
  padding: 1px 0;
  line-height: 1.5;
}

:deep(.log-expand .log-entry.log-error) { color: #e88080; }
:deep(.log-expand .log-entry.log-upsert) { color: #78c89a; }

:deep(.log-expand .log-time) { opacity: 0.5; font-size: 0.7rem; flex-shrink: 0; }
:deep(.log-expand .log-badge) {
  padding: 0 4px;
  border-radius: 3px;
  font-size: 0.65rem;
  font-weight: 700;
  flex-shrink: 0;
}
:deep(.log-expand .log-badge-info) { background: rgba(99,99,230,.2); color: #9090f0; }
:deep(.log-expand .log-badge-error) { background: rgba(208,48,80,.2); color: #e88080; }
:deep(.log-expand .log-badge-upsert) { background: rgba(24,160,88,.2); color: #78c89a; }
:deep(.log-expand .log-table) { opacity: .6; font-size: .7rem; flex-shrink: 0; }
:deep(.log-expand .log-msg) { flex: 1; word-break: break-word; }
:deep(.log-expand .log-rows) { opacity: .6; flex-shrink: 0; }
</style>
