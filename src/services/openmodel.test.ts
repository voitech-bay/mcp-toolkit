import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenModelMessageResponse } from "./openmodel.js";

test("parseOpenModelMessageResponse reads Anthropic Messages text and usage", () => {
  const parsed = parseOpenModelMessageResponse({
    id: "msg-1",
    model: "deepseek-v4-flash",
    content: [{ type: "text", text: "  hello there  " }],
    usage: { input_tokens: 123, output_tokens: 9 },
  }, "fallback-model");

  assert.deepEqual(parsed, {
    id: "msg-1",
    model: "deepseek-v4-flash",
    text: "hello there",
    inputTokens: 123,
    outputTokens: 9,
  });
});

test("parseOpenModelMessageResponse rejects responses without text", () => {
  assert.equal(parseOpenModelMessageResponse({ content: [{ type: "thinking", thinking: "x" }] }, "model"), null);
});
