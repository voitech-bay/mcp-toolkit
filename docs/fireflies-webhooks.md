# Fireflies → mcp-toolkit webhooks

References: [Webhooks V1](https://docs.fireflies.ai/graphql-api/webhooks), [Webhooks V2](https://docs.fireflies.ai/graphql-api/webhooks-v2), [llms.txt index](https://docs.fireflies.ai/llms.txt).

## What Fireflies sends

Delivery: **HTTPS POST**, `Content-Type: application/json`, must return **2xx within ~10s**.

### V1 (legacy — Developer settings)

| Field | Meaning |
| --- | --- |
| `meetingId` | Transcript / meeting id (same id used in GraphQL `transcript(id:)`). |
| `eventType` | e.g. `"Transcription completed"`. |
| `clientReferenceId` | Optional UUID **you** set on upload — use to tie a meeting to a **project** or internal id. |

Example:

```json
{
  "meetingId": "ASxwZxCstx",
  "eventType": "Transcription completed",
  "clientReferenceId": "be582b46-4ac9-4565-9ba6-6ab4264496a8"
}
```

### V2 (recommended — Webhooks V2 UI)

| Field | Meaning |
| --- | --- |
| `event` | e.g. `meeting.transcribed` (raw transcript ready), `meeting.summarized` (summary + action items ready). |
| `timestamp` | Unix time **ms**. |
| `meeting_id` | Same as V1 `meetingId`. |
| `client_reference_id` | Optional; same role as `clientReferenceId`. |

Example:

```json
{
  "event": "meeting.transcribed",
  "timestamp": 1710876543210,
  "meeting_id": "ASxwZxCstx",
  "client_reference_id": "be582b46-4ac9-4565-9ba6-6ab4264496a8"
}
```

### Signature (if signing secret configured)

Header: **`X-Hub-Signature`**, value format: `sha256=<hex>` = HMAC-SHA256 of the **raw request body** (UTF-8 string) with your signing secret. Verify with timing-safe compare.

User-Agent is often `Fireflies-Webhook/1.0`.

## This repo

- **Endpoint:** `POST /api/webhooks/fireflies` (public URL must be HTTPS in production).
- **Env:** `FIREFLIES_WEBHOOK_SECRET` (optional; if set, invalid/missing signature → 401).
- **Storage:** Full payload + metadata in `fireflies_webhook_events` (Supabase).
- **Downstream:** Optional `FIREFLIES_CONTEXT_AGENT_WEBHOOK_URL` — after insert, server **POST**s a small JSON job (including row `id` and `meeting_id`) to your **other repo** / Cursor agent worker. That worker should load transcript via Fireflies GraphQL (`transcript(id: $meetingId)`) using its own API key, resolve project (e.g. from `client_reference_id` or transcript title), then update `projects/{ProjectName}/...` context files.

## Transcript content

Webhooks **do not** include transcript text — only ids. Fetch with GraphQL after receive (see Zapier example in Fireflies docs).

## Context agent worker (separate repo / Cursor)

`FIREFLIES_CONTEXT_AGENT_WEBHOOK_URL` receives **POST** JSON (`ContextAgentWebhookJob` in `src/services/fireflies-webhook.ts`):

| Field | Use |
| --- | --- |
| `fireflies_webhook_event_id` | Idempotency / logging back to `fireflies_webhook_events`. |
| `meeting_id` | Fireflies `transcript(id:)` GraphQL query (needs **your** `FIREFLIES_API_KEY` in the worker, not in mcp-toolkit). |
| `client_reference_id` | If you set this to your Supabase **project id** when uploading/scheduling in Fireflies, map directly; else infer project from title/participants. |
| `payload` | Original Fireflies body. |

Suggested worker steps:

1. Load full transcript + summary via Fireflies GraphQL.
2. Resolve **project** (UUID → row in `Projects`, or name match → folder `projects/{ProjectName}`).
3. Run Cursor agent (or LLM) over `projects/{ProjectName}/**` to list **delta**: facts that changed, new entities, doc updates.
4. Apply edits to markdown/context files; optionally PATCH an internal API or commit to git.

mcp-toolkit only stores the webhook and forwards the job; it does **not** run Cursor or edit the other repo.
