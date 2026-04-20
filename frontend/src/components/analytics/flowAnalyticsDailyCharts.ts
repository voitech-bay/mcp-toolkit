import type { EChartsOption } from "echarts";
import type { DailyMetricPoint } from "./flow-analytics-types.js";
import {
  chartSurfaceBg,
  chartTextColor,
  funnelStageColor,
  splitLineColor,
  STAGE_LABELS,
} from "./flowAnalyticsChartTheme.js";

export function mondayUtcYmd(dateYmd: string): string {
  const d = new Date(`${dateYmd}T12:00:00Z`);
  const dow = d.getUTCDay();
  const delta = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - delta);
  return d.toISOString().slice(0, 10);
}

export function rollingMean(values: number[], index: number, window: number): number {
  const start = Math.max(0, index - window + 1);
  const slice = values.slice(start, index + 1);
  if (slice.length === 0) return 0;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function makeDailyFunnelChartOption(
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
    series: [mkSeries(0, [...vals[0]]), mkSeries(1, [...vals[1]]), mkSeries(2, [...vals[2]]), mkSeries(3, [...vals[3]])],
  };
}

/** Trailing window mean of the four funnel counts (same line/stacked modes as {@link makeDailyFunnelChartOption}). */
export function makeRollingDailyFunnelChartOption(
  rows: DailyMetricPoint[],
  mode: "lines" | "stacked",
  dark: boolean,
  window = 7
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
  const sent = rows.map((r) => r.connectionSent);
  const acc = rows.map((r) => r.connectionAccepted);
  const ib = rows.map((r) => r.inbox);
  const pr = rows.map((r) => r.positiveReplies);
  const roll = (arr: number[]) => arr.map((_, i) => rollingMean(arr, i, window));
  const rolled = [roll(sent), roll(acc), roll(ib), roll(pr)] as const;
  const title =
    mode === "stacked"
      ? `${window}-day rolling average (stacked area, funnel counts)`
      : `${window}-day rolling average (lines, funnel counts)`;
  const mkSeries = (i: number, data: number[]) => {
    const base = {
      name: `${STAGE_LABELS[i]} (${window}d avg)`,
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
        stack: "rollingFunnel",
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
          const prm = p as { seriesName?: string; value?: number | string };
          const v = prm.value;
          const n =
            typeof v === "number" && Number.isFinite(v)
              ? Number(v.toFixed(2)).toLocaleString()
              : String(v ?? "—");
          lines.push(`${prm.seriesName ?? ""}: ${n}`);
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
      mkSeries(0, [...rolled[0]]),
      mkSeries(1, [...rolled[1]]),
      mkSeries(2, [...rolled[2]]),
      mkSeries(3, [...rolled[3]]),
    ],
  };
}

/** Daily snapshot heatmaps: pick a count or rate (% of connection sent that day). */
export type DailyHeatmapMetricId =
  | "connectionSent"
  | "connectionAccepted"
  | "inbox"
  | "positiveReplies"
  | "messagesSent"
  | "acceptedRatePct"
  | "inboxRatePct"
  | "positiveRatePct";

export const DAILY_HEATMAP_METRIC_OPTIONS: { value: DailyHeatmapMetricId; label: string }[] = [
  { value: "connectionSent", label: "Connection sent" },
  { value: "connectionAccepted", label: "Connection accepted" },
  { value: "inbox", label: "Inbox reply" },
  { value: "positiveReplies", label: "Inbox positive" },
  { value: "messagesSent", label: "Messages sent (LinkedIn)" },
  { value: "acceptedRatePct", label: "Accepted rate (% of sent)" },
  { value: "inboxRatePct", label: "Inbox rate (% of accepted)" },
  { value: "positiveRatePct", label: "Positive rate (% of inbox)" },
];

export type DailyEntitySeriesRow = {
  entityId: string;
  entityName: string;
  series: DailyMetricPoint[];
};

function dailyHeatmapMetricLabel(metric: DailyHeatmapMetricId): string {
  return DAILY_HEATMAP_METRIC_OPTIONS.find((o) => o.value === metric)?.label ?? metric;
}

function dailyHeatmapMetricValue(pt: DailyMetricPoint | undefined, metric: DailyHeatmapMetricId): number {
  if (!pt) return 0;
  switch (metric) {
    case "connectionSent":
      return pt.connectionSent;
    case "connectionAccepted":
      return pt.connectionAccepted;
    case "inbox":
      return pt.inbox;
    case "positiveReplies":
      return pt.positiveReplies;
    case "messagesSent":
      return pt.messagesSent;
    case "acceptedRatePct":
      return pt.connectionSent > 0 ? (100 * pt.connectionAccepted) / pt.connectionSent : 0;
    case "inboxRatePct":
      return pt.connectionAccepted > 0 ? (100 * pt.inbox) / pt.connectionAccepted : 0;
    case "positiveRatePct":
      return pt.inbox > 0 ? (100 * pt.positiveReplies) / pt.inbox : 0;
    default:
      return 0;
  }
}

function dailyHeatmapFormatValue(metric: DailyHeatmapMetricId, v: number): string {
  if (metric.endsWith("RatePct")) return `${Number(v.toFixed(2)).toLocaleString()}%`;
  return Number.isInteger(v) ? v.toLocaleString() : Number(v.toFixed(2)).toLocaleString();
}

const heatmapColors = (dark: boolean) =>
  dark
    ? (["#1e3a5f", "#5470c6", "#91cc75", "#fac858"] as const)
    : (["#e3f2fd", "#90caf9", "#42a5f5", "#1565c0"] as const);

/** 1–2 entities × calendar day; color = chosen metric (daily deltas). */
export function makeDailyEntityHeatmapOption(
  ents: DailyEntitySeriesRow[],
  metric: DailyHeatmapMetricId,
  dark: boolean
): EChartsOption {
  const tc = chartTextColor(dark);
  const bg = chartSurfaceBg(dark);
  const sl = splitLineColor(dark);
  if (ents.length < 1 || ents.length > 2) {
    return { animation: false, backgroundColor: bg, series: [] };
  }
  const dates = [...new Set(ents.flatMap((e) => e.series.map((s) => s.date)))].sort();
  if (dates.length === 0) return { animation: false, backgroundColor: bg, series: [] };
  const yNames = ents.map((e) => e.entityName);
  const data: [number, number, number][] = [];
  let vmax = 0;
  ents.forEach((e, yi) => {
    dates.forEach((d, xi) => {
      const pt = e.series.find((s) => s.date === d);
      const v = dailyHeatmapMetricValue(pt, metric);
      vmax = Math.max(vmax, v);
      data.push([xi, yi, v]);
    });
  });
  const metricTitle = dailyHeatmapMetricLabel(metric);
  return {
    animation: false,
    backgroundColor: bg,
    textStyle: { color: tc },
    title: {
      text: `${metricTitle} — by entity`,
      subtext: "1–2 selected entities; cell = that day’s value (same source as daily lines).",
      left: "center",
      top: 4,
      textStyle: { color: tc, fontSize: 14, fontWeight: "bold" },
      subtextStyle: { color: tc, opacity: 0.72, fontSize: 11 },
    },
    tooltip: {
      position: "top",
      formatter: (p: unknown) => {
        const d = p as { data?: [number, number, number] };
        const tri = d.data;
        if (!tri || tri.length < 3) return "";
        const xi = tri[0]!;
        const yi = tri[1]!;
        const val = tri[2]!;
        const day = dates[xi] ?? "";
        const ent = yNames[yi] ?? "";
        return `<strong>${ent}</strong><br/>${day}<br/>${metricTitle}: <strong>${dailyHeatmapFormatValue(metric, val)}</strong>`;
      },
    },
    grid: { left: 120, right: 48, top: 72, bottom: 56, containLabel: false },
    xAxis: {
      type: "category",
      data: dates.map((d) => d.slice(5)),
      splitArea: { show: false },
      axisLabel: { color: tc, fontSize: 9, rotate: dates.length > 18 ? 40 : 0 },
      axisLine: { lineStyle: { color: sl } },
    },
    yAxis: {
      type: "category",
      data: yNames,
      axisLabel: { color: tc, fontSize: 11 },
      axisLine: { lineStyle: { color: sl } },
    },
    visualMap: {
      min: 0,
      max: Math.max(1, vmax),
      calculable: true,
      orient: "vertical",
      right: 4,
      top: "middle",
      textStyle: { color: tc, fontSize: 10 },
      inRange: { color: [...heatmapColors(dark)] },
    },
    series: [
      {
        type: "heatmap",
        data,
        label: { show: dates.length <= 20, color: tc, fontSize: 9 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.25)" } },
      },
    ],
  };
}

/** Single row: merged combined selection × calendar day. */
export function makeDailyMergedHeatmapOption(
  rows: DailyMetricPoint[],
  metric: DailyHeatmapMetricId,
  dark: boolean,
  mergedRowLabel: string
): EChartsOption {
  const tc = chartTextColor(dark);
  const bg = chartSurfaceBg(dark);
  const sl = splitLineColor(dark);
  if (rows.length === 0) {
    return { animation: false, backgroundColor: bg, series: [] };
  }
  const dates = rows.map((r) => r.date);
  const yNames = [mergedRowLabel];
  const data: [number, number, number][] = [];
  let vmax = 0;
  rows.forEach((pt, xi) => {
    const v = dailyHeatmapMetricValue(pt, metric);
    vmax = Math.max(vmax, v);
    data.push([xi, 0, v]);
  });
  const metricTitle = dailyHeatmapMetricLabel(metric);
  return {
    animation: false,
    backgroundColor: bg,
    textStyle: { color: tc },
    title: {
      text: `${metricTitle} — merged selection`,
      subtext: "One row for the combined daily series (same totals as the first funnel-by-day chart).",
      left: "center",
      top: 4,
      textStyle: { color: tc, fontSize: 14, fontWeight: "bold" },
      subtextStyle: { color: tc, opacity: 0.72, fontSize: 11 },
    },
    tooltip: {
      position: "top",
      formatter: (p: unknown) => {
        const d = p as { data?: [number, number, number] };
        const tri = d.data;
        if (!tri || tri.length < 3) return "";
        const xi = tri[0]!;
        const val = tri[2]!;
        const day = dates[xi] ?? "";
        return `<strong>${day}</strong><br/>${metricTitle}: <strong>${dailyHeatmapFormatValue(metric, val)}</strong>`;
      },
    },
    grid: { left: 100, right: 48, top: 72, bottom: 56, containLabel: false },
    xAxis: {
      type: "category",
      data: dates.map((d) => d.slice(5)),
      splitArea: { show: false },
      axisLabel: { color: tc, fontSize: 9, rotate: dates.length > 18 ? 40 : 0 },
      axisLine: { lineStyle: { color: sl } },
    },
    yAxis: {
      type: "category",
      data: yNames,
      axisLabel: { color: tc, fontSize: 11 },
      axisLine: { lineStyle: { color: sl } },
    },
    visualMap: {
      min: 0,
      max: Math.max(1, vmax),
      calculable: true,
      orient: "vertical",
      right: 4,
      top: "middle",
      textStyle: { color: tc, fontSize: 10 },
      inRange: { color: [...heatmapColors(dark)] },
    },
    series: [
      {
        type: "heatmap",
        data,
        label: { show: dates.length <= 24, color: tc, fontSize: 9 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.25)" } },
      },
    ],
  };
}
