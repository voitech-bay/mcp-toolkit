import assert from "node:assert/strict";
import { test } from "node:test";
import { instantlyStepNumber } from "./instantly.js";

test("Instantly step codes map zero-based step indexes to studio steps", () => {
  assert.equal(instantlyStepNumber("0_0_0"), 1);
  assert.equal(instantlyStepNumber("0_1_0"), 2);
  assert.equal(instantlyStepNumber("0_2_3"), 3);
});

test("missing or malformed Instantly step codes safely map to first touch", () => {
  assert.equal(instantlyStepNumber(undefined), 1);
  assert.equal(instantlyStepNumber(""), 1);
  assert.equal(instantlyStepNumber("unexpected"), 1);
});
