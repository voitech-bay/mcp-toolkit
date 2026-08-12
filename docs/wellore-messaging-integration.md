# Wellore messaging integration

Brings Wellore (game art/dev outsourcing) onto the same Email Studio /
Sequence Studio loop Velvetech already has: pick a contact, generate a
3-touch sequence grounded in n8n research and locked voice rules, review,
approve, push to send. Full build plan and phase-by-phase notes live in
`ai-toolkit/projects/Wellore/voitech-app-integration-plan.md` — this doc is
the durable reference for what actually shipped and the IDs/gotchas a future
change needs.

**Status: Phases 0-8 built 2026-08-07.** Phases 0-5 (project, data bridge,
knowledge pack, registry, validator, research payload) are exercised and
verified against real data. Phase 6 (n8n workflow) is wired and activated
but has **not** had a live execution yet — deliberately, since that spends
real LLM budget. Phase 7 (Instantly push) has been exercised end-to-end with
a real test send. Phase 8 (cache-friendly token layout) is deployed but its
own verification (compare `cached_tokens` across two generates) hasn't been
run for the same reason as Phase 6.

## Key IDs

| what | value |
|---|---|
| Wellore `Projects.id` | `0038d0db-aab2-40f1-9f6e-38d38e157f8f` |
| Supabase project | `fllxbkmcokyjibvqyvbe` |
| OpenRouter model | `openai/gpt-5.6-terra` |
| n8n messaging parent workflow | `KZCg2KKFplQdVEYU` (`<DB-SYNC> Wellore — Messaging only (POV to copy)`), webhook path `wellore-messaging-trigger` |
| n8n messaging composer sub-workflow | `EUQ6Y5SA4NoSWvjs` (`Wellore — P7 Messaging Composer`) |
| Instantly workspace | `56bc516f-6450-4e4a-9534-6dc9394ad04f` |
| Instantly test campaign | `8ec328ce-2118-4d19-b8e4-4cf29296914d` (`Wellore push test`, sender `melissa@genesisdev.co`) |

## What runs where

- `src/scripts/bridge-wellore-to-canonical.ts` (`npm run bridge:wellore -- --apply`) — one-way, idempotent, `wellore_companies`/`wellore_contacts` → `companies`/`Contacts`/`project_companies`. Re-run after any change to the source `wellore_*` data; it's the only thing that keeps the canonical tables in sync.
- `src/scripts/seed-wellore-outreach-knowledge.ts` (`npm run seed:wellore-outreach`) — checksum-versioned `project_knowledge_documents` rows (voice rules, service catalog, cases, examples, lane framework). Re-run after editing `ai-toolkit/projects/Wellore/context/MESSAGING-FOR-AGENTS.md`, `ai-toolkit/.cursor/skills/wellore-email-copywriting/SKILL.md` / `examples.md`, or the seed script's own inline content. Cursor rule: `ai-toolkit/.cursor/rules/wellore-messaging.mdc`.
- `src/services/messaging-registry.ts` — the project-keyed dispatch table (system prompt, validator, `sequenceWorkflowKey`, `emailPushTarget`). Adding a third project means adding an entry here, not branching on project id anywhere else.
- `src/services/wellore-messaging/{types,prompt,validate,ids}.ts` — Wellore's half of the registry. `ids.ts` holds the `wellore.companies`/`wellore.contacts` bigint ↔ canonical-uuid hash, shared with the bridge script.
- `src/launcher-handlers.ts`'s `buildWelloreMessagingPayloads` — reads `wellore.companies.pov` + `wellore.signals` directly (not `outreach_research_snapshots`, not `n8n_workflow_results` — see gotcha below) and assembles the per-contact payload the n8n composer expects.
- `src/services/instantly.ts` + `handleSequenceStudioPushInstantlySequence` (`POST /api/sequence-studio/push-instantly-sequence`) — push approved email drafts to an Instantly campaign as one lead's `email_subject_N`/`email_body_N` custom variables.

## Gotchas (read before touching this)

1. **Two research caches exist; Wellore uses neither of Velvetech's Email-Studio-generate ones.** `outreach_research_snapshots`/`getOrCreateResearch` backs Email Studio's in-app Generate button and the older Outreach Agent SSE subsystem — Wellore doesn't touch either. `n8n_workflow_results` keyed by domain (`velvetech-pov`/`velvetech-company-deep-research`) backs Velvetech's Sequence Studio launch — Wellore has zero rows there and never will via this path. Wellore's Sequence Studio launch reads `wellore.companies.pov` / `wellore.signals` straight from the WLR pipeline's own schema. If you're chasing "why didn't research show up," check which of these three the code path you're looking at actually uses before assuming a cache miss.
2. **Coverage is thin.** Only 4 of the 51 bridged companies currently have `wellore.companies.pov->>'status' = 'ok'` (Nitro Games Oyj `id=59`, 85 Games Studio `id=493`, LoadComplete `id=183`, `111%` `id=397`) — the other 47 failed POV generation upstream in the WLR pipeline. `buildWelloreMessagingPayloads` refuses (409) to launch a contact without usable POV rather than draft from nothing. If you re-run the WLR POV writer and fix more companies, no app-side change is needed — coverage just grows.
3. **`getContactsByUuidsForProject` (in `services/supabase.ts`) is shared with Velvetech's payload builder** and only selected Velvetech's own column names (`position`, `linkedin`) until this build added `title`/`linkedin_url` to the same select — that's where Wellore's Phase-1-bridged data actually lives. If you add a third project with yet another set of populated columns, extend this select again rather than assuming it already carries what you need.
4. **The company-uuid ↔ bigint reverse lookup in `wellore-messaging/ids.ts` re-hashes every `wellore_companies.id` and matches**, since the uuid is a one-way `md5('wellore:company:'||id)` hash. Fine at 2,784 rows; if `wellore.companies` grows by an order of magnitude, this is the first thing to reconsider.
5. **The AAA-partnership-name rule (Tencent/Activision/Blizzard/THQ Nordic/G5) is conditional, not absolute**, and the condition ("is the contact's own company a large studio/publisher") has no coded threshold — `wellore-messaging/validate.ts`'s `aaa_name` check is a `warning`, not an `error`, on purpose. Don't "fix" this into a hard error without also defining what counts as large.
6. **`final-variants.md`** (`ai-toolkit/projects/Wellore/artifacts/20260805-2347-campaign-sequences-csv/final-variants.md`) **predates the current locked rules** — it has a wrong metric (30% where the source case file and SKILL.md's own checklist say 35%), a banned hyphen, and an invented-problem opener. Don't treat it as a clean copy source; it was only used once, verbatim, for a rendering test (see Phase 7 test send below).
7. **Instantly campaign id is not stored anywhere per-project** — the frontend keeps it in `localStorage` only (`mcp-toolkit/instantlyCampaignId`). If Wellore gets a real production campaign, either wire that as a proper setting or at minimum note the real campaign id here.
8. **`INSTANTLY_API_KEY` is in `mcp-toolkit/.env` (local) but not yet on Railway.** Production pushes will fail until it's set there.

## Loading reviewed drafts for review (added 2026-08-11)

`src/scripts/load-wellore-drafts.ts` (`npm run load:wellore-drafts -- --file <path> [--apply]`)
puts already-reviewed copy into Email Studio without spending LLM budget, so it can be
commented on line by line with the research it was built on visible alongside. It is not a
generation path — the copy comes from a reviewed source-of-truth JSON file.

Per contact it writes one `outreach_research_snapshots` row (the Research panel reads
`structured_research.verified_signals` / `inferred_priorities` off it, via
`stableResearchPoints`) and one `outreach_emails` row plus a `current` version per touch,
with `annotations` anchoring each span of copy to the research point or portfolio case it
came from. Every draft runs through `validateDraftForProject` first; touches with blocking
errors are reported and skipped rather than written.

Idempotent: emails upsert on `outreach_emails_identity_idx`, and a re-run only writes a new
version when the copy actually changed. Verified by running twice (18 touches, second run
wrote nothing).

First load: `projects/Wellore/artifacts/20260811-three-studio-app-load/drafts.json` in
ai-toolkit — LoadComplete (Ilhwan Cho), Curve Games (Ranj V), Gameduo (Rukyum Kong),
campaign `wellore-three-studio`, batch `three-studio-20260811`. 6 emails + 12 LinkedIn DMs.

Two things worth knowing:

- **Research point ids are positional.** `stableResearchPoints` derives them as
  `verified-N` / `inferred-N` from array order, but spreads the stored object last, so an
  explicit `id` in the file wins. The loader asserts the two agree — a silent mismatch would
  break every annotation's research reference (`unknown_research`).
- **Email Studio's list API defaults to `channel=email`.** LinkedIn DM rows live in the same
  table and share the same review workspace, but were invisible until this change added a
  Channel filter (and column) to the Email Studio filter bar. Default stays `email`, so
  Velvetech's view is unchanged.

## Marking Instantly sends as sent (added 2026-08-11)

`src/scripts/reconcile-instantly-sends.ts` (`npm run reconcile:instantly -- [--apply]`) is
the Instantly counterpart to `smartlead-reconcile.ts`. It reads what Instantly actually
sent, resolves each recipient to a project contact, and writes one `sent` `outreach_emails`
row per touch carrying the copy as delivered, so Email Studio's Sent view reflects reality
instead of only what the app itself drafted.

First run marked 18 sends across 9 contacts (Nitro Games, Playdigious, GFD Studio,
LoadComplete, Gameduo), campaigns `Wellore — 1 EMEA DRAFT` and `Wellore — 2 APAC DRAFT`,
all from 7 Aug, steps 1 and 2 only — step 3 never went out because both campaigns are
paused. Idempotent on the Instantly message id; a second `--apply` wrote nothing.

Decisions worth knowing:

- **`provenance = 'instantly_history'`** is a new value, added by migration
  `outreach_emails_allow_instantly_history_provenance`. The existing enum only knew about
  Smartlead. A row that already had an app-generated draft becomes `combined`, matching how
  the Smartlead reconciler behaves.
- **Instantly identifiers live in `external_push_log`** (provider, campaign, lead, message
  id, step code, sending account) with `external_target = 'instantly'`, rather than being
  crammed into the `smartlead_*` columns.
- **Two campaigns are excluded as test sends**, listed in `EXCLUDED_CAMPAIGNS`.
  `Wellore push test` is the Phase 7 rendering check: it used a real prospect's copy with
  the recipient overridden to an internal inbox, so importing it would record that prospect
  as having been mailed copy they never received. `c3036f8a` is a mail-tester deliverability
  check.
- **Contact resolution prefers the `title` column, not `position`.** `position` is
  GetSales's own column and is populated on the bare duplicate rows too, so it cannot tell
  the enriched row from the duplicate. Where several rows still tie, the script refuses to
  guess and reports the candidates — `yaroslav@cas.ai` matches five contact rows across four
  companies and has an explicit `CONTACT_OVERRIDES` entry pinning it to GFD Studio, which is
  what the sent copy is about.
- Needs `INSTANTLY_API_KEY`, which is in local `.env` but still not on Railway, so this runs
  as a local ops script for now.

## Attaching research to Wellore emails (added 2026-08-11)

`src/scripts/attach-wellore-research.ts` (`npm run attach:wellore-research -- [--apply]`)
fills Email Studio's Research panel for every Wellore email. Reads only, no LLM spend.

The panel reads `outreach_research_snapshots.structured_research.verified_signals` /
`.inferred_priorities` via `stableResearchPoints`. Wellore's research lives in two other
places (`wellore_research_snapshots` and `wellore_companies.pov` / `wellore_signals` /
`wellore_titles`), so without this bridge every Wellore email reads "No structured research
attached" even when the pipeline has plenty on that company.

- **Signals come from `wellore_titles` and `wellore_signals` directly, not from the reviewed
  bundle's own `verified_signals`.** `assembleWelloreResearch` sorts by date and caps at 8,
  and the pipeline writes one "site responds to a HEAD request" row per crawl, so that cap
  fills with liveness probes. Nitro Games has 68 signal rows and its reviewed bundle
  surfaced one useful fact; reading the tables directly gives 5. `isLivenessProbe` drops the
  probes and `titleSignals` puts titles first, since an upcoming title with a date is the
  reason to write at all.
- **Titles with `status = 'unknown'` are excluded.** That status means the pipeline never
  determined a stage. Presenting it as fact is exactly the Wobbly Life mistake, where a
  defaulted stage got read as real.
- **Hand-curated snapshots are preserved.** Pipeline points are merged in behind them and
  curated points keep their positions, because `stableResearchPoints` derives ids
  positionally and a shift would break the annotations that reference them.
- **The content hash is canonical (keys sorted recursively).** Postgres normalizes jsonb key
  order, so hashing a raw `JSON.stringify` of a snapshot read back from the database yields
  a different digest than the one written and mints a fresh snapshot on every run. This bit
  twice during the build; three consecutive `--apply` runs now report 13 unchanged.
- Snapshots this script produced carry an `origin`; orphans are cleaned up at the end of an
  apply run. Hand-curated snapshots have no `origin` and are never deleted.

Current coverage: all 39 Wellore emails have research. GFD Studio has no POV, so its two
contacts get title and news signals only. Gameduo's Jae Young Park gets POV points but zero
verified signals, because both Gameduo titles are `status = 'unknown'` and its only other
signals are liveness probes.

## Endpoints added

| route | purpose |
|---|---|
| `POST /api/sequence-studio/push-instantly-sequence` | push all approved email drafts for a contact to an Instantly campaign as one lead (`{projectId, contactId, campaignId, dryRun}`) |

## Verified so far

- Bridge: 247 Contacts / 51 companies, idempotent (re-run twice, same counts).
- Knowledge pack: 6 active documents, checksum-versioned, re-seed idempotent.
- Validator: 9 unit tests in `src/services/wellore-messaging/validate.test.ts`, including the locked Nitro E1 as a zero-error regression guard.
- `buildWelloreMessagingPayloads`: reverse hash lookup spot-checked against real data (Nitro Games Oyj → Samuli Snellman / Collin Foss, `title`/`linkedin_url`/`work_email` all correct).
- Instantly push: exercised through the app's own `instantly.ts` code (not just the Instantly MCP) — created the lead, set all 6 variables, confirmed via `get_lead`, activated the campaign, confirmed the first email actually sent via `list_emails` (2026-08-07 16:23 UTC, subject "Boltgun Boom", `melissa@genesisdev.co` → `paul@feasiblesecurity.com`).

## Not yet done

- No live `wellore_messaging` n8n execution against a real contact (spends LLM budget; do it once you're ready, Nitro Games Oyj is the best-covered candidate).
- No live `generateDraft` cache-comparison test (same reason).
- `INSTANTLY_API_KEY` not set on Railway.
- Instantly push route (`push-instantly-sequence`) itself hasn't been exercised against a real approved `outreach_emails` row — the test send used real copy pushed directly through `instantly.ts`, not through the route, since no Wellore draft existed yet to approve.
