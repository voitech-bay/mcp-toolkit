import test from "node:test";
import assert from "node:assert/strict";
import { PovSchema, validateVariant } from "./outreach-agent.js";

test("POV schema rejects incomplete model output", () => {
  assert.equal(PovSchema.safeParse({ verified_signals: [] }).success, false);
});

test("InMail validator requires a subject and rejects placeholders", () => {
  const warnings = validateVariant("inmail", { subject: null, body: "Hi {{first_name}}" });
  assert.ok(warnings.includes("InMail subject is required"));
  assert.ok(warnings.includes("Contains a placeholder"));
});

test("Message validator prevents subjects, resets and multiple CTAs", () => {
  const warnings = validateVariant("message", { subject: "Hello", body: "Wanted to introduce myself. Open to a chat? Worth 15 minutes?" });
  assert.ok(warnings.includes("LinkedIn Message must not have a subject"));
  assert.ok(warnings.includes("Message contains multiple CTAs/questions"));
  assert.ok(warnings.includes("Message may reset an existing conversation"));
});
