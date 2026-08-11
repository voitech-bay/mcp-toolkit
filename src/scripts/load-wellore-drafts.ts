import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getSupabase } from "../services/supabase.js";
import { normalizeAnnotationRanges, validateDraftForProject } from "../services/email-studio.js";

/**
 * Loads already-reviewed Wellore drafts into Email Studio so they can be read,
 * commented on line by line, and compared against the research they were built on.
 *
 * This is deliberately NOT a generation path. The copy comes from a reviewed
 * source-of-truth file, and the research points are the facts that copy actually
 * used, so the Research panel and the annotated preview line up with each other.
 *
 * Usage:
 *   npm run load:wellore-drafts -- --file <path> [--apply]
 *
 * Without --apply it prints what it would write and touches nothing.
 * Idempotent: emails upsert on the identity index, and re-running replaces the
 * current version with a fresh v(n+1) only when the copy actually changed.
 */

type Annotation = {
  text: string;
  purpose: string;
  explanation: string;
  classification: "verified" | "product_truth" | "instruction" | "inference";
  confidence: "high" | "medium" | "low";
  research_point_ids: string[];
  instruction_ids: string[];
};

type Touch = {
  channel: "email" | "linkedin_dm" | "linkedin_inmail";
  step: number;
  subject: string;
  body: string;
  annotations: Annotation[];
};

type ResearchPoint = { id: string; statement: string; source?: string };

type ContactBlock = {
  contactId: string;
  contactName: string;
  companyId: string | null;
  companyName: string;
  persona: string;
  recipientEmail: string | null;
  research: { verified_signals: ResearchPoint[]; inferred_priorities: ResearchPoint[] };
  touches: Touch[];
};

type DraftsFile = {
  projectId: string;
  campaignId: string;
  batchName: string;
  model: string;
  note?: string;
  contacts: ContactBlock[];
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes("--apply");
const FILE = arg("file");

/**
 * stableResearchPoints() derives ids positionally as `verified-N` / `inferred-N`,
 * but spreads the stored object last, so an explicit `id` in the file wins. We
 * require the two to agree: a mismatch would silently break every annotation's
 * research reference, which the validator reports as `unknown_research`.
 */
function assertResearchIds(block: ContactBlock) {
  const check = (points: ResearchPoint[], prefix: string) =>
    points.forEach((p, i) => {
      const expected = `${prefix}-${i + 1}`;
      if (p.id !== expected) throw new Error(`${block.contactName}: research point ${i + 1} has id "${p.id}"; the app will render it as "${expected}"`);
    });
  check(block.research.verified_signals, "verified");
  check(block.research.inferred_priorities, "inferred");
}

function researchIdSet(block: ContactBlock): Set<string> {
  return new Set([...block.research.verified_signals, ...block.research.inferred_priorities].map((p) => p.id));
}

async function main() {
  if (!FILE) throw new Error("Pass --file <path to drafts.json>");
  const file = JSON.parse(readFileSync(FILE, "utf8")) as DraftsFile;
  const client = getSupabase();
  if (!client) throw new Error("Supabase not configured (need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)");

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${file.contacts.length} contacts, campaign ${file.campaignId}, batch ${file.batchName}\n`);

  let blocking = 0;

  for (const block of file.contacts) {
    assertResearchIds(block);
    const allowedResearch = researchIdSet(block);
    console.log(`## ${block.contactName} — ${block.companyName} (${block.touches.length} touches)`);

    // One research snapshot per contact. The Research panel reads
    // structured_research.verified_signals / inferred_priorities off this row.
    const structured = {
      verified_signals: block.research.verified_signals,
      inferred_priorities: block.research.inferred_priorities,
      source: "Wellore WLR research pipeline plus facts verified by hand before drafting",
    };
    const inputHash = createHash("md5").update(JSON.stringify(structured)).digest("hex");

    let snapshotId: string | null = null;
    if (APPLY) {
      const existing = await client
        .from("outreach_research_snapshots")
        .select("id")
        .eq("project_id", file.projectId)
        .eq("contact_id", block.contactId)
        .eq("input_hash", inputHash)
        .maybeSingle();
      if (existing.data?.id) {
        snapshotId = existing.data.id as string;
      } else {
        const ins = await client
          .from("outreach_research_snapshots")
          .insert({
            project_id: file.projectId,
            contact_id: block.contactId,
            company_id: block.companyId,
            model: file.model,
            input_hash: inputHash,
            structured_research: structured,
            citations: [...block.research.verified_signals]
              .filter((p) => p.source)
              .map((p) => ({ id: p.id, statement: p.statement, source: p.source })),
            partial: false,
            expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
          })
          .select("id")
          .single();
        if (ins.error) throw new Error(`snapshot insert failed for ${block.contactName}: ${ins.error.message}`);
        snapshotId = ins.data.id as string;
      }
      console.log(`   research snapshot ${snapshotId}`);
    }

    for (const touch of block.touches) {
      const annotations = normalizeAnnotationRanges(
        touch.body,
        touch.annotations.map((a, i) => ({ ...a, id: `a${i + 1}`, start: 0, end: 0, warnings: [] })),
      );
      const validation = validateDraftForProject(
        file.projectId,
        touch.channel,
        touch.step,
        touch.subject,
        touch.body,
        annotations,
        allowedResearch,
        undefined,
      );
      const errors = validation.filter((v) => v.severity === "error");
      const warnings = validation.filter((v) => v.severity === "warning");
      const label = `${touch.channel} step ${touch.step}`;
      if (errors.length) {
        blocking += errors.length;
        console.log(`   ${label}: ${errors.length} ERROR — ${errors.map((e) => e.message).join(" | ")}`);
      } else {
        console.log(`   ${label}: clean${warnings.length ? ` (${warnings.length} warning: ${warnings.map((w) => w.message).join(" | ")})` : ""}`);
      }
      if (!APPLY) continue;
      if (errors.length) {
        console.log(`   ${label}: skipped, has blocking errors`);
        continue;
      }

      const upsert = await client
        .from("outreach_emails")
        .upsert(
          {
            project_id: file.projectId,
            contact_id: block.contactId,
            company_id: block.companyId,
            contact_name: block.contactName,
            company_name: block.companyName,
            campaign_id: file.campaignId,
            batch_name: file.batchName,
            persona: block.persona,
            channel: touch.channel,
            sequence_step: touch.step,
            step_number: touch.step,
            recipient_email: touch.channel === "email" ? block.recipientEmail : null,
            provenance: "voitech_generated",
            research_snapshot_id: snapshotId,
            research_quality: "verified",
            status: "needs_review",
          },
          { onConflict: "project_id,contact_id,campaign_id,batch_name,channel,step_number", ignoreDuplicates: false },
        )
        .select("*")
        .single();
      if (upsert.error) throw new Error(`${block.contactName} ${label}: ${upsert.error.message}`);
      const email = upsert.data as Record<string, unknown>;

      // Only write a new version when the copy actually differs from what is current.
      if (email.current_body === touch.body && email.current_subject === touch.subject) {
        console.log(`   ${label}: unchanged, kept version ${email.current_version_id}`);
        continue;
      }
      const last = await client
        .from("outreach_email_versions")
        .select("version_number")
        .eq("email_id", email.id)
        .order("version_number", { ascending: false })
        .limit(1);
      const versionNumber = ((last.data?.[0]?.version_number as number | undefined) ?? 0) + 1;
      await client.from("outreach_email_versions").update({ state: "superseded" }).eq("email_id", email.id).eq("state", "current");
      const ver = await client
        .from("outreach_email_versions")
        .insert({
          email_id: email.id,
          parent_version_id: email.current_version_id ?? null,
          version_number: versionNumber,
          subject: touch.subject,
          body: touch.body,
          author_type: "import",
          author_id: "load-wellore-drafts",
          model: file.model,
          annotations,
          validation_results: validation,
          generation_reason: "reviewed_draft_import",
          prompt_manifest: { source_file: FILE, note: file.note ?? null },
          state: "current",
        })
        .select("id")
        .single();
      if (ver.error) throw new Error(`${block.contactName} ${label} version: ${ver.error.message}`);
      await client
        .from("outreach_emails")
        .update({
          current_version_id: ver.data.id,
          current_subject: touch.subject,
          current_body: touch.body,
          current_model: file.model,
          updated_at: new Date().toISOString(),
        })
        .eq("id", email.id);
      console.log(`   ${label}: wrote v${versionNumber} (${annotations.length} annotations)`);
    }
    console.log("");
  }

  if (blocking) {
    console.log(`${blocking} blocking validation error(s). Those touches were not written.`);
    process.exitCode = 1;
  } else if (!APPLY) {
    console.log("Dry run clean. Re-run with --apply to write.");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
