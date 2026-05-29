# Conversations list search

## API

`GET /api/conversations?projectId=...&search=...` filters and paginates **in SQL** via RPC `search_conversations_for_project` (one page per request) and returns it through `searchConversationsForProject`. The app only hydrates hypothesis counts for the returned page.

> Why not filter in app code: PostgREST caps every RPC response at **1000 rows**. The old path called `list_conversations_summary_for_project` (no limit), so supabase-js silently received only the first 1000 conversations and filtered those in memory — anyone past row 1000 was unsearchable, and loading + hydrating the whole project (~9k rows) took ~18s. `getConversationsList` (the in-app-filter version) still backs callers that genuinely need the full set: geo aggregates and the MCP `find-project-linkedin-conversations` tool. It pages the RPC with `.range()` + an explicit `.order()` (the function's internal ORDER BY does not survive PostgREST's `SELECT * FROM fn() LIMIT/OFFSET` wrapping, so without an outer order the page windows shift between requests).

Search is **tokenized AND**: whitespace-separated terms must each appear somewhere in receiver name, sender name, company, title/position, or last message text (case-insensitive; punctuation stripped from tokens, but **not** from the haystack — so `O'Brien` → token `obrien` won't match the stored `o'brien`). Tokens are parsed by `parseSearchTokens` and passed to the RPC as a `text[]`; the RPC matches `haystack LIKE ALL(...)`.

Examples:

- `Bilal Sahe` matches **Bilal Saheb** (tokens `bilal`, `sahe`).
- `Bilal Saheed` does **not** match **Bilal Saheb** (token `saheed` missing).

## RPC scope

The RPC includes every `LinkedinMessages` row that has either a `linkedin_conversation_uuid` **or** a `lead_uuid`. Each conversation is keyed by:

- real threads → the `linkedin_conversation_uuid`;
- threads with no conversation UUID → a synthetic `lead:<lead_uuid>` key (grouped per contact).

So first-touch / no-thread-yet messages (which LinkedIn syncs without a `linkedin_conversation_uuid`) now appear and are searchable. Rows with neither a conversation UUID nor a `lead_uuid` are still excluded (nothing to resolve a contact by). See `supabase/migrations/20260529120000_conversations_summary_include_null_conv_uuid.sql`.

The frontend opens `lead:<lead_uuid>` rows via `/api/conversation?leadUuid=...` (synthetic ids never match a real conversation UUID); `getConversation` already supports fetching a thread by `leadUuid`.

Earlier migration `supabase/migrations/20260520120000_backfill_linkedin_conversation_uuid.sql` copies a conversation UUID from sibling messages (same `lead_uuid`, `sender_profile_uuid`, `project_id`); it only helps threads that have at least one sibling already carrying a UUID, which is why the synthetic-key change above was still needed.

## Duplicate contacts

The same person may exist as multiple `Contacts` rows (same name, different `uuid`). Messages attach to one UUID; searching the UI can find the conversation only when that UUID’s messages are in the RPC. Merging duplicate contacts is a separate data-cleanup task.
