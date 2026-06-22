import assert from "node:assert/strict";
import test from "node:test";
import {
  feasibleRevenueLine,
  buildFeasibleSystemPrompt,
  feasibleViolations,
  feasibleReviewerViolations,
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

test("buildFeasibleSystemPrompt: defaults to universal conversation logic rather than a pitch", () => {
  const prompt = buildFeasibleSystemPrompt({ channel: "inmail", sender: FEASIBLE_SENDERS[2] });
  assert.match(prompt, /universal messaging agent, not a pitch generator/i);
  assert.match(prompt, /cold opener, warm follow up, reply, re engagement note/i);
  assert.match(prompt, /do not force an MSSP angle, product pitch, trial, revenue claim, or sales CTA/i);
  assert.match(prompt, /CEO needs the business reason for spending time/i);
  assert.match(prompt, /mention colleagues by name/i);
  assert.match(prompt, /prioritize relevant people at the recipient's company/i);
  assert.match(prompt, /Never write "I've been talking with"/i);
  assert.match(prompt, /Do not drop a list of names as empty social proof/i);
  assert.match(prompt, /Avoid empty lines such as "align on next steps"/i);
  assert.match(prompt, /If the reviewer says no product pitch, treat that literally/i);
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
  assert.ok(feasibleViolations("a 15-min call").includes("contains_joining_hyphen"));
  assert.ok(feasibleViolations("a call -- perhaps tomorrow").includes("contains_double_hyphen"));
  assert.ok(feasibleViolations("No tools, no setup, just results.").includes("no_no_just_pattern"));
  assert.ok(feasibleViolations("Not a tool. Not a pitch. A system.").includes("not_not_pattern"));
  assert.ok(feasibleViolations("It is important to note this.").includes("inflated_ai_phrase"));
  assert.ok(feasibleViolations("I've been talking with Miguel.").includes("unverified_personal_conversation_claim"));
  assert.ok(feasibleViolations("Our founder works with regional peers.").includes("unsupported_regional_peer_claim"));
});

test("feasibleReviewerViolations enforces an explicit no-pitch request", () => {
  const instructions = "Use the conversations and do not pitch the product.";
  assert.deepEqual(feasibleReviewerViolations("Miguel raised the delivery model. Worth discussing that with our founder?", instructions), []);
  assert.ok(
    feasibleReviewerViolations("A white label attack path platform could help.", instructions).includes(
      "product_pitch_against_instruction"
    )
  );
  assert.deepEqual(
    feasibleReviewerViolations("Other teams are trying to connect separate scan results to the decisions clients make.", instructions),
    []
  );
  assert.ok(
    feasibleReviewerViolations("Feasible could help with that.", "Build the relationship.", true).includes(
      "repeated_product_pitch_in_channel"
    )
  );
});
