/** Shared outreach / reply / connection filter buckets for Companies & Contacts lists. */

export type OutreachEnrollmentFilter = "enrolled" | "finished" | "not_enrolled" | "paused";
export type ReplySentimentFilter = "no_reply" | "positive" | "negative" | "neutral";
export type ConnectionStatusFilter = "accepted" | "sent" | "withdrawn" | "none";

export interface OutreachListFilters {
  linkedinOutreach?: OutreachEnrollmentFilter | null;
  emailOutreach?: OutreachEnrollmentFilter | null;
  replyStatus?: ReplySentimentFilter | null;
  connectionStatus?: ConnectionStatusFilter | null;
}

const ENROLLMENT = new Set<string>(["enrolled", "finished", "not_enrolled", "paused"]);
const REPLY = new Set<string>(["no_reply", "positive", "negative", "neutral"]);
const CONNECTION = new Set<string>(["accepted", "sent", "withdrawn", "none"]);

export function parseOutreachEnrollment(raw: string | null | undefined): OutreachEnrollmentFilter | null {
  const v = raw?.trim().toLowerCase() ?? "";
  return ENROLLMENT.has(v) ? (v as OutreachEnrollmentFilter) : null;
}

export function parseReplySentiment(raw: string | null | undefined): ReplySentimentFilter | null {
  const v = raw?.trim().toLowerCase() ?? "";
  return REPLY.has(v) ? (v as ReplySentimentFilter) : null;
}

export function parseConnectionStatusFilter(raw: string | null | undefined): ConnectionStatusFilter | null {
  const v = raw?.trim().toLowerCase() ?? "";
  return CONNECTION.has(v) ? (v as ConnectionStatusFilter) : null;
}

export function hasOutreachListFilters(f: OutreachListFilters | null | undefined): boolean {
  if (!f) return false;
  return Boolean(f.linkedinOutreach || f.emailOutreach || f.replyStatus || f.connectionStatus);
}

export const OUTREACH_ENROLLMENT_OPTIONS = [
  { label: "Enrolled in a sequence", value: "enrolled" },
  { label: "Finished sequence", value: "finished" },
  { label: "Not enrolled", value: "not_enrolled" },
  { label: "Paused", value: "paused" },
] as const;

export const REPLY_SENTIMENT_OPTIONS = [
  { label: "No reply", value: "no_reply" },
  { label: "Replied — Positive", value: "positive" },
  { label: "Replied — Negative", value: "negative" },
  { label: "Replied — Neutral", value: "neutral" },
] as const;

export const CONNECTION_STATUS_OPTIONS = [
  { label: "Connected", value: "accepted" },
  { label: "Connection sent", value: "sent" },
  { label: "Withdrawn", value: "withdrawn" },
  { label: "Not connected", value: "none" },
] as const;
