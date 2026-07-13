import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./services/supabase.js";

type Json = Record<string, unknown>;

const CANONICAL_PATH_RE = /^projects\/([^/]+)\/context\/canonical\/(.+)$/;
const TEXT_EXT_RE = /\.(md|markdown|txt|json|csv|ya?ml)$/i;

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function rawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function verifyGithubSignature(raw: string, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function asRecord(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function changedCanonicalFiles(payload: Json): Array<{ path: string; projectSlug: string; deleted: boolean }> {
  const byPath = new Map<string, { path: string; projectSlug: string; deleted: boolean }>();
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  for (const commit of commits) {
    const row = asRecord(commit);
    if (!row) continue;
    for (const key of ["added", "modified"] as const) {
      const paths = Array.isArray(row[key]) ? row[key] : [];
      for (const rawPath of paths) addPath(String(rawPath), false);
    }
    const removed = Array.isArray(row.removed) ? row.removed : [];
    for (const rawPath of removed) addPath(String(rawPath), true);
  }
  return [...byPath.values()];

  function addPath(path: string, deleted: boolean): void {
    const clean = path.trim();
    if (!TEXT_EXT_RE.test(clean)) return;
    const match = clean.match(CANONICAL_PATH_RE);
    if (!match) return;
    byPath.set(clean, { path: clean, projectSlug: decodeURIComponent(match[1]), deleted });
  }
}

async function projectIdForSlug(client: SupabaseClient, slug: string): Promise<string | null> {
  const { data, error } = await client
    .from("Projects")
    .select("id,name")
    .ilike("name", slug)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return typeof data.id === "string" ? data.id : null;
}

function titleFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || base;
}

function contentKind(path: string): string {
  if (path.includes("/messaging/")) return "messaging_context";
  if (path.includes("/account-research/")) return "account_research";
  return "canonical_context";
}

async function fetchGithubFile(args: {
  repoFullName: string;
  path: string;
  ref: string;
}): Promise<{ content: string; error: string | null }> {
  const token = process.env.GITHUB_CONTEXT_SYNC_TOKEN?.trim();
  const url = `https://api.github.com/repos/${encodeURIComponent(args.repoFullName).replace("%2F", "/")}/contents/${args.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(args.ref)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "voitech-context-sync",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, { headers });
  if (!r.ok) return { content: "", error: `GitHub contents fetch failed: HTTP ${r.status}` };
  const json = asRecord(await r.json());
  if (!json) return { content: "", error: "GitHub contents response was not an object" };
  if (json.type !== "file") return { content: "", error: "GitHub contents path is not a file" };
  if (typeof json.content === "string") {
    return { content: Buffer.from(json.content.replace(/\s/g, ""), "base64").toString("utf8"), error: null };
  }
  if (typeof json.download_url === "string") {
    const raw = await fetch(json.download_url, { headers });
    if (!raw.ok) return { content: "", error: `GitHub raw fetch failed: HTTP ${raw.status}` };
    return { content: await raw.text(), error: null };
  }
  return { content: "", error: "GitHub contents response has no content" };
}

async function archivePath(client: SupabaseClient, projectId: string, sourcePath: string): Promise<string | null> {
  const { error } = await client
    .from("project_knowledge_documents")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("source_path", sourcePath)
    .eq("status", "active");
  return error?.message ?? null;
}

async function upsertPath(client: SupabaseClient, projectId: string, sourcePath: string, content: string): Promise<{ changed: boolean; error: string | null }> {
  const checksum = crypto.createHash("sha256").update(content).digest("hex");
  const active = await client
    .from("project_knowledge_documents")
    .select("id,source_checksum")
    .eq("project_id", projectId)
    .eq("source_path", sourcePath)
    .eq("status", "active")
    .maybeSingle();
  if (active.error) return { changed: false, error: active.error.message };
  if ((active.data as Json | null)?.source_checksum === checksum) return { changed: false, error: null };

  const latest = await client
    .from("project_knowledge_documents")
    .select("version")
    .eq("project_id", projectId)
    .eq("source_path", sourcePath)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) return { changed: false, error: latest.error.message };

  const archiveError = await archivePath(client, projectId, sourcePath);
  if (archiveError) return { changed: false, error: archiveError };

  const inserted = await client.from("project_knowledge_documents").insert({
    project_id: projectId,
    kind: contentKind(sourcePath),
    title: titleFromPath(sourcePath),
    content_markdown: content,
    version: Number((latest.data as Json | null)?.version ?? 0) + 1,
    priority: 30,
    status: "active",
    source_path: sourcePath,
    source_checksum: checksum,
  });
  return { changed: !inserted.error, error: inserted.error?.message ?? null };
}

export async function handleGithubWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!secret) return sendJson(res, 500, { error: "GitHub webhook secret is not configured" });

  const raw = await rawBody(req);
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  if (!verifyGithubSignature(raw, signature, secret)) return sendJson(res, 401, { error: "Invalid signature" });

  const event = String(req.headers["x-github-event"] ?? "");
  if (event === "ping") return sendJson(res, 200, { ok: true, event: "ping" });
  if (event !== "push") return sendJson(res, 202, { ok: true, ignored: true, reason: `ignored ${event || "unknown"} event` });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON" });
  }
  const payload = asRecord(parsed);
  if (!payload) return sendJson(res, 400, { error: "JSON payload must be an object" });

  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });

  const repo = asRecord(payload.repository);
  const repoFullName = str(repo?.full_name);
  const ref = str(payload.after);
  if (!repoFullName || !ref) return sendJson(res, 400, { error: "Missing repository.full_name or after SHA" });

  const files = changedCanonicalFiles(payload);
  const results: Json[] = [];
  for (const file of files) {
    const projectId = await projectIdForSlug(client, file.projectSlug);
    if (!projectId) {
      results.push({ path: file.path, status: "skipped", reason: `Unknown project ${file.projectSlug}` });
      continue;
    }
    if (file.deleted) {
      const error = await archivePath(client, projectId, file.path);
      results.push({ path: file.path, status: error ? "error" : "archived", error });
      continue;
    }
    const fetched = await fetchGithubFile({ repoFullName, path: file.path, ref });
    if (fetched.error) {
      results.push({ path: file.path, status: "error", error: fetched.error });
      continue;
    }
    const saved = await upsertPath(client, projectId, file.path, fetched.content);
    results.push({ path: file.path, status: saved.error ? "error" : saved.changed ? "updated" : "unchanged", error: saved.error });
  }

  sendJson(res, results.some((r) => r.status === "error") ? 207 : 200, {
    ok: true,
    matched: files.length,
    results,
  });
}
