/**
 * HTTP handlers for the lead-views feature (Pipeline > n8n results > Lead views).
 * Additive and self-contained: reuses Supabase. Routes registered in api-server.ts.
 *
 * Buckets research rows from public.n8n_workflow_results into Best Fit / Review /
 * Disqualified using the Phase A/B classification fields, and overlays an
 * approve/refuse decision stored in public.lead_review_state (see
 * scripts/lead-review-schema.sql). Mirrors the inmail-review handler style.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { getSupabase, N8N_WORKFLOW_RESULTS_TABLE } from "./services/supabase.js";

const STATE_TABLE = "lead_review_state";
const MAX_ROWS = 1000;

type Json = Record<string, unknown>;
export type LeadView = "best_fit" | "review" | "disqualified";

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

/** First scalar value for `key`, searching top-level then nested objects (bounded). */
function pickField(obj: unknown, key: string, depth = 0): string {
  if (!obj || typeof obj !== "object" || depth > 4) return "";
  const rec = obj as Json;
  const direct = rec[key];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (typeof direct === "number") return String(direct);
  for (const v of Object.values(rec)) {
    if (v && typeof v === "object") {
      const nested = pickField(v, key, depth + 1);
      if (nested) return nested;
    }
  }
  return "";
}

interface ParsedLead {
  result_id: string;
  contact_id: string | null;
  company_id: string | null;
  lead_uuid: string;
  workflow: string;
  created_at: string;
  // Phase A/B fields
  contact_eligibility: string;
  ad_spend_potential: string;
  company_type_tag: string;
  ai_self_sufficiency_risk: string;
  role: string;
  channel_affinity: string;
  paid_media_responsibility: string;
  company_name: string;
  name: string;
  position: string;
  linkedin_url: string | null;
  dq_reason: string;
  wrong_person_reason: string;
  proof: string;
  pov: string;
  view: LeadView;
}

function classify(p: {
  contact_eligibility: string;
  ad_spend_potential: string;
  company_type_tag: string;
  ai_self_sufficiency_risk: string;
}): LeadView {
  const elig = p.contact_eligibility.toLowerCase();
  if (elig === "review") return "review";
  const bestFit =
    elig === "include" &&
    ["high", "medium"].includes(p.ad_spend_potential.toLowerCase()) &&
    !["ai_martech", "unclear"].includes(p.company_type_tag.toLowerCase()) &&
    !["medium", "high"].includes(p.ai_self_sufficiency_risk.toLowerCase());
  return bestFit ? "best_fit" : "disqualified";
}

function parseRow(row: Json): ParsedLead | null {
  const result = (row.result as Json) ?? {};
  const contact_eligibility = pickField(result, "contact_eligibility");
  // Lead-views only covers research rows (those carry an eligibility classification).
  if (!contact_eligibility) return null;
  const fields = {
    contact_eligibility,
    ad_spend_potential: pickField(result, "ad_spend_potential"),
    company_type_tag: pickField(result, "company_type_tag"),
    ai_self_sufficiency_risk: pickField(result, "ai_self_sufficiency_risk"),
  };
  const linkedin = pickField(result, "linkedin_url") || pickField(result, "linkedin");
  const first = pickField(result, "first_name");
  const last = pickField(result, "last_name");
  const nameJoined = `${first} ${last}`.trim() || pickField(result, "name");
  return {
    result_id: String(row.id ?? ""),
    contact_id: typeof row.contact_id === "string" ? row.contact_id : null,
    company_id: typeof row.company_id === "string" ? row.company_id : null,
    lead_uuid: pickField(result, "lead_uuid") || (typeof row.contact_id === "string" ? row.contact_id : ""),
    workflow: typeof row.workflow === "string" ? row.workflow : "",
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    ...fields,
    role: pickField(result, "role"),
    channel_affinity: pickField(result, "channel_affinity"),
    paid_media_responsibility: pickField(result, "paid_media_responsibility"),
    company_name: pickField(result, "company_name"),
    name: nameJoined,
    position: pickField(result, "position") || pickField(result, "title"),
    linkedin_url: linkedin || null,
    dq_reason: pickField(result, "dq_reason"),
    wrong_person_reason: pickField(result, "wrong_person_reason"),
    proof: pickField(result, "proof"),
    pov: pickField(result, "pov"),
    view: classify(fields),
  };
}

// --- POST /api/lead-review/items --------------------------------------------
// Body: { launchId?, executionId?, view?, limit? }
export async function handleLeadReviewItems(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const body = await readJsonBody(req);
  const launchId = typeof body.launchId === "string" ? body.launchId.trim() : "";
  const executionId = typeof body.executionId === "string" ? body.executionId.trim() : "";
  const view = typeof body.view === "string" ? (body.view as LeadView) : null;
  const limit = Math.min(Math.max(Number(body.limit) || 300, 1), MAX_ROWS);

  let query = client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("id,contact_id,company_id,workflow,created_at,result")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (launchId) query = query.contains("result", { launch_id: launchId });
  else if (executionId) query = query.eq("execution_id", executionId);

  const { data, error } = await query;
  if (error) return sendJson(res, 500, { error: error.message });

  const parsed: ParsedLead[] = [];
  for (const row of (data ?? []) as Json[]) {
    const p = parseRow(row);
    if (p) parsed.push(p);
  }

  // Overlay review decisions.
  const ids = parsed.map((p) => p.result_id).filter(Boolean);
  const decisionByResult: Record<string, { status: string; reason: string | null }> = {};
  if (ids.length) {
    const { data: states } = await client.from(STATE_TABLE).select("result_id,status,reason").in("result_id", ids);
    for (const s of (states ?? []) as Json[]) {
      const rid = typeof s.result_id === "string" ? s.result_id : "";
      if (rid) decisionByResult[rid] = { status: String(s.status ?? "pending"), reason: (s.reason as string) ?? null };
    }
  }

  const counts = { best_fit: 0, review: 0, disqualified: 0 };
  const items = parsed.map((p) => {
    counts[p.view] += 1;
    const decision = decisionByResult[p.result_id];
    return {
      ...p,
      decision_status: decision?.status ?? "pending",
      decision_reason: decision?.reason ?? null,
    };
  });

  const filtered = view ? items.filter((i) => i.view === view) : items;
  sendJson(res, 200, { items: filtered, counts, total: items.length });
}

// --- POST /api/lead-review/decide -------------------------------------------
// Body: { resultId, decision: 'approved'|'refused'|'pending', reason?, leadUuid? }
export async function handleLeadReviewDecide(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const body = await readJsonBody(req);
  const resultId = typeof body.resultId === "string" ? body.resultId.trim() : "";
  const decision = typeof body.decision === "string" ? body.decision.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : null;
  const leadUuid = typeof body.leadUuid === "string" ? body.leadUuid.trim() : null;
  if (!resultId) return sendJson(res, 400, { error: "resultId is required" });
  if (!["approved", "refused", "pending"].includes(decision)) {
    return sendJson(res, 400, { error: "decision must be approved | refused | pending" });
  }

  const { error } = await client.from(STATE_TABLE).upsert(
    {
      result_id: resultId,
      lead_uuid: leadUuid,
      status: decision,
      reason,
      decided_at: decision === "pending" ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "result_id" }
  );
  if (error) return sendJson(res, 500, { error: error.message });
  sendJson(res, 200, { ok: true, resultId, status: decision });
}
