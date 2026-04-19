<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NCard,
  NSpin,
  NAlert,
  NText,
  NDatePicker,
  NSelect,
  NButton,
  NTag,
  NTooltip,
  NTabs,
  NTabPane,
  NRadioGroup,
  NRadioButton,
  NGrid,
  NGi,
  NDataTable,
} from "naive-ui";
import type { SelectOption, DataTableColumns } from "naive-ui";
import { useDark } from "@vueuse/core";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { LineChart, SankeyChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  GraphicComponent,
} from "echarts/components";
import type { EChartsOption } from "echarts";
import VChart from "vue-echarts";
import AnalyticsMetricMatrix from "../components/analytics/AnalyticsMetricMatrix.vue";
import ConversationsGeoInsights from "../components/analytics/ConversationsGeoInsights.vue";
import { useProjectStore } from "../stores/project";

use([
  CanvasRenderer,
  LineChart,
  SankeyChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  GraphicComponent,
]);

/** Avoid merge stacking + layout feedback with autoresize (see ECharts setOption). */
const chartUpdateOptions = { notMerge: true as const };

const projectStore = useProjectStore();
const isDark = useDark();

const dashboardTab = ref<"rankings" | "totals" | "funnels" | "daily" | "geo">("rankings");

/** `groupBy` = flow uses flow uuid+name; hypothesis uses hypothesis id+name (same fields for charts). */
const analyticsGroupBy = ref<"flow" | "hypothesis">("flow");

interface FlowFunnelRow {
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
  /** Hypothesis groupBy: tag-linked contacts (from `/api/project-analytics`). */
  linkedContactsCount?: number;
  /** Hypothesis groupBy: distinct flows in the rollup. */
  linkedFlowsCount?: number;
}

interface FlowFunnelProjectTotalsPayload {
  messagesSent: number;
  connectionSent: number;
  connectionAccepted: number;
  inbox: number;
  positiveReplies: number;
  connectionRequestRatePct: number | null;
  acceptedRatePct: number | null;
  inboxRatePct: number | null;
  positiveRatePct: number | null;
}

interface FlowFunnelComparisonPayload {
  previousDateFrom: string;
  previousDateTo: string;
  totals: FlowFunnelProjectTotalsPayload;
}

const EMPTY_FUNNEL_TOTALS: FlowFunnelProjectTotalsPayload = {
  messagesSent: 0,
  connectionSent: 0,
  connectionAccepted: 0,
  inbox: 0,
  positiveReplies: 0,
  connectionRequestRatePct: null,
  acceptedRatePct: null,
  inboxRatePct: null,
  positiveRatePct: null,
};

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

/** Funnel stages: same four steps as GetSales snapshots / `render_funnel_chart` (colors reused per stage). */
const STAGE_LABELS = [
  "Connection sent",
  "Connection accepted",
  "Inbox reply",
  "Inbox positive",
] as const;

const collectingDays = ref(false);
const loading = ref(false);
const loadError = ref("");
const warnings = ref<string[]>([]);
const flows = ref<FlowFunnelRow[]>([]);

const groupEntityTitle = computed(() =>
  analyticsGroupBy.value === "hypothesis" ? "Hypotheses" : "Flows"
);
const groupEntityPlural = computed(() =>
  analyticsGroupBy.value === "hypothesis" ? "hypotheses" : "flows"
);
const groupEntitySingular = computed(() =>
  analyticsGroupBy.value === "hypothesis" ? "hypothesis" : "flow"
);
const projectTotalsCardTitle = computed(
  () =>
    "Project totals (all snapshot traffic in range — same sum whether you group by flow or hypothesis below)"
);
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

function compareFlowRowsByConnectionsSentDesc(
  a: FlowFunnelRow,
  b: FlowFunnelRow
): number {
  return (
    b.connectionSent - a.connectionSent ||
    a.flowName.localeCompare(b.flowName, undefined, { sensitivity: "base" })
  );
}

/** Flow/hypothesis tag strip: highest connection sent first, then name. */
const flowsSortedForPicker = computed(() =>
  [...flows.value].sort(compareFlowRowsByConnectionsSentDesc)
);

const FLOW_PICKER_BADGE_LIMIT = 25;

/** Expanded tag strip shows every flow/hypothesis; collapsed shows first N (by volume). */
const flowPickerExpanded = ref(false);

const flowsPickerRows = computed(() =>
  flowsSortedForPicker.value.map((f, i) => ({ flow: f, idx: i }))
);

const flowsPickerRowsShown = computed(() => {
  const rows = flowsPickerRows.value;
  if (flowPickerExpanded.value || rows.length <= FLOW_PICKER_BADGE_LIMIT) return rows;
  return rows.slice(0, FLOW_PICKER_BADGE_LIMIT);
});

const flowPickerHasOverflow = computed(
  () => flowsPickerRows.value.length > FLOW_PICKER_BADGE_LIMIT
);

watch(
  () => flowsPickerRows.value.length,
  (n) => {
    if (n <= FLOW_PICKER_BADGE_LIMIT) flowPickerExpanded.value = false;
  }
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
    .sort(compareFlowRowsByConnectionsSentDesc)
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
const deltaPositiveRate = computed(() =>
  rateChangeMeta(
    displayFunnelTotals.value.positiveRatePct,
    prevFunnelTotals.value?.positiveRatePct ?? null
  )
);

function formatInt(n: number): string {
  return new Intl.NumberFormat().format(Math.round(n));
}

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

/** Same stage → same color across all flows/hypotheses (aligned with server funnel chart palette). */
const FUNNEL_STAGE_COLORS_LIGHT = ["#5470c6", "#91cc75", "#fac858", "#ee6666"] as const;
const FUNNEL_STAGE_COLORS_DARK = ["#6b8bd9", "#7fd67f", "#ffd666", "#f08080"] as const;

function funnelStageColor(stageIndex: number, dark: boolean): string {
  const palette = dark ? FUNNEL_STAGE_COLORS_DARK : FUNNEL_STAGE_COLORS_LIGHT;
  return palette[stageIndex % 4]!;
}

/**
 * Stable per-alluvium (per-flow) color palette. Used by the conversion Sankey
 * so every stratum of a given flow shares the same hue across all 4 axes,
 * making alluvia traceable by color. Tableau-10-ish qualitative set.
 */
const FLOW_ALLUVIUM_COLORS_LIGHT = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2",
  "#59a14f", "#edc948", "#b07aa1", "#ff9da7",
  "#9c755f",
] as const;
const FLOW_ALLUVIUM_COLORS_DARK = [
  "#6b9cd3", "#f3a756", "#ea7878", "#8dc7c2",
  "#7bb871", "#f2d472", "#c08bb6", "#ffb4be",
  "#b08c76",
] as const;

function flowAlluviumColor(index: number, dark: boolean, isOther: boolean): string {
  if (isOther) {
    return dark ? "#8a8a8a" : "#b0b0b0";
  }
  const palette = dark ? FLOW_ALLUVIUM_COLORS_DARK : FLOW_ALLUVIUM_COLORS_LIGHT;
  return palette[index % palette.length]!;
}

function chartSurfaceBg(dark: boolean): string {
  return dark ? "rgba(28, 28, 32, 0.96)" : "rgba(248, 249, 252, 0.98)";
}

function chartTextColor(dark: boolean): string {
  return dark ? "rgba(255, 255, 255, 0.78)" : "rgba(0, 0, 0, 0.72)";
}

function splitLineColor(dark: boolean): string {
  return dark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
}

/**
 * Cascaded funnel Sankey: per-flow attribution preserved through every stage.
 *
 * Two modes:
 * - `absolute`: classic funnel Sankey with drop-off sinks at each transition.
 *   All columns share the same total height (= total sent); lost volume fans
 *   into shared grey sinks. Reads like: "where does the pipeline leak".
 *
 * - `conversion`: normalized Total → by-flow shares of connection sent; each
 *   flow keeps that strip width along its path but Inbox / Positive nodes exist
 *   only when that flow’s count is > 0 (ribbon ends at Accepted or Inbox
 *   otherwise). If only one flow reaches Inbox or Positive, that node’s value
 *   is scaled to `BASE` so the column matches earlier column height. No
 *   drop-off sinks. Labels/tooltips show counts and % per stage.
 *
 * Caps at the top 8 selected flows by `connectionSent`; the tail rolls into a
 * synthetic "Other" bucket so totals still tie out against `displayFunnelTotals`.
 */
const FUNNEL_SANKEY_FLOW_LIMIT = 8;

type FunnelSankeyMode = "absolute" | "conversion";

const funnelSankeyMode = ref<FunnelSankeyMode>("absolute");

const funnelSankeyModeOptions: SelectOption[] = [
  { label: "Absolute volumes (with drop-off)", value: "absolute" },
  { label: "Conversion (equal-height % columns)", value: "conversion" },
];

function stripSankeyPrefix(raw: string): string {
  const idx = raw.indexOf(":");
  return idx >= 0 ? raw.slice(idx + 1) : raw;
}

type FunnelBucket = {
  key: string;
  label: string;
  sent: number;
  accepted: number;
  inbox: number;
  positive: number;
};

const funnelSankeyBuckets = computed((): FunnelBucket[] => {
  const list = [...filteredFlows.value].sort(compareFlowRowsByConnectionsSentDesc);
  if (list.length === 0) return [];
  const top = list.slice(0, FUNNEL_SANKEY_FLOW_LIMIT);
  const tail = list.slice(FUNNEL_SANKEY_FLOW_LIMIT);
  const buckets: FunnelBucket[] = top.map((f) => ({
    key: f.flowUuid,
    label: f.flowName,
    sent: Math.max(0, f.connectionSent | 0),
    accepted: Math.max(0, f.connectionAccepted | 0),
    inbox: Math.max(0, f.inbox | 0),
    positive: Math.max(0, f.positiveReplies | 0),
  }));
  if (tail.length > 0) {
    buckets.push(
      tail.reduce<FunnelBucket>(
        (acc, f) => ({
          key: acc.key,
          label: acc.label,
          sent: acc.sent + Math.max(0, f.connectionSent | 0),
          accepted: acc.accepted + Math.max(0, f.connectionAccepted | 0),
          inbox: acc.inbox + Math.max(0, f.inbox | 0),
          positive: acc.positive + Math.max(0, f.positiveReplies | 0),
        }),
        {
          key: "__other__",
          label: `Other (${tail.length} ${groupEntityPlural.value})`,
          sent: 0,
          accepted: 0,
          inbox: 0,
          positive: 0,
        }
      )
    );
  }
  return buckets.filter((b) => b.sent > 0);
});

type SankeyNodeLite = {
  name: string;
  depth?: number;
  value?: number;
  itemStyle?: { color?: string; borderColor?: string; borderWidth?: number };
  label?: { color?: string; fontWeight?: "normal" | "bold"; show?: boolean };
  /** Count shown in tooltip (mirrors `value` in conversion mode; kept for formatter parity). */
  _raw?: number;
  /** Stable ordinal used by `series.nodeSort` to pin stratum order per axis. */
  __rank?: number;
};
type SankeyLinkLite = {
  source: string;
  target: string;
  value: number;
  lineStyle?: { color?: string; opacity?: number };
  /** Count shown in tooltip (through-flow between stages in conversion mode). */
  _raw?: number;
};

/** Absolute mode: flow → accepted·F / not-accepted; accepted·F → inbox·F / no-reply; inbox·F → positive / non-positive. */
function buildAbsoluteSankey(
  buckets: FunnelBucket[],
  dark: boolean,
  tc: string
): { nodes: SankeyNodeLite[]; links: SankeyLinkLite[] } {
  const cSent = funnelStageColor(0, dark);
  const cAccepted = funnelStageColor(1, dark);
  const cInbox = funnelStageColor(2, dark);
  const cPositive = funnelStageColor(3, dark);
  const cDrop = dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)";

  const nodes: SankeyNodeLite[] = [];
  const links: SankeyLinkLite[] = [];
  const nodeSeen = new Set<string>();
  const pushNode = (n: SankeyNodeLite): void => {
    if (nodeSeen.has(n.name)) return;
    nodeSeen.add(n.name);
    nodes.push(n);
  };
  const pushLink = (link: SankeyLinkLite): void => {
    if (link.value <= 0) return;
    links.push(link);
  };

  const nodeDropAccept = "sink:Not accepted";
  const nodeDropInbox = "sink:Accepted · no reply";
  const nodePositive = "sink:Positive replies";
  const nodeNonPositive = "sink:Inbox · non-positive";

  buckets.forEach((b, idx) => {
    const nFlow = `flow:${b.label}`;
    const nAcc = `accepted:${b.label}`;
    const nInb = `inbox:${b.label}`;
    pushNode({ name: nFlow, depth: 0, itemStyle: { color: cSent, borderColor: cSent }, label: { color: tc, fontWeight: "bold" }, __rank: idx });
    pushNode({ name: nAcc, depth: 1, itemStyle: { color: cAccepted, borderColor: cAccepted }, label: { color: tc }, __rank: idx });
    pushNode({ name: nInb, depth: 2, itemStyle: { color: cInbox, borderColor: cInbox }, label: { color: tc }, __rank: idx });

    pushLink({ source: nFlow, target: nAcc, value: b.accepted, lineStyle: { color: cAccepted, opacity: 0.55 } });
    pushLink({ source: nFlow, target: nodeDropAccept, value: Math.max(0, b.sent - b.accepted), lineStyle: { color: cDrop, opacity: 0.35 } });

    pushLink({ source: nAcc, target: nInb, value: b.inbox, lineStyle: { color: cInbox, opacity: 0.6 } });
    pushLink({ source: nAcc, target: nodeDropInbox, value: Math.max(0, b.accepted - b.inbox), lineStyle: { color: cDrop, opacity: 0.35 } });

    pushLink({ source: nInb, target: nodePositive, value: b.positive, lineStyle: { color: cPositive, opacity: 0.7 } });
    pushLink({ source: nInb, target: nodeNonPositive, value: Math.max(0, b.inbox - b.positive), lineStyle: { color: cDrop, opacity: 0.35 } });
  });

  pushNode({ name: nodeDropAccept, depth: 1, itemStyle: { color: cDrop, borderColor: cDrop }, label: { color: tc }, __rank: 9000 });
  pushNode({ name: nodeDropInbox, depth: 2, itemStyle: { color: cDrop, borderColor: cDrop }, label: { color: tc }, __rank: 9001 });
  pushNode({ name: nodePositive, depth: 3, itemStyle: { color: cPositive, borderColor: cPositive }, label: { color: tc, fontWeight: "bold" }, __rank: 9002 });
  pushNode({ name: nodeNonPositive, depth: 3, itemStyle: { color: cDrop, borderColor: cDrop }, label: { color: tc }, __rank: 9003 });

  return { nodes, links };
}

/**
 * Conversion mode: five columns when data exists. After “Total”, each flow uses
 * the same strip width (share of connection sent) along its path. Inbox and
 * Positive nodes/links exist only when that flow has inbox > 0 or positive > 0
 * respectively; otherwise the ribbon ends at Accepted (or at Inbox if
 * positive is 0). When exactly one flow reaches Inbox (or Positive), that
 * node’s `value` is `BASE` so that column matches the total column height.
 */
function buildConversionSankey(
  buckets: FunnelBucket[],
  dark: boolean,
  tc: string
): { nodes: SankeyNodeLite[]; links: SankeyLinkLite[] } {
  const BASE = 10_000;
  const cSent = funnelStageColor(0, dark);
  const cAccepted = funnelStageColor(1, dark);
  const cInbox = funnelStageColor(2, dark);
  const cPositive = funnelStageColor(3, dark);

  const totalSent = buckets.reduce((s, b) => s + b.sent, 0);
  if (totalSent <= 0) return { nodes: [], links: [] };

  const nodes: SankeyNodeLite[] = [];
  const links: SankeyLinkLite[] = [];
  const nodeSeen = new Set<string>();
  const pushNode = (n: SankeyNodeLite): void => {
    if (nodeSeen.has(n.name)) return;
    if (typeof n.value === "number" && n.value <= 0) return;
    nodeSeen.add(n.name);
    nodes.push(n);
  };
  const pushLink = (link: SankeyLinkLite): void => {
    if (link.value <= 1e-9) return;
    links.push(link);
  };

  const nodeTotal = "total:All connections";

  pushNode({
    name: nodeTotal,
    depth: 0,
    value: BASE,
    _raw: totalSent,
    itemStyle: { color: cSent, borderColor: cSent },
    label: { color: tc, fontWeight: "bold" },
    __rank: -1,
  });

  const wStrip = buckets.map((b) => (BASE * b.sent) / totalSent);

  buckets.forEach((b, idx) => {
    const ws = wStrip[idx]!;
    const isOther = b.key === "__other__";
    const flowColor = flowAlluviumColor(idx, dark, isOther);
    const nSplit = `split:${b.label}`;

    pushNode({
      name: nSplit,
      depth: 1,
      value: ws,
      _raw: b.sent,
      itemStyle: { color: flowColor, borderColor: cSent, borderWidth: 1 },
      label: { color: tc, fontWeight: "bold" },
      __rank: idx,
    });
    pushLink({
      source: nodeTotal,
      target: nSplit,
      value: ws,
      _raw: b.sent,
      lineStyle: { color: flowColor, opacity: 0.38 },
    });
  });

  buckets.forEach((b, idx) => {
    const ws = wStrip[idx]!;
    const isOther = b.key === "__other__";
    const flowColor = flowAlluviumColor(idx, dark, isOther);
    const nSplit = `split:${b.label}`;
    const nAcc = `accepted:${b.label}`;

    pushNode({
      name: nAcc,
      depth: 2,
      value: ws,
      _raw: b.accepted,
      itemStyle: { color: flowColor, borderColor: cAccepted, borderWidth: 1 },
      label: { color: tc },
      __rank: idx,
    });
    pushLink({
      source: nSplit,
      target: nAcc,
      value: ws,
      _raw: b.accepted,
      lineStyle: { color: flowColor, opacity: 0.55 },
    });
  });

  const inboxIdx = buckets.map((b, i) => (b.inbox > 0 ? i : -1)).filter((i): i is number => i >= 0);

  if (inboxIdx.length > 0) {
    const soleInb = inboxIdx.length === 1;
    inboxIdx.forEach((i) => {
      const b = buckets[i]!;
      const ws = wStrip[i]!;
      const flowColor = flowAlluviumColor(i, dark, b.key === "__other__");
      const nAcc = `accepted:${b.label}`;
      const nInb = `inbox:${b.label}`;

      pushNode({
        name: nInb,
        depth: 3,
        value: soleInb ? BASE : ws,
        _raw: b.inbox,
        itemStyle: { color: flowColor, borderColor: cInbox, borderWidth: 1 },
        label: { color: tc },
        __rank: i,
      });
      pushLink({
        source: nAcc,
        target: nInb,
        value: ws,
        _raw: b.inbox,
        lineStyle: { color: flowColor, opacity: 0.55 },
      });
    });
  }

  const posIdx = buckets.map((b, i) => (b.positive > 0 ? i : -1)).filter((i): i is number => i >= 0);

  if (posIdx.length > 0) {
    const solePos = posIdx.length === 1;
    posIdx.forEach((i) => {
      const b = buckets[i]!;
      const ws = wStrip[i]!;
      const flowColor = flowAlluviumColor(i, dark, b.key === "__other__");
      const nAcc = `accepted:${b.label}`;
      const nInb = `inbox:${b.label}`;
      const nPos = `positive:${b.label}`;
      const src = b.inbox > 0 ? nInb : nAcc;

      pushNode({
        name: nPos,
        depth: 4,
        value: solePos ? BASE : ws,
        _raw: b.positive,
        itemStyle: { color: flowColor, borderColor: cPositive, borderWidth: 1 },
        label: { color: tc },
        __rank: i,
      });
      pushLink({
        source: src,
        target: nPos,
        value: ws,
        _raw: b.positive,
        lineStyle: { color: flowColor, opacity: 0.58 },
      });
    });
  }

  return { nodes, links };
}

const funnelSankeyOption = computed((): EChartsOption => {
  const buckets = funnelSankeyBuckets.value;
  const dark = isDark.value;
  const tc = chartTextColor(dark);
  const mode = funnelSankeyMode.value;

  if (buckets.length === 0) {
    return { animation: false, series: [] };
  }

  const { nodes, links } =
    mode === "conversion"
      ? buildConversionSankey(buckets, dark, tc)
      : buildAbsoluteSankey(buckets, dark, tc);

  if (links.length === 0) {
    return { animation: false, series: [] };
  }

  const topN = Math.min(buckets.length, FUNNEL_SANKEY_FLOW_LIMIT);
  const subtext =
    mode === "conversion"
      ? `Conversion · ribbon width = share of connection sent; path ends early when inbox/positive is 0; a sole survivor at Inbox or Positive fills that column height. Top ${topN} ${groupEntityPlural.value}.`
      : `Absolute · Flow → Accepted → Inbox → Positive · top ${topN} ${groupEntityPlural.value}`;

  const stageLabels =
    mode === "conversion"
      ? (["Total", "By flow", "Accepted", "Inbox", "Positive"] as const)
      : (["Sent", "Accepted", "Inbox", "Positive"] as const);
  const axisHeaderTop = 52;
  const sankeyTop = 76;
  const sankeyLeft = 12;
  const sankeyRight = 140;
  const nodeWidth = 14;

  const truncateLabel = (name: string, max = 18): string =>
    name.length > max ? `${name.slice(0, max - 1)}…` : name;

  const totalSentConv = buckets.reduce((s, b) => s + b.sent, 0);
  const sumAccConv = buckets.reduce((s, b) => s + b.accepted, 0);
  const sumInbConv = buckets.reduce((s, b) => s + b.inbox, 0);
  const sumPosConv = buckets.reduce((s, b) => s + b.positive, 0);

  const axisHeaders = stageLabels.map((txt, i) => {
    const color =
      mode === "conversion"
        ? i === 0 || i === 1
          ? funnelStageColor(0, dark)
          : funnelStageColor(i - 1, dark)
        : funnelStageColor(i, dark);
    const baseStyle = {
      text: txt,
      fill: color,
      opacity: 0.85,
      font: "bold 11px sans-serif",
    };
    const last = stageLabels.length - 1;
    if (i === 0) {
      return {
        type: "text" as const,
        left: sankeyLeft,
        top: axisHeaderTop,
        style: { ...baseStyle, textAlign: "left" as const },
      };
    }
    if (i === last) {
      return {
        type: "text" as const,
        right: sankeyRight + nodeWidth - 4,
        top: axisHeaderTop,
        style: { ...baseStyle, textAlign: "right" as const },
      };
    }
    const spread = mode === "conversion" ? 58 : 62;
    const start = mode === "conversion" ? 16 : 18;
    const leftPct = `${start + (spread * i) / last}%`;
    return {
      type: "text" as const,
      left: leftPct,
      top: axisHeaderTop,
      style: { ...baseStyle, textAlign: "center" as const },
    };
  });

  return {
    animation: false,
    backgroundColor: chartSurfaceBg(dark),
    textStyle: { color: tc },
    title: {
      text: "Funnel Sankey",
      subtext,
      left: "center",
      top: 6,
      textStyle: { color: tc, fontSize: 17, fontWeight: "bold" },
      subtextStyle: { color: tc, opacity: 0.72, fontSize: 12 },
    },
    graphic: axisHeaders,
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "rgba(40, 40, 44, 0.94)" : "rgba(255, 255, 255, 0.96)",
      borderColor: splitLineColor(dark),
      textStyle: { fontSize: 13, color: tc },
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params;
        if (!p || typeof p !== "object") return "";
        const dataType = (p as { dataType?: string }).dataType;
        const data = (p as { data?: { source?: string; target?: string; value?: number; _raw?: number } }).data ?? {};
        const raw = typeof data._raw === "number" ? data._raw : undefined;
        if (dataType === "edge") {
          const src = stripSankeyPrefix(String(data.source ?? ""));
          const tgt = stripSankeyPrefix(String(data.target ?? ""));
          const v = raw ?? Number(data.value ?? 0);
          return `${src} → ${tgt}<br/><strong>${v.toLocaleString()}</strong>`;
        }
        const fullName = String((p as { name?: string }).name ?? "");
        const name = stripSankeyPrefix(fullName);
        const v = raw ?? Number((p as { value?: number }).value ?? 0);
        if (mode === "conversion") {
          const b = buckets.find((x) => x.label === name);
          if (fullName.startsWith("total:")) {
            return `Total connections<br/><strong>${totalSentConv.toLocaleString()}</strong> (connection sent)`;
          }
          if (fullName.startsWith("split:") && b && totalSentConv > 0) {
            const pct = Math.round((100 * b.sent) / totalSentConv);
            return `${name}<br/><strong>${b.sent.toLocaleString()}</strong> (${pct}% of connection sent)`;
          }
          if (fullName.startsWith("accepted:") && b && sumAccConv > 0) {
            const pct = Math.round((100 * b.accepted) / sumAccConv);
            return `${name}<br/><strong>${b.accepted.toLocaleString()}</strong> (${pct}% of accepted)`;
          }
          if (fullName.startsWith("inbox:") && b && sumInbConv > 0) {
            const pct = Math.round((100 * b.inbox) / sumInbConv);
            return `${name}<br/><strong>${b.inbox.toLocaleString()}</strong> (${pct}% of inbox)`;
          }
          if (fullName.startsWith("positive:") && b && sumPosConv > 0) {
            const pct = Math.round((100 * b.positive) / sumPosConv);
            return `${name}<br/><strong>${b.positive.toLocaleString()}</strong> (${pct}% of positive)`;
          }
        }
        return `${name}<br/><strong>${v.toLocaleString()}</strong>`;
      },
    },
    // `nodeSort` is supported at runtime but missing from the current ECharts
    // type definitions for SankeySeriesOption; cast to EChartsOption["series"].
    series: [
      {
        type: "sankey",
        left: sankeyLeft,
        right: sankeyRight,
        top: sankeyTop,
        bottom: 16,
        nodeWidth,
        nodeGap: 8,
        nodeAlign: "justify",
        layoutIterations: 0,
        draggable: false,
        emphasis: { focus: mode === "conversion" ? "trajectory" : "adjacency" },
        label: {
          color: tc,
          fontSize: 12,
          formatter: (p: unknown) => {
            const full = String((p as { name?: string } | undefined)?.name ?? "");
            const name = stripSankeyPrefix(full);
            if (mode !== "conversion") return truncateLabel(name);
            if (full.startsWith("sink:") || full.startsWith("total:")) return "";
            const b = buckets.find((x) => x.label === name);
            if (full.startsWith("split:") && b && totalSentConv > 0) {
              const pct = Math.round((100 * b.sent) / totalSentConv);
              return truncateLabel(`${name} (${pct}%)`);
            }
            if (full.startsWith("accepted:") && b && sumAccConv > 0) {
              const pct = Math.round((100 * b.accepted) / sumAccConv);
              return truncateLabel(`${name} (${pct}%)`);
            }
            if (full.startsWith("inbox:") && b && sumInbConv > 0) {
              const pct = Math.round((100 * b.inbox) / sumInbConv);
              return truncateLabel(`${name} (${pct}%)`);
            }
            if (full.startsWith("positive:") && b && sumPosConv > 0) {
              const pct = Math.round((100 * b.positive) / sumPosConv);
              return truncateLabel(`${name} (${pct}%)`);
            }
            return truncateLabel(name);
          },
        },
        lineStyle: { curveness: 0.5 },
        nodeSort: (a: unknown, b: unknown): number => {
          const ra = (a as { __rank?: number } | undefined)?.__rank ?? 9999;
          const rb = (b as { __rank?: number } | undefined)?.__rank ?? 9999;
          return ra - rb;
        },
        data: nodes,
        links,
      },
    ] as EChartsOption["series"],
  };
});

/** One row per calendar day from `/api/project-analytics-daily`. */
interface DailyMetricPoint {
  date: string;
  messagesSent: number;
  connectionSent: number;
  connectionAccepted: number;
  inbox: number;
  positiveReplies: number;
}

const dailySeries = ref<DailyMetricPoint[]>([]);
const dailyByEntity = ref<Array<{ entityId: string; entityName: string; series: DailyMetricPoint[] }>>([]);
const dailyLoading = ref(false);
const dailyError = ref("");
const dailyWarnings = ref<string[]>([]);
/** Combined funnel chart: lines vs stacked area. */
const dailyFunnelDisplay = ref<"lines" | "stacked">("lines");

async function loadDailyMetrics() {
  if (dashboardTab.value !== "daily") return;
  const pid = projectStore.selectedProjectId;
  const dr = dateRange.value;
  if (!pid || !dr || dr.length !== 2) {
    dailySeries.value = [];
    dailyByEntity.value = [];
    return;
  }
  dailyLoading.value = true;
  dailyError.value = "";
  dailyWarnings.value = [];
  try {
    const from = tsToYmdLocal(dr[0]!);
    const to = tsToYmdLocal(dr[1]!);
    const sel = selectedFlowUuids.value;
    const q = new URLSearchParams({
      projectId: pid,
      dateFrom: from,
      dateTo: to,
      groupBy: analyticsGroupBy.value,
      entityIds: sel.join(","),
    });
    if (sel.length >= 1 && sel.length <= 2) q.set("perEntity", "1");
    const r = await fetch(`/api/project-analytics-daily?${q.toString()}`);
    const data = (await r.json()) as {
      series?: DailyMetricPoint[];
      byEntity?: Array<{ entityId: string; entityName: string; series: DailyMetricPoint[] }>;
      warnings?: string[];
      error?: string;
    };
    if (!r.ok) {
      dailyError.value = data.error ?? "Failed to load daily metrics";
      dailySeries.value = [];
      dailyByEntity.value = [];
      return;
    }
    dailySeries.value = data.series ?? [];
    dailyByEntity.value = data.byEntity ?? [];
    dailyWarnings.value = data.warnings ?? [];
  } catch (e) {
    dailyError.value = e instanceof Error ? e.message : "Failed to load daily metrics";
    dailySeries.value = [];
    dailyByEntity.value = [];
  } finally {
    dailyLoading.value = false;
  }
}

function mondayUtcYmd(dateYmd: string): string {
  const d = new Date(`${dateYmd}T12:00:00Z`);
  const dow = d.getUTCDay();
  const delta = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - delta);
  return d.toISOString().slice(0, 10);
}

function rollingMean(values: number[], index: number, window: number): number {
  const start = Math.max(0, index - window + 1);
  const slice = values.slice(start, index + 1);
  if (slice.length === 0) return 0;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function makeDailyFunnelChartOption(
  rows: DailyMetricPoint[],
  title: string,
  mode: "lines" | "stacked",
  dark: boolean
): EChartsOption {
  const tc = chartTextColor(dark);
  const sl = splitLineColor(dark);
  const bg = chartSurfaceBg(dark);
  if (rows.length === 0) {
    return { animation: false, backgroundColor: bg, series: [] };
  }
  const axLabels = rows.map((r) => r.date.slice(5));
  const rotate = rows.length > 16 ? 40 : rows.length > 10 ? 28 : 0;
  const showSym = rows.length <= 24;
  const vals = [
    rows.map((r) => r.connectionSent),
    rows.map((r) => r.connectionAccepted),
    rows.map((r) => r.inbox),
    rows.map((r) => r.positiveReplies),
  ] as const;
  const mkSeries = (i: number, data: number[]) => {
    const base = {
      name: STAGE_LABELS[i],
      type: "line" as const,
      data,
      smooth: 0.15,
      showSymbol: showSym,
      symbolSize: 5,
      itemStyle: { color: funnelStageColor(i, dark) },
    };
    if (mode === "stacked") {
      return {
        ...base,
        stack: "funnel",
        areaStyle: { opacity: dark ? 0.34 : 0.42 },
        lineStyle: { width: 1 },
      };
    }
    return {
      ...base,
      lineStyle: { width: 2 },
    };
  };
  return {
    animation: false,
    backgroundColor: bg,
    textStyle: { color: tc },
    title: {
      text: title,
      left: "center",
      top: 4,
      textStyle: { color: tc, fontSize: 14 },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line" },
      formatter(params: unknown) {
        const arr = Array.isArray(params) ? params : [params];
        const first = arr[0] as { dataIndex?: number };
        const idx = first?.dataIndex ?? 0;
        const d = rows[idx]?.date ?? "";
        const lines = [`<strong>${d}</strong>`];
        for (const p of arr) {
          const pr = p as { seriesName?: string; value?: number | string };
          const v = pr.value;
          const n = typeof v === "number" ? v.toLocaleString() : String(v ?? "—");
          lines.push(`${pr.seriesName ?? ""}: ${n}`);
        }
        return lines.join("<br/>");
      },
    },
    legend: { type: "scroll", bottom: 0, textStyle: { color: tc, fontSize: 11 } },
    grid: { left: 52, right: 10, top: 44, bottom: 64, containLabel: false },
    xAxis: {
      type: "category",
      data: axLabels,
      axisLabel: { color: tc, fontSize: 10, rotate, interval: 0 },
      axisLine: { lineStyle: { color: sl } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: tc, fontSize: 11 },
      splitLine: { lineStyle: { color: sl } },
    },
    series: [
      mkSeries(0, [...vals[0]]),
      mkSeries(1, [...vals[1]]),
      mkSeries(2, [...vals[2]]),
      mkSeries(3, [...vals[3]]),
    ],
  };
}

const dailyFunnelPrimaryOption = computed((): EChartsOption => {
  const rows = dailySeries.value;
  const mode = dailyFunnelDisplay.value;
  const title =
    mode === "stacked"
      ? "Funnel counts (stacked area, daily totals)"
      : "Funnel counts (lines, daily totals)";
  return makeDailyFunnelChartOption(rows, title, mode, isDark.value);
});

const dailyRolling7Option = computed((): EChartsOption => {
  const rows = dailySeries.value;
  const dark = isDark.value;
  const tc = chartTextColor(dark);
  const sl = splitLineColor(dark);
  const bg = chartSurfaceBg(dark);
  const win = 7;
  if (rows.length === 0) return { animation: false, backgroundColor: bg, series: [] };
  const sent = rows.map((r) => r.connectionSent);
  const acc = rows.map((r) => r.connectionAccepted);
  const ib = rows.map((r) => r.inbox);
  const pr = rows.map((r) => r.positiveReplies);
  const roll = (arr: number[]) => arr.map((_, i) => rollingMean(arr, i, win));
  const axLabels = rows.map((r) => r.date.slice(5));
  const rotate = rows.length > 16 ? 40 : rows.length > 10 ? 28 : 0;
  return {
    animation: false,
    backgroundColor: bg,
    textStyle: { color: tc },
    title: {
      text: `${win}-day rolling average (funnel counts)`,
      left: "center",
      top: 4,
      textStyle: { color: tc, fontSize: 14 },
    },
    tooltip: {
      trigger: "axis",
      formatter(params: unknown) {
        const arr = Array.isArray(params) ? params : [params];
        const first = arr[0] as { dataIndex?: number };
        const idx = first?.dataIndex ?? 0;
        const d = rows[idx]?.date ?? "";
        const lines = [`<strong>${d}</strong>`];
        for (const p of arr) {
          const pr = p as { seriesName?: string; value?: number | string };
          const v = pr.value;
          const n = typeof v === "number" ? Number(v.toFixed(2)).toLocaleString() : String(v ?? "—");
          lines.push(`${pr.seriesName ?? ""}: ${n}`);
        }
        return lines.join("<br/>");
      },
    },
    legend: { type: "scroll", bottom: 0, textStyle: { color: tc, fontSize: 11 } },
    grid: { left: 52, right: 10, top: 44, bottom: 64 },
    xAxis: {
      type: "category",
      data: axLabels,
      axisLabel: { color: tc, fontSize: 10, rotate, interval: 0 },
      axisLine: { lineStyle: { color: sl } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: tc, fontSize: 11 },
      splitLine: { lineStyle: { color: sl } },
    },
    series: [
      {
        name: `${STAGE_LABELS[0]} (${win}d avg)`,
        type: "line",
        data: roll(sent),
        smooth: 0.12,
        showSymbol: false,
        lineStyle: { width: 2 },
        itemStyle: { color: funnelStageColor(0, dark) },
      },
      {
        name: `${STAGE_LABELS[1]} (${win}d avg)`,
        type: "line",
        data: roll(acc),
        smooth: 0.12,
        showSymbol: false,
        lineStyle: { width: 2 },
        itemStyle: { color: funnelStageColor(1, dark) },
      },
      {
        name: `${STAGE_LABELS[2]} (${win}d avg)`,
        type: "line",
        data: roll(ib),
        smooth: 0.12,
        showSymbol: false,
        lineStyle: { width: 2 },
        itemStyle: { color: funnelStageColor(2, dark) },
      },
      {
        name: `${STAGE_LABELS[3]} (${win}d avg)`,
        type: "line",
        data: roll(pr),
        smooth: 0.12,
        showSymbol: false,
        lineStyle: { width: 2 },
        itemStyle: { color: funnelStageColor(3, dark) },
      },
    ],
  };
});

const dailyRatesOption = computed((): EChartsOption => {
  const rows = dailySeries.value;
  const dark = isDark.value;
  const tc = chartTextColor(dark);
  const sl = splitLineColor(dark);
  const bg = chartSurfaceBg(dark);
  if (rows.length === 0) return { animation: false, backgroundColor: bg, series: [] };
  const pct = (num: number, den: number) => (den > 0 ? (100 * num) / den : null);
  const accP = rows.map((r) => pct(r.connectionAccepted, r.connectionSent));
  const inboxP = rows.map((r) => pct(r.inbox, r.connectionSent));
  const posP = rows.map((r) => pct(r.positiveReplies, r.connectionSent));
  const axLabels = rows.map((r) => r.date.slice(5));
  const rotate = rows.length > 16 ? 40 : rows.length > 10 ? 28 : 0;
  return {
    animation: false,
    backgroundColor: bg,
    textStyle: { color: tc },
    title: {
      text: "Daily rates (÷ connection sent that day)",
      left: "center",
      top: 4,
      textStyle: { color: tc, fontSize: 14 },
    },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v: unknown) =>
        typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)}%` : "—",
    },
    legend: { bottom: 0, textStyle: { color: tc, fontSize: 11 } },
    grid: { left: 44, right: 10, top: 44, bottom: 56 },
    xAxis: {
      type: "category",
      data: axLabels,
      axisLabel: { color: tc, fontSize: 10, rotate, interval: 0 },
      axisLine: { lineStyle: { color: sl } },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: {
        color: tc,
        fontSize: 11,
        formatter: (v: number) => `${v}%`,
      },
      splitLine: { lineStyle: { color: sl } },
    },
    series: [
      {
        name: "Accepted %",
        type: "line",
        data: accP,
        showSymbol: rows.length <= 20,
        connectNulls: true,
        lineStyle: { width: 2 },
        itemStyle: { color: funnelStageColor(1, dark) },
      },
      {
        name: "Inbox reply %",
        type: "line",
        data: inboxP,
        showSymbol: rows.length <= 20,
        connectNulls: true,
        lineStyle: { width: 2 },
        itemStyle: { color: funnelStageColor(2, dark) },
      },
      {
        name: "Inbox positive %",
        type: "line",
        data: posP,
        showSymbol: rows.length <= 20,
        connectNulls: true,
        lineStyle: { width: 2 },
        itemStyle: { color: funnelStageColor(3, dark) },
      },
    ],
  };
});

interface DailyWowRow {
  weekStart: string;
  connectionSent: number;
  connectionAccepted: number;
  inbox: number;
  positiveReplies: number;
  prevWeekSent: number | null;
  sentWowPct: number | null;
}

const dailyWeekOverWeekRows = computed((): DailyWowRow[] => {
  const rows = dailySeries.value;
  const byWeek = new Map<
    string,
    { connectionSent: number; connectionAccepted: number; inbox: number; positiveReplies: number }
  >();
  for (const r of rows) {
    const wk = mondayUtcYmd(r.date);
    const cur =
      byWeek.get(wk) ?? {
        connectionSent: 0,
        connectionAccepted: 0,
        inbox: 0,
        positiveReplies: 0,
      };
    cur.connectionSent += r.connectionSent;
    cur.connectionAccepted += r.connectionAccepted;
    cur.inbox += r.inbox;
    cur.positiveReplies += r.positiveReplies;
    byWeek.set(wk, cur);
  }
  const keys = [...byWeek.keys()].sort();
  const out: DailyWowRow[] = [];
  let prevSent: number | null = null;
  for (const k of keys) {
    const v = byWeek.get(k)!;
    let sentWowPct: number | null = null;
    if (prevSent != null && prevSent > 0) {
      sentWowPct = (100 * (v.connectionSent - prevSent)) / prevSent;
    }
    out.push({
      weekStart: k,
      connectionSent: v.connectionSent,
      connectionAccepted: v.connectionAccepted,
      inbox: v.inbox,
      positiveReplies: v.positiveReplies,
      prevWeekSent: prevSent,
      sentWowPct,
    });
    prevSent = v.connectionSent;
  }
  return out;
});

const dailyWeekWowColumns = computed(
  (): DataTableColumns<DailyWowRow> => [
    {
      title: "Week (Mon UTC)",
      key: "weekStart",
      minWidth: 118,
      ellipsis: { tooltip: true },
    },
    {
      title: "Conn. sent",
      key: "connectionSent",
      width: 110,
      render: (row) => formatInt(row.connectionSent),
    },
    {
      title: "Conn. accepted",
      key: "connectionAccepted",
      width: 128,
      render: (row) => formatInt(row.connectionAccepted),
    },
    {
      title: "Inbox",
      key: "inbox",
      width: 88,
      render: (row) => formatInt(row.inbox),
    },
    {
      title: "Positive",
      key: "positiveReplies",
      width: 96,
      render: (row) => formatInt(row.positiveReplies),
    },
    {
      title: "Sent Δ vs prev week",
      key: "sentWowPct",
      width: 148,
      render: (row) =>
        row.sentWowPct == null || !Number.isFinite(row.sentWowPct)
          ? "—"
          : `${row.sentWowPct >= 0 ? "+" : ""}${row.sentWowPct.toFixed(1)}%`,
    },
  ]
);

const dailyMessagesSentOption = computed((): EChartsOption => {
  const rows = dailySeries.value;
  const dark = isDark.value;
  const tc = chartTextColor(dark);
  const sl = splitLineColor(dark);
  const bg = chartSurfaceBg(dark);
  if (rows.length === 0) {
    return { animation: false, backgroundColor: bg, series: [] };
  }
  const axLabels = rows.map((r) => r.date.slice(5));
  const rotate = rows.length > 16 ? 40 : rows.length > 10 ? 28 : 0;
  const showSym = rows.length <= 24;
  const lineColor = dark ? "#6eb5f9" : "#1565c0";
  return {
    animation: false,
    backgroundColor: bg,
    textStyle: { color: tc },
    title: {
      text: "Messages sent (LinkedIn)",
      left: "center",
      top: 4,
      textStyle: { color: tc, fontSize: 14 },
    },
    tooltip: {
      trigger: "axis",
      formatter(params: unknown) {
        const arr = Array.isArray(params) ? params : [params];
        const first = arr[0] as { dataIndex?: number };
        const idx = first?.dataIndex ?? 0;
        const d = rows[idx]?.date ?? "";
        const v = rows[idx]?.messagesSent ?? 0;
        return `<strong>${d}</strong><br/>Messages sent: ${v.toLocaleString()}`;
      },
    },
    grid: { left: 48, right: 10, top: 40, bottom: 48, containLabel: false },
    xAxis: {
      type: "category",
      data: axLabels,
      axisLabel: { color: tc, fontSize: 10, rotate, interval: 0 },
      axisLine: { lineStyle: { color: sl } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: tc, fontSize: 11 },
      splitLine: { lineStyle: { color: sl } },
    },
    series: [
      {
        name: "Messages sent",
        type: "line",
        data: rows.map((r) => r.messagesSent),
        smooth: 0.15,
        showSymbol: showSym,
        symbolSize: 5,
        lineStyle: { width: 2, color: lineColor },
        areaStyle: { color: dark ? "rgba(110,181,249,0.12)" : "rgba(21,101,192,0.08)" },
        itemStyle: { color: lineColor },
      },
    ],
  };
});

watch(
  () => [
    dashboardTab.value,
    projectStore.selectedProjectId,
    dateRange.value?.[0],
    dateRange.value?.[1],
    selectedFlowUuids.value.join("|"),
    analyticsGroupBy.value,
  ],
  () => {
    if (dashboardTab.value === "daily") void loadDailyMetrics();
  }
);

function normalizeFlowRow(raw: Record<string, unknown>): FlowFunnelRow {
  return {
    flowUuid: String(raw.flowUuid ?? ""),
    flowName: String(raw.flowName ?? ""),
    messagesSent: Number(raw.messagesSent ?? 0) || 0,
    connectionSent: Number(raw.connectionSent ?? 0) || 0,
    connectionAccepted: Number(raw.connectionAccepted ?? 0) || 0,
    inbox: Number(raw.inbox ?? 0) || 0,
    positiveReplies: Number(raw.positiveReplies ?? 0) || 0,
    acceptedRatePct:
      raw.acceptedRatePct == null ? null : Number(raw.acceptedRatePct),
    inboxRatePct: raw.inboxRatePct == null ? null : Number(raw.inboxRatePct),
    positiveRatePct: raw.positiveRatePct == null ? null : Number(raw.positiveRatePct),
    connectionRequestRatePct:
      raw.connectionRequestRatePct == null ? null : Number(raw.connectionRequestRatePct),
    linkedContactsCount:
      raw.linkedContactsCount == null ? undefined : Number(raw.linkedContactsCount) || 0,
    linkedFlowsCount:
      raw.linkedFlowsCount == null ? undefined : Number(raw.linkedFlowsCount) || 0,
  };
}

/** Snapshot funnel counts in the tag (connection requests sent, then accepted). */
function flowPickerSentConnectionsSuffix(f: FlowFunnelRow): string {
  const sent = f.connectionSent ?? 0;
  const conn = f.connectionAccepted ?? 0;
  return ` · ${sent.toLocaleString()} sent · ${conn.toLocaleString()} connections`;
}

/** Shown inside the same filter tag after the entity name. */
function flowPickerTagCountsSuffix(f: FlowFunnelRow): string {
  const base = flowPickerSentConnectionsSuffix(f);
  if (analyticsGroupBy.value !== "hypothesis") return base;
  const c = f.linkedContactsCount ?? 0;
  const fl = f.linkedFlowsCount ?? 0;
  const cLabel = c === 1 ? "contact" : "contacts";
  const fLabel = fl === 1 ? "flow" : "flows";
  return `${base} · ${c.toLocaleString()} ${cLabel} · ${fl.toLocaleString()} ${fLabel}`;
}

function flowPickerTagTooltip(f: FlowFunnelRow, selected: boolean): string {
  const sent = f.connectionSent.toLocaleString();
  const acc = f.connectionAccepted.toLocaleString();
  const head = selected ? "Remove from charts and matrix." : "Add to charts and matrix.";
  let out = `${head} ${sent} connection requests sent, ${acc} accepted in the selected date range.`;
  if (analyticsGroupBy.value === "hypothesis") {
    out += ` ${(f.linkedContactsCount ?? 0).toLocaleString()} tag contacts, ${(f.linkedFlowsCount ?? 0).toLocaleString()} flows.`;
  }
  return out;
}

async function loadAnalytics(projectId: string, from: string, to: string) {
  loading.value = true;
  loadError.value = "";
  warnings.value = [];
  try {
    const q = new URLSearchParams({
      projectId,
      dateFrom: from,
      dateTo: to,
      groupBy: analyticsGroupBy.value,
    });
    const r = await fetch(`/api/project-analytics?${q.toString()}`);
    const data = (await r.json()) as {
      flows?: Record<string, unknown>[];
      warnings?: string[];
      error?: string;
      projectTotals?: FlowFunnelProjectTotalsPayload;
      comparison?: FlowFunnelComparisonPayload | null;
    };
    if (!r.ok) {
      loadError.value = data.error ?? "Failed to load analytics";
      flows.value = [];
      funnelProjectTotals.value = null;
      funnelComparison.value = null;
      return;
    }
    flows.value = (data.flows ?? []).map((row) => normalizeFlowRow(row));
    warnings.value = data.warnings ?? [];
    funnelProjectTotals.value = data.projectTotals ?? null;
    funnelComparison.value = data.comparison ?? null;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "Failed to load analytics";
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
    dailySeries.value = [];
    dailyByEntity.value = [];
    dailyError.value = "";
    dailyWarnings.value = [];
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
    void loadAnalytics(pid, tsToYmdLocal(val[0]), tsToYmdLocal(val[1]));
  },
  { deep: true }
);

watch(analyticsGroupBy, () => {
  const pid = projectStore.selectedProjectId;
  const val = dateRange.value;
  if (!pid || !val || val.length !== 2) return;
  void loadAnalytics(pid, tsToYmdLocal(val[0]), tsToYmdLocal(val[1]));
});

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
          <div class="flow-dash__filters-block">
            <div class="flow-dash__filters-block-head">
              <span class="flow-dash__filters-title">Group by</span>
              <span class="flow-dash__filters-sub">Flow vs hypothesis grouping for charts and tables</span>
            </div>
            <div class="flow-dash__filters-block-body">
              <NRadioGroup v-model:value="analyticsGroupBy" size="small" :disabled="collectingDays || loading">
                <NRadioButton value="flow">Flows</NRadioButton>
                <NRadioButton value="hypothesis">Hypotheses</NRadioButton>
              </NRadioGroup>
            </div>
          </div>

          <div class="flow-dash__filters-block flow-dash__filters-block--ruled">
            <div class="flow-dash__filters-block-head">
              <span class="flow-dash__filters-title">Date range</span>
              <span class="flow-dash__filters-sub">Window for snapshots; preset adjusts the range</span>
            </div>
            <div class="flow-dash__filters-block-body flow-dash__filters-block-body--grow">
              <NDatePicker v-model:value="dateRange" type="daterange" size="small" clearable class="flow-dash__filters-dp"
                :disabled="collectingDays || loading" />
              <NSelect v-model:value="statsWindowDays" size="small" :options="statsWindowOptions" placeholder="Period"
                class="flow-dash__filters-period" :disabled="collectingDays || loading" :consistent-menu-width="false" />
              <NText v-if="flows.length === 0 && (collectingDays || loading)" depth="3" class="flow-dash__filters-status">
                Loading…
              </NText>
              <NText v-else-if="flows.length === 0" depth="3" class="flow-dash__filters-status">No data in range</NText>
            </div>
          </div>

          <div v-if="flows.length > 0" class="flow-dash__filters-block flow-dash__filters-block--ruled">
            <div class="flow-dash__filters-section-head">
              <span class="flow-dash__filters-title">{{ groupEntityTitle }} (charts & matrix)</span>
              <div class="flow-dash__flow-tag-actions">
                <NButton
                  v-if="flowPickerHasOverflow"
                  size="tiny"
                  quaternary
                  :disabled="loading"
                  @click="flowPickerExpanded = !flowPickerExpanded"
                >
                  {{ flowPickerExpanded ? "Show less" : `Show all (${flowsPickerRows.length})` }}
                </NButton>
                <NButton size="tiny" quaternary :disabled="loading" @click="selectAllPickerFlows">All</NButton>
                <NButton size="tiny" quaternary :disabled="loading" @click="clearPickerFlows">Clear</NButton>
              </div>
            </div>
            <div class="flow-dash__flow-tags">
              <NTooltip v-for="{ flow: f, idx } in flowsPickerRowsShown" :key="`flow-tag-${f.flowUuid}`" placement="top">
                <template #trigger>
                  <NTag size="small" :type="isFlowUuidSelected(f.flowUuid) ? 'primary' : 'default'"
                    :bordered="isFlowUuidSelected(f.flowUuid)" round :class="[
                      'flow-dash__flow-tag',
                      { 'flow-dash__flow-tag--active': isFlowUuidSelected(f.flowUuid) },
                    ]" :disabled="loading" @click="toggleFlowSelection(f.flowUuid)">
                    <span class="flow-dash__flow-tag-name">{{ flowPickerEmoji(idx) }} {{ f.flowName }}</span><span
                      class="flow-dash__flow-tag-counts"
                    >{{ flowPickerTagCountsSuffix(f) }}</span>
                  </NTag>
                </template>
                {{ flowPickerTagTooltip(f, isFlowUuidSelected(f.flowUuid)) }}
              </NTooltip>
            </div>
          </div>
        </NCard>

        <template v-if="!loadError && flows.length === 0 && !loading && !collectingDays">
          <NAlert type="info" :title="`No ${groupEntityPlural}`" class="flow-dash__alert">
            <span v-if="analyticsGroupBy === 'flow'">This project has no rows in <code>Flows</code>, or nothing in range.</span>
            <span v-else>No hypotheses for this project, or none linked to flows via tag contacts.</span>
          </NAlert>
        </template>

        <NTabs v-model:value="dashboardTab" type="line" size="small" class="flow-dash__tabs">
          <NTabPane name="rankings" tab="Top & least" display-directive="show">
            <NText v-if="flows.length > 0" depth="3" class="flow-dash__rank-tab-hint">
              Date range and <strong>Group by</strong> from <strong>Filters</strong> above.
            </NText>
            <template v-if="flows.length > 0">
              <AnalyticsMetricMatrix
                section="rankings"
                :flows="flows"
                :selected-flow-uuids="selectedFlowUuids"
                :group-entity-title="groupEntityTitle"
                :group-entity-plural="groupEntityPlural"
                :group-entity-singular="groupEntitySingular"
              />
            </template>
            <template v-else-if="!loadError && !loading && !collectingDays">
              <NAlert type="info" :title="`No ${groupEntityPlural}`" class="flow-dash__alert">
                Nothing in this range. Adjust <strong>Filters</strong> above.
              </NAlert>
            </template>
          </NTabPane>

          <NTabPane name="totals" tab="Totals & compare" display-directive="show">
            <NText v-if="flows.length > 0" depth="3" class="flow-dash__rank-tab-hint">
              Project-wide totals (always all flows in range) and selected {{ groupEntityPlural }} matrix. Toggle tags
              in <strong>Filters</strong> above.
            </NText>
            <template v-if="flows.length > 0">
              <NCard :title="projectTotalsCardTitle" size="small"
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
                    <NText depth="3" class="flow-dash__stat-col-label">Inbox reply</NText>
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
                    <NText depth="3" class="flow-dash__stat-col-label">Inbox positive</NText>
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
                  <div class="flow-dash__stat-col">
                    <NText depth="3" class="flow-dash__stat-col-label">Positive rate (÷ sent)</NText>
                    <div class="flow-dash__stat-col-value">
                      <span class="flow-dash__stat-col-num">{{
                        displayFunnelTotals.positiveRatePct == null
                          ? "—"
                          : `${displayFunnelTotals.positiveRatePct.toFixed(1)}%`
                      }}</span>
                      <NTag v-if="deltaPositiveRate" size="small" :bordered="false" :type="deltaPositiveRate.type">
                        {{ deltaPositiveRate.text }}
                      </NTag>
                    </div>
                  </div>
                </div>
              </NCard>

              <AnalyticsMetricMatrix
                section="performance"
                :flows="flows"
                :selected-flow-uuids="selectedFlowUuids"
                :group-entity-title="groupEntityTitle"
                :group-entity-plural="groupEntityPlural"
                :group-entity-singular="groupEntitySingular"
              />
            </template>
            <template v-else-if="!loadError && !loading && !collectingDays">
              <NAlert type="info" :title="`No ${groupEntityPlural}`" class="flow-dash__alert">
                Nothing in this range. Adjust <strong>Filters</strong> above.
              </NAlert>
            </template>
          </NTabPane>

          <NTabPane name="funnels" tab="Funnels" display-directive="show">
            <NText v-if="flows.length > 0" depth="3" class="flow-dash__rank-tab-hint">
              Pick {{ groupEntityPlural }} under <strong>{{ groupEntityTitle }} (charts & matrix)</strong> in Filters.
              Funnels match <code>render_funnel_chart</code>: connection sent → accepted → inbox reply → inbox positive
              (<code>sort: none</code>).
            </NText>
            <template v-if="flows.length > 0">
              <NAlert v-if="selectedFlowUuids.length === 0" type="info" :title="`No ${groupEntityPlural} selected`"
                class="flow-dash__alert">
                Select at least one tag under <strong>Filters</strong> to render charts.
              </NAlert>
              <template v-else>
                <NCard title="Funnel Sankey" size="small" class="flow-dash__card flow-dash__card--spaced">
                  <div class="flow-dash__sankey-toolbar">
                    <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
                      Per-{{ groupEntitySingular }} attribution through every stage:
                      <strong>Sent → Accepted → Inbox → Positive</strong>.
                      Top {{ FUNNEL_SANKEY_FLOW_LIMIT }} selected {{ groupEntityPlural }} by connection sent; remainder rolled into "Other".
                      In <strong>Conversion</strong> mode: total connection sent, then each flow’s share of that total as strip width; the same width continues only through stages that have volume (inbox and positive omit a flow when that count is 0). If only one flow reaches inbox or positive, that column’s block is scaled to the same full height as the total column. Labels and tooltips show counts and % where the node exists.
                    </NText>
                    <NSelect v-model:value="funnelSankeyMode" :options="funnelSankeyModeOptions" size="small"
                      class="flow-dash__sankey-mode-select" />
                  </div>
                  <div class="flow-dash__compare-host flow-dash__chart-tall">
                    <VChart class="flow-dash__echart-compare flow-dash__echart-fill" :option="funnelSankeyOption"
                      :update-options="chartUpdateOptions" :autoresize="{ throttle: 200 }" />
                  </div>
                </NCard>
              </template>
            </template>
            <template v-else-if="!loadError && !loading && !collectingDays">
              <NAlert type="info" :title="`No ${groupEntityPlural}`" class="flow-dash__alert">
                Nothing in this range. Adjust <strong>Filters</strong> above.
              </NAlert>
            </template>
          </NTabPane>

          <NTabPane name="daily" tab="Daily metrics" display-directive="show">
            <NText v-if="flows.length > 0" depth="3" class="flow-dash__rank-tab-hint">
              X = calendar day in the <strong>Date range</strong> filter. Y = summed snapshot metrics for the
              <strong>{{ groupEntityPlural }}</strong> you selected (hypothesis mode uses the union of underlying flows
              once per day, so overlaps are not double-counted). Values are deltas stored per snapshot day, not
              cumulative pipeline totals.
            </NText>
            <NAlert v-if="dailyError" type="error" class="flow-dash__alert" :title="dailyError" />
            <NAlert v-if="dailyWarnings.length > 0" type="warning" class="flow-dash__alert" title="Notice">
              <ul class="flow-dash__warn-list">
                <li v-for="(w, i) in dailyWarnings" :key="`dw-${i}`">{{ w }}</li>
              </ul>
            </NAlert>
            <template v-if="flows.length > 0">
              <NAlert v-if="selectedFlowUuids.length === 0" type="info" :title="`No ${groupEntityPlural} selected`"
                class="flow-dash__alert">
                Select at least one tag under <strong>Filters</strong> to load daily series.
              </NAlert>
              <NSpin v-else :show="dailyLoading">
                <NCard title="Funnel counts by day" size="small" class="flow-dash__card flow-dash__card--spaced">
                  <div class="flow-dash__daily-toolbar">
                    <NText depth="3" class="flow-dash__daily-toolbar-label">Funnel chart</NText>
                    <NRadioGroup v-model:value="dailyFunnelDisplay" size="small">
                      <NRadioButton value="lines">Lines</NRadioButton>
                      <NRadioButton value="stacked">Stacked area</NRadioButton>
                    </NRadioGroup>
                  </div>
                  <div class="flow-dash__daily-chart-host">
                    <VChart class="flow-dash__echart-daily" :option="dailyFunnelPrimaryOption"
                      :update-options="chartUpdateOptions" :autoresize="{ throttle: 200 }" />
                  </div>
                </NCard>
                <NCard title="Messages sent by day" size="small" class="flow-dash__card flow-dash__card--spaced">
                  <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
                    LinkedIn messages sent (<code>linkedin_sent_count</code>) — often larger than connection requests;
                    useful volume trend alongside the funnel chart.
                  </NText>
                  <div class="flow-dash__daily-chart-host">
                    <VChart class="flow-dash__echart-daily" :option="dailyMessagesSentOption"
                      :update-options="chartUpdateOptions" :autoresize="{ throttle: 200 }" />
                  </div>
                </NCard>
                <NCard title="Rates by day" size="small" class="flow-dash__card flow-dash__card--spaced">
                  <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
                    Accepted, inbox reply, and inbox positive as a percentage of <strong>that day’s</strong> connection
                    sent (combined selection). Gaps when sent = 0.
                  </NText>
                  <div class="flow-dash__daily-chart-host">
                    <VChart class="flow-dash__echart-daily" :option="dailyRatesOption"
                      :update-options="chartUpdateOptions" :autoresize="{ throttle: 200 }" />
                  </div>
                </NCard>
                <NCard title="7-day rolling average" size="small" class="flow-dash__card flow-dash__card--spaced">
                  <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
                    Same four funnel counts, smoothed with a trailing 7-day mean (shorter windows at the start of the
                    range use fewer days).
                  </NText>
                  <div class="flow-dash__daily-chart-host">
                    <VChart class="flow-dash__echart-daily" :option="dailyRolling7Option"
                      :update-options="chartUpdateOptions" :autoresize="{ throttle: 200 }" />
                  </div>
                </NCard>
                <NCard title="Week over week" size="small" class="flow-dash__card flow-dash__card--spaced">
                  <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
                    Weeks start Monday (UTC). Totals sum daily snapshot deltas in each week. “Sent Δ” compares this
                    week’s connection sent to the previous week’s total.
                  </NText>
                  <NDataTable
                    size="small"
                    :bordered="true"
                    :single-line="false"
                    :columns="dailyWeekWowColumns"
                    :data="dailyWeekOverWeekRows"
                    :pagination="false"
                    class="flow-dash__daily-wow-table"
                  />
                </NCard>
                <NCard
                  v-if="dailyByEntity.length > 0"
                  :title="`By ${groupEntitySingular} (1–2 selected)`"
                  size="small"
                  class="flow-dash__card flow-dash__card--spaced"
                >
                  <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
                    Same funnel lines as the first chart, but each {{ groupEntitySingular }} separately (not merged).
                  </NText>
                  <NGrid cols="24" responsive="screen" :x-gap="16" :y-gap="16">
                    <NGi v-for="ent in dailyByEntity" :key="ent.entityId" span="24 m:12">
                      <div class="flow-dash__daily-entity-chart">
                        <VChart
                          class="flow-dash__echart-daily flow-dash__echart-daily--compact"
                          :option="makeDailyFunnelChartOption(ent.series, ent.entityName, 'lines', isDark)"
                          :update-options="chartUpdateOptions"
                          :autoresize="{ throttle: 200 }"
                        />
                      </div>
                    </NGi>
                  </NGrid>
                </NCard>
              </NSpin>
            </template>
            <template v-else-if="!loadError && !loading && !collectingDays">
              <NAlert type="info" :title="`No ${groupEntityPlural}`" class="flow-dash__alert">
                Nothing in this range. Adjust <strong>Filters</strong> above.
              </NAlert>
            </template>
          </NTabPane>

          <NTabPane name="geo" tab="Geo insights" display-directive="show">
            <NText depth="3" class="flow-dash__rank-tab-hint">
              Country distribution of the most recent LinkedIn conversations for this project. Country is derived
              from the free-text <code>Contacts.location</code>, so an <strong>Unknown</strong> bucket is expected.
              Use the charts to spot geographical concentration and which flows reach which regions.
            </NText>
            <ConversationsGeoInsights :project-id="projectStore.selectedProjectId" />
          </NTabPane>
        </NTabs>
      </NSpin>
    </template>
  </div>
</template>

<style>
@import "../styles/analytics-metric-matrix.css";
</style>

<style scoped>
.flow-dash {
  width: 100%;
  max-width: min(1720px, 96vw);
  margin: 0 auto;
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

.flow-dash__filters-block {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.flow-dash__filters-block--ruled {
  margin-top: 0.85rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--n-border-color);
}

.flow-dash__filters-block-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  min-width: 0;
}

.flow-dash__filters-block-body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.85rem;
}

.flow-dash__filters-title {
  font-size: 11px;
  opacity: 0.72;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  line-height: 1.35;
}

.flow-dash__filters-sub {
  font-size: 0.8125rem;
  line-height: 1.35;
  color: var(--n-text-color-3);
  font-weight: 400;
  max-width: 42rem;
}

.flow-dash__filters-status {
  font-size: 0.8125rem;
  margin: 0;
  flex: 0 0 auto;
}

.flow-dash__filters-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem 0.75rem;
  margin-bottom: 0.35rem;
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
  max-width: 100%;
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 0.15em;
}

.flow-dash__flow-tag-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.flow-dash__flow-tag-counts {
  flex: 0 0 auto;
  font-size: 0.7rem;
  font-weight: 600;
  opacity: 0.82;
  letter-spacing: 0.01em;
  white-space: nowrap;
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

.flow-dash__sankey-toolbar {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
  margin-bottom: 0.55rem;
}

.flow-dash__sankey-toolbar > :first-child {
  margin-bottom: 0;
}

.flow-dash__sankey-mode-select {
  max-width: 340px;
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
  border-radius: 10px;
  border: 1px solid var(--n-border-color);
  box-sizing: border-box;
}

.flow-dash__daily-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin-bottom: 0.5rem;
}

.flow-dash__daily-toolbar-label {
  font-size: 0.8125rem;
  margin: 0;
}

.flow-dash__daily-chart-host {
  width: 100%;
  min-height: 300px;
  height: min(380px, 46vh);
  position: relative;
  box-sizing: border-box;
}

.flow-dash__daily-entity-chart {
  width: 100%;
  min-height: 260px;
  height: min(320px, 38vh);
  position: relative;
  box-sizing: border-box;
}

.flow-dash__echart-daily {
  width: 100%;
  height: 100%;
  min-height: 280px;
  display: block;
}

.flow-dash__echart-daily--compact {
  min-height: 240px;
}

.flow-dash__daily-wow-table {
  margin-top: 0.35rem;
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

.flow-dash :deep(.n-card-header) {
  font-size: 1.05rem;
}

.flow-dash :deep(.n-card-header__main) {
  font-size: 1.05rem;
  font-weight: 600;
}
</style>
