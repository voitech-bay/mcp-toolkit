import assert from "node:assert/strict";
import test from "node:test";
import { buildLinkedInMessagePayload } from "./source-api.js";

const base = {
  senderProfileUuid: "sender-uuid",
  leadUuid: "lead-uuid",
  text: "hello",
};

test("LinkedIn message payload does not include InMail fields", () => {
  assert.deepEqual(buildLinkedInMessagePayload({ ...base, channel: "linkedin", subject: "ignored" }), {
    sender_profile_uuid: "sender-uuid",
    lead_uuid: "lead-uuid",
    text: "hello",
  });
});

test("InMail payload requires a subject and declares the InMail messenger type", () => {
  assert.throws(
    () => buildLinkedInMessagePayload({ ...base, channel: "inmail" }),
    /subject required for InMail/
  );
  assert.deepEqual(buildLinkedInMessagePayload({ ...base, channel: "inmail", subject: "quick thought" }), {
    sender_profile_uuid: "sender-uuid",
    lead_uuid: "lead-uuid",
    text: "hello",
    subject: "quick thought",
    linkedin_messenger_type: "inmail",
  });
});
