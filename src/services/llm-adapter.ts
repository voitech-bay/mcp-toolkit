/**
 * Pluggable LLM backends for enrichment batches (mock, Cursor Cloud, etc.).
 */

import { CursorCloudAdapter } from "./llm-adapters/cursor-cloud.js";

/** Provider-specific run metadata (e.g. Cursor agent id). */
export type LlmExecuteTrace = {
  provider: string;
  externalAgentId?: string;
  meta?: Record<string, unknown>;
};

export type LlmExecuteResult = {
  results: Map<string, Record<string, unknown>>;
  trace?: LlmExecuteTrace;
};

export interface LlmAdapter {
  name: string;
  execute(
    resolvedPrompt: string,
    entities: Array<{ id: string; data: Record<string, unknown> }>,
    options?: { signal?: AbortSignal }
  ): Promise<LlmExecuteResult>;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("Aborted"));
      },
      { once: true }
    );
  });
}

/** Simulates latency and per-entity outputs (replaces the legacy `executeAgent` stub). */
export class MockAdapter implements LlmAdapter {
  readonly name = "mock";

  async execute(
    resolvedPrompt: string,
    entities: Array<{ id: string; data: Record<string, unknown> }>,
    options?: { signal?: AbortSignal }
  ): Promise<LlmExecuteResult> {
    await delay(1000 + Math.random() * 2000, options?.signal);
    const results = new Map<string, Record<string, unknown>>();
    for (const entity of entities) {
      results.set(entity.id, {
        enriched: true,
        agent_prompt_length: resolvedPrompt.length,
        entity_name: entity.data.name ?? entity.data.domain ?? "unknown",
        processed_at: new Date().toISOString(),
      });
    }
    return {
      results,
      trace: { provider: "mock" },
    };
  }
}

/**
 * Reads `LLM_ADAPTER` (`"mock"` | `"cursor"`; default `"mock"`).
 * `"cursor"` uses {@link CursorCloudAdapter} (requires `CURSOR_API_KEY`, `CURSOR_AGENT_REPO_URL`).
 */
export function createLlmAdapter(): LlmAdapter {
  const raw = process.env.LLM_ADAPTER?.trim();
  if (raw == null || raw === "") {
    return new MockAdapter();
  }
  const mode = raw.toLowerCase();
  if (mode === "mock") {
    return new MockAdapter();
  }
  if (mode === "cursor") {
    return new CursorCloudAdapter();
  }
  throw new Error(`Invalid LLM_ADAPTER="${raw}". Expected "mock" or "cursor".`);
}
