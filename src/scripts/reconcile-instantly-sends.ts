import "dotenv/config";
import { CONTACTS_TABLE, getSupabase } from "../services/supabase.js";
import { instantlyStepNumber, listSentEmails, type InstantlySentEmail } from "../services/instantly.js";

/**
 * Marks emails that Instantly actually sent as sent in Email Studio.
 *
 * Wellore's email delivery runs through Instantly, so unlike Velvetech there is no
 * Smartlead history to reconcile against. This mirrors smartlead-reconcile.ts: it reads
 * what really went out, resolves each recipient to a project contact, and writes one
 * `sent` outreach_emails row per touch carrying the copy as delivered.
 *
 * Usage:
 *   npm run reconcile:instantly -- [--project <uuid>] [--apply]
 *
 * Without --apply it reports what it would write and touches nothing.
 * Idempotent: keyed on the Instantly message id stored in external_push_log.
 */

const PROJECT_ID = "0038d0db-aab2-40f1-9f6e-38d38e157f8f"; // Wellore

/** Readable batch labels so Email Studio's Batch column stays useful. */
const CAMPAIGN_BATCHES: Record<string, string> = {
  "e2e2652e-ef0a-4562-bc94-ec4e50e7d5f8": "Instantly EMEA",
  "a8fc793e-b861-416d-a2c9-068175c36a6b": "Instantly APAC",
};

/**
 * Campaigns whose sends are not real prospect outreach. `Wellore push test` used a real
 * prospect's copy with the recipient overridden to an internal inbox (the Phase 7 rendering
 * check), so importing it would claim that prospect was mailed twice with copy they never
 * received. c3036f8a is a deliverability test against mail-tester.
 */
const EXCLUDED_CAMPAIGNS = new Set([
  "8ec328ce-2118-4d19-b8e4-4cf29296914d",
  "c3036f8a-826d-4cb0-b3a2-7ce6dfa5329a",
]);

/**
 * One recipient resolves to several contact rows that all carry a title, so the
 * "prefer the enriched row" rule cannot pick on its own. Recorded here with the reason
 * rather than guessed at run time.
 */
const CONTACT_OVERRIDES: Record<string, { uuid: string; why: string }> = {
  "yaroslav@cas.ai": {
    uuid: "85f5f10f-3158-5750-8edf-d2997d37edbb",
    why: "5 contact rows share this address across GFD Studio, Spaghetti House, 3DGameHouse and Portak. The copy that was sent is about the GFD catalog, so the GFD Studio row is the right one.",
  },
};

type Json = Record<string, unknown>;
type Client = NonNullable<ReturnType<typeof getSupabase>>;

const APPLY = process.argv.includes("--apply");
const projectId = (() => {
  const i = process.argv.indexOf("--project");
  return i >= 0 ? String(process.argv[i + 1]) : PROJECT_ID;
})();

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Prefer the contact row that actually carries a title, which is the enriched one; the
 * bare duplicates come from repeated bridge runs. Ambiguity beyond that is reported, not
 * guessed, because picking wrong attributes a real send to the wrong person.
 */
async function resolveContact(client: Client, email: string): Promise<{ contact: Json | null; ambiguous: Json[] }> {
  const r = await client
    .from(CONTACTS_TABLE)
    .select("uuid, name, first_name, last_name, title, position, company_uuid, company_name, work_email")
    .eq("project_id", projectId)
    .ilike("work_email", email);
  if (r.error) throw new Error(r.error.message);
  const rows = (r.data ?? []) as Json[];
  if (!rows.length) return { contact: null, ambiguous: [] };

  const override = CONTACT_OVERRIDES[email];
  if (override) {
    const picked = rows.find((c) => str(c.uuid) === override.uuid);
    if (picked) return { contact: picked, ambiguous: [] };
  }
  // `title` is what the Wellore bridge populates; `position` is GetSales's own column and
  // is set on the bare duplicates too, so it cannot discriminate. Tiered, most specific first.
  const byTitle = rows.filter((c) => str(c.title));
  const byPosition = rows.filter((c) => str(c.position));
  const candidates = byTitle.length ? byTitle : byPosition.length ? byPosition : rows;
  if (candidates.length > 1) return { contact: null, ambiguous: candidates };
  return { contact: candidates[0], ambiguous: [] };
}

function bodyHtml(msg: InstantlySentEmail): string {
  return str(msg.body?.html) || str(msg.body?.text);
}

async function main() {
  const client = getSupabase();
  if (!client) throw new Error("Supabase not configured (need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)");

  const all = await listSentEmails();
  const sends = all.filter((m) => !EXCLUDED_CAMPAIGNS.has(str(m.campaign_id)));
  const excluded = all.length - sends.length;

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — Instantly reports ${all.length} sent messages; ${sends.length} are real prospect sends (${excluded} excluded as test sends).\n`);

  // Group by recipient so the report reads per person rather than per message.
  const byRecipient = new Map<string, InstantlySentEmail[]>();
  for (const msg of sends) {
    const to = str(msg.to_address_email_list).toLowerCase();
    if (!to) continue;
    byRecipient.set(to, [...(byRecipient.get(to) ?? []), msg]);
  }

  let written = 0, skipped = 0, unresolved = 0;

  for (const [email, messages] of [...byRecipient].sort()) {
    const { contact, ambiguous } = await resolveContact(client, email);
    if (!contact) {
      unresolved++;
      const detail = ambiguous.length
        ? `${ambiguous.length} contact rows match and all carry a title: ${ambiguous.map((c) => `${str(c.name)} @ ${str(c.company_name)} (${str(c.uuid)})`).join(", ")}. Add a CONTACT_OVERRIDES entry.`
        : "no contact in this project has that work_email";
      console.log(`## ${email}: SKIPPED — ${detail}\n`);
      continue;
    }
    const name = str(contact.name) || [str(contact.first_name), str(contact.last_name)].filter(Boolean).join(" ") || "Unknown";
    console.log(`## ${name} — ${str(contact.company_name)} <${email}>`);

    for (const msg of messages.sort((a, b) => str(a.timestamp_email).localeCompare(str(b.timestamp_email)))) {
      const step = instantlyStepNumber(msg.step);
      const campaignId = str(msg.campaign_id);
      const batchName = CAMPAIGN_BATCHES[campaignId] ?? "Instantly send history";
      const subject = str(msg.subject) || `(step ${step})`;
      const sentAt = str(msg.timestamp_email) || str(msg.timestamp_created);
      const messageId = str(msg.message_id) || str(msg.id);
      const label = `step ${step} "${subject}" sent ${sentAt.slice(0, 16).replace("T", " ")}`;

      const existing = await client
        .from("outreach_emails")
        .select("id, status, external_push_log, provenance, current_version_id")
        .eq("project_id", projectId)
        .eq("contact_id", str(contact.uuid))
        .eq("campaign_id", campaignId)
        .eq("batch_name", batchName)
        .eq("channel", "email")
        .eq("step_number", step)
        .maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      const prev = existing.data as Json | null;

      if (prev && str(prev.status) === "sent" && str((prev.external_push_log as Json | null)?.message_id) === messageId) {
        skipped++;
        console.log(`   ${label}: already recorded`);
        continue;
      }
      if (!APPLY) {
        written++;
        console.log(`   ${label}: would mark sent`);
        continue;
      }

      const record: Json = {
        project_id: projectId,
        contact_id: str(contact.uuid),
        company_id: contact.company_uuid ?? null,
        contact_name: name,
        company_name: str(contact.company_name),
        campaign_id: campaignId,
        batch_name: batchName,
        persona: str(contact.title) || str(contact.position),
        channel: "email",
        sequence_step: step,
        step_number: step,
        recipient_email: email,
        current_subject: subject,
        current_body: bodyHtml(msg),
        research_quality: "unknown",
        status: "sent",
        provenance: prev && str(prev.provenance) === "voitech_generated" ? "combined" : "instantly_history",
        // These sends predate the current drafts, so there is no in-app generation history.
        generation_history_available: false,
        sent_at: sentAt,
        external_target: "instantly",
        external_pushed_at: sentAt,
        external_push_log: {
          provider: "instantly",
          campaign_id: campaignId,
          lead_id: str(msg.lead_id),
          message_id: messageId,
          instantly_email_id: str(msg.id),
          step_code: str(msg.step),
          sent_from: str(msg.eaccount),
        },
        updated_at: new Date().toISOString(),
      };

      const saved = await client
        .from("outreach_emails")
        .upsert(record, { onConflict: "project_id,contact_id,campaign_id,batch_name,channel,step_number", ignoreDuplicates: false })
        .select("id, current_version_id")
        .single();
      if (saved.error) throw new Error(`${email} ${label}: ${saved.error.message}`);

      if (!saved.data.current_version_id) {
        const v = await client
          .from("outreach_email_versions")
          .insert({
            email_id: saved.data.id,
            version_number: 1,
            subject,
            body: bodyHtml(msg),
            author_type: "import",
            author_id: "instantly_reconcile",
            annotations: [],
            validation_results: [],
            generation_reason: "instantly_reconcile",
            state: "current",
          })
          .select("id")
          .single();
        if (v.error && v.error.code !== "23505") throw new Error(v.error.message);
        if (v.data) await client.from("outreach_emails").update({ current_version_id: v.data.id }).eq("id", saved.data.id);
      }

      const ev = await client.from("outreach_email_status_events").insert({
        email_id: saved.data.id,
        from_status: prev ? prev.status : null,
        to_status: "sent",
        actor_type: "import",
        actor_id: "instantly_reconcile",
        reason: "Confirmed sent by Instantly",
        idempotency_key: `instantly-reconcile:${messageId}`,
      });
      if (ev.error && ev.error.code !== "23505") throw new Error(ev.error.message);

      written++;
      console.log(`   ${label}: marked sent`);
    }
    console.log("");
  }

  console.log(`${APPLY ? "Wrote" : "Would write"} ${written}, already recorded ${skipped}, unresolved recipients ${unresolved}.`);
  if (!APPLY) console.log("Re-run with --apply to write.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
