/**
 * Cursor Cloud Agents API: launch agent, poll status, read conversation, parse JSON, map to entities.
 * @see https://cursor.com/docs-static/cloud-agents-openapi.yaml
 */

import type { LlmAdapter, LlmExecuteResult } from "../llm-adapter.js";

const DEFAULT_API_BASE = "https://api.cursor.com";
const DEFAULT_REF = "main";
const DEFAULT_POLL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Tells the model exactly which strings must appear as top-level JSON keys (matches
 * `entities[].id` / queue `company_id` or `contact_id` UUIDs).
 */
function buildJsonResultKeyInstructionSuffix(
  entities: Array<{ id: string; data: Record<string, unknown> }>
): string {
  const ids = [...new Set(entities.map((e) => e.id).filter((id) => id.trim().length > 0))];
  const bulletList = ids.map((id) => `- ${id}`).join("\n");
  return `

IMPORTANT: Return your results as a single fenced JSON code block. The root value MUST be a JSON object with one entry per entity in this batch (not an array).

CRITICAL — top-level object keys MUST be entity IDs (UUIDs) exactly as listed below:
- Copy each key character-for-character: same hex digits, hyphens, and letter case as shown.
- Do NOT use person names, company names, domains, batch markers like [@1], numeric indices, or invented labels as JSON keys.
- Do NOT use only a wrapper key (e.g. "results") without these UUIDs as the inner keys; if you nest, the map keyed by these UUIDs must appear at the inner level.

Required keys (one object value per key, your enrichment payload for that entity):
${bulletList || "- (no entity ids — return {})"}

Each value must be a JSON object with your enrichment findings for that entity.
`;
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

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Pulls the first JSON object from assistant text: fenced ```json``` block, or balanced `{...}`.
 */
export function extractJsonObjectString(text: string): string {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) {
    const inner = fenced[1]!.trim();
    if (inner.startsWith("{")) return inner;
  }
  const balanced = extractFirstJsonObject(trimmed);
  if (balanced) return balanced;
  throw new Error("No JSON object found in assistant message");
}

function normalizeParsedValues(
  parsed: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out[k] = v as Record<string, unknown>;
    } else {
      out[k] = { value: v as unknown };
    }
  }
  return out;
}

/** Cursor models often wrap the per-entity map in `{ "results": { ... } }` etc. */
function tryUnwrapEntityResultMap(obj: Record<string, unknown>): Record<string, unknown> {
  let current = obj;
  for (let depth = 0; depth < 4; depth++) {
    const keys = Object.keys(current);
    if (keys.length !== 1) break;
    const k = keys[0]!;
    if (
      !/^(results|data|output|response|entities|contacts|items|enrichment|findings)$/i.test(
        k
      )
    ) {
      break;
    }
    const inner = current[k];
    if (!inner || typeof inner !== "object" || Array.isArray(inner)) break;
    current = inner as Record<string, unknown>;
  }
  return current;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeMatchToken(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True if JSON object key refers to this entity (domain, name, uuid, or uuid embedded in key). */
export function jsonResultKeyMatchesEntity(key: string, candidate: string): boolean {
  const k = key.trim();
  const c = candidate.trim();
  if (!k || !c) return false;
  if (normalizeMatchToken(k) === normalizeMatchToken(c)) return true;
  const nk = normalizeMatchToken(k);
  const nc = normalizeMatchToken(c);
  const cUuid = UUID_RE.test(c);
  const kUuid = UUID_RE.test(k);
  if (cUuid || kUuid) {
    if (nk.includes(nc) || nc.includes(nk)) return true;
    const dk = nk.replace(/-/g, "");
    const dc = nc.replace(/-/g, "");
    if (dk.length >= 32 && dc.length >= 32 && (dk.includes(dc) || dc.includes(dk))) {
      return true;
    }
  }
  return false;
}

export function parseEntityResultsFromAssistantText(
  text: string
): Record<string, Record<string, unknown>> {
  const jsonStr = extractJsonObjectString(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse JSON from assistant message: ${msg}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object at top level");
  }
  const unwrapped = tryUnwrapEntityResultMap(parsed as Record<string, unknown>);
  return normalizeParsedValues(unwrapped);
}

/**
 * Maps LLM JSON keys (domain, name, uuid, id) to internal entity ids.
 */
function buildEntityMatchCandidates(
  entity: { id: string; data: Record<string, unknown> }
): string[] {
  const d = entity.data;
  const first = typeof d.first_name === "string" ? d.first_name.trim() : "";
  const last = typeof d.last_name === "string" ? d.last_name.trim() : "";
  const combined = [first, last].filter(Boolean).join(" ").trim();
  const raw: unknown[] = [
    d.domain,
    d.name,
    combined || undefined,
    d.uuid,
    d.company_uuid,
    d.work_email,
    entity.id,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    if (x === undefined || x === null) continue;
    const s = String(x).trim();
    if (!s) continue;
    const sig = s.toLowerCase();
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(s);
  }
  return out;
}

export function matchResultsToEntities(
  parsed: Record<string, Record<string, unknown>>,
  entities: Array<{ id: string; data: Record<string, unknown> }>
): Map<string, Record<string, unknown>> {
  const results = new Map<string, Record<string, unknown>>();
  for (const entity of entities) {
    const candidates = buildEntityMatchCandidates(entity);
    let matched = false;
    for (const key of Object.keys(parsed)) {
      if (candidates.some((c) => jsonResultKeyMatchesEntity(key, c))) {
        results.set(entity.id, parsed[key]!);
        matched = true;
        break;
      }
    }
    if (!matched) {
      const parsedKeys = Object.keys(parsed).join(", ") || "(none)";
      throw new Error(
        `No JSON key matched entity ${entity.id} (candidates: ${candidates.join(", ") || "(none)"}; JSON keys: ${parsedKeys})`
      );
    }
  }
  return results;
}

type AgentStatus =
  | "CREATING"
  | "RUNNING"
  | "FINISHED"
  | "ERROR"
  | "EXPIRED";

interface CreateAgentResponse {
  id: string;
  status: AgentStatus;
}

interface GetAgentResponse {
  id: string;
  status: AgentStatus;
}

interface ConversationMessage {
  id: string;
  type: "user_message" | "assistant_message";
  text: string;
}

interface ConversationResponse {
  id: string;
  messages: ConversationMessage[];
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 2000);
  } catch {
    return "";
  }
}

export class CursorCloudAdapter implements LlmAdapter {
  readonly name = "cursor";

  private readonly apiBase: string;
  private readonly apiKey: string;
  private readonly repository: string;
  private readonly ref: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor() {
    const apiKey = process.env.CURSOR_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "CURSOR_API_KEY is required when LLM_ADAPTER=cursor"
      );
    }
    const repository = process.env.CURSOR_AGENT_REPO_URL?.trim();
    if (!repository) {
      throw new Error(
        "CURSOR_AGENT_REPO_URL is required when LLM_ADAPTER=cursor"
      );
    }
    this.apiKey = apiKey;
    this.repository = repository;
    this.apiBase = (
      process.env.CURSOR_API_BASE_URL?.trim() || DEFAULT_API_BASE
    ).replace(/\/+$/, "");
    this.ref = process.env.CURSOR_AGENT_REF?.trim() || DEFAULT_REF;
    this.pollIntervalMs = Math.max(
      100,
      Number.parseInt(process.env.CURSOR_AGENT_POLL_INTERVAL_MS ?? "", 10) ||
        DEFAULT_POLL_MS
    );
    this.timeoutMs = Math.max(
      1000,
      Number.parseInt(process.env.CURSOR_AGENT_TIMEOUT_MS ?? "", 10) ||
        DEFAULT_TIMEOUT_MS
    );
  }

  private authHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async execute(
    resolvedPrompt: string,
    entities: Array<{ id: string; data: Record<string, unknown> }>,
    options?: { signal?: AbortSignal }
  ): Promise<LlmExecuteResult> {
    const signal = options?.signal;
    const promptText =
      resolvedPrompt + buildJsonResultKeyInstructionSuffix(entities);
    const createRes = await fetch(`${this.apiBase}/v0/agents`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({
        prompt: { text: promptText },
        source: {
          repository: this.repository,
          ref: this.ref,
        },
      }),
      signal,
    });

    if (!createRes.ok) {
      const body = await readErrorBody(createRes);
      throw new Error(
        `Cursor API POST /v0/agents failed: ${createRes.status} ${createRes.statusText} ${body}`
      );
    }

    const created = (await createRes.json()) as CreateAgentResponse;
    const agentId = created.id;
    if (!agentId) {
      throw new Error("Cursor API returned no agent id");
    }

    const deadline = Date.now() + this.timeoutMs;

    try {
      while (Date.now() < deadline) {
        if (signal?.aborted) {
          throw new Error("Aborted");
        }

        const statusRes = await fetch(`${this.apiBase}/v0/agents/${encodeURIComponent(agentId)}`, {
          method: "GET",
          headers: this.authHeaders(),
          signal,
        });

        if (!statusRes.ok) {
          const body = await readErrorBody(statusRes);
          throw new Error(
            `Cursor API GET /v0/agents/${agentId} failed: ${statusRes.status} ${statusRes.statusText} ${body}`
          );
        }

        const agent = (await statusRes.json()) as GetAgentResponse;
        const st = agent.status;

        if (st === "ERROR" || st === "EXPIRED") {
          throw new Error(`Cursor agent ${agentId} ended with status ${st}`);
        }

        if (st === "FINISHED") {
          const convRes = await fetch(
            `${this.apiBase}/v0/agents/${encodeURIComponent(agentId)}/conversation`,
            {
              method: "GET",
              headers: this.authHeaders(),
              signal,
            }
          );

          if (!convRes.ok) {
            const body = await readErrorBody(convRes);
            throw new Error(
              `Cursor API GET conversation failed: ${convRes.status} ${convRes.statusText} ${body}`
            );
          }

          const conv = (await convRes.json()) as ConversationResponse;
          const assistantTexts = conv.messages
            .filter((m) => m.type === "assistant_message")
            .map((m) => m.text);
          const lastAssistant =
            assistantTexts.length > 0
              ? assistantTexts[assistantTexts.length - 1]
              : "";
          if (!lastAssistant?.trim()) {
            throw new Error("No assistant_message in agent conversation");
          }

          const parsed = parseEntityResultsFromAssistantText(lastAssistant);
          const results = matchResultsToEntities(parsed, entities);
          return {
            results,
            trace: {
              provider: "cursor",
              externalAgentId: agentId,
              meta: {
                apiBase: this.apiBase,
                repository: this.repository,
                ref: this.ref,
              },
            },
          };
        }

        await delay(this.pollIntervalMs, signal);
      }

      throw new Error(
        `Cursor agent ${agentId} timed out after ${this.timeoutMs}ms`
      );
    } finally {
      try {
        await fetch(
          `${this.apiBase}/v0/agents/${encodeURIComponent(agentId)}`,
          {
            method: "DELETE",
            headers: this.authHeaders(),
            signal,
          }
        );
      } catch {
        // best-effort cleanup
      }
    }
  }
}
