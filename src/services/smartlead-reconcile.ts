import { CONTACTS_TABLE, PROJECTS_TABLE, getSupabase } from "./supabase.js";
import {
  getLeadMessageHistory,
  isSmartleadSentMessage,
  listCampaignLeads,
  listCampaignStatistics,
  smartleadMessageStep,
  type SmartleadCampaignLead,
  type SmartleadCampaignStat,
  type SmartleadHistoryMessage,
} from "./smartlead.js";
import { plaintextToHtml } from "./html-plaintext.js";

type Json = Record<string, unknown>;
type Client = NonNullable<ReturnType<typeof getSupabase>>;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type ReconcileResult = {
  campaignId: string;
  leadId: string;
  recipientEmail: string | null;
  contactId: string | null;
  sentInSmartlead: number;
  upserted: number;
  skipped: number;
  steps: Array<{ step: number; emailId: string; action: "insert" | "update" | "skip"; subject: string }>;
};

const CONTACT_COLUMNS = "uuid, name, first_name, last_name, title, company_uuid, company_name, position, work_email, email";

/**
 * Prefer the contact row that carries a title or position (the enriched one) when several
 * rows share an address. Velvetech has no duplicate work emails today, so this is a guard.
 */
function pickContact(rows: Json[]): Json | null {
  if (!rows.length) return null;
  return rows.find((c) => str(c.title) || str(c.position)) ?? rows[0];
}

async function resolveContact(
  client: Client,
  projectId: string,
  recipientEmail: string | null,
  contactId: string | null
): Promise<Json | null> {
  if (contactId) {
    const r = await client
      .from(CONTACTS_TABLE)
      .select(CONTACT_COLUMNS)
      .eq("project_id", projectId)
      .eq("uuid", contactId)
      .maybeSingle();
    if (r.error) throw new Error(r.error.message);
    return (r.data as Json | null) ?? null;
  }
  if (!recipientEmail) return null;
  const email = recipientEmail.toLowerCase();
  for (const column of ["work_email", "email"] as const) {
    const r = await client
      .from(CONTACTS_TABLE)
      .select(CONTACT_COLUMNS)
      .eq("project_id", projectId)
      .ilike(column, email)
      .limit(5);
    if (r.error) throw new Error(r.error.message);
    const picked = pickContact((r.data ?? []) as Json[]);
    if (picked) return picked;
  }

  // Fall back: match any existing outreach_emails recipient for this project.
  const oe = await client
    .from("outreach_emails")
    .select("contact_id")
    .eq("project_id", projectId)
    .eq("recipient_email", email)
    .limit(1);
  if (oe.error) throw new Error(oe.error.message);
  const existingContactId = str(oe.data?.[0]?.contact_id);
  if (!existingContactId) return null;
  return resolveContact(client, projectId, null, existingContactId);
}

/**
 * Email Studio requires a contact per row, so a recipient Smartlead mailed that Voitech has
 * never seen gets a minimal contact carrying exactly what Smartlead knows. Tagged through
 * lead_category so it can be told apart from GetSales-synced contacts.
 */
async function createMinimalContact(
  client: Client,
  projectId: string,
  email: string,
  lead: SmartleadCampaignLead | undefined,
  fallbackName: string
): Promise<Json> {
  const first = str(lead?.first_name);
  const last = str(lead?.last_name);
  const name = [first, last].filter(Boolean).join(" ") || fallbackName || email;
  const now = new Date().toISOString();
  const r = await client
    .from(CONTACTS_TABLE)
    .insert({
      project_id: projectId,
      name,
      first_name: first || null,
      last_name: last || null,
      work_email: email,
      work_email_domain: email.split("@")[1] ?? null,
      email,
      company_name: str(lead?.company_name) || null,
      linkedin: str(lead?.linkedin_profile) || null,
      lead_category: "smartlead_campaign_sync",
      created_at: now,
      updated_at: now,
    })
    .select(CONTACT_COLUMNS)
    .single();
  if (r.error) throw new Error(`create contact ${email}: ${r.error.message}`);
  return r.data as Json;
}

async function resolveBatchName(
  client: Client,
  projectId: string,
  contactId: string,
  campaignId: string,
  preferred?: string
): Promise<string> {
  if (str(preferred)) return str(preferred);
  const existing = await client
    .from("outreach_emails")
    .select("batch_name")
    .eq("project_id", projectId)
    .eq("contact_id", contactId)
    .or(`campaign_id.eq.${campaignId},smartlead_campaign_id.eq.${campaignId}`)
    .order("created_at", { ascending: true })
    .limit(1);
  if (existing.error) throw new Error(existing.error.message);
  return str(existing.data?.[0]?.batch_name) || "Smartlead history";
}

function bodyForStorage(raw: string): string {
  if (!raw) return "";
  if (/<\s*(p|br|div)\b/i.test(raw)) return raw;
  return plaintextToHtml(raw);
}

/**
 * The POV an email was written on is the newest research snapshot for that contact that
 * already existed when the email went out. A snapshot created after the send is not the
 * one the copy rested on, so it is never attached retroactively.
 */
async function snapshotBeforeSend(client: Client, projectId: string, contactId: string, sentAt: string): Promise<string | null> {
  const r = await client
    .from("outreach_research_snapshots")
    .select("id")
    .eq("project_id", projectId)
    .eq("contact_id", contactId)
    .lte("created_at", sentAt)
    .order("created_at", { ascending: false })
    .limit(1);
  if (r.error) throw new Error(r.error.message);
  return str(r.data?.[0]?.id) || null;
}

/**
 * Find the Studio row a Smartlead send belongs to. In order: the row already carrying this
 * Smartlead message id; the exact identity key; a row for the same contact and step already
 * tied to this Smartlead campaign; and finally an unsent Voitech draft for the same contact
 * and step, which is the copy that was pushed and must flip to sent rather than be duplicated.
 */
async function findExistingRow(
  client: Client,
  args: { projectId: string; contactId: string; campaignId: string; batchName: string; step: number; messageId: string | null }
): Promise<Json | null> {
  const base = () => client.from("outreach_emails").select("*").eq("project_id", args.projectId);
  if (args.messageId) {
    const r = await base().eq("smartlead_message_id", args.messageId).limit(1);
    if (r.error) throw new Error(r.error.message);
    if (r.data?.[0]) return r.data[0] as Json;
  }
  const exact = await base()
    .eq("contact_id", args.contactId)
    .eq("campaign_id", args.campaignId)
    .eq("batch_name", args.batchName)
    .eq("channel", "email")
    .eq("step_number", args.step)
    .maybeSingle();
  if (exact.error) throw new Error(exact.error.message);
  if (exact.data) return exact.data as Json;

  const linked = await base()
    .eq("contact_id", args.contactId)
    .eq("channel", "email")
    .eq("step_number", args.step)
    .eq("smartlead_campaign_id", args.campaignId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (linked.error) throw new Error(linked.error.message);
  if (linked.data?.[0]) return linked.data[0] as Json;

  const draft = await base()
    .eq("contact_id", args.contactId)
    .eq("channel", "email")
    .eq("step_number", args.step)
    .neq("status", "sent")
    .is("smartlead_campaign_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (draft.error) throw new Error(draft.error.message);
  return (draft.data?.[0] as Json | undefined) ?? null;
}

type SendRecordArgs = {
  projectId: string;
  contact: Json;
  campaignId: string;
  leadId: string | null;
  batchName: string;
  step: number;
  subject: string;
  body: string;
  sentAt: string;
  messageId: string | null;
  recipientEmail: string;
  actorId: string;
  reason: string;
  apply: boolean;
};

type SendRecordResult = { emailId: string; action: "insert" | "update" | "skip"; subject: string; snapshotLinked: boolean };

async function recordSmartleadSend(client: Client, args: SendRecordArgs): Promise<SendRecordResult> {
  const subject = args.subject || `(step ${args.step})`;
  const body = bodyForStorage(args.body);
  const contactId = String(args.contact.uuid);
  const contactName =
    str(args.contact.name) || [str(args.contact.first_name), str(args.contact.last_name)].filter(Boolean).join(" ") || "Unknown";
  const prev = await findExistingRow(client, {
    projectId: args.projectId,
    contactId,
    campaignId: args.campaignId,
    batchName: args.batchName,
    step: args.step,
    messageId: args.messageId,
  });

  if (prev && str(prev.status) === "sent" && args.messageId && str(prev.smartlead_message_id) === args.messageId) {
    return { emailId: String(prev.id), action: "skip", subject, snapshotLinked: Boolean(prev.research_snapshot_id) };
  }
  const action: "insert" | "update" = prev ? "update" : "insert";
  const snapshotId = prev?.research_snapshot_id ? String(prev.research_snapshot_id) : await snapshotBeforeSend(client, args.projectId, contactId, args.sentAt);
  if (!args.apply) return { emailId: prev ? String(prev.id) : "", action, subject, snapshotLinked: Boolean(snapshotId) };

  const record: Json = {
    project_id: args.projectId,
    contact_id: contactId,
    company_id: args.contact.company_uuid ?? null,
    contact_name: contactName,
    company_name: str(args.contact.company_name),
    campaign_id: prev ? prev.campaign_id : args.campaignId,
    batch_name: prev ? prev.batch_name : args.batchName,
    persona: prev && str(prev.persona) ? prev.persona : str(args.contact.position),
    channel: "email",
    sequence_step: args.step,
    step_number: args.step,
    recipient_email: args.recipientEmail,
    current_subject: subject,
    current_body: body,
    current_model: prev?.current_model ?? null,
    research_quality: prev?.research_quality ?? "unknown",
    research_snapshot_id: snapshotId,
    status: "sent",
    generation_history_available: Boolean(prev?.generation_history_available),
    sent_at: args.sentAt,
    smartlead_campaign_id: args.campaignId,
    smartlead_lead_id: args.leadId ?? prev?.smartlead_lead_id ?? null,
    smartlead_message_id: args.messageId,
    updated_at: new Date().toISOString(),
  };

  let saved: Json;
  if (prev) {
    const provenance = str(prev.provenance) === "voitech_generated" || str(prev.provenance) === "combined" ? "combined" : "smartlead_history";
    const r = await client.from("outreach_emails").update({ ...record, provenance }).eq("id", prev.id).select("*").single();
    if (r.error) throw new Error(r.error.message);
    saved = r.data as Json;
  } else {
    const r = await client.from("outreach_emails").insert({ ...record, provenance: "smartlead_history" }).select("*").single();
    if (r.error) throw new Error(r.error.message);
    saved = r.data as Json;
  }

  // A flipped draft keeps its version history; the as-sent copy is appended as the current version.
  const prevVersion = saved.current_version_id ? await client.from("outreach_email_versions").select("version_number, subject, body").eq("id", saved.current_version_id).maybeSingle() : null;
  const sameCopy = prevVersion?.data && str(prevVersion.data.subject) === subject && str(prevVersion.data.body) === body;
  if ((subject || body) && !sameCopy) {
    if (saved.current_version_id) await client.from("outreach_email_versions").update({ state: "superseded" }).eq("id", saved.current_version_id);
    const v = await client
      .from("outreach_email_versions")
      .insert({
        email_id: saved.id,
        version_number: Number(prevVersion?.data?.version_number ?? 0) + 1,
        subject,
        body,
        author_type: "import",
        author_id: args.actorId,
        annotations: [],
        validation_results: [],
        generation_reason: args.actorId,
        state: "current",
      })
      .select("id")
      .single();
    if (v.error && v.error.code !== "23505") throw new Error(v.error.message);
    if (v.data) await client.from("outreach_emails").update({ current_version_id: v.data.id }).eq("id", saved.id);
  }

  const ev = await client.from("outreach_email_status_events").insert({
    email_id: saved.id,
    from_status: prev ? prev.status ?? null : null,
    to_status: "sent",
    actor_type: "import",
    actor_id: args.actorId,
    reason: args.reason,
    idempotency_key: `${args.actorId.replace(/_/g, "-")}:${args.messageId ?? `${args.campaignId}:${contactId}:${args.step}`}`,
  });
  if (ev.error && ev.error.code !== "23505") throw new Error(ev.error.message);
  return { emailId: String(saved.id), action, subject, snapshotLinked: Boolean(snapshotId) };
}

/** Pull Smartlead SENT history for one lead and upsert missing/outdated outreach_emails steps. */
export async function reconcileSmartleadLead(args: {
  projectId: string;
  campaignId: string;
  leadId: string;
  contactId?: string | null;
  recipientEmail?: string | null;
  batchName?: string;
}): Promise<ReconcileResult> {
  const client = getSupabase();
  if (!client) throw new Error("Supabase not configured");

  const history = await getLeadMessageHistory(args.campaignId, args.leadId);
  const sent = history.filter(isSmartleadSentMessage);
  const recipientFromHistory = str(sent[0]?.to).toLowerCase() || str(args.recipientEmail).toLowerCase() || null;
  const contact = await resolveContact(client, args.projectId, recipientFromHistory, args.contactId ?? null);
  if (!contact) {
    throw new Error(`No contact found for project (email=${recipientFromHistory ?? "n/a"}, contactId=${args.contactId ?? "n/a"})`);
  }

  const batchName = await resolveBatchName(client, args.projectId, String(contact.uuid), String(args.campaignId), args.batchName);
  const recipientEmail = recipientFromHistory || str(contact.work_email).toLowerCase() || "unknown@example.com";

  const steps: ReconcileResult["steps"] = [];
  let upserted = 0;
  let skipped = 0;
  for (const msg of sent as SmartleadHistoryMessage[]) {
    const step = smartleadMessageStep(msg);
    if (!step) {
      skipped++;
      continue;
    }
    const result = await recordSmartleadSend(client, {
      projectId: args.projectId,
      contact,
      campaignId: String(args.campaignId),
      leadId: String(args.leadId),
      batchName,
      step,
      subject: str(msg.subject),
      body: str(msg.email_body),
      sentAt: str(msg.time) || new Date().toISOString(),
      messageId: str(msg.message_id) || str(msg.stats_id) || null,
      recipientEmail,
      actorId: "smartlead_reconcile",
      reason: "Reconciled from Smartlead message history",
      apply: true,
    });
    steps.push({ step, emailId: result.emailId, action: result.action, subject: result.subject });
    if (result.action === "skip") skipped++;
    else upserted++;
  }

  return {
    campaignId: String(args.campaignId),
    leadId: String(args.leadId),
    recipientEmail,
    contactId: String(contact.uuid),
    sentInSmartlead: sent.length,
    upserted,
    skipped,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Campaign sweep: every send Smartlead reports for a campaign lands in Email Studio.
// ---------------------------------------------------------------------------

export type SmartleadCampaignRef = { campaignId: string; campaignName: string | null };

/**
 * Batch label for rows that have no Voitech draft to flip into. Mirrors the labels used by
 * the 2026-09-07 load ("smartlead-history-IT"): the persona word at the end of the Smartlead
 * campaign name, or the campaign id when the name is unknown.
 */
export function smartleadBatchLabel(ref: SmartleadCampaignRef): string {
  const name = str(ref.campaignName);
  const tail = name.split(/\s+/).filter(Boolean).pop() ?? "";
  return `smartlead-history-${tail || ref.campaignId}`;
}

/** Statistics rows that are real dispatches with enough identity to record, oldest first. */
export function selectSentStatistics(rows: SmartleadCampaignStat[]): Array<SmartleadCampaignStat & { step: number; email: string; statsId: string; sentTime: string }> {
  const out: Array<SmartleadCampaignStat & { step: number; email: string; statsId: string; sentTime: string }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const sentTime = str(row.sent_time);
    const email = str(row.lead_email).toLowerCase();
    const statsId = str(row.stats_id);
    const step = Number(row.sequence_number ?? 0);
    if (!sentTime || !email || !statsId || !Number.isFinite(step) || step < 1) continue;
    if (seen.has(statsId)) continue;
    seen.add(statsId);
    out.push({ ...row, step: Math.floor(step), email, statsId, sentTime });
  }
  return out.sort((a, b) => a.sentTime.localeCompare(b.sentTime));
}

/**
 * Which Smartlead campaigns belong to a project. Read from gtm_flow_source_map, the same
 * table the analytics snapshot refresh scopes by, so one edit there adds a campaign to both.
 */
export async function loadSmartleadCampaignMap(client: Client, projectId: string): Promise<SmartleadCampaignRef[]> {
  const p = await client.from(PROJECTS_TABLE).select("name").eq("id", projectId).maybeSingle();
  if (p.error) throw new Error(p.error.message);
  const projectName = str((p.data as Json | null)?.name).toLowerCase();
  if (!projectName) return [];
  const m = await client.from("gtm_flow_source_map").select("campaign_id, campaign_name, project").eq("vendor", "smartlead").ilike("project", projectName);
  if (m.error) throw new Error(m.error.message);
  return ((m.data ?? []) as Json[])
    .map((row) => ({ campaignId: str(row.campaign_id), campaignName: str(row.campaign_name) || null }))
    .filter((ref) => ref.campaignId);
}

export type CampaignSyncSummary = {
  campaignId: string;
  campaignName: string | null;
  leadsInCampaign: number;
  statsRows: number;
  sentRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  contactsCreated: number;
  unresolvedRecipients: string[];
  withoutSnapshot: number;
  errors: Array<{ email: string; step: number; error: string }>;
};

export type CampaignSyncResult = { mode: "apply" | "dry-run"; projectId: string; campaigns: CampaignSyncSummary[] };

/**
 * Pull everything Smartlead sent for the project's campaigns and make sure each send is a
 * `sent` row in Email Studio with the as-sent copy and the POV snapshot it rested on.
 * Idempotent on the Smartlead stats id; one bad row is reported, not fatal.
 */
export async function syncSmartleadCampaignSends(args: {
  projectId: string;
  campaigns?: SmartleadCampaignRef[];
  apply?: boolean;
  log?: (line: string) => void;
}): Promise<CampaignSyncResult> {
  const client = getSupabase();
  if (!client) throw new Error("Supabase not configured");
  const apply = Boolean(args.apply);
  const log = args.log ?? (() => {});
  const campaigns = args.campaigns?.length ? args.campaigns : await loadSmartleadCampaignMap(client, args.projectId);
  const out: CampaignSyncResult = { mode: apply ? "apply" : "dry-run", projectId: args.projectId, campaigns: [] };

  for (const ref of campaigns) {
    const summary: CampaignSyncSummary = {
      campaignId: ref.campaignId,
      campaignName: ref.campaignName,
      leadsInCampaign: 0,
      statsRows: 0,
      sentRows: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      contactsCreated: 0,
      unresolvedRecipients: [],
      withoutSnapshot: 0,
      errors: [],
    };
    out.campaigns.push(summary);
    const batchName = smartleadBatchLabel(ref);
    let leads: Map<string, SmartleadCampaignLead>;
    let stats: SmartleadCampaignStat[];
    try {
      [leads, stats] = await Promise.all([listCampaignLeads(ref.campaignId), listCampaignStatistics(ref.campaignId)]);
    } catch (e) {
      summary.errors.push({ email: "", step: 0, error: e instanceof Error ? e.message : String(e) });
      log(`campaign ${ref.campaignId}: fetch failed: ${summary.errors[0].error}`);
      continue;
    }
    summary.leadsInCampaign = leads.size;
    summary.statsRows = stats.length;
    const sent = selectSentStatistics(stats);
    summary.sentRows = sent.length;

    const contactCache = new Map<string, Json | null>();
    for (const row of sent) {
      try {
        let contact = contactCache.get(row.email);
        if (contact === undefined) {
          contact = await resolveContact(client, args.projectId, row.email, null);
          if (!contact) {
            if (apply) {
              contact = await createMinimalContact(client, args.projectId, row.email, leads.get(row.email), str(row.lead_name));
              summary.contactsCreated++;
            } else {
              summary.contactsCreated++;
              summary.unresolvedRecipients.push(row.email);
            }
          }
          contactCache.set(row.email, contact);
        }
        if (!contact) {
          // Dry run for a recipient Voitech has never seen: it would be inserted after a contact is created.
          summary.inserted++;
          summary.withoutSnapshot++;
          continue;
        }
        const result = await recordSmartleadSend(client, {
          projectId: args.projectId,
          contact,
          campaignId: ref.campaignId,
          leadId: leads.get(row.email)?.id != null ? String(leads.get(row.email)!.id) : null,
          batchName,
          step: row.step,
          subject: str(row.email_subject),
          body: str(row.email_message),
          sentAt: row.sentTime,
          messageId: row.statsId,
          recipientEmail: row.email,
          actorId: "smartlead_campaign_sync",
          reason: `Sent by Smartlead campaign ${ref.campaignId}`,
          apply,
        });
        summary[result.action === "insert" ? "inserted" : result.action === "update" ? "updated" : "skipped"]++;
        if (!result.snapshotLinked) summary.withoutSnapshot++;
        if (result.action !== "skip") log(`${row.email} step ${row.step}: ${apply ? result.action : `would ${result.action}`}`);
      } catch (e) {
        summary.errors.push({ email: row.email, step: row.step, error: e instanceof Error ? e.message : String(e) });
      }
    }
    log(
      `campaign ${ref.campaignId} (${ref.campaignName ?? "unnamed"}): ${summary.sentRows} sends, ` +
        `${summary.inserted} insert, ${summary.updated} update, ${summary.skipped} already recorded, ` +
        `${summary.contactsCreated} contacts ${apply ? "created" : "to create"}, ${summary.errors.length} errors`
    );
  }
  return out;
}
