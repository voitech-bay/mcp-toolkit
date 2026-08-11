import "dotenv/config";
import { getSupabase } from "../services/supabase.js";
import { welloreCompanyUuid } from "../services/wellore-messaging/ids.js";
import {
  mergeResearch,
  toEmailStudioResearch,
  upsertEmailStudioSnapshot,
  type EmailStudioResearch,
} from "../services/wellore-messaging/research-snapshot.js";

/**
 * Attaches Wellore research to every Wellore email in Email Studio, so the Research panel
 * shows the signals the copy was written against instead of "No structured research
 * attached".
 *
 * Signals come straight from `wellore_titles` and `wellore_signals` rather than from the
 * reviewed bundle's own `verified_signals`. `assembleWelloreResearch` sorts by date and
 * caps at 8, and the pipeline writes one "site responds to a HEAD request" row per crawl,
 * so that cap fills with liveness probes: Nitro Games has 68 signal rows and its reviewed
 * bundle surfaced exactly one useful fact. Reading the tables directly, dropping probes and
 * leading with titles, is what makes the panel worth looking at.
 *
 * The POV (hook, Wellore angle, summary) is still taken from the reviewed bundle where one
 * exists, falling back to `wellore_companies.pov`; rows built without a reviewed bundle are
 * marked `partial`.
 *
 * Reads only. No LLM spend: every source is already in the database.
 *
 * Rows that already carry a hand-curated snapshot keep it — the pipeline's signals are
 * merged in behind the curated ones so both are visible for comparison, and the curated
 * points keep their positions so existing annotations still resolve.
 *
 * Usage: npm run attach:wellore-research -- [--apply]
 */

const PROJECT_ID = "0038d0db-aab2-40f1-9f6e-38d38e157f8f";
const APPLY = process.argv.includes("--apply");

type Json = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function main() {
  const client = getSupabase();
  if (!client) throw new Error("Supabase not configured");

  const emails = await client
    .from("outreach_emails")
    .select("id, contact_id, contact_name, company_id, company_name, batch_name, research_snapshot_id, research_quality")
    .eq("project_id", PROJECT_ID);
  if (emails.error) throw new Error(emails.error.message);
  const rows = (emails.data ?? []) as Json[];

  // Group by contact: research is per contact, not per touch.
  const byContact = new Map<string, Json[]>();
  for (const r of rows) {
    const id = str(r.contact_id);
    byContact.set(id, [...(byContact.get(id) ?? []), r]);
  }
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${rows.length} Wellore emails across ${byContact.size} contacts\n`);

  const contactIds = [...byContact.keys()];
  const reviewed = await client
    .from("wellore_research_snapshots")
    .select("contact_id, company_uuid, research, reviewed_at")
    .eq("project_id", PROJECT_ID)
    .in("contact_id", contactIds)
    .not("reviewed_at", "is", null);
  if (reviewed.error) throw new Error(reviewed.error.message);
  const reviewedByContact = new Map<string, Json>((reviewed.data ?? []).map((r: Json) => [str(r.contact_id), r]));

  // wellore_companies is the full scraped list, thousands of rows and well past
  // PostgREST's 1000-row default, so this must page or ids beyond the cap vanish from the
  // reverse-hash map and their companies look like they have no research.
  const welloreIdByUuid = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const page = await client.from("wellore_companies").select("id").range(from, from + 999);
    if (page.error) throw new Error(page.error.message);
    const pageRows = (page.data ?? []) as Array<{ id: number }>;
    for (const r of pageRows) welloreIdByUuid.set(welloreCompanyUuid(r.id), r.id);
    if (pageRows.length < 1000) break;
  }

  const companyUuids = [...new Set(rows.map((r) => str(r.company_id)).filter(Boolean))];
  const welloreIds = [...new Set(companyUuids.map((u) => welloreIdByUuid.get(u)).filter((id): id is number => id != null))];

  const [povRes, sigRes, titleRes] = await Promise.all([
    client.from("wellore_companies").select("id,pov").in("id", welloreIds),
    client.from("wellore_signals").select("company_id,type,date,summary,url").in("company_id", welloreIds).eq("outcome", "found"),
    client.from("wellore_titles").select("company_id,title,store,status,est_release,is_hit,source_url").in("company_id", welloreIds),
  ]);
  for (const r of [povRes, sigRes, titleRes]) if (r.error) throw new Error(r.error.message);
  const povById = new Map<number, Json>(((povRes.data ?? []) as Json[]).map((r) => [Number(r.id), (r.pov as Json) ?? {}]));
  const groupBy = (list: Json[]) => {
    const m = new Map<number, Json[]>();
    for (const r of list) {
      const id = Number(r.company_id);
      m.set(id, [...(m.get(id) ?? []), r]);
    }
    return m;
  };
  const signalsById = groupBy((sigRes.data ?? []) as Json[]);
  const titlesById = groupBy((titleRes.data ?? []) as Json[]);

  let attached = 0, mergedCount = 0, unchanged = 0, missing = 0;

  for (const [contactId, contactRows] of byContact) {
    const name = str(contactRows[0].contact_name) || contactId;
    const company = str(contactRows[0].company_name);
    const reviewedRow = reviewedByContact.get(contactId);
    const welloreId = welloreIdByUuid.get(str(contactRows[0].company_id));
    if (welloreId == null) {
      missing++;
      console.log(`## ${name} — ${company}: NO RESEARCH — company is not in wellore_companies (id ${str(contactRows[0].company_id)})`);
      continue;
    }

    const pov = (reviewedRow?.research as Json | undefined) ?? {};
    const rawPov = povById.get(welloreId) ?? {};
    const bundle: Json = {
      pov_summary: str(pov.pov_summary) || str(rawPov.summary),
      pov_hook: str(pov.pov_hook) || str(rawPov.hook),
      pov_wellore_angle: str(pov.pov_wellore_angle) || str(rawPov.wellore_angle),
      // Deliberately the raw signal table, not the bundle's pre-capped copy.
      verified_signals: signalsById.get(welloreId) ?? [],
    };
    const pipeline = toEmailStudioResearch(
      bundle,
      reviewedRow ? "WLR pipeline, human reviewed" : "WLR pipeline, not yet reviewed",
      titlesById.get(welloreId) ?? [],
    );
    if (!pipeline.structured_research.verified_signals.length && !pipeline.structured_research.inferred_priorities.length) {
      missing++;
      console.log(`## ${name} — ${company}: NO RESEARCH — the WLR schema has no usable signals, titles or POV for this company`);
      continue;
    }

    // Preserve any hand-curated snapshot already attached; merge the pipeline in behind it.
    const existingIds = [...new Set(contactRows.map((r) => str(r.research_snapshot_id)).filter(Boolean))];
    let research: EmailStudioResearch = pipeline;
    let mode: "attach" | "merge" = "attach";
    if (existingIds.length) {
      const cur = await client.from("outreach_research_snapshots").select("structured_research, citations").eq("id", existingIds[0]).maybeSingle();
      if (cur.error) throw new Error(cur.error.message);
      const curatedRaw = (cur.data?.structured_research ?? {}) as Json;
      // Only merge into a snapshot that carries points this script did not produce.
      // Merging a pipeline snapshot into itself rewrites `origin`, which changes the
      // content hash and mints a fresh snapshot row on every run.
      const isOwnOutput = str(curatedRaw.origin).startsWith("WLR pipeline");
      if (!isOwnOutput && (Array.isArray(curatedRaw.verified_signals) || Array.isArray(curatedRaw.inferred_priorities))) {
        const curated: EmailStudioResearch = {
          structured_research: {
            verified_signals: (curatedRaw.verified_signals ?? []) as never,
            inferred_priorities: (curatedRaw.inferred_priorities ?? []) as never,
            pov_summary: str(curatedRaw.pov_summary) || undefined,
            origin: str(curatedRaw.origin) || "hand curated for this campaign",
          },
          citations: (cur.data?.citations ?? []) as Json[],
        };
        research = mergeResearch(curated, pipeline, "hand curated, with WLR pipeline signals appended");
        mode = "merge";
      }
    }

    const v = research.structured_research.verified_signals.length;
    const i = research.structured_research.inferred_priorities.length;
    const detail = `${v} verified, ${i} inferred (${research.structured_research.origin})`;

    if (!APPLY) {
      if (mode === "merge") mergedCount++; else attached++;
      console.log(`## ${name} — ${company}: would ${mode} — ${detail}`);
      continue;
    }

    const snapshotId = await upsertEmailStudioSnapshot(client, {
      projectId: PROJECT_ID,
      contactId,
      companyId: str(contactRows[0].company_id) || null,
      model: reviewedRow ? "wlr-pipeline/reviewed" : "wlr-pipeline/assembled",
      research,
      partial: !reviewedRow,
    });

    const alreadyLinked = contactRows.every((r) => str(r.research_snapshot_id) === snapshotId);
    if (alreadyLinked) {
      unchanged++;
      console.log(`## ${name} — ${company}: unchanged — ${detail}`);
      continue;
    }
    const upd = await client
      .from("outreach_emails")
      .update({ research_snapshot_id: snapshotId, research_quality: reviewedRow ? "verified" : "partial" })
      .eq("project_id", PROJECT_ID)
      .eq("contact_id", contactId);
    if (upd.error) throw new Error(upd.error.message);
    if (mode === "merge") mergedCount++; else attached++;
    console.log(`## ${name} — ${company}: ${mode}ed to ${contactRows.length} emails — ${detail}`);
  }

  // Drop snapshots this script produced that nothing points at any more, so re-running
  // after a content change does not leave a trail of dead rows. Only rows carrying an
  // `origin` are ours; hand-curated snapshots have none and are never touched.
  if (APPLY) {
    const mine = await client
      .from("outreach_research_snapshots")
      .select("id, structured_research")
      .eq("project_id", PROJECT_ID);
    if (mine.error) throw new Error(mine.error.message);
    const linked = new Set(rows.map((r) => str(r.research_snapshot_id)).filter(Boolean));
    const refreshed = await client.from("outreach_emails").select("research_snapshot_id").eq("project_id", PROJECT_ID);
    if (refreshed.error) throw new Error(refreshed.error.message);
    for (const r of (refreshed.data ?? []) as Json[]) linked.add(str(r.research_snapshot_id));
    const orphans = ((mine.data ?? []) as Json[])
      .filter((s) => str((s.structured_research as Json)?.origin) && !linked.has(str(s.id)))
      .map((s) => str(s.id));
    if (orphans.length) {
      const del = await client.from("outreach_research_snapshots").delete().in("id", orphans);
      if (del.error) throw new Error(del.error.message);
      console.log(`\nRemoved ${orphans.length} orphaned snapshot(s) left by earlier runs.`);
    }
  }

  console.log(`\n${APPLY ? "Attached" : "Would attach"} ${attached}, ${APPLY ? "merged" : "would merge"} ${mergedCount}, unchanged ${unchanged}, no research ${missing}.`);
  if (!APPLY) console.log("Re-run with --apply to write.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
