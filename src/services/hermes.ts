/**
 * Server-side client for the Hermes Agent OpenAI-compatible API.
 * Keys stay on the Voitech API host — never exposed to the browser.
 */

const DEFAULT_TIMEOUT_MS = 600_000; // research runs can be long

export const HERMES_PINNED_MODELS: Array<{ id: string; label: string; role: string }> = [
  { id: "auto", label: "Auto (policy)", role: "policy" },
  { id: "deepseek/deepseek-v4-flash-0731", label: "DeepSeek V4 Flash 0731 (default)", role: "extract" },
  { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2 (extract)", role: "extract" },
  { id: "deepseek/deepseek-chat-v3-0324", label: "DeepSeek Chat V3 (cheap)", role: "extract" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", role: "extract" },
  { id: "moonshotai/kimi-k2", label: "Kimi K2 (POV / email)", role: "strong" },
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", role: "strong" },
  { id: "openai/gpt-5.6-terra", label: "GPT 5.6 Terra", role: "strong" },
  { id: "openai/gpt-4.1-mini", label: "GPT 4.1 Mini", role: "mid" },
  { id: "qwen/qwen3-235b-a22b", label: "Qwen3 235B", role: "mid" },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", role: "mid" },
  { id: "nousresearch/hermes-4-70b", label: "Hermes 4 70B", role: "mid" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", role: "strong" },
  { id: "x-ai/grok-4", label: "Grok 4", role: "strong" },
];

export type HermesChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
};

function getHermesBaseUrl(): string {
  const raw = process.env.HERMES_API_BASE_URL?.trim();
  if (!raw) throw new Error("HERMES_API_BASE_URL is not configured.");
  return raw.replace(/\/+$/, "");
}

function getHermesApiKey(): string {
  const key = process.env.HERMES_API_KEY?.trim();
  if (!key) throw new Error("HERMES_API_KEY is not configured.");
  return key;
}

function readErrorText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "No response body";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const err = obj.error;
      if (err && typeof err === "object" && !Array.isArray(err)) {
        const msg = (err as Record<string, unknown>).message;
        if (typeof msg === "string") return msg;
      }
      if (typeof obj.message === "string") return obj.message;
    }
    return trimmed.slice(0, 1000);
  } catch {
    return trimmed.slice(0, 1000);
  }
}

export async function hermesHealth(signal?: AbortSignal): Promise<{
  ok: boolean;
  status: number;
  body: unknown;
  error: string | null;
}> {
  try {
    const res = await fetch(`${getHermesBaseUrl()}/health`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getHermesApiKey()}`,
        Accept: "application/json",
      },
      signal,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    return {
      ok: res.ok,
      status: res.status,
      body,
      error: res.ok ? null : readErrorText(text),
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function hermesListModels(signal?: AbortSignal): Promise<{
  data: Array<{ id: string; label: string; role: string }>;
  upstream: unknown;
  error: string | null;
}> {
  try {
    const res = await fetch(`${getHermesBaseUrl()}/v1/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getHermesApiKey()}`,
        Accept: "application/json",
      },
      signal,
    });
    const text = await res.text();
    let upstream: unknown = null;
    try {
      upstream = text ? JSON.parse(text) : null;
    } catch {
      upstream = text;
    }
    if (!res.ok) {
      return { data: HERMES_PINNED_MODELS, upstream, error: readErrorText(text) };
    }
    return { data: HERMES_PINNED_MODELS, upstream, error: null };
  } catch (e) {
    return {
      data: HERMES_PINNED_MODELS,
      upstream: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export type HermesChatResult = {
  id: string | null;
  model: string | null;
  content: string;
  raw: unknown;
  usage: Record<string, unknown> | null;
};

/**
 * Non-streaming chat completions. Hermes runs tools server-side and returns the final assistant message.
 */
export async function hermesChatCompletions(input: {
  messages: HermesChatMessage[];
  model?: string;
  temperature?: number;
  sessionId?: string;
  sessionKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<HermesChatResult> {
  // "auto" → Hermes profile model (supports tools). Do not pin a chat-only OpenRouter id.
  const model =
    input.model && input.model !== "auto"
      ? input.model.trim()
      : "hermes-agent";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onAbort);

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${getHermesApiKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (input.sessionId?.trim()) headers["X-Hermes-Session-Id"] = input.sessionId.trim();
    if (input.sessionKey?.trim()) headers["X-Hermes-Session-Key"] = input.sessionKey.trim();

    const res = await fetch(`${getHermesBaseUrl()}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: input.messages,
        temperature: input.temperature ?? 0.2,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let raw: unknown = null;
    try {
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = text;
    }
    if (!res.ok) {
      throw new Error(`Hermes chat failed: ${res.status} ${readErrorText(text)}`);
    }
    const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const choices = obj && Array.isArray(obj.choices) ? obj.choices : [];
    const first = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>) : null;
    const message = first?.message && typeof first.message === "object" ? (first.message as Record<string, unknown>) : null;
    let content = "";
    if (typeof message?.content === "string") content = message.content;
    else if (Array.isArray(message?.content)) {
      content = (message.content as unknown[])
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
            return String((part as Record<string, unknown>).text);
          }
          return "";
        })
        .join("");
    }
    const usage =
      obj?.usage && typeof obj.usage === "object" && !Array.isArray(obj.usage)
        ? (obj.usage as Record<string, unknown>)
        : null;
    return {
      id: typeof obj?.id === "string" ? obj.id : null,
      model: typeof obj?.model === "string" ? obj.model : model,
      content,
      raw,
      usage,
    };
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", onAbort);
  }
}

export function isHermesConfigured(): boolean {
  return Boolean(process.env.HERMES_API_BASE_URL?.trim() && process.env.HERMES_API_KEY?.trim());
}
