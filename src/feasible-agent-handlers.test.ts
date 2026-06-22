import assert from "node:assert/strict";
import test from "node:test";
import { detectPriorCompanyChannelPitch, formatCompanyConversationContext } from "./feasible-agent-handlers.js";

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

test("detectPriorCompanyChannelPitch treats LinkedIn and InMail as one family", () => {
  const threads = [
    {
      lead_uuid: "one",
      messages: [
        { type: "outbox", channel_label: "InMail", text: "Feasible maps attack paths to critical assets." },
        { type: "outbox", channel_label: "Email", text: "Checking timing for our call." },
      ],
    },
  ];
  assert.deepEqual(detectPriorCompanyChannelPitch(threads, "linkedin"), {
    detected: true,
    matchingMessages: 1,
    channelFamily: "linkedin",
  });
  assert.deepEqual(detectPriorCompanyChannelPitch(threads, "inmail"), {
    detected: true,
    matchingMessages: 1,
    channelFamily: "linkedin",
  });
  assert.deepEqual(detectPriorCompanyChannelPitch(threads, "email"), {
    detected: false,
    matchingMessages: 0,
    channelFamily: "email",
  });
});

test("detectPriorCompanyChannelPitch ignores inbound product discussion", () => {
  const threads = [
    { lead_uuid: "one", messages: [{ type: "inbox", channel_label: "Email", text: "Can Feasible cover DAST?" }] },
  ];
  assert.equal(detectPriorCompanyChannelPitch(threads, "email").detected, false);
});
