/**
 * Resolve Velvetech n8n result rows to Contacts / companies FKs.
 * Velvetech pipelines stamp company_key (domain) and entity_key (domain or LinkedIn slug)
 * instead of company_uuid / lead_uuid.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { COMPANIES_TABLE, CONTACTS_TABLE, N8N_WORKFLOW_RESULTS_TABLE } from "./supabase.js";

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

export function normalizeDomain(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]?.split("?")[0] ?? "";
  if (!s || !DOMAIN_RE.test(s)) return null;
  return s;
}

export function linkedinSlugFromUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (m?.[1]) return m[1].toLowerCase();
  if (!trimmed.includes("/") && !trimmed.includes(".")) return trimmed.toLowerCase();
  return null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nestedObject(item: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = item[key];
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Domain from Velvetech company_key / entity_key / company_domain fields. */
export function extractCompanyDomainFromItem(item: Record<string, unknown>): string | null {
  for (const key of ["company_key", "company_domain", "entity_key"] as const) {
    const domain = normalizeDomain(stringField(item[key]));
    if (domain) return domain;
  }
  const contact = nestedObject(item, "contact");
  if (contact) {
    const fromContact = normalizeDomain(stringField(contact.company_domain));
    if (fromContact) return fromContact;
  }
  const payload = nestedObject(item, "item_payload");
  const lead = nestedObject(item, "lead") ?? (payload ? nestedObject(payload, "lead") : null);
  if (lead) {
    const fromLead = normalizeDomain(stringField(lead.company_domain));
    if (fromLead) return fromLead;
  }
  return null;
}

/** LinkedIn slug from Velvetech contact / lead / enrichment fields. */
export function extractLinkedinSlugFromItem(item: Record<string, unknown>): string | null {
  for (const key of ["contact_key", "entity_key"] as const) {
    const raw = stringField(item[key]);
    if (raw && !normalizeDomain(raw)) {
      const slug = linkedinSlugFromUrl(raw) ?? raw.toLowerCase();
      if (slug && !DOMAIN_RE.test(slug)) return slug;
    }
  }
  const contact = nestedObject(item, "contact");
  if (contact) {
    const slug = linkedinSlugFromUrl(stringField(contact.linkedin_url) ?? stringField(contact.linkedin));
    if (slug) return slug;
  }
  const enrichment = nestedObject(item, "enrichment");
  if (enrichment) {
    const slug = linkedinSlugFromUrl(stringField(enrichment.linkedin_url));
    if (slug) return slug;
  }
  const payload = nestedObject(item, "item_payload");
  const lead = nestedObject(item, "lead") ?? (payload ? nestedObject(payload, "lead") : null);
  if (lead) {
    const slug = linkedinSlugFromUrl(stringField(lead.linkedin) ?? stringField(lead.linkedin_url));
    if (slug) return slug;
  }
  return null;
}

export function isVelvetechWorkflowName(workflowName: string): boolean {
  return workflowName.toLowerCase().startsWith("velvetech");
}

function nestedLaunchOrRunId(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const el of value) {
      const found = nestedLaunchOrRunId(el, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = value as Record<string, unknown>;
  for (const key of ["launch_id", "run_id"] as const) {
    const raw = obj[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  for (const v of Object.values(obj)) {
    const found = nestedLaunchOrRunId(v, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Ensure ingest rows carry both launch_id and run_id when either is present in the payload. */
export function normalizeLaunchIdInItem(item: Record<string, unknown>): Record<string, unknown> {
  const out = { ...item };
  const topLaunch = stringField(out.launch_id);
  const topRun = stringField(out.run_id);
  const nested = nestedLaunchOrRunId(out);
  const launchId = topLaunch || topRun || nested;
  if (!launchId) return out;
  if (!out.launch_id) out.launch_id = launchId;
  if (!out.run_id) out.run_id = launchId;
  return out;
}

/** Company-grain Velvetech stages (no contact_id on the row). */
export function isVelvetechCompanyGrainItem(item: Record<string, unknown>): boolean {
  const wf = stringField(item.workflow_name) ?? "";
  if (wf === "velvetech-pov") return true;
  if (wf.startsWith("velvetech-company")) return true;
  if (wf === "velvetech-icp-gate" || wf === "velvetech-company-gate") return true;
  const domain = extractCompanyDomainFromItem(item);
  const slug = extractLinkedinSlugFromItem(item);
  return Boolean(domain && !slug);
}
const SLUG_CHUNK = 40;

const DOMAIN_CHUNK = 200;

export async function loadCompanyIdsByDomains(
  client: SupabaseClient,
  domains: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(domains.map((d) => normalizeDomain(d)).filter(Boolean))] as string[];
  for (let i = 0; i < unique.length; i += DOMAIN_CHUNK) {
    const batch = unique.slice(i, i + DOMAIN_CHUNK);
    const { data, error } = await client.from(COMPANIES_TABLE).select("id, domain").in("domain", batch);
    if (error) continue;
    for (const row of (data ?? []) as Array<{ id: string; domain: string | null }>) {
      const domain = normalizeDomain(row.domain);
      if (domain && row.id) map.set(domain, row.id);
    }
  }
  return map;
}

export async function loadContactUuidsByLinkedinSlugs(
  client: SupabaseClient,
  slugs: string[],
  projectId?: string | null
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(slugs.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  for (let i = 0; i < unique.length; i += SLUG_CHUNK) {
    const batch = unique.slice(i, i + SLUG_CHUNK);
    for (const slug of batch) {
      let query = client
        .from(CONTACTS_TABLE)
        .select("uuid, linkedin, linkedin_url")
        .or(`linkedin.ilike.%${slug}%,linkedin_url.ilike.%${slug}%`)
        .limit(5);
      if (projectId) query = query.eq("project_id", projectId);
      const { data } = await query;
      for (const row of (data ?? []) as Array<{ uuid: string; linkedin?: string | null; linkedin_url?: string | null }>) {
        const hay = `${row.linkedin ?? ""} ${row.linkedin_url ?? ""}`.toLowerCase();
        if (hay.includes(slug) && row.uuid) {
          map.set(slug, row.uuid);
          break;
        }
      }
    }
  }
  return map;
}

export interface VelvetechLinkResolution {
  contactId: string | null;
  companyId: string | null;
  companyDomain: string | null;
  linkedinSlug: string | null;
  companyGrain: boolean;
}

export function resolveVelvetechLinksFromItem(
  item: Record<string, unknown>,
  companyByDomain: Map<string, string>,
  contactByLinkedin: Map<string, string>,
  contactProjByUuid: Map<string, string>,
  companyExists: Set<string>,
  leadUuid: string | null,
  companyUuidRaw: string | null
): VelvetechLinkResolution {
  const wfItem = {
    ...item,
    workflow_name: stringField(item.workflow_name) ?? "",
  };
  const companyGrain = isVelvetechCompanyGrainItem(wfItem);

  const companyDomain = extractCompanyDomainFromItem(item);
  const linkedinSlug = extractLinkedinSlugFromItem(item);

  let companyId: string | null =
    companyUuidRaw && companyExists.has(companyUuidRaw) ? companyUuidRaw : null;
  if (!companyId && companyDomain) {
    companyId = companyByDomain.get(companyDomain) ?? null;
  }

  let contactId: string | null = null;
  if (!companyGrain) {
    if (leadUuid && contactProjByUuid.has(leadUuid)) contactId = leadUuid;
    else if (linkedinSlug) contactId = contactByLinkedin.get(linkedinSlug) ?? null;
  }

  return { contactId, companyId, companyDomain, linkedinSlug, companyGrain };
}

export async function backfillVelvetechN8nResultLinks(
  client: SupabaseClient,
  opts?: { limit?: number; projectId?: string | null }
): Promise<{ scanned: number; updated: number; error: string | null }> {
  const limit = Math.min(Math.max(opts?.limit ?? 2000, 1), 5000);
  const { data, error } = await client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("id, contact_id, company_id, workflow_name, result")
    .like("workflow_name", "velvetech%")
    .or("contact_id.is.null,company_id.is.null")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { scanned: 0, updated: 0, error: error.message };

  const rows = (data ?? []) as Array<{
    id: string;
    contact_id: string | null;
    company_id: string | null;
    workflow_name: string | null;
    result: Record<string, unknown> | null;
  }>;

  const domains = new Set<string>();
  const slugs = new Set<string>();
  for (const row of rows) {
    const item = row.result && typeof row.result === "object" ? row.result : {};
    const wfItem = { ...item, workflow_name: row.workflow_name ?? item.workflow_name };
    const domain = extractCompanyDomainFromItem(wfItem);
    const slug = extractLinkedinSlugFromItem(wfItem);
    if (domain) domains.add(domain);
    if (slug) slugs.add(slug);
  }

  const [companyByDomain, contactByLinkedin] = await Promise.all([
    loadCompanyIdsByDomains(client, [...domains]),
    loadContactUuidsByLinkedinSlugs(client, [...slugs], opts?.projectId),
  ]);

  let updated = 0;
  for (const row of rows) {
    const item = row.result && typeof row.result === "object" ? row.result : {};
    const wfItem = { ...item, workflow_name: row.workflow_name ?? item.workflow_name };
    const companyGrain = isVelvetechCompanyGrainItem(wfItem);
    const companyDomain = extractCompanyDomainFromItem(wfItem);
    const linkedinSlug = extractLinkedinSlugFromItem(wfItem);
    const patch: { contact_id?: string; company_id?: string } = {};
    if (!row.company_id && companyDomain) {
      const companyId = companyByDomain.get(companyDomain);
      if (companyId) patch.company_id = companyId;
    }
    if (!row.contact_id && !companyGrain && linkedinSlug) {
      const contactId = contactByLinkedin.get(linkedinSlug);
      if (contactId) patch.contact_id = contactId;
    }
    if (Object.keys(patch).length === 0) continue;
    const { error: upErr } = await client.from(N8N_WORKFLOW_RESULTS_TABLE).update(patch).eq("id", row.id);
    if (!upErr) updated += 1;
  }

  return { scanned: rows.length, updated, error: null };
}

/** Supplement card views when FKs were never set but domain/slug match exists in result JSON. */
export async function fetchVelvetechResultsForCompanyDomain(
  client: SupabaseClient,
  domain: string,
  limit = 20
): Promise<Array<Record<string, unknown>>> {
  const normalized = normalizeDomain(domain);
  if (!normalized) return [];
  const { data, error } = await client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("id, workflow_name, result, created_at, execution_id, contact_id, company_id")
    .like("workflow_name", "velvetech%")
    .or(`result->>company_key.eq.${normalized},result->>entity_key.eq.${normalized}`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function fetchVelvetechResultsForContactLinkedin(
  client: SupabaseClient,
  linkedinRaw: string,
  limit = 20
): Promise<Array<Record<string, unknown>>> {
  const slug = linkedinSlugFromUrl(linkedinRaw) ?? linkedinRaw.trim().toLowerCase();
  if (!slug) return [];
  const { data, error } = await client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("id, workflow_name, result, created_at, execution_id, contact_id, company_id")
    .like("workflow_name", "velvetech%")
    .or(`result->>entity_key.eq.${slug},result->>contact_key.eq.${slug}`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as Array<Record<string, unknown>>;
}
