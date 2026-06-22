const OPENMODEL_DEFAULT_BASE_URL = "https://api.openmodel.ai/v1";

type Json = Record<string, unknown>;

export interface OpenModelGenerateResult {
  text: string;
  model: string;
  id: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export function buildOpenModelRequestBody(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}): Json {
  return {
    model: params.model.trim(),
    max_tokens: params.maxTokens ?? 512,
    temperature: params.temperature ?? 0.7,
    // DeepSeek defaults to thinking mode. Short copy can exhaust max_tokens on
    // hidden reasoning before producing a final text block, so disable it here.
    thinking: { type: "disabled" },
    system: params.systemPrompt,
    messages: [{ role: "user", content: params.userPrompt }],
  };
}

function asRecord(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : null;
}

function errorMessage(raw: string): string {
  try {
    const root = asRecord(JSON.parse(raw));
    const error = asRecord(root?.error);
    if (typeof error?.message === "string") return error.message;
    if (typeof root?.message === "string") return root.message;
  } catch {
    // Fall through to the bounded raw response.
  }
  return raw.trim().slice(0, 1_000) || "No response body";
}

export function parseOpenModelMessageResponse(raw: unknown, requestedModel: string): OpenModelGenerateResult | null {
  const root = asRecord(raw);
  const blocks = Array.isArray(root?.content) ? root.content : [];
  const text = blocks
    .map((block) => asRecord(block))
    .filter((block): block is Json => block !== null && block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text).trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!text) return null;
  const usage = asRecord(root?.usage);
  return {
    text,
    model: typeof root?.model === "string" ? root.model : requestedModel,
    id: typeof root?.id === "string" ? root.id : null,
    inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : null,
    outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : null,
  };
}

export async function generateOpenModelMessage(
  params: {
    model: string;
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    maxTokens?: number;
  },
  options?: { signal?: AbortSignal }
): Promise<{ data: OpenModelGenerateResult | null; error: string | null }> {
  const apiKey = process.env.OPENMODEL_API_KEY?.trim();
  if (!apiKey) return { data: null, error: "OPENMODEL_API_KEY is required." };
  const model = params.model.trim();
  if (!model) return { data: null, error: "OpenModel model is required." };
  const baseUrl = (process.env.OPENMODEL_BASE_URL?.trim() || OPENMODEL_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(buildOpenModelRequestBody({ ...params, model })),
    signal: options?.signal,
  });
  const rawText = await response.text();
  if (!response.ok) {
    return {
      data: null,
      error: `OpenModel generation failed: ${response.status} ${response.statusText} ${errorMessage(rawText)}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { data: null, error: "OpenModel generation returned invalid JSON." };
  }
  const data = parseOpenModelMessageResponse(parsed, model);
  return data
    ? { data, error: null }
    : { data: null, error: "OpenModel returned an empty assistant message." };
}
