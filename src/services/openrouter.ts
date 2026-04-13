const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const MODELS_TTL_MS = 5 * 60 * 1000;

type OpenRouterModelCache = {
  expiresAt: number;
  models: OpenRouterModelSummary[];
};

let modelsCache: OpenRouterModelCache | null = null;

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
  },
  options?: { signal?: AbortSignal }
): Promise<{ data: OpenRouterGenerateResult | null; error: string | null }> {
  const model = params.model?.trim();
  if (!model) return { data: null, error: "model is required." };
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
