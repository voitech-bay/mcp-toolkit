import assert from "node:assert/strict";
import test from "node:test";
import {
  feasibleRevenueLine,
  buildFeasibleSystemPrompt,
  feasibleViolations,
  senderForUuid,
  FEASIBLE_SENDERS,
} from "./feasible-context.js";

test("feasibleRevenueLine: employee-count buckets, null when unknown", () => {
  assert.equal(feasibleRevenueLine(null), null);
  assert.equal(feasibleRevenueLine(0), null);
  assert.match(feasibleRevenueLine(10)!, /\$20k/);
  assert.match(feasibleRevenueLine(35)!, /\$30k/);
  assert.match(feasibleRevenueLine(55)!, /\$40k/);
  assert.match(feasibleRevenueLine(80)!, /\$50k/);
  assert.match(feasibleRevenueLine(150)!, /\$60k/);
  assert.match(feasibleRevenueLine(500)!, /\$70k/);
  assert.match(feasibleRevenueLine(35)!, /new recurring revenue/);
});

test("senderForUuid resolves Feasible personas, null otherwise", () => {
  const paul = senderForUuid("585db700-6175-43ed-907d-5238b0997872");
  assert.equal(paul?.signature, "Paul");
  assert.equal(senderForUuid("00000000-0000-0000-0000-000000000000"), null);
  assert.equal(FEASIBLE_SENDERS.length, 5);
});

test("buildFeasibleSystemPrompt: includes persona signature, $ only when angle allows", () => {
  const sender = FEASIBLE_SENDERS[1]; // Emil
  const productize = buildFeasibleSystemPrompt({ channel: "linkedin", sender, angle: "productize", revenueLine: feasibleRevenueLine(50) });
  assert.match(productize, /Sign as "Emil"/);
  assert.match(productize, /\$ revenue line is allowed/);
  assert.match(productize, /\$40k/);

  const winRate = buildFeasibleSystemPrompt({ channel: "linkedin", sender, angle: "win_rate", revenueLine: null });
  assert.match(winRate, /Do NOT include a \$ figure/);
});

test("buildFeasibleSystemPrompt: channel format guidance differs", () => {
  const s = FEASIBLE_SENDERS[0];
  assert.match(buildFeasibleSystemPrompt({ channel: "inmail", sender: s }), /InMail/);
  assert.match(buildFeasibleSystemPrompt({ channel: "email", sender: s }), /cold or warm email/);
  assert.match(buildFeasibleSystemPrompt({ channel: "linkedin", sender: s }), /LinkedIn direct message/);
  assert.match(buildFeasibleSystemPrompt({ channel: "linkedin", sender: s }), /30-40 words/);
  assert.match(buildFeasibleSystemPrompt({ channel: "email", sender: s }), /Hard maximum: 70 body words/);
  assert.match(buildFeasibleSystemPrompt({ channel: "inmail", sender: s }), /slightly rough|little clunky/);
});

test("feasibleViolations: flags the hard bans", () => {
  assert.deepEqual(feasibleViolations("you grow, so you hire. Interested in an intro meeting? Paul"), []);
  const bad = "Feasible solves that — and already validated paths, not separate tools, with great margin.";
  const v = feasibleViolations(bad);
  assert.ok(v.includes("contains_em_or_en_dash"));
  assert.ok(v.includes("presumptive_claim"));
  assert.ok(v.includes("uses_already"));
  assert.ok(v.includes("validated_paths"));
  assert.ok(v.includes("trailing_contrast"));
  assert.ok(v.includes("money_word_not_recurring_revenue"));
  assert.ok(feasibleViolations(Array.from({ length: 71 }, () => "word").join(" ")).includes("over_70_words"));
});
