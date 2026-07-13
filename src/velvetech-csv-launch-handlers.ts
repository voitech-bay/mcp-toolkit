import type { IncomingMessage, ServerResponse } from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMPANIES_TABLE,
  CONTACTS_TABLE,
  PROJECT_COMPANIES_TABLE,
  createCompany,
  createProjectContactRecord,
  getSupabase,
  updateProjectContactRecord,
} from "./services/supabase.js";
import { triggerWorkflowPayload, VELVETECH_PROJECT_ID } from "./services/n8n-trigger.js";

const LAUNCH_RUNS_TABLE = "n8n_launch_runs";
const WORKFLOW_KEY = "velvetech_research";

type Json = Record<string, unknown>;

type CsvRow = {
  rowNumber: number;
  raw: Record<string, string>;
  first_name: string;
  last_name: string;
  title: string;
  company_name: string;
  company_domain: string;
  email: string;
  linkedin_url: string;
  errors: string[];
};

type ImportedRow = CsvRow & {
  lead_uuid: string;
  company_uuid: string;
};

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function readJsonBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : {};
  } catch {
    return {};
  }
}

function str(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/^\uFEFF/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function domainFrom(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split(":")[0];
}

function emailDomain(raw: string): string {
  const at = raw.lastIndexOf("@");
  return at >= 0 ? domainFrom(raw.slice(at + 1)) : "";
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && quoted && next === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      if (header) row[header] = cells[i]?.trim() ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const v = row[normalizeHeader(key)];
    if (v?.trim()) return v.trim();
  }
  return "";
}

function normalizeRow(raw: Record<string, string>, index: number): CsvRow {
  const fullName = pick(raw, ["full_name", "name", "contact_name"]);
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const first_name = pick(raw, ["first_name", "first"]) || nameParts[0] || "";
  const last_name = pick(raw, ["last_name", "last", "surname"]) || nameParts.slice(1).join(" ");
  const email = pick(raw, ["email", "work_email", "business_email"]);
  const company_domain = domainFrom(pick(raw, ["company_domain", "domain", "website", "company_website"])) || emailDomain(email);
  const row: CsvRow = {
    rowNumber: index + 2,
    raw,
    first_name,
    last_name,
    title: pick(raw, ["title", "position", "job_title"]),
    company_name: pick(raw, ["company_name", "company", "account_name", "organization"]),
    company_domain,
    email,
    linkedin_url: pick(raw, ["linkedin_url", "linkedin", "profile_url"]),
    errors: [],
  };
  if (!row.first_name && !row.linkedin_url && !row.email) row.errors.push("Add first_name, linkedin_url, or email");
  if (!row.company_name) row.errors.push("Add company_name");
  if (!row.company_domain) row.errors.push("Add company_domain, company website, or a work email domain");
  return row;
}

function previewCsv(csvText: string) {
  const parsed = parseCsv(csvText);
  const rows = parsed.map(normalizeRow);
  return {
    rows,
    rowCount: rows.length,
    validCount: rows.filter((r) => r.errors.length === 0).length,
    errorCount: rows.filter((r) => r.errors.length > 0).length,
    requiredColumns: ["first_name", "last_name", "title", "company_name", "company_domain", "email", "linkedin_url"],
  };
}

async function ensureProjectCompany(client: SupabaseClient, companyId: string): Promise<string | null> {
  const existing = await client
    .from(PROJECT_COMPANIES_TABLE)
    .select("id")
    .eq("project_id", VELVETECH_PROJECT_ID)
    .eq("company_id", companyId)
    .maybeSingle();
  if (existing.error) return existing.error.message;
  if (existing.data) return null;
  const inserted = await client
    .from(PROJECT_COMPANIES_TABLE)
    .insert({ project_id: VELVETECH_PROJECT_ID, company_id: companyId })
    .select("id")
    .single();
  return inserted.error?.message ?? null;
}

async function findOrCreateCompany(client: SupabaseClient, row: CsvRow): Promise<{ id: string; error: string | null }> {
  if (row.company_domain) {
    const existing = await client
      .from(COMPANIES_TABLE)
      .select("id,name,domain")
      .eq("domain", row.company_domain)
      .maybeSingle();
    if (existing.error) return { id: "", error: existing.error.message };
    if (existing.data) {
      const id = String((existing.data as Json).id);
      const linkError = await ensureProjectCompany(client, id);
      return { id, error: linkError };
    }
  }

  const created = await createCompany(client, { name: row.company_name, domain: row.company_domain || null });
  if (created.error || !created.id) return { id: "", error: created.error ?? "Company creation failed" };
  const linkError = await ensureProjectCompany(client, created.id);
  return { id: created.id, error: linkError };
}

async function findExistingContact(client: SupabaseClient, row: CsvRow): Promise<Json | null> {
  if (row.linkedin_url) {
    const found = await client
      .from(CONTACTS_TABLE)
      .select("*")
      .eq("project_id", VELVETECH_PROJECT_ID)
      .eq("linkedin", row.linkedin_url)
      .maybeSingle();
    if (found.data) return found.data as Json;
  }
  if (row.email) {
    const found = await client
      .from(CONTACTS_TABLE)
      .select("*")
      .eq("project_id", VELVETECH_PROJECT_ID)
      .eq("work_email", row.email)
      .maybeSingle();
    if (found.data) return found.data as Json;
  }
  return null;
}

async function upsertContact(client: SupabaseClient, row: CsvRow, companyId: string): Promise<{ uuid: string; error: string | null }> {
  const fields = {
    first_name: row.first_name,
    last_name: row.last_name,
    position: row.title,
    work_email: row.email,
    company_uuid: companyId,
    company_name: row.company_name,
    linkedin: row.linkedin_url,
  };
  const existing = await findExistingContact(client, row);
  if (existing?.uuid) {
    const updated = await updateProjectContactRecord(client, VELVETECH_PROJECT_ID, String(existing.uuid), fields);
    return { uuid: String(existing.uuid), error: updated.error };
  }
  const created = await createProjectContactRecord(client, VELVETECH_PROJECT_ID, fields);
  return { uuid: String(created.data?.uuid ?? ""), error: created.error };
}

async function importRows(client: SupabaseClient, rows: CsvRow[]): Promise<{ rows: ImportedRow[]; error: string | null }> {
  const imported: ImportedRow[] = [];
  for (const row of rows) {
    const company = await findOrCreateCompany(client, row);
    if (company.error) return { rows: imported, error: `Row ${row.rowNumber}: ${company.error}` };
    const contact = await upsertContact(client, row, company.id);
    if (contact.error || !contact.uuid) return { rows: imported, error: `Row ${row.rowNumber}: ${contact.error ?? "Contact creation failed"}` };
    imported.push({ ...row, lead_uuid: contact.uuid, company_uuid: company.id });
  }
  return { rows: imported, error: null };
}

export async function handleVelvetechResearchCsvPreview(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const body = await readJsonBody(req);
  const csvText = str(body.csvText);
  if (!csvText) return sendJson(res, 400, { error: "CSV text is required" });
  sendJson(res, 200, previewCsv(csvText));
}

export async function handleVelvetechResearchCsvLaunch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });

  const body = await readJsonBody(req);
  const csvText = str(body.csvText);
  const filename = str(body.filename) || "uploaded CSV";
  if (!csvText) return sendJson(res, 400, { error: "CSV text is required" });

  const preview = previewCsv(csvText);
  if (preview.rowCount === 0) return sendJson(res, 400, { error: "CSV has no data rows", ...preview });
  if (preview.errorCount > 0) return sendJson(res, 400, { error: "Fix CSV row errors before launch", ...preview });

  const imported = await importRows(client, preview.rows);
  if (imported.error) return sendJson(res, 500, { error: imported.error });
  const leadUuids = [...new Set(imported.rows.map((r) => r.lead_uuid).filter(Boolean))];
  if (leadUuids.length === 0) return sendJson(res, 400, { error: "No contacts were imported" });

  const inserted = await client
    .from(LAUNCH_RUNS_TABLE)
    .insert({
      project_id: VELVETECH_PROJECT_ID,
      workflow_key: WORKFLOW_KEY,
      source_list_uuid: null,
      source_list_name: `CSV upload: ${filename}`,
      lead_uuids: leadUuids,
      requested_count: leadUuids.length,
      status: "running",
    })
    .select("*")
    .single();
  if (inserted.error || !inserted.data) {
    return sendJson(res, 500, { error: inserted.error?.message ?? "Failed to create launch record" });
  }
  const launchId = String((inserted.data as Json).id);

  const payloadRows = imported.rows.map((r) => ({
    lead_uuid: r.lead_uuid,
    company_uuid: r.company_uuid,
    company_domain: r.company_domain,
    company_name: r.company_name,
    first_name: r.first_name,
    last_name: r.last_name,
    full_name: [r.first_name, r.last_name].filter(Boolean).join(" "),
    title: r.title,
    linkedin_url: r.linkedin_url,
    email: r.email,
  }));
  const trig = await triggerWorkflowPayload(WORKFLOW_KEY, {
    run_id: launchId,
    launch_id: launchId,
    project_id: VELVETECH_PROJECT_ID,
    rows: payloadRows,
  });

  if (!trig.ok) {
    await client
      .from(LAUNCH_RUNS_TABLE)
      .update({ status: "failed", error_message: trig.error ?? "Trigger failed", finished_at: new Date().toISOString() })
      .eq("id", launchId);
    return sendJson(res, trig.status, { error: trig.error ?? "Trigger failed", launchId });
  }

  sendJson(res, 200, {
    launchId,
    requestedCount: leadUuids.length,
    importedCount: imported.rows.length,
    contacts: imported.rows.map((r) => ({
      lead_uuid: r.lead_uuid,
      company_uuid: r.company_uuid,
      name: [r.first_name, r.last_name].filter(Boolean).join(" "),
      company_name: r.company_name,
      company_domain: r.company_domain,
    })),
  });
}
