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
