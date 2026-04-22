<script setup lang="ts">
import { ref, computed, watch, onMounted, reactive, h } from "vue";
import type { VNode } from "vue";
import {
  NCard,
  NSelect,
  NButton,
  NAlert,
  NSpin,
  NSpace,
  NInputNumber,
  NText,
  NCollapse,
  NCollapseItem,
  NDataTable,
  NDivider,
  NCheckbox,
  NModal,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { RefreshCwIcon, DownloadIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";

interface DifyWorkflowListItem {
  id: string;
  name: string;
  mode: string | null;
  description: string | null;
  infoError: string | null;
}

interface DifyRunRow {
  logId: string;
  runId: string;
  createdAtMs: number;
  finishedAtMs: number | null;
  status: string | null;
  elapsedTime: number | null;
  totalTokens: number | null;
  totalSteps: number | null;
  error: string | null;
  triggeredFrom: string | null;
}

interface RunDetailState {
  loading: boolean;
  /** True after a successful detail HTTP response (outputs may still be null). */
  fetched?: boolean;
  outputs?: unknown;
  inputs?: unknown;
  error?: string;
}

interface LeadInfoState {
  loading?: boolean;
  /** Single-contact GetSales rehydrate in progress (POST /api/contacts/find-by-uuid). */
  rehydrating?: boolean;
  error?: string;
  record?: Record<string, unknown>;
}

type CompanyInfoState = LeadInfoState;

/** Optional CSV columns (result is always appended). */
type OptionalCsvExportKey =
  | "first_name"
  | "last_name"
  | "position"
  | "lead_uuid"
  | "company_name"
  | "domain"
  | "name"
  | "company_uuid";

const OPTIONAL_CSV_KEYS: OptionalCsvExportKey[] = [
  "first_name",
  "last_name",
  "position",
  "lead_uuid",
  "company_name",
  "domain",
  "name",
  "company_uuid",
];

const CSV_HEADER_LABEL: Record<OptionalCsvExportKey, string> = {
  first_name: "first name",
  last_name: "last name",
  position: "position",
  lead_uuid: "lead_uuid",
  company_name: "company_name",
  domain: "domain",
  name: "name",
  company_uuid: "company_uuid",
};

/** Treat string `company_id` as company UUID only when it looks like a UUID. */
const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSucceeded(row: DifyRunRow): boolean {
  return (row.status ?? "").toLowerCase() === "succeeded";
}

/** Walk nested objects/arrays; return first non-empty `lead_uuid` string. */
function extractLeadUuidFromOutputs(outputs: unknown): string | null {
  if (outputs == null || typeof outputs !== "object") return null;
  const seen = new Set<unknown>();

  function walk(node: unknown): string | null {
    if (node == null || typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const el of node) {
        const u = walk(el);
        if (u) return u;
      }
      return null;
    }
    const o = node as Record<string, unknown>;
    if (typeof o.lead_uuid === "string") {
      const t = o.lead_uuid.trim();
      if (t.length > 0) return t;
    }
    for (const k of Object.keys(o)) {
      const u = walk(o[k]);
      if (u) return u;
    }
    return null;
  }

  return walk(outputs);
}

/** Walk nested objects/arrays; first `company_uuid`, else UUID-shaped `company_id`. */
function extractCompanyUuidFromOutputs(outputs: unknown): string | null {
  if (outputs == null || typeof outputs !== "object") return null;
  const seen = new Set<unknown>();

  function walk(node: unknown): string | null {
    if (node == null || typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const el of node) {
        const u = walk(el);
        if (u) return u;
      }
      return null;
    }
    const o = node as Record<string, unknown>;
    if (typeof o.company_uuid === "string") {
      const t = o.company_uuid.trim();
      if (t.length > 0) return t;
    }
    if (typeof o.company_id === "string") {
      const t = o.company_id.trim();
      if (t.length > 0 && UUID_LIKE.test(t)) return t;
    }
    for (const k of Object.keys(o)) {
      const u = walk(o[k]);
      if (u) return u;
    }
    return null;
  }

  return walk(outputs);
}

function summarizeOutputs(outputs: unknown): string {
  if (outputs == null) return "—";
  if (typeof outputs !== "object") return String(outputs);
  try {
    const s = JSON.stringify(outputs);
    return s.length > 140 ? `${s.slice(0, 140)}…` : s;
  } catch {
    return "…";
  }
}

/** Runs sorted by start time ascending; split when gap ≥ minGapMs; batches ordered newest-first. */
function clusterByMinGap(runs: DifyRunRow[], minGapMs: number): DifyRunRow[][] {
  if (runs.length === 0) return [];
  const sorted = [...runs].sort((a, b) => a.createdAtMs - b.createdAtMs);
  const batches: DifyRunRow[][] = [];
  let cur: DifyRunRow[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const run = sorted[i]!;
    const prev = sorted[i - 1]!;
    const gap = run.createdAtMs - prev.createdAtMs;
    if (gap >= minGapMs) {
      batches.push(cur);
      cur = [run];
    } else {
      cur.push(run);
    }
  }
  batches.push(cur);
  return batches.sort((a, b) => {
    const ta = a[a.length - 1]!.createdAtMs;
    const tb = b[b.length - 1]!.createdAtMs;
    return tb - ta;
  });
}

function suggestMinGapMsFromRuns(runs: DifyRunRow[]): number {
  if (runs.length < 2) return 30 * 60_000;
  const sorted = [...runs].sort((a, b) => a.createdAtMs - b.createdAtMs);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i]!.createdAtMs - sorted[i - 1]!.createdAtMs);
  }
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median =
    gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  return Math.max(Math.round(median * 2), 60_000);
}

const message = useMessage();
const projectStore = useProjectStore();

const workflows = ref<DifyWorkflowListItem[]>([]);
const workflowsLoading = ref(false);
const workflowsError = ref("");

const selectedWorkflowId = ref<string | null>(null);

const runs = ref<DifyRunRow[]>([]);
const runsLoading = ref(false);
const runsMeta = ref({
  pagesFetched: 0,
  truncated: false,
  totalReported: null as number | null,
  warning: "",
});

const onlySucceeded = ref(true);
const minGapMinutes = ref<number>(30);

const detailByRunId = reactive<Record<string, RunDetailState>>({});
const leadInfoByUuid = reactive<Record<string, LeadInfoState>>({});
const companyInfoById = reactive<Record<string, CompanyInfoState>>({});
const batchFetchLoading = reactive<Record<number, boolean>>({});

const exportModalOpen = ref(false);
const exportBatchRuns = ref<DifyRunRow[] | null>(null);
const exportBatchTitle = ref("");
const exportColumnSelection = reactive<Record<OptionalCsvExportKey, boolean>>({
  first_name: true,
  last_name: true,
  position: true,
  lead_uuid: true,
  company_name: true,
  domain: true,
  name: true,
  company_uuid: true,
});

function clearRunDetails(): void {
  for (const k of Object.keys(detailByRunId)) {
    delete detailByRunId[k];
  }
  for (const k of Object.keys(leadInfoByUuid)) {
    delete leadInfoByUuid[k];
  }
  for (const k of Object.keys(companyInfoById)) {
    delete companyInfoById[k];
  }
}

const runsForView = computed(() => {
  let list = [...runs.value];
  if (onlySucceeded.value) {
    list = list.filter((r) => isSucceeded(r));
  } else {
    list.sort((a, b) => {
      const sa = isSucceeded(a) ? 0 : 1;
      const sb = isSucceeded(b) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return a.createdAtMs - b.createdAtMs;
    });
  }
  return list;
});

const batches = computed(() =>
  clusterByMinGap(runsForView.value, Math.max(1000, minGapMinutes.value * 60_000))
);

const workflowOptions = computed(() =>
  workflows.value.map((w) => ({
    label: w.infoError ? `${w.name} (metadata fetch issue)` : w.name,
    value: w.id,
  }))
);

function formatDt(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(ms);
  }
}

function getDetail(row: DifyRunRow): RunDetailState | undefined {
  return detailByRunId[row.runId];
}

function leadUuidForRow(row: DifyRunRow): string | null {
  const d = getDetail(row);
  if (!d?.fetched || d.error) return null;
  return extractLeadUuidFromOutputs(d.outputs);
}

function companyUuidForRow(row: DifyRunRow): string | null {
  const d = getDetail(row);
  if (!d?.fetched || d.error) return null;
  return extractCompanyUuidFromOutputs(d.outputs);
}

async function fetchLeadFromGetSales(leadUuid: string): Promise<void> {
  const pid = projectStore.selectedProjectId;
  if (!pid) {
    message.warning("Select a project in the header first.");
    return;
  }
  const prev = leadInfoByUuid[leadUuid];
  leadInfoByUuid[leadUuid] = {
    ...prev,
    rehydrating: true,
    error: prev?.error,
    record: prev?.record,
  };
  try {
    const r = await fetch("/api/contacts/find-by-uuid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: pid, leadUuid }),
    });
    const j = (await r.json()) as {
      data?: Record<string, unknown>;
      error?: string;
      notFound?: boolean;
    };
    if (!r.ok || j.error) {
      if (j.notFound) {
        leadInfoByUuid[leadUuid] = {
          rehydrating: false,
          error: "GetSales: no contact for this UUID.",
        };
        message.warning("GetSales returned no contact for this UUID.");
      } else {
        leadInfoByUuid[leadUuid] = {
          rehydrating: false,
          error: j.error ?? `HTTP ${r.status}`,
        };
        message.error(j.error ?? "Failed to fetch contact from GetSales.");
      }
      return;
    }
    const rec = j.data ?? null;
    if (rec) {
      leadInfoByUuid[leadUuid] = {
        loading: false,
        rehydrating: false,
        record: rec,
      };
      message.success("Contact loaded from GetSales and saved to the project.");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    leadInfoByUuid[leadUuid] = {
      rehydrating: false,
      error: msg,
    };
    message.error(msg);
  }
}

function formatLeadCell(uuid: string | null): string | VNode {
  if (!uuid) return "—";
  if (!projectStore.selectedProjectId) {
    return h(
      "span",
      { class: "muted", title: "Select a project in the app header" },
      "Pick project"
    );
  }
  const li = leadInfoByUuid[uuid];
  if (li?.loading) return h(NSpin, { size: "small" });
  if (li?.error) {
    return h("div", { class: "lead-cell-with-action" }, [
      h("span", { class: "lead-err", title: li.error }, "Not in DB"),
      h(
        NButton,
        {
          size: "tiny",
          secondary: true,
          loading: li.rehydrating === true,
          disabled: li.rehydrating === true,
          onClick: () => void fetchLeadFromGetSales(uuid),
        },
        { default: () => "Get from GetSales" }
      ),
    ]);
  }
  if (li?.record) {
    const r = li.record;
    const nameRaw =
      (typeof r.name === "string" && r.name.trim()) ||
      [r.first_name, r.last_name].filter((x) => typeof x === "string" && String(x).trim()).join(" ").trim();
    const name = nameRaw || "—";
    const co =
      typeof r.company_name === "string" && r.company_name.trim()
        ? r.company_name.trim()
        : "";
    return co ? `${name} @ ${co}` : name;
  }
  return "—";
}

function formatCompanyCell(companyId: string | null): string | VNode {
  if (!companyId) return "—";
  if (!projectStore.selectedProjectId) {
    return h(
      "span",
      { class: "muted", title: "Select a project in the app header" },
      "Pick project"
    );
  }
  const ci = companyInfoById[companyId];
  if (ci?.loading) return h(NSpin, { size: "small" });
  if (ci?.error) {
    return h("span", { class: "lead-err", title: ci.error }, "Not found");
  }
  if (ci?.record) {
    const r = ci.record;
    const name =
      typeof r.name === "string" && r.name.trim() ? r.name.trim() : "—";
    const domain =
      typeof r.domain === "string" && r.domain.trim() ? r.domain.trim() : "";
    return domain ? `${name} · ${domain}` : name;
  }
  return "—";
}

function collectLeadUuidsFromDetails(): string[] {
  const out: string[] = [];
  for (const d of Object.values(detailByRunId)) {
    if (!d?.fetched || d.error) continue;
    const u = extractLeadUuidFromOutputs(d.outputs);
    if (u) out.push(u);
  }
  return [...new Set(out)];
}

function collectCompanyUuidsFromDetails(): string[] {
  const out: string[] = [];
  for (const d of Object.values(detailByRunId)) {
    if (!d?.fetched || d.error) continue;
    const u = extractCompanyUuidFromOutputs(d.outputs);
    if (u) out.push(u);
  }
  return [...new Set(out)];
}

let hydrateTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleHydrateLookups(): void {
  if (hydrateTimer != null) clearTimeout(hydrateTimer);
  hydrateTimer = setTimeout(() => {
    hydrateTimer = null;
    void hydrateContactCompanyLookups();
  }, 80);
}

async function hydrateContactCompanyLookups(): Promise<void> {
  const pid = projectStore.selectedProjectId;
  if (!pid) return;

  const wantLeads = collectLeadUuidsFromDetails();
  const wantCompanies = collectCompanyUuidsFromDetails();

  const missingLeads = wantLeads.filter(
    (u) =>
      !leadInfoByUuid[u] ||
      (!leadInfoByUuid[u]?.record &&
        !leadInfoByUuid[u]?.error &&
        !leadInfoByUuid[u]?.loading)
  );
  const missingCompanies = wantCompanies.filter(
    (c) =>
      !companyInfoById[c] ||
      (!companyInfoById[c]?.record &&
        !companyInfoById[c]?.error &&
        !companyInfoById[c]?.loading)
  );

  if (!missingLeads.length && !missingCompanies.length) return;

  for (const u of missingLeads) {
    leadInfoByUuid[u] = { loading: true };
  }
  for (const u of missingCompanies) {
    companyInfoById[u] = { loading: true };
  }

  try {
    const r = await fetch("/api/dify/contacts-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: pid,
        uuids: missingLeads,
        companyIds: missingCompanies,
      }),
    });
    const j = (await r.json()) as {
      contacts?: Record<string, Record<string, unknown>>;
      companies?: Record<string, Record<string, unknown>>;
      error?: string;
    };
    if (!r.ok) {
      const msg = j.error ?? `HTTP ${r.status}`;
      for (const u of missingLeads) {
        leadInfoByUuid[u] = { loading: false, error: msg };
      }
      for (const u of missingCompanies) {
        companyInfoById[u] = { loading: false, error: msg };
      }
      return;
    }
    const contactMap = j.contacts ?? {};
    for (const u of missingLeads) {
      const rec = contactMap[u];
      if (rec) {
        leadInfoByUuid[u] = { loading: false, record: rec };
      } else {
        leadInfoByUuid[u] = {
          loading: false,
          error: "No row in Contacts for this project",
        };
      }
    }
    const companyMap = j.companies ?? {};
    for (const u of missingCompanies) {
      const rec = companyMap[u];
      if (rec) {
        companyInfoById[u] = { loading: false, record: rec };
      } else {
        companyInfoById[u] = {
          loading: false,
          error: "No company linked to this project (project_companies)",
        };
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    for (const u of missingLeads) {
      leadInfoByUuid[u] = { loading: false, error: msg };
    }
    for (const u of missingCompanies) {
      companyInfoById[u] = { loading: false, error: msg };
    }
  }
}

async function fetchRunDetail(runId: string): Promise<void> {
  const wid = selectedWorkflowId.value;
  if (wid == null) return;
  detailByRunId[runId] = {
    loading: true,
    fetched: false,
    outputs: detailByRunId[runId]?.outputs,
    inputs: detailByRunId[runId]?.inputs,
  };
  try {
    const r = await fetch(
      `/api/dify/workflows/${encodeURIComponent(wid)}/runs/${encodeURIComponent(runId)}/detail`
    );
    const j = (await r.json()) as {
      outputs?: unknown;
      inputs?: unknown;
      error?: string;
    };
    if (!r.ok) {
      detailByRunId[runId] = {
        loading: false,
        fetched: false,
        error: j.error ?? `HTTP ${r.status}`,
      };
      return;
    }
    detailByRunId[runId] = {
      loading: false,
      fetched: true,
      outputs: j.outputs,
      inputs: j.inputs,
    };
    scheduleHydrateLookups();
  } catch (e) {
    detailByRunId[runId] = {
      loading: false,
      fetched: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function fetchAllResultsForBatch(batch: DifyRunRow[], batchIndex: number): Promise<void> {
  const wid = selectedWorkflowId.value;
  if (wid == null) return;
  const ids = [...new Set(batch.filter((r) => isSucceeded(r)).map((r) => r.runId))];
  if (!ids.length) {
    message.info("No succeeded runs in this batch.");
    return;
  }
  batchFetchLoading[batchIndex] = true;
  for (const id of ids) {
    detailByRunId[id] = { loading: true, fetched: false };
  }
  try {
    const r = await fetch(
      `/api/dify/workflows/${encodeURIComponent(wid)}/runs/batch-detail`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runIds: ids }),
      }
    );
    const j = (await r.json()) as {
      results?: Array<{
        runId: string;
        ok: boolean;
        outputs?: unknown;
        inputs?: unknown;
        error?: string;
      }>;
      truncated?: boolean;
      fetched?: number;
      error?: string;
    };
    if (!r.ok) {
      const msg = j.error ?? `HTTP ${r.status}`;
      for (const id of ids) {
        detailByRunId[id] = { loading: false, fetched: false, error: msg };
      }
      message.error(msg);
      return;
    }
    for (const id of ids) {
      if (!j.results?.some((x) => x.runId === id)) {
        detailByRunId[id] = {
          loading: false,
          fetched: false,
          error: "No result in response",
        };
      }
    }
    for (const item of j.results ?? []) {
      if (item.ok) {
        detailByRunId[item.runId] = {
          loading: false,
          fetched: true,
          outputs: item.outputs,
          inputs: item.inputs,
        };
      } else {
        detailByRunId[item.runId] = {
          loading: false,
          fetched: false,
          error: item.error ?? "Failed",
        };
      }
    }
    if (j.truncated) {
      message.warning(
        `Fetched first ${j.fetched ?? ids.length} run(s) in this batch (server cap).`
      );
    } else {
      message.success(`Loaded ${j.results?.length ?? 0} result(s) in this batch.`);
    }
    scheduleHydrateLookups();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    for (const id of ids) {
      detailByRunId[id] = { loading: false, fetched: false, error: msg };
    }
    message.error(msg);
  } finally {
    batchFetchLoading[batchIndex] = false;
  }
}

const runColumns = computed<DataTableColumns<DifyRunRow>>(() => [
  {
    title: "Started",
    key: "createdAtMs",
    width: 160,
    render: (row) => formatDt(row.createdAtMs),
  },
  { title: "Status", key: "status", width: 96 },
  {
    title: "Elapsed (s)",
    key: "elapsedTime",
    width: 88,
    render: (row) =>
      row.elapsedTime != null ? row.elapsedTime.toFixed(2) : "—",
  },
  { title: "Tokens", key: "totalTokens", width: 68 },
  { title: "Triggered", key: "triggeredFrom", ellipsis: { tooltip: true } },
  {
    title: "Run ID",
    key: "runId",
    width: 100,
    ellipsis: { tooltip: true },
  },
  {
    title: "found_lead_uuid",
    key: "found_lead_uuid",
    width: 120,
    ellipsis: { tooltip: true },
    render: (row) => {
      const u = leadUuidForRow(row);
      return u ?? "—";
    },
  },
  {
    title: "Lead info",
    key: "lead_info",
    minWidth: 160,
    ellipsis: { tooltip: true },
    render: (row) => formatLeadCell(leadUuidForRow(row)),
  },
  {
    title: "found_company_uuid",
    key: "found_company_uuid",
    width: 120,
    ellipsis: { tooltip: true },
    render: (row) => companyUuidForRow(row) ?? "—",
  },
  {
    title: "Company info",
    key: "company_info",
    minWidth: 160,
    ellipsis: { tooltip: true },
    render: (row) => formatCompanyCell(companyUuidForRow(row)),
  },
  {
    title: "Result",
    key: "result",
    minWidth: 200,
    render: (row) => {
      if (!isSucceeded(row)) {
        return h("span", { class: "result-na" }, "—");
      }
      const d = getDetail(row);
      if (d?.loading) {
        return h(NSpin, { size: "small" });
      }
      if (d?.fetched && !d.error) {
        return h(
          "div",
          { class: "result-preview", title: JSON.stringify(d.outputs, null, 2) },
          summarizeOutputs(d.outputs)
        );
      }
      return h(
        NButton,
        {
          size: "tiny",
          secondary: true,
          title: d?.error ?? "Fetch outputs from Dify",
          onClick: () => void fetchRunDetail(row.runId),
        },
        { default: () => "Get result" }
      );
    },
  },
]);

async function loadWorkflows() {
  workflowsLoading.value = true;
  workflowsError.value = "";
  try {
    const r = await fetch("/api/dify/workflows");
    const j = (await r.json()) as {
      workflows?: DifyWorkflowListItem[];
      error?: string;
    };
    if (!r.ok) {
      workflowsError.value = j.error ?? "Failed to load workflows";
      workflows.value = [];
      return;
    }
    workflows.value = j.workflows ?? [];
    if (j.error) workflowsError.value = j.error;
  } catch (e) {
    workflowsError.value = e instanceof Error ? e.message : String(e);
    workflows.value = [];
  } finally {
    workflowsLoading.value = false;
  }
}

async function loadRuns(wid: string) {
  runsLoading.value = true;
  runs.value = [];
  clearRunDetails();
  runsMeta.value = {
    pagesFetched: 0,
    truncated: false,
    totalReported: null,
    warning: "",
  };
  try {
    const r = await fetch(
      `/api/dify/workflows/${encodeURIComponent(wid)}/runs`
    );
    const j = (await r.json()) as {
      runs?: DifyRunRow[];
      pagesFetched?: number;
      truncated?: boolean;
      totalReported?: number | null;
      warning?: string;
      error?: string;
    };
    if (!r.ok) {
      message.error(j.error ?? "Failed to load runs");
      return;
    }
    runs.value = j.runs ?? [];
    runsMeta.value = {
      pagesFetched: j.pagesFetched ?? 0,
      truncated: Boolean(j.truncated),
      totalReported: j.totalReported ?? null,
      warning: j.warning ?? "",
    };
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    runsLoading.value = false;
  }
}

function applySuggestedGap() {
  if (!runsForView.value.length) {
    message.warning("Load runs for a workflow first");
    return;
  }
  const ms = suggestMinGapMsFromRuns(runsForView.value);
  minGapMinutes.value = Math.round(ms / 60_000);
  message.success(`Set minimum gap to ${minGapMinutes.value} min (2× median spacing)`);
}

watch(selectedWorkflowId, (id) => {
  if (id != null) void loadRuns(id);
  else {
    runs.value = [];
    clearRunDetails();
  }
});

watch(
  () => projectStore.selectedProjectId,
  () => {
    for (const k of Object.keys(leadInfoByUuid)) {
      delete leadInfoByUuid[k];
    }
    for (const k of Object.keys(companyInfoById)) {
      delete companyInfoById[k];
    }
    scheduleHydrateLookups();
  }
);

function escapeCsvCell(value: string): string {
  const s = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function strField(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function csvRowForRun(run: DifyRunRow): Record<OptionalCsvExportKey | "result", string> {
  const leadUuid = leadUuidForRow(run);
  const contact = leadUuid ? leadInfoByUuid[leadUuid]?.record : undefined;
  const companyUuid = companyUuidForRow(run);
  const company = companyUuid ? companyInfoById[companyUuid]?.record : undefined;
  const d = getDetail(run);

  let result = "";
  if (d?.fetched && !d.error) {
    try {
      result =
        d.outputs === undefined || d.outputs === null
          ? ""
          : JSON.stringify(d.outputs);
    } catch {
      result = "";
    }
  }

  return {
    first_name: strField(contact?.first_name),
    last_name: strField(contact?.last_name),
    position: strField(contact?.position),
    lead_uuid: leadUuid ?? "",
    company_name: strField(contact?.company_name),
    domain: strField(company?.domain),
    name: strField(company?.name),
    company_uuid: companyUuid ?? "",
    result,
  };
}

function openExportModal(batch: DifyRunRow[], batchIndexFromEnd: number): void {
  exportBatchRuns.value = batch;
  exportBatchTitle.value = `Batch ${batches.value.length - batchIndexFromEnd} (${batch.length} run${batch.length === 1 ? "" : "s"})`;
  exportModalOpen.value = true;
}

function selectAllExportColumns(): void {
  for (const k of OPTIONAL_CSV_KEYS) {
    exportColumnSelection[k] = true;
  }
}

function clearOptionalExportColumns(): void {
  for (const k of OPTIONAL_CSV_KEYS) {
    exportColumnSelection[k] = false;
  }
}

function confirmExportCsv(): void {
  const batch = exportBatchRuns.value;
  if (!batch?.length) {
    message.warning("Nothing to export.");
    return;
  }
  const activeKeys = OPTIONAL_CSV_KEYS.filter((k) => exportColumnSelection[k]);
  const headers = [...activeKeys.map((k) => CSV_HEADER_LABEL[k]), "result"];
  const lines: string[] = [];
  lines.push(headers.map(escapeCsvCell).join(","));
  for (const run of batch) {
    const row = csvRowForRun(run);
    const cells = [...activeKeys.map((k) => escapeCsvCell(row[k])), escapeCsvCell(row.result)];
    lines.push(cells.join(","));
  }
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const wf = workflows.value.find((w) => w.id === selectedWorkflowId.value);
  const wfSlug = (wf?.name ?? "workflow")
    .replace(/[^\w\-]+/g, "_")
    .slice(0, 40);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const name = `dify_${wfSlug}_batch_${stamp}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  exportModalOpen.value = false;
  message.success(`Exported ${batch.length} row(s).`);
}

onMounted(() => {
  void loadWorkflows();
});
</script>

<template>
  <div class="dify-page">
    <NCard title="Dify workflow batches">
      <NSpace vertical size="large" style="width: 100%">
        <NText depth="3">
          Each Dify <strong>workflow app</strong> has its own API key. Configure one or more keys on the server
          (<code>DIFY_API_KEY</code>, comma-separated <code>DIFY_API_KEYS</code>, or JSON array
          <code>DIFY_API_KEYS_JSON</code>). Optional: <code>DIFY_API_BASE</code>,
          <code>DIFY_LOG_MAX_PAGES</code>. Run details: <code>DIFY_RUN_DETAIL_BATCH_MAX</code>,
          <code>DIFY_RUN_DETAIL_CONCURRENCY</code>. <strong>Lead / company info</strong> uses
          <code>POST /api/dify/contacts-lookup</code> with <code>uuids</code> (contact
          <code>lead_uuid</code>) and <code>companyIds</code> (<code>companies.id</code> via
          <code>project_companies</code>). Select a <strong>project</strong> in the header. Outputs are
          scanned for nested <code>lead_uuid</code>, <code>company_uuid</code>, and UUID-shaped
          <code>company_id</code>. If a lead is missing in the DB, use <strong>Get from GetSales</strong>
          (same as Conversations: <code>POST /api/contacts/find-by-uuid</code>).
        </NText>

        <NAlert v-if="workflowsError" type="warning" :show-icon="false">
          {{ workflowsError }}
        </NAlert>

        <NSpace align="center" wrap>
          <NButton size="small" :loading="workflowsLoading" @click="loadWorkflows">
            <template #icon>
              <RefreshCwIcon :size="14" />
            </template>
            Refresh workflows
          </NButton>
          <NSelect
            v-model:value="selectedWorkflowId"
            :options="workflowOptions"
            :loading="workflowsLoading"
            placeholder="Select workflow app…"
            clearable
            filterable
            style="min-width: 260px; max-width: 100%"
          />
        </NSpace>

        <template v-if="selectedWorkflowId">
          <NDivider style="margin: 0" />

          <NSpace align="center" wrap>
            <NCheckbox v-model:checked="onlySucceeded" size="small">
              Succeeded only
            </NCheckbox>
          </NSpace>

          <NSpace align="center" wrap>
            <span class="field-label">New batch if gap ≥</span>
            <NInputNumber
              v-model:value="minGapMinutes"
              :min="1"
              :max="10080"
              :step="5"
              size="small"
              style="width: 120px"
            />
            <span class="field-label">minutes since previous run</span>
            <NButton size="small" secondary @click="applySuggestedGap">
              Suggest from median spacing
            </NButton>
          </NSpace>

          <NSpin :show="runsLoading">
            <NAlert v-if="runsMeta.warning" type="warning" style="margin-bottom: 12px" :show-icon="false">
              {{ runsMeta.warning }}
            </NAlert>
            <NText depth="3" style="display: block; margin-bottom: 8px">
              Loaded {{ runs.length }} run(s)
              <template v-if="onlySucceeded">
                · showing {{ runsForView.length }} succeeded
              </template>
              <template v-else>
                · showing all (succeeded first, then others)
              </template>
              <template v-if="runsMeta.totalReported != null">
                · API total {{ runsMeta.totalReported }}
              </template>
              · {{ runsMeta.pagesFetched }} page(s)
              <template v-if="runsMeta.truncated"> · list truncated at page cap</template>
            </NText>

            <NAlert
              v-if="!runsLoading && runs.length === 0"
              type="info"
              :show-icon="false"
            >
              No runs returned. Confirm this app is a workflow and has API execution history.
            </NAlert>

            <NAlert
              v-else-if="!runsLoading && runs.length > 0 && runsForView.length === 0"
              type="info"
              :show-icon="false"
            >
              No runs match “Succeeded only”. Turn off the filter to see other statuses.
            </NAlert>

            <NCollapse v-else-if="runsForView.length" display-directive="show">
              <NCollapseItem
                v-for="(batch, bi) in batches"
                :key="bi"
                :title="`Batch ${batches.length - bi} — ${batch.length} run(s) · ${formatDt(batch[0]!.createdAtMs)} → ${formatDt(batch[batch.length - 1]!.createdAtMs)}`"
              >
                <NSpace vertical size="small" style="width: 100%">
                  <div class="batch-table-header">
                    <NText depth="3" style="font-size: 12px">This batch</NText>
                    <NSpace wrap size="small">
                      <NButton
                        type="primary"
                        size="small"
                        :loading="batchFetchLoading[bi] === true"
                        :disabled="runsLoading"
                        @click="fetchAllResultsForBatch(batch, bi)"
                      >
                        Get all results
                      </NButton>
                      <NButton
                        size="small"
                        secondary
                        :disabled="runsLoading || !batch.length"
                        @click="openExportModal(batch, bi)"
                      >
                        <template #icon>
                          <DownloadIcon :size="14" />
                        </template>
                        Export CSV…
                      </NButton>
                    </NSpace>
                  </div>
                  <NDataTable
                    :columns="runColumns"
                    :data="batch"
                    :row-key="(row: DifyRunRow) => row.runId"
                    :bordered="false"
                    size="small"
                    :scroll-x="1480"
                  />
                </NSpace>
              </NCollapseItem>
            </NCollapse>
          </NSpin>
        </template>
      </NSpace>
    </NCard>

    <NModal
      v-model:show="exportModalOpen"
      preset="card"
      :title="`Export CSV — ${exportBatchTitle}`"
      :style="{ width: 'min(520px, 94vw)' }"
      :mask-closable="false"
    >
      <NText depth="3" style="display: block; margin-bottom: 12px">
        Choose optional columns. <strong>result</strong> (workflow JSON output) is always included as the last column.
      </NText>
      <div class="export-section-label">Contact</div>
      <NSpace vertical size="small" class="export-checks">
        <NCheckbox v-model:checked="exportColumnSelection.first_name" size="small">
          First name
        </NCheckbox>
        <NCheckbox v-model:checked="exportColumnSelection.last_name" size="small">
          Last name
        </NCheckbox>
        <NCheckbox v-model:checked="exportColumnSelection.position" size="small">
          Position
        </NCheckbox>
        <NCheckbox v-model:checked="exportColumnSelection.lead_uuid" size="small">
          lead_uuid
        </NCheckbox>
      </NSpace>
      <div class="export-section-label" style="margin-top: 14px">Company</div>
      <NSpace vertical size="small" class="export-checks">
        <NCheckbox v-model:checked="exportColumnSelection.company_name" size="small">
          company_name (from contact)
        </NCheckbox>
        <NCheckbox v-model:checked="exportColumnSelection.domain" size="small">
          domain
        </NCheckbox>
        <NCheckbox v-model:checked="exportColumnSelection.name" size="small">
          name (company record)
        </NCheckbox>
        <NCheckbox v-model:checked="exportColumnSelection.company_uuid" size="small">
          company_uuid
        </NCheckbox>
      </NSpace>
      <NSpace style="margin-top: 12px" size="small">
        <NButton size="tiny" quaternary @click="selectAllExportColumns">Select all</NButton>
        <NButton size="tiny" quaternary @click="clearOptionalExportColumns">Clear optional</NButton>
      </NSpace>
      <template #footer>
        <NSpace justify="end" style="width: 100%">
          <NButton quaternary @click="exportModalOpen = false">Cancel</NButton>
          <NButton type="primary" @click="confirmExportCsv">Download CSV</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped lang="less">
.dify-page {
  padding: 1rem 0;
}

.batch-table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 2px;
}

.export-section-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.65;
  margin-bottom: 6px;
}

.export-checks {
  padding-left: 2px;
}

.field-label {
  font-size: 13px;
  opacity: 0.85;
}

code {
  font-size: 0.85em;
}

:deep(.result-preview) {
  font-size: 11px;
  line-height: 1.35;
  word-break: break-word;
  max-width: 420px;
  font-family: ui-monospace, monospace;
}

:deep(.result-na) {
  opacity: 0.45;
}

:deep(.muted) {
  opacity: 0.55;
  font-size: 12px;
}

:deep(.lead-err) {
  font-size: 11px;
  color: var(--n-color-target);
}

:deep(.lead-cell-with-action) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
</style>
