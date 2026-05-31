/**
 * HTTP handlers for the InMail review feature. Self-contained and additive:
 * reuses existing services (Supabase, OpenRouter, source-api) via their public
 * exports. Routes are registered in src/api-server.ts. No existing handler is touched.
 *
 * Tables (see scripts/inmail-review-schema.sql): inmail_review_state / _versions / _comments.
 * Base content + research come from public.n8n_workflow_results (result jsonb).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getSupabase,
  getGetSalesCredentials,
  N8N_WORKFLOW_RESULTS_TABLE,
} from "./services/supabase.js";
import { generateOpenRouterMessage } from "./services/openrouter.js";
import {
  arrangeGetSalesFields,
  validateInmailCopy,
  GETSALES_INMAIL_FIELD_NAMES,
  type InmailKind,
} from "./services/inmail-review.js";
import { systemPromptFor } from "./services/inmail-prompts.js";
import {
  listLeadCustomFields,
  createLeadCustomField,
  updateLeadCustomFields,
} from "./services/source-api.js";

const STATE_TABLE = "inmail_review_state";
const VERSIONS_TABLE = "inmail_review_versions";
const COMMENTS_TABLE = "inmail_review_comments";
const DEFAULT_MODEL = "nousresearch/hermes-4-70b";

type Json = Record<string, unknown>;

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.writeHead(status);
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

function str(obj: Json, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

function pipelineOf(result: Json): InmailKind | null {
  if (typeof result.followup_body === "string") return "followup";
  if (typeof result.inmail_body === "string") return "inmail";
  return null;
}

function subjectBodyFrom(result: Json, pipeline: InmailKind): { subject: string; body: string } {
  return pipeline === "followup"
    ? { subject: "", body: str(result, "followup_body") }
    : { subject: str(result, "inmail_subject"), body: str(result, "inmail_body") };
}

function researchFrom(result: Json): Json {
  return {
    lead_uuid: str(result, "lead_uuid"),
    first_name: str(result, "first_name"),
    name: str(result, "name", "full_name"),
    title: str(result, "position", "title", "role"),
    linkedin_url: str(result, "linkedin_url", "linkedin"),
    company_name: str(result, "company_name"),
    company_domain: str(result, "company_domain", "domain"),
    company_description: str(result, "company_description"),
    company_employees: str(result, "company_employees"),
    location: str(result, "location", "raw_address"),
    pov: str(result, "pov", "companies_output_pov"),
    chosen_observation: str(result, "chosen_observation"),
    role_bucket: str(result, "role_bucket"),
    assumed_channel_mix: result.assumed_channel_mix ?? "",
    assumed_target_metric: str(result, "assumed_target_metric"),
    dq_reason: str(result, "dq_reason"),
    prompt_version: str(result, "prompt_version"),
  };
}

function leadUuidFrom(result: Json, row: Json): string {
  return str(result, "lead_uuid") || str(row, "contact_id");
}

function parseModelJson(text: string): Json | null {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const v = JSON.parse(stripped) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
  } catch {
    return null;
  }
}

/** Load a single n8n_workflow_results row by id. */
async function loadResultRow(resultId: string): Promise<{ row: Json | null; error: string | null }> {
  const client = getSupabase();
  if (!client) return { row: null, error: "Supabase not configured" };
  const { data, error } = await client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("*")
    .eq("id", resultId)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as Json) ?? null, error: null };
}

/** Ensure a state row + seed version 1 from the original n8n copy. Returns current version id. */
async function ensureSeeded(resultId: string, row: Json): Promise<{ currentVersionId: string | null; error: string | null }> {
  const client = getSupabase();
  if (!client) return { currentVersionId: null, error: "Supabase not configured" };
  const result = (row.result as Json) ?? {};
  const pipeline = pipelineOf(result);
  if (!pipeline) return { currentVersionId: null, error: "Row is not an InMail/Followup result" };

  const { data: existingVersions } = await client
    .from(VERSIONS_TABLE)
    .select("id")
    .eq("result_id", resultId)
    .order("created_at", { ascending: true })
    .limit(1);

  let firstVersionId: string | null =
    Array.isArray(existingVersions) && existingVersions[0] ? String((existingVersions[0] as Json).id) : null;

  if (!firstVersionId) {
    const { subject, body } = subjectBodyFrom(result, pipeline);
    const violations = validateInmailCopy(body, { kind: pipeline, subject });
    const { data: inserted, error: insErr } = await client
      .from(VERSIONS_TABLE)
      .insert({
        result_id: resultId,
        subject,
        body,
        source: "n8n",
        prompt_version: str(result, "prompt_version"),
        violations,
      })
      .select("id")
      .single();
    if (insErr) return { currentVersionId: null, error: insErr.message };
    firstVersionId = String((inserted as Json).id);
  }

  // upsert state (unique on result_id)
  const { data: stateRow } = await client.from(STATE_TABLE).select("*").eq("result_id", resultId).maybeSingle();
  if (!stateRow) {
    await client.from(STATE_TABLE).insert({
      result_id: resultId,
      lead_uuid: leadUuidFrom(result, row),
      workflow: str(row, "workflow"),
      pipeline,
      status: "pending",
      current_version_id: firstVersionId,
    });
    return { currentVersionId: firstVersionId, error: null };
  }
  const current = (stateRow as Json).current_version_id;
  return { currentVersionId: typeof current === "string" ? current : firstVersionId, error: null };
}

// --- POST /api/inmail-review/items ------------------------------------------
export async function handleInmailReviewItems(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const body = await readJsonBody(req);
  const pipelineFilter = str(body, "pipeline");
  const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 300);

  const { data, error } = await client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("id,workflow,created_at,contact_id,company_id,result")
    .order("created_at", { ascending: false })
    .limit(limit * 2);
  if (error) return sendJson(res, 500, { error: error.message });

  const rows = (data ?? []) as Json[];
  const items: Json[] = [];
  for (const row of rows) {
    const result = (row.result as Json) ?? {};
    const pipeline = pipelineOf(result);
    if (!pipeline) continue;
    if (pipelineFilter && pipeline !== pipelineFilter) continue;
    const { subject, body } = subjectBodyFrom(result, pipeline);
    items.push({
      result_id: str(row, "id"),
      created_at: str(row, "created_at"),
      workflow: str(row, "workflow"),
      pipeline,
      research: researchFrom(result),
      subject,
      body,
      violations: validateInmailCopy(body, { kind: pipeline, subject }),
    });
    if (items.length >= limit) break;
  }

  const ids = items.map((i) => i.result_id as string);
  const stateByResult: Record<string, Json> = {};
  if (ids.length) {
    const { data: states } = await client.from(STATE_TABLE).select("*").in("result_id", ids);
    for (const s of (states ?? []) as Json[]) stateByResult[str(s, "result_id")] = s;
  }
  for (const it of items) {
    const s = stateByResult[it.result_id as string];
    it.status = s ? str(s, "status") || "pending" : "pending";
    it.current_version_id = s ? s.current_version_id ?? null : null;
  }

  sendJson(res, 200, { items });
}

// --- POST /api/inmail-review/open -------------------------------------------
export async function handleInmailReviewOpen(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const body = await readJsonBody(req);
  const resultId = str(body, "resultId");
  if (!resultId) return sendJson(res, 400, { error: "resultId is required" });

  const { row, error } = await loadResultRow(resultId);
  if (error) return sendJson(res, 500, { error });
  if (!row) return sendJson(res, 404, { error: "Result not found" });

  const seeded = await ensureSeeded(resultId, row);
  if (seeded.error) return sendJson(res, 400, { error: seeded.error });

  const result = (row.result as Json) ?? {};
  const pipeline = pipelineOf(result)!;
  const [{ data: versions }, { data: comments }, { data: state }] = await Promise.all([
    client.from(VERSIONS_TABLE).select("*").eq("result_id", resultId).order("created_at", { ascending: true }),
    client.from(COMMENTS_TABLE).select("*").eq("result_id", resultId).order("created_at", { ascending: true }),
    client.from(STATE_TABLE).select("*").eq("result_id", resultId).maybeSingle(),
  ]);

  sendJson(res, 200, {
    result_id: resultId,
    pipeline,
    workflow: str(row, "workflow"),
    research: researchFrom(result),
    versions: versions ?? [],
    comments: comments ?? [],
    status: state ? str(state as Json, "status") || "pending" : "pending",
    current_version_id: seeded.currentVersionId,
  });
}

// --- POST /api/inmail-review/comment ----------------------------------------
export async function handleInmailReviewComment(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const body = await readJsonBody(req);
  const resultId = str(body, "resultId");
  const text = str(body, "body");
  const kind = str(body, "kind") === "inline" ? "inline" : "general";
  if (!resultId || !text) return sendJson(res, 400, { error: "resultId and body are required" });

  const insert: Json = { result_id: resultId, kind, body: text };
  if (str(body, "versionId")) insert.version_id = str(body, "versionId");
  if (kind === "inline") {
    insert.quoted_text = str(body, "quotedText");
    if (typeof body.charStart === "number") insert.char_start = body.charStart;
    if (typeof body.charEnd === "number") insert.char_end = body.charEnd;
  }
  const { data, error } = await client.from(COMMENTS_TABLE).insert(insert).select("*").single();
  if (error) return sendJson(res, 500, { error: error.message });
  sendJson(res, 200, { comment: data });
}

// --- POST /api/inmail-review/regenerate -------------------------------------
export async function handleInmailReviewRegenerate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const body = await readJsonBody(req);
  const resultId = str(body, "resultId");
  if (!resultId) return sendJson(res, 400, { error: "resultId is required" });
  const model = str(body, "model") || DEFAULT_MODEL;
  const generalFeedback = str(body, "feedback");

  const { row, error } = await loadResultRow(resultId);
  if (error) return sendJson(res, 500, { error });
  if (!row) return sendJson(res, 404, { error: "Result not found" });
  const result = (row.result as Json) ?? {};
  const pipeline = pipelineOf(result);
  if (!pipeline) return sendJson(res, 400, { error: "Row is not an InMail/Followup result" });

  await ensureSeeded(resultId, row);

  // current copy = latest version (or original)
  const { data: latest } = await client
    .from(VERSIONS_TABLE)
    .select("*")
    .eq("result_id", resultId)
    .order("created_at", { ascending: false })
    .limit(1);
  const currentVersion = (Array.isArray(latest) && latest[0] ? (latest[0] as Json) : {}) as Json;
  const currentBody = str(currentVersion, "body") || subjectBodyFrom(result, pipeline).body;

  const { data: inlineComments } = await client
    .from(COMMENTS_TABLE)
    .select("*")
    .eq("result_id", resultId)
    .eq("kind", "inline");
  const inlineList = ((inlineComments ?? []) as Json[])
    .map((c) => `- on "${str(c, "quoted_text")}": ${str(c, "body")}`)
    .filter((s) => s.length > 6);

  const research = researchFrom(result);
  const userPrompt = [
    `Regenerate this ${pipeline === "followup" ? "LinkedIn follow-up" : "InMail"} for the contact below, applying the reviewer feedback. Follow every rule in the system prompt and return the same strict JSON schema.`,
    "",
    "Contact / company:",
    JSON.stringify(research, null, 2),
    "",
    "Current version:",
    currentBody,
    "",
    generalFeedback ? `Reviewer feedback: ${generalFeedback}` : "",
    inlineList.length ? `Inline comments:\n${inlineList.join("\n")}` : "",
  ]
    .filter((s) => s !== "")
    .join("\n");

  const { prompt: systemPrompt, version: promptVersion } = systemPromptFor(pipeline);
  const { data: gen, error: genErr } = await generateOpenRouterMessage({
    model,
    systemPrompt,
    userPrompt,
    temperature: 0.5,
  });
  if (genErr || !gen) return sendJson(res, 502, { error: genErr ?? "Generation failed" });

  const parsed = parseModelJson(gen.text);
  let subject = "";
  let newBody = "";
  if (parsed) {
    subject = pipeline === "inmail" ? str(parsed, "inmail_subject") : "";
    newBody = pipeline === "followup" ? str(parsed, "followup_body") : str(parsed, "inmail_body");
  }
  if (!newBody) newBody = gen.text.trim(); // fallback: model returned prose

  const violations = validateInmailCopy(newBody, { kind: pipeline, subject });
  const { data: inserted, error: insErr } = await client
    .from(VERSIONS_TABLE)
    .insert({
      result_id: resultId,
      subject,
      body: newBody,
      source: "regenerated",
      model: gen.model,
      prompt_version: promptVersion,
      feedback_used: [generalFeedback, ...inlineList].filter(Boolean).join("\n"),
      violations,
    })
    .select("*")
    .single();
  if (insErr) return sendJson(res, 500, { error: insErr.message });

  await client
    .from(STATE_TABLE)
    .update({ current_version_id: (inserted as Json).id, status: "pending", updated_at: new Date().toISOString() })
    .eq("result_id", resultId);

  sendJson(res, 200, { version: inserted, violations, parsed: parsed ?? null });
}

// --- POST /api/inmail-review/approve ----------------------------------------
export async function handleInmailReviewApprove(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const body = await readJsonBody(req);
  const resultId = str(body, "resultId");
  const versionId = str(body, "versionId");
  if (!resultId || !versionId) return sendJson(res, 400, { error: "resultId and versionId are required" });
  const { error } = await client
    .from(STATE_TABLE)
    .update({ status: "approved", current_version_id: versionId, updated_at: new Date().toISOString() })
    .eq("result_id", resultId);
  if (error) return sendJson(res, 500, { error: error.message });
  sendJson(res, 200, { ok: true });
}

// --- POST /api/inmail-review/push-getsales ----------------------------------
// Defaults to dryRun: true (preview only, no GetSales call).
export async function handleInmailReviewPushGetsales(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const body = await readJsonBody(req);
  const resultId = str(body, "resultId");
  if (!resultId) return sendJson(res, 400, { error: "resultId is required" });
  const dryRun = body.dryRun !== false; // default true

  const { row, error } = await loadResultRow(resultId);
  if (error) return sendJson(res, 500, { error });
  if (!row) return sendJson(res, 404, { error: "Result not found" });
  const result = (row.result as Json) ?? {};
  const pipeline = pipelineOf(result);
  if (pipeline !== "inmail") {
    return sendJson(res, 400, { error: "Only InMail push is supported; follow-up push is not implemented." });
  }

  // resolve the version to push: explicit > state.current > latest > original
  let subject = "";
  let pushBody = "";
  const versionId = str(body, "versionId");
  if (versionId) {
    const { data: v } = await client.from(VERSIONS_TABLE).select("*").eq("id", versionId).maybeSingle();
    if (v) {
      subject = str(v as Json, "subject");
      pushBody = str(v as Json, "body");
    }
  }
  if (!pushBody) {
    const { data: latest } = await client
      .from(VERSIONS_TABLE)
      .select("*")
      .eq("result_id", resultId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (Array.isArray(latest) && latest[0]) {
      subject = str(latest[0] as Json, "subject");
      pushBody = str(latest[0] as Json, "body");
    }
  }
  if (!pushBody) {
    const sb = subjectBodyFrom(result, "inmail");
    subject = sb.subject;
    pushBody = sb.body;
  }

  const arranged = arrangeGetSalesFields({ subject, body: pushBody });
  const leadUuid = leadUuidFrom(result, row);

  if (dryRun) {
    return sendJson(res, 200, {
      dryRun: true,
      leadUuid,
      fields: arranged.fields,
      assembledPreview: arranged.assembledPreview,
      droppedGreeting: arranged.droppedGreeting,
      warning: arranged.warning,
    });
  }

  // --- live write (gated; only when dryRun:false) ---
  const projectId = str(body, "projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required for a live push" });
  if (!leadUuid) return sendJson(res, 400, { error: "No lead_uuid resolved for this row" });

  const { credentials, error: credErr } = await getGetSalesCredentials(client, projectId);
  if (credErr) return sendJson(res, 400, { error: `GetSales credentials: ${credErr}` });
  if (!credentials) return sendJson(res, 400, { error: "GetSales credentials not configured for project" });

  try {
    const defs = await listLeadCustomFields(credentials);
    const byName = new Map(defs.map((d) => [d.name, d.uuid]));
    const fieldMap: Record<string, string> = {};
    const fieldValues = arranged.fields as unknown as Record<string, string>;
    for (const name of GETSALES_INMAIL_FIELD_NAMES) {
      let uuid = byName.get(name);
      if (!uuid) uuid = await createLeadCustomField(credentials, name);
      fieldMap[uuid] = fieldValues[name] ?? "";
    }
    await updateLeadCustomFields(credentials, leadUuid, fieldMap);

    const pushLog = { at: new Date().toISOString(), leadUuid, fields: arranged.fields };
    await client
      .from(STATE_TABLE)
      .update({ status: "pushed", push_log: pushLog, updated_at: new Date().toISOString() })
      .eq("result_id", resultId);

    sendJson(res, 200, { ok: true, leadUuid, fields: arranged.fields });
  } catch (e) {
    sendJson(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}
