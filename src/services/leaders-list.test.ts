import assert from "node:assert/strict";
import test from "node:test";
import { resolveEmailCount } from "./leaders-list.js";
import type { MessageRow } from "./account-context.js";

function message(subject: string | null, type = "outbox"): MessageRow {
  return {
    uuid: "message-1",
    lead_uuid: "lead-1",
    linkedin_conversation_uuid: "conversation-1",
    sender_profile_uuid: "sender-1",
    text: "hello",
    subject,
    type,
    status: "sent",
    sent_at: null,
    created_at: null,
    linkedin_type: "message",
  };
}

test("resolveEmailCount trusts stored zero only after marker sync", () => {
  assert.equal(resolveEmailCount(null, 0, []), null);
  assert.equal(resolveEmailCount("2026-06-18T12:00:00Z", 0, []), 0);
  assert.equal(resolveEmailCount("2026-06-18T12:00:00Z", 3, []), 3);
});

test("resolveEmailCount uses positive local email evidence before first marker sync", () => {
  assert.equal(resolveEmailCount(null, 0, [message("Email subject")]), 1);
  assert.equal(resolveEmailCount(null, 0, [message(null), message("Inbound", "inbox")]), null);
});
