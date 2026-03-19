/**
 * Reply-agent prompt construction (shared by HTTP /api/build-context and MCP).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getCompaniesByIds,
  getContactsProfileForPromptByUuids,
  getConversation,
  listCompanyContextsByCompanyId,
  listContactContextsByContactId,
  getHypothesesWithCounts,
} from "./supabase.js";

/** Shapes of selected node data from the frontend (mirrors ReplyContextModal / context builder). */
export interface ContextHypothesis {
  nodeId: string;
  entityId: string;
  name: string;
  description: string | null;
}

export interface ContextCompany {
  nodeId: string;
  entityId: string | null;
  projectCompanyId: string;
  parentHypothesisNodeId: string | null;
  name: string | null;
  domain: string | null;
}

export interface ContextContact {
  nodeId: string;
  entityId: string | null;
  parentCompanyNodeId: string | null;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
}

export interface ContextConversation {
  nodeId: string;
  entityId: string;
  parentContactNodeId: string;
  messageCount: number;
  latestMessageText: string | null;
  latestMessageDate: string | null;
}

export interface BuildContextNodes {
  hypotheses: ContextHypothesis[];
  companies: ContextCompany[];
  contacts: ContextContact[];
  conversations: ContextConversation[];
}

function companyLabel(c: { name: string | null; domain: string | null }): string {
  return (c.name ?? c.domain ?? "Unknown Company").trim();
}

function contactLabel(ct: { firstName: string | null; lastName: string | null }): string {
  const n = [ct.firstName, ct.lastName].filter(Boolean).join(" ").trim();
  return n || "Unknown Contact";
}

function contactRole(ct: { position: string | null }): string | null {
  if (!ct.position) return null;
  const v = ct.position.trim();
  return v ? v : null;
}

const MAX_DB_FIELD_CHARS = 12_000;
const MAX_PROMPT_MESSAGE_CHARS = 4_000;

function linkedinMessageDirection(msg: Record<string, unknown>): "sent" | "received" {
  const t = String(msg["type"] ?? msg["linkedin_type"] ?? "").toLowerCase();
  if (t === "outbox") return "sent";
  return "received";
}

/** Chronological lines for the reply prompt: [Sent] / [Received] + timestamp + body. */
function formatConversationMessagesForPrompt(messages: unknown[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const row = m as Record<string, unknown>;
    const dir = linkedinMessageDirection(row);
    const label = dir === "sent" ? "Sent" : "Received";
    const rawAt = row.sent_at;
    const dateStr =
      rawAt != null && String(rawAt).trim()
        ? new Date(String(rawAt)).toLocaleString("en-US")
        : "unknown time";
    let text = String(row.text ?? "").trim();
    if (!text) text = "(no text)";
    if (text.length > MAX_PROMPT_MESSAGE_CHARS) {
      text = `${text.slice(0, MAX_PROMPT_MESSAGE_CHARS)}\n…[truncated]`;
    }
    lines.push(`- [${label}] ${dateStr}\n  ${text}`);
  }
  return lines.length > 0 ? lines.join("\n") : "- (No message rows)";
}

/** Turn DB JSON/text fields into readable prompt lines (truncate very large blobs). */
function formatContactDbField(label: string, value: unknown): string | null {
  if (value == null) return null;
  let text: string;
  if (typeof value === "string") {
    text = value.trim();
  } else if (typeof value === "object") {
    try {
      if (Array.isArray(value) && value.length === 0) return null;
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  } else {
    text = String(value).trim();
  }
  if (!text) return null;
  if (text.length > MAX_DB_FIELD_CHARS) {
    text = `${text.slice(0, MAX_DB_FIELD_CHARS)}\n…[truncated — ${label} was longer]`;
  }
  return `${label}:\n${text}`;
}

function buildContactProfileLines(profile: {
  headline: string | null;
  about: unknown;
  experience: unknown;
  posts: unknown;
}): string[] {
  const lines: string[] = [];
  const headline = profile.headline?.trim();
  if (headline) lines.push(`Headline: ${headline}`);
  const about = formatContactDbField("About", profile.about);
  if (about) lines.push(about);
  const experience = formatContactDbField("Experience (from profile / DB)", profile.experience);
  if (experience) lines.push(experience);
  const posts = formatContactDbField("Posts (from profile / DB)", profile.posts);
  if (posts) lines.push(posts);
  return lines;
}

/**
 * Generates a plain-text context string from the selected graph nodes (legacy snapshot format).
 */
export function generateContextText(nodes: BuildContextNodes): string {
  const sections: string[] = [];
  const now = new Date().toISOString().slice(0, 10);
  sections.push(`CONTEXT SNAPSHOT — ${now}`);
  sections.push("=".repeat(50));

  if (nodes.hypotheses.length > 0) {
    sections.push("## HYPOTHESES\n");
    for (const h of nodes.hypotheses) {
      sections.push(`### ${h.name}`);
      if (h.description?.trim()) {
        sections.push(h.description.trim());
      }
    }
  }

  if (nodes.companies.length > 0) {
    sections.push("## TARGET COMPANIES\n");
    for (const c of nodes.companies) {
      const label = c.name ?? c.domain ?? "Unknown Company";
      const domain = c.domain && c.domain !== c.name ? ` (${c.domain})` : "";
      sections.push(`- ${label}${domain}`);
    }
  }

  if (nodes.contacts.length > 0) {
    sections.push("## CONTACTS\n");
    const companyById = new Map(nodes.companies.map((c) => [c.nodeId, c]));
    for (const ct of nodes.contacts) {
      const name =
        [ct.firstName, ct.lastName].filter(Boolean).join(" ").trim() || "Unknown";
      const position = ct.position ? ` — ${ct.position}` : "";
      const company = ct.parentCompanyNodeId
        ? companyById.get(ct.parentCompanyNodeId)
        : null;
      const companyLabelStr = company
        ? ` @ ${company.name ?? company.domain ?? "Unknown Company"}`
        : "";
      sections.push(`- ${name}${position}${companyLabelStr}`);
    }
  }

  if (nodes.conversations.length > 0) {
    sections.push("## PREVIOUS CONVERSATIONS\n");
    const contactById = new Map(nodes.contacts.map((ct) => [ct.nodeId, ct]));
    for (const cv of nodes.conversations) {
      const contact = contactById.get(cv.parentContactNodeId);
      const contactName = contact
        ? [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
          "Unknown"
        : "Unknown Contact";
      const dateLabel = cv.latestMessageDate
        ? new Date(cv.latestMessageDate).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "unknown date";
      sections.push(
        `### Conversation with ${contactName}` +
          ` (${cv.messageCount} message${cv.messageCount !== 1 ? "s" : ""}` +
          `, last: ${dateLabel})\n`
      );
      if (cv.latestMessageText?.trim()) {
        sections.push(`Latest message:\n"${cv.latestMessageText.trim()}"`);
      }
    }
  }

  return sections.join("\n\n");
}

/**
 * Build prompt for the reply agent (full LinkedIn reply instructions + fetched DB context).
 */
export async function buildReplyContextPrompt(
  client: SupabaseClient,
  projectId: string,
  nodes: BuildContextNodes
): Promise<string> {
  const companyNodes = nodes.companies ?? [];
  const contactNodes = nodes.contacts ?? [];
  const hypothesisNodes = nodes.hypotheses ?? [];
  const conversationNodes = nodes.conversations ?? [];

  const mainCompany =
    companyNodes[0] ??
    (contactNodes[0]?.parentCompanyNodeId
      ? companyNodes.find((c) => c.nodeId === contactNodes[0].parentCompanyNodeId)
      : undefined) ??
    undefined;

  const mainCompanyId = mainCompany?.entityId?.trim() ?? "";

  const companyIds = [...new Set(companyNodes.map((c) => (c.entityId ?? "").trim()).filter(Boolean))];
  const contactIds = [
    ...new Set(contactNodes.map((c) => (c.entityId ?? "").trim()).filter(Boolean)),
  ];

  const companyInfoById: Record<string, { name: string | null; domain: string | null }> = {};
  if (companyIds.length > 0) {
    const infoRes = await getCompaniesByIds(client, companyIds);
    for (const row of infoRes.data ?? []) {
      if (!row?.id) continue;
      companyInfoById[row.id] = { name: row.name ?? null, domain: row.domain ?? null };
    }
  }

  const companyContextsById: Record<string, string[]> = {};
  await Promise.all(
    companyIds.map(async (id) => {
      const r = await listCompanyContextsByCompanyId(client, id);
      companyContextsById[id] = (r.data ?? [])
        .map((row) => (row.rootContext ?? "").trim())
        .filter(Boolean);
    })
  );

  const contactContextsById: Record<string, string[]> = {};
  await Promise.all(
    contactIds.map(async (id) => {
      const r = await listContactContextsByContactId(client, id);
      contactContextsById[id] = (r.data ?? [])
        .map((row) => (row.rootContext ?? "").trim())
        .filter(Boolean);
    })
  );

  const contactProfileById: Record<
    string,
    { headline: string | null; about: unknown; experience: unknown; posts: unknown }
  > = {};
  if (contactIds.length > 0) {
    const profRes = await getContactsProfileForPromptByUuids(client, contactIds);
    for (const row of profRes.data ?? []) {
      if (!row?.uuid) continue;
      contactProfileById[row.uuid] = {
        headline: row.headline ?? null,
        about: row.about,
        experience: row.experience,
        posts: row.posts,
      };
    }
  }

  const hypothesisIds = hypothesisNodes.map((h) => h.entityId).filter(Boolean);
  const hypothesisPersonaById: Record<
    string,
    { name: string; description: string | null; target_persona: string | null }
  > = {};
  if (hypothesisIds.length > 0) {
    const hypRows = await getHypothesesWithCounts(client, projectId);
    for (const row of hypRows.data ?? []) {
      if (!row?.id) continue;
      if (!hypothesisIds.includes(row.id)) continue;
      hypothesisPersonaById[row.id] = {
        name: row.name ?? "",
        description: row.description ?? null,
        target_persona: row.target_persona ?? null,
      };
    }
  }

  const contactBlocks: string[] = [];
  for (const ct of contactNodes) {
    const ctId = ct.entityId?.trim() ?? "";
    const ctx = ctId ? contactContextsById[ctId] ?? [] : [];

    const name = contactLabel(ct);
    const role = contactRole(ct);
    const roleLine = role ? `\nContact role: ${role}` : "";

    const profile = ctId ? contactProfileById[ctId] : undefined;
    const profileLines = profile ? buildContactProfileLines(profile) : [];
    let profileBlock: string;
    if (!ctId) {
      profileBlock =
        "\n\n(Cannot load LinkedIn profile fields from database: missing contact UUID.)";
    } else if (profileLines.length > 0) {
      profileBlock = `\n\n${profileLines.join("\n\n")}`;
    } else {
      profileBlock =
        "\n\n(No headline, about, experience, or posts stored in database for this contact.)";
    }

    const ctxLines = ctx.length > 0 ? ctx.map((x) => `- ${x}`).join("\n") : "- (No contact context found)";
    contactBlocks.push(
      [
        `We're reaching out contact: ${name}${roleLine}${profileBlock}`,
        `Contact context(s) (curated notes):\n${ctxLines}`,
      ].join("\n")
    );
  }

  const companyContextLines =
    mainCompanyId && companyContextsById[mainCompanyId]?.length
      ? companyContextsById[mainCompanyId].map((x) => `- ${x}`).join("\n")
      : "- (No company context found)";

  const companyName = mainCompanyId
    ? companyLabel({
        name: companyInfoById[mainCompanyId]?.name ?? mainCompany?.name ?? null,
        domain: companyInfoById[mainCompanyId]?.domain ?? mainCompany?.domain ?? null,
      })
    : "Unknown Company";

  const hypothesisBlock =
    hypothesisNodes.length > 0
      ? [
          "We're working on GTM hypothesis:",
          ...hypothesisNodes.map((h) => {
            const full = hypothesisPersonaById[h.entityId] ?? {
              name: h.name ?? "",
              description: h.description ?? null,
              target_persona: null,
            };
            const desc = full.description?.trim() ? full.description!.trim() : null;
            const tp = full.target_persona?.trim() ? full.target_persona!.trim() : null;
            return [
              full.name || h.name,
              `This contact and company are classified to this hypothesis.`,
              `Description: ${desc ?? "(none)"}`,
              `Target persona: ${tp ?? "(none)"}`,
            ].join("\n");
          }),
        ].join("\n")
      : "";

  const multipleContacts = contactNodes.length > 1;
  const outputInstruction = multipleContacts
    ? `For EACH contact above, return 3 answer variants.\nFormat:\n- Contact: <name>\n  - Variant 1: ...\n  - Variant 2: ...\n  - Variant 3: ...`
    : `As response please return 3 variants of how can we answer this contact.\nFormat:\n- Variant 1: ...\n- Variant 2: ...\n- Variant 3: ...`;

  const convUuids = [
    ...new Set(
      conversationNodes.map((c) => c.entityId?.trim()).filter((id): id is string => Boolean(id))
    ),
  ];

  const conversationThreadBlocks =
    convUuids.length === 0
      ? []
      : await Promise.all(
          convUuids.map(async (uuid) => {
            const nodeForConv = conversationNodes.find((n) => n.entityId?.trim() === uuid);
            const parentContact = nodeForConv
              ? contactNodes.find((ct) => ct.nodeId === nodeForConv.parentContactNodeId)
              : undefined;
            const threadLabel = parentContact ? contactLabel(parentContact) : "Unknown Contact";

            const { messages, error } = await getConversation(client, {
              conversationUuid: uuid,
              messageLimit: 500,
            });

            if (error) {
              return [`### Conversation thread (${threadLabel})`, `(Could not load messages: ${error})`].join(
                "\n"
              );
            }

            const body = formatConversationMessagesForPrompt(messages);
            return [`### Conversation thread (${threadLabel})`, body].join("\n\n");
          })
        );

  const conversationMessagesSection =
    convUuids.length === 0
      ? ""
      : [
          "Conversation messages (chronological; [Sent] = we sent, [Received] = we received):",
          "",
          conversationThreadBlocks.join("\n\n"),
        ].join("\n");

  console.log(conversationMessagesSection, convUuids);

  const prompt = [
    "You are a reply LinkedIn conversation message agent.",
    `We're reaching contact from company ${companyName}`,
    "",
    `Company contexts:\n${companyContextLines}`,
    "",
    hypothesisBlock ? hypothesisBlock : "",
    hypothesisBlock ? "" : "",
    ...contactBlocks,
    "",
    ...(conversationMessagesSection ? [conversationMessagesSection, ""] : []),
    "Rules:",
    "- Use ONLY the provided company/contact/hypothesis context, conversation messages below, and conversation signals.",
    "- Do not invent facts; if missing, ask one brief clarifying question.",
    "- Keep messages professional, concise, and human.",
    "",
    outputInstruction,
  ]
    .filter((x) => x !== "")
    .join("\n\n");

  return prompt;
}
