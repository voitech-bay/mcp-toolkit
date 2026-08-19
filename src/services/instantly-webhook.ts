import { timingSafeEqual } from "node:crypto";
import { instantlyStepNumber } from "./instantly.js";

export type Json = Record<string, unknown>;

export type InstantlyWebhookKind = "sent" | "bounced" | "reply" | "other";

export type ParsedInstantlyWebhook = {
  eventType: string;
  kind: InstantlyWebhookKind;
  eventId: string;
  campaignId: string;
  leadId: string;
  messageId: string;
  recipientEmail: string;
  step: number;
  occurredAt: string;
  subject: string;
  replyText: string;
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nested(obj: Json, key: string): Json {
  const value = obj[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

export function isInstantlyWebhookSecretValid(
  received: string | undefined,
  expected = process.env.INSTANTLY_WEBHOOK_SECRET
): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function instantlyWebhookKind(eventType: string): InstantlyWebhookKind {
  const type = eventType.toLowerCase();
  if (type === "email_sent" || type === "sent" || type === "first_email_sent") return "sent";
  if (type === "email_bounced" || type === "bounced" || type === "bounce") return "bounced";
  if (type === "reply_received" || type === "email_reply" || type === "reply" || type === "replied") return "reply";
  return "other";
}

export function parseInstantlyWebhookPayload(body: Json): ParsedInstantlyWebhook {
  const lead = nested(body, "lead");
  const email = nested(body, "email");
  const reply = nested(body, "reply");
  const eventType = str(body.event_type ?? body.eventType ?? body.event ?? body.type).toLowerCase();
  const campaignId = str(body.campaign_id ?? body.campaignId ?? body.campaign ?? lead.campaign);
  const leadId = str(body.lead_id ?? body.leadId ?? lead.id ?? lead.lead_id);
  const messageId = str(
    body.message_id ??
    body.messageId ??
    body.unibox_id ??
    email.id ??
    email.message_id ??
    body.id
  );
  const recipientEmail = str(
    body.to_address_email_list ??
    body.to_address ??
    body.email ??
    body.lead_email ??
    body.recipient_email ??
    lead.email ??
    email.to
  ).toLowerCase();
  const step = instantlyStepNumber(str(body.step ?? email.step ?? lead.step) || undefined);
  const occurredAt =
    str(
      body.timestamp ??
      body.timestamp_email ??
      body.event_timestamp ??
      body.occurred_at ??
      body.sent_at ??
      email.timestamp_email
    ) || new Date().toISOString();
  const subject = str(body.subject ?? email.subject ?? reply.subject ?? "Email reply");
  const replyText = str(
    body.reply_text ??
    body.reply_body ??
    body.reply_message ??
    reply.text ??
    reply.body ??
    body.text ??
    body.body ??
    email.body
  );
  const eventId =
    str(body.event_id ?? body.eventId ?? body.webhook_id) ||
    [eventType, messageId, campaignId, leadId, recipientEmail, String(step), occurredAt].filter(Boolean).join(":");
  return {
    eventType,
    kind: instantlyWebhookKind(eventType),
    eventId,
    campaignId,
    leadId,
    messageId,
    recipientEmail,
    step,
    occurredAt,
    subject,
    replyText,
  };
}

/** Warmup / unknown Instantly events have no recipient we can attach to a Voitech contact. */
export function instantlyWebhookNeedsContact(parsed: ParsedInstantlyWebhook): boolean {
  return Boolean(parsed.recipientEmail || parsed.leadId || parsed.messageId);
}
