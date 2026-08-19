import test from "node:test";
import assert from "node:assert/strict";
import {
  instantlyWebhookKind,
  instantlyWebhookNeedsContact,
  isInstantlyWebhookSecretValid,
  parseInstantlyWebhookPayload,
} from "./instantly-webhook.js";
import { canTransition } from "./email-studio.js";
import { getSalesWebhookSkipReason } from "./getsales-conversation-sync.js";

test("Instantly webhook secret validation fails closed", () => {
  assert.equal(isInstantlyWebhookSecretValid(undefined, "expected"), false);
  assert.equal(isInstantlyWebhookSecretValid("expected", undefined), false);
  assert.equal(isInstantlyWebhookSecretValid("wrong", "expected"), false);
  assert.equal(isInstantlyWebhookSecretValid("expected", "expected"), true);
});

test("Instantly sent payload maps step, recipient, and event id", () => {
  const parsed = parseInstantlyWebhookPayload({
    event_type: "email_sent",
    campaign_id: "e2e2652e-ef0a-4562-bc94-ec4e50e7d5f8",
    lead_id: "lead-1",
    message_id: "msg-9",
    to_address_email_list: "yaroslav@cas.ai",
    step: "0_1_0",
    timestamp: "2026-08-07T07:13:51.000Z",
  });
  assert.equal(parsed.kind, "sent");
  assert.equal(parsed.step, 2);
  assert.equal(parsed.recipientEmail, "yaroslav@cas.ai");
  assert.equal(parsed.eventId, "email_sent:msg-9:e2e2652e-ef0a-4562-bc94-ec4e50e7d5f8:lead-1:yaroslav@cas.ai:2:2026-08-07T07:13:51.000Z");
  assert.equal(instantlyWebhookNeedsContact(parsed), true);
});

test("warmup Instantly payload with no identity is skipped", () => {
  const parsed = parseInstantlyWebhookPayload({ event_type: "reply_received" });
  assert.equal(parsed.kind, "reply");
  assert.equal(instantlyWebhookNeedsContact(parsed), false);
});

test("Instantly reply payload keeps body text", () => {
  const parsed = parseInstantlyWebhookPayload({
    event_type: "reply_received",
    email: "prospect@studio.com",
    reply: { text: "thanks, let's talk", subject: "re: catalog" },
    campaign_id: "camp-1",
    event_id: "evt-1",
  });
  assert.equal(parsed.kind, "reply");
  assert.equal(parsed.replyText, "thanks, let's talk");
  assert.equal(parsed.eventId, "evt-1");
  assert.equal(instantlyWebhookKind("REPLY_RECEIVED"), "reply");
});

test("idempotent Instantly event ids stay stable for the same payload", () => {
  const body = {
    event_type: "email_sent",
    message_id: "same",
    campaign_id: "c1",
    lead_id: "l1",
    email: "a@b.com",
    step: "0_0_0",
    timestamp: "2026-08-19T00:00:00.000Z",
  };
  assert.equal(parseInstantlyWebhookPayload(body).eventId, parseInstantlyWebhookPayload(body).eventId);
});

test("sent can be reached by Instantly import as well as Smartlead", () => {
  assert.equal(canTransition("approved", "sent", "user"), false);
  assert.equal(canTransition("approved", "sent", "smartlead"), true);
  assert.equal(canTransition("approved", "sent", "instantly"), true);
  assert.equal(canTransition("approved", "sent", "import"), true);
  assert.equal(canTransition("sent", "sending_failed", "import"), true);
});

test("GetSales webhook skips warmup when the lead is missing from Contacts", () => {
  assert.equal(getSalesWebhookSkipReason(null, false), "No lead uuid found in event payload");
  assert.equal(getSalesWebhookSkipReason("lead-1", false), "Lead is not a Contacts row in this project");
  assert.equal(getSalesWebhookSkipReason("lead-1", true), null);
});
