/**
 * Instantly v2 API client for the Wellore email push (Sequence Studio -> Instantly).
 * Docs: https://developer.instantly.ai/. Auth: Authorization: Bearer <INSTANTLY_API_KEY>
 * against https://api.instantly.ai/api/v2. The key is base64(workspace_uuid:secret).
 */
const BASE = "https://api.instantly.ai/api/v2";

function apiKey(): string {
  const key = String(process.env.INSTANTLY_API_KEY ?? "").trim();
  if (!key) throw new Error("INSTANTLY_API_KEY is not configured");
  return key;
}

export interface InstantlySentEmail {
  id: string;
  message_id?: string;
  subject?: string;
  timestamp_email?: string;
  timestamp_created?: string;
  to_address_email_list?: string;
  body?: { html?: string; text?: string };
  campaign_id?: string;
  lead?: string;
  lead_id?: string;
  eaccount?: string;
  /** "0_1_0" = sequence 0, step index 1 (i.e. the second touch), variant 0. */
  step?: string;
  [key: string]: unknown;
}

/**
 * Every outbound message Instantly has actually sent, newest first, across all
 * campaigns unless one is named. Read only — this is the source of truth for what
 * really went out, as opposed to what was drafted or pushed.
 */
export async function listSentEmails(opts: { campaignId?: string; max?: number } = {}): Promise<InstantlySentEmail[]> {
  const max = opts.max ?? Number.POSITIVE_INFINITY;
  const out: InstantlySentEmail[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  do {
    const params = new URLSearchParams({ email_type: "sent", limit: "100" });
    if (opts.campaignId) params.set("campaign_id", opts.campaignId);
    if (cursor) params.set("starting_after", cursor);
    const page = await request<{ items?: InstantlySentEmail[]; next_starting_after?: string }>("GET", `/emails?${params}`);
    const items = page.items ?? [];
    out.push(...items);
    const nextCursor = items.length ? page.next_starting_after : undefined;
    cursor = nextCursor && !seenCursors.has(nextCursor) ? nextCursor : undefined;
    if (cursor) seenCursors.add(cursor);
  } while (cursor && out.length < max);
  return out.slice(0, max);
}

/** Instantly's step code is "sequence_stepIndex_variant"; our step numbers are 1 based. */
export function instantlyStepNumber(step: string | undefined): number {
  const parts = String(step ?? "").split("_");
  const index = Number(parts[1]);
  return Number.isFinite(index) ? index + 1 : 1;
}

async function request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Instantly returned non-JSON (${r.status}): ${text.slice(0, 200)}`);
  }
  if (!r.ok) {
    const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const message = typeof obj.message === "string" ? obj.message : text.slice(0, 300);
    throw new Error(`Instantly ${method} ${path} failed (${r.status}): ${message || "unknown error"}`);
  }
  return parsed as T;
}

export interface InstantlyLead {
  id: string;
  email: string;
  campaign?: string;
  [key: string]: unknown;
}

/** Find an existing lead by email within a campaign, if any. */
export async function findLeadByEmail(campaignId: string, email: string): Promise<InstantlyLead | null> {
  const res = await request<{ items?: InstantlyLead[] }>("POST", "/leads/list", {
    campaign: campaignId,
    contacts: [email],
    limit: 1,
  });
  return res.items?.[0] ?? null;
}

/** Create a new lead in a campaign. */
export async function createLead(
  campaignId: string,
  lead: { email: string; first_name?: string; last_name?: string; company_name?: string; website?: string }
): Promise<InstantlyLead> {
  return request<InstantlyLead>("POST", "/leads", { campaign: campaignId, ...lead });
}

/** Merge custom variables into an existing lead (does not touch fields not passed). */
export async function updateLeadCustomVariables(leadId: string, variables: Record<string, string>): Promise<InstantlyLead> {
  return request<InstantlyLead>("PATCH", `/leads/${encodeURIComponent(leadId)}`, { custom_variables: variables });
}

/**
 * Find-or-create the lead in the campaign, then merge in the given custom variables.
 * This is the single entry point the push handler uses.
 */
export async function upsertLeadWithVariables(
  campaignId: string,
  lead: { email: string; first_name?: string; last_name?: string; company_name?: string; website?: string },
  variables: Record<string, string>
): Promise<InstantlyLead> {
  const existing = await findLeadByEmail(campaignId, lead.email);
  const target = existing ?? (await createLead(campaignId, lead));
  return updateLeadCustomVariables(target.id, variables);
}
