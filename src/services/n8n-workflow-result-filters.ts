/**
 * Filter clauses for POST /api/n8n/workflow-results/query → RPC `n8n_workflow_results_filtered_page`.
 * AND semantics; validated before RPC (Postgres enforces again).
 */

export const N8N_WORKFLOW_FILTER_FIELDS = [
  "execution_id",
  "workflow",
  "created_at",
  "contact_id",
  "company_id",
  "contact_name",
  "company_name",
  "result_text",
  "launch_id",
] as const;

export type N8nWorkflowResultFilterField = (typeof N8N_WORKFLOW_FILTER_FIELDS)[number];

export const N8N_WORKFLOW_FILTER_OPS = ["eq", "neq", "like", "not_like", "gte", "lte"] as const;
export type N8nWorkflowResultFilterOp = (typeof N8N_WORKFLOW_FILTER_OPS)[number];

export interface N8nWorkflowResultFilterClause {
  field: N8nWorkflowResultFilterField;
  op: N8nWorkflowResultFilterOp;
  value: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_CLAUSES = 24;
const MAX_VALUE_LEN = 2000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function allowedOpsForField(field: N8nWorkflowResultFilterField): ReadonlySet<N8nWorkflowResultFilterOp> {
  switch (field) {
    case "execution_id":
      return new Set(["eq", "neq", "like", "not_like"]);
    case "workflow":
      return new Set(["eq", "neq", "like", "not_like"]);
    case "created_at":
      return new Set(["gte", "lte"]);
    case "contact_id":
    case "company_id":
    case "launch_id":
      return new Set(["eq", "neq"]);
    case "contact_name":
    case "company_name":
    case "result_text":
      return new Set(["like", "not_like"]);
    default:
      return new Set();
  }
}

/**
 * Parse and validate request JSON `{ filters, limit?, offset? }`.
 * Returns RPC-ready clauses (trimmed values) or an error message.
 */
export function parseN8nWorkflowResultsQueryBody(input: unknown): {
  ok: true;
  filters: N8nWorkflowResultFilterClause[];
  limit: number;
  offset: number;
} | { ok: false; error: string } {
  if (!isRecord(input)) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const rawFilters = input.filters;
  if (!Array.isArray(rawFilters)) {
    return { ok: false, error: "filters must be an array" };
  }
  if (rawFilters.length > MAX_CLAUSES) {
    return { ok: false, error: `At most ${MAX_CLAUSES} filter clauses` };
  }

  const clauses: N8nWorkflowResultFilterClause[] = [];
  for (let i = 0; i < rawFilters.length; i++) {
    const el = rawFilters[i];
    if (!isRecord(el)) {
      return { ok: false, error: `filters[${i}] must be an object` };
    }
    const field = el.field;
    const op = el.op;
    const value = el.value;
    if (typeof field !== "string" || !N8N_WORKFLOW_FILTER_FIELDS.includes(field as N8nWorkflowResultFilterField)) {
      return { ok: false, error: `filters[${i}].field is invalid` };
    }
    if (typeof op !== "string" || !N8N_WORKFLOW_FILTER_OPS.includes(op as N8nWorkflowResultFilterOp)) {
      return { ok: false, error: `filters[${i}].op is invalid` };
    }
    if (typeof value !== "string") {
      return { ok: false, error: `filters[${i}].value must be a string` };
    }
    const trimmed = value.trim();
    if (trimmed.length > MAX_VALUE_LEN) {
      return { ok: false, error: `filters[${i}].value too long (max ${MAX_VALUE_LEN})` };
    }
    const f = field as N8nWorkflowResultFilterField;
    const o = op as N8nWorkflowResultFilterOp;
    if (!allowedOpsForField(f).has(o)) {
      return { ok: false, error: `Operator ${o} not allowed for field ${f}` };
    }
    if (
      (o === "eq" || o === "neq" || o === "like" || o === "not_like") &&
      trimmed.length === 0 &&
      f !== "created_at"
    ) {
      return { ok: false, error: `filters[${i}].value must be non-empty for this operator` };
    }
    // launch_id matches result.launch_id OR result.run_id (Velvetech CLI uses non-UUID run_id strings).
    if ((f === "contact_id" || f === "company_id") && (o === "eq" || o === "neq") && trimmed.length > 0) {
      if (!UUID_RE.test(trimmed)) {
        return { ok: false, error: `filters[${i}].value must be a UUID` };
      }
    }
    if ((o === "gte" || o === "lte") && trimmed.length === 0) {
      return { ok: false, error: `filters[${i}].value required for created_at` };
    }
    clauses.push({ field: f, op: o, value: trimmed });
  }

  let limit = 25;
  let offset = 0;
  if (input.limit !== undefined) {
    if (typeof input.limit !== "number" || !Number.isFinite(input.limit)) {
      return { ok: false, error: "limit must be a number" };
    }
    limit = Math.min(Math.max(Math.floor(input.limit), 1), 200);
  }
  if (input.offset !== undefined) {
    if (typeof input.offset !== "number" || !Number.isFinite(input.offset)) {
      return { ok: false, error: "offset must be a number" };
    }
    offset = Math.max(Math.floor(input.offset), 0);
  }

  return { ok: true, filters: clauses, limit, offset };
}
