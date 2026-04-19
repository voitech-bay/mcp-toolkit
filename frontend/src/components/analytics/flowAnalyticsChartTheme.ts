/** Chart colors shared by flow dashboard daily charts and the main dashboard page. */

export const FUNNEL_STAGE_COLORS_LIGHT = ["#5470c6", "#91cc75", "#fac858", "#ee6666"] as const;
export const FUNNEL_STAGE_COLORS_DARK = ["#6b8bd9", "#7fd67f", "#ffd666", "#f08080"] as const;

export const STAGE_LABELS = [
  "Connection sent",
  "Connection accepted",
  "Inbox reply",
  "Inbox positive",
] as const;

export function funnelStageColor(stageIndex: number, dark: boolean): string {
  const palette = dark ? FUNNEL_STAGE_COLORS_DARK : FUNNEL_STAGE_COLORS_LIGHT;
  return palette[stageIndex % 4]!;
}

export function chartSurfaceBg(dark: boolean): string {
  return dark ? "rgba(28, 28, 32, 0.96)" : "rgba(248, 249, 252, 0.98)";
}

export function chartTextColor(dark: boolean): string {
  return dark ? "rgba(255, 255, 255, 0.78)" : "rgba(0, 0, 0, 0.72)";
}

export function splitLineColor(dark: boolean): string {
  return dark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
}
