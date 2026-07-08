import test from "node:test";
import assert from "node:assert/strict";
import { extractWebhookLeadUuid, isGetSalesWebhookSecretValid } from "./getsales-conversation-sync.js";

test("webhook secret validation fails closed", () => {
  assert.equal(isGetSalesWebhookSecretValid(undefined, "expected"), false);
  assert.equal(isGetSalesWebhookSecretValid("expected", undefined), false);
  assert.equal(isGetSalesWebhookSecretValid("wrong", "expected"), false);
  assert.equal(isGetSalesWebhookSecretValid("expected", "expected"), true);
});

test("extractWebhookLeadUuid supports GetSales payload variants", () => {
  assert.equal(extractWebhookLeadUuid({ lead_uuid: "lead-1" }), "lead-1");
  assert.equal(extractWebhookLeadUuid({ contact: { uuid: "lead-2" } }), "lead-2");
  assert.equal(extractWebhookLeadUuid({ data: { lead: { uuid: "lead-3" } } }), "lead-3");
  assert.equal(extractWebhookLeadUuid({ event: "linkedin_reply" }), null);
});
