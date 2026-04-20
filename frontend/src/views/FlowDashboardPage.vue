<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import {
  NCard,
  NSpin,
  NAlert,
  NText,
  NDatePicker,
  NSelect,
  NTabs,
  NTabPane,
  NRadioGroup,
  NRadioButton,
} from "naive-ui";
import type { SelectOption, DataTableColumns } from "naive-ui";
import { useDark } from "@vueuse/core";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { LineChart, SankeyChart, CustomChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  GraphicComponent,
  VisualMapComponent,
} from "echarts/components";
import type { EChartsOption } from "echarts";
import FlowAnalyticsRankingsPanel from "../components/analytics/FlowAnalyticsRankingsPanel.vue";
import FlowAnalyticsTotalsSection from "../components/analytics/FlowAnalyticsTotalsSection.vue";
import FlowAnalyticsFunnelSection from "../components/analytics/FlowAnalyticsFunnelSection.vue";
import FlowAnalyticsDailySection from "../components/analytics/FlowAnalyticsDailySection.vue";
import FlowAnalyticsGeoPanel from "../components/analytics/FlowAnalyticsGeoPanel.vue";
import EntityTagPicker from "../components/analytics/EntityTagPicker.vue";
import type {
  FlowFunnelRow,
  FlowFunnelProjectTotalsPayload,
  FlowFunnelComparisonPayload,
  DailyMetricPoint,
  DailyWowRow,
} from "../components/analytics/flow-analytics-types.js";
import { FUNNEL_SANKEY_FLOW_LIMIT, FUNNEL_REACH_DISPLAY_CAP } from "../components/analytics/flow-analytics-constants.js";
import {
  funnelStageColor,
  chartSurfaceBg,
  chartTextColor,
  splitLineColor,
} from "../components/analytics/flowAnalyticsChartTheme.js";
import {
  mondayUtcYmd,
  makeDailyFunnelChartOption,
  makeRollingDailyFunnelChartOption,
  makeDailyEntityHeatmapOption,
  makeDailyMergedHeatmapOption,
  type DailyHeatmapMetricId,
} from "../components/analytics/flowAnalyticsDailyCharts.js";
import { useProjectStore } from "../stores/project";
import { trackAnalyticsEvent } from "../lib/mixpanel-tracking";

type FlowFunnelRowUi = FlowFunnelRow & {
  pipelineStageBreakdown?: Array<{
    stageUuid: string;
    stageName: string;
    stageOrder: number | null;
    contactsCount: number;
  }>;
};

use([
  CanvasRenderer,
  LineChart,
  SankeyChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  GraphicComponent,
  VisualMapComponent,
]);

/** Avoid merge stacking + layout feedback with autoresize (see ECharts setOption). */
const chartUpdateOptions = { notMerge: true as const };

const projectStore = useProjectStore();
const isDark = useDark();

function normalizeProjectId(raw: unknown): string | null {
  if (typeof raw === "string") return raw.length > 0 ? raw : null;
  if (raw && typeof raw === "object" && "value" in raw) {
    const maybeValue = (raw as { value?: unknown }).value;
    return typeof maybeValue === "string" && maybeValue.length > 0 ? maybeValue : null;
  }
  return null;
}

const selectedProjectId = computed(() => normalizeProjectId(projectStore.selectedProjectId));

const analyticsMainTab = ref<"rankings" | "funnelsDaily" | "geo">("rankings");

/** `groupBy` = flow uses flow uuid+name; hypothesis uses hypothesis id+name (same fields for charts). */
const analyticsGroupBy = ref<"flow" | "hypothesis">("flow");

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

const collectingDays = ref(false);
const loading = ref(false);
const loadError = ref("");
const warnings = ref<string[]>([]);
const flows = ref<FlowFunnelRowUi[]>([]);

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

function isoDateFromTs(ts: number | null | undefined): string | null {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  return tsToYmdLocal(ts);
}

function compareFlowRowsByConnectionsSentDesc(
  a: FlowFunnelRowUi,
  b: FlowFunnelRowUi
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

const flowPickerItems = computed(() =>
  flowsSortedForPicker.value.map((f, idx) => ({
    id: f.flowUuid,
    label: `${FLOW_TAG_EMOJIS[idx % FLOW_TAG_EMOJIS.length]!} ${f.flowName}`,
    meta: flowPickerTagCountsSuffix(f),
    tooltip: flowPickerTagTooltip(f, selectedFlowUuids.value.includes(f.flowUuid)),
  }))
);

/** When >4 flows, default charts to top-N by connection sent (volume). */
function defaultSelectedUuidsForCharts(list: FlowFunnelRowUi[]): string[] {
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

watch(
  analyticsMainTab,
  (tab, prev) => {
    const projectId = selectedProjectId.value;
    if (!projectId) return;
    trackAnalyticsEvent("analytics_active_tab", {
      projectId,
      tab,
      previousTab: prev ?? null,
      action: prev == null ? "initial" : "change",
    });
    if (prev != null && prev !== tab) {
      trackAnalyticsEvent("analytics_change_tab", {
        projectId,
        tab,
        previousTab: prev,
      });
    }
  },
  { immediate: true }
);

watch(selectedFlowUuids, (selected) => {
  const projectId = selectedProjectId.value;
  if (!projectId) return;
  trackAnalyticsEvent("analytics_change_flows_filter", {
    projectId,
    tab: analyticsMainTab.value,
    selectedFlowUuids: [...selected],
    selectedFlowsCount: selected.length,
    groupBy: analyticsGroupBy.value,
  });
});

watch(dateRange, (next) => {
  const projectId = selectedProjectId.value;
  if (!projectId) return;
  trackAnalyticsEvent("analytics_change_date_range", {
    projectId,
    tab: analyticsMainTab.value,
    rangeFrom: isoDateFromTs(next?.[0]),
    rangeTo: isoDateFromTs(next?.[1]),
    statsWindowDays: Number(statsWindowDays.value),
  });
});

watch(statsWindowDays, (windowDays) => {
  const projectId = selectedProjectId.value;
  if (!projectId) return;
  trackAnalyticsEvent("analytics_change_date_window", {
    projectId,
    tab: analyticsMainTab.value,
    statsWindowDays: Number(windowDays),
    rangeFrom: isoDateFromTs(dateRange.value?.[0]),
    rangeTo: isoDateFromTs(dateRange.value?.[1]),
  });
});

watch(analyticsGroupBy, (groupBy) => {
  const projectId = selectedProjectId.value;
  if (!projectId) return;
  trackAnalyticsEvent("analytics_change_group_by", {
    projectId,
    tab: analyticsMainTab.value,
    groupBy,
  });
});

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

/**
 * Cascaded funnel Sankey: per-flow attribution preserved through every stage.
 *
 * Modes: `absolute`, `conversion`, `downstream` (accepted-anchored), `reach`
 * (hypotheses only: first split by tagged reach vs sent, then funnel counts).
 * Caps use `FUNNEL_SANKEY_FLOW_LIMIT` / `FUNNEL_REACH_DISPLAY_CAP` from `flow-analytics-constants`.
 */
type FunnelSankeyMode = "absolute" | "conversion" | "downstream" | "reach";

const funnelSankeyMode = ref<FunnelSankeyMode>("absolute");
type PipelineStageOptionLite = { stageUuid: string; stageName: string; stageOrder: number | null };
const availablePipelineStages = ref<PipelineStageOptionLite[]>([]);
const selectedPipelineStageUuids = ref<string[]>([]);
const pipelineStagePositions = ref<Record<string, number>>({});
watch(funnelSankeyMode, (mode) => {
  const projectId = selectedProjectId.value;
  if (!projectId) return;
  trackAnalyticsEvent("analytics_change_funnel_alluvial_type", {
    projectId,
    tab: analyticsMainTab.value,
    mode,
    groupBy: analyticsGroupBy.value,
  });
});
watch(selectedPipelineStageUuids, (stageUuids) => {
  const projectId = selectedProjectId.value;
  if (!projectId) return;
  trackAnalyticsEvent("analytics_change_funnel_pipeline_stages", {
    projectId,
    tab: analyticsMainTab.value,
    stageUuids: [...stageUuids],
    stageCount: stageUuids.length,
    groupBy: analyticsGroupBy.value,
  });
});
const pipelineStageNameByUuid = computed(() => {
  const out: Record<string, string> = {};
  for (const s of availablePipelineStages.value) out[s.stageUuid] = s.stageName;
  return out;
});
const pipelineStageOptions = computed((): SelectOption[] =>
  availablePipelineStages.value.map((s) => ({ label: s.stageName, value: s.stageUuid }))
);
const selectedPipelineStageConfigs = computed(() =>
  selectedPipelineStageUuids.value
    .map((id) => {
      const row = availablePipelineStages.value.find((s) => s.stageUuid === id);
      if (!row) return null;
      return {
        stageUuid: row.stageUuid,
        stageName: row.stageName,
        position: Math.max(1, Math.trunc(pipelineStagePositions.value[row.stageUuid] ?? 1)),
      };
    })
    .filter((x): x is { stageUuid: string; stageName: string; position: number } => x != null)
);

const reachModeAvailable = computed(
  () =>
    analyticsGroupBy.value === "hypothesis" &&
    filteredFlows.value.some((f) => (f.linkedContactsCount ?? 0) > 0)
);

const funnelSankeyModeOptions = computed((): SelectOption[] => {
  const opts: SelectOption[] = [
    { label: "Absolute volumes (with drop-off)", value: "absolute" },
    { label: "Conversion (equal-height % columns)", value: "conversion" },
    { label: "Downstream (after accept only)", value: "downstream" },
  ];
  if (reachModeAvailable.value) {
    opts.push({
      label: "Hypothesis reach → funnel",
      value: "reach",
    });
  }
  return opts;
});

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
  pipelineStageBreakdown?: Array<{
    stageUuid: string;
    stageName: string;
    stageOrder: number | null;
    contactsCount: number;
  }>;
  /** Hypothesis mode: tag-linked contacts (`linkedContactsCount`); used only in reach Sankey. */
  reach?: number;
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
    pipelineStageBreakdown: (f.pipelineStageBreakdown ?? [])
      .filter((s) => s.contactsCount > 0 && s.stageName.trim().length > 0)
      .map((s) => ({
        stageUuid: s.stageUuid,
        stageName: s.stageName,
        stageOrder: s.stageOrder ?? null,
        contactsCount: Math.max(0, s.contactsCount | 0),
      })),
    reach:
      analyticsGroupBy.value === "hypothesis"
        ? Math.min(Math.max(0, f.linkedContactsCount ?? 0), FUNNEL_REACH_DISPLAY_CAP)
        : undefined,
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
          pipelineStageBreakdown: (() => {
            const next = new Map<
              string,
              { stageUuid: string; stageName: string; stageOrder: number | null; contactsCount: number }
            >();
            for (const row of acc.pipelineStageBreakdown ?? []) {
              const key = row.stageUuid || row.stageName;
              next.set(key, { ...row });
            }
            for (const row of f.pipelineStageBreakdown ?? []) {
              if (!row.stageName?.trim()) continue;
              const key = row.stageUuid || row.stageName;
              const prev = next.get(key);
              if (prev) {
                prev.contactsCount += Math.max(0, row.contactsCount | 0);
              } else {
                next.set(key, {
                  stageUuid: row.stageUuid,
                  stageName: row.stageName,
                  stageOrder: row.stageOrder ?? null,
                  contactsCount: Math.max(0, row.contactsCount | 0),
                });
              }
            }
            return [...next.values()];
          })(),
          reach:
            acc.reach != null && analyticsGroupBy.value === "hypothesis"
              ? acc.reach +
                Math.min(Math.max(0, f.linkedContactsCount ?? 0), FUNNEL_REACH_DISPLAY_CAP)
              : acc.reach,
        }),
        {
          key: "__other__",
          label: `Other (${tail.length} ${groupEntityPlural.value})`,
          sent: 0,
          accepted: 0,
          inbox: 0,
          positive: 0,
          pipelineStageBreakdown: [],
          reach: analyticsGroupBy.value === "hypothesis" ? 0 : undefined,
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
 * Conversion mode: every link width uses the same scale `BASE * count / totalSent`
 * so mass is conserved from Total through drop sinks. Within each stage, bar
 * heights match shares of that stage’s totals (e.g. positive_i / Σ positive).
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
  const cDrop = dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)";

  const totalSent = buckets.reduce((s, b) => s + b.sent, 0);
  if (totalSent <= 0) return { nodes: [], links: [] };

  const w = (n: number): number => (BASE * n) / totalSent;

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
  const sinkNotAcc = "sink:Not accepted";
  const sinkNoInb = "sink:Accepted · no reply";
  const sinkNonPos = "sink:Inbox · non-positive";

  pushNode({
    name: nodeTotal,
    depth: 0,
    value: BASE,
    _raw: totalSent,
    itemStyle: { color: cSent, borderColor: cSent },
    label: { color: tc, fontWeight: "bold" },
    __rank: -1,
  });

  buckets.forEach((b, idx) => {
    const ws = w(b.sent);
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
    const isOther = b.key === "__other__";
    const flowColor = flowAlluviumColor(idx, dark, isOther);
    const nSplit = `split:${b.label}`;
    const nAcc = `accepted:${b.label}`;
    const nInb = `inbox:${b.label}`;
    const nPos = `positive:${b.label}`;
    const showInb = b.inbox > 0;
    const showPos = b.positive > 0;

    const wa = w(b.accepted);
    const dropSentAcc = Math.max(0, b.sent - b.accepted);

    pushNode({
      name: nAcc,
      depth: 2,
      value: wa,
      _raw: b.accepted,
      itemStyle: { color: flowColor, borderColor: cAccepted, borderWidth: 1 },
      label: { color: tc },
      __rank: idx,
    });

    pushLink({
      source: nSplit,
      target: nAcc,
      value: wa,
      _raw: b.accepted,
      lineStyle: { color: flowColor, opacity: 0.55 },
    });
    pushLink({
      source: nSplit,
      target: sinkNotAcc,
      value: w(dropSentAcc),
      _raw: dropSentAcc,
      lineStyle: { color: cDrop, opacity: 0.32 },
    });

    if (showInb && wa > 1e-9) {
      const wi = w(b.inbox);
      const dropAccInb = Math.max(0, b.accepted - b.inbox);

      pushNode({
        name: nInb,
        depth: 3,
        value: wi,
        _raw: b.inbox,
        itemStyle: { color: flowColor, borderColor: cInbox, borderWidth: 1 },
        label: { color: tc },
        __rank: idx,
      });
      pushLink({
        source: nAcc,
        target: nInb,
        value: wi,
        _raw: b.inbox,
        lineStyle: { color: flowColor, opacity: 0.55 },
      });
      pushLink({
        source: nAcc,
        target: sinkNoInb,
        value: w(dropAccInb),
        _raw: dropAccInb,
        lineStyle: { color: cDrop, opacity: 0.32 },
      });

      if (showPos) {
        const wp = w(b.positive);
        const dropInbPos = Math.max(0, b.inbox - b.positive);

        pushNode({
          name: nPos,
          depth: 4,
          value: wp,
          _raw: b.positive,
          itemStyle: { color: flowColor, borderColor: cPositive, borderWidth: 1 },
          label: { color: tc },
          __rank: idx,
        });
        pushLink({
          source: nInb,
          target: nPos,
          value: wp,
          _raw: b.positive,
          lineStyle: { color: flowColor, opacity: 0.58 },
        });
        pushLink({
          source: nInb,
          target: sinkNonPos,
          value: w(dropInbPos),
          _raw: dropInbPos,
          lineStyle: { color: cDrop, opacity: 0.32 },
        });
      } else {
        pushLink({
          source: nInb,
          target: sinkNonPos,
          value: wi,
          _raw: b.inbox,
          lineStyle: { color: cDrop, opacity: 0.32 },
        });
      }
    } else if (showPos && wa > 1e-9) {
      const wp = w(b.positive);
      const dropAccPos = Math.max(0, b.accepted - b.positive);

      pushNode({
        name: nPos,
        depth: 4,
        value: wp,
        _raw: b.positive,
        itemStyle: { color: flowColor, borderColor: cPositive, borderWidth: 1 },
        label: { color: tc },
        __rank: idx,
      });
      pushLink({
        source: nAcc,
        target: nPos,
        value: wp,
        _raw: b.positive,
        lineStyle: { color: flowColor, opacity: 0.58 },
      });
      pushLink({
        source: nAcc,
        target: sinkNoInb,
        value: w(dropAccPos),
        _raw: dropAccPos,
        lineStyle: { color: cDrop, opacity: 0.32 },
      });
    } else if (b.accepted > 0) {
      pushLink({
        source: nAcc,
        target: sinkNoInb,
        value: wa,
        _raw: b.accepted,
        lineStyle: { color: cDrop, opacity: 0.32 },
      });
    }
  });

  pushNode({
    name: sinkNotAcc,
    depth: 2,
    itemStyle: { color: cDrop, borderColor: cDrop },
    label: { color: tc },
    __rank: 9000,
  });
  pushNode({
    name: sinkNoInb,
    depth: 3,
    itemStyle: { color: cDrop, borderColor: cDrop },
    label: { color: tc },
    __rank: 9001,
  });
  pushNode({
    name: sinkNonPos,
    depth: 4,
    itemStyle: { color: cDrop, borderColor: cDrop },
    label: { color: tc },
    __rank: 9002,
  });

  return { nodes, links };
}

/** After-accept funnel: ribbon width = accepted count; same drop-offs as absolute from Accepted onward. */
function buildDownstreamSankey(
  buckets: FunnelBucket[],
  dark: boolean,
  tc: string
): { nodes: SankeyNodeLite[]; links: SankeyLinkLite[] } {
  const list = buckets.filter((b) => b.accepted > 0);
  if (list.length === 0) return { nodes: [], links: [] };

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

  const nodeDropInbox = "sink:Accepted · no reply (downstream)";
  const nodePositive = "sink:Positive replies (downstream)";
  const nodeNonPositive = "sink:Inbox · non-positive (downstream)";

  list.forEach((b, idx) => {
    const isOther = b.key === "__other__";
    const flowColor = flowAlluviumColor(idx, dark, isOther);
    const nAcc = `dacc:${b.label}`;
    const nInb = `dinb:${b.label}`;

    pushNode({
      name: nAcc,
      depth: 0,
      value: b.accepted,
      _raw: b.accepted,
      itemStyle: { color: flowColor, borderColor: cAccepted, borderWidth: 1 },
      label: { color: tc, fontWeight: "bold" },
      __rank: idx,
    });
    pushNode({
      name: nInb,
      depth: 1,
      itemStyle: { color: flowColor, borderColor: cInbox, borderWidth: 1 },
      label: { color: tc },
      __rank: idx,
    });

    pushLink({
      source: nAcc,
      target: nInb,
      value: b.inbox,
      _raw: b.inbox,
      lineStyle: { color: flowColor, opacity: 0.6 },
    });
    pushLink({
      source: nAcc,
      target: nodeDropInbox,
      value: Math.max(0, b.accepted - b.inbox),
      _raw: Math.max(0, b.accepted - b.inbox),
      lineStyle: { color: cDrop, opacity: 0.35 },
    });

    pushLink({
      source: nInb,
      target: nodePositive,
      value: b.positive,
      _raw: b.positive,
      lineStyle: { color: cPositive, opacity: 0.7 },
    });
    pushLink({
      source: nInb,
      target: nodeNonPositive,
      value: Math.max(0, b.inbox - b.positive),
      _raw: Math.max(0, b.inbox - b.positive),
      lineStyle: { color: cDrop, opacity: 0.35 },
    });
  });

  pushNode({
    name: nodeDropInbox,
    depth: 1,
    itemStyle: { color: cDrop, borderColor: cDrop },
    label: { color: tc },
    __rank: 9001,
  });
  pushNode({
    name: nodePositive,
    depth: 2,
    itemStyle: { color: cPositive, borderColor: cPositive },
    label: { color: tc, fontWeight: "bold" },
    __rank: 9002,
  });
  pushNode({
    name: nodeNonPositive,
    depth: 2,
    itemStyle: { color: cDrop, borderColor: cDrop },
    label: { color: tc },
    __rank: 9003,
  });

  return { nodes, links };
}

/**
 * Hypothesis reach: first split width ∝ max(capped reach, sent); then Sent → Accepted → Inbox → Positive
 * with one scale so Sankey conserves. Tooltips use `_raw` funnel counts; split shows tagged reach.
 */
function buildReachFunnelSankey(
  buckets: FunnelBucket[],
  dark: boolean,
  tc: string
): { nodes: SankeyNodeLite[]; links: SankeyLinkLite[] } {
  const BASE = 10_000;
  const cSent = funnelStageColor(0, dark);
  const cAccepted = funnelStageColor(1, dark);
  const cInbox = funnelStageColor(2, dark);
  const cPositive = funnelStageColor(3, dark);
  const cDrop = dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)";

  const basis = buckets.map((b) => {
    const r = Math.max(0, b.reach ?? 0);
    const s = Math.max(0, b.sent);
    return Math.max(r, s);
  });
  const denom = basis.reduce((a, x) => a + x, 0);
  if (denom <= 0) return { nodes: [], links: [] };

  const sc = (raw: number) => (BASE * raw) / denom;

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

  const nodeTotal = "total:Tagged reach (all)";
  const nodeSink = "sinkreach:Drop-offs";

  pushNode({
    name: nodeTotal,
    depth: 0,
    value: BASE,
    _raw: denom,
    itemStyle: { color: cSent, borderColor: cSent },
    label: { color: tc, fontWeight: "bold" },
    __rank: -1,
  });

  pushNode({
    name: nodeSink,
    depth: 2,
    itemStyle: { color: cDrop, borderColor: cDrop },
    label: { color: tc },
    __rank: 9000,
  });

  buckets.forEach((b, idx) => {
    const isOther = b.key === "__other__";
    const flowColor = flowAlluviumColor(idx, dark, isOther);
    const basis_i = basis[idx]!;
    const nSplit = `rsplit:${b.label}`;
    const nSent = `rsent:${b.label}`;
    const nAcc = `racc:${b.label}`;
    const nInb = `rinb:${b.label}`;
    const nPos = `rpos:${b.label}`;
    const showInb = b.inbox > 0;
    const showPos = b.positive > 0;
    const reachRaw = Math.max(0, b.reach ?? 0);
    const taggedNoSend = Math.max(0, basis_i - b.sent);

    const wSplit = sc(basis_i);
    pushNode({
      name: nSplit,
      depth: 1,
      value: wSplit,
      _raw: reachRaw,
      itemStyle: { color: flowColor, borderColor: cSent, borderWidth: 1 },
      label: { color: tc, fontWeight: "bold" },
      __rank: idx,
    });
    pushLink({
      source: nodeTotal,
      target: nSplit,
      value: wSplit,
      _raw: reachRaw,
      lineStyle: { color: flowColor, opacity: 0.38 },
    });

    const wSent = sc(b.sent);
    pushNode({
      name: nSent,
      depth: 2,
      value: wSent,
      _raw: b.sent,
      itemStyle: { color: flowColor, borderColor: cSent, borderWidth: 1 },
      label: { color: tc },
      __rank: idx,
    });
    pushLink({
      source: nSplit,
      target: nSent,
      value: wSent,
      _raw: b.sent,
      lineStyle: { color: flowColor, opacity: 0.5 },
    });
    if (taggedNoSend > 0) {
      pushLink({
        source: nSplit,
        target: nodeSink,
        value: sc(taggedNoSend),
        _raw: taggedNoSend,
        lineStyle: { color: cDrop, opacity: 0.32 },
      });
    }

    const wAcc = sc(b.accepted);
    pushNode({
      name: nAcc,
      depth: 3,
      value: wAcc,
      _raw: b.accepted,
      itemStyle: { color: flowColor, borderColor: cAccepted, borderWidth: 1 },
      label: { color: tc },
      __rank: idx,
    });
    pushLink({
      source: nSent,
      target: nAcc,
      value: wAcc,
      _raw: b.accepted,
      lineStyle: { color: flowColor, opacity: 0.55 },
    });
    pushLink({
      source: nSent,
      target: nodeSink,
      value: sc(Math.max(0, b.sent - b.accepted)),
      _raw: Math.max(0, b.sent - b.accepted),
      lineStyle: { color: cDrop, opacity: 0.32 },
    });

    if (showInb) {
      const wInb = sc(b.inbox);
      pushNode({
        name: nInb,
        depth: 4,
        value: wInb,
        _raw: b.inbox,
        itemStyle: { color: flowColor, borderColor: cInbox, borderWidth: 1 },
        label: { color: tc },
        __rank: idx,
      });
      pushLink({
        source: nAcc,
        target: nInb,
        value: wInb,
        _raw: b.inbox,
        lineStyle: { color: flowColor, opacity: 0.55 },
      });
      pushLink({
        source: nAcc,
        target: nodeSink,
        value: sc(Math.max(0, b.accepted - b.inbox)),
        _raw: Math.max(0, b.accepted - b.inbox),
        lineStyle: { color: cDrop, opacity: 0.3 },
      });
    } else if (!showPos) {
      pushLink({
        source: nAcc,
        target: nodeSink,
        value: wAcc,
        _raw: b.accepted,
        lineStyle: { color: cDrop, opacity: 0.28 },
      });
    }

    if (showPos) {
      const wPos = sc(b.positive);
      const src = showInb ? nInb : nAcc;
      pushNode({
        name: nPos,
        depth: 5,
        value: wPos,
        _raw: b.positive,
        itemStyle: { color: flowColor, borderColor: cPositive, borderWidth: 1 },
        label: { color: tc },
        __rank: idx,
      });
      pushLink({
        source: src,
        target: nPos,
        value: wPos,
        _raw: b.positive,
        lineStyle: { color: flowColor, opacity: 0.58 },
      });
      pushLink({
        source: src,
        target: nodeSink,
        value: sc(showInb ? Math.max(0, b.inbox - b.positive) : Math.max(0, b.accepted - b.positive)),
        _raw: showInb ? Math.max(0, b.inbox - b.positive) : Math.max(0, b.accepted - b.positive),
        lineStyle: { color: cDrop, opacity: 0.3 },
      });
    } else if (showInb) {
      pushLink({
        source: nInb,
        target: nodeSink,
        value: sc(Math.max(0, b.inbox - b.positive)),
        _raw: Math.max(0, b.inbox - b.positive),
        lineStyle: { color: cDrop, opacity: 0.3 },
      });
    }
  });

  return { nodes, links };
}

const legacySankeyCompat = [
  stripSankeyPrefix,
  buildAbsoluteSankey,
  buildConversionSankey,
  buildDownstreamSankey,
  buildReachFunnelSankey,
];
void legacySankeyCompat;

watch(analyticsGroupBy, (g) => {
  if (g !== "hypothesis" && funnelSankeyMode.value === "reach") {
    funnelSankeyMode.value = "absolute";
  }
});

watch(reachModeAvailable, (ok) => {
  if (!ok && funnelSankeyMode.value === "reach") {
    funnelSankeyMode.value = "absolute";
  }
});

type AlluvialStageLabel = { id: string; label: string; color: string };

type AlluvialEntry = {
  id: string;
  label: string;
  value: number;
  rank: number;
  color?: string;
};

type AlluvialRibbon = {
  sourceStage: string;
  targetStage: string;
  sourceEntry: string;
  targetEntry: string;
  raw: number;
  color: string;
  opacity: number;
  sourceLabel: string;
  targetLabel: string;
};

type AlluvialStage = {
  id: string;
  label: string;
  color: string;
  entries: Map<string, AlluvialEntry>;
};

type AlluvialSlot = {
  id: string;
  label: string;
  rank: number;
  raw: number;
  pct: number;
  y0: number;
  y1: number;
  color?: string;
  stageId: string;
  stageLabel: string;
  stageIndex: number;
  stageTotal: number;
};

type AlluvialModel = {
  stageLabels: AlluvialStageLabel[];
  slotsByStage: AlluvialSlot[][];
  ribbons: Array<
    AlluvialRibbon & {
      sourceSlot: AlluvialSlot;
      targetSlot: AlluvialSlot;
      sourceStageIndex: number;
      targetStageIndex: number;
      sourceY0: number;
      sourceY1: number;
      targetY0: number;
      targetY1: number;
    }
  >;
};

function stageColorByMode(mode: FunnelSankeyMode, stageIndex: number, dark: boolean): string {
  if (mode === "conversion") {
    if (stageIndex <= 1) return funnelStageColor(0, dark);
    return funnelStageColor(stageIndex - 1, dark);
  }
  if (mode === "reach") {
    if (stageIndex <= 2) return funnelStageColor(0, dark);
    return funnelStageColor(stageIndex - 2, dark);
  }
  if (mode === "downstream") {
    return funnelStageColor(Math.min(stageIndex + 1, 3), dark);
  }
  return funnelStageColor(stageIndex, dark);
}

function buildNormalizedAlluvial(
  buckets: FunnelBucket[],
  mode: FunnelSankeyMode,
  dark: boolean,
  selectedPipelineStages: Array<{ stageUuid: string; stageName: string; position: number }>
): AlluvialModel | null {
  const flowMeta = buckets.map((b, idx) => ({
    bucket: b,
    flowId: `flow:${b.key}`,
    rank: idx,
    color: flowAlluviumColor(idx, dark, b.key === "__other__"),
  }));
  const stageMap = new Map<string, AlluvialStage>();
  const ribbons: AlluvialRibbon[] = [];
  const stageOrder: AlluvialStageLabel[] = [];

  const addStage = (id: string, label: string, color: string): void => {
    if (stageMap.has(id)) return;
    stageMap.set(id, { id, label, color, entries: new Map<string, AlluvialEntry>() });
    stageOrder.push({ id, label, color });
  };
  const addEntry = (
    stageId: string,
    entryId: string,
    label: string,
    value: number,
    rank: number,
    color?: string
  ): void => {
    if (value <= 0) return;
    const stage = stageMap.get(stageId);
    if (!stage) return;
    const prev = stage.entries.get(entryId);
    if (prev) {
      prev.value += value;
      return;
    }
    stage.entries.set(entryId, { id: entryId, label, value, rank, color });
  };
  const addRibbon = (
    sourceStage: string,
    targetStage: string,
    sourceEntry: string,
    targetEntry: string,
    raw: number,
    color: string,
    opacity: number,
    sourceLabel: string,
    targetLabel: string
  ): void => {
    if (raw <= 0) return;
    ribbons.push({
      sourceStage,
      targetStage,
      sourceEntry,
      targetEntry,
      raw,
      color,
      opacity,
      sourceLabel,
      targetLabel,
    });
  };

  const sumSent = buckets.reduce((s, b) => s + b.sent, 0);
  const sumAcc = buckets.reduce((s, b) => s + b.accepted, 0);
  const hasPipelineStageData =
    selectedPipelineStages.length > 0 &&
    buckets.some((b) => (b.pipelineStageBreakdown?.length ?? 0) > 0);
  if (mode !== "downstream" && sumSent <= 0) return null;
  if (mode === "downstream" && sumAcc <= 0) return null;
  const pipeStageId = (uuid: string) => `pipe:${uuid}`;
  const selectedPipelineSorted = [...selectedPipelineStages]
    .filter((s) => s.stageUuid && s.stageName.trim().length > 0)
    .sort((a, b) => a.position - b.position || a.stageName.localeCompare(b.stageName));
  const insertPipelineStages = (base: string[]): string[] => {
    if (!hasPipelineStageData || selectedPipelineSorted.length === 0) return base;
    const out = [...base];
    for (const s of selectedPipelineSorted) {
      const id = pipeStageId(s.stageUuid);
      if (out.includes(id)) continue;
      const at = Math.max(0, Math.min(out.length, Math.trunc(s.position) - 1));
      out.splice(at, 0, id);
    }
    return out;
  };
  const stageLabel = (stageId: string): string => {
    if (stageId === "total") return "Total";
    if (stageId === "byFlow") return "By flow";
    if (stageId === "byReach") return "By reach";
    if (stageId === "sent") return "Sent";
    if (stageId === "accepted") return "Accepted";
    if (stageId === "inbox") return "Inbox";
    if (stageId === "positive") return "Positive";
    if (stageId.startsWith("pipe:")) {
      const uuid = stageId.slice("pipe:".length);
      return selectedPipelineSorted.find((s) => s.stageUuid === uuid)?.stageName ?? "Pipeline";
    }
    return stageId;
  };
  const countPipelineStage = (b: FunnelBucket, stageUuid: string): number =>
    (b.pipelineStageBreakdown ?? [])
      .filter((x) => x.stageUuid === stageUuid)
      .reduce((sum, x) => sum + Math.max(0, x.contactsCount | 0), 0);

  let baseStageSeq: string[] = [];
  let totalStageId: string | null = null;
  let totalNodeId = "";
  let totalNodeLabel = "";
  const reachBasis = flowMeta.map(({ bucket: b }) => Math.max(Math.max(0, b.reach ?? 0), b.sent));
  const reachBasisSum = reachBasis.reduce((s, n) => s + n, 0);
  if (mode === "conversion") {
    baseStageSeq = ["total", "byFlow", "accepted", "inbox", "positive"];
    totalStageId = "total";
    totalNodeId = "total:all";
    totalNodeLabel = "All connections";
  } else if (mode === "reach") {
    if (reachBasisSum <= 0) return null;
    baseStageSeq = ["total", "byReach", "sent", "accepted", "inbox", "positive"];
    totalStageId = "total";
    totalNodeId = "total:reach";
    totalNodeLabel = "Tagged reach (all)";
  } else if (mode === "downstream") {
    baseStageSeq = ["accepted", "inbox", "positive"];
  } else {
    baseStageSeq = ["sent", "accepted", "inbox", "positive"];
  }
  const stageSeq = insertPipelineStages(baseStageSeq);
  stageSeq.forEach((sid, i) => addStage(sid, stageLabel(sid), stageColorByMode(mode, i, dark)));

  if (totalStageId) {
    const totalValue = mode === "reach" ? reachBasisSum : sumSent;
    addEntry(totalStageId, totalNodeId, totalNodeLabel, totalValue, -1, stageColorByMode(mode, 0, dark));
  }

  const flowStageValue = (b: FunnelBucket, stageId: string, flowIndex: number): number => {
    if (stageId === "byFlow") return b.sent;
    if (stageId === "byReach") return reachBasis[flowIndex] ?? 0;
    if (stageId === "sent") return b.sent;
    if (stageId === "accepted") return b.accepted;
    if (stageId === "inbox") return b.inbox;
    if (stageId === "positive") return b.positive;
    if (stageId.startsWith("pipe:")) return countPipelineStage(b, stageId.slice("pipe:".length));
    return 0;
  };

  flowMeta.forEach(({ bucket: b, flowId, rank, color }, i) => {
    for (const sid of stageSeq) {
      if (sid === totalStageId) continue;
      addEntry(sid, flowId, b.label, flowStageValue(b, sid, i), rank, color);
    }
    for (let si = 0; si < stageSeq.length - 1; si += 1) {
      const src = stageSeq[si]!;
      const tgt = stageSeq[si + 1]!;
      const raw = flowStageValue(b, tgt, i);
      if (raw <= 0) continue;
      addRibbon(
        src,
        tgt,
        src === totalStageId ? totalNodeId : flowId,
        flowId,
        raw,
        color,
        Math.min(0.66, 0.38 + si * 0.04),
        src === totalStageId ? totalNodeLabel : b.label,
        b.label
      );
    }
  });

  const slotsByStage: AlluvialSlot[][] = stageOrder.map((s, stageIndex) => {
    const stage = stageMap.get(s.id);
    if (!stage) return [];
    const arr = [...stage.entries.values()].filter((x) => x.value > 0);
    arr.sort((a, b) => (a.rank === b.rank ? a.label.localeCompare(b.label) : a.rank - b.rank));
    const total = arr.reduce((sum, x) => sum + x.value, 0);
    if (total <= 0) return [];
    let acc = 0;
    return arr.map((x) => {
      const pct = x.value / total;
      const y0 = acc;
      const y1 = Math.min(1, acc + pct);
      acc = y1;
      return {
        id: x.id,
        label: x.label,
        rank: x.rank,
        raw: x.value,
        pct,
        y0,
        y1,
        color: x.color,
        stageId: s.id,
        stageLabel: s.label,
        stageIndex,
        stageTotal: total,
      };
    });
  });

  if (slotsByStage.some((x) => x.length === 0)) return null;

  const slotIdx = new Map<string, AlluvialSlot>();
  slotsByStage.forEach((slots) => {
    slots.forEach((slot) => {
      slotIdx.set(`${slot.stageId}::${slot.id}`, slot);
    });
  });

  const ribbonResolved = ribbons
    .map((r) => {
      const sourceSlot = slotIdx.get(`${r.sourceStage}::${r.sourceEntry}`);
      const targetSlot = slotIdx.get(`${r.targetStage}::${r.targetEntry}`);
      if (!sourceSlot || !targetSlot) return null;
      return {
        ...r,
        sourceSlot,
        targetSlot,
        sourceStageIndex: sourceSlot.stageIndex,
        targetStageIndex: targetSlot.stageIndex,
        sourceY0: sourceSlot.y0,
        sourceY1: sourceSlot.y1,
        targetY0: targetSlot.y0,
        targetY1: targetSlot.y1,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  if (ribbonResolved.length === 0) return null;

  const sourceGroups = new Map<string, typeof ribbonResolved>();
  const targetGroups = new Map<string, typeof ribbonResolved>();
  ribbonResolved.forEach((r) => {
    const sKey = `${r.sourceStage}::${r.sourceEntry}`;
    const tKey = `${r.targetStage}::${r.targetEntry}`;
    if (!sourceGroups.has(sKey)) sourceGroups.set(sKey, []);
    if (!targetGroups.has(tKey)) targetGroups.set(tKey, []);
    sourceGroups.get(sKey)!.push(r);
    targetGroups.get(tKey)!.push(r);
  });
  sourceGroups.forEach((group) => {
    const total = group.reduce((s, r) => s + r.raw, 0);
    if (total <= 0) return;
    group.sort((a, b) =>
      a.targetSlot.rank === b.targetSlot.rank
        ? a.targetSlot.label.localeCompare(b.targetSlot.label)
        : a.targetSlot.rank - b.targetSlot.rank
    );
    let acc = 0;
    const slotSpan = Math.max(0, group[0]!.sourceSlot.y1 - group[0]!.sourceSlot.y0);
    group.forEach((r) => {
      const p = r.raw / total;
      r.sourceY0 = r.sourceSlot.y0 + slotSpan * acc;
      r.sourceY1 = r.sourceSlot.y0 + slotSpan * Math.min(1, acc + p);
      acc += p;
    });
  });
  targetGroups.forEach((group) => {
    const total = group.reduce((s, r) => s + r.raw, 0);
    if (total <= 0) return;
    group.sort((a, b) =>
      a.sourceSlot.rank === b.sourceSlot.rank
        ? a.sourceSlot.label.localeCompare(b.sourceSlot.label)
        : a.sourceSlot.rank - b.sourceSlot.rank
    );
    let acc = 0;
    const slotSpan = Math.max(0, group[0]!.targetSlot.y1 - group[0]!.targetSlot.y0);
    group.forEach((r) => {
      const p = r.raw / total;
      r.targetY0 = r.targetSlot.y0 + slotSpan * acc;
      r.targetY1 = r.targetSlot.y0 + slotSpan * Math.min(1, acc + p);
      acc += p;
    });
  });

  return { stageLabels: stageOrder, slotsByStage, ribbons: ribbonResolved };
}

const funnelSankeyOption = computed((): EChartsOption => {
  const buckets = funnelSankeyBuckets.value;
  const dark = isDark.value;
  const tc = chartTextColor(dark);
  const mode = funnelSankeyMode.value;

  if (buckets.length === 0) return { animation: false, series: [] };

  const model = buildNormalizedAlluvial(
    buckets,
    mode,
    dark,
    selectedPipelineStageConfigs.value
  );
  if (!model) return { animation: false, series: [] };

  const stageLabels = model.stageLabels.map((s) => s.label);
  const hasPipelineColumn = selectedPipelineStageConfigs.value.length > 0;
  const topN = Math.min(buckets.length, FUNNEL_SANKEY_FLOW_LIMIT);
  const subtext =
    mode === "conversion"
      ? `Conversion (100% per stage) · each column is normalized independently; strata show stage share by ${groupEntitySingular.value}.${hasPipelineColumn ? " Selected pipeline stages are inserted by configured positions." : ""} Top ${topN} ${groupEntityPlural.value}.`
      : mode === "downstream"
        ? `Downstream (100% per stage) · Accepted → Inbox → Positive by ${groupEntitySingular.value}.${hasPipelineColumn ? " Selected pipeline stages are inserted by configured positions." : ""} Top ${topN} ${groupEntityPlural.value}.`
        : mode === "reach"
          ? `Reach alluvial (100% per stage) · Reach basis = max(tagged reach, sent), reach capped at ${FUNNEL_REACH_DISPLAY_CAP.toLocaleString()}.${hasPipelineColumn ? " Selected pipeline stages are inserted by configured positions." : ""}`
          : `Absolute alluvial (100% per stage) · Sent → Accepted → Inbox → Positive by ${groupEntitySingular.value}.${hasPipelineColumn ? " Selected pipeline stages are inserted by configured positions." : ""}`;

  const axisHeaderTop = 52;
  const axisHeaders = model.stageLabels.map((stage, i) => {
    const last = Math.max(1, model.stageLabels.length - 1);
    const leftPct = `${8 + (80 * i) / last}%`;
    return {
      type: "text" as const,
      left: leftPct,
      top: axisHeaderTop,
      style: {
        text: stage.label,
        fill: stage.color,
        opacity: 0.88,
        font: "bold 22px sans-serif",
        textAlign: "center" as const,
      },
    };
  });

  const slotByStageAndId = new Map<string, AlluvialSlot>();
  model.slotsByStage.forEach((slots) => {
    slots.forEach((slot) => {
      slotByStageAndId.set(`${slot.stageId}::${slot.id}`, slot);
    });
  });
  const convPctForSlot = (slot: AlluvialSlot): number | null => {
    if (mode !== "conversion") return null;
    if (slot.stageId === "total") return 100;
    if (slot.stageIndex === 0) return 100;
    const prevStage = model.stageLabels[slot.stageIndex - 1];
    if (!prevStage) return null;
    if (slot.stageId === "byFlow" && prevStage.id === "total") {
      const total = model.slotsByStage[slot.stageIndex - 1]?.[0]?.raw ?? 0;
      return total > 0 ? (100 * slot.raw) / total : 0;
    }
    const prev = slotByStageAndId.get(`${prevStage.id}::${slot.id}`)?.raw ?? 0;
    return prev > 0 ? (100 * slot.raw) / prev : 0;
  };
  const ribbonItems = model.ribbons.map((r, i) => ({
    kind: "ribbon" as const,
    id: `rib:${i}`,
    sourceStageIndex: r.sourceStageIndex,
    targetStageIndex: r.targetStageIndex,
    sourceY0: r.sourceY0,
    sourceY1: r.sourceY1,
    targetY0: r.targetY0,
    targetY1: r.targetY1,
    raw: r.raw,
    color: r.color,
    opacity: r.opacity,
    sourceLabel: r.sourceLabel,
    targetLabel: r.targetLabel,
    sourceStageLabel: r.sourceSlot.stageLabel,
    targetStageLabel: r.targetSlot.stageLabel,
  }));
  const stratumItems = model.slotsByStage.flatMap((slots) =>
    slots.map((slot, i) => ({
      kind: "stratum" as const,
      id: `bar:${slot.stageId}:${slot.id}:${i}`,
      stageIndex: slot.stageIndex,
      stageLabel: slot.stageLabel,
      y0: slot.y0,
      y1: slot.y1,
      raw: slot.raw,
      pct: slot.pct,
      convPct: convPctForSlot(slot),
      stageTotal: slot.stageTotal,
      label: slot.label,
      rank: slot.rank,
      color: slot.color,
    }))
  );
  const firstBandFlowNameItems = model.ribbons
    .filter((r) => r.sourceStageIndex === 0 && r.targetStageIndex === 1)
    .map((r, i) => ({
      kind: "flowName" as const,
      id: `flow-label:${i}`,
      label: r.targetLabel,
      sourceStageIndex: r.sourceStageIndex,
      targetStageIndex: r.targetStageIndex,
      sourceY0: r.sourceY0,
      sourceY1: r.sourceY1,
      targetY0: r.targetY0,
      targetY1: r.targetY1,
    }));

  return {
    animation: false,
    backgroundColor: chartSurfaceBg(dark),
    textStyle: { color: tc },
    title: {
      text: "Funnel Alluvial",
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
        const data = ((params as { data?: unknown } | undefined)?.data ?? null) as
          | {
              kind?: "ribbon" | "stratum";
              sourceStageLabel?: string;
              targetStageLabel?: string;
              sourceLabel?: string;
              targetLabel?: string;
              raw?: number;
              stageLabel?: string;
              label?: string;
              pct?: number;
              convPct?: number;
              stageTotal?: number;
            }
          | null;
        if (!data || typeof data !== "object") return "";
        if (data.kind === "ribbon") {
          const raw = Math.max(0, Math.round(Number(data.raw ?? 0)));
          return `${data.sourceStageLabel} · ${data.sourceLabel} → ${data.targetStageLabel} · ${data.targetLabel}<br/><strong>${raw.toLocaleString()}</strong>`;
        }
        if (data.kind === "stratum") {
          const raw = Math.max(0, Math.round(Number(data.raw ?? 0)));
          const total = Math.max(0, Math.round(Number(data.stageTotal ?? 0)));
          if (mode === "conversion") {
            const conv = Math.max(0, Number(data.convPct ?? 0));
            return `${data.stageLabel} · ${data.label}<br/><strong>${Math.round(conv)}%</strong> conversion<br/><em>Raw: ${raw.toLocaleString()} · Stage total: ${total.toLocaleString()}</em>`;
          }
          return `${data.stageLabel} · ${data.label}<br/><strong>${raw.toLocaleString()}</strong><br/><em>Stage total: ${total.toLocaleString()}</em>`;
        }
        return "";
      },
    },
    series: [
      {
        name: "alluvial-ribbons",
        type: "custom",
        coordinateSystem: "none",
        data: ribbonItems,
        z: 2,
        renderItem: (params: unknown, api: unknown) => {
          const d = (params as { dataIndexInside?: number }).dataIndexInside ?? 0;
          const row = ribbonItems[d];
          if (!row) return null;
          const w = (api as { getWidth: () => number }).getWidth();
          const h = (api as { getHeight: () => number }).getHeight();
          const left = 26;
          const right = 150;
          const top = 78;
          const bottom = 18;
          const n = Math.max(1, stageLabels.length);
          const plotW = Math.max(120, w - left - right);
          const plotH = Math.max(40, h - top - bottom);
          const step = n <= 1 ? 0 : plotW / (n - 1);
          const barW = Math.min(50, Math.max(22, n <= 1 ? 40 : step * 0.34));
          const xS = left + row.sourceStageIndex * step + barW / 2;
          const xT = left + row.targetStageIndex * step - barW / 2;
          const yS0 = top + row.sourceY0 * plotH;
          const yS1 = top + row.sourceY1 * plotH;
          const yT0 = top + row.targetY0 * plotH;
          const yT1 = top + row.targetY1 * plotH;
          const c = Math.max(10, (xT - xS) * 0.42);
          const pathData = [
            `M${xS},${yS0}`,
            `C${xS + c},${yS0} ${xT - c},${yT0} ${xT},${yT0}`,
            `L${xT},${yT1}`,
            `C${xT - c},${yT1} ${xS + c},${yS1} ${xS},${yS1}`,
            "Z",
          ].join(" ");
          return {
            type: "path",
            shape: { pathData },
            style: { fill: row.color, opacity: row.opacity },
          };
        },
      },
      {
        name: "alluvial-strata",
        type: "custom",
        coordinateSystem: "none",
        data: stratumItems,
        z: 4,
        renderItem: (params: unknown, api: unknown) => {
          const d = (params as { dataIndexInside?: number }).dataIndexInside ?? 0;
          const row = stratumItems[d];
          if (!row) return null;
          const w = (api as { getWidth: () => number }).getWidth();
          const h = (api as { getHeight: () => number }).getHeight();
          const left = 26;
          const right = 150;
          const top = 78;
          const bottom = 18;
          const n = Math.max(1, stageLabels.length);
          const plotW = Math.max(120, w - left - right);
          const plotH = Math.max(40, h - top - bottom);
          const step = n <= 1 ? 0 : plotW / (n - 1);
          const barW = Math.min(50, Math.max(22, n <= 1 ? 40 : step * 0.34));
          const x = left + row.stageIndex * step - barW / 2;
          const y = top + row.y0 * plotH;
          const hRect = Math.max(1, (row.y1 - row.y0) * plotH);
          const fill = row.color ?? (dark ? "rgba(44, 44, 50, 0.96)" : "rgba(245, 245, 245, 0.98)");
          const stroke = dark ? "rgba(255,255,255,0.55)" : "rgba(20,20,20,0.78)";
          const showNumber = hRect >= 10;
          const valueText =
            mode === "conversion"
              ? `${Math.max(0, Math.round(Number((row as { convPct?: number }).convPct ?? 0)))}%`
              : Math.max(0, Math.round(row.raw)).toLocaleString();
          return {
            type: "group",
            children: [
              {
                type: "rect",
                shape: { x, y, width: barW, height: hRect },
                style: { fill, stroke, lineWidth: 1 },
              },
              ...(showNumber
                ? [
                    {
                      type: "text",
                      style: {
                        x: x + barW + 4,
                        y: y + hRect / 2,
                        text: valueText,
                        fill: tc,
                        font: "bold 22px sans-serif",
                        align: "left",
                        verticalAlign: "middle",
                      },
                    },
                  ]
                : []),
            ],
          };
        },
      },
      {
        name: "alluvial-flow-names",
        type: "custom",
        coordinateSystem: "none",
        data: firstBandFlowNameItems,
        z: 50,
        zlevel: 2,
        silent: true,
        renderItem: (params: unknown, api: unknown) => {
          const d = (params as { dataIndexInside?: number }).dataIndexInside ?? 0;
          const row = firstBandFlowNameItems[d];
          if (!row) return null;
          const w = (api as { getWidth: () => number }).getWidth();
          const h = (api as { getHeight: () => number }).getHeight();
          const left = 26;
          const right = 150;
          const top = 78;
          const bottom = 18;
          const n = Math.max(1, stageLabels.length);
          const plotW = Math.max(120, w - left - right);
          const plotH = Math.max(40, h - top - bottom);
          const step = n <= 1 ? 0 : plotW / (n - 1);
          const barW = Math.min(50, Math.max(22, n <= 1 ? 40 : step * 0.34));
          const xS = left + row.sourceStageIndex * step + barW / 2;
          const xT = left + row.targetStageIndex * step - barW / 2;
          const x = xS + (xT - xS) * 0.5;
          const yMid = top + ((row.targetY0 + row.targetY1) * 0.5) * plotH;
          const laneH = Math.max(0, (row.targetY1 - row.targetY0) * plotH);
          if (laneH < 14) return null;
          const textColor = dark ? "rgba(255,255,255,0.92)" : "rgba(20,20,20,0.86)";
          return {
            type: "text",
            z2: 200,
            style: {
              x,
              y: yMid,
              text: row.label,
              fill: textColor,
              font: "bold 12px sans-serif",
              align: "center",
              verticalAlign: "middle",
              backgroundColor: dark ? "rgba(16,16,20,0.6)" : "rgba(255,255,255,0.7)",
              borderRadius: 4,
              padding: [3, 8, 3, 8],
            },
          };
        },
      },
    ] as EChartsOption["series"],
  };
});

const dailySeries = ref<DailyMetricPoint[]>([]);
const dailyByEntity = ref<Array<{ entityId: string; entityName: string; series: DailyMetricPoint[] }>>([]);
const dailyLoading = ref(false);
const dailyError = ref("");
const dailyWarnings = ref<string[]>([]);
let analyticsAbortController: AbortController | null = null;
let dailyAbortController: AbortController | null = null;
let analyticsReloadTimer: ReturnType<typeof setTimeout> | null = null;
const ANALYTICS_RELOAD_DEBOUNCE_MS = 180;
/** Combined funnel chart: lines vs stacked area. */
const dailyFunnelDisplay = ref<"lines" | "stacked">("lines");
/** 7-day rolling funnel chart: lines vs stacked (independent of primary funnel chart). */
const dailyRolling7Display = ref<"lines" | "stacked">("lines");
/** Shared metric for daily heatmaps (merged + 1–2 entity views). */
const dailyHeatmapMetric = ref<DailyHeatmapMetricId>("connectionSent");

async function loadDailyMetrics() {
  if (analyticsMainTab.value !== "funnelsDaily") return;
  const pid = selectedProjectId.value;
  const dr = dateRange.value;
  if (!pid || !dr || dr.length !== 2) {
    dailySeries.value = [];
    dailyByEntity.value = [];
    return;
  }
  dailyLoading.value = true;
  dailyError.value = "";
  dailyWarnings.value = [];
  dailyAbortController?.abort();
  const controller = new AbortController();
  dailyAbortController = controller;
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
    const r = await fetch(`/api/project-analytics-daily?${q.toString()}`, {
      signal: controller.signal,
    });
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
    if (e instanceof DOMException && e.name === "AbortError") return;
    dailyError.value = e instanceof Error ? e.message : "Failed to load daily metrics";
    dailySeries.value = [];
    dailyByEntity.value = [];
  } finally {
    if (dailyAbortController === controller) {
      dailyLoading.value = false;
      dailyAbortController = null;
    }
  }
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

const dailyRolling7Option = computed((): EChartsOption =>
  makeRollingDailyFunnelChartOption(dailySeries.value, dailyRolling7Display.value, isDark.value, 7)
);

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

const WEEKLY_FUNNEL_SANKEY_MAX = 8;

/** One disconnected funnel chain per calendar week (Mon UTC), last N weeks. */
function buildWeeklyFunnelBlocksSankey(
  weekRows: DailyWowRow[],
  dark: boolean,
  tc: string
): { nodes: SankeyNodeLite[]; links: SankeyLinkLite[] } {
  if (weekRows.length === 0) return { nodes: [], links: [] };
  const take = weekRows.slice(-WEEKLY_FUNNEL_SANKEY_MAX);
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
  const cDrop = dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)";

  take.forEach((w, wi) => {
    const db = wi * 4;
    const tag = w.weekStart;
    const short = tag.slice(5);
    const rank = wi * 20;
    const nS = `${short}·Sent`;
    const nA = `${short}·Acc`;
    const nI = `${short}·Inbox`;
    const nP = `${short}·Pos`;
    const d1 = `${short}·Not acc`;
    const d2 = `${short}·No inbox`;
    const d3 = `${short}·Non+`;

    const sent = w.connectionSent;
    const acc = w.connectionAccepted;
    const ib = w.inbox;
    const pr = w.positiveReplies;
    if (sent <= 0) return;

    pushNode({
      name: nS,
      depth: db,
      value: sent,
      _raw: sent,
      itemStyle: { color: funnelStageColor(0, dark), borderColor: funnelStageColor(0, dark) },
      label: { color: tc, fontWeight: "bold" },
      __rank: rank,
    });
    pushNode({
      name: nA,
      depth: db + 1,
      value: acc,
      _raw: acc,
      itemStyle: { color: funnelStageColor(1, dark), borderColor: funnelStageColor(1, dark) },
      label: { color: tc },
      __rank: rank + 1,
    });
    pushNode({
      name: nI,
      depth: db + 2,
      value: ib,
      _raw: ib,
      itemStyle: { color: funnelStageColor(2, dark), borderColor: funnelStageColor(2, dark) },
      label: { color: tc },
      __rank: rank + 2,
    });
    pushNode({
      name: nP,
      depth: db + 3,
      value: pr,
      _raw: pr,
      itemStyle: { color: funnelStageColor(3, dark), borderColor: funnelStageColor(3, dark) },
      label: { color: tc, fontWeight: "bold" },
      __rank: rank + 3,
    });
    pushNode({
      name: d1,
      depth: db + 1,
      itemStyle: { color: cDrop, borderColor: cDrop },
      label: { color: tc },
      __rank: rank + 10,
    });
    pushNode({
      name: d2,
      depth: db + 2,
      itemStyle: { color: cDrop, borderColor: cDrop },
      label: { color: tc },
      __rank: rank + 11,
    });
    pushNode({
      name: d3,
      depth: db + 3,
      itemStyle: { color: cDrop, borderColor: cDrop },
      label: { color: tc },
      __rank: rank + 12,
    });

    pushLink({
      source: nS,
      target: nA,
      value: acc,
      _raw: acc,
      lineStyle: { color: funnelStageColor(1, dark), opacity: 0.55 },
    });
    pushLink({
      source: nS,
      target: d1,
      value: Math.max(0, sent - acc),
      _raw: Math.max(0, sent - acc),
      lineStyle: { color: cDrop, opacity: 0.35 },
    });
    pushLink({
      source: nA,
      target: nI,
      value: ib,
      _raw: ib,
      lineStyle: { color: funnelStageColor(2, dark), opacity: 0.58 },
    });
    pushLink({
      source: nA,
      target: d2,
      value: Math.max(0, acc - ib),
      _raw: Math.max(0, acc - ib),
      lineStyle: { color: cDrop, opacity: 0.35 },
    });
    pushLink({
      source: nI,
      target: nP,
      value: pr,
      _raw: pr,
      lineStyle: { color: funnelStageColor(3, dark), opacity: 0.65 },
    });
    pushLink({
      source: nI,
      target: d3,
      value: Math.max(0, ib - pr),
      _raw: Math.max(0, ib - pr),
      lineStyle: { color: cDrop, opacity: 0.35 },
    });
  });

  return { nodes, links };
}

const weeklyFunnelSankeyOption = computed((): EChartsOption => {
  const rows = dailyWeekOverWeekRows.value;
  const dark = isDark.value;
  const tc = chartTextColor(dark);
  const bg = chartSurfaceBg(dark);
  const sl = splitLineColor(dark);
  if (rows.length === 0) return { animation: false, backgroundColor: bg, series: [] };
  const { nodes, links } = buildWeeklyFunnelBlocksSankey(rows, dark, tc);
  if (links.length === 0) return { animation: false, backgroundColor: bg, series: [] };
  const nWeeks = Math.min(rows.length, WEEKLY_FUNNEL_SANKEY_MAX);
  return {
    animation: false,
    backgroundColor: bg,
    textStyle: { color: tc },
    title: {
      text: "Weekly funnel (parallel)",
      subtext: `${nWeeks} week(s), up to ${WEEKLY_FUNNEL_SANKEY_MAX} most recent Mon–Sun buckets (UTC). Each block: Sent → Accepted → Inbox → Positive with drop-offs.`,
      left: "center",
      top: 4,
      textStyle: { color: tc, fontSize: 15, fontWeight: "bold" },
      subtextStyle: { color: tc, opacity: 0.72, fontSize: 11 },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? "rgba(40, 40, 44, 0.94)" : "rgba(255, 255, 255, 0.96)",
      borderColor: sl,
      textStyle: { fontSize: 13, color: tc },
    },
    series: [
      {
        type: "sankey",
        left: 12,
        right: 24,
        top: 56,
        bottom: 12,
        nodeWidth: 12,
        nodeGap: 6,
        nodeAlign: "justify",
        layoutIterations: 0,
        draggable: false,
        emphasis: { focus: "adjacency" },
        label: { color: tc, fontSize: 11 },
        lineStyle: { curveness: 0.45 },
        data: nodes,
        links,
      },
    ] as EChartsOption["series"],
  };
});

const dailyEntityHeatmapOption = computed((): EChartsOption =>
  makeDailyEntityHeatmapOption(dailyByEntity.value, dailyHeatmapMetric.value, isDark.value)
);

const dailyMergedHeatmapOption = computed((): EChartsOption =>
  makeDailyMergedHeatmapOption(
    dailySeries.value,
    dailyHeatmapMetric.value,
    isDark.value,
    `${groupEntityTitle.value} (merged)`
  )
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
    analyticsMainTab.value,
    selectedProjectId.value,
    dateRange.value?.[0],
    dateRange.value?.[1],
    selectedFlowUuids.value.join("|"),
    analyticsGroupBy.value,
  ],
  () => {
    if (analyticsMainTab.value === "funnelsDaily") void loadDailyMetrics();
  }
);

function normalizeFlowRow(raw: Record<string, unknown>): FlowFunnelRowUi {
  const ps = Array.isArray(raw.pipelineStageBreakdown)
    ? (raw.pipelineStageBreakdown as Array<Record<string, unknown>>)
    : [];
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
    pipelineStageBreakdown: ps
      .map((x) => ({
        stageUuid: String(x.stageUuid ?? ""),
        stageName: String(x.stageName ?? "").trim(),
        stageOrder:
          x.stageOrder == null || x.stageOrder === ""
            ? null
            : Number.isFinite(Number(x.stageOrder))
              ? Math.trunc(Number(x.stageOrder))
              : null,
        contactsCount: Math.max(0, Number(x.contactsCount ?? 0) || 0),
      }))
      .filter((x) => x.stageUuid.length > 0 && x.stageName.length > 0 && x.contactsCount > 0),
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
  analyticsAbortController?.abort();
  const controller = new AbortController();
  analyticsAbortController = controller;
  try {
    const q = new URLSearchParams({
      projectId,
      dateFrom: from,
      dateTo: to,
      groupBy: analyticsGroupBy.value,
    });
    const r = await fetch(`/api/project-analytics?${q.toString()}`, {
      signal: controller.signal,
    });
    const data = (await r.json()) as {
      flows?: Record<string, unknown>[];
      pipelineStages?: Record<string, unknown>[];
      warnings?: string[];
      error?: string;
      projectTotals?: FlowFunnelProjectTotalsPayload;
      comparison?: FlowFunnelComparisonPayload | null;
    };
    if (!r.ok) {
      loadError.value = data.error ?? "Failed to load analytics";
      flows.value = [];
      availablePipelineStages.value = [];
      funnelProjectTotals.value = null;
      funnelComparison.value = null;
      return;
    }
    flows.value = (data.flows ?? []).map((row) => normalizeFlowRow(row));
    availablePipelineStages.value = (data.pipelineStages ?? [])
      .map((row) => ({
        stageUuid: String(row.stageUuid ?? ""),
        stageName: String(row.stageName ?? "").trim(),
        stageOrder:
          row.stageOrder == null || row.stageOrder === ""
            ? null
            : Number.isFinite(Number(row.stageOrder))
              ? Math.trunc(Number(row.stageOrder))
              : null,
      }))
      .filter((x) => x.stageUuid.length > 0 && x.stageName.length > 0)
      .sort((a, b) => {
        const ao = a.stageOrder ?? Number.MAX_SAFE_INTEGER;
        const bo = b.stageOrder ?? Number.MAX_SAFE_INTEGER;
        return ao - bo || a.stageName.localeCompare(b.stageName);
      });
    warnings.value = data.warnings ?? [];
    funnelProjectTotals.value = data.projectTotals ?? null;
    funnelComparison.value = data.comparison ?? null;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    loadError.value = e instanceof Error ? e.message : "Failed to load analytics";
    flows.value = [];
    availablePipelineStages.value = [];
    funnelProjectTotals.value = null;
    funnelComparison.value = null;
  } finally {
    if (analyticsAbortController === controller) {
      loading.value = false;
      analyticsAbortController = null;
    }
  }
}

function scheduleAnalyticsLoad(): void {
  if (analyticsReloadTimer != null) {
    clearTimeout(analyticsReloadTimer);
  }
  analyticsReloadTimer = setTimeout(() => {
    analyticsReloadTimer = null;
    const pid = selectedProjectId.value;
    const val = dateRange.value;
    if (!pid || !val || val.length !== 2) return;
    void loadAnalytics(pid, tsToYmdLocal(val[0]), tsToYmdLocal(val[1]));
  }, ANALYTICS_RELOAD_DEBOUNCE_MS);
}

watch(
  () => selectedProjectId.value,
  async (projectId) => {
    loadError.value = "";
    warnings.value = [];
    flows.value = [];
    availablePipelineStages.value = [];
    selectedPipelineStageUuids.value = [];
    pipelineStagePositions.value = {};
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
    const pid = selectedProjectId.value;
    if (!pid || !val || val.length !== 2) {
      if (!val) flows.value = [];
      return;
    }
    scheduleAnalyticsLoad();
  },
  { deep: true }
);

watch(analyticsGroupBy, () => {
  const pid = selectedProjectId.value;
  const val = dateRange.value;
  if (!pid || !val || val.length !== 2) return;
  scheduleAnalyticsLoad();
});

watch(statsWindowDays, (wd) => {
  const n = Number(wd);
  if (!Number.isFinite(n) || n < 1) return;
  const dr = defaultRangeForWindow(analyticsDatesAsc.value, n);
  if (dr) {
    dateRange.value = dr;
  }
});

onBeforeUnmount(() => {
  if (analyticsReloadTimer != null) {
    clearTimeout(analyticsReloadTimer);
    analyticsReloadTimer = null;
  }
  analyticsAbortController?.abort();
  dailyAbortController?.abort();
});
</script>

<template>
  <div class="flow-dash">
    <NAlert v-if="!selectedProjectId" type="info" title="Select a project" class="flow-dash__alert">
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

        <NTabs v-model:value="analyticsMainTab" type="segment" size="medium" class="flow-dash__main-tabs">
          <NTabPane name="rankings" tab="Top & least">
            <FlowAnalyticsRankingsPanel
              :project-id="selectedProjectId"
              v-model:date-range="dateRange"
              v-model:stats-window-days="statsWindowDays"
              :stats-window-options="statsWindowOptions"
              :flows="flows"
              :group-entity-title="groupEntityTitle"
              :group-entity-plural="groupEntityPlural"
              :group-entity-singular="groupEntitySingular"
              :loading="loading"
              :collecting-days="collectingDays"
              :load-error="loadError"
            />
          </NTabPane>

          <NTabPane name="funnelsDaily" tab="Funnel & daily">
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
                <EntityTagPicker
                  v-model:model-value="selectedFlowUuids"
                  :items="flowPickerItems"
                  :title="`${groupEntityTitle} (charts & matrix)`"
                  :loading="loading"
                  :badge-limit="25"
                />
              </div>
            </NCard>

            <template v-if="!loadError && flows.length === 0 && !loading && !collectingDays">
              <NAlert type="info" :title="`No ${groupEntityPlural}`" class="flow-dash__alert">
                <span v-if="analyticsGroupBy === 'flow'">This project has no rows in <code>Flows</code>, or nothing in range.</span>
                <span v-else>No hypotheses for this project, or none linked to flows via tag contacts.</span>
              </NAlert>
            </template>

            <template v-else-if="flows.length > 0">
              <FlowAnalyticsTotalsSection
                :project-id="selectedProjectId"
                :group-entity-plural="groupEntityPlural"
                :group-entity-title="groupEntityTitle"
                :group-entity-singular="groupEntitySingular"
                :project-totals-card-title="projectTotalsCardTitle"
                :display-funnel-totals="displayFunnelTotals"
                :funnel-comparison="funnelComparison"
                :delta-sent="deltaSent"
                :delta-accepted="deltaAccepted"
                :delta-inbox="deltaInbox"
                :delta-positive="deltaPositive"
                :delta-acc-rate="deltaAccRate"
                :delta-inbox-rate="deltaInboxRate"
                :delta-positive-rate="deltaPositiveRate"
                :flows="flows"
                :selected-flow-uuids="selectedFlowUuids"
              />
              <FlowAnalyticsFunnelSection
                v-model:funnel-sankey-mode="funnelSankeyMode"
                v-model:selected-pipeline-stage-uuids="selectedPipelineStageUuids"
                v-model:pipeline-stage-positions="pipelineStagePositions"
                :funnel-sankey-mode-options="funnelSankeyModeOptions"
                :funnel-sankey-option="funnelSankeyOption"
                :pipeline-stage-options="pipelineStageOptions"
                :pipeline-stage-name-by-uuid="pipelineStageNameByUuid"
                :group-entity-plural="groupEntityPlural"
                :group-entity-singular="groupEntitySingular"
                :flows-length="flows.length"
                :selected-count="selectedFlowUuids.length"
                :chart-update-options="chartUpdateOptions"
              />
              <FlowAnalyticsDailySection
                v-model:daily-funnel-display="dailyFunnelDisplay"
                v-model:daily-rolling7-display="dailyRolling7Display"
                v-model:daily-heatmap-metric="dailyHeatmapMetric"
                :daily-error="dailyError"
                :daily-warnings="dailyWarnings"
                :daily-loading="dailyLoading"
                :daily-funnel-primary-option="dailyFunnelPrimaryOption"
                :daily-messages-sent-option="dailyMessagesSentOption"
                :daily-rates-option="dailyRatesOption"
                :daily-rolling7-option="dailyRolling7Option"
                :weekly-funnel-sankey-option="weeklyFunnelSankeyOption"
                :daily-entity-heatmap-option="dailyEntityHeatmapOption"
                :daily-merged-heatmap-option="dailyMergedHeatmapOption"
                :daily-week-wow-columns="dailyWeekWowColumns"
                :daily-week-over-week-rows="dailyWeekOverWeekRows"
                :daily-series="dailySeries"
                :daily-by-entity="dailyByEntity"
                :group-entity-plural="groupEntityPlural"
                :group-entity-singular="groupEntitySingular"
                :flows-length="flows.length"
                :selected-count="selectedFlowUuids.length"
                :chart-update-options="chartUpdateOptions"
              />
            </template>
          </NTabPane>

          <NTabPane name="geo" tab="Geo">
            <FlowAnalyticsGeoPanel :project-id="selectedProjectId" />
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
</style>

<style>
/* Layout utilities: unscoped under .flow-dash so child panels (funnel/daily/rankings) get chart heights. */
.flow-dash .flow-dash__header {
  text-align: center;
  margin-bottom: 1.75rem;
}

.flow-dash .flow-dash__title {
  font-size: 2rem;
  font-weight: 600;
  margin-bottom: 0.45rem;
}

.flow-dash .flow-dash__subtitle {
  font-weight: 400;
  font-size: 1.05rem;
  margin: 0;
  opacity: 0.85;
  max-width: 52rem;
  margin-left: auto;
  margin-right: auto;
}

.flow-dash .flow-dash__subtitle code {
  font-size: 0.88em;
}

.flow-dash .flow-dash__spin {
  margin-top: 1.25rem;
}

.flow-dash .flow-dash__main-tabs {
  margin-top: 0.5rem;
}

.flow-dash .flow-dash__main-tabs .n-tabs-nav {
  margin-bottom: 0.75rem;
}

.flow-dash .flow-dash__rank-tab-hint {
  display: block;
  font-size: 0.8125rem;
  margin: 0 0 0.65rem;
  line-height: 1.35;
}

.flow-dash .flow-dash__stats-card .n-card__content {
  padding-top: 0.75rem;
  padding-bottom: 0.85rem;
}

.flow-dash .flow-dash__stats-sub {
  display: block;
  font-size: 0.75rem;
  margin: 0 0 0.65rem;
  line-height: 1.35;
}

.flow-dash .flow-dash__stats-cols {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 1.35rem;
  align-items: flex-start;
}

.flow-dash .flow-dash__stat-col {
  flex: 1 1 140px;
  min-width: 118px;
}

.flow-dash .flow-dash__stat-col-label {
  display: block;
  font-size: 0.75rem;
  margin-bottom: 0.28rem;
}

.flow-dash .flow-dash__stat-col-value {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.55rem;
}

.flow-dash .flow-dash__stat-col-num {
  font-size: 1.2rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.flow-dash .flow-dash__filters-card .n-card__content {
  padding-top: 0.65rem;
  padding-bottom: 0.65rem;
}

.flow-dash .flow-dash__filters-block {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.flow-dash .flow-dash__filters-block--ruled {
  margin-top: 0.85rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--n-border-color);
}

.flow-dash .flow-dash__filters-block-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  min-width: 0;
}

.flow-dash .flow-dash__filters-block-body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.85rem;
}

.flow-dash .flow-dash__filters-title {
  font-size: 11px;
  opacity: 0.72;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  line-height: 1.35;
}

.flow-dash .flow-dash__filters-sub {
  font-size: 0.8125rem;
  line-height: 1.35;
  color: var(--n-text-color-3);
  font-weight: 400;
  max-width: 42rem;
}

.flow-dash .flow-dash__filters-status {
  font-size: 0.8125rem;
  margin: 0;
  flex: 0 0 auto;
}

.flow-dash .flow-dash__filters-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem 0.75rem;
  margin-bottom: 0.35rem;
}

.flow-dash .flow-dash__filters-dp {
  flex: 0 1 260px;
  min-width: 200px;
}

.flow-dash .flow-dash__filters-period {
  flex: 0 1 158px;
  min-width: 132px;
}

.flow-dash .flow-dash__filters-placeholder {
  font-size: 0.8125rem;
}

.flow-dash .flow-dash__alert {
  margin-bottom: 1rem;
}

.flow-dash .flow-dash__warn-list {
  margin: 0.25rem 0 0 1.1rem;
  padding: 0;
}

.flow-dash .flow-dash__card {
  margin-bottom: 0;
}

.flow-dash .flow-dash__card--spaced {
  margin-top: 1.75rem;
}

.flow-dash .flow-dash__hint {
  display: block;
  margin-bottom: 0.9rem;
  font-size: 0.95rem;
  line-height: 1.45;
}

.flow-dash .flow-dash__hint--tight {
  margin-bottom: 0.55rem;
  font-size: 0.8125rem;
  line-height: 1.35;
}

.flow-dash .flow-dash__sankey-toolbar {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
  margin-bottom: 0.55rem;
}

.flow-dash .flow-dash__sankey-toolbar > :first-child {
  margin-bottom: 0;
}

.flow-dash .flow-dash__sankey-mode-select {
  max-width: 340px;
}

.flow-dash .flow-dash__chart-wrap {
  position: relative;
  width: 100%;
}

.flow-dash .flow-dash__chart-tall {
  min-height: 80vh;
  height: 80vh;
}

.flow-dash .flow-dash__compare-host {
  width: 100%;
  position: relative;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid var(--n-border-color);
  box-sizing: border-box;
}

.flow-dash .flow-dash__daily-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin-bottom: 0.5rem;
}

.flow-dash .flow-dash__daily-toolbar-label {
  font-size: 0.8125rem;
  margin: 0;
}

.flow-dash .flow-dash__daily-chart-host {
  width: 100%;
  min-height: 300px;
  height: min(380px, 46vh);
  position: relative;
  box-sizing: border-box;
}

.flow-dash .flow-dash__weekly-sankey-host {
  min-height: 360px;
  height: min(500px, 54vh);
}

.flow-dash .flow-dash__heatmap-host {
  min-height: 300px;
  height: min(400px, 48vh);
}

.flow-dash .flow-dash__daily-entity-chart {
  width: 100%;
  min-height: 260px;
  height: min(320px, 38vh);
  position: relative;
  box-sizing: border-box;
}

.flow-dash .flow-dash__echart-daily {
  width: 100%;
  height: 100%;
  min-height: 280px;
  display: block;
}

.flow-dash .flow-dash__echart-daily--compact {
  min-height: 240px;
}

.flow-dash .flow-dash__daily-wow-table {
  margin-top: 0.35rem;
}

.flow-dash .flow-dash__echart-compare {
  width: 100%;
  display: block;
}

.flow-dash .flow-dash__echart-fill {
  height: 100%;
  min-height: 80vh;
}

.flow-dash .flow-dash__hint a {
  color: var(--n-primary-color);
  text-decoration: none;
}

.flow-dash .flow-dash__hint a:hover {
  text-decoration: underline;
}

.flow-dash .n-card-header {
  font-size: 1.05rem;
}

.flow-dash .n-card-header__main {
  font-size: 1.05rem;
  font-weight: 600;
}
</style>
