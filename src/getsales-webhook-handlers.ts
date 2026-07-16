import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import { getSupabase } from "./services/supabase.js";
import { triggerWorkflowPayload, VELVETECH_PROJECT_ID } from "./services/n8n-trigger.js";
import { buildVelvetechAcceptLinkedinPayloads } from "./launcher-handlers.js";

/**
 * GetSales → app webhook receivers (D0.2 accept-triggered LinkedIn).
 *
 * GetSales fires `contact_accepted_linkedin_connection_request` with a bare
 * lead event; the n8n accept parent refuses bare events (it requires pov +
 * deep_research + channel_state pre-assembled), so this receiver assembles the
 * context via buildVelvetechAcceptLinkedinPayloads and then triggers n8n —
 * the same chain the launcher uses, recorded in n8n_launch_runs so accepts
 * show up in launch history like any other run.
 *
 * Response policy: 401 only on a bad token; everything else answers 200 with
 * a status field, because GetSales retries non-2xx and a retry storm on a
 * data problem (unsynced lead, missing research) helps nobody.
 */

const LAUNCH_RUNS_TABLE = "n8n_launch_runs";
const WORKFLOW_KEY = "velvetech_accept_linkedin";
/** One accept launch per lead per window; webhook retries and re-accepts inside it are ignored. */
const DEDUPE_WINDOW_HOURS = 24 * 7;

type Json = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function readJsonBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

function tokenOk(req: IncomingMessage): boolean {
  const secret = process.env.GETSALES_ACCEPT_WEBHOOK_TOKEN?.trim();
  if (!secret) return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  const provided = (url.searchParams.get("token") ?? String(req.headers["x-webhook-token"] ?? "")).trim();
  if (!provided || provided.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

/** GetSales event payload shape is not pinned; look in the usual places. */
function extractLeadUuid(body: Json): string {
  const candidates: unknown[] = [
    body.lead_uuid,
    body.uuid,
    (body.lead as Json | undefined)?.uuid,
    (body.lead as Json | undefined)?.lead_uuid,
    (body.data as Json | undefined)?.uuid,
    ((body.data as Json | undefined)?.lead as Json | undefined)?.uuid,
    (body.contact as Json | undefined)?.uuid,
    (body.payload as Json | undefined)?.lead_uuid,
    ((body.payload as Json | undefined)?.lead as Json | undefined)?.uuid,
  ];
  for (const c of candidates) {
    const s = typeof c === "string" ? c.trim() : "";
    if (UUID_RE.test(s)) return s;
  }
  return "";
}

async function recentAcceptLaunchExists(
  client: NonNullable<ReturnType<typeof getSupabase>>,
  leadUuid: string
): Promise<boolean> {
  const since = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 3600 * 1000).toISOString();
  const { data } = await client
    .from(LAUNCH_RUNS_TABLE)
    .select("id")
    .eq("workflow_key", WORKFLOW_KEY)
    .gte("created_at", since)
    .contains("lead_uuids", [leadUuid])
    .limit(1);
  return Boolean(data && data.length > 0);
}

// --- POST /api/webhooks/getsales-accept?token=... ----------------------------
export async function handleGetSalesAcceptWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  if (!tokenOk(req)) return sendJson(res, 401, { error: "Invalid or missing webhook token" });

  const client = getSupabase();
  if (!client) return sendJson(res, 200, { status: "skipped", reason: "Supabase not configured" });

  const body = await readJsonBody(req);
  const leadUuid = extractLeadUuid(body);
  if (!leadUuid) {
    console.warn("[getsales-accept] no lead uuid in webhook body:", JSON.stringify(body).slice(0, 500));
    return sendJson(res, 200, { status: "skipped", reason: "No lead uuid found in event payload" });
  }

  if (await recentAcceptLaunchExists(client, leadUuid)) {
    return sendJson(res, 200, { status: "duplicate", leadUuid });
  }

  const { data: inserted, error: insErr } = await client
    .from(LAUNCH_RUNS_TABLE)
    .insert({
      project_id: VELVETECH_PROJECT_ID,
      workflow_key: WORKFLOW_KEY,
      source_list_uuid: null,
      source_list_name: "GetSales accept webhook",
      lead_uuids: [leadUuid],
      requested_count: 1,
      status: "running",
    })
    .select("*")
    .single();
  if (insErr || !inserted) {
    console.error("[getsales-accept] launch record insert failed:", insErr?.message);
    return sendJson(res, 200, { status: "error", reason: insErr?.message ?? "Failed to create launch record" });
  }
  const launchId = String((inserted as Json).id);

  const built = await buildVelvetechAcceptLinkedinPayloads(client, {
    projectId: VELVETECH_PROJECT_ID,
    launchId,
    leadUuids: [leadUuid],
  });
  if (!built.ok) {
    await client
      .from(LAUNCH_RUNS_TABLE)
      .update({ status: "failed", error_message: built.error, finished_at: new Date().toISOString() })
      .eq("id", launchId);
    console.warn(`[getsales-accept] assembly failed for ${leadUuid}: ${built.error}`);
    return sendJson(res, 200, { status: "failed", launchId, reason: built.error });
  }

  let failed: string | null = null;
  for (const payload of built.payloads) {
    const one = await triggerWorkflowPayload(WORKFLOW_KEY, payload);
    if (!one.ok) failed = one.error ?? "Trigger failed";
  }
  if (failed) {
    await client
      .from(LAUNCH_RUNS_TABLE)
      .update({ status: "failed", error_message: failed, finished_at: new Date().toISOString() })
      .eq("id", launchId);
    return sendJson(res, 200, { status: "failed", launchId, reason: failed });
  }

  sendJson(res, 200, { status: "launched", launchId, leadUuid });
}
