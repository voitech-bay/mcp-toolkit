/**
 * Shared `{{...}}` prompt expansion for the enrichment worker and the Enrichment table UI
 * (`frontend/src/views/EnrichmentTablePage.vue` imports this module via Vite alias).
 */

/** Base columns for company CSV / field tokens (matches EnrichmentTablePage.vue). */
export const COMPANY_BASE_KEYS: readonly string[] = [
  "name",
  "domain",
  "website",
  "industry",
  "employees_range",
  "linkedin",
  "tags",
  "contact_count",
  "status",
  "hypotheses",
];

/**
 * Companies row fields fetched when hydrating contacts (worker + enrichment table).
 * Matches `COMPANY_LLM_KEYS` below.
 */
export const COMPANY_SELECT_FOR_CONTACT_LLM =
  "id,name,domain,website,industry,employees_range,linkedin,tags,status,tagline";

/**
 * Contact fields included in `{{contacts}}` compact blocks (skips empty values).
 * Order preserved. `company_uuid` omitted when a nested `company` object is present.
 */
export const CONTACT_LLM_KEYS: readonly string[] = [
  "name",
  "first_name",
  "last_name",
  "title",
  "position",
  "company_name",
  "work_email",
  "personal_email",
  "linkedin_url",
  "linkedin",
  "headline",
  "location",
  "tags",
  "status",
  "linkedin_status",
  "list_uuid",
  "connections_number",
  "skills",
  "locations",
  "experience",
  "educations",
];

/** Company subsection in `{{contacts}}` (subset of `companies` row). */
export const COMPANY_LLM_KEYS: readonly string[] = [
  "name",
  "domain",
  "website",
  "industry",
  "employees_range",
  "linkedin",
  "tags",
  "status",
  "tagline",
];

/** Base columns for contact CSV / field tokens (matches EnrichmentTablePage.vue). */
export const CONTACT_BASE_KEYS: readonly string[] = [
  "name",
  "first_name",
  "last_name",
  "title",
  "position",
  "company_name",
  "skills",
  "locations",
  "experience",
  "educations",
  "company_uuid",
  "work_email",
  "personal_email",
  "linkedin_url",
  "linkedin",
  "headline",
  "location",
  "tags",
  "status",
  "linkedin_status",
  "list_uuid",
  "connections_number",
  "created_at",
];

export type EnrichmentEntityType = "company" | "contact" | "both";

export type ResolvePromptForBatchOptions = {
  batchSize: number;
  /** From `enrichment_agents.entity_type`. */
  entityType: EnrichmentEntityType;
  /** Whether this batch is company or contact rows (from queue `company_id` / `contact_id`). */
  rowKind: "company" | "contact";
  /**
   * Latest `enrichment_agent_results.agent_result` per agent name for the **reference** entity:
   * first entity when `batch_size > 1`, otherwise the sole entity.
   * Same shape as frontend `buildAgentResultsMap`: `{ [agentName]: agent_result }`.
   */
  agentResultsByAgentName?: Record<string, unknown>;
};

const PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g;

/** CSV / tooltip cell formatting (same rules as the enrichment table). */
export function formatCellValue(key: string, val: unknown): string {
  if (val == null) return "—";
  if (key === "hypotheses" && Array.isArray(val)) {
    const parts = val
      .map((x) =>
        x && typeof x === "object" && "name" in (x as object)
          ? String((x as { name: unknown }).name ?? "")
          : ""
      )
      .filter(Boolean);
    return parts.length ? parts.join(", ") : "—";
  }
  if (key === "location" && val && typeof val === "object" && !Array.isArray(val)) {
    try {
      return JSON.stringify(val);
    } catch {
      return "—";
    }
  }
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  if (Array.isArray(val)) {
    if (key === "tags") return val.map((x) => String(x)).join(", ");
    if (val.length === 0) return "—";
    return JSON.stringify(val);
  }
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function csvEscapeCell(val: string): string {
  const s = val.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function collectColumnKeys(
  baseKeys: readonly string[],
  entities: Array<{ data: Record<string, unknown> }>
): string[] {
  const keySet = new Set<string>([...baseKeys]);
  for (const e of entities) {
    for (const k of Object.keys(e.data ?? {})) {
      keySet.add(k);
    }
  }
  return [...keySet].sort();
}

/** CSV of entity fields for the batch (header + one row per entity). */
export function buildBatchEntityCsv(
  entities: Array<{ id: string; data: Record<string, unknown> }>,
  entityKind: "company" | "contact"
): string {
  const baseKeys = entityKind === "company" ? COMPANY_BASE_KEYS : CONTACT_BASE_KEYS;
  const cols = collectColumnKeys(baseKeys, entities);
  const lines: string[] = [];
  lines.push(cols.map((c) => csvEscapeCell(c)).join(","));
  for (const e of entities) {
    const ent = e.data;
    lines.push(
      cols.map((c) => csvEscapeCell(formatCellValue(c, ent[c] ?? null))).join(",")
    );
  }
  return lines.join("\n");
}

function isEmptyForLlmBlock(key: string, val: unknown): boolean {
  if (val == null) return true;
  const s = formatCellValue(key, val);
  return s === "—" || s.trim() === "";
}

function llmSingleLine(val: string): string {
  return val
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Token-oriented text for `{{contacts}}`: one record per entity, YAML-ish, skips empty fields.
 * Expects optional `data.company` (record) from `company_uuid` hydration.
 */
export function buildBatchContactsLlmBlocks(
  entities: Array<{ id: string; data: Record<string, unknown> }>
): string {
  const blocks: string[] = [];
  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i]!;
    const data = ent.data;
    const lines: string[] = [
      `[@${i + 1}]`,
      `entity_id: ${ent.id}`,
      "contact:",
    ];
    for (const k of CONTACT_LLM_KEYS) {
      const v = data[k];
      if (isEmptyForLlmBlock(k, v)) continue;
      lines.push(`  ${k}: ${llmSingleLine(formatCellValue(k, v))}`);
    }
    const co = data.company;
    if (co && typeof co === "object" && !Array.isArray(co)) {
      const cr = co as Record<string, unknown>;
      let anyCo = false;
      for (const k of COMPANY_LLM_KEYS) {
        if (!isEmptyForLlmBlock(k, cr[k])) {
          anyCo = true;
          break;
        }
      }
      if (anyCo) {
        lines.push("company:");
        for (const k of COMPANY_LLM_KEYS) {
          const v = cr[k];
          if (isEmptyForLlmBlock(k, v)) continue;
          lines.push(`  ${k}: ${llmSingleLine(formatCellValue(k, v))}`);
        }
      }
    } else {
      const cid = data.company_uuid;
      if (!isEmptyForLlmBlock("company_uuid", cid)) {
        lines.push("company:");
        lines.push(`  company_uuid: ${llmSingleLine(formatCellValue("company_uuid", cid))}`);
      }
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

function resolvePlaceholderToken(
  inner: string,
  entityData: Record<string, unknown>,
  agentResults: Record<string, unknown>
): string | null {
  const trimmed = inner.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("agent:")) {
    const rest = trimmed.slice("agent:".length);
    const dot = rest.indexOf(".");
    if (dot < 0) return null;
    const agentName = rest.slice(0, dot);
    const key = rest.slice(dot + 1);
    if (!agentName || !key) return null;
    const obj = agentResults[agentName];
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const v = (obj as Record<string, unknown>)[key];
      if (v !== undefined && v !== null) return formatCellValue(key, v);
    }
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(entityData, trimmed)) {
    const v = entityData[trimmed];
    if (v !== undefined && v !== null) return formatCellValue(trimmed, v);
  }
  return null;
}

export function canExpandCompaniesToken(
  entityType: EnrichmentEntityType,
  rowKind: "company" | "contact"
): boolean {
  return (entityType === "company" || entityType === "both") && rowKind === "company";
}

export function canExpandContactsToken(
  entityType: EnrichmentEntityType,
  rowKind: "company" | "contact"
): boolean {
  return (entityType === "contact" || entityType === "both") && rowKind === "contact";
}

/** Same default as `parseEntityTypeForPromptArg` in api-handlers (invalid → both). */
export function parseEnrichmentEntityType(raw: string | undefined): EnrichmentEntityType {
  if (raw === "company" || raw === "contact" || raw === "both") return raw;
  return "both";
}

/**
 * Single-entity mode: every `{{token}}` is resolved from `entityData` / `agentResults`, or left literal if unknown.
 */
export function resolvePromptPlaceholders(
  prompt: string,
  entityData: Record<string, unknown>,
  agentResults: Record<string, unknown>
): string {
  const segments = resolvePromptSegments(prompt, entityData, agentResults);
  return segments.map((s) => s.text).join("");
}

export function resolvePromptSegments(
  prompt: string,
  entityData: Record<string, unknown>,
  agentResults: Record<string, unknown>
): Array<{ resolved: boolean; text: string }> {
  const out: Array<{ resolved: boolean; text: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(prompt)) !== null) {
    if (m.index > last) {
      out.push({ resolved: true, text: prompt.slice(last, m.index) });
    }
    const inner = m[1].trim();
    const resolved = resolvePlaceholderToken(inner, entityData, agentResults);
    if (resolved !== null) {
      out.push({ resolved: true, text: resolved });
    } else {
      out.push({ resolved: false, text: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < prompt.length) {
    out.push({ resolved: true, text: prompt.slice(last) });
  }
  return out;
}

export function resolvePromptSegmentsBatch(
  prompt: string,
  entities: Array<{ id: string; data: Record<string, unknown> }>,
  options: ResolvePromptForBatchOptions
): Array<{ resolved: boolean; text: string }> {
  const out: Array<{ resolved: boolean; text: string }> = [];
  const first = entities[0];
  const agentResults = options.agentResultsByAgentName ?? {};
  let last = 0;
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(prompt)) !== null) {
    if (m.index > last) {
      out.push({ resolved: true, text: prompt.slice(last, m.index) });
    }
    const inner = m[1].trim();
    let resolvedText: string | null = null;

    if (inner === "companies" && canExpandCompaniesToken(options.entityType, options.rowKind)) {
      resolvedText = buildBatchEntityCsv(entities, "company");
    } else if (inner === "contacts" && canExpandContactsToken(options.entityType, options.rowKind)) {
      resolvedText = buildBatchContactsLlmBlocks(entities);
    } else if (first) {
      resolvedText = resolvePlaceholderToken(inner, first.data, agentResults);
    }

    if (resolvedText !== null) {
      out.push({ resolved: true, text: resolvedText });
    } else {
      out.push({ resolved: false, text: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < prompt.length) {
    out.push({ resolved: true, text: prompt.slice(last) });
  }
  return out;
}

/**
 * Expands `{{companies}}` (batch CSV), `{{contacts}}` (compact blocks + optional nested `company`),
 * entity fields, and `{{agent:Name.key}}` the same way as the enrichment table prompt preview.
 *
 * When `batch_size > 1`, non-table tokens use the **first** entity (matches batch preview).
 */
export function resolvePromptForBatch(
  prompt: string,
  entities: Array<{ id: string; data: Record<string, unknown> }>,
  options: ResolvePromptForBatchOptions
): string {
  const bs = Math.max(1, options.batchSize);
  if (bs > 1) {
    return resolvePromptSegmentsBatch(prompt, entities, options)
      .map((s) => s.text)
      .join("");
  }
  const first = entities[0];
  if (!first) {
    return resolvePromptPlaceholders(prompt, {}, {});
  }
  return resolvePromptPlaceholders(
    prompt,
    first.data,
    options.agentResultsByAgentName ?? {}
  );
}
