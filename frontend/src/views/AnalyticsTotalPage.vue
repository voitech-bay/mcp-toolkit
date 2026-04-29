<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { NAlert, NCard, NSelect, NSpin, NText } from "naive-ui";
import type { SelectOption } from "naive-ui";
import { useDark } from "@vueuse/core";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { CustomChart } from "echarts/charts";
import { GraphicComponent, TitleComponent, TooltipComponent } from "echarts/components";
import type { EChartsOption } from "echarts";
import VChart from "vue-echarts";
import EntityTagPicker from "../components/analytics/EntityTagPicker.vue";
import {
  FUNNEL_SANKEY_FLOW_LIMIT,
} from "../components/analytics/flow-analytics-constants.js";
import {
  chartSurfaceBg,
  chartTextColor,
  splitLineColor,
} from "../components/analytics/flowAnalyticsChartTheme.js";
import type {
  FlowFunnelRow,
  FlowPipelineStageBreakdownRow,
  FlowPipelineStageOptionRow,
  FlowTotalAnalyticsPayload,
} from "../components/analytics/flow-analytics-types.js";
import { useProjectStore } from "../stores/project";
import { trackAnalyticsEvent } from "../lib/mixpanel-tracking";

use([CanvasRenderer, CustomChart, GraphicComponent, TitleComponent, TooltipComponent]);

type TotalMode = "absolute" | "conversion";
type FlowRow = FlowFunnelRow & { pipelineStageBreakdown?: FlowPipelineStageBreakdownRow[] };
type StageRow = FlowPipelineStageBreakdownRow;
type ColOption = FlowPipelineStageOptionRow;

const GETSALES_ALLUVIAL_IDS = [
  "__gs:connectionSent",
  "__gs:connectionAccepted",
  "__gs:inbox",
  "__gs:positiveReplies",
] as const;

function sortCombinedColumnOrder(a: ColOption, b: ColOption): number {
  const aG = a.source === "pipedrive" ? 1 : 0;
  const bG = b.source === "pipedrive" ? 1 : 0;
  if (aG !== bG) return aG - bG;
  const ao = a.stageOrder ?? Number.MAX_SAFE_INTEGER;
  const bo = b.stageOrder ?? Number.MAX_SAFE_INTEGER;
  return ao - bo || a.stageName.localeCompare(b.stageName, undefined, { sensitivity: "base" });
}

function getSalesValueForKey(flow: FlowRow, id: string): number {
  switch (id) {
    case "__gs:connectionSent":
      return Math.max(0, flow.connectionSent | 0);
    case "__gs:connectionAccepted":
      return Math.max(0, flow.connectionAccepted | 0);
    case "__gs:inbox":
      return Math.max(0, flow.inbox | 0);
    case "__gs:positiveReplies":
      return Math.max(0, flow.positiveReplies | 0);
    default:
      return 0;
  }
}

const projectStore = useProjectStore();
const isDark = useDark();
const selectedProjectId = computed(() =>
  typeof projectStore.selectedProjectId === "string" && projectStore.selectedProjectId.length > 0
    ? projectStore.selectedProjectId
    : null
);

const loading = ref(false);
const loadError = ref("");
const warnings = ref<string[]>([]);
const flows = ref<FlowRow[]>([]);
const pipelineStages = ref<ColOption[]>([]);
const selectedFlowUuids = ref<string[]>([]);
/** Subset of `pipelineStages` to show in the alluvial (order follows API / order_nr). */
const selectedStageUuids = ref<string[]>([]);
const totalMode = ref<TotalMode>("absolute");
let abortController: AbortController | null = null;

const chartUpdateOptions = { notMerge: true as const };
const totalModeOptions: SelectOption[] = [
  { label: "Absolute volumes", value: "absolute" },
  { label: "Conversion (% vs first stage)", value: "conversion" },
];

const columnStageOptions = computed((): SelectOption[] =>
  pipelineStages.value.map((s) => ({
    value: s.stageUuid,
    label:
      s.source === "getsales"
        ? `GetSales: ${s.stageName}`
        : s.stageOrder != null
          ? `Pipedrive: ${s.stageName} (#${s.stageOrder})`
          : `Pipedrive: ${s.stageName}`,
  }))
);

const FLOW_TAG_EMOJIS = ["📨", "📬", "🎯", "🌊", "⚡", "🔁", "✉️", "📣"] as const;

/** Default Pipedrive stage columns (name match is normalized; order here is preference only — chart column order still follows `order_nr`). */
const DEFAULT_VISIBLE_STAGE_NAMES = [
  "Needs clarification",
  "Follow up later",
  "Interested",
  "Call scheduling",
  "Call in calendar",
] as const;

function normalizeStageNameKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[→^]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uuidsForDefaultStages(stages: StageRow[]): string[] {
  const byName = new Map<string, string>();
  for (const s of stages) {
    const k = normalizeStageNameKey(s.stageName);
    if (k && !byName.has(k)) byName.set(k, s.stageUuid);
  }
  const out: string[] = [];
  for (const raw of DEFAULT_VISIBLE_STAGE_NAMES) {
    const id = byName.get(normalizeStageNameKey(raw));
    if (id) out.push(id);
  }
  return out;
}

function asStageNameRows(stages: ColOption[]): StageRow[] {
  return stages.map((s) => ({
    stageUuid: s.stageUuid,
    stageName: s.stageName,
    stageOrder: s.stageOrder,
    contactsCount: 0,
  }));
}

function flowActivityWeight(f: FlowRow): number {
  return (f.connectionSent | 0) + (f.pipedriveDealCount ?? 0);
}

function compareFlowRows(a: FlowRow, b: FlowRow): number {
  return (
    flowActivityWeight(b) - flowActivityWeight(a) ||
    a.flowName.localeCompare(b.flowName, undefined, { sensitivity: "base" })
  );
}

const flowsSortedForPicker = computed(() => [...flows.value].sort(compareFlowRows));

const flowPickerItems = computed(() =>
  flowsSortedForPicker.value.map((f, idx) => ({
    id: f.flowUuid,
    label: `${FLOW_TAG_EMOJIS[idx % FLOW_TAG_EMOJIS.length]!} ${f.flowName}`,
    meta: ` · ${f.connectionSent.toLocaleString()} conn · ${(f.pipedriveDealCount ?? 0).toLocaleString()} deals`,
    tooltip: selectedFlowUuids.value.includes(f.flowUuid)
      ? "Remove from total alluvial."
      : "Add to total alluvial.",
  }))
);

function flowHasActivity(f: FlowRow): boolean {
  return flowActivityWeight(f) > 0 || (f.inbox | 0) > 0 || (f.positiveReplies | 0) > 0;
}

function defaultSelectedUuids(list: FlowRow[]): string[] {
  const active = list.filter((f) => flowHasActivity(f)).sort(compareFlowRows);
  return active.slice(0, Math.min(active.length, FUNNEL_SANKEY_FLOW_LIMIT)).map((f) => f.flowUuid);
}

watch(
  flows,
  (list) => {
    if (list.length === 0) {
      selectedFlowUuids.value = [];
      return;
    }
    const ids = new Set(list.map((f) => f.flowUuid));
    const kept = selectedFlowUuids.value.filter((id) => ids.has(id));
    selectedFlowUuids.value = kept.length > 0 ? kept : defaultSelectedUuids(list);
  },
  { deep: true }
);

watch(selectedFlowUuids, (selected) => {
  const projectId = selectedProjectId.value;
  if (!projectId) return;
  trackAnalyticsEvent("analytics_total_change_flows_filter", {
    projectId,
    selectedCount: selected.length,
  });
});

watch(totalMode, (mode) => {
  const projectId = selectedProjectId.value;
  if (!projectId) return;
  trackAnalyticsEvent("analytics_total_change_alluvial_mode", { projectId, mode });
});

function syncSelectedStagesFromPipeline(): void {
  const list = pipelineStages.value;
  const valid = new Set(list.map((s) => s.stageUuid));
  const kept = selectedStageUuids.value.filter((id) => valid.has(id));
  if (kept.length > 0) {
    selectedStageUuids.value = kept;
    return;
  }
  if (list.length > 0) {
    const getSalesUuids = GETSALES_ALLUVIAL_IDS.filter((id) => valid.has(id));
    const pdOnly = list.filter((s) => s.source === "pipedrive" || s.source == null);
    const preferred = uuidsForDefaultStages(asStageNameRows(pdOnly));
    const pdIds = preferred.length > 0 ? preferred : pdOnly.map((s) => s.stageUuid);
    selectedStageUuids.value = [...getSalesUuids, ...pdIds];
  } else {
    selectedStageUuids.value = [];
  }
}

watch(pipelineStages, () => {
  syncSelectedStagesFromPipeline();
});

watch(selectedStageUuids, (ids) => {
  const projectId = selectedProjectId.value;
  if (!projectId) return;
  trackAnalyticsEvent("analytics_total_change_pipedrive_stages", {
    projectId,
    selectedCount: ids.length,
  });
});

function normalizeStage(raw: Record<string, unknown>): StageRow {
  return {
    stageUuid: String(raw.stageUuid ?? ""),
    stageName: String(raw.stageName ?? "").trim(),
    stageOrder:
      raw.stageOrder == null || raw.stageOrder === ""
        ? null
        : Number.isFinite(Number(raw.stageOrder))
          ? Math.trunc(Number(raw.stageOrder))
          : null,
    contactsCount: Math.max(0, Number(raw.contactsCount ?? 0) || 0),
  };
}

function normalizeColOptionFromApi(raw: Record<string, unknown>): ColOption {
  return {
    stageUuid: String(raw.stageUuid ?? ""),
    stageName: String(raw.stageName ?? "").trim(),
    stageOrder:
      raw.stageOrder == null || raw.stageOrder === ""
        ? null
        : Number.isFinite(Number(raw.stageOrder))
          ? Math.trunc(Number(raw.stageOrder))
          : null,
    source: raw.source === "getsales" || raw.source === "pipedrive" ? raw.source : undefined,
  };
}

function normalizeFlowRow(raw: Record<string, unknown>): FlowRow {
  const stages = Array.isArray(raw.pipelineStageBreakdown)
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
    connectionRequestRatePct: raw.connectionRequestRatePct == null ? null : Number(raw.connectionRequestRatePct),
    acceptedRatePct: raw.acceptedRatePct == null ? null : Number(raw.acceptedRatePct),
    inboxRatePct: raw.inboxRatePct == null ? null : Number(raw.inboxRatePct),
    positiveRatePct: raw.positiveRatePct == null ? null : Number(raw.positiveRatePct),
    pipedriveDealCount: Number(raw.pipedriveDealCount ?? 0) || 0,
    pipelineStageBreakdown: stages
      .map(normalizeStage)
      .filter((s) => s.stageUuid.length > 0 && s.stageName.length > 0 && s.contactsCount > 0),
  };
}

async function loadTotalAnalytics(projectId: string): Promise<void> {
  loading.value = true;
  loadError.value = "";
  warnings.value = [];
  abortController?.abort();
  const controller = new AbortController();
  abortController = controller;
  try {
    const r = await fetch(`/api/project-analytics-total?projectId=${encodeURIComponent(projectId)}`, {
      signal: controller.signal,
    });
    const data = (await r.json()) as FlowTotalAnalyticsPayload;
    if (!r.ok) {
      loadError.value = data.error ?? "Failed to load total analytics";
      flows.value = [];
      pipelineStages.value = [];
      warnings.value = data.warnings ?? [];
      return;
    }
    flows.value = (data.flows ?? []).map((row) => normalizeFlowRow(row as unknown as Record<string, unknown>));
    pipelineStages.value = (data.pipelineStages ?? [])
      .map((row) => normalizeColOptionFromApi(row as unknown as Record<string, unknown>))
      .filter((s) => s.stageUuid.length > 0 && s.stageName.length > 0)
      .sort(sortCombinedColumnOrder);
    warnings.value = data.warnings ?? [];
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    loadError.value = e instanceof Error ? e.message : "Failed to load total analytics";
    flows.value = [];
    pipelineStages.value = [];
  } finally {
    if (abortController === controller) {
      loading.value = false;
      abortController = null;
    }
  }
}

watch(
  selectedProjectId,
  (projectId) => {
    loadError.value = "";
    warnings.value = [];
    flows.value = [];
    pipelineStages.value = [];
    selectedFlowUuids.value = [];
    selectedStageUuids.value = [];
    if (projectId) void loadTotalAnalytics(projectId);
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  abortController?.abort();
});

const filteredFlows = computed(() => {
  const selected = new Set(selectedFlowUuids.value);
  return flows.value.filter((f) => selected.has(f.flowUuid));
});

type Bucket = {
  key: string;
  label: string;
  counts: Map<string, number>;
  total: number;
  color: string;
};

const COLORS_LIGHT = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899", "#64748b"];
const COLORS_DARK = ["#60a5fa", "#4ade80", "#fbbf24", "#f87171", "#a78bfa", "#2dd4bf", "#f472b6", "#94a3b8"];

function flowColor(index: number, dark: boolean, isOther: boolean): string {
  if (isOther) return dark ? "#8a8a8a" : "#b0b0b0";
  const palette = dark ? COLORS_DARK : COLORS_LIGHT;
  return palette[index % palette.length]!;
}

const buckets = computed((): Bucket[] => {
  const list = [...filteredFlows.value].filter((f) => flowHasActivity(f)).sort(compareFlowRows);
  const top = list.slice(0, FUNNEL_SANKEY_FLOW_LIMIT);
  const tail = list.slice(FUNNEL_SANKEY_FLOW_LIMIT);
  const toBucket = (flow: FlowRow, idx: number): Bucket => {
    const counts = new Map<string, number>();
    for (const id of GETSALES_ALLUVIAL_IDS) {
      counts.set(id, getSalesValueForKey(flow, id));
    }
    for (const row of flow.pipelineStageBreakdown ?? []) {
      counts.set(row.stageUuid, (counts.get(row.stageUuid) ?? 0) + Math.max(0, row.contactsCount | 0));
    }
    return {
      key: flow.flowUuid,
      label: flow.flowName,
      counts,
      total: [...counts.values()].reduce((s, n) => s + n, 0),
      color: flowColor(idx, isDark.value, false),
    };
  };
  const out = top.map(toBucket);
  if (tail.length > 0) {
    const counts = new Map<string, number>();
    for (const flow of tail) {
      for (const id of GETSALES_ALLUVIAL_IDS) {
        counts.set(id, (counts.get(id) ?? 0) + getSalesValueForKey(flow, id));
      }
      for (const row of flow.pipelineStageBreakdown ?? []) {
        counts.set(row.stageUuid, (counts.get(row.stageUuid) ?? 0) + Math.max(0, row.contactsCount | 0));
      }
    }
    out.push({
      key: "__other__",
      label: `Other (${tail.length} flows)`,
      counts,
      total: [...counts.values()].reduce((s, n) => s + n, 0),
      color: flowColor(out.length, isDark.value, true),
    });
  }
  return out.filter((b) => b.total > 0);
});

type Slot = {
  stageIndex: number;
  stageUuid: string;
  stageName: string;
  label: string;
  raw: number;
  pct: number;
  conversionPct: number | null;
  y0: number;
  y1: number;
  color: string;
  /** GetSales: LinkedIn lifetime snapshot; Pipedrive: cumulative deal counts by `order_nr`. */
  isGetsales: boolean;
};

type Ribbon = {
  sourceStageIndex: number;
  targetStageIndex: number;
  sourceY0: number;
  sourceY1: number;
  targetY0: number;
  targetY1: number;
  raw: number;
  color: string;
  sourceStageName: string;
  targetStageName: string;
  label: string;
  targetIsGetsales: boolean;
};

function makeTotalAlluvialOption(): EChartsOption {
  const dark = isDark.value;
  const tc = chartTextColor(dark);
  const bg = chartSurfaceBg(dark);
  const pick = new Set(selectedStageUuids.value);
  const stages = pipelineStages.value
    .filter((stage) => pick.has(stage.stageUuid))
    .sort(sortCombinedColumnOrder);
  if (buckets.value.length === 0 || stages.length === 0) {
    return { animation: false, backgroundColor: bg, series: [] };
  }

  const slotsByStage: Slot[][] = stages.map((stage, stageIndex) => {
    const total = buckets.value.reduce((sum, b) => sum + (b.counts.get(stage.stageUuid) ?? 0), 0);
    let y = 0;
    return buckets.value
      .map((bucket) => {
        const raw = bucket.counts.get(stage.stageUuid) ?? 0;
        if (raw <= 0 || total <= 0) return null;
        const pct = raw / total;
        const firstStageRaw = bucket.counts.get(stages[0]!.stageUuid) ?? 0;
        const conversionPct = firstStageRaw > 0 ? (100 * raw) / firstStageRaw : null;
        const slot: Slot = {
          stageIndex,
          stageUuid: stage.stageUuid,
          stageName: stage.stageName,
          label: bucket.label,
          raw,
          pct,
          conversionPct,
          y0: y,
          y1: Math.min(1, y + pct),
          color: bucket.color,
          isGetsales: stage.source === "getsales" || (stage.source == null && stage.stageUuid.startsWith("__gs:")),
        };
        y = slot.y1;
        return slot;
      })
      .filter((slot): slot is Slot => slot != null);
  });

  const slotIndex = new Map<string, Slot>();
  slotsByStage.forEach((stageSlots) => {
    for (const slot of stageSlots) slotIndex.set(`${slot.stageUuid}:${slot.label}`, slot);
  });
  const ribbons: Ribbon[] = [];
  for (let si = 0; si < stages.length - 1; si += 1) {
    const sourceStage = stages[si]!;
    const targetStage = stages[si + 1]!;
    for (const bucket of buckets.value) {
      const source = slotIndex.get(`${sourceStage.stageUuid}:${bucket.label}`);
      const target = slotIndex.get(`${targetStage.stageUuid}:${bucket.label}`);
      if (!source || !target) continue;
      const raw = target.raw;
      if (raw <= 0) continue;
      ribbons.push({
        sourceStageIndex: si,
        targetStageIndex: si + 1,
        sourceY0: source.y0,
        sourceY1: source.y1,
        targetY0: target.y0,
        targetY1: target.y1,
        raw,
        color: bucket.color,
        sourceStageName: sourceStage.stageName,
        targetStageName: targetStage.stageName,
        label: bucket.label,
        targetIsGetsales:
          targetStage.source === "getsales" ||
          (targetStage.source == null && targetStage.stageUuid.startsWith("__gs:")),
      });
    }
  }

  const subtext =
    totalMode.value === "conversion"
      ? "GetSales: lifetime LinkedIn snapshot metrics. Pipedrive: cumulative deal counts (previous stages in same pipeline get +1). Conversion % is vs first selected column for each flow."
      : "GetSales: lifetime LinkedIn activity. Pipedrive: deal counts (cumulative by stage order in pipeline).";
  const axisHeaders = stages.map((stage, i) => {
    const last = Math.max(1, stages.length - 1);
    return {
      type: "text" as const,
      left: `${8 + (80 * i) / last}%`,
      top: 52,
      style: {
        text: stage.stageName,
        fill: tc,
        opacity: 0.88,
        font: "bold 18px sans-serif",
        textAlign: "center" as const,
      },
    };
  });
  const stratumItems = slotsByStage.flat();

  return {
    animation: false,
    backgroundColor: bg,
    textStyle: { color: tc },
    title: {
      text: "Total Funnel Alluvial",
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
        const data = (params as { data?: Record<string, unknown> } | undefined)?.data;
        if (!data) return "";
        if (data.kind === "ribbon") {
          const n = Number(data.raw ?? 0);
          const unit = data.targetIsGetsales ? "LinkedIn (volume)" : "deals";
          return `${String(data.sourceStageName)} → ${String(data.targetStageName)}<br/>${String(data.label)}<br/><strong>${n.toLocaleString()}</strong> ${unit}`;
        }
        const raw = Number(data.raw ?? 0);
        const pct = Number(data.pct ?? 0) * 100;
        const isGs = data.isGetsales === true;
        const countLabel = isGs ? "LinkedIn (lifetime)" : "Pipedrive deals (cumulative)";
        if (totalMode.value === "conversion") {
          const conv = data.conversionPct == null ? null : Number(data.conversionPct);
          return `${data.stageName} · ${data.label}<br/><strong>${conv == null ? "—" : `${Math.round(conv)}%`}</strong><br/><em>${raw.toLocaleString()} ${isGs ? "volume" : "deals"} · ${pct.toFixed(1)}% of column · ${countLabel}</em>`;
        }
        return `${data.stageName} · ${data.label}<br/><strong>${raw.toLocaleString()}</strong> ${isGs ? "volume" : "deals"}<br/><em>${pct.toFixed(1)}% of column</em>`;
      },
    },
    series: [
      {
        type: "custom",
        coordinateSystem: "none",
        data: ribbons.map((r, id) => ({ ...r, id, kind: "ribbon" })),
        z: 2,
        renderItem: (params: unknown, api: unknown) => {
          const row = ribbons[(params as { dataIndexInside?: number }).dataIndexInside ?? 0];
          if (!row) return null;
          const w = (api as { getWidth: () => number }).getWidth();
          const h = (api as { getHeight: () => number }).getHeight();
          const left = 26;
          const right = 150;
          const top = 78;
          const bottom = 18;
          const plotW = Math.max(120, w - left - right);
          const plotH = Math.max(40, h - top - bottom);
          const step = stages.length <= 1 ? 0 : plotW / (stages.length - 1);
          const barW = Math.min(50, Math.max(22, stages.length <= 1 ? 40 : step * 0.34));
          const xS = left + row.sourceStageIndex * step + barW / 2;
          const xT = left + row.targetStageIndex * step - barW / 2;
          const yS0 = top + row.sourceY0 * plotH;
          const yS1 = top + row.sourceY1 * plotH;
          const yT0 = top + row.targetY0 * plotH;
          const yT1 = top + row.targetY1 * plotH;
          const c = Math.max(10, (xT - xS) * 0.42);
          return {
            type: "path",
            shape: {
              pathData: [`M${xS},${yS0}`, `C${xS + c},${yS0} ${xT - c},${yT0} ${xT},${yT0}`, `L${xT},${yT1}`, `C${xT - c},${yT1} ${xS + c},${yS1} ${xS},${yS1}`, "Z"].join(" "),
            },
            style: { fill: row.color, opacity: 0.44 },
          };
        },
      },
      {
        type: "custom",
        coordinateSystem: "none",
        data: stratumItems.map((s, id) => ({ ...s, id, kind: "stratum" })),
        z: 4,
        renderItem: (params: unknown, api: unknown) => {
          const row = stratumItems[(params as { dataIndexInside?: number }).dataIndexInside ?? 0];
          if (!row) return null;
          const w = (api as { getWidth: () => number }).getWidth();
          const h = (api as { getHeight: () => number }).getHeight();
          const left = 26;
          const right = 150;
          const top = 78;
          const bottom = 18;
          const plotW = Math.max(120, w - left - right);
          const plotH = Math.max(40, h - top - bottom);
          const step = stages.length <= 1 ? 0 : plotW / (stages.length - 1);
          const barW = Math.min(50, Math.max(22, stages.length <= 1 ? 40 : step * 0.34));
          const x = left + row.stageIndex * step - barW / 2;
          const y = top + row.y0 * plotH;
          const hRect = Math.max(1, (row.y1 - row.y0) * plotH);
          const valueText =
            totalMode.value === "conversion"
              ? row.conversionPct == null
                ? "—"
                : `${Math.round(row.conversionPct)}%`
              : row.raw.toLocaleString();
          return {
            type: "group",
            children: [
              {
                type: "rect",
                shape: { x, y, width: barW, height: hRect },
                style: {
                  fill: row.color,
                  stroke: dark ? "rgba(255,255,255,0.55)" : "rgba(20,20,20,0.78)",
                  lineWidth: 1,
                },
              },
              ...(hRect >= 10
                ? [
                    {
                      type: "text",
                      style: {
                        x: x + barW + 4,
                        y: y + hRect / 2,
                        text: valueText,
                        fill: tc,
                        font: "bold 18px sans-serif",
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
    ] as EChartsOption["series"],
  };
}

const totalAlluvialOption = computed(() => makeTotalAlluvialOption());

void [
  NAlert,
  NCard,
  NSelect,
  NSpin,
  NText,
  VChart,
  EntityTagPicker,
  chartUpdateOptions,
  totalModeOptions,
  columnStageOptions,
  flowPickerItems,
  totalAlluvialOption,
];
</script>

<template>
  <div class="flow-dash">
    <NAlert v-if="!selectedProjectId" type="info" title="Select a project" class="flow-dash__alert">
      Choose a project in the header to load total analytics.
    </NAlert>
    <template v-else>
      <NSpin :show="loading" class="flow-dash__spin">
        <NAlert v-if="loadError" type="error" class="flow-dash__alert" :title="loadError" />
        <NAlert v-if="!loadError && warnings.length > 0" type="warning" class="flow-dash__alert" title="Notice">
          <ul class="flow-dash__warn-list">
            <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
          </ul>
        </NAlert>

        <NCard title="Filters" size="small" class="flow-dash__card flow-dash__filters-card" :bordered="true">
          <div v-if="flows.length > 0" class="flow-dash__filters-block">
            <EntityTagPicker
              v-model:model-value="selectedFlowUuids"
              :items="flowPickerItems"
              title="Flows"
              :loading="loading"
              :badge-limit="25"
            />
          </div>
          <NText v-else depth="3" class="flow-dash__filters-status">
            {{ loading ? "Loading..." : "No flows" }}
          </NText>
        </NCard>

        <NAlert v-if="!loadError && flows.length === 0 && !loading" type="info" title="No total analytics" class="flow-dash__alert flow-dash__card--spaced">
          No project flows, or the Pipedrive Campaign field could not be resolved.
        </NAlert>

        <NAlert v-else-if="selectedFlowUuids.length === 0" type="info" title="No flows selected" class="flow-dash__alert flow-dash__card--spaced">
          Select at least one flow tag to render the alluvial chart.
        </NAlert>

        <NCard v-else title="Funnel Alluvial" size="small" class="flow-dash__card flow-dash__card--spaced">
          <div class="flow-dash__sankey-toolbar">
            <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
              GetSales first (lifetime from AnalyticsSnapshots), then Pipedrive. Deal counts are cumulative by <code>order_nr</code> in each
              Pipedrive pipeline. Columns sort left-to-right: GetSales → Pipedrive.
            </NText>
            <NSelect
              v-model:value="totalMode"
              :options="totalModeOptions"
              size="small"
              class="flow-dash__sankey-mode-select"
            />
            <NSelect
              v-model:value="selectedStageUuids"
              :options="columnStageOptions"
              multiple
              filterable
              clearable
              :disabled="pipelineStages.length === 0"
              placeholder="GetSales + Pipedrive columns"
              size="small"
              class="flow-dash__sankey-stage-select"
            />
          </div>
          <div class="flow-dash__compare-host flow-dash__chart-tall">
            <VChart
              class="flow-dash__echart-compare flow-dash__echart-fill"
              :option="totalAlluvialOption"
              :update-options="chartUpdateOptions"
              :autoresize="{ throttle: 200 }"
            />
          </div>
        </NCard>
      </NSpin>
    </template>
  </div>
</template>

<style>
.flow-dash {
  width: 100%;
  max-width: min(1720px, 96vw);
  margin: 0 auto;
  box-sizing: border-box;
}

.flow-dash .flow-dash__spin {
  margin-top: 1.25rem;
}

.flow-dash .flow-dash__alert {
  margin-bottom: 1rem;
}

.flow-dash .flow-dash__warn-list {
  margin: 0.25rem 0 0 1.1rem;
  padding: 0;
}

.flow-dash .flow-dash__card--spaced {
  margin-top: 1.75rem;
}

.flow-dash .flow-dash__filters-card .n-card__content {
  padding-top: 0.65rem;
  padding-bottom: 0.65rem;
}

.flow-dash .flow-dash__filters-status {
  font-size: 0.8125rem;
  margin: 0;
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

.flow-dash .flow-dash__sankey-mode-select {
  max-width: 280px;
}

.flow-dash .flow-dash__sankey-stage-select {
  max-width: 100%;
  min-width: min(100%, 420px);
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

.flow-dash .flow-dash__echart-compare {
  width: 100%;
  display: block;
}

.flow-dash .flow-dash__echart-fill {
  height: 100%;
  min-height: 80vh;
}
</style>
