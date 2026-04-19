/**
 * Direct PostgreSQL access using a read-only role (separate from Supabase JS client).
 * Connection string: SUPABASE_READONLY_DATABASE_URL or READONLY_DATABASE_URL.
 */
import { Client } from "pg";

const READONLY_URL_ENV_KEYS = ["SUPABASE_READONLY_DATABASE_URL", "READONLY_DATABASE_URL"] as const;

const MAX_USER_SQL_LENGTH = 100_000;

/** Keywords / patterns that must not appear outside comments/strings (after stripping literals). */
const FORBIDDEN_SQL = [
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\bMERGE\b/i,
  /\bTRUNCATE\b/i,
  /\bDROP\b/i,
  /\bCREATE\b/i,
  /\bALTER\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bCOPY\b/i,
  /\bCALL\b/i,
  /\bPREPARE\b/i,
  /\bDEALLOCATE\b/i,
  /\bVACUUM\b/i,
  /\bANALYZE\b/i,
  /\bCLUSTER\b/i,
  /\bREINDEX\b/i,
  /\bREFRESH\b/i,
  /\bLISTEN\b/i,
  /\bNOTIFY\b/i,
  /\bUNLISTEN\b/i,
  /\bLOAD\b/i,
  /\bDISCARD\b/i,
  /\bDO\b/i,
  /\bBEGIN\b/i,
  /\bCOMMIT\b/i,
  /\bROLLBACK\b/i,
  /\bSAVEPOINT\b/i,
  /\bRELEASE\b/i,
  /\bINTO\b/i,
  /\bFOR\s+UPDATE\b/i,
  /\bFOR\s+SHARE\b/i,
  /\bFOR\s+NO\s+KEY\s+UPDATE\b/i,
  /\bFOR\s+KEY\s+SHARE\b/i,
] as const;

export function getReadonlyDatabaseUrl(): string | null {
  for (const k of READONLY_URL_ENV_KEYS) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return null;
}

/**
 * Replace comments and string / dollar-quoted literals with whitespace so keyword scans
 * ignore content inside quotes (best-effort; not a full SQL parser).
 */
export function stripSqlCommentsAndLiterals(input: string): string {
  let out = "";
  let i = 0;
  const n = input.length;
  type State =
    | "code"
    | "line_comment"
    | "block_comment"
    | "single_quote"
    | "double_quote"
    | "dollar_quote";
  let state: State = "code";
  let dollarTag = "";

  while (i < n) {
    const c = input[i]!;

    if (state === "code") {
      if (c === "-" && input[i + 1] === "-") {
        state = "line_comment";
        out += " ";
        i += 2;
        continue;
      }
      if (c === "/" && input[i + 1] === "*") {
        state = "block_comment";
        out += " ";
        i += 2;
        continue;
      }
      if (c === "'") {
        state = "single_quote";
        out += " ";
        i++;
        continue;
      }
      if (c === '"') {
        state = "double_quote";
        out += " ";
        i++;
        continue;
      }
      if (c === "$") {
        const rest = input.slice(i);
        const m = /^\$([a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(rest);
        if (m) {
          dollarTag = m[0];
          state = "dollar_quote";
          out += " ";
          i += m[0].length;
          continue;
        }
      }
      out += c;
      i++;
      continue;
    }

    if (state === "line_comment") {
      if (c === "\n" || c === "\r") {
        state = "code";
        out += " ";
      }
      i++;
      continue;
    }

    if (state === "block_comment") {
      if (c === "*" && input[i + 1] === "/") {
        state = "code";
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (state === "single_quote") {
      if (c === "'") {
        if (input[i + 1] === "'") {
          i += 2;
          continue;
        }
        state = "code";
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (state === "double_quote") {
      if (c === '"') {
        if (input[i + 1] === '"') {
          i += 2;
          continue;
        }
        state = "code";
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (state === "dollar_quote") {
      if (input.startsWith(dollarTag, i)) {
        state = "code";
        i += dollarTag.length;
        dollarTag = "";
        continue;
      }
      i++;
      continue;
    }
  }

  return out;
}

function splitSqlStatements(trimmed: string): string[] {
  return trimmed
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** First significant SQL token (skips EXPLAIN and optional modifiers). */
const EXPLAIN_LEADING_OPTIONS = new Set([
  "ANALYZE",
  "VERBOSE",
  "BUFFERS",
  "COSTS",
  "TIMING",
  "FORMAT",
  "WAL",
  "SETTINGS",
  "GENERIC_PLAN",
]);

function firstDataToken(upper: string): string | null {
  const tokens = upper.split(/\s+/).filter(Boolean);
  let idx = 0;
  if (tokens[idx] === "EXPLAIN") {
    idx++;
    while (idx < tokens.length && EXPLAIN_LEADING_OPTIONS.has(tokens[idx]!)) {
      idx++;
    }
  }
  return idx < tokens.length ? tokens[idx]! : null;
}

/**
 * Reject anything that is clearly not a read-only SELECT-style statement (best-effort).
 */
export function validateReadonlyUserSql(sql: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = sql.trim();
  if (!trimmed) {
    return { ok: false, reason: "Empty query." };
  }
  if (trimmed.length > MAX_USER_SQL_LENGTH) {
    return { ok: false, reason: `Query exceeds max length (${MAX_USER_SQL_LENGTH} characters).` };
  }

  const statements = splitSqlStatements(trimmed);
  if (statements.length > 1) {
    return { ok: false, reason: "Only a single SQL statement is allowed (no multiple statements separated by ';')." };
  }

  const stripped = stripSqlCommentsAndLiterals(trimmed);
  const upper = stripped.replace(/\s+/g, " ").trim().toUpperCase();

  for (const re of FORBIDDEN_SQL) {
    const m = stripped.match(re);
    if (m) {
      return { ok: false, reason: `Disallowed SQL construct detected: "${m[0]}". Only read-only SELECT-style queries are permitted.` };
    }
  }

  const first = firstDataToken(upper);
  const allowedStarts = new Set(["SELECT", "WITH", "TABLE", "VALUES", "SHOW"]);
  if (!first || !allowedStarts.has(first)) {
    return {
      ok: false,
      reason: `Query must be read-only: start with SELECT, WITH, TABLE, VALUES, or SHOW (optional leading EXPLAIN …). Got: "${first ?? ""}".`,
    };
  }

  const lead = stripped.replace(/^\s+/, "").toUpperCase();
  if (/^(SET|RESET|DISCARD)\b/.test(lead)) {
    return { ok: false, reason: "SET / RESET / DISCARD statements are not allowed." };
  }

  return { ok: true };
}

export interface ReadonlyQueryResult {
  rows: unknown[];
  rowCount: number;
  fields: Array<{ name: string; dataTypeId: number }>;
}

async function withReadonlyClient<T>(
  run: (client: Client) => Promise<T>
): Promise<{ data: T | null; error: string | null }> {
  const url = getReadonlyDatabaseUrl();
  if (!url) {
    return {
      data: null,
      error: `Read-only database URL not configured. Set ${READONLY_URL_ENV_KEYS.join(" or ")}.`,
    };
  }

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("SET statement_timeout = '60s'");
    const data = await run(client);
    return { data, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { data: null, error: msg };
  } finally {
    await client.end().catch(() => {});
  }
}

export async function executeReadonlyUserSql(
  sql: string
): Promise<{ data: ReadonlyQueryResult | null; error: string | null }> {
  const v = validateReadonlyUserSql(sql);
  if (!v.ok) {
    return { data: null, error: v.reason };
  }

  return withReadonlyClient(async (client) => {
    const result = await client.query(sql.trim());
    return {
      rows: result.rows as unknown[],
      rowCount: result.rowCount ?? result.rows.length,
      fields: (result.fields ?? []).map((f) => ({ name: f.name, dataTypeId: f.dataTypeID })),
    };
  });
}

export interface SchemaColumn {
  name: string;
  data_type: string;
  is_nullable: string;
}

export interface SchemaTable {
  schema: string;
  name: string;
  columns: SchemaColumn[];
}

/**
 * List user-visible tables (non-system schemas) with column names and types.
 */
export async function listSupabaseSchemaSimple(): Promise<{
  data: SchemaTable[] | null;
  error: string | null;
}> {
  const sql = `
SELECT table_schema, table_name, column_name, data_type, is_nullable, ordinal_position
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  AND table_schema NOT LIKE 'pg\\_%' ESCAPE '\\'
ORDER BY table_schema, table_name, ordinal_position
`.trim();

  const { data: result, error } = await withReadonlyClient(async (client) => {
    return client.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(sql);
  });

  if (error || !result) {
    return { data: null, error: error ?? "No result from schema query." };
  }

  const byTable = new Map<string, SchemaTable>();
  for (const row of result.rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    let t = byTable.get(key);
    if (!t) {
      t = { schema: row.table_schema, name: row.table_name, columns: [] };
      byTable.set(key, t);
    }
    t.columns.push({
      name: row.column_name,
      data_type: row.data_type,
      is_nullable: row.is_nullable,
    });
  }

  return {
    data: [...byTable.values()].sort((a, b) => {
      const sa = a.schema.localeCompare(b.schema);
      if (sa !== 0) return sa;
      return a.name.localeCompare(b.name);
    }),
    error: null,
  };
}
