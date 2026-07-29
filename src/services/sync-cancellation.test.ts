import test from "node:test";
import assert from "node:assert/strict";
import {
  isLocalSyncRunActive,
  listLocalSyncRunIds,
  localSyncRunAgeMs,
  registerLocalSyncRun,
  unregisterLocalSyncRun,
} from "./sync-cancellation.js";

test("local run registry tracks membership and clears on unregister", () => {
  const runId = "test-run-membership";
  assert.equal(isLocalSyncRunActive(runId), false);
  registerLocalSyncRun(runId);
  assert.equal(isLocalSyncRunActive(runId), true);
  assert.ok(listLocalSyncRunIds().includes(runId));
  unregisterLocalSyncRun(runId);
  assert.equal(isLocalSyncRunActive(runId), false);
  assert.equal(listLocalSyncRunIds().includes(runId), false);
});

test("localSyncRunAgeMs is undefined for runs this process does not own", () => {
  assert.equal(localSyncRunAgeMs("never-registered"), undefined);
});

test("localSyncRunAgeMs measures from the registration timestamp", () => {
  const runId = "test-run-age";
  registerLocalSyncRun(runId, 1000);
  try {
    assert.equal(localSyncRunAgeMs(runId, 1000), 0);
    assert.equal(localSyncRunAgeMs(runId, 61_000), 60_000);
  } finally {
    unregisterLocalSyncRun(runId);
  }
});

test("re-registering does not reset the age", () => {
  // The first timestamp is the true age; resetting it on a repeat call would let a
  // leaked registration dodge the reaper's ceiling indefinitely.
  const runId = "test-run-rereg";
  registerLocalSyncRun(runId, 1000);
  try {
    registerLocalSyncRun(runId, 500_000);
    assert.equal(localSyncRunAgeMs(runId, 1000), 0);
  } finally {
    unregisterLocalSyncRun(runId);
  }
});
