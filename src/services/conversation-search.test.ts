import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationListItem } from "./supabase.js";
import {
  conversationMatchesContactName,
  conversationMatchesSearch,
  conversationMatchesSenderName,
  parseSearchTokens,
} from "./conversation-search.js";

function item(partial: Partial<ConversationListItem>): ConversationListItem {
  return {
    conversationUuid: "c1",
    leadUuid: null,
    senderProfileUuid: null,
    senderDisplayName: "Alice Sender",
    receiverDisplayName: "Bilal Saheb",
    receiverTitle: "Director",
    receiverCompanyName: "Publicis Groupe",
    receiverAvatarUrl: null,
    receiverCompanyId: null,
    lastMessageText: "Hello there",
    lastMessageAt: null,
    messageCount: 1,
    inboxCount: 0,
    outboxCount: 1,
    lastMessageIsOutbox: true,
    hypothesisCount: 0,
    replyTag: "no_response",
    receiverPipelineStageUuid: null,
    ...partial,
  };
}

test("parseSearchTokens splits and strips punctuation", () => {
  assert.deepEqual(parseSearchTokens("  Bilal, Sahe! "), ["bilal", "sahe"]);
});

test("conversationMatchesSearch: all tokens across fields", () => {
  const c = item({});
  assert.equal(conversationMatchesSearch(c, "Bilal Sahe"), true);
  assert.equal(conversationMatchesSearch(c, "publicis bilal"), true);
  assert.equal(conversationMatchesSearch(c, "hello bilal"), true);
});

test("conversationMatchesSearch: Saheed does not match Saheb", () => {
  assert.equal(conversationMatchesSearch(item({}), "Bilal Saheed"), false);
});

test("conversationMatchesContactName uses receiver fields only", () => {
  const c = item({ senderDisplayName: "Not Bilal" });
  assert.equal(conversationMatchesContactName(c, "Bilal Sahe"), true);
  assert.equal(conversationMatchesContactName(c, "Alice"), false);
});

test("conversationMatchesSenderName matches sender tokens", () => {
  assert.equal(conversationMatchesSenderName(item({}), "alice sender"), true);
  assert.equal(conversationMatchesSenderName(item({}), "bob"), false);
});
