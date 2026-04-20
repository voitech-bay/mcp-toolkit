<script setup lang="ts">
import { computed, h, ref, watch } from "vue";
import {
  NCard,
  NText,
  NSelect,
  NGrid,
  NGi,
  NDataTable,
  NSpace,
  NTag,
  NButton,
  NDrawer,
  NDrawerContent,
  NInputNumber,
  NDivider,
} from "naive-ui";
import type { SelectOption, SelectGroupOption, DataTableColumns } from "naive-ui";
import { useDark } from "@vueuse/core";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import type { EChartsOption } from "echarts";
import VChart from "vue-echarts";
import { trackAnalyticsEvent } from "../../lib/mixpanel-tracking";

use([CanvasRenderer, BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent]);

const chartUpdateOptions = { notMerge: true as const };
const isDark = useDark();

/** Same row shape as analytics API / parent dashboard. */
export interface AnalyticsMatrixFlowRow {
  flowUuid: string;
  flowName: string;
  messagesSent: number;
  connectionSent: number;
  connectionAccepted: number;
  inbox: number;
  positiveReplies: number;
  acceptedRatePct?: number | null;
  inboxRatePct?: number | null;
  positiveRatePct?: number | null;
  connectionRequestRatePct?: number | null;
}

interface RankedFlow extends AnalyticsMatrixFlowRow {
  positiveRatePct: number;
  acceptedRatePct: number;
  inboxRatePct: number;
  hasSent: boolean;
  hasAccepted: boolean;
  hasInbox: boolean;
}

const props = defineProps<{
  projectId: string | null;
  /** Rankings tab card vs Totals tab baseline matrix card. */
  section: "rankings" | "performance";
  flows: AnalyticsMatrixFlowRow[];
  selectedFlowUuids: string[];
  groupEntityTitle: string;
  groupEntityPlural: string;
  groupEntitySingular: string;
}>();

type RankSortMetric =
  | "positiveReplyRate"
  | "inboxRate"
  | "acceptedRate"
  | "connectionSent"
  | "connectionAccepted"
  | "inbox"
  | "positiveReplies";

function enrichFlowsToRanked(list: AnalyticsMatrixFlowRow[]): RankedFlow[] {
  return list.map((f) => ({
    ...f,
    hasSent: f.connectionSent > 0,
    hasAccepted: f.connectionAccepted > 0,
    hasInbox: f.inbox > 0,
    positiveRatePct: f.inbox > 0 ? (100 * f.positiveReplies) / f.inbox : 0,
    acceptedRatePct:
      f.connectionSent > 0 ? (100 * f.connectionAccepted) / f.connectionSent : 0,
    inboxRatePct: f.connectionAccepted > 0 ? (100 * f.inbox) / f.connectionAccepted : 0,
  }));
}

function rankedHasRateDenominator(
  f: RankedFlow,
  metric: "positiveReplyRate" | "inboxRate" | "acceptedRate"
): boolean {
  if (metric === "acceptedRate") return f.hasSent;
  if (metric === "inboxRate") return f.hasAccepted;
  return f.hasInbox;
}

function sortRankedByMetric(list: RankedFlow[], metric: RankSortMetric): RankedFlow[] {
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
      const da = rankedHasRateDenominator(a, metric);
      const db = rankedHasRateDenominator(b, metric);
      if (da !== db) return da ? -1 : 1;
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
    label: "Rates",
    children: [
      { label: "Positive rate (÷ inbox)", value: "positiveReplyRate" },
      { label: "Inbox rate (÷ accepted)", value: "inboxRate" },
      { label: "Accepted rate (÷ sent)", value: "acceptedRate" },
    ],
  },
  {
    type: "group",
    key: "rank-counts",
    label: "Absolute counts",
    children: [
      { label: "Connection sent", value: "connectionSent" },
      { label: "Connection accepted", value: "connectionAccepted" },
      { label: "Inbox reply", value: "inbox" },
      { label: "Inbox positive", value: "positiveReplies" },
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
  sortRankedByMetric(enrichFlowsToRanked(props.flows), rankSortMetric.value)
);

const matrixColumnFlows = computed((): RankedFlow[] => {
  const byId = new Map(rankedFlows.value.map((f) => [f.flowUuid, f]));
  const out: RankedFlow[] = [];
  for (const id of props.selectedFlowUuids) {
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

const orderedMatrixColumns = computed((): RankedFlow[] => {
  const cols = matrixColumnFlows.value;
  const bid = baselineFlowUuid.value;
  if (!bid || cols.length === 0) return cols;
  const base = cols.find((c) => c.flowUuid === bid);
  const rest = cols.filter((c) => c.flowUuid !== bid);
  return base ? [base, ...rest] : cols;
});

type MatrixMetricField =
  | keyof AnalyticsMatrixFlowRow
  | "positiveRatePct"
  | "acceptedRatePct"
  | "inboxRatePct";

function rateDenominatorOk(f: RankedFlow, field: MatrixMetricField): boolean {
  if (field === "acceptedRatePct") return f.hasSent;
  if (field === "inboxRatePct") return f.hasAccepted;
  if (field === "positiveRatePct") return f.hasInbox;
  return false;
}

interface MatrixRowDef {
  key: string;
  label: string;
  field: MatrixMetricField;
}

const MATRIX_ROW_DEFS: MatrixRowDef[] = [
  { key: "sent", label: "Connection sent", field: "connectionSent" },
  { key: "acc", label: "Connection accepted", field: "connectionAccepted" },
  { key: "accRate", label: "Accepted rate (÷ sent)", field: "acceptedRatePct" },
  { key: "inb", label: "Inbox reply", field: "inbox" },
  { key: "inbRate", label: "Inbox rate (÷ accepted)", field: "inboxRatePct" },
  { key: "pos", label: "Inbox positive", field: "positiveReplies" },
  { key: "rate", label: "Positive rate (÷ inbox)", field: "positiveRatePct" },
];

function matrixDataRowKey(row: MatrixRowDef): string {
  return row.key;
}

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
    rankBaselineBadge?: RankMatrixBadgeKind;
  }
): ReturnType<typeof h> {
  const v = metricValue(flow, row.field);
  const isBaseline =
    baselineFlow != null && flow.flowUuid === baselineFlow.flowUuid;
  const bVal =
    baselineFlow != null ? metricValue(baselineFlow, row.field) : null;

  const isRateRow =
    row.field === "positiveRatePct" ||
    row.field === "acceptedRatePct" ||
    row.field === "inboxRatePct";

  /** Rate rows: absolute delta in percentage points (pp). Count rows: % change vs baseline. */
  let diffVal: number | null = null;
  let diffUnit: "pp" | "relPct" = "relPct";
  if (!isBaseline && baselineFlow && bVal != null) {
    if (isRateRow) {
      if (rateDenominatorOk(flow, row.field) && rateDenominatorOk(baselineFlow, row.field)) {
        diffVal = v - bVal;
        diffUnit = "pp";
      }
    } else if (bVal > 0) {
      diffVal = ((v - bVal) / bVal) * 100;
      diffUnit = "relPct";
    }
  }
  const rateHasBase = rateDenominatorOk(flow, row.field);
  const numStr = isRateRow
    ? rateHasBase
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
    ? h(NSpace, { size: 6, class: "amm-matrix-sort-baseline" }, [
        h(
          NTag,
          {
            size: "small",
            type: badgeType,
            bordered: false,
            class: "amm-matrix-sort-badge",
          },
          () => badgeLabel
        ),
        h("span", { class: "amm-matrix-num amm-matrix-num--badged" }, numStr),
      ])
    : h("span", { class: "amm-matrix-num" }, numStr);

  const children: ReturnType<typeof h>[] = [valueBlock];
  if (!isBaseline && diffVal !== null && Number.isFinite(diffVal)) {
    const t =
      Math.abs(diffVal) < 0.05
        ? ("default" as const)
        : diffVal > 0
          ? ("success" as const)
          : ("error" as const);
    const diffLabel =
      diffUnit === "pp"
        ? `${diffVal > 0 ? "+" : ""}${diffVal.toFixed(1)} pp`
        : `${diffVal > 0 ? "+" : ""}${diffVal.toFixed(1)}%`;
    children.push(
      h(NTag, { size: "small", bordered: false, type: t }, () => diffLabel)
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

const performanceCardTitle = computed(
  () => `Selected ${props.groupEntityTitle.toLowerCase()} · vs baseline`
);

/** Same metric row key can appear in Top + Least; keep selection scoped per table. */
type MetricMatrixTableId = "top" | "least" | "single" | "performance";

function emptyMetricSelections(): Record<MetricMatrixTableId, string[]> {
  return { top: [], least: [], single: [], performance: [] };
}

const selectedMetricKeysByTable = ref(emptyMetricSelections());
/** Which table’s selection + columns drive the chart toolbar and drawer. */
const chartSourceTable = ref<MetricMatrixTableId>("top");
/** Column flows for the table where the user last toggled a metric (drives chart X categories). */
const chartColumnFlows = ref<RankedFlow[]>([]);
const chartDrawerOpen = ref(false);

type DrawerMetricSeriesStyle = "bar" | "line" | "area";

const drawerMetricStyleAbsolute = ref<DrawerMetricSeriesStyle>("bar");
const drawerMetricStyleRate = ref<DrawerMetricSeriesStyle>("bar");
/** Left Y (counts): `null` = ECharts auto scale */
const yAxisMaxAbsolute = ref<number | null>(null);
/** Right Y (rate %): `null` = auto */
const yAxisMaxRate = ref<number | null>(null);

const drawerChartTypeOptions: SelectOption[] = [
  { label: "Bar", value: "bar" },
  { label: "Line", value: "line" },
  { label: "Area", value: "area" },
];

function defaultChartSourceTable(): MetricMatrixTableId {
  if (props.section === "performance") return "performance";
  return showSplitRankTables.value ? "top" : "single";
}

const chartActiveKeys = computed(
  () => selectedMetricKeysByTable.value[chartSourceTable.value]
);

const hasAnyMetricSelection = computed(() =>
  (Object.keys(selectedMetricKeysByTable.value) as MetricMatrixTableId[]).some(
    (id) => selectedMetricKeysByTable.value[id].length > 0
  )
);

function isRateRowDef(row: MatrixRowDef): boolean {
  return (
    row.field === "positiveRatePct" ||
    row.field === "acceptedRatePct" ||
    row.field === "inboxRatePct"
  );
}

function toggleMetricRow(key: string, columnFlows: RankedFlow[], tableId: MetricMatrixTableId) {
  const prev = selectedMetricKeysByTable.value[tableId];
  const i = prev.indexOf(key);
  const next = i >= 0 ? prev.filter((k) => k !== key) : [...prev, key];
  selectedMetricKeysByTable.value = { ...selectedMetricKeysByTable.value, [tableId]: next };
  chartColumnFlows.value = columnFlows;
  chartSourceTable.value = tableId;
  if (!props.projectId) return;
  trackAnalyticsEvent("analytics_select_chart_metrics", {
    projectId: props.projectId,
    section: props.section,
    tableId,
    metricKey: key,
    selectedMetricKeys: [...next],
    selectedFlowUuids: columnFlows.map((f) => f.flowUuid),
    selectedFlowNames: columnFlows.map((f) => f.flowName),
  });
}

function clearMetricSelection() {
  selectedMetricKeysByTable.value = emptyMetricSelections();
  chartColumnFlows.value = [];
  chartSourceTable.value = defaultChartSourceTable();
  if (!props.projectId) return;
  trackAnalyticsEvent("analytics_clear_chart_metrics", {
    projectId: props.projectId,
    section: props.section,
  });
}

function matrixRowClassNameForTable(tableId: MetricMatrixTableId) {
  return (row: MatrixRowDef) =>
    selectedMetricKeysByTable.value[tableId].includes(row.key)
      ? "amm-metric-row amm-metric-row--selected"
      : "amm-metric-row";
}

function rowPropsForMatrix(columnFlows: RankedFlow[], tableId: MetricMatrixTableId) {
  return (row: MatrixRowDef) => ({
    style: "cursor: pointer",
    onClick: () => {
      toggleMetricRow(row.key, columnFlows, tableId);
    },
  });
}

const selectedRowDefs = computed((): MatrixRowDef[] => {
  const byKey = new Map(MATRIX_ROW_DEFS.map((r) => [r.key, r]));
  return chartActiveKeys.value
    .map((k) => byKey.get(k))
    .filter((r): r is MatrixRowDef => r != null);
});

const drawerHasCountSeries = computed(() =>
  selectedRowDefs.value.some((r) => !isRateRowDef(r))
);
const drawerHasRateSeries = computed(() =>
  selectedRowDefs.value.some((r) => isRateRowDef(r))
);

function chartAxisTextColor(): string {
  return isDark.value ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.65)";
}

function chartSplitLineColor(): string {
  return isDark.value ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
}

function buildDrawerMetricSeries(args: {
  name: string;
  yAxisIndex: 0 | 1;
  data: (number | null)[];
  style: DrawerMetricSeriesStyle;
  categoryCount: number;
}) {
  const { name, yAxisIndex, data, style, categoryCount } = args;
  const emphasis = { focus: "series" as const };
  if (style === "bar") {
    return { name, type: "bar" as const, yAxisIndex, data, emphasis };
  }
  if (style === "line") {
    return {
      name,
      type: "line" as const,
      yAxisIndex,
      data,
      smooth: 0.2,
      showSymbol: categoryCount <= 10,
      symbolSize: 7,
      emphasis,
    };
  }
  return {
    name,
    type: "line" as const,
    yAxisIndex,
    data,
    smooth: 0.2,
    showSymbol: false,
    areaStyle: {},
    emphasis,
  };
}

const matrixBarChartOption = computed((): EChartsOption => {
  const rows = selectedRowDefs.value;
  const cols = chartColumnFlows.value;
  if (rows.length === 0 || cols.length === 0) {
    return { animation: false, series: [] };
  }
  const categories = cols.map((f) => f.flowName);
  const tc = chartAxisTextColor();
  const sl = chartSplitLineColor();

  const countRows = rows.filter((r) => !isRateRowDef(r));
  const rateRows = rows.filter((r) => isRateRowDef(r));
  const showLeft = countRows.length > 0;
  const showRight = rateRows.length > 0;

  const absStyle = drawerMetricStyleAbsolute.value;
  const rateStyle = drawerMetricStyleRate.value;
  const nCat = categories.length;

  const series: EChartsOption["series"] = [
    ...countRows.map((row) =>
      buildDrawerMetricSeries({
        name: `${row.label} (count)`,
        yAxisIndex: 0,
        data: cols.map((f) => metricValue(f, row.field)),
        style: absStyle,
        categoryCount: nCat,
      })
    ),
    ...rateRows.map((row) =>
      buildDrawerMetricSeries({
        name: `${row.label} (%)`,
        yAxisIndex: 1,
        data: cols.map((f) => {
          if (!rateDenominatorOk(f, row.field)) return null;
          return Number(metricValue(f, row.field).toFixed(2));
        }),
        style: rateStyle,
        categoryCount: nCat,
      })
    ),
  ] as EChartsOption["series"];

  const countsLineOrArea = countRows.length > 0 && absStyle !== "bar";
  const ratesLineOrArea = rateRows.length > 0 && rateStyle !== "bar";
  const axisPointerType = countsLineOrArea || ratesLineOrArea ? ("line" as const) : ("shadow" as const);

  const leftMax = yAxisMaxAbsolute.value;
  const rightMax = yAxisMaxRate.value;

  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { color: tc },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: axisPointerType },
    },
    legend: {
      type: "scroll",
      bottom: 0,
      textStyle: { color: tc, fontSize: 11 },
    },
    grid: {
      left: showLeft ? 52 : 12,
      right: showRight ? 52 : 12,
      top: 28,
      bottom: countRows.length + rateRows.length > 4 ? 112 : 96,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: {
        color: tc,
        fontSize: 11,
        interval: 0,
        rotate: 45,
        margin: 12,
        align: "right",
      },
      axisLine: { lineStyle: { color: sl } },
    },
    yAxis: [
      {
        type: "value",
        show: showLeft,
        position: "left",
        name: "Absolute",
        nameTextStyle: { color: tc, fontSize: 11 },
        axisLabel: { color: tc, fontSize: 11 },
        splitLine: { lineStyle: { color: sl } },
        ...(leftMax != null && Number.isFinite(leftMax) && leftMax > 0 ? { max: leftMax } : {}),
      },
      {
        type: "value",
        show: showRight,
        position: "right",
        name: "Rate %",
        nameTextStyle: { color: tc, fontSize: 11 },
        axisLabel: {
          color: tc,
          fontSize: 11,
          formatter: (v: number) => `${v}%`,
        },
        splitLine: { show: false },
        ...(rightMax != null && Number.isFinite(rightMax) && rightMax > 0 ? { max: rightMax } : {}),
      },
    ],
    series,
  };
});

function openMetricChartDrawer() {
  if (chartActiveKeys.value.length === 0 || chartColumnFlows.value.length === 0) return;
  if (props.projectId) {
    trackAnalyticsEvent("analytics_generate_chart_from_table", {
      projectId: props.projectId,
      section: props.section,
      tableId: chartSourceTable.value,
      selectedMetricKeys: [...chartActiveKeys.value],
      selectedMetricLabels: selectedRowDefs.value.map((r) => r.label),
      selectedFlowUuids: chartColumnFlows.value.map((f) => f.flowUuid),
      selectedFlowNames: chartColumnFlows.value.map((f) => f.flowName),
      baselineFlowUuid: baselineFlowUuid.value,
    });
  }
  chartDrawerOpen.value = true;
}

const selectedMetricsSummary = computed(() =>
  selectedRowDefs.value.map((r) => r.label).join(" · ")
);

const canOpenMetricChart = computed(
  () => chartActiveKeys.value.length > 0 && chartColumnFlows.value.length > 0
);

watch(
  () => [props.flows, props.selectedFlowUuids] as const,
  () => {
    selectedMetricKeysByTable.value = emptyMetricSelections();
    chartColumnFlows.value = [];
    chartDrawerOpen.value = false;
    chartSourceTable.value = defaultChartSourceTable();
  },
  { deep: true }
);

watch(rankSortMetric, (metric) => {
  if (!props.projectId) return;
  trackAnalyticsEvent("analytics_change_rank_tables_by_filter", {
    projectId: props.projectId,
    section: props.section,
    metric,
  });
});

watch(baselineFlowUuid, (baseline) => {
  if (!props.projectId || props.section !== "performance") return;
  trackAnalyticsEvent("analytics_change_selected_flows_vs_baseline", {
    projectId: props.projectId,
    section: props.section,
    baselineFlowUuid: baseline,
    selectedFlowUuids: [...props.selectedFlowUuids],
  });
});
</script>

<template>
  <div class="amm-metric-matrix-root">
  <NCard
    v-if="section === 'rankings'"
    :title="rankTablesCardTitle"
    size="small"
    class="flow-dash__card flow-dash__card--spaced"
  >
    <div class="amm-rank-toolbar">
      <NText depth="3" class="amm-rank-toolbar-label">Rank tables by</NText>
      <NSelect
        v-model:value="rankSortMetric"
        size="small"
        :options="rankMetricSelectOptions"
        class="amm-rank-metric-select"
        :consistent-menu-width="false"
      />
    </div>
    <NText depth="3" class="amm-rank-hint">
      Metrics as rows, {{ groupEntityPlural }} as columns. Order by selected metric (rates: higher first; entities
      with no sends last · counts: higher first). Left column = baseline for % tags (<code>#rank</code> = overall rank).
      The baseline cell for the metric you rank by shows a <strong>Best</strong> tag (Top / single table) or
      <strong>Ref</strong> (Least table, reference for % deltas).
      <strong>Click metric rows</strong> (row highlight) to choose one or more; then <strong>Render chart</strong> — counts
      use the left axis, rates use the right axis.
    </NText>
    <div class="amm-chart-actions">
      <NText v-if="chartActiveKeys.length > 0" depth="3" class="amm-chart-actions__text">
        {{ selectedMetricsSummary }}
      </NText>
      <NText v-else depth="3" class="amm-chart-actions__placeholder">
        Select metric rows in the matrix below, then open the chart.
      </NText>
      <NSpace size="small" wrap>
        <NButton
          size="small"
          quaternary
          :disabled="!hasAnyMetricSelection"
          @click="clearMetricSelection"
        >
          Clear selection
        </NButton>
        <NButton
          size="small"
          type="primary"
          :disabled="!canOpenMetricChart"
          @click="openMetricChartDrawer"
        >
          Render chart
        </NButton>
      </NSpace>
    </div>
    <NGrid v-if="showSplitRankTables" cols="24" responsive="screen" :x-gap="16" :y-gap="12" class="amm-rank-grid">
      <NGi span="24 m:12">
        <NText class="amm-rank-table-title">Top</NText>
        <NDataTable
          size="small"
          :bordered="true"
          :single-line="false"
          :columns="topRankMatrixColumns"
          :data="MATRIX_ROW_DEFS"
          :row-key="matrixDataRowKey"
          :row-class-name="matrixRowClassNameForTable('top')"
          :row-props="rowPropsForMatrix(topPerformersTableData, 'top')"
          :pagination="false"
          :scroll-x="1100"
          class="amm-data-table amm-matrix-table amm-rank-matrix"
        />
      </NGi>
      <NGi span="24 m:12">
        <NText class="amm-rank-table-title">Least</NText>
        <NDataTable
          size="small"
          :bordered="true"
          :single-line="false"
          :columns="leastRankMatrixColumns"
          :data="MATRIX_ROW_DEFS"
          :row-key="matrixDataRowKey"
          :row-class-name="matrixRowClassNameForTable('least')"
          :row-props="rowPropsForMatrix(leastPerformersTableData, 'least')"
          :pagination="false"
          :scroll-x="1100"
          class="amm-data-table amm-matrix-table amm-rank-matrix"
        />
      </NGi>
    </NGrid>
    <template v-else>
      <NDataTable
        size="small"
        :bordered="true"
        :single-line="false"
        :columns="allFlowsRankMatrixColumns"
        :data="MATRIX_ROW_DEFS"
        :row-key="matrixDataRowKey"
        :row-class-name="matrixRowClassNameForTable('single')"
        :row-props="rowPropsForMatrix(topPerformersTableData, 'single')"
        :pagination="false"
        :scroll-x="1100"
        class="amm-data-table amm-matrix-table amm-rank-matrix"
      />
    </template>
  </NCard>

  <NCard
    v-else-if="section === 'performance'"
    :title="performanceCardTitle"
    size="small"
    class="flow-dash__card flow-dash__card--spaced"
  >
    <template v-if="selectedFlowUuids.length === 0">
      <NText depth="3" class="amm-matrix-empty">
        Choose {{ groupEntityPlural }} under <strong>{{ groupEntityTitle }} (charts & matrix)</strong> in Filters above.
      </NText>
    </template>
    <template v-else>
      <div class="amm-matrix-toolbar">
        <NText depth="3" class="amm-matrix-toolbar-label">Baseline</NText>
        <NSelect
          v-model:value="baselineFlowUuid"
          size="small"
          :options="baselineOptions"
          :placeholder="`Baseline ${groupEntitySingular}`"
          class="amm-matrix-baseline"
          :consistent-menu-width="false"
        />
      </div>
      <NText depth="3" class="amm-matrix-hint">
        Click <strong>metric</strong> rows to select; <strong>Render chart</strong> uses columns shown here. Counts →
        left axis, rates → right axis.
      </NText>
      <div class="amm-chart-actions">
        <NText v-if="chartActiveKeys.length > 0" depth="3" class="amm-chart-actions__text">
          {{ selectedMetricsSummary }}
        </NText>
        <NText v-else depth="3" class="amm-chart-actions__placeholder">
          Select metric rows in the matrix below, then open the chart.
        </NText>
        <NSpace size="small" wrap>
          <NButton
            size="small"
            quaternary
            :disabled="!hasAnyMetricSelection"
            @click="clearMetricSelection"
          >
            Clear selection
          </NButton>
          <NButton
            size="small"
            type="primary"
            :disabled="!canOpenMetricChart"
            @click="openMetricChartDrawer"
          >
            Render chart
          </NButton>
        </NSpace>
      </div>
      <NDataTable
        size="small"
        :bordered="true"
        :single-line="false"
        :columns="performanceMatrixColumns"
        :data="MATRIX_ROW_DEFS"
        :row-key="matrixDataRowKey"
        :row-class-name="matrixRowClassNameForTable('performance')"
        :row-props="rowPropsForMatrix(orderedMatrixColumns, 'performance')"
        :pagination="false"
        :scroll-x="900"
        class="amm-data-table amm-matrix-table"
      />
    </template>
  </NCard>

  <NDrawer v-model:show="chartDrawerOpen" :width="800" placement="right" display-directive="show">
    <NDrawerContent title="Metric chart" closable>
      <NText depth="3" class="amm-drawer-hint">
        Series per selected metric. <strong>Absolute</strong> counts use the <strong>left</strong> Y axis;
        <strong>Rate %</strong> metrics use the <strong>right</strong> Y axis. X = {{ groupEntityPlural }} from the table
        you clicked.
      </NText>
      <div class="amm-drawer-settings">
        <div class="amm-drawer-settings__row">
          <NText class="amm-drawer-settings__label" depth="3">Absolute (left)</NText>
          <NSelect
            v-model:value="drawerMetricStyleAbsolute"
            size="small"
            :options="drawerChartTypeOptions"
            :disabled="!drawerHasCountSeries"
            class="amm-drawer-settings__select"
            :consistent-menu-width="false"
          />
          <NText class="amm-drawer-settings__label" depth="3">Y max</NText>
          <NInputNumber
            v-model:value="yAxisMaxAbsolute"
            size="small"
            clearable
            :min="0"
            :show-button="false"
            :disabled="!drawerHasCountSeries"
            placeholder="Auto"
            class="amm-drawer-settings__max"
          />
        </div>
        <div class="amm-drawer-settings__row">
          <NText class="amm-drawer-settings__label" depth="3">Rate % (right)</NText>
          <NSelect
            v-model:value="drawerMetricStyleRate"
            size="small"
            :options="drawerChartTypeOptions"
            :disabled="!drawerHasRateSeries"
            class="amm-drawer-settings__select"
            :consistent-menu-width="false"
          />
          <NText class="amm-drawer-settings__label" depth="3">Y max</NText>
          <NInputNumber
            v-model:value="yAxisMaxRate"
            size="small"
            clearable
            :min="0"
            :show-button="false"
            :disabled="!drawerHasRateSeries"
            placeholder="Auto"
            class="amm-drawer-settings__max"
          />
        </div>
      </div>
      <NDivider class="amm-drawer-divider" />
      <div class="amm-drawer-chart">
        <VChart
          class="amm-echart-bar"
          :option="matrixBarChartOption"
          :update-options="chartUpdateOptions"
          :autoresize="{ throttle: 200 }"
        />
      </div>
    </NDrawerContent>
  </NDrawer>
  </div>
</template>

<style scoped>
.amm-rank-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.65rem;
  margin-bottom: 0.45rem;
}

.amm-rank-toolbar-label {
  font-size: 0.8125rem;
  margin: 0;
  white-space: nowrap;
}

.amm-rank-metric-select {
  min-width: 200px;
  max-width: min(340px, 100%);
}

.amm-rank-hint {
  display: block;
  font-size: 0.8125rem;
  margin: 0 0 0.5rem;
  line-height: 1.35;
}

.amm-rank-grid {
  margin-top: 0.15rem;
}

.amm-rank-table-title {
  display: block;
  font-size: 0.8125rem;
  font-weight: 600;
  margin-bottom: 0.35rem;
}

.amm-matrix-empty {
  font-size: 0.8125rem;
  margin: 0;
}

.amm-matrix-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.65rem;
  margin-bottom: 0.45rem;
}

.amm-matrix-toolbar-label {
  font-size: 0.8125rem;
  margin: 0;
}

.amm-matrix-baseline {
  min-width: 180px;
  max-width: min(420px, 100%);
}

.amm-matrix-num {
  font-variant-numeric: tabular-nums;
}

.amm-matrix-sort-baseline {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
  max-width: 100%;
  padding: 5px 9px;
  margin: -2px -4px;
  border-radius: 8px;
  background-color: color-mix(
    in srgb,
    var(--n-primary-color) 18%,
    var(--n-color-embedded, var(--n-color))
  );
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--n-primary-color) 32%, transparent);
  vertical-align: middle;
}

.amm-matrix-num--badged {
  font-weight: 600;
}

.amm-data-table {
  margin-top: 0.15rem;
}

.amm-matrix-hint {
  display: block;
  font-size: 0.8125rem;
  margin: 0 0 0.5rem;
  line-height: 1.35;
}

.amm-chart-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 0.75rem;
  margin: 0.35rem 0 0.65rem;
  padding: 0.45rem 0.65rem;
  min-height: 3rem;
  border-radius: 8px;
  background: var(--n-color-embedded, var(--n-color));
  border: 1px solid var(--n-border-color);
}

.amm-chart-actions__text {
  font-size: 0.8125rem;
  flex: 1 1 200px;
  min-width: 0;
}

.amm-chart-actions__placeholder {
  font-size: 0.8125rem;
  flex: 1 1 200px;
  min-width: 0;
  line-height: 1.35;
}

.amm-drawer-hint {
  display: block;
  margin-bottom: 0.5rem;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.amm-drawer-settings {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.amm-drawer-settings__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
}

.amm-drawer-settings__label {
  font-size: 0.8125rem;
  flex: 0 0 auto;
  min-width: 6.75rem;
}

.amm-drawer-settings__select {
  min-width: 118px;
  max-width: min(200px, 100%);
}

.amm-drawer-settings__max {
  width: 118px;
  max-width: 100%;
}

.amm-drawer-divider {
  margin: 0.45rem 0 0.35rem;
}

.amm-drawer-chart {
  width: 100%;
  height: min(620px, 72vh);
  min-height: 420px;
}

.amm-echart-bar {
  width: 100%;
  height: 100%;
  min-height: 400px;
}
</style>
