begin;

create table if not exists public.project_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public."Projects"(id) on delete cascade,
  kind text not null check (kind in ('product_truth','proof_points','icp_angle_framework','forbidden_claims','messaging_style','inmail_guidelines','message_guidelines','examples')),
  title text not null,
  version integer not null check (version > 0),
  content_markdown text not null,
  priority integer not null default 100,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  source_path text,
  source_checksum text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, kind, title, version)
);
create index if not exists project_knowledge_active_idx on public.project_knowledge_documents(project_id, status, priority);

create table if not exists public.project_outreach_settings (
  project_id uuid primary key references public."Projects"(id) on delete cascade,
  enabled boolean not null default false,
  default_model text not null default 'openai/gpt-5.2',
  research_ttl_days integer not null default 30 check (research_ttl_days between 1 and 365),
  contact_message_limit integer not null default 100,
  company_message_limit integer not null default 100,
  active_guideline_profile text not null default 'default',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outreach_research_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public."Projects"(id) on delete cascade,
  contact_id uuid not null,
  company_id uuid,
  model text not null,
  input_hash text not null,
  structured_research jsonb not null default '{}'::jsonb,
  citations jsonb not null default '[]'::jsonb,
  tool_usage jsonb not null default '{}'::jsonb,
  usage jsonb,
  partial boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists outreach_research_lookup_idx on public.outreach_research_snapshots(project_id, contact_id, expires_at desc);

create table if not exists public.outreach_agent_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public."Projects"(id) on delete cascade,
  contact_id uuid not null,
  company_id uuid,
  channel text not null check (channel in ('inmail','message')),
  user_prompt text not null,
  guideline_profile text not null default 'default',
  context_snapshot jsonb not null default '{}'::jsonb,
  knowledge_manifest jsonb not null default '[]'::jsonb,
  research_snapshot_id uuid references public.outreach_research_snapshots(id),
  original_pov jsonb,
  edited_pov jsonb,
  model text not null,
  stage text not null default 'created',
  status text not null default 'running' check (status in ('running','complete','error')),
  warnings jsonb not null default '[]'::jsonb,
  error text,
  usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists outreach_runs_contact_idx on public.outreach_agent_runs(project_id, contact_id, created_at desc);

alter table public.generated_messages add column if not exists outreach_run_id uuid references public.outreach_agent_runs(id) on delete set null;
alter table public.generated_messages add column if not exists channel text check (channel is null or channel in ('inmail','message'));
alter table public.generated_messages add column if not exists subject text;
alter table public.generated_messages add column if not exists variant_index integer;
alter table public.generated_messages add column if not exists draft_status text default 'draft';

commit;
