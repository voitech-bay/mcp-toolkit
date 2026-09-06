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

// ---------------------------------------------------------------------------
// Campaign-level reads. These back the repeatable "pull everything Smartlead sent
// for a campaign" sweep; the per-lead history call above stays for the Studio button.
// ---------------------------------------------------------------------------

/** One row of GET /campaigns/{id}/statistics: a single email Smartlead dispatched. */
export type SmartleadCampaignStat = {
  lead_name?: string | null;
  lead_email?: string | null;
  lead_category?: string | null;
  sequence_number?: number | string | null;
  stats_id?: string | null;
  email_campaign_seq_id?: number | string | null;
  seq_variant_id?: number | string | null;
  email_subject?: string | null;
  email_message?: string | null;
  sent_time?: string | null;
  open_time?: string | null;
  click_time?: string | null;
  reply_time?: string | null;
  is_unsubscribed?: boolean | null;
  is_bounced?: boolean | null;
};

/** The `lead` object inside GET /campaigns/{id}/leads rows. */
export type SmartleadCampaignLead = {
  id?: number | string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  company_name?: string | null;
  linkedin_profile?: string | null;
  website?: string | null;
};

async function smartleadGet(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = new URL(`https://server.smartlead.ai/api/v1/${path}`);
  url.searchParams.set("api_key", apiKey());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url);
  const text = await r.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Smartlead ${path} returned non-JSON (${r.status})`);
  }
  if (!r.ok) {
    const err =
      parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as { message?: unknown }).message)
        : text.slice(0, 200);
    throw new Error(`Smartlead ${path} failed (${r.status}): ${err || "unknown error"}`);
  }
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

async function pageAll<T>(
  path: string,
  totalKey: string,
  pageSize: number,
  pick: (row: unknown) => T | null
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  // Hard stop so a misreported total can never spin forever.
  for (let page = 0; page < 200; page++) {
    const body = await smartleadGet(path, { offset: String(offset), limit: String(pageSize) });
    const rows = Array.isArray(body.data) ? body.data : [];
    for (const row of rows) {
      const v = pick(row);
      if (v) out.push(v);
    }
    const total = Number(body[totalKey] ?? 0);
    offset += rows.length;
    if (rows.length === 0 || rows.length < pageSize || (Number.isFinite(total) && total > 0 && offset >= total)) break;
  }
  return out;
}

/** Every dispatched email for a campaign, oldest first. Unsent leads do not appear here. */
export async function listCampaignStatistics(campaignId: string | number, pageSize = 100): Promise<SmartleadCampaignStat[]> {
  const rows = await pageAll<SmartleadCampaignStat>(
    `campaigns/${encodeURIComponent(String(campaignId))}/statistics`,
    "total_stats",
    pageSize,
    (row) => (row && typeof row === "object" ? (row as SmartleadCampaignStat) : null)
  );
  return rows.sort((a, b) => String(a.sent_time ?? "").localeCompare(String(b.sent_time ?? "")));
}

/** Every lead enrolled in a campaign, keyed by lowercase email. Gives the Smartlead lead id the statistics rows lack. */
export async function listCampaignLeads(campaignId: string | number, pageSize = 100): Promise<Map<string, SmartleadCampaignLead>> {
  const leads = await pageAll<SmartleadCampaignLead>(
    `campaigns/${encodeURIComponent(String(campaignId))}/leads`,
    "total_leads",
    pageSize,
    (row) => {
      const lead = row && typeof row === "object" ? (row as { lead?: unknown }).lead : null;
      return lead && typeof lead === "object" ? (lead as SmartleadCampaignLead) : null;
    }
  );
  const map = new Map<string, SmartleadCampaignLead>();
  for (const lead of leads) {
    const email = String(lead.email ?? "").trim().toLowerCase();
    if (email && !map.has(email)) map.set(email, lead);
  }
  return map;
}
