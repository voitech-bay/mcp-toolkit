import test from "node:test";
import assert from "node:assert/strict";
import { selectSentStatistics, smartleadBatchLabel } from "./smartlead-reconcile.js";
import { getSmartleadSyncConfig, summarizeCampaignSync } from "./smartlead-sync-scheduler.js";

test("batch label is the persona word at the end of the campaign name, matching the 2026-09-07 load", () => {
  assert.equal(smartleadBatchLabel({ campaignId: "3861480", campaignName: "ABM Eagle Transport Batch 1 IT" }), "smartlead-history-IT");
  assert.equal(smartleadBatchLabel({ campaignId: "3861481", campaignName: "ABM Eagle Transport Batch 1 Ops" }), "smartlead-history-Ops");
  assert.equal(smartleadBatchLabel({ campaignId: "3861482", campaignName: null }), "smartlead-history-3861482");
});

test("only dispatched rows with an id, recipient and step are kept, deduped and oldest first", () => {
  const rows = selectSentStatistics([
    { stats_id: "b", lead_email: "B@x.com", sequence_number: 2, sent_time: "2026-09-10T10:00:00Z" },
    { stats_id: "a", lead_email: "a@x.com", sequence_number: "1", sent_time: "2026-08-28T10:00:00Z" },
    { stats_id: "a", lead_email: "a@x.com", sequence_number: 1, sent_time: "2026-08-28T10:00:00Z" },
    { stats_id: "unsent", lead_email: "c@x.com", sequence_number: 1, sent_time: null },
    { stats_id: "", lead_email: "d@x.com", sequence_number: 1, sent_time: "2026-08-29T10:00:00Z" },
    { stats_id: "nostep", lead_email: "e@x.com", sequence_number: 0, sent_time: "2026-08-29T10:00:00Z" },
  ]);
  assert.deepEqual(rows.map((r) => [r.statsId, r.email, r.step]), [
    ["a", "a@x.com", 1],
    ["b", "b@x.com", 2],
  ]);
});

test("scheduler is on when the Smartlead key is present and can be switched off", () => {
  assert.equal(getSmartleadSyncConfig({}).enabled, false);
  assert.equal(getSmartleadSyncConfig({ SMARTLEAD_API_KEY: "k" }).enabled, true);
  assert.equal(getSmartleadSyncConfig({ SMARTLEAD_API_KEY: "k", SMARTLEAD_SCHEDULED_SYNC_ENABLED: "false" }).enabled, false);
  assert.equal(getSmartleadSyncConfig({ SMARTLEAD_API_KEY: "k" }).intervalMs, 60 * 60 * 1000);
  assert.equal(getSmartleadSyncConfig({ SMARTLEAD_API_KEY: "k", SMARTLEAD_SCHEDULED_SYNC_INTERVAL_MINUTES: "15" }).intervalMs, 15 * 60 * 1000);
  assert.equal(getSmartleadSyncConfig({ SMARTLEAD_API_KEY: "k", SMARTLEAD_SCHEDULED_SYNC_INTERVAL_MINUTES: "1" }).intervalMs, 60 * 60 * 1000);
});

test("cycle summary adds up across campaigns", () => {
  const totals = summarizeCampaignSync([
    { campaignId: "1", campaignName: null, leadsInCampaign: 10, statsRows: 12, sentRows: 12, inserted: 2, updated: 1, skipped: 9, contactsCreated: 1, unresolvedRecipients: [], withoutSnapshot: 3, errors: [] },
    { campaignId: "2", campaignName: null, leadsInCampaign: 5, statsRows: 4, sentRows: 4, inserted: 0, updated: 0, skipped: 4, contactsCreated: 0, unresolvedRecipients: [], withoutSnapshot: 0, errors: [{ email: "x", step: 1, error: "boom" }] },
  ]);
  assert.deepEqual(totals, { campaigns: 2, sends: 16, inserted: 2, updated: 1, skipped: 13, contactsCreated: 1, withoutSnapshot: 3, errors: 1 });
});
