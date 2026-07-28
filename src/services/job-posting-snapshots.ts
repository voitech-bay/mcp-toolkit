/**
 * Persist curated vacancy full text from n8n POV / deep-research results
 * into context_job_posting_snapshots. Messaging prompts must not use these bodies.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const JOB_SNAPSHOT_WORKFLOWS = new Set([
  "velvetech-pov",
  "velvetech-company-deep-research",
]);

const BODY_KEYS = [
  "snippet",
  "description",
  "content",
  "full_description",
  "job_description",
  "body",
  "text",
] as const;

const URL_KEYS = ["source_url", "url", "job_url", "external_url", "application_url", "linkedin_url"] as const;

const ID_KEYS = ["external_id", "id", "job_id", "coresignal_id"] as const;

export type JobSnapshotCandidate = {
  external_id: string;
  title: string;
  content: string;
  source_url: string | null;
  posted_at: string | null;
  source_payload: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstString(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function parsePostedAt(raw: string): string | null {
  if (!raw.trim()) return null;
  const t = new Date(raw);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
}

export function extractJobBody(row: Record<string, unknown>): string {
  let best = "";
  for (const key of BODY_KEYS) {
    const v = row[key];
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t.length > best.length) best = t;
  }
  return best;
}

export function collectJobSnapshotCandidates(
  result: Record<string, unknown>,
  companyId: string
): JobSnapshotCandidate[] {
  const arrays = [result.job_postings, result.leadership_openings];
  const out: JobSnapshotCandidate[] = [];
  const seen = new Set<string>();

  for (const list of arrays) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const row = asRecord(item);
      if (!row) continue;
      const title = firstString(row, ["title", "name"]);
      const content = extractJobBody(row);
      if (!title || !content) continue;
      const source_url = firstString(row, URL_KEYS) || null;
      const postedRaw = firstString(row, ["date", "posted_at", "created", "created_at", "date_posted"]);
      const posted_at = parsePostedAt(postedRaw);
      let external_id = firstString(row, ID_KEYS);
      if (!external_id && source_url) {
        external_id = createHash("sha256").update(source_url).digest("hex").slice(0, 32);
      }
      if (!external_id) {
        external_id = createHash("sha256")
          .update(`${companyId}|${title}|${postedRaw}`)
          .digest("hex")
          .slice(0, 32);
      }
      if (seen.has(external_id)) continue;
      seen.add(external_id);
      out.push({
        external_id,
        title: title.slice(0, 500),
        content: content.slice(0, 50000),
        source_url: source_url ? source_url.slice(0, 1000) : null,
        posted_at,
        source_payload: row,
      });
    }
  }
  return out;
}

export async function upsertJobPostingSnapshotsFromResult(
  client: SupabaseClient,
  args: {
    projectId: string;
    companyId: string;
    workflowName: string;
    result: Record<string, unknown>;
  }
): Promise<{ upserted: number; error: string | null }> {
  if (!JOB_SNAPSHOT_WORKFLOWS.has(args.workflowName)) {
    return { upserted: 0, error: null };
  }
  const candidates = collectJobSnapshotCandidates(args.result, args.companyId);
  if (candidates.length === 0) return { upserted: 0, error: null };

  const nowIso = new Date().toISOString();
  const rows = candidates.map((c) => ({
    project_id: args.projectId,
    company_id: args.companyId,
    external_id: c.external_id,
    title: c.title,
    content: c.content,
    source_url: c.source_url,
    source_payload: c.source_payload,
    posted_at: c.posted_at,
    captured_at: nowIso,
  }));

  const { error } = await client.from("context_job_posting_snapshots").upsert(rows, {
    onConflict: "project_id,company_id,external_id",
  });
  if (error) return { upserted: 0, error: error.message };
  return { upserted: rows.length, error: null };
}
