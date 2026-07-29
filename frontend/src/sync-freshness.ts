/**
 * How stale is a project's synced data?
 *
 * Age is measured from the last run that reached a terminal state, not the last
 * successful one: the DB folds `partial` into `error`, so keying age off success alone
 * would leave a project with one chronically failing entity permanently red and train
 * everyone to ignore the indicator. Status is surfaced separately.
 */
export type FreshnessLevel = "fresh" | "stale" | "critical" | "unknown";

/** Two missed hourly cycles is noise; beyond that something is likely wrong. */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const CRITICAL_AFTER_MS = 6 * 60 * 60 * 1000;

export function formatAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours < 24) return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  const remainderHours = hours % 24;
  return remainderHours > 0 ? `${days}d ${remainderHours}h ago` : `${days}d ago`;
}

export interface Freshness {
  level: FreshnessLevel;
  ageMs: number | null;
  label: string;
}

export function syncFreshness(
  lastCompletedAtIso: string | null | undefined,
  now: Date = new Date(),
  opts?: { staleAfterMs?: number; criticalAfterMs?: number }
): Freshness {
  if (!lastCompletedAtIso) return { level: "unknown", ageMs: null, label: "never synced" };
  const completedMs = Date.parse(lastCompletedAtIso);
  if (!Number.isFinite(completedMs)) return { level: "unknown", ageMs: null, label: "never synced" };

  const ageMs = now.getTime() - completedMs;
  if (ageMs < 0) return { level: "fresh", ageMs: 0, label: "just now" };

  const staleAfterMs = opts?.staleAfterMs ?? STALE_AFTER_MS;
  const criticalAfterMs = opts?.criticalAfterMs ?? CRITICAL_AFTER_MS;
  const level: FreshnessLevel =
    ageMs >= criticalAfterMs ? "critical" : ageMs >= staleAfterMs ? "stale" : "fresh";
  return { level, ageMs, label: formatAgo(ageMs) };
}
