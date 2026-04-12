<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, h } from "vue";
import {
  NCard, NButton, NInput, NAlert, NSpin, NTag,
  NCollapse, NCollapseItem, NDataTable, NText, NTooltip,
  NDatePicker, NCheckbox,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import {
  CheckCircle2Icon, AlertTriangleIcon, RefreshCwIcon,
  PlayIcon, SquareStopIcon, KeyIcon, EyeIcon, EyeOffIcon, HistoryIcon,
} from "lucide-vue-next";
import type {
  SyncRun, PreflightResult, SyncWsMessage, SyncLogEntry, SyncEntityKey, TableCounts,
} from "../types";
import { ALL_SYNC_ENTITY_KEYS, defaultSyncEntitySelection } from "../types";
import { SYNC_ENTITY_LABELS } from "../sync-entities";
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
const testingSourceApi = ref(false);

const preflight = ref<PreflightResult | null>(null);
const preflightLoading = ref(false);
const preflightError = ref("");

const syncing = ref(false);
const activeRunId = ref<string | null>(null);
const elapsedSeconds = ref(0);
const syncComplete = ref(false);
const logEntries = ref<SyncLogEntry[]>([]);
const logPanelEl = ref<HTMLElement | null>(null);
const progress = ref({
  companies: 0,
  contacts: 0,
  linkedin_messages: 0,
  senders: 0,
  contact_lists: 0,
  getsales_tags: 0,
  pipeline_stages: 0,
  flows: 0,
  flow_leads: 0,
});

/** Checked entity keys for the next sync (server adds FK dependencies automatically). */
const syncEntitiesSelected = ref<Record<SyncEntityKey, boolean>>(defaultSyncEntitySelection());

const selectedSyncEntityKeys = computed(() =>
  ALL_SYNC_ENTITY_KEYS.filter((k) => syncEntitiesSelected.value[k])
);

const historyLoading = ref(false);
const history = ref<SyncRun[]>([]);

const analyticsCollectedDays = ref<string[]>([]);
const analyticsDaysLoading = ref(false);
const analyticsSyncLoading = ref(false);
const analyticsDateRange = ref<[number, number] | null>(null);

/** Optional inclusive local calendar range for GetSales partitioned list sync (contacts, companies). */
const syncPipelineDateRange = ref<[number, number] | null>(null);

/** YYYY-MM-DD in local calendar (matches GetSales day boundaries UX). */
function toLocalYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function enumerateLocalYmdInclusive(startMs: number, endMs: number): string[] {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const out: string[] = [];
  while (cur.getTime() <= endDay.getTime()) {
    out.push(toLocalYmd(cur.getTime()));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

const sortedCollectedDays = computed(() =>
  [...analyticsCollectedDays.value].sort((a, b) => a.localeCompare(b))
);

const collectedDaySet = computed(() => new Set(analyticsCollectedDays.value));

/** Popover host id so the analytics daterange panel teleports into a known subtree for highlighting. */
const ANALYTICS_DPICKER_HOST_ID = "mcp-analytics-dpicker-popover-host";

const analyticsDatePickerOpen = ref(false);
const analyticsCalMutationObserver = ref<MutationObserver | null>(null);
let analyticsCalHighlightRaf = 0;

function disconnectAnalyticsCalObserver() {
  analyticsCalMutationObserver.value?.disconnect();
  analyticsCalMutationObserver.value = null;
}

/** Parse "April 2026" / localized month + year from the date panel header. */
function parseMonthYearFromPanelHeader(headerText: string): { year: number; monthIndex: number } | null {
  const yearRe = new RegExp("\\b(20\\d{2})\\b");
  const yMatch = headerText.match(yearRe);
  if (!yMatch) return null;
  const year = parseInt(yMatch[1], 10);
  const withoutYear = headerText.replace(yearRe, " ").trim();
  const normalized = withoutYear.replace(new RegExp("\\s+", "g"), " ").toLowerCase();
  for (let i = 0; i < 12; i++) {
    const d = new Date(2000, i, 15);
    const longM = d.toLocaleString(undefined, { month: "long" }).toLowerCase();
    const shortM = d.toLocaleString(undefined, { month: "short" }).toLowerCase();
    if (normalized.includes(longM) || normalized.includes(shortM)) {
      return { year, monthIndex: i };
    }
  }
  return null;
}

function dayNumberFromDatePanelCell(cell: Element): number | null {
  for (const n of cell.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.textContent?.trim() ?? "";
      const d = parseInt(t, 10);
      if (!Number.isNaN(d) && d >= 1 && d <= 31) return d;
    }
  }
  const raw = cell.textContent?.trim() ?? "";
  const m = raw.match(new RegExp("\\d{1,2}"));
  if (!m) return null;
  const d = parseInt(m[0], 10);
  return !Number.isNaN(d) && d >= 1 && d <= 31 ? d : null;
}

function applyAnalyticsSyncedCalendarHighlights() {
  const host = document.getElementById(ANALYTICS_DPICKER_HOST_ID);
  if (!host) return;
  const panel = host.querySelector(".n-date-panel--daterange");
  if (!panel) return;
  const synced = collectedDaySet.value;
  const calendars = panel.querySelectorAll(".n-date-panel-calendar");
  calendars.forEach((cal) => {
    const headerText = cal.querySelector(".n-date-panel-month__text")?.textContent?.trim() ?? "";
    const ym = parseMonthYearFromPanelHeader(headerText);
    if (!ym) return;
    const { year, monthIndex } = ym;
    const mm = String(monthIndex + 1).padStart(2, "0");
    cal.querySelectorAll(".n-date-panel-date[data-n-date]").forEach((el) => {
      el.classList.remove("analytics-cal-day-synced");
      if (el.classList.contains("n-date-panel-date--excluded")) return;
      const dayNum = dayNumberFromDatePanelCell(el);
      if (dayNum == null) return;
      const dd = String(dayNum).padStart(2, "0");
      const ymd = `${year}-${mm}-${dd}`;
      if (synced.has(ymd)) el.classList.add("analytics-cal-day-synced");
    });
  });
}

function scheduleAnalyticsSyncedCalendarHighlights() {
  cancelAnimationFrame(analyticsCalHighlightRaf);
  analyticsCalHighlightRaf = requestAnimationFrame(() => {
    analyticsCalHighlightRaf = 0;
    applyAnalyticsSyncedCalendarHighlights();
  });
}

function onAnalyticsDatePickerUpdateShow(show: boolean) {
  analyticsDatePickerOpen.value = show;
  disconnectAnalyticsCalObserver();
  if (!show) return;
  nextTick(() => {
    scheduleAnalyticsSyncedCalendarHighlights();
    const host = document.getElementById(ANALYTICS_DPICKER_HOST_ID);
    const panel = host?.querySelector(".n-date-panel--daterange");
    if (!panel) return;
    const mo = new MutationObserver(() => scheduleAnalyticsSyncedCalendarHighlights());
    mo.observe(panel, { subtree: true, childList: true, characterData: true, attributes: true });
    analyticsCalMutationObserver.value = mo;
  });
}

watch(analyticsCollectedDays, () => {
  if (analyticsDatePickerOpen.value) scheduleAnalyticsSyncedCalendarHighlights();
});

/** When a range is selected: how many days are new vs already stored. */
const analyticsRangeStats = computed(() => {
  const r = analyticsDateRange.value;
  if (!r) return null;
  const [a, b] = r;
  const days = enumerateLocalYmdInclusive(a, b);
  let already = 0;
  for (const d of days) {
    if (collectedDaySet.value.has(d)) already++;
  }
  return {
    total: days.length,
    alreadyCollected: already,
    toFetch: days.length - already,
  };
});

const syncPipelineShortcuts: Record<string, () => [number, number]> = {
  "Last 30 days": () => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const e = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    return [s, e];
  },
  "Last year": () => {
    const end = new Date();
    const start = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate());
    const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const e = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    return [s, e];
  },
};

const analyticsShortcuts: Record<string, () => [number, number]> = {
  "Last 7 days": () => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const e = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    return [s, e];
  },
  "Last 30 days": () => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const e = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    return [s, e];
  },
};

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

/** Run id for cancel API: local session, or preflight when sync runs without this tab having started it (refresh / other tab). */
const cancelSyncRunId = computed(() => {
  if (activeRunId.value) return activeRunId.value;
  if (thisSyncRunning.value && activeSyncRun.value?.id) return activeSyncRun.value.id;
  return null;
});

const showStopSync = computed(() => cancelSyncRunId.value != null);

const canSync = computed(() => {
  if (!selectedProject.value) return false;
  if (!selectedProject.value.api_key_set) return false;
  if (syncing.value) return false;
  if (activeSyncRun.value != null) return false;
  if (selectedSyncEntityKeys.value.length === 0) return false;
  return true;
});

/** Test uses form values when present, otherwise saved project / env credentials. */
const canTestSourceApi = computed(() => {
  if (!selectedProject.value) return false;
  const hasBase = !!(credBaseUrl.value.trim() || selectedProject.value.source_api_base_url);
  const hasKey = !!(credApiKey.value.trim() || selectedProject.value.api_key_set);
  return hasBase && hasKey;
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

/** Latest activity from created_at / updated_at (for flows & contact lists). */
function latestTimestamp(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "—";
  const times: number[] = [];
  for (const r of rows) {
    const c = r.created_at;
    const u = r.updated_at;
    if (typeof c === "string") times.push(new Date(c).getTime());
    if (typeof u === "string") times.push(new Date(u).getTime());
  }
  if (!times.length) return "—";
  return new Date(Math.max(...times)).toLocaleString();
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

async function testSourceApiConnection() {
  if (!selectedProjectId.value) return;
  testingSourceApi.value = true;
  try {
    const body: { projectId: string; baseUrl?: string; apiKey?: string } = {
      projectId: selectedProjectId.value,
    };
    const bu = credBaseUrl.value.trim();
    if (bu) body.baseUrl = bu;
    const ak = credApiKey.value.trim();
    if (ak) body.apiKey = ak;
    const r = await fetch("/api/source-api-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Connection check failed");
    if (data.ok) {
      message.success("GetSales API key is valid");
    } else {
      message.error(data.error ?? "API key check failed");
    }
    await loadPreflight();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Connection check failed");
  } finally {
    testingSourceApi.value = false;
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

async function loadAnalyticsCollectedDays() {
  if (!selectedProjectId.value) return;
  analyticsDaysLoading.value = true;
  try {
    const r = await fetch(`/api/analytics-collected-days?projectId=${encodeURIComponent(selectedProjectId.value)}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Failed to load collected analytics days");
    analyticsCollectedDays.value = data.dates ?? [];
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to load analytics days");
  } finally {
    analyticsDaysLoading.value = false;
  }
}

async function runAnalyticsSync() {
  if (!selectedProjectId.value || !analyticsDateRange.value) return;
  const [start, end] = analyticsDateRange.value;
  const dateFrom = toLocalYmd(start);
  const dateTo = toLocalYmd(end);
  analyticsSyncLoading.value = true;
  try {
    const r = await fetch("/api/analytics-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: selectedProjectId.value,
        dateFrom,
        dateTo,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Analytics sync failed");
    const synced = (data.daysSynced as string[] | undefined)?.length ?? 0;
    const skipped = (data.daysSkippedAlreadyCollected as string[] | undefined)?.length ?? 0;
    const errs = (data.errors as string[] | undefined) ?? [];
    if (errs.length > 0) {
      message.warning(`Analytics sync finished with ${errs.length} issue(s); ${synced} day(s) synced, ${skipped} skipped (already had data).`);
    } else {
      message.success(`Analytics: ${synced} day(s) synced, ${skipped} skipped (already collected).`);
    }
    await loadAnalyticsCollectedDays();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Analytics sync failed");
  } finally {
    analyticsSyncLoading.value = false;
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
        if (t.includes("compan")) progress.value.companies += event.entry.row_count;
        else if (t.includes("contactlist")) progress.value.contact_lists += event.entry.row_count;
        else if (t.includes("getsalestag")) progress.value.getsales_tags += event.entry.row_count;
        else if (t.includes("pipelinestage")) progress.value.pipeline_stages += event.entry.row_count;
        else if (t.includes("flowlead")) progress.value.flow_leads += event.entry.row_count;
        else if (t.includes("flow")) progress.value.flows += event.entry.row_count;
        else if (t.includes("contact")) progress.value.contacts += event.entry.row_count;
        else if (t.includes("linkedin") || t.includes("message")) progress.value.linkedin_messages += event.entry.row_count;
        else if (t.includes("sender")) progress.value.senders += event.entry.row_count;
      }
      scrollLog();
    } else if (event.type === "complete") {
      syncComplete.value = true;
      syncing.value = false;
      activeRunId.value = null;
      stopElapsed();
      const res = event.result as { cancelled?: boolean };
      if (res.cancelled) {
        message.warning("Sync stopped.");
      } else {
        message.success("Sync completed!");
      }
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

async function stopSync() {
  const runId = cancelSyncRunId.value;
  if (!runId) return;
  try {
    const r = await fetch("/api/supabase-sync-cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Failed to request stop");
    if (data.staleLockCleared) {
      message.success("Stale sync cleared — it was not running on the server anymore.");
      syncing.value = false;
      activeRunId.value = null;
      stopElapsed();
    } else if (data.mode === "noop") {
      message.info("That run was already finished.");
      syncing.value = false;
      activeRunId.value = null;
      stopElapsed();
    } else {
      message.info("Stop requested — sync will finish after the current API page.");
    }
    await loadPreflight();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Stop failed");
  }
}

async function startSync() {
  if (!selectedProjectId.value) return;
  syncing.value = true;
  syncComplete.value = false;
  logEntries.value = [];
  progress.value = {
    companies: 0,
    contacts: 0,
    linkedin_messages: 0,
    senders: 0,
    contact_lists: 0,
    getsales_tags: 0,
    pipeline_stages: 0,
    flows: 0,
    flow_leads: 0,
  };
  elapsedSeconds.value = 0;
  try {
    const payload: {
      projectId: string;
      entities: SyncEntityKey[];
      syncDateRange?: { from: string; to: string };
    } = {
      projectId: selectedProjectId.value,
      entities: selectedSyncEntityKeys.value,
    };
    const dr = syncPipelineDateRange.value;
    if (dr) {
      payload.syncDateRange = {
        from: toLocalYmd(dr[0]),
        to: toLocalYmd(dr[1]),
      };
    }
    const r = await fetch("/api/supabase-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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

/** Pretty-print sync log `data` (GetSales request/response, Supabase errors). */
function formatLogData(data: Record<string, unknown> | null | undefined): string {
  if (data == null) return "";
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

// --- Watch ---
watch(selectedProjectId, async (id) => {
  preflight.value = null;
  history.value = [];
  logEntries.value = [];
  syncComplete.value = false;
  syncEntitiesSelected.value = defaultSyncEntitySelection();
  syncPipelineDateRange.value = null;
  analyticsCollectedDays.value = [];
  analyticsDateRange.value = null;
  if (!id) return;
  credBaseUrl.value = projectStore.selectedProject?.source_api_base_url ?? "";
  credApiKey.value = "";
  await Promise.all([loadPreflight(), loadHistory(), loadAnalyticsCollectedDays()]);
});

onMounted(async () => {
  if (selectedProjectId.value) {
    credBaseUrl.value = projectStore.selectedProject?.source_api_base_url ?? "";
    await Promise.all([loadPreflight(), loadHistory(), loadAnalyticsCollectedDays()]);
  }
});
onUnmounted(() => {
  if (ws) ws.close();
  stopElapsed();
  disconnectAnalyticsCalObserver();
  cancelAnimationFrame(analyticsCalHighlightRaf);
});

function formatCompaniesPreflightCounts(counts: TableCounts | null | undefined): string {
  if (!counts) return "—";
  const all = counts.companies ?? 0;
  const inn = counts.companies_in_project;
  if (typeof inn === "number") {
    return `${inn.toLocaleString()} in project · ${all.toLocaleString()} all`;
  }
  return all.toLocaleString();
}

// --- History table columns ---
const historyColumns = computed<DataTableColumns<SyncRun>>(() => [
  {
    type: "expand",
    expandable: (row) => row.log_entries.length > 0,
    renderExpand(row) {
      return h("div", { class: "log-expand" }, [
        ...row.log_entries.map((e) =>
          h("div", { class: ["log-entry", `log-${e.level}`, e.data ? "log-entry-with-data" : ""].join(" ") }, [
            h("span", { class: "log-time" }, new Date(e.created_at).toLocaleTimeString()),
            h("span", { class: `log-badge log-badge-${e.level}` }, e.level.toUpperCase()),
            e.table_name ? h("span", { class: "log-table" }, e.table_name) : null,
            h("span", { class: "log-msg" }, e.message),
            e.row_count != null ? h("span", { class: "log-rows" }, `(${e.row_count} rows)`) : null,
            e.data && e.level === "error"
              ? h("pre", { class: "log-data-json" }, formatLogData(e.data))
              : null,
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
        cancelled: "warning",
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
      label: "Companies",
      count: formatCompaniesPreflightCounts(counts),
      latest: latestCreatedAt(latest?.companies ?? []),
      sample: (latest?.companies ?? []).slice(0, 3),
    },
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
    {
      label: "Contact lists",
      count: counts?.contact_lists ?? "—",
      latest: latestTimestamp(latest?.contact_lists ?? []),
      sample: (latest?.contact_lists ?? []).slice(0, 3),
    },
    {
      label: "GetSales tags",
      count: counts?.getsales_tags ?? "—",
      latest: latestTimestamp(latest?.getsales_tags ?? []),
      sample: (latest?.getsales_tags ?? []).slice(0, 3),
    },
    {
      label: "Pipeline stages",
      count: counts?.pipeline_stages ?? "—",
      latest: latestTimestamp(latest?.pipeline_stages ?? []),
      sample: (latest?.pipeline_stages ?? []).slice(0, 3),
    },
    {
      label: "Flows",
      count: counts?.flows ?? "—",
      latest: latestTimestamp(latest?.flows ?? []),
      sample: (latest?.flows ?? []).slice(0, 3),
    },
    {
      label: "Flow leads",
      count: counts?.flow_leads ?? "—",
      latest: latestCreatedAt(latest?.flow_leads ?? []),
      sample: (latest?.flow_leads ?? []).slice(0, 3),
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
          <div class="credentials-actions">
            <NButton
              type="primary"
              :loading="savingCreds"
              :disabled="!credApiKey.trim() && !credBaseUrl.trim()"
              @click="saveCredentials"
            >
              Save Credentials
            </NButton>
            <NButton
              secondary
              :loading="testingSourceApi"
              :disabled="!canTestSourceApi"
              @click="testSourceApiConnection"
            >
              Test connection
            </NButton>
          </div>
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

      <NAlert
        v-if="preflight?.sourceApiCheck && !preflight.sourceApiCheck.ok"
        type="error"
        class="mb"
        :show-icon="true"
      >
        GetSales API check failed: {{ preflight.sourceApiCheck.error ?? "Unknown error" }}
      </NAlert>
      <NAlert
        v-else-if="preflight?.sourceApiCheck?.ok"
        type="success"
        class="mb"
        :show-icon="true"
      >
        GetSales API is reachable (GET /flows/api/flows?limit=1).
      </NAlert>

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
        <div class="sync-control-row">
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

          <div class="sync-actions">
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
            <NButton
              v-if="showStopSync"
              secondary
              type="error"
              size="large"
              @click="stopSync"
            >
              <template #icon><SquareStopIcon :size="15" /></template>
              Stop sync
            </NButton>
          </div>
        </div>

        <div class="sync-entities">
          <div class="sync-entities-header">
            <span class="form-label">Tables to sync</span>
          </div>
          <div class="entity-checkboxes">
            <NCheckbox
              v-for="key in ALL_SYNC_ENTITY_KEYS"
              :key="key"
              v-model:checked="syncEntitiesSelected[key]"
            >
              {{ SYNC_ENTITY_LABELS[key] }}
            </NCheckbox>
          </div>
          <p class="muted hint entity-sync-hint">
            Only checked tables are requested. The server may also sync prerequisite tables (for example:
            Contacts includes Companies; LinkedIn messages include Contacts and Senders; Flow leads include Flows).
          </p>
          <div class="sync-pipeline-date-row">
            <span class="form-label">List sync date range</span>
            <NDatePicker
              v-model:value="syncPipelineDateRange"
              type="daterange"
              clearable
              :shortcuts="syncPipelineShortcuts"
              :disabled="syncing"
            />
          </div>
          <p class="muted hint entity-sync-hint">
            Optional. Narrows <strong>contacts</strong> and <strong>companies</strong> to <code>created_at</code> /
            <code>updated_at</code> buckets so GetSales can paginate past 10k rows. Leave empty for automatic
            month-by-month backfill from today. <strong>Flow leads</strong> always sync with a full list + incremental
            cursor (no server date filter on that endpoint).
          </p>
        </div>
      </div>

      <div v-if="!selectedProject.api_key_set && !syncing" class="muted hint" style="margin-top:.5rem">
        API key not set — configure credentials above before syncing.
      </div>
    </NCard>

    <!-- Analytics snapshots (GetSales metrics API) -->
    <NCard v-if="selectedProject" class="section">
      <template #header>
        <div class="card-header-row">
          <span class="section-title">Analytics snapshots</span>
          <NButton size="small" quaternary :loading="analyticsDaysLoading" @click="loadAnalyticsCollectedDays">
            <RefreshCwIcon :size="13" />
            &nbsp;Refresh days
          </NButton>
        </div>
      </template>
      <p class="muted hint" style="margin: 0 0 0.75rem">
        Separate from <strong>Start Sync</strong> (contacts, messages, senders, contact lists, flows, flow leads). This only fills
        <code>AnalyticsSnapshots</code> via
        <code>POST /leads/api/leads/metrics</code>. Days already stored are skipped.
      </p>
      <NSpin :show="analyticsDaysLoading">
        <div class="analytics-row analytics-row-dpicker">
          <span class="form-label">Date range</span>
          <!-- Teleport target for the daterange panel (scoped DOM for synced-day highlighting). -->
          <div
            :id="ANALYTICS_DPICKER_HOST_ID"
            class="analytics-dpicker-host"
            aria-hidden="true"
          />
          <NDatePicker
            v-model:value="analyticsDateRange"
            type="daterange"
            clearable
            :shortcuts="analyticsShortcuts"
            :disabled="analyticsSyncLoading"
            :to="'#' + ANALYTICS_DPICKER_HOST_ID"
            class="analytics-snapshots-daterange"
            @update:show="onAnalyticsDatePickerUpdateShow"
          />
          <NButton
            type="primary"
            :loading="analyticsSyncLoading"
            :disabled="!analyticsDateRange"
            @click="runAnalyticsSync"
          >
            Sync analytics
          </NButton>
        </div>
        <p v-if="analyticsRangeStats && analyticsDateRange" class="muted hint analytics-range-hint">
          In selected range: {{ analyticsRangeStats.total }} day(s) —
          {{ analyticsRangeStats.alreadyCollected }} already collected,
          {{ analyticsRangeStats.toFetch }} would be fetched (if not yet stored).
        </p>
        <div v-if="!selectedProject.api_key_set" class="muted hint" style="margin-top: 0.5rem">
          No project API key — the server will use environment credentials if configured.
        </div>
        <p class="muted hint analytics-cal-legend" style="margin: 0.35rem 0 0">
          In the date picker, days that already have analytics data are highlighted in green.
        </p>
        <div class="analytics-days" style="margin-top: 0.75rem">
          <span class="muted" style="font-size: 0.85rem">Days already in database</span>
          <span v-if="sortedCollectedDays.length" class="muted" style="font-size: 0.85rem">
            ({{ sortedCollectedDays.length }})
          </span>
          <span class="muted" style="font-size: 0.85rem">:</span>
          <div v-if="sortedCollectedDays.length" class="analytics-day-chips">
            <NTag
              v-for="d in sortedCollectedDays"
              :key="d"
              size="small"
              round
              type="success"
              :bordered="false"
            >
              {{ d }}
            </NTag>
          </div>
          <p v-else-if="!analyticsDaysLoading" class="muted hint" style="margin: 0.35rem 0 0">
            None yet — pick a range and sync.
          </p>
        </div>
      </NSpin>
    </NCard>

    <!-- Real-Time Log Panel -->
    <NCard v-if="showLogPanel" class="section log-card">
      <template #header>
        <div class="card-header-row">
          <span class="section-title">Sync Log</span>
          <div v-if="logEntries.length > 0" class="progress-summary">
            <NTag size="small" type="info">Companies: {{ progress.companies }}</NTag>
            <NTag size="small" type="info">Contacts: {{ progress.contacts }}</NTag>
            <NTag size="small" type="info">Messages: {{ progress.linkedin_messages }}</NTag>
            <NTag size="small" type="info">Senders: {{ progress.senders }}</NTag>
            <NTag size="small" type="info">Contact lists: {{ progress.contact_lists }}</NTag>
            <NTag size="small" type="info">GetSales tags: {{ progress.getsales_tags }}</NTag>
            <NTag size="small" type="info">Pipeline stages: {{ progress.pipeline_stages }}</NTag>
            <NTag size="small" type="info">Flows: {{ progress.flows }}</NTag>
            <NTag size="small" type="info">Flow leads: {{ progress.flow_leads }}</NTag>
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
          :class="[
            'log-entry',
            `log-${entry.level}`,
            entry.kind === 'upsert' ? 'log-upsert' : '',
            entry.data ? 'log-entry-with-data' : '',
          ]"
        >
          <span class="log-time">{{ new Date(entry.created_at).toLocaleTimeString() }}</span>
          <span :class="['log-badge', `log-badge-${entry.level}`, entry.kind === 'upsert' ? 'log-badge-upsert' : '']">
            {{ entry.kind === "upsert" ? "UPSERT" : entry.level.toUpperCase() }}
          </span>
          <span v-if="entry.table_name" class="log-table">{{ entry.table_name }}</span>
          <span class="log-msg">{{ entry.message }}</span>
          <span v-if="entry.row_count != null" class="log-rows">({{ entry.row_count }} rows)</span>
          <pre
            v-if="entry.level === 'error' && entry.data && Object.keys(entry.data).length > 0"
            class="log-data-json"
          >{{ formatLogData(entry.data) }}</pre>
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

.credentials-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
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
  flex-direction: column;
  align-items: stretch;
  gap: 1rem;
}

.sync-entities {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sync-entities-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.entity-checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.25rem;
  align-items: center;
}

.entity-sync-hint {
  margin: 0;
  max-width: 52rem;
  line-height: 1.45;
}

.sync-control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.sync-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
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

.log-entry.log-entry-with-data {
  flex-wrap: wrap;
  align-items: flex-start;
}

.log-data-json {
  flex: 1 1 100%;
  margin: 0.35rem 0 0 0;
  padding: 0.5rem 0.6rem;
  background: rgba(0, 0, 0, 0.22);
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 360px;
  overflow: auto;
  font-size: 0.72rem;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.9);
}

/* Progress summary */
.progress-summary {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.analytics-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.analytics-row-dpicker {
  position: relative;
}

.analytics-dpicker-host {
  position: absolute;
  width: 0;
  height: 0;
  overflow: visible;
  pointer-events: none;
  left: 0;
  bottom: 0;
}

/* Synced analytics days inside the open daterange panel (class set at runtime). */
:deep(.analytics-dpicker-host .n-date-panel-date.analytics-cal-day-synced) {
  background: rgba(24, 160, 88, 0.32);
  border-radius: 4px;
}

:deep(.analytics-dpicker-host .n-date-panel-date.analytics-cal-day-synced.n-date-panel-date--current) {
  box-shadow: inset 0 0 0 1px rgba(24, 160, 88, 0.65);
}

.sync-pipeline-date-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.analytics-day-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.35rem;
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
:deep(.log-expand .log-data-json) {
  flex: 1 1 100%;
  margin: 0.35rem 0 0 0;
  padding: 0.45rem 0.55rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 280px;
  overflow: auto;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.88);
}
</style>
