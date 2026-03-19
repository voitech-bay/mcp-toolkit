/**
 * Fetch LinkedIn thread summaries per contact and merge into build-context payloads
 * so /api/build-context always receives conversation nodes for included contacts.
 */

export interface ConversationGroup {
  linkedin_conversation_uuid: string;
  messageCount: number;
  latestMessageText: string | null;
  latestMessageDate: string | null;
}

export interface ConversationNodePayload {
  nodeId: string;
  entityId: string;
  parentContactNodeId: string;
  messageCount: number;
  latestMessageText: string | null;
  latestMessageDate: string | null;
}

function messageTime(m: Record<string, unknown>): number {
  const s = (m.sent_at ?? m.created_at) as string | undefined;
  return s ? new Date(s).getTime() : 0;
}

/** Group API rows by thread; latest = chronologically last message. */
export function conversationGroupsFromMessages(
  messages: Array<Record<string, unknown>>
): ConversationGroup[] {
  const byConv = new Map<string, Array<Record<string, unknown>>>();
  for (const m of messages) {
    const raw = m.linkedin_conversation_uuid;
    const cid = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    if (!cid) continue;
    if (!byConv.has(cid)) byConv.set(cid, []);
    byConv.get(cid)!.push(m);
  }
  return Array.from(byConv.entries()).map(([convId, msgs]) => {
    const chron = [...msgs].sort((a, b) => messageTime(a) - messageTime(b));
    const latest = chron[chron.length - 1];
    const latestRaw = (latest?.sent_at ?? latest?.created_at) as string | undefined;
    return {
      linkedin_conversation_uuid: convId,
      messageCount: msgs.length,
      latestMessageText: (latest?.text as string | null | undefined) ?? null,
      latestMessageDate: latestRaw ?? null,
    };
  });
}

export async function fetchConversationGroupsForLead(leadUuid: string): Promise<ConversationGroup[]> {
  const r = await fetch(`/api/conversation?leadUuid=${encodeURIComponent(leadUuid)}&limit=500`);
  if (!r.ok) return [];
  const j = (await r.json()) as { messages?: Array<Record<string, unknown>> };
  return conversationGroupsFromMessages(j.messages ?? []);
}

/**
 * Keeps `existing` entries, then adds every thread returned for each contact UUID
 * (deduped by parent contact node + conversation uuid).
 */
export async function mergeConversationsForBuildContext(
  contacts: Array<{ nodeId: string; entityId: string | null }>,
  existing: ConversationNodePayload[]
): Promise<ConversationNodePayload[]> {
  let auto = 0;
  const nextNodeId = (): string => `conv-auto-${++auto}`;

  const seen = new Set(existing.map((c) => `${c.parentContactNodeId}\0${c.entityId}`));
  const out = [...existing];

  const rows = await Promise.all(
    contacts.map(async (ct) => {
      const uuid = ct.entityId?.trim();
      if (!uuid) return { ct, groups: [] as ConversationGroup[] };
      const groups = await fetchConversationGroupsForLead(uuid);
      return { ct, groups };
    })
  );

  for (const { ct, groups } of rows) {
    for (const g of groups) {
      const key = `${ct.nodeId}\0${g.linkedin_conversation_uuid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        nodeId: nextNodeId(),
        entityId: g.linkedin_conversation_uuid,
        parentContactNodeId: ct.nodeId,
        messageCount: g.messageCount,
        latestMessageText: g.latestMessageText,
        latestMessageDate: g.latestMessageDate,
      });
    }
  }

  return out;
}
