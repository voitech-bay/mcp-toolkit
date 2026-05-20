import type { ConversationListItem } from "./supabase.js";

/** Lowercase alphanumeric tokens from user search (whitespace-separated, punctuation stripped). */
export function parseSearchTokens(search: string): string[] {
  const raw = search.trim().toLowerCase();
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter((t) => t.length > 0);
}

function buildConversationHaystack(c: ConversationListItem): string {
  return [
    c.receiverDisplayName,
    c.senderDisplayName,
    c.receiverCompanyName ?? "",
    c.receiverTitle ?? "",
    c.lastMessageText ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/** Every token must appear somewhere in the combined receiver/sender/company/title/message haystack. */
export function conversationMatchesSearchTokens(
  c: ConversationListItem,
  tokens: string[]
): boolean {
  if (tokens.length === 0) return true;
  const haystack = buildConversationHaystack(c);
  return tokens.every((token) => haystack.includes(token));
}

export function conversationMatchesSearch(c: ConversationListItem, search: string): boolean {
  return conversationMatchesSearchTokens(c, parseSearchTokens(search));
}

function buildContactHaystack(c: ConversationListItem): string {
  return [
    c.receiverDisplayName,
    c.receiverCompanyName ?? "",
    c.receiverTitle ?? "",
    c.lastMessageText ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

export function conversationMatchesContactName(
  c: ConversationListItem,
  contactName: string
): boolean {
  const tokens = parseSearchTokens(contactName);
  if (tokens.length === 0) return true;
  const haystack = buildContactHaystack(c);
  return tokens.every((token) => haystack.includes(token));
}

export function conversationMatchesSenderName(
  c: ConversationListItem,
  senderName: string
): boolean {
  const tokens = parseSearchTokens(senderName);
  if (tokens.length === 0) return true;
  const haystack = c.senderDisplayName.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}
