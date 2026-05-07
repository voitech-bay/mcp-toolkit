import type { ServerResponse } from "node:http";

const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const MODELS_TTL_MS = 5 * 60 * 1000;

type OpenRouterModelCache = {
  expiresAt: number;
  models: OpenRouterModelSummary[];
};

let modelsCache: OpenRouterModelCache | null = null;

type OpenRouterCacheControl = {
  type: "ephemeral";
  ttl?: "1h";
};

export interface OpenRouterModelSummary {
  id: string;
  name: string;
  contextLength: number | null;
  pricingPrompt: string | null;
  pricingCompletion: string | null;
}

export interface OpenRouterGenerateResult {
  text: string;
  model: string;
  id: string | null;
}

function getOpenRouterApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required.");
  return apiKey;
}

function getOpenRouterBaseUrl(): string {
  return (process.env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function getPromptCacheControlForModel(model: string): OpenRouterCacheControl | null {
  const enabledRaw = process.env.OPENROUTER_PROMPT_CACHE_ENABLED?.trim().toLowerCase();
  const enabled = enabledRaw === "1" || enabledRaw === "true" || enabledRaw === "yes";
  if (!enabled) return null;

  // OpenRouter docs: Anthropic routing supports top-level cache_control.
  const m = model.toLowerCase();
  const isAnthropic = m.includes("anthropic") || m.includes("claude");
  if (!isAnthropic) return null;

  const ttlRaw = process.env.OPENROUTER_PROMPT_CACHE_TTL?.trim().toLowerCase();
  if (ttlRaw === "1h") return { type: "ephemeral", ttl: "1h" };
  return { type: "ephemeral" };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function readErrorText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "No response body";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const obj = asRecord(parsed);
    if (!obj) return trimmed.slice(0, 1000);
    const errObj = asRecord(obj.error);
    if (errObj && typeof errObj.message === "string") return errObj.message;
    if (typeof obj.message === "string") return obj.message;
    return trimmed.slice(0, 1000);
  } catch {
    return trimmed.slice(0, 1000);
  }
}

function readModelSummary(raw: unknown): OpenRouterModelSummary | null {
  const row = asRecord(raw);
  if (!row || typeof row.id !== "string" || !row.id.trim()) return null;
  const pricing = asRecord(row.pricing);
  return {
    id: row.id,
    name: typeof row.name === "string" && row.name.trim() ? row.name : row.id,
    contextLength:
      typeof row.context_length === "number" && Number.isFinite(row.context_length)
        ? row.context_length
        : null,
    pricingPrompt: pricing && typeof pricing.prompt === "string" ? pricing.prompt : null,
    pricingCompletion: pricing && typeof pricing.completion === "string" ? pricing.completion : null,
  };
}

export async function listOpenRouterModels(
  options?: { signal?: AbortSignal; forceRefresh?: boolean }
): Promise<{ data: OpenRouterModelSummary[]; error: string | null }> {
  if (!options?.forceRefresh && modelsCache && modelsCache.expiresAt > Date.now()) {
    return { data: modelsCache.models, error: null };
  }
  const apiKey = getOpenRouterApiKey();
  const url = `${getOpenRouterBaseUrl()}/models`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: options?.signal,
  });
  const rawText = await res.text();
  if (!res.ok) {
    return {
      data: [],
      error: `OpenRouter model list failed: ${res.status} ${res.statusText} ${readErrorText(rawText)}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { data: [], error: "OpenRouter model list returned invalid JSON." };
  }
  const root = asRecord(parsed);
  const rows = Array.isArray(root?.data) ? root.data : [];
  const models = rows
    .map((r) => readModelSummary(r))
    .filter((r): r is OpenRouterModelSummary => r !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  modelsCache = { models, expiresAt: Date.now() + MODELS_TTL_MS };
  return { data: models, error: null };
}

export async function generateOpenRouterMessage(
  params: {
    model: string;
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    user?: string;
    sessionId?: string;
    trace?: Record<string, unknown>;
  },
  options?: { signal?: AbortSignal }
): Promise<{ data: OpenRouterGenerateResult | null; error: string | null }> {
  const model = params.model?.trim();
  if (!model) return { data: null, error: "model is required." };
  const cacheControl = getPromptCacheControlForModel(model);
  const apiKey = getOpenRouterApiKey();
  const url = `${getOpenRouterBaseUrl()}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: params.temperature ?? 0.7,
      ...(cacheControl ? { cache_control: cacheControl } : {}),
      ...(params.user ? { user: params.user } : {}),
      ...(params.sessionId ? { session_id: params.sessionId } : {}),
      ...(params.trace ? { trace: params.trace } : {}),
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
    }),
    signal: options?.signal,
  });
  const rawText = await res.text();
  if (!res.ok) {
    return {
      data: null,
      error: `OpenRouter generation failed: ${res.status} ${res.statusText} ${readErrorText(rawText)}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { data: null, error: "OpenRouter generation returned invalid JSON." };
  }
  const root = asRecord(parsed);
  const firstChoice = Array.isArray(root?.choices) ? asRecord(root.choices[0]) : null;
  const message = asRecord(firstChoice?.message);
  const content = typeof message?.content === "string" ? message.content.trim() : "";
  if (!content) return { data: null, error: "OpenRouter returned empty assistant message." };
  return {
    data: {
      text: content,
      model: typeof root?.model === "string" ? root.model : model,
      id: typeof root?.id === "string" ? root.id : null,
    },
    error: null,
  };
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

function extractDeltaTextFromSsePayload(payload: string): string | null {
  if (payload === "[DONE]") return null;
  try {
    const json = JSON.parse(payload) as unknown;
    const root = asRecord(json);
    const choices = Array.isArray(root?.choices) ? root.choices : [];
    const ch0 = asRecord(choices[0] as unknown);
    const delta = asRecord(ch0?.delta);
    const content = delta?.content;
    if (typeof content === "string" && content.length > 0) return content;
  } catch {
    return null;
  }
  return null;
}

/**
 * OpenRouter `stream: true` → forward assistant text deltas to the browser as SSE (`data: {"text":"…"}`).
 * On OpenRouter HTTP error, responds with JSON (502) and does **not** open an SSE stream.
 */
export async function pipeOpenRouterChatStreamToSse(
  res: ServerResponse,
  params: {
    model: string;
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    user?: string;
    sessionId?: string;
    trace?: Record<string, unknown>;
  },
  options?: { signal?: AbortSignal }
): Promise<void> {
  const model = params.model?.trim();
  if (!model) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "model is required." }));
    return;
  }
  const cacheControl = getPromptCacheControlForModel(model);
  const apiKey = getOpenRouterApiKey();
  const url = `${getOpenRouterBaseUrl()}/chat/completions`;
  const orRes = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model,
      temperature: params.temperature ?? 0.7,
      stream: true,
      ...(cacheControl ? { cache_control: cacheControl } : {}),
      ...(params.user ? { user: params.user } : {}),
      ...(params.sessionId ? { session_id: params.sessionId } : {}),
      ...(params.trace ? { trace: params.trace } : {}),
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
    }),
    signal: options?.signal,
  });
  if (!orRes.ok) {
    const rawText = await orRes.text();
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `OpenRouter stream failed: ${orRes.status} ${orRes.statusText} ${readErrorText(rawText)}`,
      })
    );
    return;
  }
  const body = orRes.body;
  if (!body) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "OpenRouter returned empty response body." }));
    return;
  }

  res.writeHead(200, SSE_HEADERS);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = carry.indexOf("\n")) >= 0) {
        const rawLine = carry.slice(0, idx);
        carry = carry.slice(idx + 1);
        const line = rawLine.trimEnd();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        const delta = extractDeltaTextFromSsePayload(payload);
        if (delta) res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
      }
    }
    const tail = carry.trim();
    if (tail.startsWith("data:")) {
      const payload = tail.slice(5).trim();
      const delta = extractDeltaTextFromSsePayload(payload);
      if (delta) res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
  } finally {
    reader.releaseLock();
  }
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
}
