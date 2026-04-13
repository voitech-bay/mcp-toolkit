<script setup lang="ts">
import { computed, h, ref, watch } from "vue";
import {
  NH1,
  NH3,
  NCard,
  NSpin,
  NAlert,
  NText,
  NSpace,
  NDatePicker,
  NSelect,
  NButton,
  NDataTable,
  NTag,
  NTooltip,
  NGrid,
  NGi,
  NTabs,
  NTabPane,
} from "naive-ui";
import type { SelectOption, SelectGroupOption, DataTableColumns } from "naive-ui";
import { useDark } from "@vueuse/core";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { BarChart, FunnelChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
} from "echarts/components";
import type { EChartsOption } from "echarts";
import VChart from "vue-echarts";
import { useProjectStore } from "../stores/project";

use([
  CanvasRenderer,
  BarChart,
  FunnelChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
]);

/** Avoid merge stacking + layout feedback with autoresize (see ECharts setOption). */
const chartUpdateOptions = { notMerge: true as const };

const projectStore = useProjectStore();
const isDark = useDark();

const dashboardTab = ref<"rankings" | "totals" | "funnels">("rankings");

interface FlowFunnelRow {
  flowUuid: string;
  flowName: string;
  connectionSent: number;
  connectionAccepted: number;
  inbox: number;
  positiveReplies: number;
}

interface FlowFunnelProjectTotalsPayload {
  connectionSent: number;
  connectionAccepted: number;
  inbox: number;
  positiveReplies: number;
  acceptedRatePct: number | null;
  inboxRatePct: number | null;
}

interface FlowFunnelComparisonPayload {
  previousDateFrom: string;
  previousDateTo: string;
  totals: FlowFunnelProjectTotalsPayload;
}

const EMPTY_FUNNEL_TOTALS: FlowFunnelProjectTotalsPayload = {
  connectionSent: 0,
  connectionAccepted: 0,
  inbox: 0,
  positiveReplies: 0,
  acceptedRatePct: null,
  inboxRatePct: null,
};

interface RankedFlow extends FlowFunnelRow {
  positiveRatePct: number;
  acceptedRatePct: number;
  inboxRatePct: number;
  hasSent: boolean;
}

const DEFAULT_CHART_FLOW_COUNT = 4;

/** Rotate for flow picker tags (Conversations-style visual variety). */
const FLOW_TAG_EMOJIS = [
  "📨",
  "📬",
  "🎯",
  "🌊",
  "⚡",
  "🔁",
  "✉️",
  "🧭",
  "📣",
  "🚀",
  "💬",
  "🔔",
] as const;

const STAGE_LABELS = [
  "Connection sent",
  "Connection accepted",
  "Inbox",
  "Positive replies",
] as const;

const collectingDays = ref(false);
const loading = ref(false);
const loadError = ref("");
const warnings = ref<string[]>([]);
const flows = ref<FlowFunnelRow[]>([]);
/** Last API aggregates (all flows); prior window from backend. */
const funnelProjectTotals = ref<FlowFunnelProjectTotalsPayload | null>(null);
const funnelComparison = ref<FlowFunnelComparisonPayload | null>(null);
/** Collected snapshot YYYY-MM-DD (asc) for snapping period presets. */
const analyticsDatesAsc = ref<string[]>([]);
/** Inclusive calendar days ending at last collected day (default 7). */
const statsWindowDays = ref<number>(7);
const statsWindowOptions: SelectOption[] = [
  { label: "7 days", value: 7 },
  { label: "10 days", value: 10 },
  { label: "2 weeks (14)", value: 14 },
  { label: "3 weeks (21)", value: 21 },
  { label: "4 weeks (28)", value: 28 },
];

const selectedFlowUuids = ref<string[]>([]);
/** Naive UI daterange: [startMs, endMs] */
const dateRange = ref<[number, number] | null>(null);

/** Name-sorted list for tag strip (stable emoji index). */
const flowsSortedForPicker = computed(() =>
  [...flows.value].sort((a, b) =>
    a.flowName.localeCompare(b.flowName, undefined, { sensitivity: "base" })
  )
);

function flowPickerEmoji(index: number): string {
  return FLOW_TAG_EMOJIS[index % FLOW_TAG_EMOJIS.length]!;
}

function isFlowUuidSelected(flowUuid: string): boolean {
  return selectedFlowUuids.value.includes(flowUuid);
}

function toggleFlowSelection(flowUuid: string): void {
  const cur = selectedFlowUuids.value;
  const i = cur.indexOf(flowUuid);
  if (i >= 0) {
    selectedFlowUuids.value = cur.filter((id) => id !== flowUuid);
  } else {
    selectedFlowUuids.value = [...cur, flowUuid];
  }
}

function selectAllPickerFlows(): void {
  selectedFlowUuids.value = flows.value.map((f) => f.flowUuid);
}

function clearPickerFlows(): void {
  selectedFlowUuids.value = [];
}

/** When >4 flows, default charts to top-N by connection sent (volume). */
function defaultSelectedUuidsForCharts(list: FlowFunnelRow[]): string[] {
  if (list.length <= DEFAULT_CHART_FLOW_COUNT) {
    return list.map((f) => f.flowUuid);
  }
  return [...list]
    .sort(
      (a, b) =>
        b.connectionSent - a.connectionSent ||
        a.flowName.localeCompare(b.flowName, undefined, { sensitivity: "base" })
    )
    .slice(0, DEFAULT_CHART_FLOW_COUNT)
    .map((f) => f.flowUuid);
}

watch(
  flows,
  (list) => {
    if (list.length === 0) {
      selectedFlowUuids.value = [];
      return;
    }
    const idSet = new Set(list.map((f) => f.flowUuid));
    const kept = selectedFlowUuids.value.filter((id) => idSet.has(id));
    selectedFlowUuids.value =
      kept.length > 0 ? kept : defaultSelectedUuidsForCharts(list);
  },
  { deep: true }
);

const filteredFlows = computed(() =>
  flows.value.filter((f) => selectedFlowUuids.value.includes(f.flowUuid))
);

type RankSortMetric =
  | "positiveReplyRate"
  | "inboxRate"
  | "acceptedRate"
  | "connectionSent"
  | "connectionAccepted"
  | "inbox"
  | "positiveReplies";

function enrichFlowsToRanked(list: FlowFunnelRow[]): RankedFlow[] {
  return list.map((f) => ({
    ...f,
    hasSent: f.connectionSent > 0,
    positiveRatePct:
      f.connectionSent > 0 ? (100 * f.positiveReplies) / f.connectionSent : 0,
    acceptedRatePct:
      f.connectionSent > 0 ? (100 * f.connectionAccepted) / f.connectionSent : 0,
    inboxRatePct:
      f.connectionSent > 0 ? (100 * f.inbox) / f.connectionSent : 0,
  }));
}

function sortRankedByMetric(
  list: RankedFlow[],
  metric: RankSortMetric
): RankedFlow[] {
  if (
    metric === "positiveReplyRate" ||
    metric === "inboxRate" ||
    metric === "acceptedRate"
  ) {
    const rateKey =
      metric === "positiveReplyRate"
        ? ("positiveRatePct" as const)
        : metric === "inboxRate"
          ? ("inboxRatePct" as const)
          : ("acceptedRatePct" as const);
    return [...list].sort((a, b) => {
      if (a.hasSent !== b.hasSent) return a.hasSent ? -1 : 1;
      const av = a[rateKey];
      const bv = b[rateKey];
      if (bv !== av) return bv - av;
      return b.connectionSent - a.connectionSent;
    });
  }
  const field =
    metric === "connectionSent"
      ? ("connectionSent" as const)
      : metric === "connectionAccepted"
        ? ("connectionAccepted" as const)
        : metric === "inbox"
          ? ("inbox" as const)
          : ("positiveReplies" as const);
  return [...list].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (bv !== av) return bv - av;
    if (b.connectionSent !== a.connectionSent) {
      return b.connectionSent - a.connectionSent;
    }
    return a.flowName.localeCompare(b.flowName, undefined, { sensitivity: "base" });
  });
}

const rankSortMetric = ref<RankSortMetric>("positiveReplyRate");

const rankMetricSelectOptions: Array<SelectOption | SelectGroupOption> = [
  {
    type: "group",
    key: "rank-rates",
    label: "Rates (÷ connection sent)",
    children: [
      { label: "Positive reply rate", value: "positiveReplyRate" },
      { label: "Inbox rate", value: "inboxRate" },
      { label: "Accepted rate", value: "acceptedRate" },
    ],
  },
  {
    type: "group",
    key: "rank-counts",
    label: "Absolute counts",
    children: [
      { label: "Connection sent", value: "connectionSent" },
      { label: "Connection accepted", value: "connectionAccepted" },
      { label: "Inbox", value: "inbox" },
      { label: "Positive replies", value: "positiveReplies" },
    ],
  },
];

const rankTablesCardTitle = computed(() => {
  const t: Record<RankSortMetric, string> = {
    positiveReplyRate: "positive reply rate",
    inboxRate: "inbox rate",
    acceptedRate: "accepted rate",
    connectionSent: "connection sent",
    connectionAccepted: "connection accepted",
    inbox: "inbox count",
    positiveReplies: "positive replies count",
  };
  return `Top & least by ${t[rankSortMetric.value]}`;
});

const rankedFlows = computed(() =>
  sortRankedByMetric(enrichFlowsToRanked(flows.value), rankSortMetric.value)
);

const displayFunnelTotals = computed(
  (): FlowFunnelProjectTotalsPayload =>
    funnelProjectTotals.value ?? EMPTY_FUNNEL_TOTALS
);

const prevFunnelTotals = computed(
  () => funnelComparison.value?.totals ?? null
);

function countChangeMeta(
  curr: number,
  prev: number | undefined
): { text: string; type: "default" | "success" | "error" } | null {
  if (prev === undefined) return null;
  if (prev <= 0 && curr <= 0) return null;
  if (prev <= 0) return curr > 0 ? { text: "new", type: "success" as const } : null;
  const pct = ((curr - prev) / prev) * 100;
  const type =
    Math.abs(pct) < 0.05
      ? ("default" as const)
      : pct > 0
        ? ("success" as const)
        : ("error" as const);
  return { text: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, type };
}

function rateChangeMeta(
  curr: number | null,
  prev: number | null
): { text: string; type: "default" | "success" | "error" } | null {
  if (curr == null || prev == null) return null;
  const pp = curr - prev;
  const type =
    Math.abs(pp) < 0.05
      ? ("default" as const)
      : pp > 0
        ? ("success" as const)
        : ("error" as const);
  return { text: `${pp >= 0 ? "+" : ""}${pp.toFixed(1)} pp`, type };
}

const deltaSent = computed(() =>
  countChangeMeta(
    displayFunnelTotals.value.connectionSent,
    prevFunnelTotals.value?.connectionSent
  )
);
const deltaAccepted = computed(() =>
  countChangeMeta(
    displayFunnelTotals.value.connectionAccepted,
    prevFunnelTotals.value?.connectionAccepted
  )
);
const deltaInbox = computed(() =>
  countChangeMeta(displayFunnelTotals.value.inbox, prevFunnelTotals.value?.inbox)
);
const deltaPositive = computed(() =>
  countChangeMeta(
    displayFunnelTotals.value.positiveReplies,
    prevFunnelTotals.value?.positiveReplies
  )
);
const deltaAccRate = computed(() =>
  rateChangeMeta(
    displayFunnelTotals.value.acceptedRatePct,
    prevFunnelTotals.value?.acceptedRatePct ?? null
  )
);
const deltaInboxRate = computed(() =>
  rateChangeMeta(
    displayFunnelTotals.value.inboxRatePct,
    prevFunnelTotals.value?.inboxRatePct ?? null
  )
);

/** Matrix columns = selected flows only, order matches the multiselect. */
const matrixColumnFlows = computed((): RankedFlow[] => {
  const byId = new Map(rankedFlows.value.map((f) => [f.flowUuid, f]));
  const out: RankedFlow[] = [];
  for (const id of selectedFlowUuids.value) {
    const r = byId.get(id);
    if (r) out.push(r);
  }
  return out;
});

const baselineFlowUuid = ref<string | null>(null);

watch(
  matrixColumnFlows,
  (cols) => {
    if (cols.length === 0) {
      baselineFlowUuid.value = null;
      return;
    }
    const ok =
      baselineFlowUuid.value &&
      cols.some((c) => c.flowUuid === baselineFlowUuid.value);
    if (!ok) baselineFlowUuid.value = cols[0]!.flowUuid;
  },
  { immediate: true }
);

const baselineOptions = computed<SelectOption[]>(() =>
  matrixColumnFlows.value.map((f) => ({ label: f.flowName, value: f.flowUuid }))
);

/** Baseline column first, then the rest (stable order). */
const orderedMatrixColumns = computed((): RankedFlow[] => {
  const cols = matrixColumnFlows.value;
  const bid = baselineFlowUuid.value;
  if (!bid || cols.length === 0) return cols;
  const base = cols.find((c) => c.flowUuid === bid);
  const rest = cols.filter((c) => c.flowUuid !== bid);
  return base ? [base, ...rest] : cols;
});

type MatrixMetricField =
  | keyof FlowFunnelRow
  | "positiveRatePct"
  | "acceptedRatePct"
  | "inboxRatePct";

interface MatrixRowDef {
  key: string;
  label: string;
  field: MatrixMetricField;
}

const MATRIX_ROW_DEFS: MatrixRowDef[] = [
  { key: "sent", label: "Connection sent", field: "connectionSent" },
  { key: "acc", label: "Connection accepted", field: "connectionAccepted" },
  { key: "accRate", label: "Accepted rate (÷ sent)", field: "acceptedRatePct" },
  { key: "inb", label: "Inbox", field: "inbox" },
  { key: "inbRate", label: "Inbox rate (÷ sent)", field: "inboxRatePct" },
  { key: "pos", label: "Positive replies", field: "positiveReplies" },
  { key: "rate", label: "Positive reply rate", field: "positiveRatePct" },
];

function matrixDataRowKey(row: MatrixRowDef): string {
  return row.key;
}

/** MATRIX_ROW_DEFS row key for the metric currently used to rank Top/Least tables. */
const rankSortMetricRowKey = computed((): string => {
  switch (rankSortMetric.value) {
    case "positiveReplyRate":
      return "rate";
    case "inboxRate":
      return "inbRate";
    case "acceptedRate":
      return "accRate";
    case "connectionSent":
      return "sent";
    case "connectionAccepted":
      return "acc";
    case "inbox":
      return "inb";
    case "positiveReplies":
      return "pos";
    default:
      return "rate";
  }
});

function metricValue(f: RankedFlow, field: MatrixMetricField): number {
  if (field === "positiveRatePct") return f.positiveRatePct;
  if (field === "acceptedRatePct") return f.acceptedRatePct;
  if (field === "inboxRatePct") return f.inboxRatePct;
  return f[field] as number;
}

function formatInt(n: number): string {
  return new Intl.NumberFormat().format(Math.round(n));
}

type RankMatrixBadgeKind = "best" | "ref";

function renderMatrixCell(
  row: MatrixRowDef,
  flow: RankedFlow,
  baselineFlow: RankedFlow | null,
  cellOpts?: {
    /** When set, baseline column + this metric row shows a visible badge (rank tables). */
    rankBaselineBadge?: RankMatrixBadgeKind;
  }
): ReturnType<typeof h> {
  const v = metricValue(flow, row.field);
  const isBaseline =
    baselineFlow != null && flow.flowUuid === baselineFlow.flowUuid;
  const bVal =
    baselineFlow != null ? metricValue(baselineFlow, row.field) : null;

  let diffPct: number | null = null;
  if (!isBaseline && baselineFlow && bVal != null && bVal > 0) {
    diffPct = ((v - bVal) / bVal) * 100;
  }

  const isRateRow =
    row.field === "positiveRatePct" ||
    row.field === "acceptedRatePct" ||
    row.field === "inboxRatePct";
  const numStr = isRateRow
    ? flow.hasSent
      ? `${v.toFixed(1)}%`
      : "—"
    : formatInt(v);

  const showRankBadge =
    cellOpts?.rankBaselineBadge != null &&
    isBaseline &&
    baselineFlow != null &&
    row.key === rankSortMetricRowKey.value;

  const badgeLabel = cellOpts?.rankBaselineBadge === "ref" ? "Ref" : "Best";
  const badgeType =
    cellOpts?.rankBaselineBadge === "ref" ? ("warning" as const) : ("success" as const);

  const valueBlock = showRankBadge
    ? h(NSpace, { size: 6, class: "flow-dash__matrix-sort-baseline" }, [
      h(
        NTag,
        {
          size: "small",
          type: badgeType,
          bordered: false,
          class: "flow-dash__matrix-sort-badge",
        },
        () => badgeLabel
      ),
      h("span", { class: "flow-dash__matrix-num flow-dash__matrix-num--badged" }, numStr),
    ])
    : h("span", { class: "flow-dash__matrix-num" }, numStr);

  const children: ReturnType<typeof h>[] = [valueBlock];
  if (!isBaseline && diffPct !== null && Number.isFinite(diffPct)) {
    const t =
      Math.abs(diffPct) < 0.05
        ? ("default" as const)
        : diffPct > 0
          ? ("success" as const)
          : ("error" as const);
    children.push(
      h(
        NTag,
        { size: "small", bordered: false, type: t },
        () => `${diffPct! > 0 ? "+" : ""}${diffPct!.toFixed(1)}%`
      )
    );
  }

  return h(
    NSpace,
    {
      size: 6,
      align: "center",
      wrap: false,
      style: "justify-content: flex-end; flex-wrap: nowrap;",
    },
    { default: () => children }
  );
}

function buildMetricMatrixColumns(
  columnFlows: RankedFlow[],
  baselineFlow: RankedFlow | null,
  titleForFlow: (f: RankedFlow, isBaseline: boolean) => string,
  options?: { rankBaselineBadge?: RankMatrixBadgeKind }
): DataTableColumns<MatrixRowDef> {
  const rankBadge = options?.rankBaselineBadge;
  return [
    {
      title: "Metric",
      key: "label",
      width: 170,
      fixed: "left",
    },
    ...columnFlows.map((f) => {
      const isBaseline =
        baselineFlow != null && f.flowUuid === baselineFlow.flowUuid;
      return {
        title: titleForFlow(f, isBaseline),
        key: f.flowUuid,
        align: "right" as const,
        minWidth: 128,
        ellipsis: { tooltip: true },
        render(row: MatrixRowDef) {
          return rankBadge != null
            ? renderMatrixCell(row, f, baselineFlow, { rankBaselineBadge: rankBadge })
            : renderMatrixCell(row, f, baselineFlow);
        },
      };
    }),
  ];
}

const performanceMatrixColumns = computed((): DataTableColumns<MatrixRowDef> => {
  const flows = orderedMatrixColumns.value;
  const bid = baselineFlowUuid.value;
  const baselineFlow =
    bid != null ? flows.find((f) => f.flowUuid === bid) ?? null : null;
  return buildMetricMatrixColumns(
    flows,
    baselineFlow,
    (f, isBaseline) =>
      isBaseline ? `${f.flowName} · baseline` : f.flowName
  );
});

interface RankedFlowRow extends RankedFlow {
  rank: number;
}

const rankedFlowRows = computed((): RankedFlowRow[] =>
  rankedFlows.value.map((f, i) => ({ ...f, rank: i + 1 }))
);

const showSplitRankTables = computed(() => rankedFlows.value.length > 5);

const topPerformersTableData = computed((): RankedFlowRow[] => {
  const r = rankedFlowRows.value;
  if (r.length <= 5) return r;
  return r.slice(0, 5);
});

const leastPerformersTableData = computed((): RankedFlowRow[] => {
  const r = rankedFlowRows.value;
  if (r.length <= 5) return [];
  return r.slice(-5).reverse();
});

function rankMatrixColumnTitle(f: RankedFlow, isBaseline: boolean): string {
  const r = (f as RankedFlowRow).rank;
  return isBaseline ? `#${r} ${f.flowName} · baseline` : `#${r} ${f.flowName}`;
}

/** Same layout as “Selected flows”: rows = metrics, columns = flows; baseline = leftmost column. */
const topRankMatrixColumns = computed((): DataTableColumns<MatrixRowDef> => {
  const flows = topPerformersTableData.value;
  const baseline = flows[0] ?? null;
  return buildMetricMatrixColumns(flows, baseline, rankMatrixColumnTitle, {
    rankBaselineBadge: "best",
  });
});

const leastRankMatrixColumns = computed((): DataTableColumns<MatrixRowDef> => {
  const flows = leastPerformersTableData.value;
  const baseline = flows[0] ?? null;
  return buildMetricMatrixColumns(flows, baseline, rankMatrixColumnTitle, {
    rankBaselineBadge: "ref",
  });
});

const allFlowsRankMatrixColumns = computed((): DataTableColumns<MatrixRowDef> => {
  const flows = topPerformersTableData.value;
  const baseline = flows[0] ?? null;
  return buildMetricMatrixColumns(flows, baseline, rankMatrixColumnTitle, {
    rankBaselineBadge: "best",
  });
});

function tsToYmdLocal(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Inclusive window ending at last collected snapshot day, clamped to first collected day. */
function defaultRangeForWindow(
  sortedAsc: string[],
  windowDays: number
): [number, number] | null {
  if (sortedAsc.length === 0 || windowDays < 1) return null;
  const sorted = [...sortedAsc].sort();
  const last = sorted[sorted.length - 1]!;
  const first = sorted[0]!;
  const end = new Date(`${last}T12:00:00`).getTime();
  const endDate = new Date(end);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (windowDays - 1));
  const firstMs = new Date(`${first}T12:00:00`).getTime();
  const start = Math.max(startDate.getTime(), firstMs);
  return [start, end];
}

function flowColor(index: number, alpha: number): string {
  const hue = (index * 47) % 360;
  return `hsla(${hue}, 62%, 52%, ${alpha})`;
}

function chartTextColor(dark: boolean): string {
  return dark ? "rgba(255, 255, 255, 0.78)" : "rgba(0, 0, 0, 0.72)";
}

function splitLineColor(dark: boolean): string {
  return dark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
}

function pctVsSent(f: FlowFunnelRow): number[] {
  const s = f.connectionSent;
  if (s <= 0) return [0, 0, 0, 0];
  const pct = (v: number) => Math.round((10_000 * v) / s) / 100;
  return [100, pct(f.connectionAccepted), pct(f.inbox), pct(f.positiveReplies)];
}

/** Stage rows + segment colors (funnel-customize style). */
function funnelStagesData(f: FlowFunnelRow, flowIndex: number) {
  const vals = [
    f.connectionSent,
    f.connectionAccepted,
    f.inbox,
    f.positiveReplies,
  ] as const;
  return STAGE_LABELS.map((name, i) => ({
    value: vals[i],
    name,
    itemStyle: {
      color: flowColor(flowIndex * 4 + i, 0.82),
    },
  }));
}

function labelRichOuter(tc: string) {
  return {
    formatter: "{bb|{b}}\n{vv|{c}}",
    rich: {
      bb: {
        fontSize: 13,
        fontWeight: "bold" as const,
        color: tc,
        lineHeight: 20,
      },
      vv: {
        fontSize: 12,
        color: tc,
        opacity: 0.88,
        lineHeight: 18,
      },
    },
  };
}

/** Apache “boundaries” example: outer + inner funnel same box, inner z:100, maxSize smaller. */
function overlayTwoFlowsSeries(
  outer: FlowFunnelRow,
  inner: FlowFunnelRow,
  dark: boolean,
  tc: string,
  border: string
): NonNullable<EChartsOption["series"]> {
  const rich = labelRichOuter(tc);
  return [
    {
      name: outer.flowName,
      type: "funnel" as const,
      animation: false,
      left: "10%",
      width: "80%",
      top: "14%",
      bottom: "16%",
      sort: "none" as const,
      minSize: "6%",
      maxSize: "100%",
      funnelAlign: "center" as const,
      label: {
        show: true,
        position: "left" as const,
        distance: 8,
        ...rich,
      },
      labelLine: { show: false },
      itemStyle: {
        opacity: 0.72,
        borderColor: border,
        borderWidth: 1,
      },
      emphasis: {
        label: {
          position: "inside" as const,
          formatter: "{b}\n{c}",
        },
      },
      data: funnelStagesData(outer, 0),
    },
    {
      name: inner.flowName,
      type: "funnel" as const,
      animation: false,
      left: "10%",
      width: "80%",
      top: "14%",
      bottom: "16%",
      sort: "none" as const,
      maxSize: "78%",
      funnelAlign: "center" as const,
      label: {
        show: true,
        position: "inside" as const,
        formatter: "{b}\n{c}",
        color: "#fff",
        fontSize: 11,
        lineHeight: 14,
      },
      labelLine: { show: false },
      itemStyle: {
        opacity: 0.52,
        borderColor: dark ? "#e8e8e8" : "#fff",
        borderWidth: 2,
      },
      z: 100,
      emphasis: {
        label: {
          position: "inside" as const,
          formatter: "{b}\n{c}",
        },
      },
      data: funnelStagesData(inner, 1),
    },
  ];
}

/** Shared 2×N funnel grid (percent layout). */
function funnelGridLayout(flowCount: number) {
  const cols = 2;
  const rows = Math.ceil(flowCount / cols);
  const colLeft = [5, 55] as const;
  const cellW = 40;
  const topStart = 22;
  const bottomPad = 12;
  const rowBlock = (100 - topStart - bottomPad) / rows;
  return { cols, rows, colLeft, cellW, topStart, rowBlock };
}

/** Apache funnel-compare grid: 2 cols (5% / 55%); align right/left; alternate sort. */
function gridCompareSeries(
  list: FlowFunnelRow[],
  tc: string,
  border: string
): NonNullable<EChartsOption["series"]> {
  const L = funnelGridLayout(list.length);

  return list.map((f, i) => {
    const row = Math.floor(i / L.cols);
    const col = i % L.cols;
    const funnelAlign = col === 0 ? ("right" as const) : ("left" as const);
    const sort = row % 2 === 1 ? ("ascending" as const) : ("none" as const);

    return {
      name: f.flowName,
      type: "funnel" as const,
      animation: false,
      width: `${L.cellW}%`,
      height: `${Math.max(28, L.rowBlock * 0.88)}%`,
      left: `${L.colLeft[col]}%`,
      top: `${L.topStart + row * L.rowBlock}%`,
      minSize: "8%",
      maxSize: "100%",
      sort,
      funnelAlign,
      gap: 4,
      label: {
        show: true,
        position: "inside" as const,
        formatter: "{b}\n{c}",
        color: tc,
        fontSize: 11,
        lineHeight: 15,
      },
      labelLine: { show: false },
      itemStyle: {
        borderColor: border,
        borderWidth: 2,
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 12,
          shadowColor: "rgba(0,0,0,0.2)",
        },
      },
      data: funnelStagesData(f, i),
    };
  });
}

function singleFlowSeries(
  f: FlowFunnelRow,
  tc: string,
  sl: string,
  border: string
): NonNullable<EChartsOption["series"]> {
  const rich = labelRichOuter(tc);
  return [
    {
      name: f.flowName,
      type: "funnel" as const,
      animation: false,
      left: "10%",
      width: "80%",
      top: "14%",
      bottom: "16%",
      sort: "none" as const,
      funnelAlign: "center" as const,
      minSize: "8%",
      label: {
        show: true,
        position: "left" as const,
        distance: 10,
        ...rich,
      },
      labelLine: {
        show: true,
        length: 14,
        lineStyle: { color: sl, width: 1 },
      },
      itemStyle: {
        borderColor: border,
        borderWidth: 2,
      },
      data: funnelStagesData(f, 0),
    },
  ];
}

/**
 * 1 flow: single funnel + outer labels.
 * 2 flows: stacked “Expected / Actual” style (Apache boundaries example).
 * 3+ flows: 2×N grid (Apache funnel-compare example: left column funnelAlign right, right column left).
 * @see https://echarts.apache.org/examples/en/editor.html?c=funnel-align
 * @see https://echarts.apache.org/examples/en/editor.html?c=funnel-customize
 */
const compareFunnelOption = computed((): EChartsOption => {
  const list = filteredFlows.value;
  const dark = isDark.value;
  const tc = chartTextColor(dark);
  const sl = splitLineColor(dark);
  const border = dark ? "#2a2a2a" : "#fff";

  if (list.length === 0) {
    return { animation: false, series: [] };
  }

  const n = list.length;
  let series: NonNullable<EChartsOption["series"]>;
  let titleBlock: EChartsOption["title"];

  if (n === 1) {
    series = singleFlowSeries(list[0]!, tc, sl, border);
    titleBlock = {
      text: list[0]!.flowName,
      subtext: "Funnel (connection sent → positive replies)",
      left: "center",
      top: 8,
      textStyle: { color: tc, fontSize: 17, fontWeight: "bold" },
      subtextStyle: { color: tc, opacity: 0.75, fontSize: 12 },
    };
  } else if (n === 2) {
    series = overlayTwoFlowsSeries(list[0]!, list[1]!, dark, tc, border);
    titleBlock = {
      text: "Funnel overlay",
      subtext: `${list[0]!.flowName} (back) · ${list[1]!.flowName} (front)`,
      left: "center",
      top: 8,
      textStyle: { color: tc, fontSize: 19 },
      subtextStyle: { color: tc, opacity: 0.82, fontSize: 13 },
    };
  } else {
    series = gridCompareSeries(list, tc, border);
    const L = funnelGridLayout(n);
    const flowTitles = list.map((f, i) => {
      const row = Math.floor(i / L.cols);
      const col = i % L.cols;
      const leftPct = L.colLeft[col] + L.cellW / 2;
      const topPct = Math.max(5, L.topStart - 6 + row * L.rowBlock);
      return {
        text: f.flowName,
        left: `${leftPct}%`,
        top: `${topPct}%`,
        textAlign: "center" as const,
        textStyle: {
          fontSize: 12,
          fontWeight: "bold" as const,
          color: tc,
        },
      };
    });
    titleBlock = [
      {
        text: "Funnel compare",
        subtext: "Titles name each funnel (2-column grid)",
        left: "center",
        top: 8,
        textStyle: { color: tc, fontSize: 19 },
        subtextStyle: { color: tc, opacity: 0.72, fontSize: 11 },
      },
      ...flowTitles,
    ];
  }

  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { color: tc },
    title: titleBlock,
    tooltip: {
      trigger: "item",
      formatter: "{b}<br/><strong>{c}</strong> ({d}%)",
      textStyle: { fontSize: 13 },
    },
    toolbox: {
      show: true,
      orient: "vertical",
      right: 4,
      top: "center",
      feature: {
        dataView: { readOnly: false },
        restore: {},
        saveAsImage: {},
      },
      iconStyle: { borderColor: tc },
    },
    legend: {
      type: "scroll",
      orient: "horizontal",
      bottom: 4,
      itemWidth: 18,
      itemHeight: 12,
      textStyle: { color: tc, fontSize: 13 },
      pageTextStyle: { color: tc, fontSize: 12 },
    },
    series,
  };
});

function groupedBarOption(
  list: FlowFunnelRow[],
  mode: "count" | "pct",
  dark: boolean
): EChartsOption {
  const tc = chartTextColor(dark);
  const sl = splitLineColor(dark);
  const series = list.map((f, i) => {
    const data =
      mode === "count"
        ? [f.connectionSent, f.connectionAccepted, f.inbox, f.positiveReplies]
        : pctVsSent(f);
    return {
      name: f.flowName,
      type: "bar" as const,
      data,
      animation: false,
      itemStyle: { color: flowColor(i, mode === "count" ? 0.82 : 0.58) },
    };
  });
  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { color: tc, fontSize: 13 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      textStyle: { fontSize: 13 },
    },
    legend: {
      type: "scroll",
      bottom: 4,
      itemWidth: 18,
      itemHeight: 12,
      textStyle: { color: tc, fontSize: 13 },
      pageTextStyle: { color: tc, fontSize: 12 },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "15%",
      top: "8%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: [...STAGE_LABELS],
      axisLabel: { color: tc, fontSize: 12 },
      axisLine: { lineStyle: { color: sl } },
    },
    yAxis: {
      type: "value",
      max: mode === "pct" ? 100 : undefined,
      axisLabel: {
        color: tc,
        fontSize: 12,
        formatter: mode === "pct" ? (v: number) => `${v}%` : undefined,
      },
      splitLine: { lineStyle: { color: sl } },
    },
    series,
  };
}

const countsBarOption = computed(() =>
  groupedBarOption(filteredFlows.value, "count", isDark.value)
);

const pctBarOption = computed(() =>
  groupedBarOption(filteredFlows.value, "pct", isDark.value)
);

async function loadFunnel(projectId: string, from: string, to: string) {
  loading.value = true;
  loadError.value = "";
  warnings.value = [];
  try {
    const q = new URLSearchParams({
      projectId,
      dateFrom: from,
      dateTo: to,
    });
    const r = await fetch(`/api/flow-funnel?${q.toString()}`);
    const data = (await r.json()) as {
      flows?: FlowFunnelRow[];
      warnings?: string[];
      error?: string;
      projectTotals?: FlowFunnelProjectTotalsPayload;
      comparison?: FlowFunnelComparisonPayload | null;
    };
    if (!r.ok) {
      loadError.value = data.error ?? "Failed to load funnel data";
      flows.value = [];
      funnelProjectTotals.value = null;
      funnelComparison.value = null;
      return;
    }
    flows.value = data.flows ?? [];
    warnings.value = data.warnings ?? [];
    funnelProjectTotals.value = data.projectTotals ?? null;
    funnelComparison.value = data.comparison ?? null;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "Failed to load funnel data";
    flows.value = [];
    funnelProjectTotals.value = null;
    funnelComparison.value = null;
  } finally {
    loading.value = false;
  }
}

watch(
  () => projectStore.selectedProjectId,
  async (projectId) => {
    loadError.value = "";
    warnings.value = [];
    flows.value = [];
    selectedFlowUuids.value = [];
    dateRange.value = null;
    analyticsDatesAsc.value = [];
    funnelProjectTotals.value = null;
    funnelComparison.value = null;
    if (!projectId) return;
    collectingDays.value = true;
    try {
      const r = await fetch(
        `/api/analytics-collected-days?projectId=${encodeURIComponent(projectId)}`
      );
      const data = (await r.json()) as { dates?: string[]; error?: string };
      if (!r.ok) {
        loadError.value = data.error ?? "Failed to load analytics days";
        return;
      }
      analyticsDatesAsc.value = [...(data.dates ?? [])].sort();
      const wd = Number(statsWindowDays.value);
      const dr = defaultRangeForWindow(analyticsDatesAsc.value, wd);
      if (dr) {
        dateRange.value = dr;
      } else {
        const end = Date.now();
        const s = new Date(end);
        s.setDate(s.getDate() - (wd - 1));
        dateRange.value = [s.getTime(), end];
      }
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : "Failed to load analytics days";
    } finally {
      collectingDays.value = false;
    }
  },
  { immediate: true }
);

watch(
  dateRange,
  (val) => {
    const pid = projectStore.selectedProjectId;
    if (!pid || !val || val.length !== 2) {
      if (!val) flows.value = [];
      return;
    }
    void loadFunnel(pid, tsToYmdLocal(val[0]), tsToYmdLocal(val[1]));
  },
  { deep: true }
);

watch(statsWindowDays, (wd) => {
  const n = Number(wd);
  if (!Number.isFinite(n) || n < 1) return;
  const dr = defaultRangeForWindow(analyticsDatesAsc.value, n);
  if (dr) {
    dateRange.value = dr;
  }
});
</script>

<template>
  <div class="flow-dash">
    <div class="flow-dash__header">
      <NH1 class="flow-dash__title">Flow analytics</NH1>
      <NH3 class="flow-dash__subtitle">GetSales funnel metrics by flow (analytics snapshots).</NH3>
    </div>

    <NAlert v-if="!projectStore.selectedProjectId" type="info" title="Select a project" class="flow-dash__alert">
      Choose a project in the header to load funnel data.
    </NAlert>

    <template v-else>
      <NSpin :show="collectingDays || loading" class="flow-dash__spin">
        <NAlert v-if="loadError" type="error" class="flow-dash__alert" :title="loadError" />

        <NAlert v-if="!loadError && warnings.length > 0" type="warning" class="flow-dash__alert" title="Notice">
          <ul class="flow-dash__warn-list">
            <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
          </ul>
        </NAlert>

        <NCard title="Filters" size="small" class="flow-dash__card flow-dash__card--spaced flow-dash__filters-card"
          :bordered="true">
          <div class="flow-dash__filters-row">
            <NDatePicker v-model:value="dateRange" type="daterange" size="small" clearable class="flow-dash__filters-dp"
              :disabled="collectingDays || loading" />
            <NSelect v-model:value="statsWindowDays" size="small" :options="statsWindowOptions" placeholder="Period"
              class="flow-dash__filters-period" :disabled="collectingDays || loading" :consistent-menu-width="false" />
            <NText v-if="flows.length === 0 && (collectingDays || loading)" depth="3"
              class="flow-dash__filters-placeholder">
              Loading…
            </NText>
            <NText v-else-if="flows.length === 0" depth="3" class="flow-dash__filters-placeholder">No flows</NText>
          </div>
          <div v-if="flows.length > 0" class="flow-dash__filters-section flow-dash__filters-section--flows">
            <div class="flow-dash__filters-section-head">
              <span class="flow-dash__filters-title">Flows (charts & matrix)</span>
              <div class="flow-dash__flow-tag-actions">
                <NButton size="tiny" quaternary :disabled="loading" @click="selectAllPickerFlows">All</NButton>
                <NButton size="tiny" quaternary :disabled="loading" @click="clearPickerFlows">Clear</NButton>
              </div>
            </div>
            <div class="flow-dash__flow-tags">
              <NTooltip v-for="(f, idx) in flowsSortedForPicker" :key="`flow-tag-${f.flowUuid}`" placement="top">
                <template #trigger>
                  <NTag size="small" :type="isFlowUuidSelected(f.flowUuid) ? 'primary' : 'default'"
                    :bordered="isFlowUuidSelected(f.flowUuid)" round :class="[
                      'flow-dash__flow-tag',
                      { 'flow-dash__flow-tag--active': isFlowUuidSelected(f.flowUuid) },
                    ]" :disabled="loading" @click="toggleFlowSelection(f.flowUuid)">
                    {{ flowPickerEmoji(idx) }} {{ f.flowName }}
                  </NTag>
                </template>
                {{
                  isFlowUuidSelected(f.flowUuid)
                    ? `Remove from charts and matrix. Sent: ${f.connectionSent.toLocaleString()}`
                    : `Add to charts and matrix. Sent: ${f.connectionSent.toLocaleString()}`
                }}
              </NTooltip>
            </div>
          </div>
        </NCard>

        <template v-if="!loadError && flows.length === 0 && !loading && !collectingDays">
          <NAlert type="info" title="No flows" class="flow-dash__alert">
            This project has no rows in <code>Flows</code>, or data is still loading.
          </NAlert>
        </template>

        <NTabs v-model:value="dashboardTab" type="line" size="small" class="flow-dash__tabs">
          <NTabPane name="rankings" tab="Top & least" display-directive="show">
            <NText v-if="flows.length > 0" depth="3" class="flow-dash__rank-tab-hint">
              Date range from <strong>Filters</strong> above.
            </NText>
            <template v-if="flows.length > 0">
              <NCard :title="rankTablesCardTitle" size="small" class="flow-dash__card flow-dash__card--spaced">
                <div class="flow-dash__rank-toolbar">
                  <NText depth="3" class="flow-dash__rank-toolbar-label">Rank tables by</NText>
                  <NSelect v-model:value="rankSortMetric" size="small" :options="rankMetricSelectOptions"
                    class="flow-dash__rank-metric-select" :consistent-menu-width="false" />
                </div>
                <NText depth="3" class="flow-dash__rank-hint">
                  Metrics as rows, flows as columns. Order by selected metric (rates: higher first; flows with no sends
                  last · counts: higher first). Left column = baseline for % tags (<code>#rank</code> = overall rank).
                  The baseline cell for the metric you rank by shows a <strong>Best</strong> tag (Top / single table) or
                  <strong>Ref</strong> (Least table, reference for % deltas).
                </NText>
                <NGrid v-if="showSplitRankTables" cols="24" responsive="screen" :x-gap="16" :y-gap="12"
                  class="flow-dash__rank-grid">
                  <NGi span="24 m:12">
                    <NText class="flow-dash__rank-table-title">Top</NText>
                    <NDataTable size="small" :bordered="true" :single-line="false" :columns="topRankMatrixColumns"
                      :data="MATRIX_ROW_DEFS" :row-key="matrixDataRowKey" :pagination="false" :scroll-x="1100"
                      class="flow-dash__data-table flow-dash__matrix-table flow-dash__rank-matrix" />
                  </NGi>
                  <NGi span="24 m:12">
                    <NText class="flow-dash__rank-table-title">Least</NText>
                    <NDataTable size="small" :bordered="true" :single-line="false" :columns="leastRankMatrixColumns"
                      :data="MATRIX_ROW_DEFS" :row-key="matrixDataRowKey" :pagination="false" :scroll-x="1100"
                      class="flow-dash__data-table flow-dash__matrix-table flow-dash__rank-matrix" />
                  </NGi>
                </NGrid>
                <template v-else>
                  <NDataTable size="small" :bordered="true" :single-line="false" :columns="allFlowsRankMatrixColumns"
                    :data="MATRIX_ROW_DEFS" :row-key="matrixDataRowKey" :pagination="false" :scroll-x="1100"
                    class="flow-dash__data-table flow-dash__matrix-table flow-dash__rank-matrix" />
                </template>
              </NCard>
            </template>
            <template v-else-if="!loadError && !loading && !collectingDays">
              <NAlert type="info" title="No flows" class="flow-dash__alert">
                No flows in this range. Adjust <strong>Filters</strong> above.
              </NAlert>
            </template>
          </NTabPane>

          <NTabPane name="totals" tab="Totals & compare" display-directive="show">
            <NText v-if="flows.length > 0" depth="3" class="flow-dash__rank-tab-hint">
              Project-wide totals and selected-flow matrix. Toggle flows in <strong>Filters</strong> above.
            </NText>
            <template v-if="flows.length > 0">
              <NCard title="Project totals (all flows in range)" size="small"
                class="flow-dash__card flow-dash__card--spaced flow-dash__stats-card">
                <NText v-if="funnelComparison" depth="3" class="flow-dash__stats-sub">
                  vs prior window {{ funnelComparison.previousDateFrom }} →
                  {{ funnelComparison.previousDateTo }} (same length)
                </NText>
                <div class="flow-dash__stats-cols">
                  <div class="flow-dash__stat-col">
                    <NText depth="3" class="flow-dash__stat-col-label">Connection sent</NText>
                    <div class="flow-dash__stat-col-value">
                      <span class="flow-dash__stat-col-num">{{
                        formatInt(displayFunnelTotals.connectionSent)
                      }}</span>
                      <NTag v-if="deltaSent" size="small" :bordered="false" :type="deltaSent.type">
                        {{ deltaSent.text }}
                      </NTag>
                    </div>
                  </div>
                  <div class="flow-dash__stat-col">
                    <NText depth="3" class="flow-dash__stat-col-label">Connection accepted</NText>
                    <div class="flow-dash__stat-col-value">
                      <span class="flow-dash__stat-col-num">{{
                        formatInt(displayFunnelTotals.connectionAccepted)
                      }}</span>
                      <NTag v-if="deltaAccepted" size="small" :bordered="false" :type="deltaAccepted.type">
                        {{ deltaAccepted.text }}
                      </NTag>
                    </div>
                  </div>
                  <div class="flow-dash__stat-col">
                    <NText depth="3" class="flow-dash__stat-col-label">Inbox</NText>
                    <div class="flow-dash__stat-col-value">
                      <span class="flow-dash__stat-col-num">{{
                        formatInt(displayFunnelTotals.inbox)
                      }}</span>
                      <NTag v-if="deltaInbox" size="small" :bordered="false" :type="deltaInbox.type">
                        {{ deltaInbox.text }}
                      </NTag>
                    </div>
                  </div>
                  <div class="flow-dash__stat-col">
                    <NText depth="3" class="flow-dash__stat-col-label">Positive replies</NText>
                    <div class="flow-dash__stat-col-value">
                      <span class="flow-dash__stat-col-num">{{
                        formatInt(displayFunnelTotals.positiveReplies)
                      }}</span>
                      <NTag v-if="deltaPositive" size="small" :bordered="false" :type="deltaPositive.type">
                        {{ deltaPositive.text }}
                      </NTag>
                    </div>
                  </div>
                  <div class="flow-dash__stat-col">
                    <NText depth="3" class="flow-dash__stat-col-label">Accepted rate (÷ sent)</NText>
                    <div class="flow-dash__stat-col-value">
                      <span class="flow-dash__stat-col-num">{{
                        displayFunnelTotals.acceptedRatePct == null
                          ? "—"
                          : `${displayFunnelTotals.acceptedRatePct.toFixed(1)}%`
                      }}</span>
                      <NTag v-if="deltaAccRate" size="small" :bordered="false" :type="deltaAccRate.type">
                        {{ deltaAccRate.text }}
                      </NTag>
                    </div>
                  </div>
                  <div class="flow-dash__stat-col">
                    <NText depth="3" class="flow-dash__stat-col-label">Inbox rate (÷ sent)</NText>
                    <div class="flow-dash__stat-col-value">
                      <span class="flow-dash__stat-col-num">{{
                        displayFunnelTotals.inboxRatePct == null
                          ? "—"
                          : `${displayFunnelTotals.inboxRatePct.toFixed(1)}%`
                      }}</span>
                      <NTag v-if="deltaInboxRate" size="small" :bordered="false" :type="deltaInboxRate.type">
                        {{ deltaInboxRate.text }}
                      </NTag>
                    </div>
                  </div>
                </div>
              </NCard>

              <NCard title="Selected flows · vs baseline" size="small" class="flow-dash__card flow-dash__card--spaced">
                <template v-if="selectedFlowUuids.length === 0">
                  <NText depth="3" class="flow-dash__matrix-empty">
                    Choose flows under <strong>Flows (charts & matrix)</strong> in Filters above.
                  </NText>
                </template>
                <template v-else>
                  <div class="flow-dash__matrix-toolbar">
                    <NText depth="3" class="flow-dash__matrix-toolbar-label">Baseline</NText>
                    <NSelect v-model:value="baselineFlowUuid" size="small" :options="baselineOptions"
                      placeholder="Baseline flow" class="flow-dash__matrix-baseline" :consistent-menu-width="false" />
                  </div>
                  <NDataTable size="small" :bordered="true" :single-line="false" :columns="performanceMatrixColumns"
                    :data="MATRIX_ROW_DEFS" :row-key="matrixDataRowKey" :pagination="false" :scroll-x="900"
                    class="flow-dash__data-table flow-dash__matrix-table" />
                </template>
              </NCard>
            </template>
            <template v-else-if="!loadError && !loading && !collectingDays">
              <NAlert type="info" title="No flows" class="flow-dash__alert">
                No flows in this range. Adjust <strong>Filters</strong> above.
              </NAlert>
            </template>
          </NTabPane>

          <NTabPane name="funnels" tab="Funnels" display-directive="show">
            <NText v-if="flows.length > 0" depth="3" class="flow-dash__rank-tab-hint">
              Pick flows under <strong>Flows (charts & matrix)</strong> in Filters. Compare funnel + bar charts.
            </NText>
            <template v-if="flows.length > 0">
              <NAlert v-if="selectedFlowUuids.length === 0" type="info" title="No flows selected"
                class="flow-dash__alert">
                Select at least one flow tag under <strong>Filters</strong> to render charts.
              </NAlert>
              <template v-else>
                <NCard title="Compare funnels" size="small" class="flow-dash__card flow-dash__card--spaced">
                  <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
                    Two flows: overlay funnels. Three+: grid. Toolbox: data view / save image.
                  </NText>
                  <div class="flow-dash__compare-host flow-dash__chart-tall">
                    <VChart class="flow-dash__echart-compare flow-dash__echart-fill" :option="compareFunnelOption"
                      :update-options="chartUpdateOptions" :autoresize="{ throttle: 200 }" />
                  </div>
                </NCard>

                <NCard title="Counts by stage" size="small" class="flow-dash__card flow-dash__card--spaced">
                  <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
                    One bar series per selected flow.
                  </NText>
                  <div class="flow-dash__chart-wrap flow-dash__chart-tall">
                    <VChart class="flow-dash__echart-bar" :option="countsBarOption" :update-options="chartUpdateOptions"
                      :autoresize="{ throttle: 200 }" />
                  </div>
                </NCard>

                <NCard title="% vs connection sent" size="small" class="flow-dash__card flow-dash__card--spaced">
                  <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
                    Stages as % of that flow’s connection sent.
                  </NText>
                  <div class="flow-dash__chart-wrap flow-dash__chart-tall">
                    <VChart class="flow-dash__echart-bar" :option="pctBarOption" :update-options="chartUpdateOptions"
                      :autoresize="{ throttle: 200 }" />
                  </div>
                </NCard>
              </template>
            </template>
            <template v-else-if="!loadError && !loading && !collectingDays">
              <NAlert type="info" title="No flows" class="flow-dash__alert">
                No flows in this range. Adjust <strong>Filters</strong> above.
              </NAlert>
            </template>
          </NTabPane>
        </NTabs>
      </NSpin>
    </template>
  </div>
</template>

<style scoped>
.flow-dash {
  width: 100%;
  max-width: min(1720px, 96vw);
  margin: 0 auto;
  padding: 2rem 1.75rem 3rem;
  box-sizing: border-box;
}

.flow-dash__header {
  text-align: center;
  margin-bottom: 1.75rem;
}

.flow-dash__title {
  font-size: 2rem;
  font-weight: 600;
  margin-bottom: 0.45rem;
}

.flow-dash__subtitle {
  font-weight: 400;
  font-size: 1.05rem;
  margin: 0;
  opacity: 0.85;
  max-width: 52rem;
  margin-left: auto;
  margin-right: auto;
}

.flow-dash__subtitle code {
  font-size: 0.88em;
}

.flow-dash__spin {
  margin-top: 1.25rem;
}

.flow-dash__tabs {
  margin-top: 0.35rem;
}

.flow-dash__tabs :deep(.n-tabs-nav) {
  margin-bottom: 0.5rem;
}

.flow-dash__rank-tab-hint {
  display: block;
  font-size: 0.8125rem;
  margin: 0 0 0.65rem;
  line-height: 1.35;
}

.flow-dash__stats-card :deep(.n-card__content) {
  padding-top: 0.75rem;
  padding-bottom: 0.85rem;
}

.flow-dash__stats-sub {
  display: block;
  font-size: 0.75rem;
  margin: 0 0 0.65rem;
  line-height: 1.35;
}

.flow-dash__stats-cols {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 1.35rem;
  align-items: flex-start;
}

.flow-dash__stat-col {
  flex: 1 1 140px;
  min-width: 118px;
}

.flow-dash__stat-col-label {
  display: block;
  font-size: 0.75rem;
  margin-bottom: 0.28rem;
}

.flow-dash__stat-col-value {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.55rem;
}

.flow-dash__stat-col-num {
  font-size: 1.2rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.flow-dash__filters-card :deep(.n-card__content) {
  padding-top: 0.65rem;
  padding-bottom: 0.65rem;
}

.flow-dash__filters-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.85rem;
}

.flow-dash__filters-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 0.65rem;
  padding-top: 0.65rem;
  border-top: 1px solid var(--n-border-color);
}

.flow-dash__filters-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem 0.75rem;
}

.flow-dash__filters-title {
  font-size: 11px;
  opacity: 0.65;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.flow-dash__flow-tag-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.15rem;
}

.flow-dash__flow-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.flow-dash__flow-tag {
  cursor: pointer;
  user-select: none;
  max-width: 100%;
}

.flow-dash__flow-tag:not(.flow-dash__flow-tag--active) {
  opacity: 0.78;
}

.flow-dash__flow-tag--active {
  opacity: 1;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.22) inset;
}

.flow-dash__flow-tag :deep(.n-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
}

.flow-dash__filters-dp {
  flex: 0 1 260px;
  min-width: 200px;
}

.flow-dash__filters-period {
  flex: 0 1 158px;
  min-width: 132px;
}

.flow-dash__filters-placeholder {
  font-size: 0.8125rem;
}

.flow-dash__rank-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.65rem;
  margin-bottom: 0.45rem;
}

.flow-dash__rank-toolbar-label {
  font-size: 0.8125rem;
  margin: 0;
  white-space: nowrap;
}

.flow-dash__rank-metric-select {
  min-width: 200px;
  max-width: min(340px, 100%);
}

.flow-dash__rank-hint {
  display: block;
  font-size: 0.8125rem;
  margin: 0 0 0.5rem;
  line-height: 1.35;
}

.flow-dash__rank-grid {
  margin-top: 0.15rem;
}

.flow-dash__rank-table-title {
  display: block;
  font-size: 0.8125rem;
  font-weight: 600;
  margin-bottom: 0.35rem;
}

.flow-dash__matrix-empty {
  font-size: 0.8125rem;
  margin: 0;
}

.flow-dash__matrix-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.65rem;
  margin-bottom: 0.45rem;
}

.flow-dash__matrix-toolbar-label {
  font-size: 0.8125rem;
  margin: 0;
}

.flow-dash__matrix-baseline {
  min-width: 180px;
  max-width: min(420px, 100%);
}

.flow-dash__matrix-num {
  font-variant-numeric: tabular-nums;
}

.flow-dash__matrix-sort-baseline {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
  max-width: 100%;
  padding: 5px 9px;
  margin: -2px -4px;
  border-radius: 8px;
  background-color: color-mix(in srgb,
      var(--n-primary-color) 18%,
      var(--n-color-embedded, var(--n-color)));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--n-primary-color) 32%, transparent);
  vertical-align: middle;
}

.flow-dash__matrix-num--badged {
  font-weight: 600;
}

.flow-dash__matrix-table :deep(.n-data-table-th),
.flow-dash__matrix-table :deep(.n-data-table-td) {
  font-size: 0.8125rem;
}

.flow-dash__data-table {
  margin-top: 0.15rem;
}

.flow-dash__alert {
  margin-bottom: 1rem;
}

.flow-dash__warn-list {
  margin: 0.25rem 0 0 1.1rem;
  padding: 0;
}

.flow-dash__card {
  margin-bottom: 0;
}

.flow-dash__card--spaced {
  margin-top: 1.75rem;
}

.flow-dash__hint {
  display: block;
  margin-bottom: 0.9rem;
  font-size: 0.95rem;
  line-height: 1.45;
}

.flow-dash__hint--tight {
  margin-bottom: 0.55rem;
  font-size: 0.8125rem;
  line-height: 1.35;
}

.flow-dash__chart-wrap {
  position: relative;
  width: 100%;
}

.flow-dash__chart-tall {
  min-height: 80vh;
  height: 80vh;
}

.flow-dash__compare-host {
  width: 100%;
  position: relative;
  overflow: hidden;
}

.flow-dash__echart-compare {
  width: 100%;
  display: block;
}

.flow-dash__echart-fill {
  height: 100%;
  min-height: 80vh;
}

.flow-dash__hint a {
  color: var(--n-primary-color);
  text-decoration: none;
}

.flow-dash__hint a:hover {
  text-decoration: underline;
}

.flow-dash__echart-bar {
  width: 100%;
  height: 100%;
  min-height: 320px;
  display: block;
}

.flow-dash :deep(.n-card-header) {
  font-size: 1.05rem;
}

.flow-dash :deep(.n-card-header__main) {
  font-size: 1.05rem;
  font-weight: 600;
}
</style>
