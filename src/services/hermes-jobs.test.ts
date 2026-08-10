import assert from "node:assert/strict";
import test from "node:test";
import { parseResearchMetadata } from "./hermes-jobs.js";

test("parseResearchMetadata extracts stages and unique degraded reasons", () => {
  const content = JSON.stringify({
    stages: [
      { stage: "catalog", status: "degraded", degraded_reasons: ["GP:browser_required"] },
      { stage: "score", status: "degraded", degraded_reasons: ["missing:money_signal"] },
      { stage: "validate", status: "degraded", degraded_reasons: ["GP:browser_required"] },
    ],
  });
  const value = parseResearchMetadata(content);
  assert.equal(value.stages.length, 3);
  assert.deepEqual(value.degradedReasons, [
    "GP:browser_required",
    "missing:money_signal",
  ]);
});

test("parseResearchMetadata tolerates prose", () => {
  assert.deepEqual(parseResearchMetadata("Research complete."), {
    stages: [],
    degradedReasons: [],
  });
});
