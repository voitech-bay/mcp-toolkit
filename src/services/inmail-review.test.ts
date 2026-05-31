import assert from "node:assert/strict";
import test from "node:test";
import {
  validateInmailCopy,
  arrangeGetSalesFields,
  balancedGroups,
  splitParagraphs,
} from "./inmail-review.js";

const CLEAN_INMAIL_BODY = [
  "hi Valeria,",
  "mattilda is building financial infrastructure for schools in Latin America where institutional buyers are already searching in ChatGPT and Perplexity.",
  "if useful, i can walk you through a quick audit live on a call: Meta competitor research, Google keyword opportunities, and how mattilda.io shows up across AI search. all run live by Sprites so you see the platform working on your domain in the session.",
  "from there: how Sprites runs your paid channels and SEO from one platform, with agents reallocating budget toward pipeline.",
  "worth a look?",
  "Oliver",
].join("\n\n");

const CLEAN_FOLLOWUP_BODY = [
  "Hi Molly,",
  "beauty ecommerce on Meta and Google moves fast, and the creative already working usually has more upside.",
  "on a quick call we run Sprites on lookfantastic.com and show the top improvements: where competitors win attention in paid, the audiences with the most upside, and how you show up in AI search, yours to keep. Sprites can push the paid fixes live in your accounts if you want.",
  "worth 15 min?",
  "Oliver",
].join("\n\n");

test("validateInmailCopy: clean inmail body passes", () => {
  assert.deepEqual(
    validateInmailCopy(CLEAN_INMAIL_BODY, { kind: "inmail", subject: "mattilda - quick thought" }),
    []
  );
});

test("validateInmailCopy: clean followup body passes", () => {
  assert.deepEqual(validateInmailCopy(CLEAN_FOLLOWUP_BODY, { kind: "followup" }), []);
});

test("validateInmailCopy: flags em dash, double quote, contrast, crm, lowercase hi", () => {
  const bad = 'hi Dana,\n\nyour CRM data is leaking budget, not converting.\n\nwe can fix it — fast with "magic".\n\nworth 15 min?\n\nOliver';
  const v = validateInmailCopy(bad, { kind: "followup" });
  assert.ok(v.includes("contains_em_or_en_dash"), "em dash");
  assert.ok(v.includes("contains_double_quote"), "double quote");
  assert.ok(v.includes("contrast_not_framing"), "contrast");
  assert.ok(v.includes("crm_mention"), "crm");
  assert.ok(v.includes("lowercase_hi"), "lowercase hi");
});

test("validateInmailCopy: followup over 75 words flagged; inmail same body ok", () => {
  const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
  const body = `Hi Test,\n\n${words}`;
  assert.ok(validateInmailCopy(body, { kind: "followup" }).some((x) => x.startsWith("body_too_long")));
  assert.ok(!validateInmailCopy(body, { kind: "inmail" }).some((x) => x.startsWith("body_too_long")));
});

test("validateInmailCopy: inmail subject over 50 chars flagged", () => {
  const v = validateInmailCopy("hi x,\n\nbody here", {
    kind: "inmail",
    subject: "x".repeat(51),
  });
  assert.ok(v.some((c) => c.startsWith("subject_too_long")));
});

test("splitParagraphs: blank-line split, trims, drops empties", () => {
  assert.deepEqual(splitParagraphs("a\n\n\n b \n\n"), ["a", "b"]);
});

test("balancedGroups: fewer paragraphs than groups leaves trailing slots empty", () => {
  assert.deepEqual(balancedGroups(["a", "b"], 3), [["a"], ["b"], []]);
});

test("balancedGroups: never produces an empty middle group when n>=groups", () => {
  const g = balancedGroups(["aaaa", "b", "c", "dddd", "e"], 3);
  assert.equal(g.length, 3);
  for (const bucket of g) assert.ok(bucket.length > 0);
  // order preserved + no paragraph lost
  assert.deepEqual(g.flat(), ["aaaa", "b", "c", "dddd", "e"]);
});

test("arrangeGetSalesFields: drops greeting, fills 3 slots, builds preview", () => {
  const r = arrangeGetSalesFields({ subject: "mattilda - quick thought", body: CLEAN_INMAIL_BODY });
  assert.equal(r.droppedGreeting, "hi Valeria,");
  assert.equal(r.fields.seq_connection_hook, "mattilda - quick thought");
  assert.ok(r.fields.seq_msg1_partner_angle.length > 0);
  assert.ok(r.fields.seq_msg2a_discovery.length > 0);
  assert.ok(r.fields.seq_msg2a_positioning.length > 0);
  assert.equal(r.warning, null);
  // greeting placeholder present once; no original greeting text duplicated
  assert.ok(r.assembledPreview.startsWith("Hi {{first_name}},"));
  assert.ok(!r.assembledPreview.includes("hi Valeria,"));
  // no content lost: each non-greeting paragraph appears in some slot
  for (const p of splitParagraphs(CLEAN_INMAIL_BODY).slice(1)) {
    assert.ok(r.assembledPreview.includes(p), `missing paragraph: ${p.slice(0, 20)}`);
  }
});

test("arrangeGetSalesFields: empty subject warns", () => {
  const r = arrangeGetSalesFields({ subject: "", body: CLEAN_FOLLOWUP_BODY });
  assert.ok(r.warning && r.warning.includes("Subject"));
});
