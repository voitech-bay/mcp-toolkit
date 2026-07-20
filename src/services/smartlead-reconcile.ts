import { CONTACTS_TABLE, getSupabase } from "./supabase.js";
import {
  getLeadMessageHistory,
  isSmartleadSentMessage,
  smartleadMessageStep,
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

async function resolveContact(
  client: Client,
  projectId: string,
  recipientEmail: string | null,
  contactId: string | null
): Promise<Json | null> {
  if (contactId) {
    const r = await client
      .from(CONTACTS_TABLE)
      .select("uuid, name, first_name, last_name, company_uuid, company_name, position, work_email")
      .eq("project_id", projectId)
      .eq("uuid", contactId)
      .maybeSingle();
    if (r.error) throw new Error(r.error.message);
    return (r.data as Json | null) ?? null;
  }
  if (!recipientEmail) return null;
  const email = recipientEmail.toLowerCase();
  const r = await client
    .from(CONTACTS_TABLE)
    .select("uuid, name, first_name, last_name, company_uuid, company_name, position, work_email")
    .eq("project_id", projectId)
    .ilike("work_email", email)
    .limit(1);
  if (r.error) throw new Error(r.error.message);
  if (r.data?.[0]) return r.data[0] as Json;

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

function bodyForStorage(msg: SmartleadHistoryMessage): string {
  const raw = str(msg.email_body);
  if (!raw) return "";
  if (/<\s*(p|br|div)\b/i.test(raw)) return raw;
  return plaintextToHtml(raw);
}

async function upsertSentStep(
  client: Client,
  args: {
    projectId: string;
    contact: Json;
    campaignId: string;
    leadId: string;
    batchName: string;
    msg: SmartleadHistoryMessage;
    step: number;
    recipientEmail: string;
  }
): Promise<{ emailId: string; action: "insert" | "update" | "skip"; subject: string }> {
  const subject = str(args.msg.subject) || `(step ${args.step})`;
  const body = bodyForStorage(args.msg);
  const sentAt = str(args.msg.time) || new Date().toISOString();
  const messageId = str(args.msg.message_id) || str(args.msg.stats_id) || null;
  const contactName =
    str(args.contact.name) ||
    [str(args.contact.first_name), str(args.contact.last_name)].filter(Boolean).join(" ") ||
    "Unknown";

  const existing = await client
    .from("outreach_emails")
    .select("*")
    .eq("project_id", args.projectId)
    .eq("contact_id", String(args.contact.uuid))
    .eq("campaign_id", args.campaignId)
    .eq("batch_name", args.batchName)
    .eq("channel", "email")
    .eq("step_number", args.step)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  const record: Json = {
    project_id: args.projectId,
    contact_id: String(args.contact.uuid),
    company_id: args.contact.company_uuid ?? null,
    contact_name: contactName,
    company_name: str(args.contact.company_name),
    campaign_id: args.campaignId,
    batch_name: args.batchName,
    persona: str(args.contact.position),
    channel: "email",
    sequence_step: args.step,
    step_number: args.step,
    recipient_email: args.recipientEmail,
    current_subject: subject,
    current_body: body,
    current_model: null,
    research_quality: "unknown",
    status: "sent",
    generation_history_available: false,
    sent_at: sentAt,
    smartlead_campaign_id: args.campaignId,
    smartlead_lead_id: args.leadId,
    smartlead_message_id: messageId,
    updated_at: new Date().toISOString(),
  };

  if (existing.data) {
    const prev = existing.data as Json;
    // Skip no-op updates when already sent with same message id.
    if (
      str(prev.status) === "sent" &&
      str(prev.smartlead_message_id) === str(messageId) &&
      str(prev.current_subject) === subject
    ) {
      return { emailId: String(prev.id), action: "skip", subject };
    }
    const provenance =
      str(prev.provenance) === "voitech_generated" || str(prev.provenance) === "combined"
        ? "combined"
        : "smartlead_history";
    const saved = await client
      .from("outreach_emails")
      .update({
        ...record,
        provenance,
        generation_history_available: Boolean(prev.generation_history_available),
      })
      .eq("id", prev.id)
      .select("*")
      .single();
    if (saved.error) throw new Error(saved.error.message);
    if (!saved.data.current_version_id && (subject || body)) {
      const v = await client
        .from("outreach_email_versions")
        .insert({
          email_id: saved.data.id,
          version_number: 1,
          subject,
          body,
          author_type: "import",
          author_id: "smartlead_reconcile",
          annotations: [],
          validation_results: [],
          generation_reason: "smartlead_reconcile",
          state: "current",
        })
        .select("id")
        .single();
      if (v.error && v.error.code !== "23505") throw new Error(v.error.message);
      if (v.data) await client.from("outreach_emails").update({ current_version_id: v.data.id }).eq("id", saved.data.id);
    }
    const ev = await client.from("outreach_email_status_events").insert({
      email_id: saved.data.id,
      from_status: prev.status ?? null,
      to_status: "sent",
      actor_type: "import",
      actor_id: "smartlead_reconcile",
      reason: "Reconciled from Smartlead message history",
      idempotency_key: `smartlead-reconcile:${messageId ?? `${args.campaignId}:${args.contact.uuid}:${args.step}`}`,
    });
    if (ev.error && ev.error.code !== "23505") throw new Error(ev.error.message);
    return { emailId: String(saved.data.id), action: "update", subject };
  }

  const inserted = await client
    .from("outreach_emails")
    .insert({ ...record, provenance: "smartlead_history" })
    .select("*")
    .single();
  if (inserted.error) throw new Error(inserted.error.message);
  if (subject || body) {
    const v = await client
      .from("outreach_email_versions")
      .insert({
        email_id: inserted.data.id,
        version_number: 1,
        subject,
        body,
        author_type: "import",
        author_id: "smartlead_reconcile",
        annotations: [],
        validation_results: [],
        generation_reason: "smartlead_reconcile",
        state: "current",
      })
      .select("id")
      .single();
    if (v.error && v.error.code !== "23505") throw new Error(v.error.message);
    if (v.data) await client.from("outreach_emails").update({ current_version_id: v.data.id }).eq("id", inserted.data.id);
  }
  const ev = await client.from("outreach_email_status_events").insert({
    email_id: inserted.data.id,
    from_status: null,
    to_status: "sent",
    actor_type: "import",
    actor_id: "smartlead_reconcile",
    reason: "Reconciled from Smartlead message history",
    idempotency_key: `smartlead-reconcile:${messageId ?? `${args.campaignId}:${args.contact.uuid}:${args.step}`}`,
  });
  if (ev.error && ev.error.code !== "23505") throw new Error(ev.error.message);
  return { emailId: String(inserted.data.id), action: "insert", subject };
}

/** Pull Smartlead SENT history and upsert missing/outdated outreach_emails steps. */
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
  const recipientFromHistory =
    str(sent[0]?.to).toLowerCase() || str(args.recipientEmail).toLowerCase() || null;
  const contact = await resolveContact(
    client,
    args.projectId,
    recipientFromHistory,
    args.contactId ?? null
  );
  if (!contact) {
    throw new Error(
      `No contact found for project (email=${recipientFromHistory ?? "n/a"}, contactId=${args.contactId ?? "n/a"})`
    );
  }

  const batchName = await resolveBatchName(
    client,
    args.projectId,
    String(contact.uuid),
    String(args.campaignId),
    args.batchName
  );
  const recipientEmail =
    recipientFromHistory || str(contact.work_email).toLowerCase() || "unknown@example.com";

  const steps: ReconcileResult["steps"] = [];
  let upserted = 0;
  let skipped = 0;
  for (const msg of sent) {
    const step = smartleadMessageStep(msg);
    if (!step) {
      skipped++;
      continue;
    }
    const result = await upsertSentStep(client, {
      projectId: args.projectId,
      contact,
      campaignId: String(args.campaignId),
      leadId: String(args.leadId),
      batchName,
      msg,
      step,
      recipientEmail,
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
