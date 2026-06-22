/**
 * Feasible in-app message agent: generate + send, triggered from the contact card
 * and the MSSP Leaders table.
 *
 * - POST /api/feasible/generate: builds Feasible-grounded context (product + angle +
 *   revenue + contact research + conversation + colleague key points) and returns N
 *   variants. Sender persona auto-matched per lead so the signature is truthful.
 *   Tier 'cheap' = gemma, 'premium' = Opus 4.6. Read-only.
 * - POST /api/feasible/send: sends a chosen/edited variant to the prospect in GetSales
 *   (Feasible project) via the linkedin-messages API. Gated: explicit text + lead +
 *   Feasible sender; never auto-invoked. Surfaces GetSales errors verbatim.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getSupabase,
  getGetSalesCredentials,
  listCompanyContextsByCompanyId,
  createGeneratedMessage,
  LINKEDIN_MESSAGES_TABLE,
  PROJECT_COMPANIES_TABLE,
  CONTACTS_TABLE,
  SENDERS_TABLE,
} from "./services/supabase.js";
import { buildCompanyCard, buildContactCard, parseAccountSummaryEntry } from "./services/account-context.js";
import { generateOpenRouterMessage } from "./services/openrouter.js";
import { generateOpenModelMessage } from "./services/openmodel.js";
import { sendEmail, sendLinkedInMessage } from "./services/source-api.js";
import {
  FEASIBLE_PROJECT_ID,
  FEASIBLE_SENDERS,
  senderForUuid,
  feasibleRevenueLine,
  buildFeasibleSystemPrompt,
  feasibleViolations,
  type FeasibleChannel,
  type FeasibleAngle,
  type FeasibleSender,
} from "./services/feasible-context.js";

const MODEL_CHEAP = () => process.env.FEASIBLE_OPENMODEL_MODEL?.trim() || "deepseek-v4-flash";
const MODEL_PREMIUM = () => process.env.FEASIBLE_MODEL_PREMIUM?.trim() || "anthropic/claude-opus-4.6";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_CHANNELS = new Set(["linkedin", "inmail", "email"]);
const VALID_ANGLES = new Set(["productize", "scale", "win_rate", "margin", "practitioner"]);

type Json = Record<string, unknown>;

type ContextMessage = {
  lead_uuid?: string | null;
  text?: string | null;
  subject?: string | null;
  type?: string | null;
  sender_display_name?: string | null;
  channel_label?: string;
};

type ContextThread = {
  lead_uuid?: string | null;
  conversation_uuid?: string;
  messages?: ContextMessage[];
};

const COMPANY_CONVERSATION_CONTEXT_MAX_CHARS = 60_000;

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.writeHead(status);
  res.end(JSON.stringify(obj));
}

async function readJsonBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
  } catch {
    return {};
  }
}

function str(o: Json, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

/** Format raw threads across every known contact at the company, recipient first. */
export function formatCompanyConversationContext(
  threads: ContextThread[],
  contacts: Json[],
  recipientUuid: string,
  recipientName: string,
  maxChars = COMPANY_CONVERSATION_CONTEXT_MAX_CHARS
): { text: string; threadCount: number; contactCount: number; truncated: boolean } {
  const names = new Map<string, string>();
  for (const contact of contacts) {
    const uuid = str(contact, "uuid");
    if (!uuid) continue;
    names.set(uuid, str(contact, "name", "first_name") || uuid.slice(0, 8));
  }
  names.set(recipientUuid, recipientName);

  const ordered = [...threads].sort((a, b) => {
    const aRecipient = a.lead_uuid === recipientUuid ? 0 : 1;
    const bRecipient = b.lead_uuid === recipientUuid ? 0 : 1;
    return aRecipient - bRecipient;
  });
  const sections: string[] = [];
  const includedContacts = new Set<string>();
  let chars = 0;
  let includedThreads = 0;
  let truncated = false;

  for (const thread of ordered) {
    const leadUuid = thread.lead_uuid ?? thread.messages?.find((m) => m.lead_uuid)?.lead_uuid ?? "";
    const contactName = names.get(leadUuid) || leadUuid.slice(0, 8) || "contact";
    const lines = (thread.messages ?? [])
      .map((message) => {
        const content = [message.subject ? `subject: ${message.subject}` : "", message.text ?? ""]
          .filter(Boolean)
          .join(" | ")
          .trim();
        if (!content) return "";
        const speaker = (message.type ?? "").toLowerCase() === "inbox"
          ? contactName
          : message.sender_display_name?.trim() || "Unknown sender";
        return `${speaker}${message.channel_label ? ` [${message.channel_label}]` : ""}: ${content.slice(0, 1_000)}`;
      })
      .filter(Boolean);
    if (!lines.length) continue;
    const section = `Conversation with ${contactName}${leadUuid === recipientUuid ? " (recipient)" : ""}:\n${lines.join("\n")}`;
    if (chars + section.length > maxChars) {
      truncated = true;
      break;
    }
    sections.push(section);
    chars += section.length;
    includedThreads += 1;
    if (leadUuid) includedContacts.add(leadUuid);
  }

  return {
    text: sections.join("\n\n") || "(no prior messages at this company; this is a cold or first touch)",
    threadCount: includedThreads,
    contactCount: includedContacts.size,
    truncated,
  };
}

/** First integer in an employees_range string ("51-200" -> 51) or a research number. */
function parseEmployeeCount(card: Json): number | null {
  const company = (card.company as Json) ?? {};
  const range = str(company, "employees_range");
  const m = range.match(/\d+/);
  if (m) return parseInt(m[0], 10);
  const results = (card.latest_results as Json[]) ?? [];
  for (const r of results) {
    const res = (r.result as Json) ?? {};
    const ec = str(res, "company_employees", "employees_on_linkedin");
    const mm = ec.match(/\d+/);
    if (mm) return parseInt(mm[0], 10);
  }
  return null;
}

/** Resolve the sender persona for a lead: explicit > latest outbox sender > Feasible default. */
async function resolveSender(
  client: ReturnType<typeof getSupabase>,
  leadUuid: string,
  explicitUuid: string
): Promise<{ sender: FeasibleSender; source: "explicit" | "thread" | "default" }> {
  if (explicitUuid) {
    const s = senderForUuid(explicitUuid);
    if (s) return { sender: s, source: "explicit" };
  }
  if (client) {
    const { data } = await client
      .from(LINKEDIN_MESSAGES_TABLE)
      .select("sender_profile_uuid")
      .eq("lead_uuid", leadUuid)
      .eq("project_id", FEASIBLE_PROJECT_ID)
      .eq("type", "outbox")
      .not("sender_profile_uuid", "is", null)
      .order("sent_at", { ascending: false })
      .limit(1);
    const uuid = Array.isArray(data) && data[0] ? String((data[0] as Json).sender_profile_uuid ?? "") : "";
    const s = senderForUuid(uuid);
    if (s) return { sender: s, source: "thread" };
  }
  return { sender: FEASIBLE_SENDERS[0], source: "default" };
}

// --- POST /api/feasible/generate ----------------------------------------------
export async function handlePostFeasibleGenerate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const body = await readJsonBody(req);
  const leadUuid = str(body, "leadUuid", "lead_uuid");
  if (!UUID_RE.test(leadUuid)) return sendJson(res, 400, { error: "leadUuid must be a UUID" });
  const tier = str(body, "tier") === "premium" ? "premium" : "cheap";
  const channel = (VALID_CHANNELS.has(str(body, "channel")) ? str(body, "channel") : "linkedin") as FeasibleChannel;
  const angleRaw = str(body, "angle");
  const angle = (VALID_ANGLES.has(angleRaw) ? angleRaw : null) as FeasibleAngle | null;
  const variants = Math.min(Math.max(Number(body.variants) || 2, 1), 3);
  const instructions = str(body, "instructions");
  const model = tier === "premium" ? MODEL_PREMIUM() : MODEL_CHEAP();

  const { data: card, error: cardErr } = await buildContactCard(client, leadUuid);
  if (cardErr || !card) return sendJson(res, cardErr === "Contact not found" ? 404 : 500, { error: cardErr ?? "load failed" });
  const contact = (card.contact as Json) ?? {};
  if (str(contact, "project_id") !== FEASIBLE_PROJECT_ID) {
    return sendJson(res, 403, { error: "This message agent is restricted to Feasible contacts" });
  }

  const { sender, source: senderSource } = await resolveSender(client, leadUuid, str(body, "senderProfileUuid", "sender_profile_uuid"));
  const employees = parseEmployeeCount(card);
  const revenueLine = angle === "productize" || angle === "scale" ? feasibleRevenueLine(employees) : null;

  // Colleague key points from cached account summary.
  let accountKeyPoints = "";
  const company = (card.company as Json) ?? null;
  let companyCard: Json | null = null;
  if (company && typeof company.id === "string") {
    const [{ data: ctx }, companyCardResult] = await Promise.all([
      listCompanyContextsByCompanyId(client, company.id),
      buildCompanyCard(client, company.id),
    ]);
    companyCard = companyCardResult.data;
    for (const row of ctx) {
      const parsed = parseAccountSummaryEntry(row);
      if (parsed) {
        const per = (parsed.data.per_contact as Array<{ name?: string; key_points?: string[] }>) ?? [];
        accountKeyPoints = per
          .filter((p) => (p.key_points ?? []).length)
          .map((p) => `- ${p.name}: ${(p.key_points ?? []).join("; ")}`)
          .join("\n");
        break;
      }
    }
  }

  const name = str(contact, "name", "first_name") || "the contact";
  const results = (card.latest_results as Json[]) ?? [];
  const research = results
    .map((r) => {
      const rs = (r.result as Json) ?? {};
      return str(rs, "pov", "their_icp_summary", "mssp_research_summary", "company_description");
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 1200);
  const conversationContext = formatCompanyConversationContext(
    ((companyCard?.conversations ?? card.conversations ?? []) as ContextThread[]),
    ((companyCard?.contacts ?? [contact]) as Json[]),
    leadUuid,
    name
  );

  const systemPrompt = buildFeasibleSystemPrompt({ channel, sender, angle, revenueLine });
  const userPrompt = [
    instructions
      ? `REVIEWER REQUEST (this defines the conversation scenario and desired outcome; apply it on top of the underlying factual and messaging rules):\n${instructions}`
      : `REVIEWER REQUEST:\nWrite the most natural next message for the actual conversation stage. Do not default to a product pitch.`,
    `Recipient: ${name}${contact.position ? `, ${String(contact.position)}` : ""}${company ? ` at ${String(company.name ?? "")}` : ""}${employees ? ` (~${employees} employees)` : ""}`,
    research ? `\nInternal research (context only — do NOT paste back to them):\n${research}` : "",
    accountKeyPoints ? `\nColleagues at this account have said:\n${accountKeyPoints}` : "",
    `\nAll known company conversations across contacts (private context only; never attribute a colleague's words to the recipient):\n${conversationContext.text}`,
    channel === "inmail" || channel === "email"
      ? `\nWrite the message. First line "Subject: <3-4 word subject>", then a blank line, then the body.`
      : `\nWrite the next message.`,
  ]
    .filter((s) => s !== "")
    .join("\n");

  const out: Array<Json> = [];
  for (let i = 0; i < variants; i++) {
    const generationParams = {
      model,
      systemPrompt,
      userPrompt,
      temperature: i === 0 ? 0.5 : 0.8,
    };
    const { data: gen, error: genErr } = tier === "cheap"
      ? await generateOpenModelMessage(generationParams)
      : await generateOpenRouterMessage(generationParams);
    if (genErr || !gen) {
      out.push({ error: genErr ?? "generation failed", model, provider: tier === "cheap" ? "openmodel" : "openrouter" });
      continue;
    }
    let subject = "";
    let text = gen.text.trim();
    if (channel === "inmail" || channel === "email") {
      const m = text.match(/^subject:\s*(.+)$/im);
      if (m) {
        subject = m[1].trim();
        text = text.replace(/^subject:\s*.+$/im, "").trim();
      }
    }
    text = text.replace(/^["']|["']$/g, "");
    out.push({ subject, text, model: gen.model, provider: tier === "cheap" ? "openmodel" : "openrouter", tier, violations: feasibleViolations(text) });
  }

  sendJson(res, 200, {
    variants: out,
    channel,
    angle,
    employees,
    revenue_line: revenueLine,
    sender_profile_uuid: sender.sender_profile_uuid,
    sender_persona: sender.persona,
    sender_source: senderSource,
    senders: FEASIBLE_SENDERS,
    model,
    provider: tier === "cheap" ? "openmodel" : "openrouter",
    tier,
    context_stats: {
      company_conversation_threads: conversationContext.threadCount,
      company_conversation_contacts: conversationContext.contactCount,
      company_conversation_chars: conversationContext.text.length,
      company_conversation_truncated: conversationContext.truncated,
      approximate_input_tokens: Math.ceil((systemPrompt.length + userPrompt.length) / 4),
    },
  });
}

// --- POST /api/feasible/send --------------------------------------------------
export async function handlePostFeasibleSend(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const body = await readJsonBody(req);
  const leadUuid = str(body, "leadUuid", "lead_uuid");
  const senderProfileUuid = str(body, "senderProfileUuid", "sender_profile_uuid");
  const channelRaw = str(body, "channel");
  if (!VALID_CHANNELS.has(channelRaw)) return sendJson(res, 400, { error: "channel must be linkedin, inmail, or email" });
  const channel = channelRaw as FeasibleChannel;
  const text = str(body, "text");
  const subject = str(body, "subject");
  if (!UUID_RE.test(leadUuid)) return sendJson(res, 400, { error: "leadUuid must be a UUID" });
  if (!senderForUuid(senderProfileUuid)) return sendJson(res, 400, { error: "senderProfileUuid must be a Feasible sender profile" });
  if (!text.trim()) return sendJson(res, 400, { error: "text is required" });
  if ((channel === "inmail" || channel === "email") && !subject) {
    return sendJson(res, 400, { error: `subject is required for ${channel === "email" ? "email" : "InMail"}` });
  }

  const { data: contact, error: contactErr } = await client
    .from(CONTACTS_TABLE)
    .select("project_id, company_id, company_uuid, name, first_name, last_name, work_email, gs_connection_accepted_at")
    .eq("uuid", leadUuid)
    .maybeSingle();
  if (contactErr) return sendJson(res, 500, { error: contactErr.message });
  if (!contact) return sendJson(res, 404, { error: "Contact not found" });
  if (str(contact as Json, "project_id") !== FEASIBLE_PROJECT_ID) {
    return sendJson(res, 403, { error: "This message agent is restricted to Feasible contacts" });
  }

  if (channel === "linkedin" && !str(contact as Json, "gs_connection_accepted_at")) {
    const { data: connected } = await client
      .from(LINKEDIN_MESSAGES_TABLE)
      .select("uuid")
      .eq("project_id", FEASIBLE_PROJECT_ID)
      .eq("lead_uuid", leadUuid)
      .eq("linkedin_type", "message")
      .limit(1);
    if (!Array.isArray(connected) || connected.length === 0) {
      return sendJson(res, 409, { error: "LinkedIn message requires an accepted connection. Use InMail instead." });
    }
  }
  const toEmail = str(contact as Json, "work_email");
  if (channel === "email" && !toEmail) {
    return sendJson(res, 409, { error: "This contact has no work email" });
  }

  const { credentials, error: credErr } = await getGetSalesCredentials(client, FEASIBLE_PROJECT_ID);
  if (credErr) return sendJson(res, 400, { error: `GetSales credentials: ${credErr}` });
  if (!credentials) return sendJson(res, 400, { error: "Feasible GetSales credentials not configured" });

  let sent: Json;
  try {
    if (channel === "email") {
      const { data: senderRow, error: senderErr } = await client
        .from(SENDERS_TABLE)
        .select("first_name, last_name, email")
        .eq("uuid", senderProfileUuid)
        .maybeSingle();
      if (senderErr) return sendJson(res, 500, { error: senderErr.message });
      const fromEmail = senderRow ? str(senderRow as Json, "email") : "";
      if (!fromEmail) return sendJson(res, 409, { error: "Selected sender has no connected email mailbox" });
      const sender = senderForUuid(senderProfileUuid)!;
      sent = await sendEmail(credentials, {
        senderProfileUuid,
        leadUuid,
        fromName: sender.persona,
        fromEmail,
        toName: str(contact as Json, "name") || [str(contact as Json, "first_name"), str(contact as Json, "last_name")].filter(Boolean).join(" "),
        toEmail,
        subject,
        body: text,
      });
    } else {
      sent = await sendLinkedInMessage(credentials, {
        senderProfileUuid,
        leadUuid,
        text,
        channel,
        subject: subject || undefined,
      });
    }
  } catch (e) {
    return sendJson(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }

  // Best-effort record under generated_messages if a project_company_id resolves.
  try {
    const companyKey = contact ? str(contact as Json, "company_id") || str(contact as Json, "company_uuid") : "";
    if (companyKey) {
      const { data: pc } = await client
        .from(PROJECT_COMPANIES_TABLE)
        .select("id")
        .eq("project_id", FEASIBLE_PROJECT_ID)
        .eq("company_id", companyKey)
        .maybeSingle();
      const projectCompanyId = pc ? str(pc as Json, "id") : "";
      if (projectCompanyId) {
        await createGeneratedMessage(client, {
          contactId: leadUuid,
          projectCompanyId,
          content: text,
          generationContext: { kind: "feasible_message_sent", channel, subject, sender_profile_uuid: senderProfileUuid, getsales_message_uuid: str(sent, "uuid") },
        });
      }
    }
  } catch {
    /* persistence best-effort */
  }

  sendJson(res, 200, { ok: true, message: sent });
}
