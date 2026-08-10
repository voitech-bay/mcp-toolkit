begin;

-- Research-review gate for Wellore: one row per contact, assembled from wellore.companies.pov
-- + wellore.signals, reviewed_at/reviewed_by is the entire approval gate (no status enum,
-- no transition table -- see Wellore Phase 10). buildWelloreMessagingPayloads reads only
-- approved rows, so what got reviewed is exactly what gets drafted from.
create table if not exists public.wellore_research_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public."Projects"(id) on delete cascade,
  contact_id uuid not null,
  company_uuid uuid not null,
  research jsonb not null,
  assembled_at timestamptz not null default now(),
  assembled_by text,
  reviewed_at timestamptz,
  reviewed_by text,
  unique (project_id, contact_id)
);
create index if not exists wellore_research_snapshots_project_idx on public.wellore_research_snapshots(project_id, reviewed_at);

commit;
