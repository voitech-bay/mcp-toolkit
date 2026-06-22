import assert from "node:assert/strict";
import test from "node:test";
import { formatCompanyConversationContext } from "./feasible-agent-handlers.js";

test("formatCompanyConversationContext includes every company contact and puts recipient first", () => {
  const result = formatCompanyConversationContext(
    [
      { lead_uuid: "colleague", messages: [{ lead_uuid: "colleague", type: "inbox", text: "We use Tenable." }] },
      { lead_uuid: "recipient", messages: [{ lead_uuid: "recipient", type: "outbox", text: "Quick question." }] },
    ],
    [
      { uuid: "recipient", name: "Ana" },
      { uuid: "colleague", name: "Ben" },
    ],
    "recipient",
    "Ana"
  );

  assert.match(result.text, /Conversation with Ana \(recipient\)/);
  assert.match(result.text, /Conversation with Ben/);
  assert.ok(result.text.indexOf("Conversation with Ana") < result.text.indexOf("Conversation with Ben"));
  assert.equal(result.threadCount, 2);
  assert.equal(result.contactCount, 2);
  assert.equal(result.truncated, false);
});

test("formatCompanyConversationContext reports the safety-cap truncation", () => {
  const result = formatCompanyConversationContext(
    [{ lead_uuid: "recipient", messages: [{ lead_uuid: "recipient", type: "inbox", text: "a long message" }] }],
    [{ uuid: "recipient", name: "Ana" }],
    "recipient",
    "Ana",
    10
  );

  assert.equal(result.threadCount, 0);
  assert.equal(result.truncated, true);
});
