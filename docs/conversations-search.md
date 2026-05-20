# Conversations list search

## API

`GET /api/conversations?projectId=...&search=...` loads summaries via RPC `list_conversations_summary_for_project`, then filters in app code.

Search is **tokenized AND**: whitespace-separated terms must each appear somewhere in receiver name, sender name, company, title/position, or last message text (case-insensitive; punctuation stripped from tokens).

Examples:

- `Bilal Sahe` matches **Bilal Saheb** (tokens `bilal`, `sahe`).
- `Bilal Saheed` does **not** match **Bilal Saheb** (token `saheed` missing).

## RPC scope

The RPC only includes `LinkedinMessages` rows with **non-null** `linkedin_conversation_uuid`. Threads where every message lacks a conversation UUID do not appear in the list until backfilled or re-synced.

Migration `supabase/migrations/20260520120000_backfill_linkedin_conversation_uuid.sql` copies a conversation UUID from sibling messages (same `lead_uuid`, `sender_profile_uuid`, `project_id`).

## Duplicate contacts

The same person may exist as multiple `Contacts` rows (same name, different `uuid`). Messages attach to one UUID; searching the UI can find the conversation only when that UUID’s messages are in the RPC. Merging duplicate contacts is a separate data-cleanup task.
