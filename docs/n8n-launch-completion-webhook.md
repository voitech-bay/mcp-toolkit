# n8n launch completion webhook (push)

Closes the "poll-not-push" gap on the Pipeline → Launch flow. Instead of the app
inferring a run is done from result-row counts plus a 90s idle-settle guess, the
n8n workflow signals completion explicitly on its final node.

## Endpoint

```
POST /api/n8n/launch/:id/complete
```

- `:id` is the `launch_id` the app already threads into every Velvetech payload
  (`launch_id` / `run_id`). It is the `n8n_launch_runs.id` UUID.
- Auth: same shared secret as the results push. If `N8N_WORKFLOW_RESULTS_SECRET`
  is set, send `Authorization: Bearer <secret>`; if unset, no header is required.
- Idempotent: a run that already has `finished_at` is returned unchanged
  (`alreadyComplete: true`). A concurrent settle/second push cannot double-write.

### Body (every field optional)

| field             | type     | meaning |
|-------------------|----------|---------|
| `status`          | string   | Explicit terminal state. Wins outright. Accepts `success`/`ok`/`completed`, `partial`, `failed`/`error`. |
| `results`         | array    | Per-lead outcomes `[{ lead_uuid, ok?: bool, success?: bool, error?: string }]`. Tallied into succeeded/failed when no explicit counts are given. |
| `succeeded_count` | int      | Explicit success count (beats `results` and row aggregates). |
| `failed_count`    | int      | Explicit failure count. |
| `error`           | string   | Run-level error message, stored on the run. |

If none are sent, the app finalizes from `n8n_workflow_results` row aggregates —
still an improvement, because completion is now instant instead of a 90s wait.

### Status resolution

1. Explicit `status` if provided.
2. Otherwise: nothing landed → `failed`; any failure or fewer succeeded than
   requested → `partial`; every requested lead succeeded → `success`.

## Wiring the n8n side

Add one **HTTP Request** node as the last node of each Velvetech launch workflow
(`velvetech_research`, `velvetech_messaging`, `velvetech_reply`) — after the node
that already POSTs to `/api/n8n/workflow-results`.

- Method: `POST`
- URL: `{{ $env.APP_BASE_URL }}/api/n8n/launch/{{ $json.launch_id }}/complete`
- Header (only if the secret is set): `Authorization: Bearer {{ $env.N8N_WORKFLOW_RESULTS_SECRET }}`
- Body (JSON), e.g.:

```json
{
  "status": "success",
  "results": [
    { "lead_uuid": "={{ $json.lead_uuid }}", "ok": true }
  ]
}
```

For a fan-out workflow, collect per-lead outcomes and send one completion call
per run (keyed by `launch_id`), not one per lead. The first call wins; later
duplicates are no-ops.

## App behavior after the push

`refreshRun` treats any run with `finished_at` as terminal, so the pushed status
sticks and later polls never recompute it. The launcher UI already polls
`/api/n8n/launch/:id/status` every 5s and stops on any non-`running` status, so
the pushed completion surfaces within one poll cycle. No schema change: the
existing `n8n_launch_runs` columns carry the pushed status/counts.
