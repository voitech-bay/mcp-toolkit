import test from "node:test";
import assert from "node:assert/strict";
import { parseTokenUsage, estimateTokenCost } from "./velvetech-billing.js";

// Pricing fixture: $1 / 1M prompt, $2 / 1M completion, cache-read 10% of prompt.
const pricing = {
  "test/model": { prompt: 1e-6, completion: 2e-6, input_cache_read: 0.1e-6, input_cache_write: 1e-6 },
};

test("parseTokenUsage: camelCase + total fallback", () => {
  const u = parseTokenUsage({ promptTokens: 1000, completionTokens: 200 });
  assert.equal(u.prompt, 1000);
  assert.equal(u.completion, 200);
  assert.equal(u.total, 1200); // derived when totalTokens missing
  assert.equal(u.cached_tokens, 0);
});

test("parseTokenUsage: snake_case + nested cached details, clamped to prompt", () => {
  const u = parseTokenUsage({ prompt_tokens: 500, completion_tokens: 50, total_tokens: 550, prompt_tokens_details: { cached_tokens: 900 } });
  assert.equal(u.prompt, 500);
  assert.equal(u.cached_tokens, 500); // clamped to prompt
});

test("estimateTokenCost: no cache -> prompt*rate + completion*rate", () => {
  const [usd, naive] = estimateTokenCost("test/model", 1_000_000, 1_000_000, pricing);
  assert.equal(usd, 3); // 1M*1e-6 + 1M*2e-6
  assert.equal(naive, 3);
});

test("estimateTokenCost: cached prompt tokens are cheaper; naive ignores cache", () => {
  // 1M prompt, half cached at 10% rate; 0 completion.
  const [usd, naive] = estimateTokenCost("test/model", 1_000_000, 0, pricing, 500_000);
  // uncached 500k*1e-6 (0.5) + cached 500k*0.1e-6 (0.05) = 0.55
  assert.equal(usd, 0.55);
  assert.equal(naive, 1); // full prompt at prompt rate
});

test("estimateTokenCost: unknown model prices to 0", () => {
  const [usd, naive] = estimateTokenCost("no/such-model", 1_000_000, 1_000_000, pricing);
  assert.equal(usd, 0);
  assert.equal(naive, 0);
});

test("estimateTokenCost: cache_write tokens billed at write rate, not prompt rate", () => {
  // 1000 prompt, 1000 cache_write, 0 cached, 0 completion. write rate == prompt rate here.
  const [usd] = estimateTokenCost("test/model", 1000, 0, pricing, 0, 1000);
  // all 1000 are cache_write -> 1000 * 1e-6 = 0.001
  assert.equal(usd, 0.001);
});
