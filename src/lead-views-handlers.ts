/**
 * Lead-views (Feasible): triage phase_b_company POV research into Best Fit / Review /
 * Disqualified at the COMPANY level, each company expandable to its relevant contacts
 * (relevant_contacts_bundle). A manual approve/refuse decision is stored as a marker on
 * the companies row (qualification_status / qualification_decided_at — see
 * scripts/lead-qualification-schema.sql).
 *
 * Source: n8n_workflow_results where workflow_name = 'phase_b_company', latest per company.
 * Routes registered in api-server.ts. Additive and self-contained.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { getSupabase, N8N_WORKFLOW_RESULTS_TABLE, COMPANIES_TABLE } from "./services/supabase.js";

const PHASE_B_WORKFLOW = "phase_b_company";
const MAX_ROWS = 800;

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

function str(obj: Json, key: string): string {
  const v = obj[key];
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}
function num(obj: Json, key: string): number {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

interface BundleContact {
  lead_uuid: string;
  name: string;
  position: string;
  linkedin_url: string | null;
  role_family: string;
  seniority: string;
  tier: string;
  phase_a_eligibility: string;
}

/** relevant_contacts_bundle is an array of contact objects; tag each with its tier from contact_tiers. */
function parseBundle(result: Json): BundleContact[] {
  const raw = result.relevant_contacts_bundle;
  const arr: Json[] = Array.isArray(raw)
    ? (raw as Json[])
    : raw && typeof raw === "object"
      ? (Object.values(raw as Json) as Json[])
      : [];
  // Map lead_uuid -> tier from contact_tiers { tier_1:[{name,..}], tier_2:[], secondary:[] }
  const tierByName = new Map<string, string>();
  const tiers = (result.contact_tiers as Json) ?? {};
  for (const tierKey of Object.keys(tiers)) {
    const list = (tiers as Json)[tierKey];
    if (Array.isArray(list)) {
      for (const c of list as Json[]) {
        const nm = str(c, "name").toLowerCase();
        if (nm) tierByName.set(nm, tierKey);
      }
    }
  }
  const out: BundleContact[] = [];
  for (const c of arr) {
    if (!c || typeof c !== "object") continue;
    const lead = str(c, "lead_uuid");
    if (!lead) continue;
    out.push({
      lead_uuid: lead,
      name: str(c, "name"),
      position: str(c, "position"),
      linkedin_url: str(c, "linkedin_url") || null,
      role_family: str(c, "role_family"),
      seniority: str(c, "seniority"),
      tier: tierByName.get(str(c, "name").toLowerCase()) || "",
      phase_a_eligibility: str(c, "phase_a_eligibility"),
    });
  }
  return out;
}

function classify(result: Json): LeadView {
  const companyType = str(result, "company_type_tag").toLowerCase();
  const fit = str(result, "fit_status").toLowerCase();
  const hardExcluded = result.hard_exclusion === true;
  if (hardExcluded || companyType === "not_relevant" || fit === "not_icp") return "disqualified";

  const fitEligible =
    result.phase_b_ok === true &&
    ["direct_customer", "services_mssp"].includes(companyType) &&
    ["tier_1", "tier_2"].includes(fit);
  if (!fitEligible) return "disqualified";

  const hasReviewContacts = num(result, "relevant_contact_count_with_review") > num(result, "relevant_contact_count");
  const highCompeting = str(result, "competing_product_risk").toLowerCase() === "high";
  if (hasReviewContacts || highCompeting) return "review";
  return "best_fit";
}

interface CompanyRow {
  result_id: string;
  company_id: string | null;
  company_name: string;
  company_domain: string;
  company_type_tag: string;
  fit_status: string;
  motion: string;
  competing_product_risk: string;
  hard_exclusion: boolean;
  hard_exclusion_reason: string;
  relevant_contact_count: number;
  pov_markdown: string;
  research_one_liner: string;
  created_at: string;
  view: LeadView;
  contacts: BundleContact[];
  qualification_status: string;
  qualification_decided_at: string | null;
}

// --- POST /api/lead-views/items ---------------------------------------------
// Body: { launchId?, executionId?, view?, limit? }
export async function handleLeadViewsItems(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const body = await readJsonBody(req);
  const launchId = typeof body.launchId === "string" ? body.launchId.trim() : "";
  const executionId = typeof body.executionId === "string" ? body.executionId.trim() : "";
  const view = typeof body.view === "string" ? (body.view as LeadView) : null;
  const limit = Math.min(Math.max(Number(body.limit) || 300, 1), MAX_ROWS);

  let q = client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("company_id, result, created_at, execution_id")
    .eq("workflow_name", PHASE_B_WORKFLOW)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (launchId) q = q.contains("result", { launch_id: launchId });
  else if (executionId) q = q.eq("execution_id", executionId);
  const { data, error } = await q;
  if (error) return sendJson(res, 500, { error: error.message });

  // Latest row per company.
  const seen = new Set<string>();
  const parsed: Omit<CompanyRow, "qualification_status" | "qualification_decided_at">[] = [];
  for (const row of (data ?? []) as Json[]) {
    const result = (row.result as Json) ?? {};
    const companyId =
      (typeof row.company_id === "string" && row.company_id) || str(result, "company_uuid") || "";
    const dedupKey = companyId || str(result, "company_name");
    if (!dedupKey || seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    parsed.push({
      result_id: dedupKey,
      company_id: companyId || null,
      company_name: str(result, "company_name"),
      company_domain: str(result, "company_domain"),
      company_type_tag: str(result, "company_type_tag"),
      fit_status: str(result, "fit_status"),
      motion: str(result, "motion"),
      competing_product_risk: str(result, "competing_product_risk"),
      hard_exclusion: result.hard_exclusion === true,
      hard_exclusion_reason: str(result, "hard_exclusion_reason"),
      relevant_contact_count: num(result, "relevant_contact_count"),
      pov_markdown: str(result, "pov_markdown"),
      research_one_liner: str(result, "research_company_one_liner") || str(result, "research_summary"),
      created_at: typeof row.created_at === "string" ? row.created_at : "",
      view: classify(result),
      contacts: parseBundle(result),
    });
  }

  // Overlay the qualification marker from the companies table.
  const ids = parsed.map((p) => p.company_id).filter((x): x is string => Boolean(x));
  const qualById = new Map<string, { status: string; at: string | null }>();
  if (ids.length) {
    const { data: comps } = await client
      .from(COMPANIES_TABLE)
      .select("id, qualification_status, qualification_decided_at")
      .in("id", ids);
    for (const c of (comps ?? []) as Json[]) {
      qualById.set(String(c.id), {
        status: typeof c.qualification_status === "string" ? c.qualification_status : "pending",
        at: (c.qualification_decided_at as string | null) ?? null,
      });
    }
  }

  const counts = { best_fit: 0, review: 0, disqualified: 0 };
  const items: CompanyRow[] = parsed.map((p) => {
    counts[p.view] += 1;
    const qual = p.company_id ? qualById.get(p.company_id) : undefined;
    return {
      ...p,
      qualification_status: qual?.status || "pending",
      qualification_decided_at: qual?.at ?? null,
    };
  });

  const filtered = view ? items.filter((i) => i.view === view) : items;
  sendJson(res, 200, { items: filtered, counts, total: items.length });
}

// --- POST /api/lead-views/decide --------------------------------------------
// Body: { companyId, decision: 'approved'|'refused'|'pending' }
export async function handleLeadViewsDecide(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const body = await readJsonBody(req);
  const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
  const decision = typeof body.decision === "string" ? body.decision.trim() : "";
  if (!companyId) return sendJson(res, 400, { error: "companyId is required" });
  if (!["approved", "refused", "pending"].includes(decision)) {
    return sendJson(res, 400, { error: "decision must be approved | refused | pending" });
  }
  const { error } = await client
    .from(COMPANIES_TABLE)
    .update({
      qualification_status: decision,
      qualification_decided_at: decision === "pending" ? null : new Date().toISOString(),
    })
    .eq("id", companyId);
  if (error) return sendJson(res, 500, { error: error.message });
  sendJson(res, 200, { ok: true, companyId, status: decision });
}
