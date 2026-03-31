/**
 * Builds `entities[].data` for `resolvePromptForBatch` / `{{companies}}` CSV from
 * `companies_placeholder_config`, using batched Supabase reads.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMPANIES_CONTEXT_TABLE,
  COMPANIES_TABLE,
  CONTACTS_CONTEXT_TABLE,
  CONTACTS_TABLE,
  ENRICHMENT_AGENT_RESULTS_TABLE,
  parseCompanyTagsColumn,
  PROJECT_COMPANIES_TABLE,
} from "./supabase.js";
import {
  normalizeCompaniesPlaceholderConfig,
  sanitizeAgentKeyPart,
  type NormalizedCompaniesPlaceholderConfig,
} from "./enrichment-prompt-config.js";

const SAFE_COL = /^[a-zA-Z0-9_]+$/;

function pickCompanySelectColumns(
  cfg: NormalizedCompaniesPlaceholderConfig
): string {
  const base = ["id", "name", "domain", "tags", "linkedin"];
  const extra = cfg.include.companyBase.extraCompanyColumns.filter((c) =>
    SAFE_COL.test(c)
  );
  const set = new Set([...base, ...extra]);
  return [...set].join(",");
}

type CompanyRow = Record<string, unknown>;

/** Latest enrichment_agent_results row per (company_id, agent_name) by updated_at. */
function pickLatestAgentResults(
  rows: Array<{
    company_id: string | null;
    agent_name: string;
    agent_result: unknown;
    updated_at: string;
  }>
): Map<string, Record<string, unknown>> {
  const best = new Map<
    string,
    { company_id: string; agent_name: string; agent_result: Record<string, unknown>; t: number }
  >();
  for (const r of rows) {
    if (!r.company_id || !r.agent_name) continue;
    const ar = r.agent_result;
    if (!ar || typeof ar !== "object" || Array.isArray(ar)) continue;
    const k = `${r.company_id}::${r.agent_name}`;
    const t = new Date(r.updated_at).getTime();
    const prev = best.get(k);
    if (!prev || t >= prev.t) {
      best.set(k, {
        company_id: r.company_id,
        agent_name: r.agent_name,
        agent_result: ar as Record<string, unknown>,
        t,
      });
    }
  }
  const out = new Map<string, Record<string, unknown>>();
  for (const v of best.values()) {
    out.set(`${v.company_id}::${v.agent_name}`, v.agent_result);
  }
  return out;
}

async function fetchCompaniesBatch(
  client: SupabaseClient,
  ids: string[],
  cfg: NormalizedCompaniesPlaceholderConfig
): Promise<{ data: CompanyRow[]; error: string | null }> {
  if (ids.length === 0) return { data: [], error: null };
  if (!cfg.include.companyBase.enabled) return { data: [], error: null };
  const { data, error } = await client
    .from(COMPANIES_TABLE)
    .select(pickCompanySelectColumns(cfg))
    .in("id", ids);
  if (error) return { data: [], error: error.message };
  return { data: ((data ?? []) as unknown) as CompanyRow[], error: null };
}

async function fetchProjectCompaniesBatch(
  client: SupabaseClient,
  projectId: string,
  companyIds: string[]
): Promise<{
  data: Array<{
    id: string;
    company_id: string;
    status: string | null;
    created_at: string;
    companies: Record<string, unknown> | null;
    hypothesis_targets: unknown[] | null;
  }>;
  error: string | null;
}> {
  if (companyIds.length === 0) return { data: [], error: null };
  const { data, error } = await client
    .from(PROJECT_COMPANIES_TABLE)
    .select(
      `id, status, created_at, company_id,
       companies!inner(id, name, domain, linkedin, tags),
       hypothesis_targets(hypothesis_id, hypotheses(id, name))`
    )
    .eq("project_id", projectId)
    .in("company_id", companyIds);
  if (error) return { data: [], error: error.message };
  return {
    data: ((data ?? []) as unknown) as Array<{
      id: string;
      company_id: string;
      status: string | null;
      created_at: string;
      companies: Record<string, unknown> | null;
      hypothesis_targets: unknown[] | null;
    }>,
    error: null,
  };
}

async function fetchContactCountsByCompany(
  client: SupabaseClient,
  companyIds: string[]
): Promise<{ data: Record<string, number>; error: string | null }> {
  const counts: Record<string, number> = Object.fromEntries(
    companyIds.map((id) => [id, 0])
  );
  if (companyIds.length === 0) return { data: counts, error: null };
  const { data, error } = await client
    .from(CONTACTS_TABLE)
    .select("company_id")
    .in("company_id", companyIds);
  if (error) return { data: counts, error: error.message };
  for (const row of (data ?? []) as Array<{ company_id: string | null }>) {
    const cid = row.company_id;
    if (cid && cid in counts) counts[cid] += 1;
  }
  return { data: counts, error: null };
}

async function fetchLatestCompanyContexts(
  client: SupabaseClient,
  companyIds: string[]
): Promise<{ data: Map<string, { rootContext: string | null }>; error: string | null }> {
  const map = new Map<string, { rootContext: string | null }>();
  if (companyIds.length === 0) return { data: map, error: null };
  const { data, error } = await client
    .from(COMPANIES_CONTEXT_TABLE)
    .select("company_id, rootContext, created_at")
    .in("company_id", companyIds)
    .order("created_at", { ascending: false });
  if (error) return { data: map, error: error.message };
  for (const row of (data ?? []) as Array<{
    company_id: string | null;
    rootContext: string | null;
  }>) {
    const cid = row.company_id;
    if (cid && !map.has(cid)) {
      map.set(cid, { rootContext: row.rootContext ?? null });
    }
  }
  return { data: map, error: null };
}

async function fetchContactsContextBlobByCompany(
  client: SupabaseClient,
  companyIds: string[]
): Promise<{ data: Map<string, string>; error: string | null }> {
  const out = new Map<string, string>();
  if (companyIds.length === 0) return { data: out, error: null };

  const { data: contacts, error: cErr } = await client
    .from(CONTACTS_TABLE)
    .select("uuid, company_id")
    .in("company_id", companyIds);
  if (cErr) return { data: out, error: cErr.message };

  const byCompany = new Map<string, string[]>();
  for (const row of (contacts ?? []) as Array<{
    uuid: string | null;
    company_id: string | null;
  }>) {
    const cid = row.company_id;
    const u = row.uuid;
    if (!cid || !u) continue;
    if (!byCompany.has(cid)) byCompany.set(cid, []);
    const arr = byCompany.get(cid)!;
    if (arr.length < 40) arr.push(u);
  }

  const allUuids = [...new Set([...byCompany.values()].flat())];
  if (allUuids.length === 0) return { data: out, error: null };

  const { data: ctxRows, error: ctxErr } = await client
    .from(CONTACTS_CONTEXT_TABLE)
    .select("contact_id, rootContext, created_at")
    .in("contact_id", allUuids)
    .order("created_at", { ascending: false });
  if (ctxErr) return { data: out, error: ctxErr.message };

  const latestByContact = new Map<string, string | null>();
  for (const row of (ctxRows ?? []) as Array<{
    contact_id: string | null;
    rootContext: string | null;
  }>) {
    const cid = row.contact_id;
    if (cid && !latestByContact.has(cid)) {
      latestByContact.set(cid, row.rootContext ?? null);
    }
  }

  for (const [compId, uuids] of byCompany) {
    const parts: Record<string, string | null> = {};
    for (const u of uuids) {
      if (latestByContact.has(u)) parts[u] = latestByContact.get(u) ?? null;
    }
    if (Object.keys(parts).length > 0) {
      out.set(compId, JSON.stringify(parts));
    }
  }
  return { data: out, error: null };
}

async function fetchOtherAgentResults(
  client: SupabaseClient,
  projectId: string,
  companyIds: string[],
  agentNames: string[]
): Promise<{
  data: Map<string, Map<string, Record<string, unknown>>>;
  error: string | null;
}> {
  const byCompany = new Map<string, Map<string, Record<string, unknown>>>();
  if (companyIds.length === 0 || agentNames.length === 0) {
    return { data: byCompany, error: null };
  }
  const { data, error } = await client
    .from(ENRICHMENT_AGENT_RESULTS_TABLE)
    .select("company_id, agent_name, agent_result, updated_at")
    .eq("project_id", projectId)
    .in("company_id", companyIds)
    .in("agent_name", agentNames);
  if (error) return { data: byCompany, error: error.message };

  const rows = (data ?? []) as Array<{
    company_id: string | null;
    agent_name: string;
    agent_result: unknown;
    updated_at: string;
  }>;
  const latest = pickLatestAgentResults(
    rows.filter((r): r is typeof r & { company_id: string } => r.company_id != null)
  );

  for (const [compKey, ar] of latest) {
    const sep = compKey.indexOf("::");
    if (sep < 0) continue;
    const cid = compKey.slice(0, sep);
    const an = compKey.slice(sep + 2);
    if (!byCompany.has(cid)) byCompany.set(cid, new Map());
    byCompany.get(cid)!.set(an, ar);
  }
  return { data: byCompany, error: null };
}

function buildHypothesisList(
  hypothesis_targets: unknown[] | null
): Array<{ id: string; name: string }> {
  const targets = (hypothesis_targets ?? []) as Array<Record<string, unknown>>;
  const out: Array<{ id: string; name: string }> = [];
  for (const t of targets) {
    const h = t.hypotheses as Record<string, unknown> | null;
    if (h && typeof h.id === "string") {
      out.push({ id: h.id, name: typeof h.name === "string" ? h.name : "" });
    }
  }
  return out;
}

/**
 * One `data` object per company id (same order as `companyIds`).
 */
export async function buildCompanyEntitiesForPrompt(
  client: SupabaseClient,
  projectId: string,
  companyIds: string[],
  companiesPlaceholderConfig: Record<string, unknown>
): Promise<{
  entities: Array<{ id: string; data: Record<string, unknown> }>;
  error: string | null;
}> {
  const unique = [...new Set(companyIds.filter(Boolean))];
  if (unique.length === 0) return { entities: [], error: null };

  const cfg = normalizeCompaniesPlaceholderConfig(companiesPlaceholderConfig);

  const [
    companiesRes,
    pcRes,
    countsRes,
    ctxRes,
    otherRes,
  ] = await Promise.all([
    fetchCompaniesBatch(client, unique, cfg),
    cfg.include.projectCompany.enabled || cfg.include.hypotheses.enabled
      ? fetchProjectCompaniesBatch(client, projectId, unique)
      : Promise.resolve({ data: [], error: null as string | null }),
    fetchContactCountsByCompany(client, unique),
    cfg.include.companiesContext.enabled
      ? fetchLatestCompanyContexts(client, unique)
      : Promise.resolve({ data: new Map(), error: null as string | null }),
    cfg.include.otherAgentsResults.enabled &&
      cfg.include.otherAgentsResults.agentNames.length > 0
      ? fetchOtherAgentResults(
          client,
          projectId,
          unique,
          cfg.include.otherAgentsResults.agentNames
        )
      : Promise.resolve({ data: new Map(), error: null as string | null }),
  ]);

  let contactsCtxRes: { data: Map<string, string>; error: string | null } = {
    data: new Map(),
    error: null,
  };
  if (cfg.include.contactsContext.enabled) {
    contactsCtxRes = await fetchContactsContextBlobByCompany(client, unique);
  }

  if (companiesRes.error) return { entities: [], error: companiesRes.error };
  if (pcRes.error) return { entities: [], error: pcRes.error };
  if (countsRes.error) return { entities: [], error: countsRes.error };
  if (ctxRes.error) return { entities: [], error: ctxRes.error };
  if (otherRes.error) return { entities: [], error: otherRes.error };
  if (contactsCtxRes.error) return { entities: [], error: contactsCtxRes.error };

  const companyById = new Map<string, CompanyRow>();
  for (const c of companiesRes.data) {
    const id = c.id as string | undefined;
    if (id) companyById.set(id, c);
  }

  const pcByCompany = new Map<
    string,
    {
      project_company_id: string;
      status: string | null;
      created_at: string;
      hypotheses: Array<{ id: string; name: string }>;
    }
  >();
  for (const row of pcRes.data) {
    const cid = row.company_id;
    const hypList = buildHypothesisList(row.hypothesis_targets);
    pcByCompany.set(cid, {
      project_company_id: row.id as string,
      status: row.status ?? null,
      created_at: row.created_at as string,
      hypotheses: cfg.include.hypotheses.enabled ? hypList : [],
    });
  }

  const entities: Array<{ id: string; data: Record<string, unknown> }> = [];

  for (const companyId of companyIds) {
    const data: Record<string, unknown> = {};

    if (cfg.include.companyBase.enabled) {
      const c = companyById.get(companyId);
      if (c) {
        for (const [k, v] of Object.entries(c)) {
          if (k === "tags") data[k] = parseCompanyTagsColumn(v);
          else data[k] = v;
        }
      }
    }

    data.contact_count = countsRes.data[companyId] ?? 0;

    const pc = pcByCompany.get(companyId);
    if (cfg.include.projectCompany.enabled && pc) {
      const fields = cfg.include.projectCompany.fields.filter((f) => SAFE_COL.test(f));
      for (const f of fields) {
        if (f === "project_company_id") data.project_company_id = pc.project_company_id;
        else if (f === "status") data.status = pc.status;
        else if (f === "created_at") data.created_at = pc.created_at;
      }
    }

    if (cfg.include.companyBase.enabled && !companyById.has(companyId)) {
      data.id = companyId;
    }

    if (cfg.include.companiesContext.enabled) {
      const latest = ctxRes.data.get(companyId);
      if (latest) {
        data[`${cfg.keyPrefix.context}root_context`] = latest.rootContext;
      }
    }

    if (cfg.include.contactsContext.enabled) {
      const blob = contactsCtxRes.data.get(companyId);
      if (blob) {
        data[`${cfg.keyPrefix.context}contacts_context`] = blob;
      }
    }

    if (cfg.include.hypotheses.enabled && pc) {
      data.hypotheses = pc.hypotheses;
      data[`${cfg.keyPrefix.hypothesis}hypotheses_json`] = JSON.stringify(
        pc.hypotheses.map((h) => h.name)
      );
    }

    if (cfg.include.otherAgentsResults.enabled && otherRes.data.has(companyId)) {
      const agMap = otherRes.data.get(companyId)!;
      const pfx = cfg.keyPrefix.agent;
      for (const [agentName, aResult] of agMap) {
        const part = sanitizeAgentKeyPart(agentName);
        for (const [rk, rv] of Object.entries(aResult)) {
          if (!SAFE_COL.test(rk)) continue;
          data[`${pfx}${part}__${rk}`] = rv;
        }
      }
    }

    if (cfg.include.projectCompanyEnrichment.enabled) {
      data[`${cfg.keyPrefix.hypothesis}project_enrichment`] = null;
    }

    entities.push({ id: companyId, data });
  }

  return { entities, error: null };
}
