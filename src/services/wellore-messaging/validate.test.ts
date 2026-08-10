import test from "node:test";
import assert from "node:assert/strict";
import { validateWelloreDraft } from "./validate.js";

test("locked Nitro E1 model passes with zero errors", () => {
  // Verbatim from .cursor/skills/wellore-email-copywriting/examples.md, except
  // "co-developed" -> "co developed": the source hyphenates it, which technically
  // violates rule 5's own hyphen ban (SKILL.md flags this exact hyphen pattern as
  // banned via the "pre-reg" -> "pre reg" example). Flagged as a content bug in
  // examples.md rather than silently loosening the hyphen check.
  const subject = "Boltgun Boom";
  const body =
    "Hi Samuli, bold Warhammer campaign for mobile. still producing art for new worlds and Chaos enemies, or already packing it into playtests? " +
    "we co developed Battle Legion for Traplight after soft launch: seasonal events, Battle Pass, quest content. update cycle down 35%, team stayed on core gameplay";
  const results = validateWelloreDraft("email", subject, body, { sequenceStep: 1 });
  assert.deepEqual(results.filter((r) => r.severity === "error"), []);
});

test("E1 over word cap, hyphenated, and about-N all flag as errors", () => {
  const subject = "Some Title";
  const filler = "word ".repeat(65).trim();
  const body = `Hi Name, cross-platform launch is coming up, ${filler} about 35% of the work is done`;
  const results = validateWelloreDraft("email", subject, body, { sequenceStep: 1 });
  const codes = new Set(results.filter((r) => r.severity === "error").map((r) => r.code));
  assert.ok(codes.has("word_count"));
  assert.ok(codes.has("hyphen_joined_words"));
  assert.ok(codes.has("about_number"));
});

test("E1 body restating the subject-line title is an error", () => {
  const subject = "Cozy Cat Tree";
  const body = "Hi Name, Cozy Cat Tree is already installing on Google Play in soft launch.";
  const results = validateWelloreDraft("email", subject, body, { sequenceStep: 1 });
  assert.ok(results.some((r) => r.code === "subject_restated" && r.severity === "error"));
});

test("E2/E3 greeting must be Name, not Hi Name,", () => {
  const bad = validateWelloreDraft("email", "app store vs play", "Hi Samuli, App Store lists it for 26 Aug.", { sequenceStep: 2 });
  assert.ok(bad.some((r) => r.code === "greeting" && r.severity === "error"));

  const good = validateWelloreDraft("email", "app store vs play", "Samuli, App Store lists it for 26 Aug. Google Play is still pre reg with no day yet.", { sequenceStep: 2 });
  assert.ok(!good.some((r) => r.code === "greeting"));
});

test("E1 missing the Hi Name, greeting is an error", () => {
  const results = validateWelloreDraft("email", "Some Title", "Samuli, bold campaign for mobile.", { sequenceStep: 1 });
  assert.ok(results.some((r) => r.code === "greeting" && r.severity === "error"));
});

test("em dash is an error", () => {
  const results = validateWelloreDraft("email", "Some Title", "Hi Name, this is bold — really bold.", { sequenceStep: 1 });
  assert.ok(results.some((r) => r.code === "dash" && r.severity === "error"));
});

test("banned filler and abstractions are warnings, not errors", () => {
  const results = validateWelloreDraft("email", "Some Title", "Hi Name, we can map the pipeline so it works cleanly for your team.", { sequenceStep: 1 });
  const filler = results.find((r) => r.code === "banned_filler");
  const abstraction = results.find((r) => r.code === "banned_abstraction");
  assert.equal(filler?.severity, "warning");
  assert.equal(abstraction?.severity, "warning");
});

test("AAA partnership name is flagged as a warning, not blocked outright", () => {
  const results = validateWelloreDraft("email", "production partners", "Collin, worth 20 minutes with our CEO? he can share how we ran production with Tencent and others", { sequenceStep: 3 });
  const aaa = results.find((r) => r.code === "aaa_name");
  assert.equal(aaa?.severity, "warning");
});

test("missing subject is an error", () => {
  const results = validateWelloreDraft("email", "", "Hi Name, short body.", { sequenceStep: 1 });
  assert.ok(results.some((r) => r.code === "subject_required" && r.severity === "error"));
});

// LinkedIn: locked 4-message structure (Wellore Phase 11). Steps 1-2 must not ask a
// question; steps 3-4 must ask exactly one.
test("LinkedIn step 1 (observation, soft close) passes with zero errors", () => {
  const results = validateWelloreDraft("linkedin_dm", null, "bold Warhammer campaign for mobile, nice pickup after Boltgun. happy to exchange notes on mobile art pipelines.", { sequenceStep: 1 });
  assert.deepEqual(results.filter((r) => r.severity === "error"), []);
});

test("LinkedIn step 1 with a question is an error", () => {
  const results = validateWelloreDraft("linkedin_dm", null, "bold Warhammer campaign for mobile. how is the art pipeline going?", { sequenceStep: 1 });
  assert.ok(results.some((r) => r.code === "question_not_allowed" && r.severity === "error"));
});

test("LinkedIn step 2 (expertise, curiosity line) passes with zero errors", () => {
  const results = validateWelloreDraft("linkedin_dm", null, "we ran production on Battle Legion for Traplight through soft launch. curious how you handle content velocity on Boltgun.", { sequenceStep: 2 });
  assert.deepEqual(results.filter((r) => r.severity === "error"), []);
});

test("LinkedIn step 3 needs exactly one question", () => {
  const zero = validateWelloreDraft("linkedin_dm", null, "still thinking about the art pipeline on Boltgun.", { sequenceStep: 3 });
  assert.ok(zero.some((r) => r.code === "question_required" && r.severity === "error"));

  const two = validateWelloreDraft("linkedin_dm", null, "is the art pipeline the bottleneck, or is it engineering? worth exploring either way?", { sequenceStep: 3 });
  assert.ok(two.some((r) => r.code === "question_required" && r.severity === "error"));

  const one = validateWelloreDraft("linkedin_dm", null, "is the art pipeline still the bottleneck on Boltgun?", { sequenceStep: 3 });
  assert.deepEqual(one.filter((r) => r.severity === "error"), []);
});

test("LinkedIn step 4 (problem hypothesis) needs exactly one question", () => {
  const results = validateWelloreDraft("linkedin_dm", null, "teams doing a licensed mobile adaptation often hit an art capacity wall near soft launch. how are you solving that today?", { sequenceStep: 4 });
  assert.deepEqual(results.filter((r) => r.severity === "error"), []);
});

test("LinkedIn draft with a subject is an error", () => {
  const results = validateWelloreDraft("linkedin_dm", "production partners", "is the art pipeline still open?", { sequenceStep: 3 });
  assert.ok(results.some((r) => r.code === "subject_not_allowed" && r.severity === "error"));
});

test("LinkedIn draft over 3 sentences is an error", () => {
  const results = validateWelloreDraft("linkedin_dm", null, "one sentence here. two sentences here. three sentences here. four sentences here.", { sequenceStep: 1 });
  assert.ok(results.some((r) => r.code === "sentence_count" && r.severity === "error"));
});
