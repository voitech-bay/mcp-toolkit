import test from "node:test";
import assert from "node:assert/strict";
import { getScheduledSyncConfig, isInsideScheduledWindow, localHour } from "./getsales-sync-scheduler.js";

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
