import type { IncomingMessage, ServerResponse } from "node:http";
import {
  HERMES_PINNED_MODELS,
  hermesChatCompletions,
  hermesHealth,
  hermesListModels,
  isHermesConfigured,
  type HermesChatMessage,
} from "./services/hermes.js";
import { getHermesJob, startHermesJob } from "./services/hermes-jobs.js";

const WELLORE_PROJECT_ID = "0038d0db-aab2-40f1-9f6e-38d38e157f8f";

async function getRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseMessages(raw: unknown): HermesChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: HermesChatMessage[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const role = item.role;
    const content = item.content;
    if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") return null;
    if (typeof content !== "string") return null;
    const msg: HermesChatMessage = { role, content };
    if (typeof item.name === "string") msg.name = item.name;
    if (typeof item.tool_call_id === "string") msg.tool_call_id = item.tool_call_id;
    out.push(msg);
  }
  return out;
}

/** GET /api/hermes/health */
export async function handleHermesHealth(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (!isHermesConfigured()) {
    sendJson(res, 503, {
      ok: false,
      configured: false,
      error: "HERMES_API_BASE_URL / HERMES_API_KEY not set on this service",
    });
    return;
  }
  const result = await hermesHealth();
  sendJson(res, result.ok ? 200 : 502, {
    ok: result.ok,
    configured: true,
    status: result.status,
    body: result.body,
    error: result.error,
    welloreProjectId: WELLORE_PROJECT_ID,
  });
}

/** GET /api/hermes/models */
export async function handleHermesModels(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (!isHermesConfigured()) {
    sendJson(res, 200, {
      data: HERMES_PINNED_MODELS,
      configured: false,
      error: "Hermes not configured; showing pinned catalog only",
    });
    return;
  }
  const result = await hermesListModels();
  sendJson(res, 200, {
    data: result.data,
    configured: true,
    upstreamError: result.error,
  });
}

/**
 * POST /api/hermes/chat
 * Body: { messages, model?, temperature?, sessionId?, sessionKey?, projectId? }
 * Hermes runs tools server-side; response is the final assistant message (JSON, not SSE).
 */
export async function handleHermesChat(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST", "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  if (!isHermesConfigured()) {
    sendJson(res, 503, { error: "Hermes is not configured on this Voitech service" });
    return;
  }

  let parsed: unknown;
  try {
    const raw = await getRawBody(req);
    parsed = raw.trim() ? JSON.parse(raw) : null;
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return;
  }
  if (!isRecord(parsed)) {
    sendJson(res, 400, { error: "Body must be a JSON object" });
    return;
  }

  const projectId = typeof parsed.projectId === "string" ? parsed.projectId.trim() : "";
  if (projectId && projectId !== WELLORE_PROJECT_ID) {
    sendJson(res, 403, {
      error: "Hermes agent v1 is scoped to the Wellore project only",
      welloreProjectId: WELLORE_PROJECT_ID,
    });
    return;
  }

  const messages = parseMessages(parsed.messages);
  if (!messages) {
    sendJson(res, 400, { error: "messages must be a non-empty array of {role, content}" });
    return;
  }

  const model = typeof parsed.model === "string" ? parsed.model.trim() : "auto";
  const temperature =
    typeof parsed.temperature === "number" && Number.isFinite(parsed.temperature)
      ? parsed.temperature
      : 0.2;
  const sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId.trim() : undefined;
  const sessionKey = typeof parsed.sessionKey === "string" ? parsed.sessionKey.trim() : "wellore-operator";

  try {
    const result = await hermesChatCompletions({
      messages,
      model,
      temperature,
      sessionId,
      sessionKey,
    });
    sendJson(res, 200, {
      id: result.id,
      model: result.model,
      content: result.content,
      usage: result.usage,
      welloreProjectId: WELLORE_PROJECT_ID,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /abort/i.test(msg) ? 504 : 502;
    sendJson(res, status, { error: msg });
  }
}

/**
 * POST /api/hermes/jobs starts a background Hermes request.
 * GET /api/hermes/jobs?id=... returns queued/running/complete/failed state.
 */
export async function handleHermesJobs(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === "GET") {
    const url = new URL(req.url || "/api/hermes/jobs", "http://localhost");
    const id = url.searchParams.get("id")?.trim();
    if (!id) {
      sendJson(res, 400, { error: "id query parameter is required" });
      return;
    }
    const job = getHermesJob(id);
    if (!job) {
      sendJson(res, 404, { error: "Hermes job not found or expired" });
      return;
    }
    sendJson(res, 200, { job, welloreProjectId: WELLORE_PROJECT_ID });
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "GET, POST", "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  if (!isHermesConfigured()) {
    sendJson(res, 503, { error: "Hermes is not configured on this Voitech service" });
    return;
  }

  let parsed: unknown;
  try {
    const raw = await getRawBody(req);
    parsed = raw.trim() ? JSON.parse(raw) : null;
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return;
  }
  if (!isRecord(parsed)) {
    sendJson(res, 400, { error: "Body must be a JSON object" });
    return;
  }
  const projectId = typeof parsed.projectId === "string" ? parsed.projectId.trim() : "";
  if (projectId && projectId !== WELLORE_PROJECT_ID) {
    sendJson(res, 403, {
      error: "Hermes agent v1 is scoped to the Wellore project only",
      welloreProjectId: WELLORE_PROJECT_ID,
    });
    return;
  }
  const messages = parseMessages(parsed.messages);
  if (!messages) {
    sendJson(res, 400, { error: "messages must be a non-empty array of {role, content}" });
    return;
  }
  const temperature =
    typeof parsed.temperature === "number" && Number.isFinite(parsed.temperature)
      ? parsed.temperature
      : 0.2;
  const job = startHermesJob({
    messages,
    model: typeof parsed.model === "string" ? parsed.model.trim() : "auto",
    temperature,
    sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId.trim() : undefined,
    sessionKey:
      typeof parsed.sessionKey === "string" ? parsed.sessionKey.trim() : "wellore-operator",
  });
  sendJson(res, 202, { job, welloreProjectId: WELLORE_PROJECT_ID });
}

/** GET /api/hermes/presets — prompt presets for the UI */
export async function handleHermesPresets(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  sendJson(res, 200, {
    presets: [
      {
        id: "research-company",
        label: "Research company",
        prompt:
          "Use the wellore-research-company skill and its deterministic hermes_research runner. Do not manually reproduce the pipeline with browser/terminal calls. Research and upsert this company.\n\nCompany: {{company}}\nDomain/slug (if known): {{slug}}\nmode: full\nforce_research: false\nwrite: true\nallow_paid: true\n\nReturn the runner result JSON so Voitech can display stage statuses and degraded reasons.",
      },
      {
        id: "research-company-catalog",
        label: "Catalog-only (provisional)",
        prompt:
          "Use the wellore-research-catalog-only skill and its deterministic hermes_research runner. Do not use paid providers or contacts.\n\nCompany: {{company}}\nDomain/slug (if known): {{slug}}\nmode: catalog_only\nwrite: false\nallow_paid: false\n\nThis verdict is provisional: skipped evidence is unknown, final score_too_low is forbidden, and an existing medium/high segment must be preserved. Return the runner result JSON.",
      },
      {
        id: "write-email",
        label: "Write 3-touch email",
        prompt:
          "Use the wellore-write-email skill. Load POV + signals from Supabase for this contact's company, draft a locked-rules 3-touch sequence, then POST it into Voitech Email Studio ingest.\n\nContact UUID: {{contactId}}\nContact name: {{contactName}}\nCompany: {{company}}\nProject ID: 0038d0db-aab2-40f1-9f6e-38d38e157f8f\n\nAfter ingest, confirm Email Studio rows (steps 1–3).",
      },
      {
        id: "db-gaps",
        label: "DB gaps for slug",
        prompt:
          "Use the wellore-supabase skill. For company slug/domain {{slug}}, report what is missing vs a full dossier (pov, titles briefs, contacts, signals, score). Do not invent data. Suggest the next tool calls to fill gaps.",
      },
    ],
    welloreProjectId: WELLORE_PROJECT_ID,
    gtmBaseUrl: "https://wellore-gtm-production.up.railway.app",
  });
}
