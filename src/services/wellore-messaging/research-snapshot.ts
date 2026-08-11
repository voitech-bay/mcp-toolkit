import { createHash } from "node:crypto";
import type { getSupabase } from "../supabase.js";

/**
 * Bridges Wellore's own research into the table Email Studio's Research panel reads.
 *
 * There are two Wellore research stores and neither is the one the panel uses:
 *   - `wellore_research_snapshots` — Phase 10's human-reviewed bundle, keyed by contact.
 *   - `wellore_companies.pov` / `wellore_signals` — the raw WLR pipeline output.
 * Email Studio reads `outreach_research_snapshots` and renders
 * `structured_research.verified_signals` / `.inferred_priorities` via `stableResearchPoints`.
 *
 * Without this bridge every Wellore email shows "No structured research attached" even
 * when the pipeline has plenty on that company.
 */

type Json = Record<string, unknown>;
type Client = NonNullable<ReturnType<typeof getSupabase>>;

export type ResearchPoint = { id?: string; statement: string; source?: string; kind_hint?: string; date?: string };

export type EmailStudioResearch = {
  structured_research: {
    verified_signals: ResearchPoint[];
    inferred_priorities: ResearchPoint[];
    pov_summary?: string;
    origin: string;
  };
  citations: Json[];
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * A liveness probe, not a signal. The WLR pipeline records one of these per crawl, so a
 * company accumulates several identical rows that say nothing about the business. They
 * outnumber the real signals and would otherwise fill the panel.
 */
function isLivenessProbe(type: string, statement: string): boolean {
  return type === "website" && /HEAD-запрос|responds to a HEAD/i.test(statement);
}

/** Store rows sometimes carry the package id instead of a title (`net.gameduo.bbc`). */
function looksLikePackageId(title: string): boolean {
  return /^[a-z0-9]+(\.[a-z0-9_]+){2,}$/.test(title);
}

/**
 * Turn `wellore_titles` rows into research points. Titles are the substance of this
 * campaign — an upcoming title with a date is the reason to write at all — so they lead the
 * verified list ahead of news and funding.
 */
export function titleSignals(titles: Json[]): ResearchPoint[] {
  const points: ResearchPoint[] = [];
  const hits: ResearchPoint[] = [];
  const seen = new Set<string>();
  for (const t of titles) {
    const title = str(t.title);
    if (!title || looksLikePackageId(title) || str(t.store) === "own_site") continue;
    const status = str(t.status);
    // "unknown" means the pipeline never determined a stage; reporting it as a fact would
    // repeat the Wobbly Life mistake, where a defaulted stage was read as real.
    if (status !== "upcoming" && !(status === "released" && t.is_hit === true)) continue;
    const key = `${title}|${status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const store = str(t.store);
    const when = str(t.est_release).slice(0, 10);
    const point: ResearchPoint = {
      statement:
        status === "upcoming"
          ? `${title} is upcoming on ${store || "store"}${when ? `, estimated ${when}` : " with no date announced"}.`
          : `${title} is a released hit on ${store || "store"}${when ? ` (${when})` : ""}.`,
      source: str(t.source_url) || undefined,
      kind_hint: `title:${status}`,
      date: when || undefined,
    };
    if (status === "upcoming") points.push(point);
    else hits.push(point);
  }
  return [...points, ...hits.slice(0, 6)];
}

/**
 * Convert a Wellore research bundle (`{pov_summary, pov_hook, pov_wellore_angle,
 * verified_signals}`) into the panel's shape, optionally leading with title signals.
 *
 * The pipeline's signals are observed facts, so they become verified points. The POV hook
 * and Wellore angle are the model's read on top of those facts, so they become inferred
 * priorities rather than being presented as verified.
 */
export function toEmailStudioResearch(research: Json, origin: string, titles: Json[] = []): EmailStudioResearch {
  const rawSignals = Array.isArray(research.verified_signals) ? (research.verified_signals as Json[]) : [];
  const seen = new Set<string>();
  const verified: ResearchPoint[] = titleSignals(titles);
  for (const p of verified) seen.add(`title|${p.statement}`);
  for (const s of rawSignals) {
    const statement = str(s.summary) || str(s.statement);
    if (!statement) continue;
    const type = str(s.type);
    if (isLivenessProbe(type, statement)) continue;
    const key = `${type}|${statement}`;
    if (seen.has(key)) continue; // the pipeline records the same probe more than once
    seen.add(key);
    verified.push({
      statement,
      source: str(s.url) || undefined,
      kind_hint: type || undefined,
      date: str(s.date) || undefined,
    });
  }

  const inferred: ResearchPoint[] = [];
  const hook = str(research.pov_hook);
  if (hook) inferred.push({ statement: hook, source: "WLR POV hook" });
  const angle = str(research.pov_wellore_angle);
  if (angle) inferred.push({ statement: angle, source: "WLR POV Wellore angle" });

  return {
    structured_research: {
      verified_signals: verified.map((p, i) => ({ id: `verified-${i + 1}`, ...p })),
      inferred_priorities: inferred.map((p, i) => ({ id: `inferred-${i + 1}`, ...p })),
      pov_summary: str(research.pov_summary) || undefined,
      origin,
    },
    citations: verified.filter((p) => p.source).map((p) => ({ statement: p.statement, source: p.source })),
  };
}

/**
 * Merge curated points in front of pipeline points, keeping the curated ones at their
 * original positions.
 *
 * `stableResearchPoints` derives ids positionally, so anything that shifts a curated point
 * would silently break the annotations that reference it. Curated first, pipeline appended,
 * duplicates by statement dropped.
 */
export function mergeResearch(curated: EmailStudioResearch, pipeline: EmailStudioResearch, origin: string): EmailStudioResearch {
  const merge = (a: ResearchPoint[], b: ResearchPoint[], prefix: string) => {
    const seen = new Set(a.map((p) => p.statement.toLowerCase()));
    const extra = b.filter((p) => !seen.has(p.statement.toLowerCase()));
    return [...a, ...extra].map((p, i) => ({ ...p, id: `${prefix}-${i + 1}` }));
  };
  return {
    structured_research: {
      verified_signals: merge(curated.structured_research.verified_signals, pipeline.structured_research.verified_signals, "verified"),
      inferred_priorities: merge(curated.structured_research.inferred_priorities, pipeline.structured_research.inferred_priorities, "inferred"),
      pov_summary: curated.structured_research.pov_summary ?? pipeline.structured_research.pov_summary,
      origin,
    },
    citations: [...curated.citations, ...pipeline.citations],
  };
}

/**
 * Insert (or reuse) an `outreach_research_snapshots` row for this contact. Keyed on a hash
 * of the content, so re-running with unchanged research reuses the existing row instead of
 * piling up duplicates.
 */
/**
 * Stable JSON for hashing: object keys sorted recursively.
 *
 * Postgres normalizes jsonb key order, so a snapshot read back and re-serialized produces a
 * different string than the one that was written even when nothing changed. Hashing the raw
 * `JSON.stringify` therefore mints a fresh snapshot on every run.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Json)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

export async function upsertEmailStudioSnapshot(
  client: Client,
  args: { projectId: string; contactId: string; companyId: string | null; model: string; research: EmailStudioResearch; partial: boolean },
): Promise<string> {
  const inputHash = createHash("md5").update(JSON.stringify(canonical(args.research.structured_research))).digest("hex");
  const existing = await client
    .from("outreach_research_snapshots")
    .select("id")
    .eq("project_id", args.projectId)
    .eq("contact_id", args.contactId)
    .eq("input_hash", inputHash)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.id) return String(existing.data.id);

  const ins = await client
    .from("outreach_research_snapshots")
    .insert({
      project_id: args.projectId,
      contact_id: args.contactId,
      company_id: args.companyId,
      model: args.model,
      input_hash: inputHash,
      structured_research: args.research.structured_research,
      citations: args.research.citations,
      partial: args.partial,
      expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (ins.error) throw new Error(ins.error.message);
  return String(ins.data.id);
}
