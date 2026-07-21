<script setup lang="ts">
import { ref, computed, watch, h, type VNodeChild } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import type { EChartsOption } from "echarts";
import VChart from "vue-echarts";
import {
  NCard,
  NDataTable,
  NButton,
  NInput,
  NPagination,
  NSpace,
  NTag,
  NAlert,
  NDrawer,
  NDrawerContent,
  NSelect,
  NDatePicker,
  NAvatar,
  NTabs,
  NTabPane,
  NEmpty,
} from "naive-ui";
import type { DataTableColumns, SelectOption } from "naive-ui";
import CompanyDossier from "../components/dossier/CompanyDossier.vue";
import { useProjectStore } from "../stores/project";

use([CanvasRenderer, BarChart, GridComponent, TooltipComponent, LegendComponent]);

const projectStore = useProjectStore();

type LlmBucket = {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  usd_estimated: number;
};

type LlmLineItem = {
  stage: string;
  node: string;
  model: string;
  entity_key?: string;
  company_key?: string;
  contact_key?: string;
  total_tokens: number;
  usd_estimated: number;
};

type LlmBreakdown = {
  usd_estimated_total?: number;
  by_stage?: Record<string, LlmBucket>;
  by_model?: Record<string, LlmBucket>;
  by_company?: Record<string, LlmBucket>;
  by_contact?: Record<string, LlmBucket>;
  line_items?: LlmLineItem[];
};

const STAGE_LABELS: Record<string, string> = {
  p0: "P0 ICP gate",
  p1: "P1 discovery",
  p2: "P2 enrichment",
  p4: "P4 contact fit",
  p5: "P5 deep research",
  p6: "P6 POV",
};

function shortModel(model: string): string {
  return model.includes("/") ? model.split("/").slice(1).join("/") : model;
}

function bucketEntries(buckets: Record<string, LlmBucket> | undefined, limit = 20) {
  if (!buckets) return [] as Array<{ key: string; bucket: LlmBucket }>;
  return Object.entries(buckets)
    .sort((a, b) => b[1].usd_estimated - a[1].usd_estimated)
    .slice(0, limit)
    .map(([key, bucket]) => ({ key, bucket }));
}

function horizontalBarOption(
  rows: Array<{ label: string; usd: number; tokens: number; calls: number }>,
  valueMode: "usd" | "tokens"
): EChartsOption {
  const sorted = [...rows].sort((a, b) =>
    valueMode === "usd" ? b.usd - a.usd : b.tokens - a.tokens
  );
  const labels = sorted.map((r) => r.label);
  const values = sorted.map((r) => (valueMode === "usd" ? r.usd : r.tokens));
  const valueLabel = valueMode === "usd" ? "Est. cost (USD)" : "Tokens";
  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params;
        const idx = typeof p?.dataIndex === "number" ? p.dataIndex : 0;
        const row = sorted[idx];
        if (!row) return "";
        return [
          `<strong>${row.label}</strong>`,
          `${valueLabel}: ${valueMode === "usd" ? `$${row.usd.toFixed(4)}` : row.tokens.toLocaleString()}`,
          `Calls: ${row.calls}`,
        ].join("<br/>");
      },
    },
    grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "value", axisLabel: { formatter: valueMode === "usd" ? (v: number) => `$${v}` : undefined } },
    yAxis: { type: "category", data: labels, inverse: true },
    series: [
      {
        name: valueLabel,
        type: "bar",
        data: values,
        itemStyle: { color: "#5470c6" },
        label: {
          show: true,
          position: "right",
          formatter: (p) =>
            valueMode === "usd"
              ? `$${Number(p.value ?? 0).toFixed(3)}`
              : Number(p.value ?? 0).toLocaleString(),
        },
      },
    ],
  };
}

export type N8nWorkflowResultRow = {
  id: string;
  contact_id: string | null;
  contact_label: string | null;
  contact_avatar_url: string | null;
  company_id: string | null;
  company_label: string | null;
  company_logo_url: string | null;
  workflow: string;
  execution_id: string | null;
  created_at: string;
  agent_previews: Record<string, string>;
  result: Record<string, unknown>;
};

type FilterField =
  | "execution_id"
  | "workflow"
  | "created_at"
  | "contact_id"
  | "company_id"
  | "contact_name"
  | "company_name"
  | "result_text"
  | "launch_id";

type FilterOp = "eq" | "neq" | "like" | "not_like" | "gte" | "lte";

type FilterRow = {
  field: FilterField | "";
  op: FilterOp | "";
  value: string;
  /** Naive datetime picker (ms) when field is created_at */
  _ts?: number | null;
};

const FIELD_OPTIONS: SelectOption[] = [
  { label: "Execution id", value: "execution_id" },
  { label: "Workflow", value: "workflow" },
  { label: "Created at", value: "created_at" },
  { label: "Contact id (UUID)", value: "contact_id" },
  { label: "Company id (UUID)", value: "company_id" },
  { label: "Contact name (contains)", value: "contact_name" },
  { label: "Company name / domain (contains)", value: "company_name" },
  { label: "Result JSON (contains)", value: "result_text" },
  { label: "Launch / run id", value: "launch_id" },
];

function opsForField(field: string): SelectOption[] {
  switch (field) {
    case "execution_id":
    case "workflow":
      return [
        { label: "equals", value: "eq" },
        { label: "not equals", value: "neq" },
        { label: "contains", value: "like" },
        { label: "does not contain", value: "not_like" },
      ];
    case "created_at":
      return [
        { label: "on or after", value: "gte" },
        { label: "on or before", value: "lte" },
      ];
    case "contact_id":
    case "company_id":
    case "launch_id":
      return [
        { label: "equals", value: "eq" },
        { label: "not equals", value: "neq" },
      ];
    case "contact_name":
    case "company_name":
    case "result_text":
      return [
        { label: "contains", value: "like" },
        { label: "does not contain", value: "not_like" },
      ];
    default:
      return [];
  }
}

const route = useRoute();
const router = useRouter();

type ExecutionSummary = {
  id: string;
  run_id: string;
  execution_id: string | null;
  created_at: string;
  status: string;
  duration_sec: number | null;
  cost_usd: number | null;
  funnel: Record<string, number>;
  warnings: string[];
  billing: Record<string, unknown> | null;
  tokens_by_stage: Record<string, number> | null;
  llm_breakdown: LlmBreakdown | null;
};

type ExecutionDetail = {
  summary: ExecutionSummary | null;
  companies: Array<Record<string, unknown>>;
  contacts: Array<Record<string, unknown>>;
  company_field_keys: string[];
  contact_field_keys: string[];
};

const FUNNEL_LABELS: Record<string, string> = {
  companies_launched: "Companies launched",
  companies_icp: "ICP screened",
  companies_icp_passed: "ICP passed",
  companies_icp_excluded: "ICP excluded",
  companies_discovery: "Contact discovery",
  contacts_enriched: "Contacts enriched",
  contacts_fit_scored: "Fit scored",
  contacts_analyzed: "Contacts analyzed",
  contacts_high_medium: "Eligible contacts",
  contacts_eligible: "Eligible contacts",
  companies_deep: "Deep research",
  companies_pov: "POV generated",
  companies_pov_ok: "POV OK",
  jobs_researched: "Jobs analyzed",
};

const FUNNEL_ORDER = [
  "companies_launched",
  "companies_icp",
  "companies_icp_passed",
  "companies_icp_excluded",
  "companies_discovery",
  "contacts_enriched",
  "contacts_analyzed",
  "contacts_eligible",
  "contacts_fit_scored",
  "contacts_high_medium",
  "companies_deep",
  "jobs_researched",
  "companies_pov",
  "companies_pov_ok",
];

const pageMode = computed(() => {
  const view = String(route.query.view ?? "");
  if (view === "rows") return "rows";
  const execId = String(route.query.executionId ?? route.query.execution_id ?? "").trim();
  const runId = String(route.query.runId ?? route.query.run_id ?? "").trim();
  if (execId || runId) return "detail";
  return "executions";
});

const detailKey = computed(() => {
  return (
    String(route.query.runId ?? route.query.run_id ?? "").trim() ||
    String(route.query.executionId ?? route.query.execution_id ?? "").trim()
  );
});

const execLoading = ref(false);
const execError = ref("");
const execRows = ref<ExecutionSummary[]>([]);
const execTotal = ref(0);
const execPage = computed({
  get: () => Math.max(1, parseInt(String(route.query.execPage ?? "1"), 10) || 1),
  set: (p: number) => {
    const q = queryToRecord();
    if (p <= 1) delete q.execPage;
    else q.execPage = String(p);
    router.replace({ path: "/n8n/workflow-results", query: q });
  },
});

const detailLoading = ref(false);
const detailError = ref("");
const detail = ref<ExecutionDetail | null>(null);
const expandedCompanyKey = ref<string | null>(null);
const expandedContactKey = ref<string | null>(null);

type DetailTab = "research" | "credit" | "health";
const detailTab = computed<DetailTab>({
  get() {
    const t = String(route.query.tab ?? "research");
    if (t === "credit" || t === "health" || t === "research") return t;
    return "research";
  },
  set(tab: DetailTab) {
    const q = queryToRecord();
    if (tab === "research") delete q.tab;
    else q.tab = tab;
    router.replace({ path: "/n8n/workflow-results", query: q });
  },
});

function entityRowKey(entityType: "company" | "contact", row: Record<string, unknown>): string {
  if (entityType === "company") {
    return String(row.company_id || row.company_key || row.company_name || JSON.stringify(row).slice(0, 40));
  }
  return String(row.contact_id || row.contact_key || row.contact_label || JSON.stringify(row).slice(0, 40));
}

function toggleExpandRow(entityType: "company" | "contact", row: Record<string, unknown>) {
  const key = entityRowKey(entityType, row);
  if (entityType === "company") {
    expandedCompanyKey.value = expandedCompanyKey.value === key ? null : key;
  } else {
    expandedContactKey.value = expandedContactKey.value === key ? null : key;
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((x) => (typeof x === "string" ? x : String((x as Record<string, unknown>)?.claim ?? (x as Record<string, unknown>)?.fact ?? (x as Record<string, unknown>)?.question ?? ""))).filter(Boolean);
}

/** Map a merged execution company row into CompanyDossier props. */
function dossierFromMergedCompanyRow(row: Record<string, unknown>) {
  const pressure = Array.isArray(row.pressure_points) ? row.pressure_points : [];
  const headline = Array.isArray(row.headline_facts) ? row.headline_facts : [];
  const discovery = asStringArray(row.discovery_questions);
  const hook =
    (typeof row.hook === "string" && row.hook) ||
    (typeof headline[0] === "object" && headline[0] && "fact" in (headline[0] as object)
      ? String((headline[0] as { fact?: string }).fact ?? "")
      : typeof headline[0] === "string"
        ? headline[0]
        : "") ||
    (typeof pressure[0] === "string" ? pressure[0] : "");
  return {
    pov_ok: row.pov_ok === true,
    from_contract: headline.length > 0,
    account_narrative:
      (typeof row.account_narrative === "string" && row.account_narrative) ||
      (typeof row.brief_markdown === "string" ? row.brief_markdown.slice(0, 600) : null),
    narrative_from_contract: typeof row.account_narrative === "string" && !!row.account_narrative,
    hook: hook || null,
    lead_question:
      (typeof row.lead_question === "string" && row.lead_question) || discovery[0] || null,
    headline_facts: headline as Array<Record<string, unknown>>,
    target:
      row.target && typeof row.target === "object" && !Array.isArray(row.target)
        ? (row.target as Record<string, unknown>)
        : null,
    tech_stack: Array.isArray(row.tech_stack) ? row.tech_stack : [],
    fit_contacts_by_persona: (
      row.fit_contacts_by_persona &&
      typeof row.fit_contacts_by_persona === "object" &&
      !Array.isArray(row.fit_contacts_by_persona)
        ? row.fit_contacts_by_persona
        : {}
    ) as Record<string, Array<Record<string, unknown>>>,
    fit_score: (row.fit_score as number | string | null | undefined) ?? null,
    score_rationale: typeof row.score_rationale === "string" ? row.score_rationale : null,
    vertical: typeof row.vertical === "string" ? row.vertical : null,
    build_risk: typeof row.build_risk === "string" ? row.build_risk : null,
    pressure_points: pressure,
    data_integration_pain: Array.isArray(row.data_integration_pain) ? row.data_integration_pain : [],
    transformation_signals: Array.isArray(row.transformation_signals) ? row.transformation_signals : [],
    discovery_questions: discovery,
    job_postings: Array.isArray(row.job_postings) ? row.job_postings : [],
    leadership_openings: Array.isArray(row.leadership_openings) ? row.leadership_openings : [],
    research_source_urls: Array.isArray(row.research_source_urls)
      ? row.research_source_urls.map(String)
      : [],
    team_signal:
      row.team_signal && typeof row.team_signal === "object" && !Array.isArray(row.team_signal)
        ? (row.team_signal as {
            dept_headcount?: Record<string, unknown>;
            capacity_gaps?: string[];
            it_contact_count?: number;
          })
        : undefined,
    brief_markdown: typeof row.brief_markdown === "string" ? row.brief_markdown : null,
    company_name:
      (typeof row.company_name === "string" && row.company_name) ||
      (typeof row.company_key === "string" ? row.company_key : null),
    as_of: null,
    run_id: detail.value?.summary?.run_id ?? null,
  };
}

const healthMetrics = computed(() => {
  const funnel = detail.value?.summary?.funnel ?? {};
  const pov = Number(funnel.companies_pov ?? 0);
  const povOk = Number(funnel.companies_pov_ok ?? 0);
  const scored = Number(funnel.contacts_fit_scored ?? 0);
  const hm = Number(funnel.contacts_high_medium ?? 0);
  const icp = Number(funnel.companies_icp ?? 0);
  return [
    {
      label: "POV completeness",
      value: pov > 0 ? `${Math.round((povOk / pov) * 100)}%` : "—",
      hint: `${povOk} OK / ${pov} POV generated`,
    },
    {
      label: "High/medium fit rate",
      value: scored > 0 ? `${Math.round((hm / scored) * 100)}%` : "—",
      hint: `${hm} HM / ${scored} scored`,
    },
    {
      label: "ICP → POV",
      value: icp > 0 && pov > 0 ? `${pov} / ${icp}` : "—",
      hint: "Companies that reached POV vs ICP",
    },
    {
      label: "Run status",
      value: detail.value?.summary?.status ?? "—",
      hint: formatDuration(detail.value?.summary?.duration_sec),
    },
  ];
});

async function loadExecutions() {
  execLoading.value = true;
  execError.value = "";
  try {
    const offset = (execPage.value - 1) * PAGE_SIZE;
    const r = await fetch(`/api/n8n/workflow-results/executions?limit=${PAGE_SIZE}&offset=${offset}`);
    const data = (await r.json()) as { rows?: ExecutionSummary[]; total?: number; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed to load executions");
    execRows.value = data.rows ?? [];
    execTotal.value = data.total ?? 0;
  } catch (e) {
    execError.value = e instanceof Error ? e.message : "Failed to load executions";
    execRows.value = [];
    execTotal.value = 0;
  } finally {
    execLoading.value = false;
  }
}

async function loadExecutionDetail() {
  const key = detailKey.value;
  if (!key) {
    detail.value = null;
    return;
  }
  detailLoading.value = true;
  detailError.value = "";
  expandedCompanyKey.value = null;
  expandedContactKey.value = null;
  try {
    const r = await fetch(`/api/n8n/workflow-results/executions/${encodeURIComponent(key)}`);
    const data = (await r.json()) as ExecutionDetail & { error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed to load execution detail");
    detail.value = data;
  } catch (e) {
    detailError.value = e instanceof Error ? e.message : "Failed to load execution detail";
    detail.value = null;
  } finally {
    detailLoading.value = false;
  }
}

function openExecution(row: ExecutionSummary) {
  router.push({
    path: "/n8n/workflow-results",
    query: { runId: row.run_id || row.execution_id || row.id },
  });
}

function backToExecutions() {
  router.push({ path: "/n8n/workflow-results" });
}

function openAllRows() {
  router.push({ path: "/n8n/workflow-results", query: { view: "rows" } });
}

function formatUsd(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function formatDuration(sec: number | null | undefined): string {
  if (sec == null || sec <= 0) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const llmBreakdown = computed(() => detail.value?.summary?.llm_breakdown ?? null);
const llmChartMode = ref<"usd" | "tokens">("usd");

const llmStageChartRows = computed(() =>
  bucketEntries(llmBreakdown.value?.by_stage).map(({ key, bucket }) => ({
    label: STAGE_LABELS[key] ?? key.toUpperCase(),
    usd: bucket.usd_estimated,
    tokens: bucket.total_tokens,
    calls: bucket.calls,
  }))
);

const llmModelChartRows = computed(() =>
  bucketEntries(llmBreakdown.value?.by_model).map(({ key, bucket }) => ({
    label: shortModel(key),
    usd: bucket.usd_estimated,
    tokens: bucket.total_tokens,
    calls: bucket.calls,
  }))
);

const llmCompanyChartRows = computed(() =>
  bucketEntries(llmBreakdown.value?.by_company).map(({ key, bucket }) => ({
    label: key,
    usd: bucket.usd_estimated,
    tokens: bucket.total_tokens,
    calls: bucket.calls,
  }))
);

const llmStageChartOption = computed(() =>
  horizontalBarOption(llmStageChartRows.value, llmChartMode.value)
);
const llmModelChartOption = computed(() =>
  horizontalBarOption(llmModelChartRows.value, llmChartMode.value)
);
const llmCompanyChartOption = computed(() =>
  horizontalBarOption(llmCompanyChartRows.value, llmChartMode.value)
);

const llmLineItemRows = computed(() =>
  [...(llmBreakdown.value?.line_items ?? [])].sort(
    (a, b) => b.usd_estimated - a.usd_estimated || b.total_tokens - a.total_tokens
  )
);

const llmLineItemColumns: DataTableColumns<LlmLineItem> = [
  { title: "Stage", key: "stage", width: 70, render: (row) => STAGE_LABELS[row.stage] ?? row.stage },
  { title: "Model", key: "model", ellipsis: { tooltip: true }, render: (row) => shortModel(row.model) },
  {
    title: "Row",
    key: "entity_key",
    ellipsis: { tooltip: true },
    render: (row) => row.contact_key || row.company_key || row.entity_key || "—",
  },
  { title: "Node", key: "node", ellipsis: { tooltip: true } },
  {
    title: "Tokens",
    key: "total_tokens",
    width: 90,
    render: (row) => row.total_tokens.toLocaleString(),
  },
  {
    title: "Est. $",
    key: "usd_estimated",
    width: 90,
    render: (row) => `$${row.usd_estimated.toFixed(4)}`,
  },
];

function formatCellValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  if (typeof value === "string") return value.trim() || "—";
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    if (value.every((v) => typeof v === "string")) return value.join(", ");
    return JSON.stringify(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function humanizeFieldKey(key: string): string {
  const labels: Record<string, string> = {
    company_key: "Key",
    company_name: "Name",
    contact_key: "Contact key",
    account_narrative: "Narrative",
    brief_markdown: "Brief",
    build_risk: "Build risk",
    fit_score: "Fit",
    fit: "Fit band",
    pov_ok: "POV",
    _preflight_skipped: "Preflight skipped",
    preflight_skipped: "Preflight skipped",
    vertical: "Vertical",
    company_intel: "Company intel",
    all_contacts: "Contacts",
    persona: "Persona",
    title: "Title",
    score_rationale: "Score rationale",
  };
  if (labels[key]) return labels[key];
  return key
    .replace(/^_+/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncateText(value: unknown, max = 120): string {
  const s = formatCellValue(value);
  if (s === "—") return s;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Prefer a short human summary; skip dumping raw JSON blobs into the table. */
function researchPreviewValue(key: string, value: unknown): string {
  if (value == null) return "—";
  if (key === "pov_ok" || key === "_preflight_skipped" || key === "preflight_skipped") {
    if (typeof value === "boolean") return value ? "yes" : "no";
    return formatCellValue(value);
  }
  if (key === "fit_score") {
    const n = Number(value);
    return Number.isFinite(n) ? String(Math.round(n)) : formatCellValue(value);
  }
  if (typeof value === "object") return "…";
  if (key === "account_narrative" || key === "brief_markdown" || key === "score_rationale") {
    return truncateText(value, 100);
  }
  return truncateText(value, 80);
}

function velvetechCompanyLabelFromRow(row: Record<string, unknown>): string {
  const label = row.company_label;
  if (typeof label === "string" && label.trim()) return label.trim();
  const name = row.company_name;
  if (typeof name === "string" && name.trim()) return name.trim();
  const key = row.company_key;
  return typeof key === "string" && key.trim() ? key.trim() : "company";
}

function velvetechContactLabelFromRow(row: Record<string, unknown>): string {
  const label = row.contact_label;
  if (typeof label === "string" && label.trim()) return label.trim();
  const contact = row.contact;
  if (contact && typeof contact === "object" && !Array.isArray(contact)) {
    const full = (contact as Record<string, unknown>).full_name;
    if (typeof full === "string" && full.trim()) return full.trim();
  }
  const key = row.contact_key;
  return typeof key === "string" && key.trim() ? key.trim() : "contact";
}

function renderEntityCardLink(
  entityType: "company" | "contact",
  row: Record<string, unknown>,
  label: string,
  mode: "navigate" | "expand" = "navigate"
) {
  const id =
    entityType === "company"
      ? typeof row.company_id === "string"
        ? row.company_id
        : null
      : typeof row.contact_id === "string"
        ? row.contact_id
        : null;
  const avatarUrl =
    entityType === "company"
      ? (typeof row.company_logo_url === "string" ? row.company_logo_url : null)
      : (typeof row.contact_avatar_url === "string" ? row.contact_avatar_url : null);
  const avatar = h(
    NAvatar,
    {
      round: entityType === "contact",
      size: 28,
      src: avatarUrl || undefined,
      style: { flexShrink: "0" },
    },
    { default: () => avatarFallback(label) }
  );

  if (mode === "expand") {
    const key = entityRowKey(entityType, row);
    const active =
      entityType === "company"
        ? expandedCompanyKey.value === key
        : expandedContactKey.value === key;
    return h(
      "div",
      { class: "entity-expand-cell" },
      [
        avatar,
        h(
          "button",
          {
            type: "button",
            class: ["entity-expand-btn", active ? "is-active" : ""].filter(Boolean).join(" "),
            onClick: () => toggleExpandRow(entityType, row),
          },
          active ? `${label} ▾` : `${label} ▸`
        ),
      ]
    );
  }

  if (!id) return formatCellValue(label);
  return h(
    NSpace,
    { align: "center", size: 8, wrap: false },
    {
      default: () => [
        avatar,
        h(
          RouterLink,
          {
            to: entityType === "company" ? `/company/${id}` : `/contact/${id}`,
            style: "color:#2080f0;text-decoration:none;font-size:0.85rem",
          },
          { default: () => label }
        ),
      ],
    }
  );
}

const COMPANY_RESEARCH_COLUMNS = [
  "company_key",
  "vertical",
  "build_risk",
  "fit_score",
  "pov_ok",
  "_preflight_skipped",
  "account_narrative",
] as const;

const CONTACT_RESEARCH_COLUMNS = [
  "title",
  "tenure_display",
  "persona",
  "fit",
  "company_name",
  "linkedin_experience",
] as const;

const COMPANY_RESEARCH_SKIP = new Set([
  "company_id",
  "company_label",
  "company_logo_url",
  "company_name",
  "company_intel",
  "all_contacts",
  "brief_markdown",
  "headline_facts",
  "pressure_points",
  "data_integration_pain",
  "transformation_signals",
  "discovery_questions",
  "job_postings",
  "leadership_openings",
  "research_source_urls",
  "team_signal",
  "fit_contacts_by_persona",
  "tech_stack",
  "target",
  "hook",
  "lead_question",
  "score_rationale",
]);

function contactEnrichment(row: Record<string, unknown>): Record<string, unknown> {
  const e = row.enrichment;
  return e != null && typeof e === "object" && !Array.isArray(e) ? (e as Record<string, unknown>) : {};
}

function contactNested(row: Record<string, unknown>): Record<string, unknown> {
  const c = row.contact;
  return c != null && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : {};
}

function contactTitle(row: Record<string, unknown>): string {
  const en = contactEnrichment(row);
  const ct = contactNested(row);
  for (const v of [en.current_title, row.title, ct.title, ct.job_title, en.headline]) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function formatTenureMonths(months: unknown): string {
  const n = typeof months === "number" ? months : Number(months);
  if (!Number.isFinite(n) || n < 0) return "";
  const y = Math.floor(n / 12);
  const m = Math.round(n % 12);
  if (y <= 0) return `${m}m`;
  if (m <= 0) return `${y}y`;
  return `${y}y ${m}m`;
}

function contactTenureDisplay(row: Record<string, unknown>): string {
  return formatTenureMonths(contactEnrichment(row).tenure_months);
}

function contactLinkedinExperiencePreview(row: Record<string, unknown>): string {
  const en = contactEnrichment(row);
  const summary = typeof en.summary === "string" ? en.summary.trim() : "";
  if (summary) return summary.slice(0, 180) + (summary.length > 180 ? "…" : "");
  const exp = Array.isArray(en.experience) ? en.experience : [];
  for (const item of exp) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const desc = typeof e.description === "string" ? e.description.trim() : "";
    if (desc) return desc.slice(0, 180) + (desc.length > 180 ? "…" : "");
    const title = typeof e.title === "string" ? e.title.trim() : "";
    const company = typeof e.company === "string" ? e.company.trim() : "";
    if (title || company) return [title, company].filter(Boolean).join(" @ ");
  }
  return "";
}

function contactLinkedinUrl(row: Record<string, unknown>): string {
  const en = contactEnrichment(row);
  const ct = contactNested(row);
  for (const v of [en.linkedin_url, ct.linkedin_url, row.linkedin_url]) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pickResearchFieldKeys(
  preferred: readonly string[],
  available: string[],
  skip: Set<string>
): string[] {
  const avail = new Set(available);
  const ordered: string[] = [];
  for (const key of preferred) {
    if (key === "_preflight_skipped") {
      if (avail.has("_preflight_skipped")) ordered.push("_preflight_skipped");
      else if (avail.has("preflight_skipped")) ordered.push("preflight_skipped");
      continue;
    }
    if (avail.has(key)) ordered.push(key);
  }
  // Fill gaps with remaining short scalar keys so sparse runs still show something useful
  for (const key of available) {
    if (ordered.length >= preferred.length) break;
    if (skip.has(key) || ordered.includes(key) || key.startsWith("_")) continue;
    ordered.push(key);
  }
  return ordered;
}

function buildEntityColumns(
  fieldKeys: string[],
  entityType: "company" | "contact",
  onOpenJson: (row: Record<string, unknown>) => void,
  linkMode: "navigate" | "expand" = "navigate"
): DataTableColumns<Record<string, unknown>> {
  const curated =
    entityType === "company"
      ? pickResearchFieldKeys(COMPANY_RESEARCH_COLUMNS, fieldKeys, COMPANY_RESEARCH_SKIP)
      : [...CONTACT_RESEARCH_COLUMNS];

  const cols: DataTableColumns<Record<string, unknown>> = [
    {
      title: entityType === "company" ? "Company" : "Contact",
      key: "_entity_card",
      fixed: "left",
      minWidth: 220,
      render(row) {
        const label =
          entityType === "company"
            ? velvetechCompanyLabelFromRow(row)
            : velvetechContactLabelFromRow(row);
        return renderEntityCardLink(entityType, row, label, linkMode);
      },
    },
  ];

  if (entityType === "contact") {
    const contactColDefs: Array<{
      title: string;
      key: string;
      minWidth: number;
      render: (row: Record<string, unknown>) => VNodeChild;
    }> = [
      {
        title: "Title",
        key: "title",
        minWidth: 140,
        render: (row) => contactTitle(row) || "—",
      },
      {
        title: "In role",
        key: "tenure_display",
        minWidth: 90,
        render: (row) => contactTenureDisplay(row) || "—",
      },
      {
        title: "Persona",
        key: "persona",
        minWidth: 90,
        render: (row) => formatCellValue(row.persona),
      },
      {
        title: "Fit",
        key: "fit",
        minWidth: 90,
        render: (row) => formatCellValue(row.fit),
      },
      {
        title: "Company",
        key: "company_name",
        minWidth: 140,
        render(row) {
          const name = String(row.company_name || row.company_key || "").trim() || "—";
          if (row.company_id) {
            return h(
              RouterLink,
              {
                to: `/company/${String(row.company_id)}`,
                style: "color:#2080f0;text-decoration:none;font-size:0.85rem",
              },
              { default: () => name }
            );
          }
          return name;
        },
      },
      {
        title: "LinkedIn / experience",
        key: "linkedin_experience",
        minWidth: 220,
        render(row) {
          const preview = contactLinkedinExperiencePreview(row);
          const url = contactLinkedinUrl(row);
          if (!preview && !url) return "—";
          if (url) {
            return h(
              "a",
              {
                href: url.startsWith("http") ? url : `https://www.linkedin.com/in/${url}`,
                target: "_blank",
                rel: "noopener noreferrer",
                style: "color:#2080f0;text-decoration:none;font-size:0.82rem",
                title: preview || url,
              },
              preview || "Open profile"
            );
          }
          return preview;
        },
      },
    ];
    for (const def of contactColDefs) {
      cols.push({
        title: def.title,
        key: def.key,
        minWidth: def.minWidth,
        ellipsis: { tooltip: true },
        render: def.render,
      });
    }
    return cols;
  }

  for (const key of curated) {
    cols.push({
      title: humanizeFieldKey(key),
      key,
      minWidth: key === "account_narrative" ? 200 : key.length > 14 ? 140 : 110,
      ellipsis: { tooltip: true },
      render(row) {
        const raw =
          key === "_preflight_skipped" && row[key] == null
            ? row.preflight_skipped
            : row[key];
        return researchPreviewValue(key, raw);
      },
    });
  }

  cols.push({
    title: "Raw",
    key: "_json",
    width: 72,
    fixed: "right",
    render(row) {
      return h(
        NButton,
        { size: "tiny", quaternary: true, onClick: () => onOpenJson(row) },
        { default: () => "JSON" }
      );
    },
  });
  return cols;
}


function openEntityDetail(row: Record<string, unknown>, label: string) {
  drawerTitle.value = label;
  drawerJson.value = JSON.stringify(row, null, 2);
  drawerOpen.value = true;
}

const execColumns: DataTableColumns<ExecutionSummary> = [
  {
    title: "Run",
    key: "run_id",
    minWidth: 220,
    ellipsis: { tooltip: true },
    render(row) {
      return h(
        NButton,
        { text: true, type: "primary", size: "small", onClick: () => openExecution(row) },
        { default: () => row.run_id || row.execution_id || row.id }
      );
    },
  },
  {
    title: "Status",
    key: "status",
    width: 100,
    render(row) {
      const t = row.status === "success" ? "success" : row.status === "error" ? "error" : "default";
      return h(NTag, { size: "small", type: t }, { default: () => row.status });
    },
  },
  {
    title: "Cost",
    key: "cost_usd",
    width: 110,
    render(row) {
      const usd = formatUsd(row.cost_usd);
      const est = (row.warnings ?? []).some((w) => w.includes("cost_llm_token_estimated"));
      const spent =
        row.billing &&
        typeof row.billing === "object" &&
        (row.billing as Record<string, unknown>).openrouter &&
        typeof (row.billing as Record<string, unknown>).openrouter === "object"
          ? ((row.billing as Record<string, unknown>).openrouter as Record<string, unknown>).usd_spent
          : null;
      if (usd === "—" || row.cost_usd == null) return "—";
      if (spent != null && Number.isFinite(Number(spent))) return usd;
      if (est) return `${usd} est.`;
      return usd;
    },
  },
  {
    title: "Companies",
    key: "companies",
    width: 110,
    render(row) {
      const launched = row.funnel?.companies_launched ?? row.funnel?.companies_icp ?? 0;
      const povOk = row.funnel?.companies_pov_ok ?? 0;
      if (!launched && !povOk) return "—";
      return `${launched} → ${povOk}`;
    },
  },
  {
    title: "ICP excluded",
    key: "icp_excluded",
    width: 110,
    render(row) {
      const v = row.funnel?.companies_icp_excluded;
      return v != null ? String(v) : "—";
    },
  },
  {
    title: "Jobs",
    key: "jobs",
    width: 80,
    render(row) {
      const v = row.funnel?.jobs_researched;
      return v != null ? String(v) : "—";
    },
  },
  {
    title: "Contacts",
    key: "contacts",
    width: 90,
    render(row) {
      const v = row.funnel?.contacts_analyzed ?? row.funnel?.contacts_fit_scored;
      return v != null ? String(v) : "—";
    },
  },
  {
    title: "Eligible",
    key: "eligible",
    width: 90,
    render(row) {
      const v = row.funnel?.contacts_eligible ?? row.funnel?.contacts_high_medium;
      return v != null ? String(v) : "—";
    },
  },
  {
    title: "Duration",
    key: "duration_sec",
    width: 100,
    render(row) {
      return formatDuration(row.duration_sec);
    },
  },
  {
    title: "Created",
    key: "created_at",
    width: 168,
    render(row) {
      try {
        return new Date(row.created_at).toLocaleString();
      } catch {
        return row.created_at;
      }
    },
  },
];

const execPageCount = computed(() => Math.max(1, Math.ceil(execTotal.value / PAGE_SIZE)));

function queryToRecord(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(route.query)) {
    if (typeof v === "string" && v) out[k] = v;
    else if (Array.isArray(v) && typeof v[0] === "string") out[k] = v[0];
  }
  return out;
}

const PAGE_SIZE = 25;

const loading = ref(false);
const loadError = ref("");
const rows = ref<N8nWorkflowResultRow[]>([]);
const total = ref(0);
const agentKeyUnion = ref<string[]>([]);

const filterRows = ref<FilterRow[]>([]);

const page = computed({
  get: () => Math.max(1, parseInt(String(route.query.page ?? "1"), 10) || 1),
  set: (p: number) => {
    const q = queryToRecord();
    if (p <= 1) delete q.page;
    else q.page = String(p);
    router.replace({ path: "/n8n/workflow-results", query: q });
  },
});

function parseFiltersFromQuery(filtersEncoded: string | undefined): FilterRow[] {
  if (!filtersEncoded?.trim()) return [];
  try {
    const raw = decodeURIComponent(filtersEncoded.trim());
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: FilterRow[] = [];
    for (const el of arr) {
      if (!el || typeof el !== "object") continue;
      const o = el as Record<string, unknown>;
      const field = typeof o.field === "string" ? o.field : "";
      const op = typeof o.op === "string" ? o.op : "";
      const value = typeof o.value === "string" ? o.value : "";
      if (!field || !op) continue;
      const row: FilterRow = {
        field: field as FilterField,
        op: op as FilterOp,
        value,
      };
      if (field === "created_at" && value) {
        const t = Date.parse(value);
        if (Number.isFinite(t)) row._ts = t;
      }
      out.push(row);
    }
    return out;
  } catch {
    return [];
  }
}

function syncFiltersFromRoute(): void {
  const fq = route.query.filters;
  const fromFilters =
    typeof fq === "string" && fq.trim().length > 0 ? parseFiltersFromQuery(fq) : null;
  if (fromFilters && fromFilters.length > 0) {
    filterRows.value = fromFilters;
    return;
  }
  const rowsFromLegacy: FilterRow[] = [];
  const eid = String(route.query.executionId ?? "").trim();
  const cid = String(route.query.contactId ?? "").trim();
  const coid = String(route.query.companyId ?? "").trim();
  if (eid) rowsFromLegacy.push({ field: "execution_id", op: "eq", value: eid });
  if (cid) rowsFromLegacy.push({ field: "contact_id", op: "eq", value: cid });
  if (coid) rowsFromLegacy.push({ field: "company_id", op: "eq", value: coid });
  filterRows.value = rowsFromLegacy.length > 0 ? rowsFromLegacy : [{ field: "", op: "", value: "" }];
}

function buildClausesForApi(): { field: FilterField; op: FilterOp; value: string }[] {
  const out: { field: FilterField; op: FilterOp; value: string }[] = [];
  for (const row of filterRows.value) {
    const f = row.field as string;
    const o = row.op as string;
    const v = row.value?.trim() ?? "";
    if (!f || !o) continue;
    if ((o === "gte" || o === "lte") && !v) continue;
    if (o !== "gte" && o !== "lte" && !v) continue;
    out.push({ field: f as FilterField, op: o as FilterOp, value: v });
  }
  return out;
}

function applyFiltersToRoute() {
  const q = queryToRecord();
  delete q.contactId;
  delete q.companyId;
  delete q.executionId;
  const clauses = buildClausesForApi();
  const encoded = encodeURIComponent(JSON.stringify(clauses));
  if (encoded.length < 1600) q.filters = encoded;
  else delete q.filters;
  delete q.page;
  router.push({ path: "/n8n/workflow-results", query: q });
}

function addFilterRow() {
  filterRows.value.push({ field: "", op: "", value: "" });
}

function removeFilterRow(i: number) {
  filterRows.value.splice(i, 1);
  if (filterRows.value.length === 0) filterRows.value.push({ field: "", op: "", value: "" });
}

function clearFilters() {
  filterRows.value = [{ field: "", op: "", value: "" }];
  router.push({ path: "/n8n/workflow-results" });
}

function onFieldChange(row: FilterRow) {
  const ops = opsForField(row.field);
  if (!ops.some((o) => o.value === row.op)) {
    row.op = (ops[0]?.value as FilterOp) ?? "";
  }
  if (row.field !== "created_at") {
    row._ts = undefined;
  } else if (row.value) {
    const t = Date.parse(row.value);
    row._ts = Number.isFinite(t) ? t : null;
  }
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const offset = (page.value - 1) * PAGE_SIZE;
    const filters = buildClausesForApi();
    const r = await fetch("/api/n8n/workflow-results/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filters,
        limit: PAGE_SIZE,
        offset,
      }),
    });
    const data = (await r.json()) as {
      rows?: N8nWorkflowResultRow[];
      total?: number;
      agent_key_union?: string[];
      error?: string;
    };
    if (!r.ok) throw new Error(data.error ?? "Failed to load");
    rows.value = data.rows ?? [];
    total.value = data.total ?? 0;
    agentKeyUnion.value = data.agent_key_union ?? [];
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "Failed to load";
    rows.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

watch(
  () => ({ ...route.query, mode: pageMode.value }),
  () => {
    if (pageMode.value === "rows") {
      syncFiltersFromRoute();
      void load();
    } else if (pageMode.value === "executions") {
      void loadExecutions();
    } else if (pageMode.value === "detail") {
      void loadExecutionDetail();
    }
  },
  { deep: true, immediate: true }
);

const drawerOpen = ref(false);
const drawerTitle = ref("");
const drawerJson = ref("");

function openRowDetail(row: N8nWorkflowResultRow) {
  drawerTitle.value = row.id.slice(0, 8) + "…";
  drawerJson.value = JSON.stringify(row.result, null, 2);
  drawerOpen.value = true;
}

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

function avatarFallback(label: string | null): string {
  const s = label?.trim() || "?";
  return s.charAt(0).toUpperCase();
}

function velvetechContactLabel(row: N8nWorkflowResultRow): string | null {
  const r = row.result ?? {};
  const contact = r.contact;
  if (contact && typeof contact === "object" && !Array.isArray(contact)) {
    const full = (contact as Record<string, unknown>).full_name;
    if (typeof full === "string" && full.trim()) return full.trim();
  }
  const key = r.contact_key ?? r.entity_key;
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

function velvetechCompanyLabel(row: N8nWorkflowResultRow): string | null {
  const r = row.result ?? {};
  const name = r.company_name;
  if (typeof name === "string" && name.trim()) return name.trim();
  const key = r.company_key ?? r.entity_key;
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

function filterByResultText(value: string) {
  filterRows.value = [{ field: "result_text", op: "like", value }];
  applyFiltersToRoute();
}

const columns = computed<DataTableColumns<N8nWorkflowResultRow>>(() => {
  const agentCols: DataTableColumns<N8nWorkflowResultRow> = agentKeyUnion.value.map((key) => ({
    title: key,
    key: `agent:${key}`,
    minWidth: 168,
    ellipsis: { tooltip: true },
    render(row) {
      return row.agent_previews[key] ?? "—";
    },
  }));

  const tail: DataTableColumns<N8nWorkflowResultRow> = [
    {
      title: "Workflow",
      key: "workflow",
      minWidth: 120,
      ellipsis: { tooltip: true },
    },
    {
      title: "Execution",
      key: "execution_id",
      width: 120,
      ellipsis: { tooltip: true },
    },
    {
      title: "Created",
      key: "created_at",
      width: 168,
      render(row) {
        try {
          return new Date(row.created_at).toLocaleString();
        } catch {
          return row.created_at;
        }
      },
    },
    {
      title: "Detail",
      key: "detail",
      width: 72,
      fixed: "right",
      render(row) {
        return h(
          NButton,
          { size: "tiny", quaternary: true, onClick: () => openRowDetail(row) },
          { default: () => "JSON" }
        );
      },
    },
  ];

  const head: DataTableColumns<N8nWorkflowResultRow> = [
    {
      title: "Contact",
      key: "contact",
      fixed: "left",
      minWidth: 200,
      render(row) {
        const contactId = row.contact_id;
        if (contactId) {
          return h(
            NSpace,
            { align: "center", size: 8, wrap: false },
            {
              default: () => [
                h(
                  NAvatar,
                  {
                    round: true,
                    size: 28,
                    src: row.contact_avatar_url || undefined,
                    style: { flexShrink: "0" },
                  },
                  { default: () => avatarFallback(row.contact_label) }
                ),
                h(
                  RouterLink,
                  {
                    to: `/contact/${contactId}`,
                    style: "color:#2080f0;text-decoration:none;font-size:0.85rem",
                  },
                  { default: () => row.contact_label ?? `${contactId.slice(0, 8)}…` }
                ),
              ],
            }
          );
        }
        const fallback = velvetechContactLabel(row);
        if (!fallback) return "—";
        return h(
          NButton,
          { text: true, type: "primary", size: "small", onClick: () => filterByResultText(fallback) },
          { default: () => fallback }
        );
      },
    },
    {
      title: "Company",
      key: "company",
      minWidth: 200,
      render(row) {
        const companyId = row.company_id;
        if (companyId) {
          return h(
            NSpace,
            { align: "center", size: 8, wrap: false },
            {
              default: () => [
                h(
                  NAvatar,
                  {
                    round: false,
                    size: 28,
                    src: row.company_logo_url || undefined,
                    style: { flexShrink: "0" },
                  },
                  { default: () => avatarFallback(row.company_label) }
                ),
                h(
                  RouterLink,
                  {
                    to: `/company/${companyId}`,
                    style: "color:#2080f0;text-decoration:none;font-size:0.85rem",
                  },
                  { default: () => row.company_label ?? `${companyId.slice(0, 8)}…` }
                ),
              ],
            }
          );
        }
        const fallback = velvetechCompanyLabel(row);
        if (!fallback) return "—";
        return h(
          NButton,
          { text: true, type: "primary", size: "small", onClick: () => filterByResultText(fallback) },
          { default: () => fallback }
        );
      },
    },
  ];

  return [...head, ...agentCols, ...tail];
});

const companyDetailColumns = computed(() => {
  const base = buildEntityColumns(
    detail.value?.company_field_keys ?? [],
    "company",
    (row) => openEntityDetail(row, velvetechCompanyLabelFromRow(row)),
    "expand"
  );
  const expandCol: DataTableColumns<Record<string, unknown>>[number] = {
    type: "expand",
    expandable: () => true,
    renderExpand(row) {
      return renderCompanyExpand(row);
    },
  };
  return [expandCol, ...base];
});

const contactDetailColumns = computed(() => {
  const base = buildEntityColumns(
    detail.value?.contact_field_keys ?? [],
    "contact",
    (row) => openEntityDetail(row, velvetechContactLabelFromRow(row)),
    "expand"
  );
  const expandCol: DataTableColumns<Record<string, unknown>>[number] = {
    type: "expand",
    expandable: () => true,
    renderExpand(row) {
      return renderContactExpand(row);
    },
  };
  return [expandCol, ...base];
});

const companyExpandedKeys = computed({
  get: () => (expandedCompanyKey.value ? [expandedCompanyKey.value] : []),
  set: (keys: Array<string | number>) => {
    expandedCompanyKey.value = keys.length ? String(keys[keys.length - 1]) : null;
  },
});

const contactExpandedKeys = computed({
  get: () => (expandedContactKey.value ? [expandedContactKey.value] : []),
  set: (keys: Array<string | number>) => {
    expandedContactKey.value = keys.length ? String(keys[keys.length - 1]) : null;
  },
});

function renderCompanyExpand(row: Record<string, unknown>) {
  const dossier = dossierFromMergedCompanyRow(row);
  return h("div", { class: "inline-dossier" }, [
    h("div", { class: "inline-dossier-toolbar" }, [
      h("div", { class: "inline-dossier-heading" }, [
        h("span", { class: "inline-dossier-name" }, velvetechCompanyLabelFromRow(row)),
        row.company_key
          ? h("span", { class: "inline-dossier-key" }, formatCellValue(row.company_key))
          : null,
      ]),
      row.company_id
        ? h("div", { class: "inline-dossier-actions" }, [
            h(
              RouterLink,
              { to: `/company/${row.company_id}`, class: "entity-card-link" },
              { default: () => "View full company card →" }
            ),
            h(
              RouterLink,
              {
                to: {
                  path: "/sequence-studio",
                  query: {
                    companyId: String(row.company_id),
                    eligible: "1",
                    ...(projectStore.selectedProjectId
                      ? { projectId: projectStore.selectedProjectId }
                      : {}),
                  },
                },
                class: "entity-card-link",
              },
              { default: () => "Go to Sequence Studio →" }
            ),
          ])
        : h("span", { class: "muted" }, "No CRM company linked yet"),
    ]),
    dossier
      ? h(CompanyDossier, { dossier })
      : h(NEmpty, { description: "No POV fields on this company row yet", style: "margin: 12px 0" }),
  ]);
}

function renderContactExpand(row: Record<string, unknown>) {
  const en = contactEnrichment(row);
  const exp = Array.isArray(en.experience) ? en.experience : [];
  const experienceNodes = exp.length
    ? h(
        "div",
        { class: "contact-experience-list" },
        exp.map((item) => {
          const e = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
          const title = String(e.title ?? "").trim();
          const company = String(e.company ?? "").trim();
          const dates = [e.date_from, e.date_to].filter(Boolean).join(" → ");
          const desc = String(e.description ?? "").trim();
          return h("div", { class: "contact-experience-item" }, [
            h("div", { class: "contact-experience-head" }, [
              h("strong", {}, [title, company].filter(Boolean).join(" @ ") || "Role"),
              dates ? h("span", { class: "muted" }, dates) : null,
            ]),
            desc ? h("p", { class: "contact-experience-desc" }, desc) : null,
          ]);
        })
      )
    : null;
  const summary = typeof en.summary === "string" ? en.summary.trim() : "";
  const keys = ["persona", "fit", "role_type", "company_key", "contact_key"].filter((k) => row[k] != null);
  return h("div", { class: "inline-contact-detail" }, [
    h("div", { class: "inline-dossier-toolbar" }, [
      h("div", { class: "inline-dossier-heading" }, [
        h("span", { class: "inline-dossier-name" }, velvetechContactLabelFromRow(row)),
        contactTitle(row) ? h("span", { class: "inline-dossier-key" }, contactTitle(row)) : null,
      ]),
      row.contact_id
        ? h(
            RouterLink,
            { to: `/contact/${row.contact_id}`, class: "entity-card-link" },
            { default: () => "View full contact card →" }
          )
        : null,
    ]),
    h(
      "div",
      { class: "funnel-grid" },
      keys.map((key) =>
        h("div", { class: "funnel-chip" }, [
          h("span", { class: "funnel-label" }, humanizeFieldKey(key)),
          h("span", { class: "funnel-value" }, formatCellValue(row[key])),
        ])
      )
    ),
    summary ? h("p", { class: "contact-summary" }, summary) : null,
    experienceNodes,
  ]);
}

const detailFunnelEntries = computed(() => {
  const funnel = detail.value?.summary?.funnel ?? {};
  return FUNNEL_ORDER.filter((k) => funnel[k] != null).map((k) => ({
    key: k,
    label: FUNNEL_LABELS[k] ?? k,
    value: funnel[k],
  }));
});

const CORESIGNAL_CALL_LABELS: Record<string, string> = {
  agentic_search: "Agentic search",
  employee_collect: "Employee collect",
  company_collect: "Company collect",
  jobs_search: "Jobs search",
};

function formatCoresignalBreakdown(callsByType: Record<string, unknown> | undefined): string {
  if (!callsByType || typeof callsByType !== "object") return "—";
  const parts = Object.entries(callsByType)
    .filter(([, v]) => v != null && Number(v) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${CORESIGNAL_CALL_LABELS[k] ?? k}: ${v}`);
  return parts.length ? parts.join(" · ") : "—";
}

const detailCostMetrics = computed(() => {
  const s = detail.value?.summary;
  if (!s) return [];
  const or = ((s.billing ?? {}).openrouter as Record<string, unknown> | undefined) ?? {};
  const tokenEst = or.usd_estimated_from_tokens;
  const orSpent = or.usd_spent;
  return [
    { label: "Total cost", value: formatUsd(s.cost_usd) },
    {
      label: "OpenRouter spent",
      value: orSpent == null ? "n/a (backfill)" : formatUsd(Number(orSpent)),
    },
    {
      label: "OpenRouter balance",
      value:
        or.balance_remaining == null ? "—" : `$${Number(or.balance_remaining).toFixed(2)}`,
    },
    {
      label: "Token estimate",
      value: tokenEst == null ? "—" : formatUsd(Number(tokenEst)),
    },
  ];
});

const detailVendorMetrics = computed(() => {
  const s = detail.value?.summary;
  if (!s?.billing) return [];
  const b = s.billing;
  const or = (b.openrouter as Record<string, unknown> | undefined) ?? {};
  const pr = (b.prospeo as Record<string, unknown> | undefined) ?? {};
  const cs = (b.coresignal as Record<string, unknown> | undefined) ?? {};
  const pa = (b.parallel as Record<string, unknown> | undefined) ?? {};

  const parallelUsd = pa.usd_estimated;
  const searchCalls = pa.search_calls;
  const extractCalls = pa.extract_calls;
  const parallelCalls =
    searchCalls != null || extractCalls != null
      ? [
          searchCalls != null ? `${searchCalls} search` : null,
          extractCalls != null ? `${extractCalls} extract` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  const prospeoCredits = pr.credits_spent;
  const prospeoPages = pr.search_pages_n8n;
  let prospeoValue = "—";
  if (prospeoCredits != null) {
    prospeoValue = `${prospeoCredits} credits spent`;
    if (prospeoPages != null) prospeoValue += ` (${prospeoPages} pages)`;
    if (pr.remaining != null) prospeoValue += ` · ${pr.remaining} left`;
  } else if (prospeoPages != null) {
    prospeoValue = `~${prospeoPages} credits (${prospeoPages} search pages)`;
  }

  const csTotal = cs.credits_estimated;
  const csBreakdown = formatCoresignalBreakdown(
    cs.calls_by_type as Record<string, unknown> | undefined
  );
  const coresignalValue =
    csTotal != null
      ? `${csTotal} credits est.${csBreakdown !== "—" ? ` — ${csBreakdown}` : ""}`
      : csBreakdown;

  const metrics: Array<{ label: string; value: string; hint?: string }> = [
    {
      label: "OpenRouter",
      value: or.llm_calls == null ? "—" : `${or.llm_calls} LLM calls`,
      hint: "LLM API usage (see token estimate above)",
    },
    {
      label: "Parallel",
      value:
        parallelUsd == null && !parallelCalls
          ? "—"
          : [
              parallelUsd != null ? formatUsd(Number(parallelUsd)) : null,
              parallelCalls ? parallelCalls : null,
            ]
              .filter(Boolean)
              .join(" · "),
      hint: "Web search + extract (api.parallel.ai)",
    },
    {
      label: "Prospeo",
      value: prospeoValue,
      hint: "1 credit per person search page",
    },
    {
      label: "CoreSignal",
      value: coresignalValue,
      hint: "agentic/company collect 2cr · jobs 1cr · employee collect 2cr",
    },
  ];

  if (s.tokens_by_stage && Object.keys(s.tokens_by_stage).length) {
    const parts = Object.entries(s.tokens_by_stage)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([stage, tok]) => `${stage}: ${Number(tok).toLocaleString()}`);
    metrics.push({
      label: "OpenRouter tokens",
      value: parts.join(" · "),
      hint: "Tokens by pipeline stage",
    });
  }

  return metrics.filter((m) => m.value !== "—");
});
</script>

<template>
  <NCard>
    <template #header>
      <NSpace align="center" justify="space-between" style="width: 100%">
        <span>n8n workflow results</span>
        <NSpace>
          <NButton
            v-if="pageMode !== 'executions'"
            size="small"
            quaternary
            @click="backToExecutions"
          >
            Executions
          </NButton>
          <NButton
            v-if="pageMode !== 'rows'"
            size="small"
            quaternary
            @click="openAllRows"
          >
            All rows
          </NButton>
        </NSpace>
      </NSpace>
    </template>

    <NSpace v-if="pageMode === 'executions'" vertical size="medium" style="width: 100%">
      <p class="muted">Velvetech batch runs — cost and funnel stats. Select a run for stage + entity detail.</p>
      <NAlert v-if="execError" type="error">{{ execError }}</NAlert>
      <NDataTable
        :columns="execColumns"
        :data="execRows"
        :loading="execLoading"
        :scroll-x="1200"
        size="small"
        striped
      />
      <div class="pager">
        <NPagination
          :page="execPage"
          :page-count="execPageCount"
          :disabled="execLoading"
          @update:page="(p: number) => (execPage = p)"
        />
        <span class="muted total-line">Total runs: {{ execTotal }}</span>
      </div>
    </NSpace>

    <NSpace v-else-if="pageMode === 'detail'" vertical size="medium" style="width: 100%">
      <NButton size="small" quaternary @click="backToExecutions">← Back to executions</NButton>
      <NAlert v-if="detailError" type="error">{{ detailError }}</NAlert>
      <template v-if="detail?.summary">
        <NSpace wrap>
          <NTag type="info">{{ detail.summary.run_id }}</NTag>
          <NTag>exec {{ detail.summary.execution_id ?? "—" }}</NTag>
          <NTag :type="detail.summary.status === 'success' ? 'success' : 'default'">
            {{ detail.summary.status }}
          </NTag>
          <NTag>{{ formatDuration(detail.summary.duration_sec) }}</NTag>
          <NTag type="warning">{{ formatUsd(detail.summary.cost_usd) }}</NTag>
        </NSpace>
      </template>

      <NTabs v-model:value="detailTab" type="segment" animated style="margin-top: 4px">
        <NTabPane name="research" tab="Research">
          <p class="muted">
            Click a company or contact to expand research on this page. Open the full CRM card from the bar above the dossier.
          </p>
          <template v-if="detail?.companies?.length">
            <h4 class="section-title">Companies ({{ detail.companies.length }})</h4>
            <NDataTable
              v-model:expanded-row-keys="companyExpandedKeys"
              :columns="companyDetailColumns"
              :data="detail.companies"
              :loading="detailLoading"
              size="small"
              :scroll-x="Math.min(1400, 320 + companyDetailColumns.length * 130)"
              :max-height="520"
              :row-key="(row) => entityRowKey('company', row)"
            />
          </template>
          <template v-if="detail?.contacts?.length">
            <h4 class="section-title">Contacts ({{ detail.contacts.length }})</h4>
            <NDataTable
              v-model:expanded-row-keys="contactExpandedKeys"
              :columns="contactDetailColumns"
              :data="detail.contacts"
              :loading="detailLoading"
              size="small"
              :scroll-x="Math.min(1400, 320 + contactDetailColumns.length * 130)"
              :max-height="560"
              :row-key="(row) => entityRowKey('contact', row)"
            />
          </template>
          <NAlert v-else-if="detail && !detailLoading && !detail.contacts?.length" type="info">
            No contact rows found for this run.
          </NAlert>
        </NTabPane>

        <NTabPane name="credit" tab="Credit usage">
          <NAlert v-if="detail?.summary?.warnings?.includes('no_billing_row')" type="warning">
            No billing row yet for this run — re-run with <code>--billing</code> on future batches for cost snapshots.
          </NAlert>
          <div v-if="detailCostMetrics.length" class="funnel-section">
            <h4 class="section-title">Cost summary</h4>
            <div class="funnel-grid">
              <div v-for="m in detailCostMetrics" :key="m.label" class="funnel-cell">
                <div class="funnel-label">{{ m.label }}</div>
                <div class="funnel-value metric-value">{{ m.value }}</div>
              </div>
            </div>
          </div>
          <div v-if="detailVendorMetrics.length" class="funnel-section">
            <h4 class="section-title">Vendor usage</h4>
            <div class="vendor-grid">
              <div v-for="m in detailVendorMetrics" :key="m.label" class="vendor-cell">
                <div class="funnel-label">{{ m.label }}</div>
                <div class="funnel-value metric-value">{{ m.value }}</div>
                <div v-if="m.hint" class="vendor-hint">{{ m.hint }}</div>
              </div>
            </div>
          </div>
          <template v-if="llmBreakdown">
            <div class="billing-section">
              <div class="billing-section-header">
                <h4 class="section-title">LLM cost breakdown</h4>
                <NSpace wrap size="small">
                  <NButton
                    size="tiny"
                    :type="llmChartMode === 'usd' ? 'primary' : 'default'"
                    @click="llmChartMode = 'usd'"
                  >
                    USD
                  </NButton>
                  <NButton
                    size="tiny"
                    :type="llmChartMode === 'tokens' ? 'primary' : 'default'"
                    @click="llmChartMode = 'tokens'"
                  >
                    Tokens
                  </NButton>
                </NSpace>
              </div>
              <p class="muted billing-note">
                Bar values use OpenRouter list price × tokens per call. Wallet spend can differ (cache, concurrent usage).
              </p>
              <div class="billing-charts">
                <div v-if="llmStageChartRows.length" class="billing-chart-card">
                  <div class="billing-chart-title">By pipeline stage</div>
                  <VChart :option="llmStageChartOption" autoresize class="billing-chart" />
                </div>
                <div v-if="llmModelChartRows.length" class="billing-chart-card">
                  <div class="billing-chart-title">By model</div>
                  <VChart :option="llmModelChartOption" autoresize class="billing-chart" />
                </div>
                <div v-if="llmCompanyChartRows.length" class="billing-chart-card">
                  <div class="billing-chart-title">By company</div>
                  <VChart :option="llmCompanyChartOption" autoresize class="billing-chart" />
                </div>
              </div>
              <template v-if="llmLineItemRows.length">
                <h4 class="section-title">Per call (stage · model · row)</h4>
                <NDataTable
                  :columns="llmLineItemColumns"
                  :data="llmLineItemRows"
                  size="small"
                  :max-height="320"
                />
              </template>
            </div>
          </template>
          <NAlert
            v-else-if="detail?.summary && !detail.summary.warnings?.includes('no_billing_row')"
            type="info"
          >
            No LLM breakdown on this billing row — re-run with <code>--billing</code> or backfill after updating the billing script.
          </NAlert>
        </NTabPane>

        <NTabPane name="health" tab="Workflow Health">
          <NAlert
            v-if="detail?.summary?.warnings?.some((w) => w.startsWith('funnel_fetch_failed'))"
            type="warning"
          >
            Billing funnel fetch failed during post-run — pipeline funnel below is computed from persisted stage rows.
          </NAlert>
          <NAlert v-if="detail?.summary?.warnings?.includes('no_billing_row')" type="warning">
            No billing row yet — completeness metrics still use stage-row funnel counts.
          </NAlert>
          <div v-if="healthMetrics.length" class="funnel-section">
            <h4 class="section-title">Completeness</h4>
            <div class="vendor-grid">
              <div v-for="m in healthMetrics" :key="m.label" class="vendor-cell">
                <div class="funnel-label">{{ m.label }}</div>
                <div class="funnel-value metric-value">{{ m.value }}</div>
                <div v-if="m.hint" class="vendor-hint">{{ m.hint }}</div>
              </div>
            </div>
          </div>
          <div v-if="detailFunnelEntries.length" class="funnel-section">
            <h4 class="section-title">Pipeline funnel</h4>
            <div class="funnel-grid">
              <div v-for="entry in detailFunnelEntries" :key="entry.key" class="funnel-cell">
                <div class="funnel-label">{{ entry.label }}</div>
                <div class="funnel-value">{{ entry.value }}</div>
              </div>
            </div>
          </div>
          <NEmpty
            v-else-if="!detailLoading"
            description="No funnel metrics for this run yet"
            style="margin-top: 16px"
          />
        </NTabPane>
      </NTabs>
    </NSpace>

    <NSpace v-else vertical size="medium" style="width: 100%">
      <NSpace vertical size="small" style="width: 100%">
        <NSpace align="center" wrap>
          <NButton size="small" @click="addFilterRow">Add filter</NButton>
          <NButton type="primary" size="small" :disabled="loading" @click="applyFiltersToRoute">
            Apply filters
          </NButton>
          <NButton quaternary size="small" :disabled="loading" @click="clearFilters">Clear all</NButton>
          <NTag v-if="route.query.filters && String(route.query.filters).length >= 1600" size="small" type="warning">
            Filter state too large for URL; bookmark may omit filters
          </NTag>
        </NSpace>

        <div v-for="(row, i) in filterRows" :key="i" class="filter-row">
          <NSelect
            v-model:value="row.field"
            placeholder="Field"
            clearable
            style="width: 220px"
            :options="FIELD_OPTIONS"
            :disabled="loading"
            @update:value="() => onFieldChange(row)"
          />
          <NSelect
            v-model:value="row.op"
            placeholder="Operator"
            clearable
            style="width: 160px"
            :options="opsForField(row.field)"
            :disabled="loading || !row.field"
          />
          <NDatePicker
            v-if="row.field === 'created_at'"
            :value="row._ts ?? null"
            type="datetime"
            clearable
            style="width: 280px"
            :disabled="loading"
            @update:value="
              (v: number | null) => {
                row._ts = v ?? undefined;
                row.value = v ? new Date(v).toISOString() : '';
              }
            "
          />
          <NInput
            v-else
            v-model:value="row.value"
            placeholder="Value"
            clearable
            style="min-width: 200px; flex: 1"
            :disabled="loading"
          />
          <NButton quaternary size="tiny" :disabled="loading" @click="removeFilterRow(i)">Remove</NButton>
        </div>
      </NSpace>

      <NAlert v-if="loadError" type="error">{{ loadError }}</NAlert>

      <NDataTable
        :columns="columns"
        :data="rows"
        :loading="loading"
        :scroll-x="Math.min(3200, 900 + agentKeyUnion.length * 170)"
        :max-height="640"
        size="small"
        striped
      />

      <div class="pager">
        <NPagination
          :page="page"
          :page-count="pageCount"
          :disabled="loading"
          @update:page="(p: number) => (page = p)"
        />
        <span class="muted total-line">Total rows: {{ total }}</span>
      </div>
    </NSpace>

    <NDrawer v-model:show="drawerOpen" :width="520" placement="right">
      <NDrawerContent :title="`Result JSON (${drawerTitle})`" closable>
        <pre class="json-pre">{{ drawerJson }}</pre>
      </NDrawerContent>
    </NDrawer>
  </NCard>
</template>

<style scoped>
.muted {
  font-size: 0.875rem;
  opacity: 0.75;
}
.pager {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.total-line {
  margin-left: auto;
}
.json-pre {
  margin: 0;
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 70vh;
  overflow: auto;
}
.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}
.funnel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.5rem;
}
.funnel-cell {
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
}
.funnel-label {
  font-size: 0.75rem;
  opacity: 0.7;
}
.funnel-value {
  font-size: 1.1rem;
  font-weight: 600;
}
.metric-value {
  font-size: 0.95rem;
  font-weight: 500;
}
.funnel-section {
  margin-top: 0.5rem;
}
.vendor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.5rem;
}
.vendor-cell {
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
}
.vendor-hint {
  font-size: 0.7rem;
  opacity: 0.6;
  margin-top: 0.25rem;
}
.section-title {
  margin: 0.75rem 0 0.25rem;
  font-size: 0.95rem;
}
.billing-section {
  margin-top: 0.5rem;
  padding-top: 0.25rem;
  border-top: 1px solid rgba(128, 128, 128, 0.2);
}
.billing-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.billing-note {
  margin: 0.25rem 0 0.75rem;
}
.billing-charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
  margin-bottom: 0.75rem;
}
.billing-chart-card {
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 8px;
  padding: 0.5rem 0.75rem 0.25rem;
}
.billing-chart-title {
  font-size: 0.8rem;
  opacity: 0.8;
  margin-bottom: 0.25rem;
}
.billing-chart {
  width: 100%;
  height: 220px;
}
.inline-dossier,
.inline-contact-detail {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.04);
}
.inline-dossier-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}
.inline-dossier-heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.inline-dossier-name {
  font-weight: 600;
  font-size: 0.95rem;
}
.inline-dossier-key {
  font-size: 0.75rem;
  opacity: 0.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.inline-dossier-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 18px;
}
.contact-summary {
  margin: 8px 0;
  font-size: 0.85rem;
  line-height: 1.45;
  opacity: 0.9;
}
.contact-experience-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}
.contact-experience-item {
  padding: 8px 10px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
}
.contact-experience-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.85rem;
}
.contact-experience-desc {
  margin: 6px 0 0;
  font-size: 0.8rem;
  line-height: 1.4;
  opacity: 0.85;
}
.entity-card-link {
  color: #38bdf8;
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 500;
  white-space: nowrap;
}
.entity-card-link:hover {
  text-decoration: underline;
}
:deep(.entity-expand-cell) {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
:deep(.entity-expand-btn) {
  color: #38bdf8;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  text-align: left;
  line-height: 1.3;
}
:deep(.entity-expand-btn.is-active) {
  font-weight: 700;
}
</style>
