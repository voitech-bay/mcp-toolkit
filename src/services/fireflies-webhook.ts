/**
 * Fireflies.ai webhook verification and normalization.
 * @see docs/fireflies-webhooks.md
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyFirefliesHubSignature(
  rawBodyUtf8: string,
  headerValue: string | undefined,
  secret: string
): boolean {
  if (!headerValue?.startsWith("sha256=")) return false;
  const expected =
    "sha256=" +
    createHmac("sha256", secret).update(rawBodyUtf8, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(headerValue, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type FirefliesPayloadVariant = "v1" | "v2" | "unknown";

export interface NormalizedFirefliesWebhook {
  payloadVariant: FirefliesPayloadVariant;
  eventType: string;
  meetingId: string | null;
  clientReferenceId: string | null;
  firefliesTimestampMs: number | null;
}

/** Whether this event means transcript text is available (fetch via GraphQL). */
export function isTranscriptReadyEvent(normalized: NormalizedFirefliesWebhook): boolean {
  const t = normalized.eventType;
  return (
    t === "Transcription completed" ||
    t === "meeting.transcribed"
  );
}

export function normalizeFirefliesPayload(
  body: Record<string, unknown>
): NormalizedFirefliesWebhook {
  if (typeof body.event === "string") {
    return {
      payloadVariant: "v2",
      eventType: body.event,
      meetingId:
        typeof body.meeting_id === "string"
          ? body.meeting_id
          : typeof body.meetingId === "string"
            ? body.meetingId
            : null,
      clientReferenceId:
        typeof body.client_reference_id === "string"
          ? body.client_reference_id
          : typeof body.clientReferenceId === "string"
            ? body.clientReferenceId
            : null,
      firefliesTimestampMs:
        typeof body.timestamp === "number" && Number.isFinite(body.timestamp)
          ? Math.trunc(body.timestamp)
          : null,
    };
  }

  if (typeof body.eventType === "string" || typeof body.meetingId === "string") {
    return {
      payloadVariant: "v1",
      eventType: typeof body.eventType === "string" ? body.eventType : "unknown",
      meetingId: typeof body.meetingId === "string" ? body.meetingId : null,
      clientReferenceId:
        typeof body.clientReferenceId === "string" ? body.clientReferenceId : null,
      firefliesTimestampMs: null,
    };
  }

  return {
    payloadVariant: "unknown",
    eventType: "unknown",
    meetingId: null,
    clientReferenceId: null,
    firefliesTimestampMs: null,
  };
}

export interface ContextAgentWebhookJob {
  schema_version: 1;
  source: "mcp-toolkit";
  fireflies_webhook_event_id: string;
  payload_variant: FirefliesPayloadVariant;
  event_type: string;
  meeting_id: string | null;
  client_reference_id: string | null;
  fireflies_timestamp_ms: number | null;
  /** Full stored Fireflies JSON (ids only; no transcript). */
  payload: Record<string, unknown>;
}

export function buildContextAgentJob(
  rowId: string,
  normalized: NormalizedFirefliesWebhook,
  payload: Record<string, unknown>
): ContextAgentWebhookJob {
  return {
    schema_version: 1,
    source: "mcp-toolkit",
    fireflies_webhook_event_id: rowId,
    payload_variant: normalized.payloadVariant,
    event_type: normalized.eventType,
    meeting_id: normalized.meetingId,
    client_reference_id: normalized.clientReferenceId,
    fireflies_timestamp_ms: normalized.firefliesTimestampMs,
    payload,
  };
}
