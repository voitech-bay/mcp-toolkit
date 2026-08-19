import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import { CONTACTS_TABLE, getSupabase } from "./services/supabase.js";
import { canTransition, type EmailStatus } from "./services/email-studio.js";
import {
  isInstantlyWebhookSecretValid,
  parseInstantlyWebhookPayload,
  instantlyWebhookNeedsContact,
  type Json,
} from "./services/instantly-webhook.js";

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : {};
  } catch {
    return {};
  }
}

function uuidFromKey(key: string): string {
  const bytes = Buffer.from(crypto.createHash("sha256").update(key).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function webhookSecret(req: IncomingMessage): string | undefined {
  const header = req.headers["x-instantly-webhook-secret"];
  if (typeof header === "string") return header;
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.searchParams.get("token") ?? undefined;
}

type Client = NonNullable<ReturnType<typeof getSupabase>>;

async function matchOutreachEmail(client: Client, parsed: ReturnType<typeof parseInstantlyWebhookPayload>): Promise<{ rows: Json[]; reason: string }> {
  if (parsed.messageId) {
    const r = await client
      .from("outreach_emails")
      .select("*")
      .contains("external_push_log", { message_id: parsed.messageId });
    if (r.error) throw new Error(r.error.message);
    const rows = (r.data ?? []) as Json[];
    if (rows.length) return { rows, reason: "Instantly message id" };
  }
  if (parsed.leadId && parsed.campaignId && parsed.step > 0) {
    const r = await client
      .from("outreach_emails")
      .select("*")
      .eq("campaign_id", parsed.campaignId)
      .eq("channel", "email")
      .eq("step_number", parsed.step)
      .contains("external_push_log", { lead_id: parsed.leadId });
    if (r.error) throw new Error(r.error.message);
    const rows = (r.data ?? []) as Json[];
    if (rows.length) return { rows, reason: "Instantly lead id, campaign, and step" };
  }
  if (parsed.recipientEmail && parsed.campaignId && parsed.step > 0) {
    const r = await client
      .from("outreach_emails")
      .select("*")
      .eq("recipient_email", parsed.recipientEmail)
      .eq("campaign_id", parsed.campaignId)
      .eq("channel", "email")
      .eq("step_number", parsed.step);
    if (r.error) throw new Error(r.error.message);
    const rows = (r.data ?? []) as Json[];
    if (rows.length) return { rows, reason: "Recipient email, campaign, and step" };
  }
  if (parsed.recipientEmail && parsed.campaignId) {
    const r = await client
      .from("outreach_emails")
      .select("*")
      .eq("recipient_email", parsed.recipientEmail)
      .eq("campaign_id", parsed.campaignId)
      .eq("channel", "email")
      .order("step_number", { ascending: true });
    if (r.error) throw new Error(r.error.message);
    const rows = (r.data ?? []) as Json[];
    if (rows.length === 1) return { rows, reason: "Recipient email and campaign (single row)" };
  }
  return { rows: [], reason: "No matching Instantly identifiers" };
}

async function resolveContact(
  client: Client,
  email: Json | null,
  recipientEmail: string
): Promise<Json | null> {
  const contactId = str(email?.contact_id);
  const projectId = str(email?.project_id);
  if (contactId && projectId) {
    const r = await client
      .from(CONTACTS_TABLE)
      .select("uuid, project_id, work_email, email_inbox_count")
      .eq("uuid", contactId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (r.error) throw new Error(r.error.message);
    if (r.data) return r.data as Json;
  }
  if (!recipientEmail) return null;
  let query = client
    .from(CONTACTS_TABLE)
    .select("uuid, project_id, work_email, email_inbox_count")
    .ilike("work_email", recipientEmail)
    .limit(5);
  if (projectId) query = query.eq("project_id", projectId);
  const r = await query;
  if (r.error) throw new Error(r.error.message);
  const rows = (r.data ?? []) as Json[];
  return rows.length === 1 ? rows[0] : null;
}

async function markEmailStatus(
  client: Client,
  email: Json,
  to: EmailStatus,
  reason: string,
  idempotencyKey: string
) {
  const from = String(email.status) as EmailStatus;
  if (!canTransition(from, to, "import")) throw new Error(`Status cannot move from ${from} to ${to}`);
  if (from !== to) {
    const event = await client.from("outreach_email_status_events").insert({
      email_id: email.id,
      from_status: from,
      to_status: to,
      actor_type: "import",
      actor_id: "instantly",
      reason,
      idempotency_key: idempotencyKey,
    });
    if (event.error && event.error.code !== "23505") throw new Error(event.error.message);
  }
}

/**
 * Instantly → Voitech. Unknown recipients (warmup, mail-tester) return 200 skipped.
 */
export async function handleInstantlyWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!isInstantlyWebhookSecretValid(webhookSecret(req))) {
    return send(res, 401, { error: "Invalid webhook secret" });
  }
  const client = getSupabase();
  if (!client) return send(res, 200, { status: "skipped", reason: "Supabase not configured" });

  const body = await readBody(req);
  const parsed = parseInstantlyWebhookPayload(body);
  if (!parsed.eventType || !parsed.eventId) {
    return send(res, 200, { status: "skipped", reason: "No Instantly event type" });
  }
  if (!instantlyWebhookNeedsContact(parsed)) {
    return send(res, 200, { status: "skipped", reason: "No recipient, lead, or message id" });
  }

  const existing = await client
    .from("outreach_email_delivery_events")
    .select("*")
    .eq("provider", "instantly")
    .eq("provider_event_id", parsed.eventId)
    .maybeSingle();
  if (existing.error) return send(res, 500, { error: existing.error.message });
  if (existing.data) return send(res, 200, { status: "replay", data: existing.data });

  const matched = await matchOutreachEmail(client, parsed);
  const email = matched.rows.length === 1 ? matched.rows[0] : null;
  const contact = await resolveContact(client, email, parsed.recipientEmail);
  if (!contact) {
    return send(res, 200, { status: "skipped", reason: "No matching Contacts lead (warmup or unknown recipient)" });
  }

  const matchStatus = email ? "matched" : "unmatched";
  const ins = await client.from("outreach_email_delivery_events").insert({
    provider: "instantly",
    provider_event_id: parsed.eventId,
    event_type: parsed.eventType,
    payload: body,
    email_id: email?.id ?? null,
    match_status: matchStatus,
    match_reason: email ? matched.reason : `${matched.reason}; contact ${str(contact.uuid)}`,
    occurred_at: parsed.occurredAt,
  }).select("*").single();
  if (ins.error) return send(res, 500, { error: ins.error.message });

  if (email && parsed.kind === "sent") {
    try {
      await markEmailStatus(client, email, "sent", `Verified Instantly ${parsed.eventType} event`, `instantly:${parsed.eventId}:sent`);
      const prevLog = email.external_push_log && typeof email.external_push_log === "object" ? email.external_push_log as Json : {};
      await client.from("outreach_emails").update({
        status: "sent",
        sent_at: parsed.occurredAt,
        recipient_email: parsed.recipientEmail || email.recipient_email,
        external_target: "instantly",
        external_push_log: {
          ...prevLog,
          provider: "instantly",
          campaign_id: parsed.campaignId || prevLog.campaign_id,
          lead_id: parsed.leadId || prevLog.lead_id,
          message_id: parsed.messageId || prevLog.message_id,
        },
        updated_at: new Date().toISOString(),
      }).eq("id", email.id);
    } catch (e) {
      return send(res, 409, { error: e instanceof Error ? e.message : "Delivery status failed", event: ins.data });
    }
  }

  if (email && parsed.kind === "bounced") {
    try {
      await markEmailStatus(client, email, "sending_failed", `Instantly bounce ${parsed.eventType}`, `instantly:${parsed.eventId}:bounce`);
      await client.from("outreach_emails").update({
        status: "sending_failed",
        updated_at: new Date().toISOString(),
      }).eq("id", email.id);
    } catch (e) {
      return send(res, 409, { error: e instanceof Error ? e.message : "Bounce status failed", event: ins.data });
    }
  }

  if (parsed.kind === "reply" && parsed.replyText) {
    const contactId = str(contact.uuid);
    const projectId = str(contact.project_id);
    const replyUuid = uuidFromKey(`instantly-reply:${parsed.eventId}`);
    const convUuid = uuidFromKey(
      `instantly-thread:${projectId}:${contactId}:${parsed.campaignId || str(email?.id) || parsed.recipientEmail}`
    );
    await client.from("LinkedinMessages").upsert(
      {
        uuid: replyUuid,
        lead_uuid: contactId,
        project_id: projectId,
        linkedin_conversation_uuid: convUuid,
        type: "inbox",
        linkedin_type: "email",
        subject: parsed.subject.slice(0, 500),
        text: parsed.replyText.slice(0, 20000),
        status: "done",
        automation: "instantly_webhook",
        sent_at: parsed.occurredAt,
        created_at: parsed.occurredAt,
        updated_at: new Date().toISOString(),
        reply_received: true,
      },
      { onConflict: "uuid" }
    );
    const prev = Number(contact.email_inbox_count ?? 0);
    await client
      .from(CONTACTS_TABLE)
      .update({ email_inbox_count: prev + 1, markers_synced_at: new Date().toISOString() })
      .eq("uuid", contactId);
  }

  return send(res, 202, {
    status: "ok",
    data: ins.data,
    matchStatus,
    matchedEmailId: email?.id ?? null,
    contactId: contact.uuid,
  });
}
