import test from "node:test";
import assert from "node:assert/strict";
import { deriveLaunchCompletion, isFinalCompletionPush, isCompanyGrainRun, statusFor } from "./launcher-handlers.js";

const agg = (o: Partial<{ contacts_count: number; companies_count: number; succeeded_count: number; failed_count: number; latest_row_at: string | null }>) => ({
  contacts_count: 0,
  companies_count: 0,
  succeeded_count: 0,
  failed_count: 0,
  latest_row_at: new Date().toISOString(), // "fresh" so the idle-settle path doesn't trigger
  ...o,
});

test("isCompanyGrainRun: true only when company_uuids is non-empty", () => {
  assert.equal(isCompanyGrainRun({ company_uuids: ["a", "b"] }), true);
  assert.equal(isCompanyGrainRun({ company_uuids: [] }), false);
  assert.equal(isCompanyGrainRun({}), false);
  assert.equal(isCompanyGrainRun({ lead_uuids: ["x"] }), false);
});

// Company-grain (CSV company-only): progress is companies seen, not contacts.
test("statusFor: company-grain success when every company is seen", () => {
  const run = { company_uuids: ["a", "b", "c"], requested_count: 3, status: "running" };
  // 3 companies seen; contacts_count irrelevant to the decision here.
  assert.equal(statusFor(run, agg({ companies_count: 3, contacts_count: 0 })), "success");
});

test("statusFor: company-grain still running when companies incomplete and fresh", () => {
  const run = { company_uuids: ["a", "b", "c"], requested_count: 3, status: "running" };
  assert.equal(statusFor(run, agg({ companies_count: 1, contacts_count: 40 })), "running");
});

test("statusFor: company-grain partial when a company row carried an error", () => {
  const run = { company_uuids: ["a", "b"], requested_count: 2, status: "running" };
  assert.equal(statusFor(run, agg({ companies_count: 2, failed_count: 1 })), "partial");
});

// Contact-grain regression: unchanged behavior (seen = contacts_count).
test("statusFor: contact-grain unchanged (measures contacts)", () => {
  const run = { lead_uuids: ["x", "y"], requested_count: 2, status: "running" };
  assert.equal(statusFor(run, agg({ contacts_count: 2, companies_count: 1 })), "success");
  assert.equal(statusFor(run, agg({ contacts_count: 1, companies_count: 1 })), "running");
});

// Guards the reply/messaging fan-out case: only an explicit final:true may
// force-finalize a run. Omitted/false/truthy-but-not-boolean must nudge only,
// so a per-lead ping can never prematurely close a multi-lead launch.
test("isFinalCompletionPush: only explicit true is final", () => {
  assert.equal(isFinalCompletionPush({ final: true }), true);
  assert.equal(isFinalCompletionPush({}), false);
  assert.equal(isFinalCompletionPush({ final: false }), false);
  assert.equal(isFinalCompletionPush({ final: "true" }), false);
  assert.equal(isFinalCompletionPush({ final: 1 }), false);
});

// Baseline: no push body → fall back to row aggregates.
test("deriveLaunchCompletion: all leads landed clean → success", () => {
  const d = deriveLaunchCompletion({
    requested: 3,
    aggSucceeded: 3,
    aggFailed: 0,
    aggContacts: 3,
  });
  assert.deepEqual(d, { status: "success", succeeded_count: 3, failed_count: 0 });
});

test("deriveLaunchCompletion: some leads missing (seen < requested) → partial", () => {
  const d = deriveLaunchCompletion({
    requested: 3,
    aggSucceeded: 2,
    aggFailed: 1, // agg already folds the requested−seen shortfall in
    aggContacts: 2,
  });
  assert.equal(d.status, "partial");
  assert.equal(d.succeeded_count, 2);
  assert.equal(d.failed_count, 1);
});

test("deriveLaunchCompletion: nothing landed → failed", () => {
  const d = deriveLaunchCompletion({
    requested: 3,
    aggSucceeded: 0,
    aggFailed: 3,
    aggContacts: 0,
  });
  assert.equal(d.status, "failed");
});

// Explicit status wins outright, even against contradicting aggregates.
test("deriveLaunchCompletion: explicit status overrides derivation", () => {
  const d = deriveLaunchCompletion({
    requested: 3,
    aggSucceeded: 0,
    aggFailed: 3,
    aggContacts: 0,
    statusRaw: "success",
  });
  assert.equal(d.status, "success");
});

test("deriveLaunchCompletion: status aliases normalize", () => {
  assert.equal(deriveLaunchCompletion({ requested: 1, aggSucceeded: 1, aggFailed: 0, aggContacts: 1, statusRaw: "completed" }).status, "success");
  assert.equal(deriveLaunchCompletion({ requested: 1, aggSucceeded: 1, aggFailed: 0, aggContacts: 1, statusRaw: "ERROR" }).status, "failed");
  // Unknown string is ignored → derived from counts.
  assert.equal(deriveLaunchCompletion({ requested: 1, aggSucceeded: 1, aggFailed: 0, aggContacts: 1, statusRaw: "weird" }).status, "success");
});

// Per-lead results[] tally beats aggregates when no explicit counts given.
test("deriveLaunchCompletion: per-lead results tally drives counts", () => {
  const d = deriveLaunchCompletion({
    requested: 3,
    aggSucceeded: 0, // aggregates lagging / empty
    aggFailed: 3,
    aggContacts: 0,
    results: [
      { lead_uuid: "a", ok: true },
      { lead_uuid: "b", ok: true },
      { lead_uuid: "c", ok: false, error: "no domain" },
    ],
  });
  assert.equal(d.succeeded_count, 2);
  assert.equal(d.failed_count, 1);
  assert.equal(d.status, "partial"); // a failure present
});

test("deriveLaunchCompletion: results[] all ok → success", () => {
  const d = deriveLaunchCompletion({
    requested: 2,
    aggSucceeded: 0,
    aggFailed: 2,
    aggContacts: 0,
    results: [{ lead_uuid: "a", success: true }, { lead_uuid: "b" }],
  });
  assert.deepEqual(d, { status: "success", succeeded_count: 2, failed_count: 0 });
});

// Explicit counts beat both results[] and aggregates.
test("deriveLaunchCompletion: explicit counts take precedence", () => {
  const d = deriveLaunchCompletion({
    requested: 5,
    aggSucceeded: 1,
    aggFailed: 4,
    aggContacts: 1,
    results: [{ lead_uuid: "a", ok: true }],
    succeededRaw: 5,
    failedRaw: 0,
  });
  assert.deepEqual(d, { status: "success", succeeded_count: 5, failed_count: 0 });
});

test("deriveLaunchCompletion: string number counts coerce", () => {
  const d = deriveLaunchCompletion({
    requested: 4,
    aggSucceeded: 0,
    aggFailed: 4,
    aggContacts: 0,
    succeededRaw: "3",
    failedRaw: "1",
  });
  assert.equal(d.succeeded_count, 3);
  assert.equal(d.failed_count, 1);
  assert.equal(d.status, "partial");
});

// succeeded==requested but a reported failure still means partial, not success.
test("deriveLaunchCompletion: reported failure forces partial even at full success count", () => {
  const d = deriveLaunchCompletion({
    requested: 2,
    aggSucceeded: 2,
    aggFailed: 0,
    aggContacts: 2,
    failedRaw: 1,
  });
  assert.equal(d.status, "partial");
});
