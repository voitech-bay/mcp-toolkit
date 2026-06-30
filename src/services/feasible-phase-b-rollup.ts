/**
 * Build a single Feasible Phase-B-only rollup row from Supabase (contacts + phase_a).
 * Shape matches n8n "Feasible Rollup Companies" output for POST feasible-phase-b-only-trigger.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONTACTS_TABLE, COMPANIES_TABLE } from "./supabase.js";

const CONTACT_WORKFLOW_LATEST = "contact_workflow_latest";
const PHASE_A_WORKFLOW = "phase_a_contact";

import { FEASIBLE_PROJECT_ID } from "./feasible-context.js";

type Json = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function locationFromContact(c: Json): string {
  const loc = c.location;
  if (typeof loc === "string" && loc.trim()) {
    if (loc.trim().startsWith("{")) {
      try {
        const p = JSON.parse(loc) as Json;
        return [str(p.city), str(p.country)].filter(Boolean).join(", ");
      } catch {
        return loc.trim();
      }
    }
    return loc.trim();
  }
  if (loc && typeof loc === "object") {
    const o = loc as Json;
    return [str(o.city), str(o.country)].filter(Boolean).join(", ");
  }
  return "";
}

function linkedinCompanyUrl(lnId: unknown): string {
  const id = str(lnId);
  return id ? `https://www.linkedin.com/company/${id}` : "";
}

function phaseAEligibility(result: Json): string {
  return (
    str(result.feasible_contact_eligibility) ||
    str(result.contact_eligibility) ||
    ""
  );
}

export interface FeasiblePhaseBRollupRow {
  company_uuid: string;
  company_name: string;
  company_domain: string;
  company_linkedin_url: string;
  company_headquarter: string;
  hq_location: Json | null;
  website: string;
  count_of_followers: number | null;
  count_of_employees_linkedin: number | null;
  company_industry: string;
  company_type_tag: string;
  relevant_contacts_bundle: Json[];
  excluded_contacts: Json[];
  phase_a_failed_contacts: Json[];
  relevant_contact_count: number;
  relevant_contact_count_with_review: number;
  excluded_contact_count: number;
  phase_a_failed_count: number;
  source_list_contact_count: number;
}

export async function buildFeasiblePhaseBRollupForCompany(
  client: SupabaseClient,
  companyId: string,
  opts?: { defaultCompanyTypeTag?: string }
): Promise<{ rollup: FeasiblePhaseBRollupRow | null; error: string | null }> {
  const id = companyId.trim();
  if (!id) return { rollup: null, error: "companyId is required" };

  const { data: company, error: coErr } = await client
    .from(COMPANIES_TABLE)
    .select(
      "id, name, domain, website, linkedin, industry, employees_on_linkedin, hq_location, hq_raw_address"
    )
    .eq("id", id)
    .maybeSingle();
  if (coErr) return { rollup: null, error: coErr.message };

  const { data: contacts, error: cErr } = await client
    .from(CONTACTS_TABLE)
    .select(
      "uuid, name, first_name, last_name, position, headline, linkedin, linkedin_url, location, company_uuid, company_name, company_ln_id, followers_number, employees_on_linkedin"
    )
    .or(`company_id.eq.${id},company_uuid.eq.${id}`)
    .limit(200);
  if (cErr) return { rollup: null, error: cErr.message };
  const roster = (contacts ?? []) as Json[];
  if (!roster.length && !company) {
    return { rollup: null, error: "Company not found and no contacts linked" };
  }

  const companyUuid =
    str(roster[0]?.company_uuid) || str(company?.id) || id;
  const co = (company ?? {}) as Json;
  const domain =
    str(co.domain) ||
    (str(co.website).replace(/^https?:\/\//, "").split("/")[0] ?? "");
  const website = domain
    ? domain.startsWith("http")
      ? domain
      : `https://${domain}`
    : "";

  let hq = "";
  let hqLocation: Json | null = null;
  if (co.hq_location && typeof co.hq_location === "object") {
    hqLocation = co.hq_location as Json;
    hq = [str(hqLocation.city), str(hqLocation.country)].filter(Boolean).join(", ");
  }
  if (!hq && typeof co.hq_raw_address === "string") hq = co.hq_raw_address.trim();

  const leadUuids = roster.map((r) => str(r.uuid)).filter(Boolean);
  const phaseAByLead = new Map<string, Json>();
  if (leadUuids.length) {
    const { data: phaseRows } = await client
      .from(CONTACT_WORKFLOW_LATEST)
      .select("contact_id, result")
      .eq("workflow_name", PHASE_A_WORKFLOW)
      .in("contact_id", leadUuids);
    for (const row of (phaseRows ?? []) as Json[]) {
      const lid = str(row.contact_id);
      if (lid) phaseAByLead.set(lid, (row.result as Json) ?? {});
    }
  }

  const relevant_contacts_bundle: Json[] = [];
  const excluded_contacts: Json[] = [];
  const phase_a_failed_contacts: Json[] = [];
  let followersMax: number | null = null;
  let employeesMax: number | null =
    typeof co.employees_on_linkedin === "number" ? co.employees_on_linkedin : null;

  for (const c of roster) {
    const leadUuid = str(c.uuid);
    const pa = phaseAByLead.get(leadUuid) ?? {};
    const elig = phaseAEligibility(pa);
    const fullName =
      str(c.name) ||
      [str(c.first_name), str(c.last_name)].filter(Boolean).join(" ").trim();
    const linkedinUrl =
      str(c.linkedin_url) ||
      (str(c.linkedin).startsWith("http")
        ? str(c.linkedin)
        : str(c.linkedin)
          ? `https://www.linkedin.com/in/${str(c.linkedin)}`
          : "");

    const fn = c.followers_number != null ? Number(c.followers_number) : NaN;
    if (Number.isFinite(fn) && (followersMax == null || fn > followersMax)) followersMax = fn;
    const em = c.employees_on_linkedin != null ? Number(c.employees_on_linkedin) : NaN;
    if (Number.isFinite(em) && (employeesMax == null || em > employeesMax)) employeesMax = em;

    if (!elig) {
      if (pa.phase_a_ok === false) {
        phase_a_failed_contacts.push({
          lead_uuid: leadUuid,
          name: fullName,
          position: str(c.position),
          linkedin_url: linkedinUrl,
          phase_a_error: "phase_a_parse_failed",
        });
      }
      continue;
    }

    if (elig === "wrong_person") {
      excluded_contacts.push({
        lead_uuid: leadUuid,
        name: fullName,
        position: str(c.position),
        linkedin_url: linkedinUrl,
        wrong_person_reason: str(pa.wrong_person_reason) || "other_non_cyber",
      });
      continue;
    }

    if (elig === "include" || elig === "review") {
      relevant_contacts_bundle.push({
        lead_uuid: leadUuid,
        name: fullName,
        role_family: str(pa.role_family) || "IT_security_generalist",
        seniority: str(pa.seniority) || "mid",
        cyber_scope_summary: str(pa.cyber_scope_summary),
        linkedin_url: linkedinUrl,
        position: str(c.position),
        location: locationFromContact(c),
        needs_web_evidence: Boolean(pa.needs_web_evidence),
        phase_a_eligibility: elig,
        linkedin_evidence_quote: str(pa.linkedin_evidence_quote),
        name_normalized: Boolean(pa.name_normalized),
      });
    }
  }

  const includeOnly = relevant_contacts_bundle.filter(
    (x) => str(x.phase_a_eligibility) === "include"
  );

  const rollup: FeasiblePhaseBRollupRow = {
    company_uuid: companyUuid,
    company_name: str(co.name) || str(roster[0]?.company_name) || "",
    company_domain: domain,
    company_linkedin_url: linkedinCompanyUrl(co.linkedin ?? roster[0]?.company_ln_id),
    company_headquarter: hq,
    hq_location: hqLocation,
    website,
    count_of_followers: followersMax,
    count_of_employees_linkedin: employeesMax,
    company_industry: str(co.industry),
    company_type_tag: opts?.defaultCompanyTypeTag?.trim() || "",
    relevant_contacts_bundle,
    excluded_contacts,
    phase_a_failed_contacts,
    relevant_contact_count: includeOnly.length,
    relevant_contact_count_with_review: relevant_contacts_bundle.length,
    excluded_contact_count: excluded_contacts.length,
    phase_a_failed_count: phase_a_failed_contacts.length,
    source_list_contact_count: roster.length,
  };

  return { rollup, error: null };
}

export function feasiblePhaseBOnlyWebhookUrl(): string | null {
  const direct = process.env.N8N_FEASIBLE_PHASE_B_ONLY_WEBHOOK_URL?.trim();
  if (direct) return direct;
  const base = (process.env.N8N_URL || process.env.N8N_WEBHOOK_BASE_URL || "").trim().replace(/\/$/, "");
  if (!base) return null;
  const origin = base.replace(/\/api\/v1$/, "");
  return `${origin}/webhook/feasible-phase-b-only-trigger`;
}
