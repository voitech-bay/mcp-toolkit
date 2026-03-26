/**
 * Versioned JSON for `enrichment_prompt_settings.companies_placeholder_config`.
 * Shared semantics with the enrichment worker and (via Vite alias) the Vue preview.
 */

export type CompaniesPlaceholderInclude = {
  companyBase: { enabled: boolean; extraCompanyColumns: string[] };
  projectCompany: { enabled: boolean; fields: string[] };
  otherAgentsResults: { enabled: boolean; agentNames: string[] };
  companiesContext: { enabled: boolean };
  contactsContext: { enabled: boolean };
  hypotheses: { enabled: boolean };
  projectCompanyEnrichment: { enabled: boolean };
};

export type CompaniesPlaceholderKeyPrefix = {
  context: string;
  hypothesis: string;
  agent: string;
};

export type NormalizedCompaniesPlaceholderConfig = {
  version: number;
  include: CompaniesPlaceholderInclude;
  keyPrefix: CompaniesPlaceholderKeyPrefix;
};

const DEFAULT_INCLUDE: CompaniesPlaceholderInclude = {
  companyBase: { enabled: true, extraCompanyColumns: [] },
  projectCompany: { enabled: true, fields: ["status", "created_at", "project_company_id"] },
  otherAgentsResults: { enabled: false, agentNames: [] },
  companiesContext: { enabled: false },
  contactsContext: { enabled: false },
  hypotheses: { enabled: true },
  projectCompanyEnrichment: { enabled: false },
};

const DEFAULT_KEY_PREFIX: CompaniesPlaceholderKeyPrefix = {
  context: "ctx_",
  hypothesis: "hyp_",
  agent: "agent_",
};

function readCompanyBase(
  raw: Record<string, unknown> | undefined
): CompaniesPlaceholderInclude["companyBase"] {
  const d = DEFAULT_INCLUDE.companyBase;
  const o = raw?.companyBase;
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ...d };
  const x = o as Record<string, unknown>;
  return {
    enabled: typeof x.enabled === "boolean" ? x.enabled : d.enabled,
    extraCompanyColumns: Array.isArray(x.extraCompanyColumns)
      ? x.extraCompanyColumns.map((c) => String(c))
      : [...d.extraCompanyColumns],
  };
}

function readProjectCompany(
  raw: Record<string, unknown> | undefined
): CompaniesPlaceholderInclude["projectCompany"] {
  const d = DEFAULT_INCLUDE.projectCompany;
  const o = raw?.projectCompany;
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ...d };
  const x = o as Record<string, unknown>;
  return {
    enabled: typeof x.enabled === "boolean" ? x.enabled : d.enabled,
    fields: Array.isArray(x.fields) ? x.fields.map((c) => String(c)) : [...d.fields],
  };
}

function readOtherAgents(
  raw: Record<string, unknown> | undefined
): CompaniesPlaceholderInclude["otherAgentsResults"] {
  const d = DEFAULT_INCLUDE.otherAgentsResults;
  const o = raw?.otherAgentsResults;
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ...d };
  const x = o as Record<string, unknown>;
  return {
    enabled: typeof x.enabled === "boolean" ? x.enabled : d.enabled,
    agentNames: Array.isArray(x.agentNames)
      ? x.agentNames.map((c) => String(c))
      : [...d.agentNames],
  };
}

function readSimpleFlag(
  raw: Record<string, unknown> | undefined,
  key: "companiesContext" | "contactsContext" | "hypotheses" | "projectCompanyEnrichment",
  fallback: { enabled: boolean }
): { enabled: boolean } {
  const o = raw?.[key];
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ...fallback };
  const x = o as Record<string, unknown>;
  return {
    enabled: typeof x.enabled === "boolean" ? x.enabled : fallback.enabled,
  };
}

/**
 * Normalize DB JSON into a stable shape (defaults for missing keys).
 * Merge order in the assembler: company base → project company → companies context →
 * hypotheses → other agents (then optional project-company enrichment when defined).
 */
export function normalizeCompaniesPlaceholderConfig(
  raw: Record<string, unknown>
): NormalizedCompaniesPlaceholderConfig {
  const version = typeof raw.version === "number" ? raw.version : 1;
  const incRaw =
    raw.include && typeof raw.include === "object" && !Array.isArray(raw.include)
      ? (raw.include as Record<string, unknown>)
      : {};

  const include: CompaniesPlaceholderInclude = {
    companyBase: readCompanyBase(incRaw),
    projectCompany: readProjectCompany(incRaw),
    otherAgentsResults: readOtherAgents(incRaw),
    companiesContext: readSimpleFlag(incRaw, "companiesContext", DEFAULT_INCLUDE.companiesContext),
    contactsContext: readSimpleFlag(incRaw, "contactsContext", DEFAULT_INCLUDE.contactsContext),
    hypotheses: readSimpleFlag(incRaw, "hypotheses", DEFAULT_INCLUDE.hypotheses),
    projectCompanyEnrichment: readSimpleFlag(
      incRaw,
      "projectCompanyEnrichment",
      DEFAULT_INCLUDE.projectCompanyEnrichment
    ),
  };

  let keyPrefix = { ...DEFAULT_KEY_PREFIX };
  const kp = raw.keyPrefix;
  if (kp && typeof kp === "object" && !Array.isArray(kp)) {
    const k = kp as Record<string, unknown>;
    if (typeof k.context === "string" && k.context) keyPrefix.context = k.context;
    if (typeof k.hypothesis === "string" && k.hypothesis) keyPrefix.hypothesis = k.hypothesis;
    if (typeof k.agent === "string" && k.agent) keyPrefix.agent = k.agent;
  }

  return { version, include, keyPrefix };
}

export function sanitizeAgentKeyPart(agentName: string): string {
  return agentName.replace(/[^a-zA-Z0-9]+/g, "_");
}
