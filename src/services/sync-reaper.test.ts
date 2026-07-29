import test from "node:test";
import assert from "node:assert/strict";
import {
  formatDurationMs,
  formatReaperErrorText,
  getSyncReaperConfig,
  selectStaleRunIds,
} from "./sync-reaper.js";

const NOW = new Date("2026-07-29T12:00:00Z");
const MINUTE = 60_000;

/** Default selection options: nothing is owned by this process. */
function opts(overrides?: Partial<Parameters<typeof selectStaleRunIds>[1]>) {
  return {
    now: NOW,
    staleAfterMs: 15 * MINUTE,
    localMaxMs: 240 * MINUTE,
    localAgeMs: () => undefined,
    ...overrides,
  };
}

function runStartedMinutesAgo(id: string, minutes: number) {
  return { id, started_at: new Date(NOW.getTime() - minutes * MINUTE).toISOString() };
}

test("reaper config defaults are on, with a 15m threshold", () => {
  const config = getSyncReaperConfig({});
  assert.equal(config.enabled, true);
  assert.equal(config.staleAfterMs, 900_000);
  assert.equal(config.localMaxMs, 14_400_000);
  assert.equal(config.sweepIntervalMs, 300_000);
});

test("reaper config honours the explicit kill switch", () => {
  assert.equal(getSyncReaperConfig({ SYNC_REAPER_ENABLED: "false" }).enabled, false);
  assert.equal(getSyncReaperConfig({ SYNC_REAPER_ENABLED: "0" }).enabled, false);
  assert.equal(getSyncReaperConfig({ SYNC_REAPER_ENABLED: "no" }).enabled, false);
  assert.equal(getSyncReaperConfig({ SYNC_REAPER_ENABLED: "true" }).enabled, true);
});

test("reaper config falls back on junk and below-minimum values", () => {
  const config = getSyncReaperConfig({
    SYNC_RUN_STALE_MS: "not-a-number",
    SYNC_RUN_LOCAL_MAX_MS: "1000", // below the 300000 minimum
    SYNC_REAPER_SWEEP_MS: "-5",
  });
  assert.equal(config.staleAfterMs, 900_000);
  assert.equal(config.localMaxMs, 14_400_000);
  assert.equal(config.sweepIntervalMs, 300_000);
});

test("reaper config accepts valid overrides", () => {
  const config = getSyncReaperConfig({
    SYNC_RUN_STALE_MS: "600000",
    SYNC_RUN_LOCAL_MAX_MS: "1800000",
    SYNC_REAPER_SWEEP_MS: "60000",
  });
  assert.equal(config.staleAfterMs, 600_000);
  assert.equal(config.localMaxMs, 1_800_000);
  assert.equal(config.sweepIntervalMs, 60_000);
});

test("a run older than the threshold with no local owner is reaped", () => {
  const runs = [runStartedMinutesAgo("old", 60)];
  assert.deepEqual(selectStaleRunIds(runs, opts()), ["old"]);
});

test("a run younger than the threshold is kept", () => {
  const runs = [runStartedMinutesAgo("young", 5)];
  assert.deepEqual(selectStaleRunIds(runs, opts()), []);
});

test("a long run still owned by this process is kept", () => {
  // The whole point of the local registry: a genuinely running sync must never be
  // closed underneath itself, however old its DB row looks.
  const runs = [runStartedMinutesAgo("mine", 60)];
  const selected = selectStaleRunIds(runs, opts({ localAgeMs: () => 60 * MINUTE }));
  assert.deepEqual(selected, []);
});

test("a local registration past the ceiling is reaped as leaked", () => {
  // Covers the throw-inside-catch orphan: the id never leaves localActiveSyncRuns, so
  // without this ceiling isLocalSyncRunActive would shield the row forever.
  const runs = [runStartedMinutesAgo("leaked", 600)];
  const selected = selectStaleRunIds(runs, opts({ localAgeMs: () => 300 * MINUTE }));
  assert.deepEqual(selected, ["leaked"]);
});

test("an unparseable started_at is reaped rather than wedging forever", () => {
  const runs = [{ id: "bad", started_at: "not-a-timestamp" }];
  assert.deepEqual(selectStaleRunIds(runs, opts()), ["bad"]);
});

test("selection handles an empty list", () => {
  assert.deepEqual(selectStaleRunIds([], opts()), []);
});

test("selection picks only the stale runs out of a mixed list", () => {
  const runs = [
    runStartedMinutesAgo("young", 2),
    runStartedMinutesAgo("old", 45),
    runStartedMinutesAgo("also-old", 120),
  ];
  assert.deepEqual(selectStaleRunIds(runs, opts()), ["old", "also-old"]);
});

test("duration formatting is human readable", () => {
  assert.equal(formatDurationMs(45_000), "45s");
  assert.equal(formatDurationMs(5 * MINUTE), "5m");
  assert.equal(formatDurationMs(194 * MINUTE), "3h 14m");
  assert.equal(formatDurationMs(Number.NaN), "unknown");
});

test("reaper error text is distinguishable from the manual clear message", () => {
  const text = formatReaperErrorText(8 * 60 * MINUTE, 15 * MINUTE);
  assert.match(text, /sync reaper/);
  assert.match(text, /8h 0m/);
  assert.match(text, /15m/);
  // The manual path writes "Stopped: no sync process on this server"; these must not collide.
  assert.doesNotMatch(text, /^Stopped:/);
});
