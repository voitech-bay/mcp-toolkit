import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyScheduledSyncOutcome,
  getScheduledSyncConfig,
  isInsideScheduledWindow,
  localHour,
  summarizeScheduledSyncCycle,
  type CycleEntry,
} from "./getsales-sync-scheduler.js";

test("scheduler defaults to the Lisbon 08:00-20:00 window", () => {
  const config = getScheduledSyncConfig({ GETSALES_SCHEDULED_SYNC_ENABLED: "true" });
  assert.deepEqual(config, { enabled: true, timeZone: "Europe/Lisbon", startHour: 8, endHour: 20 });
});

test("scheduled window is inclusive and timezone aware", () => {
  const config = { enabled: true, timeZone: "Europe/Lisbon", startHour: 8, endHour: 20 };
  assert.equal(localHour(new Date("2026-06-30T07:00:00Z"), config.timeZone), 8);
  assert.equal(isInsideScheduledWindow(new Date("2026-06-30T07:00:00Z"), config), true);
  assert.equal(isInsideScheduledWindow(new Date("2026-06-30T19:00:00Z"), config), true);
  assert.equal(isInsideScheduledWindow(new Date("2026-06-30T20:00:00Z"), config), false);
});

test("invalid hour configuration falls back safely", () => {
  const config = getScheduledSyncConfig({
    GETSALES_SCHEDULED_SYNC_ENABLED: "yes",
    GETSALES_SCHEDULED_SYNC_START_HOUR: "-1",
    GETSALES_SCHEDULED_SYNC_END_HOUR: "25",
  });
  assert.equal(config.startHour, 8);
  assert.equal(config.endHour, 20);
});

test("hours 0 and 23 make the window always open", () => {
  // This is how 24/7 operation is configured; the window code itself stays untouched.
  const config = getScheduledSyncConfig({
    GETSALES_SCHEDULED_SYNC_ENABLED: "true",
    GETSALES_SCHEDULED_SYNC_START_HOUR: "0",
    GETSALES_SCHEDULED_SYNC_END_HOUR: "23",
  });
  assert.equal(config.startHour, 0);
  assert.equal(config.endHour, 23);
  for (const hour of [0, 3, 12, 23]) {
    const at = new Date(Date.UTC(2026, 5, 30, hour, 30));
    assert.equal(isInsideScheduledWindow(at, config), true);
  }
});

test("a lock conflict classifies as skipped, not an error", () => {
  // Otherwise every busy cycle logs as a failure and people learn to ignore the logs.
  const outcome = classifyScheduledSyncOutcome({
    error: "Sync already running (run abc, project xyz)",
  });
  assert.equal(outcome, "skipped");
});

test("outcome classification covers every branch", () => {
  assert.equal(classifyScheduledSyncOutcome({ cancelled: true }), "cancelled");
  assert.equal(classifyScheduledSyncOutcome({ error: "boom" }), "error");
  assert.equal(classifyScheduledSyncOutcome({ error: null }), "success");
  assert.equal(
    classifyScheduledSyncOutcome({ error: null, contacts: { error: "fetch failed" } }),
    "partial"
  );
  assert.equal(
    classifyScheduledSyncOutcome({ error: null, contacts: { error: null }, flows: { error: null } }),
    "success"
  );
});

test("cancelled wins over a per-entity error", () => {
  const outcome = classifyScheduledSyncOutcome({
    cancelled: true,
    contacts: { error: "fetch failed" },
  });
  assert.equal(outcome, "cancelled");
});

test("cycle summary counts each outcome", () => {
  const entries: CycleEntry[] = [
    { projectId: "1", name: "a", outcome: "success", durationMs: 10 },
    { projectId: "2", name: "b", outcome: "success", durationMs: 20 },
    { projectId: "3", name: "c", outcome: "partial", durationMs: 30 },
    { projectId: "4", name: "d", outcome: "skipped", durationMs: 1 },
    { projectId: "5", name: "e", outcome: "error", durationMs: 5 },
  ];
  assert.deepEqual(summarizeScheduledSyncCycle(entries), {
    total: 5,
    success: 2,
    partial: 1,
    skipped: 1,
    cancelled: 0,
    error: 1,
  });
});

test("cycle summary handles an empty cycle", () => {
  assert.deepEqual(summarizeScheduledSyncCycle([]), {
    total: 0,
    success: 0,
    partial: 0,
    skipped: 0,
    cancelled: 0,
    error: 0,
  });
});
