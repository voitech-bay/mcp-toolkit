/**
 * Wellore research SoT list + company card (wellore.* via public RPCs/views).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { welloreCompanyUuid } from "./wellore-messaging/ids.js";
import { WELLORE_PROJECT_ID, isWelloreProjectId } from "./wellore-messaging/types.js";

export { WELLORE_PROJECT_ID, isWelloreProjectId };

export interface WelloreCompanyListRow {
  id: number;
  slug: string | null;
  name: string | null;
  domain: string | null;
  website: string | null;
  linkedin_company_url: string | null;
  hq_country: string | null;
  employee_count: number | null;
  source_list: string | null;
  segment: string | null;
  best_title: string | null;
  released_count: number | null;
  upcoming_count: number | null;
  has_hit: boolean | null;
  score_total: number | null;
  score: Record<string, true | false | "unknown"> | null;
  name_quality: "ok" | "likely_app_title";
  recommended_channel: string | null;
  company_priority_segment: string | null;
  company_segment_reason: string | null;
  disqualification_reason: string | null;
  outreach_eligible_company: boolean | null;
  final_verification_status: string | null;
  identity_verification_status: string | null;
  geo_verification_status: string | null;
  size_verification_status: string | null;
  title_verification_status: string | null;
  contact_search_status: string | null;
  people_count: number;
  gp_support_count: number;
  has_verified_email: boolean;
  has_linkedin_person: boolean;
  channel_mode: string;
  contact_presence: string;
  title_preview: string[];
  crm_company_id: string;
}

export interface WelloreContactListRow {
  id: number;
  company_id: number;
  company_name: string | null;
  company_domain: string | null;
  company_final_verification_status: string | null;
  name: string | null;
  title: string | null;
  linkedin_url: string | null;
  email: string | null;
  email_status: string | null;
  source: string | null;
  icp_fit: string | null;
  fit: string | null;
  role_type: string | null;
  contact_segment: string | null;
  decision_power: string | null;
  contact_outreach_eligible: boolean | null;
  contact_exclusion_reason: string | null;
  outreach_decision: string | null;
  outreach_list: string | null;
  outreach_channel: string | null;
  verification_status: string | null;
  employer_verification_status: string | null;
  email_verification_status: string | null;
  role_fit_status: string | null;
  is_person: boolean;
  is_gp_support: boolean;
  crm_company_id: string;
}

function parseBoolParam(value: string | null | undefined): boolean | null {
  if (value == null || value === "") return null;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes"].includes(v)) return true;
  if (["0", "false", "no"].includes(v)) return false;
  return null;
}

export type ScoreBit = true | false | "unknown";

/** Only strict true is on; "unknown" stays unknown (never Boolean-coerced). */
export function normalizeScoreBit(value: unknown): ScoreBit {
  if (value === true) return true;
  if (value === false) return false;
  if (value === "unknown" || value == null) return "unknown";
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
    if (lower === "unknown") return "unknown";
  }
  return "unknown";
}

const APP_TITLE_GENRE =
  /\b(draw|paint|coloring|colouring|puzzle|racing|simulator|idle|clicker|toddler|kids?\b|baby game|games for)\b/i;

/** Heuristic: FoxData sometimes stored the Play app title as the studio name. */
export function inferNameQuality(args: {
  name: string | null;
  bestTitle: string | null;
  titlePreview?: string[];
}): "ok" | "likely_app_title" {
  const name = (args.name || "").trim();
  if (!name) return "ok";
  const best = (args.bestTitle || "").trim();
  if (best && name.toLowerCase() === best.toLowerCase()) return "likely_app_title";
  const preview = args.titlePreview ?? [];
  if (preview.some((t) => String(t).trim().toLowerCase() === name.toLowerCase())) return "likely_app_title";
  if (name.length > 55) return "likely_app_title";
  if (/ - /.test(name) && APP_TITLE_GENRE.test(name)) return "likely_app_title";
  if (APP_TITLE_GENRE.test(name) && /[:,]/.test(name)) return "likely_app_title";
  return "ok";
}

export async function listWelloreCompanies(
  client: SupabaseClient,
  options?: {
    population?: string | null;
    segment?: string | null;
    contactPresence?: string | null;
    channelMode?: string | null;
    disqualificationReason?: string | null;
    prioritySegment?: string | null;
    sourceList?: string | null;
    recommendedChannel?: string | null;
    search?: string | null;
    hqCountry?: string | null;
    hasDomain?: string | null;
    limit?: number;
    offset?: number;
    sortBy?: string | null;
    sortDirection?: "asc" | "desc";
  }
): Promise<{ data: WelloreCompanyListRow[]; total: number; error: string | null }> {
  const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
  const offset = Math.max(options?.offset ?? 0, 0);
  const { data, error } = await client.rpc("filter_wellore_companies", {
    p_population: options?.population?.trim() || "foxdata",
    p_segment: options?.segment?.trim() || "verified",
    p_contact_presence: options?.contactPresence?.trim() || null,
    p_channel_mode: options?.channelMode?.trim() || null,
    p_disqualification_reason: options?.disqualificationReason?.trim() || null,
    p_priority_segment: options?.prioritySegment?.trim() || null,
    p_source_list: options?.sourceList?.trim() || null,
    p_recommended_channel: options?.recommendedChannel?.trim() || null,
    p_search: options?.search?.trim() || null,
    p_hq_country: options?.hqCountry?.trim() || null,
    p_has_domain: options?.hasDomain?.trim() || null,
    p_limit: limit,
    p_offset: offset,
    p_sort_by: options?.sortBy ?? "name",
    p_sort_direction: options?.sortDirection ?? "asc",
  });
  if (error) return { data: [], total: 0, error: error.message };
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const total = rows.length > 0 ? Number.parseInt(String(rows[0].total_count ?? 0), 10) || 0 : 0;
  return {
    data: rows.map((r) => {
      const id = Number(r.id);
      const rawScore = r.score;
      let score: Record<string, ScoreBit> | null = null;
      if (rawScore && typeof rawScore === "object" && !Array.isArray(rawScore)) {
        score = {};
        for (const [k, v] of Object.entries(rawScore as Record<string, unknown>)) {
          if (k === "total") continue;
          score[k] = normalizeScoreBit(v);
        }
      }
      const name = (r.name as string) ?? null;
      const bestTitle = (r.best_title as string) ?? null;
      const titlePreview = Array.isArray(r.title_preview) ? (r.title_preview as string[]) : [];
      return {
        id,
        slug: (r.slug as string) ?? null,
        name,
        domain: (r.domain as string) ?? null,
        website: (r.website as string) ?? null,
        linkedin_company_url: (r.linkedin_company_url as string) ?? null,
        hq_country: (r.hq_country as string) ?? null,
        employee_count: r.employee_count == null ? null : Number(r.employee_count),
        source_list: (r.source_list as string) ?? null,
        segment: (r.segment as string) ?? null,
        best_title: bestTitle,
        released_count: r.released_count == null ? null : Number(r.released_count),
        upcoming_count: r.upcoming_count == null ? null : Number(r.upcoming_count),
        has_hit: (r.has_hit as boolean) ?? null,
        score_total: r.score_total == null ? null : Number(r.score_total),
        score,
        name_quality: inferNameQuality({ name, bestTitle, titlePreview }),
        recommended_channel: (r.recommended_channel as string) ?? null,
        company_priority_segment: (r.company_priority_segment as string) ?? null,
        company_segment_reason: (r.company_segment_reason as string) ?? null,
        disqualification_reason: (r.disqualification_reason as string) ?? null,
        outreach_eligible_company: (r.outreach_eligible_company as boolean) ?? null,
        final_verification_status: (r.final_verification_status as string) ?? null,
        identity_verification_status: (r.identity_verification_status as string) ?? null,
        geo_verification_status: (r.geo_verification_status as string) ?? null,
        size_verification_status: (r.size_verification_status as string) ?? null,
        title_verification_status: (r.title_verification_status as string) ?? null,
        contact_search_status: (r.contact_search_status as string) ?? null,
        people_count: Number(r.people_count ?? 0),
        gp_support_count: Number(r.gp_support_count ?? 0),
        has_verified_email: Boolean(r.has_verified_email),
        has_linkedin_person: Boolean(r.has_linkedin_person),
        channel_mode: String(r.channel_mode ?? "none"),
        contact_presence: String(r.contact_presence ?? "no_contacts"),
        title_preview: titlePreview,
        crm_company_id: welloreCompanyUuid(id),
      };
    }),
    total,
    error: null,
  };
}

export async function getWelloreCompaniesSummary(
  client: SupabaseClient,
  options?: { population?: string | null; segment?: string | null }
): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const { data, error } = await client.rpc("wellore_companies_summary", {
    p_population: options?.population?.trim() || "foxdata",
    p_segment: options?.segment?.trim() || "all",
  });
  if (error) return { data: null, error: error.message };
  return { data: (data as Record<string, unknown>) ?? null, error: null };
}

export async function getWelloreContactsSummary(
  client: SupabaseClient,
  options?: { population?: string | null }
): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const { data, error } = await client.rpc("wellore_contacts_summary", {
    p_population: options?.population?.trim() || "foxdata",
  });
  if (error) return { data: null, error: error.message };
  return { data: (data as Record<string, unknown>) ?? null, error: null };
}

export async function listWelloreContacts(
  client: SupabaseClient,
  options?: {
    population?: string | null;
    companySegment?: string | null;
    presence?: string | null;
    source?: string | null;
    emailStatus?: string | null;
    fit?: string | null;
    icpFit?: string | null;
    contactSegment?: string | null;
    outreachList?: string | null;
    outreachChannel?: string | null;
    outreachDecision?: string | null;
    eligible?: boolean | null;
    verificationStatus?: string | null;
    companyId?: number | null;
    search?: string | null;
    limit?: number;
    offset?: number;
    sortBy?: string | null;
    sortDirection?: "asc" | "desc";
  }
): Promise<{ data: WelloreContactListRow[]; total: number; error: string | null }> {
  const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
  const offset = Math.max(options?.offset ?? 0, 0);
  const { data, error } = await client.rpc("filter_wellore_contacts", {
    p_population: options?.population?.trim() || "foxdata",
    p_company_segment: options?.companySegment?.trim() || null,
    p_presence: options?.presence?.trim() || "people",
    p_source: options?.source?.trim() || null,
    p_email_status: options?.emailStatus?.trim() || null,
    p_fit: options?.fit?.trim() || null,
    p_icp_fit: options?.icpFit?.trim() || null,
    p_contact_segment: options?.contactSegment?.trim() || null,
    p_outreach_list: options?.outreachList?.trim() || null,
    p_outreach_channel: options?.outreachChannel?.trim() || null,
    p_outreach_decision: options?.outreachDecision?.trim() || null,
    p_eligible: options?.eligible ?? null,
    p_verification_status: options?.verificationStatus?.trim() || null,
    p_company_id: options?.companyId ?? null,
    p_search: options?.search?.trim() || null,
    p_limit: limit,
    p_offset: offset,
    p_sort_by: options?.sortBy ?? "name",
    p_sort_direction: options?.sortDirection ?? "asc",
  });
  if (error) return { data: [], total: 0, error: error.message };
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const total = rows.length > 0 ? Number.parseInt(String(rows[0].total_count ?? 0), 10) || 0 : 0;
  return {
    data: rows.map((r) => {
      const companyId = Number(r.company_id);
      return {
        id: Number(r.id),
        company_id: companyId,
        company_name: (r.company_name as string) ?? null,
        company_domain: (r.company_domain as string) ?? null,
        company_final_verification_status: (r.company_final_verification_status as string) ?? null,
        name: (r.name as string) ?? null,
        title: (r.title as string) ?? null,
        linkedin_url: (r.linkedin_url as string) ?? null,
        email: (r.email as string) ?? null,
        email_status: (r.email_status as string) ?? null,
        source: (r.source as string) ?? null,
        icp_fit: (r.icp_fit as string) ?? null,
        fit: (r.fit as string) ?? null,
        role_type: (r.role_type as string) ?? null,
        contact_segment: (r.contact_segment as string) ?? null,
        decision_power: (r.decision_power as string) ?? null,
        contact_outreach_eligible: (r.contact_outreach_eligible as boolean) ?? null,
        contact_exclusion_reason: (r.contact_exclusion_reason as string) ?? null,
        outreach_decision: (r.outreach_decision as string) ?? null,
        outreach_list: (r.outreach_list as string) ?? null,
        outreach_channel: (r.outreach_channel as string) ?? null,
        verification_status: (r.verification_status as string) ?? null,
        employer_verification_status: (r.employer_verification_status as string) ?? null,
        email_verification_status: (r.email_verification_status as string) ?? null,
        role_fit_status: (r.role_fit_status as string) ?? null,
        is_person: Boolean(r.is_person),
        is_gp_support: Boolean(r.is_gp_support),
        crm_company_id: welloreCompanyUuid(companyId),
      };
    }),
    total,
    error: null,
  };
}

export async function getWelloreCompanyCard(
  client: SupabaseClient,
  welloreId: number
): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const { data: company, error: companyErr } = await client
    .from("wellore_companies")
    .select("*")
    .eq("id", welloreId)
    .maybeSingle();
  if (companyErr) return { data: null, error: companyErr.message };
  if (!company) return { data: null, error: "Company not found" };

  const [titlesRes, contactsRes] = await Promise.all([
    client
      .from("wellore_titles")
      .select(
        "id,title,store,package_id,category,status,est_release,rating,reviews,installs_band,is_hit,country,stage,stage_confidence,stage_basis,source_url,developer_url"
      )
      .eq("company_id", welloreId)
      .order("id", { ascending: true }),
    client
      .from("wellore_contacts")
      .select(
        "id,name,title,linkedin_url,email,email_status,source,icp_fit,fit,role_type,contact_segment,decision_power,contact_outreach_eligible,outreach_decision,outreach_list,outreach_channel,verification_status,employer_verification_status,email_verification_status,role_fit_status,notes"
      )
      .eq("company_id", welloreId)
      .order("id", { ascending: true }),
  ]);

  if (titlesRes.error) return { data: null, error: titlesRes.error.message };
  if (contactsRes.error) return { data: null, error: contactsRes.error.message };

  const contacts = (contactsRes.data ?? []) as Array<Record<string, unknown>>;
  const people = contacts.filter(
    (c) =>
      String(c.source ?? "") !== "google_play_support_email" &&
      (Boolean(String(c.name ?? "").trim()) || Boolean(String(c.linkedin_url ?? "").trim()))
  );
  const gpSupport = contacts.filter((c) => String(c.source ?? "") === "google_play_support_email");

  return {
    data: {
      company: {
        ...company,
        crm_company_id: welloreCompanyUuid(welloreId),
      },
      titles: titlesRes.data ?? [],
      people,
      gp_support: gpSupport,
      counts: {
        titles: (titlesRes.data ?? []).length,
        people: people.length,
        gp_support: gpSupport.length,
      },
    },
    error: null,
  };
}

export { parseBoolParam };
