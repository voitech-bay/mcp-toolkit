import test from "node:test";
import assert from "node:assert/strict";
import { verifyGetSalesCredentials } from "./source-api.js";

test("verifyGetSalesCredentials sends project Team-ID header", async () => {
  const originalFetch = globalThis.fetch;
  let seenTeamId: string | null = null;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seenTeamId = headers.get("Team-ID");
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await verifyGetSalesCredentials({
      baseUrl: "https://example.test",
      apiKey: "test-key",
      teamId: "12843",
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(seenTeamId, "12843");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
