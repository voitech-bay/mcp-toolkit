import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  normalizeAnnotationRanges,
  normalizeOutreachMessageChannel,
  normalizeSequenceStep,
  parseEmailStudioChannelFilter,
  reanchorQuote,
  validateDraft,
} from "./email-studio.js";

test("sent can only be reached by Smartlead", () => {
  assert.equal(canTransition("approved", "sent", "user"), false);
  assert.equal(canTransition("approved", "sent", "smartlead"), true);
  assert.equal(canTransition("needs_review", "approved", "user"), false);
});

test("review lifecycle permits the intended happy path", () => {
  const path = ["research_ready", "ai_draft_made", "needs_review", "comments_made", "regenerated", "final_check", "approved"] as const;
  for (let i = 0; i < path.length - 1; i++) assert.equal(canTransition(path[i], path[i + 1], i === 0 ? "agent" : "user"), true);
  assert.equal(canTransition("approved", "sent", "smartlead"), true);
  assert.equal(canTransition("sent", "needs_review", "user"), false);
});

test("validation detects placeholders and invalid evidence annotations", () => {
  const body = "Hello {{first_name}}, are you open to this? Another question?";
  const results = validateDraft("quick question", body, [{
    id: "a1", text: "Hello", start: 0, end: 5, purpose: "opener",
    research_point_ids: [], instruction_ids: [], explanation: "Uses a greeting.",
    classification: "verified", confidence: "high", warnings: [],
  }]);
  assert.deepEqual(new Set(results.map((r) => r.code)), new Set(["question_count", "placeholder", "unsupported_fact"]));
});

test("comments re-anchor uniquely and use context for duplicates", () => {
  assert.deepEqual(reanchorQuote("alpha beta gamma", "beta", 0), { start: 6, end: 10 });
  assert.deepEqual(reanchorQuote("one x one y", "one", 7, "", " y"), { start: 6, end: 9 });
  assert.equal(reanchorQuote("rewritten", "missing", 0), null);
});

test("annotation ranges are normalized and unknown references are rejected", () => {
  const body = "A verified signal.";
  const normalized = normalizeAnnotationRanges(body, [{
    id: "a", text: "verified signal", start: 0, end: 2, purpose: "proof",
    research_point_ids: ["missing"], instruction_ids: [], explanation: "Uses evidence.",
    classification: "verified" as const, confidence: "high" as const, warnings: [],
  }]);
  assert.deepEqual({ start: normalized[0].start, end: normalized[0].end }, { start: 2, end: 17 });
  assert.ok(validateDraft("subject", body, normalized, new Set(["known"])).some((x) => x.code === "unknown_research"));
});

test("message channel helpers default old Email Studio views to email only", () => {
  assert.equal(normalizeOutreachMessageChannel("inmail"), "linkedin_inmail");
  assert.equal(normalizeOutreachMessageChannel("linkedin_dm"), "linkedin_dm");
  assert.equal(normalizeOutreachMessageChannel("bogus"), "email");
  assert.deepEqual(parseEmailStudioChannelFilter(null), ["email"]);
  assert.deepEqual(parseEmailStudioChannelFilter("linkedin_dm, inmail"), ["linkedin_dm", "linkedin_inmail"]);
  assert.deepEqual(parseEmailStudioChannelFilter("all"), ["email", "linkedin_dm", "linkedin_inmail", "reply"]);
});

test("sequence step helper accepts InMail fallback step zero", () => {
  assert.equal(normalizeSequenceStep(0), 0);
  assert.equal(normalizeSequenceStep("3"), 3);
  assert.equal(normalizeSequenceStep("bad"), 1);
});
