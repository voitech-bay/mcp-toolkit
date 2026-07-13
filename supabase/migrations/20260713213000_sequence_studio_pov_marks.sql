begin;

create table if not exists public.pov_fact_marks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public."Projects"(id) on delete cascade,
  entity_key text not null,
  fact_id text not null,
  priority boolean not null default true,
  rank integer,
  comment text,
  author_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, entity_key, fact_id, author_id)
);

alter table public.outreach_emails
  add column if not exists external_pushed_at timestamptz,
  add column if not exists external_push_log jsonb;

create index if not exists pov_fact_marks_project_entity_idx
  on public.pov_fact_marks(project_id, entity_key, priority desc, rank nulls last, updated_at desc);

create index if not exists outreach_emails_external_push_idx
  on public.outreach_emails(project_id, channel, external_pushed_at desc)
  where external_pushed_at is not null;

commit;
