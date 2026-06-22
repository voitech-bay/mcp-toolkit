import assert from "node:assert/strict";
import test from "node:test";
import {
  groupMessagesIntoThreads,
  summarizeContactActivity,
  parseAccountSummaryEntry,
  messageChannelLabel,
  companyReplyContacts,
  contactConnectionStatus,
  type MessageRow,
} from "./account-context.js";

function msg(partial: Partial<MessageRow>): MessageRow {
  return {
    uuid: partial.uuid ?? Math.random().toString(36).slice(2),
    lead_uuid: partial.lead_uuid ?? "lead-1",
    linkedin_conversation_uuid: partial.linkedin_conversation_uuid ?? "conv-1",
    sender_profile_uuid: partial.sender_profile_uuid ?? "sender-1",
    text: partial.text ?? "hello",
    subject: partial.subject ?? null,
    type: partial.type ?? "outbox",
    status: partial.status ?? "sent",
    sent_at: partial.sent_at ?? null,
    created_at: partial.created_at ?? null,
    linkedin_type: partial.linkedin_type ?? null,
  };
}

test("groupMessagesIntoThreads: groups by conversation, orders messages chronologically", () => {
  const threads = groupMessagesIntoThreads([
    msg({ linkedin_conversation_uuid: "c1", sent_at: "2026-06-02T10:00:00Z", text: "second" }),
    msg({ linkedin_conversation_uuid: "c1", sent_at: "2026-06-01T10:00:00Z", text: "first" }),
    msg({ linkedin_conversation_uuid: "c2", lead_uuid: "lead-2", sent_at: "2026-06-03T10:00:00Z", text: "other" }),
  ]);
  assert.equal(threads.length, 2);
  // newest activity first: c2 (06-03) then c1 (06-02)
  assert.equal(threads[0].conversation_uuid, "c2");
  const c1 = threads[1];
  assert.equal(c1.messages[0].text, "first");
  assert.equal(c1.messages[1].text, "second");
  assert.equal(c1.last_message_text, "second");
});

test("groupMessagesIntoThreads: preserves LinkedIn subtype for connection status", () => {
  const [thread] = groupMessagesIntoThreads([
    msg({ linkedin_type: "connection_note" }),
    msg({ linkedin_type: "message" }),
  ]);
  assert.deepEqual(thread.messages.map((m) => m.linkedin_type), ["connection_note", "message"]);
});

test("groupMessagesIntoThreads: preserves and resolves the outbound sender", () => {
  const senderNames = new Map([["sender-1", "Diana Mesropyan"]]);
  const [thread] = groupMessagesIntoThreads([msg({ type: "outbox", sender_profile_uuid: "sender-1" })], {
    senderNames,
  });
  assert.equal(thread.messages[0].sender_profile_uuid, "sender-1");
  assert.equal(thread.messages[0].sender_display_name, "Diana Mesropyan");
});

test("messageChannelLabel distinguishes InMail, email, and LinkedIn", () => {
  assert.equal(messageChannelLabel({ linkedin_type: "inmail", type: "outbox", subject: "hello" }), "InMail");
  assert.equal(messageChannelLabel({ linkedin_type: null, type: "outbox", subject: "quick note" }), "Email");
  assert.equal(messageChannelLabel({ linkedin_type: "message", type: "outbox", subject: null }), "LinkedIn");
  assert.equal(messageChannelLabel({ linkedin_type: "connection_note", type: "outbox", subject: null }), "Connection request");
});

test("groupMessagesIntoThreads: reply status no_response / waiting / got_response", () => {
  const noReply = groupMessagesIntoThreads([msg({ type: "outbox" }), msg({ type: "outbox" })]);
  assert.equal(noReply[0].reply_status, "no_response");

  const got = groupMessagesIntoThreads([
    msg({ type: "outbox", sent_at: "2026-06-01T00:00:00Z" }),
    msg({ type: "inbox", sent_at: "2026-06-02T00:00:00Z" }),
  ]);
  assert.equal(got[0].reply_status, "got_response");
  assert.equal(got[0].inbox_count, 1);

  const waiting = groupMessagesIntoThreads([
    msg({ type: "inbox", sent_at: "2026-06-01T00:00:00Z" }),
    msg({ type: "outbox", sent_at: "2026-06-02T00:00:00Z" }),
  ]);
  assert.equal(waiting[0].reply_status, "waiting_for_response");
});

test("groupMessagesIntoThreads: falls back to created_at when sent_at missing, caps messages", () => {
  const rows = Array.from({ length: 60 }, (_, i) =>
    msg({ created_at: `2026-06-01T00:00:${String(i % 60).padStart(2, "0")}Z`, text: `m${i}` })
  );
  const [t] = groupMessagesIntoThreads(rows, { messagesPerThread: 10 });
  assert.equal(t.message_count, 60);
  assert.equal(t.messages.length, 10);
});

test("summarizeContactActivity: aggregates per lead with latest-thread status", () => {
  const threads = groupMessagesIntoThreads([
    msg({ linkedin_conversation_uuid: "c1", lead_uuid: "a", type: "outbox", sent_at: "2026-06-01T00:00:00Z" }),
    msg({ linkedin_conversation_uuid: "c2", lead_uuid: "a", type: "inbox", sent_at: "2026-06-05T00:00:00Z" }),
    msg({ linkedin_conversation_uuid: "c3", lead_uuid: "b", type: "outbox", sent_at: "2026-06-02T00:00:00Z" }),
  ]);
  const act = summarizeContactActivity(threads);
  const a = act.get("a")!;
  assert.equal(a.thread_count, 2);
  assert.equal(a.reply_status, "got_response"); // latest thread (c2) got a reply
  const b = act.get("b")!;
  assert.equal(b.reply_status, "no_response");
});

test("companyReplyContacts includes every contact that ever replied and orders latest first", () => {
  const roster = [
    { uuid: "a", name: "Ana", position: "CEO" },
    { uuid: "b", first_name: "Ben", last_name: "Lee", position: "CTO" },
    { uuid: "c", name: "Cara", position: "CISO" },
  ];
  const replies = companyReplyContacts(roster, [
    msg({ lead_uuid: "a", type: "inbox", sent_at: "2026-06-01T00:00:00Z" }),
    msg({ lead_uuid: "a", type: "outbox", sent_at: "2026-06-02T00:00:00Z" }),
    msg({ lead_uuid: "b", type: "inbox", sent_at: "2026-06-03T00:00:00Z" }),
    msg({ lead_uuid: "b", type: "inbox", sent_at: "2026-06-04T00:00:00Z" }),
  ]);
  assert.deepEqual(replies, [
    { uuid: "b", name: "Ben Lee", position: "CTO", inbound_count: 2, latest_reply_at: "2026-06-04T00:00:00Z" },
    { uuid: "a", name: "Ana", position: "CEO", inbound_count: 1, latest_reply_at: "2026-06-01T00:00:00Z" },
  ]);
});

test("contactConnectionStatus uses accepted, withdrawn, sent, none precedence", () => {
  const acceptedThread = groupMessagesIntoThreads([
    msg({ lead_uuid: "a", linkedin_type: "message", type: "outbox" }),
  ]);
  assert.equal(
    contactConnectionStatus({ uuid: "a", gs_connection_lost_at: "2026-06-01" }, acceptedThread),
    "accepted"
  );
  assert.equal(contactConnectionStatus({ uuid: "b", gs_connection_lost_at: "2026-06-01" }, []), "withdrawn");
  assert.equal(contactConnectionStatus({ uuid: "c", gs_connection_sent_at: "2026-06-01" }, []), "sent");
  assert.equal(contactConnectionStatus({ uuid: "d" }, []), "none");
});

test("parseAccountSummaryEntry: parses typed entries, ignores plain notes", () => {
  const entry = {
    kind: "account_summary",
    generated_at: "2026-06-07T00:00:00Z",
    message_watermark: 12,
    model: "google/gemma-4-31b-it",
    data: { account_summary: "warm", per_contact: [], suggested_next_step: "follow up" },
  };
  const parsed = parseAccountSummaryEntry({ rootContext: JSON.stringify(entry) });
  assert.ok(parsed);
  assert.equal(parsed!.message_watermark, 12);

  assert.equal(parseAccountSummaryEntry({ rootContext: "met them at SaaStr, likes Reddit ads" }), null);
  assert.equal(parseAccountSummaryEntry({ rootContext: null }), null);
  assert.equal(parseAccountSummaryEntry({ rootContext: '{"kind":"other"}' }), null);
});
