import crypto from "node:crypto";
import { N8N_WORKFLOW_RESULTS_TABLE, getSupabase } from "./supabase.js";

type Json = Record<string, unknown>;
type Client = NonNullable<ReturnType<typeof getSupabase>>;

/** POV workflow whose result rows hold the ranked account facts operators mark. */
export const POV_WORKFLOW_NAME = "velvetech-pov";

/** A single extracted account fact. `id` is content-based so marks survive POV
 *  reruns that reorder facts. `legacyId` keeps old source-index marks readable. */
export type PovFact = { id: string; legacyId: string; text: string; source: string };

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function factText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const row = value as Json;
  return str(row.statement) || str(row.fact) || str(row.text) || str(row.summary) || str(row.title);
}

function normalizedFactText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function povFactId(source: string, text: string): string {
  const normalized = `${source}:${normalizedFactText(text)}`;
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return `${source}:${hash}`;
}

/** Pull ranked facts out of a POV workflow result. Content-hashed IDs define the
 *  `fact_id` contract shared with `pov_fact_marks`; source-index legacy IDs are
 *  still resolved for marks created before the hash contract. */
export function extractPovFacts(result: unknown): PovFact[] {
  const root = result && typeof result === "object" ? (result as Json) : {};
  const candidates: Array<{ source: string; value: unknown }> = [
    { source: "verified_signals", value: root.verified_signals },
    { source: "headline_facts", value: root.headline_facts },
    { source: "facts", value: root.facts },
    { source: "signals", value: root.signals },
    { source: "pov_points", value: root.pov_points },
    { source: "structured_research.verified_signals", value: (root.structured_research as Json | undefined)?.verified_signals },
  ];
  const out: PovFact[] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate.value)) continue;
    candidate.value.forEach((item, index) => {
      const text = factText(item);
      if (!text) return;
      out.push({ id: povFactId(candidate.source, text), legacyId: `${candidate.source}:${index + 1}`, text, source: candidate.source });
    });
  }
  return out;
}

/** Most recent POV result rows for any of the supplied contact/company ids. */
export async function loadLatestPovRows(client: Client, ids: string[]): Promise<Json[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const { data, error } = await client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("id, workflow_name, contact_id, company_id, result, created_at")
    .eq("workflow_name", POV_WORKFLOW_NAME)
    .or(`contact_id.in.(${unique.join(",")}),company_id.in.(${unique.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as Json[];
}

/** The entity a POV row's facts are keyed under — mirrors how marks are stored. */
function povRowEntityKey(row: Json, fallback: string): string {
  return str(row.contact_id) || str(row.company_id) || fallback;
}

export type PriorityAnchor = {
  factId: string;
  entityKey: string;
  text: string;
  source: string;
  comment: string | null;
  authorId: string | null;
  rank: number | null;
};

/** Resolve the operator's priority-marked POV facts for a contact/company into
 *  ordered anchor text, so message generation can lead with them. Falls back to
 *  an empty list when there is no POV research or no marks (no behavior change).
 *  Ordered by explicit rank, then most recently updated. */
export async function loadPriorityAnchors(
  client: Client,
  args: { projectId: string; contactId: string; companyId: string | null }
): Promise<PriorityAnchor[]> {
  const entityIds = [args.contactId, args.companyId ?? ""].filter(Boolean);
  if (!entityIds.length) return [];

  const [povRows, marksResult] = await Promise.all([
    loadLatestPovRows(client, entityIds),
    client
      .from("pov_fact_marks")
      .select("entity_key, fact_id, priority, rank, comment, author_id, updated_at")
      .eq("project_id", args.projectId)
      .in("entity_key", entityIds)
      .eq("priority", true),
  ]);
  if (marksResult.error) throw new Error(marksResult.error.message);
  const marks = (marksResult.data ?? []) as Json[];
  if (!marks.length) return [];

  // (entity_key, fact_id) -> fact text, from the latest POV row per entity.
  // Legacy source-index IDs are also indexed so old marks keep working.
  const factByKey = new Map<string, PovFact>();
  for (const row of povRows) {
    const entityKey = povRowEntityKey(row, args.contactId);
    for (const fact of extractPovFacts(row.result)) {
      for (const id of [fact.id, fact.legacyId]) {
        const key = `${entityKey}::${id}`;
        if (!factByKey.has(key)) factByKey.set(key, fact);
      }
    }
  }

  const anchors: Array<PriorityAnchor & { updatedAt: number }> = [];
  for (const mark of marks) {
    const entityKey = str(mark.entity_key);
    const factId = str(mark.fact_id);
    const fact = factByKey.get(`${entityKey}::${factId}`);
    if (!fact) continue; // fact was rewritten/dropped in a POV rerun — mark is stale
    const rankRaw = mark.rank;
    anchors.push({
      factId: fact.id,
      entityKey,
      text: fact.text,
      source: fact.source,
      comment: str(mark.comment) || null,
      authorId: str(mark.author_id) || null,
      rank: typeof rankRaw === "number" && Number.isFinite(rankRaw) ? rankRaw : null,
      updatedAt: Date.parse(str(mark.updated_at)) || 0,
    });
  }

  anchors.sort((a, b) => {
    const ar = a.rank ?? Number.POSITIVE_INFINITY;
    const br = b.rank ?? Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    return b.updatedAt - a.updatedAt;
  });
  return anchors.map(({ updatedAt: _updatedAt, ...anchor }) => anchor);
}
