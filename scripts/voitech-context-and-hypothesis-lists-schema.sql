-- Structured, reusable project GTM context and hypothesis-to-contact-list links.
-- Safe to run repeatedly.

create table if not exists public.project_gtm_contexts (
  project_id uuid primary key references public."Projects"(id) on delete cascade,
  core_concept text,
  icp_description text,
  pains_and_signals text,
  expertise_and_differentiators text,
  proof_and_customer_cases text,
  objections_and_competitors text,
  exclusions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hypothesis_contact_lists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public."Projects"(id) on delete cascade,
  hypothesis_id uuid not null references public.hypotheses(id) on delete cascade,
  list_uuid uuid not null,
  created_at timestamptz not null default now(),
  unique (hypothesis_id, list_uuid)
);

create index if not exists hypothesis_contact_lists_project_idx
  on public.hypothesis_contact_lists(project_id);
create index if not exists hypothesis_contact_lists_list_idx
  on public.hypothesis_contact_lists(list_uuid);

create table if not exists public.context_job_posting_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public."Projects"(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  external_id text,
  title text not null,
  content text,
  source_url text,
  source_payload jsonb,
  posted_at timestamptz,
  captured_at timestamptz not null default now(),
  unique (project_id, company_id, external_id)
);

create index if not exists context_job_posting_snapshots_project_idx
  on public.context_job_posting_snapshots(project_id, captured_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists project_gtm_contexts_set_updated_at on public.project_gtm_contexts;
create trigger project_gtm_contexts_set_updated_at
before update on public.project_gtm_contexts
for each row execute function public.set_updated_at();
