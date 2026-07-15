# n8n launch completion webhook (push)

Closes the "poll-not-push" gap on the Pipeline → Launch flow. Instead of the app
only inferring a run is done from result-row counts plus a 90s idle-settle
guess, n8n signals completion explicitly.

## Two execution shapes — read this before wiring a workflow

The three Velvetech launch adapters differ in how the app invokes n8n, and the
completion contract has to match:

- **`velvetech_research`**: the app fires **one n8n execution for the whole
  launch** (`l9pGpKlzrQuCj4Yn`, ending at `Velvetech Final Summary`). That one
  execution can see the entire run, so its completion call is **authoritative**:
  send `{ "final": true }`. It always finalizes now — correct even if fewer
  leads succeeded than requested, since the pipeline legitimately filters some
  out and nothing more is coming.
- **`velvetech_reply`** (`bMc92zIIWe0wGAbE`) and **`velvetech_messaging`**
  (`awm0ax9fHkL1Sv3w`): the app fires **one n8n execution per lead** (see
  `buildVelvetechReplyPayloads` / `buildVelvetechMessagingPayloads` in
  `src/launcher-handlers.ts`, each looping over contacts and calling
  `triggerWorkflowPayload` once per lead). A single execution only ever sees
  one lead, so its completion call must be a **nudge, not an assertion**: send
  `{ "final": false }` or omit `final`. The endpoint re-runs the exact same
  `seen >= requested` / idle-settle check the status poller already applies —
  it can only finalize once every requested lead is actually accounted for, so
  a nudge from lead 1 of 5 can never prematurely close the run.

Getting this backwards on reply/messaging would make things *worse* than
today: a 5-lead run would show "done" after the first LinkedIn reply drafts,
hiding that 4 more are still in flight.

## Endpoint

```
POST /api/n8n/launch/:id/complete
```

- `:id` is the `launch_id` the app already threads into every Velvetech payload
  (`launch_id` / `run_id` — see the launch_id capture note below). It is the
  `n8n_launch_runs.id` UUID.
- Auth: same shared secret as the results push (`Bearer <secret>` from the same
  header n8n already sends to `/api/n8n/workflow-results`).
- Idempotent: a run that already has `finished_at` is returned unchanged
  (`alreadyComplete: true`).

### Body

| field             | type     | meaning |
|-------------------|----------|---------|
| `final`           | boolean  | `true` = force-finalize now (research only). Anything else (including omitted) = nudge; only finalizes on full coverage. |
| `status`          | string   | **Final path only.** Explicit terminal state, wins outright. Accepts `success`/`ok`/`completed`, `partial`, `failed`/`error`. |
| `results`         | array    | **Final path only.** Per-lead outcomes `[{ lead_uuid, ok?: bool, error?: string }]`, tallied when no explicit counts given. |
| `succeeded_count` / `failed_count` | int | **Final path only.** Explicit counts, beat `results` and row aggregates. |
| `error`           | string   | **Final path only.** Run-level error message. |

For research's single `{ "final": true }` call, none of the optional fields are
required — the backend falls back to `n8n_workflow_results` row aggregates,
which is already correct. For reply/messaging nudges, the body can just be `{}`.

## Wiring the n8n side (additive only — do not edit existing nodes)

Add one new **HTTP Request** node as the last node, after the node that already
POSTs to `/api/n8n/workflow-results`. Mirror that node's existing pattern
exactly (same URL host, same `Authorization: Bearer` header value, `sendBody:
json`, `options.response.response.neverError: true`, `continueOnFail: true` so
a hiccup here never breaks the parent workflow).

**Research** (`l9pGpKlzrQuCj4Yn`), after `Velvetech Final Summary`:
- URL: `=https://voitech.up.railway.app/api/n8n/launch/{{ $('Velvetech workflow input').first().json.run_id }}/complete`
  (research's `run_id` *is* the `launch_id` — see `buildVelvetechResearchPayload`)
- Body: `{ "final": true }`

**Reply** (`bMc92zIIWe0wGAbE`), after `POST reply Supabase`:
- `launch_id` is **not currently captured** by the `Reply input` node — do not
  add it there (that node is hand-tuned; edit-by-rebuild has wiped hand-tuned
  Velvetech nodes before, see the verification-gate incident). Instead read it
  straight off the raw trigger payload:
- URL: `=https://voitech.up.railway.app/api/n8n/launch/{{ $('Velvetech reply trigger').first().json.body.launch_id }}/complete`
- Body: `{ "final": false }`

**Messaging** (`awm0ax9fHkL1Sv3w`), after `POST messaging Supabase`:
- `Messaging input` already captures `launch_id` cleanly:
- URL: `=https://voitech.up.railway.app/api/n8n/launch/{{ $('Messaging input').first().json.launch_id }}/complete`
- Body: `{ "final": false }`

## App behavior after the push

`refreshRun` treats any run with `finished_at` as terminal, so a `final: true`
push sticks and later polls never recompute it. Nudges (`final` omitted/false)
never set `finished_at` early — they just re-run the same coverage check the
poller uses. The launcher UI already polls `/api/n8n/launch/:id/status` every
5s and stops on any non-`running` status, so completion surfaces within one
poll cycle either way. No schema change: existing `n8n_launch_runs` columns
carry everything.
