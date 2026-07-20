export type SmartleadHistoryMessage = {
  type?: string;
  message_id?: string;
  stats_id?: string;
  subject?: string;
  email_body?: string;
  time?: string;
  email_seq_number?: string | number;
  from?: string;
  to?: string;
  open_count?: number;
  click_count?: number;
};

function apiKey(): string {
  const key = String(process.env.SMARTLEAD_API_KEY ?? "").trim();
  if (!key) throw new Error("SMARTLEAD_API_KEY is not configured");
  return key;
}

/** Fetch message history for a campaign lead from Smartlead. */
export async function getLeadMessageHistory(
  campaignId: string | number,
  leadId: string | number
): Promise<SmartleadHistoryMessage[]> {
  const url = new URL(
    `https://server.smartlead.ai/api/v1/campaigns/${encodeURIComponent(String(campaignId))}/leads/${encodeURIComponent(String(leadId))}/message-history`
  );
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("show_plain_text_response", "true");
  const r = await fetch(url);
  const text = await r.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Smartlead history returned non-JSON (${r.status})`);
  }
  if (!r.ok) {
    const err =
      parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as { message?: unknown }).message)
        : text.slice(0, 200);
    throw new Error(`Smartlead history failed (${r.status}): ${err || "unknown error"}`);
  }
  if (Array.isArray(parsed)) return parsed as SmartleadHistoryMessage[];
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.history)) return obj.history as SmartleadHistoryMessage[];
    if (Array.isArray(obj.messages)) return obj.messages as SmartleadHistoryMessage[];
    if (Array.isArray(obj.data)) return obj.data as SmartleadHistoryMessage[];
  }
  return [];
}

export function isSmartleadSentMessage(msg: SmartleadHistoryMessage): boolean {
  const type = String(msg.type ?? "").toUpperCase();
  return type === "SENT" || type === "EMAIL_SENT" || type === "FIRST_EMAIL_SENT";
}

export function smartleadMessageStep(msg: SmartleadHistoryMessage): number {
  const n = Number(msg.email_seq_number ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
