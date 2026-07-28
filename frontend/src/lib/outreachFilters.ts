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
