begin;

alter table public.project_outreach_settings add column if not exists email_studio_enabled boolean not null default false;
insert into public.project_outreach_settings(project_id, enabled, email_studio_enabled)
select p.id, true, true from public."Projects" p where lower(p.name) = 'velvetech'
on conflict (project_id) do update set email_studio_enabled = true, updated_at = now();

create table if not exists public.outreach_sequences (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public."Projects"(id) on delete cascade,
  contact_id uuid not null,
  company_id uuid,
  hypothesis_id uuid,
  status text not null default 'draft' check (status in ('draft','in_review','approved','launched')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outreach_emails (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public."Projects"(id) on delete cascade,
  company_id uuid,
  contact_id uuid not null,
  contact_name text not null default '',
  company_name text not null default '',
  campaign_id text not null default '',
  batch_name text not null default '',
  persona text not null default '',
  channel text not null default 'email' check (channel in ('email','linkedin_dm','linkedin_inmail','reply')),
  sequence_id uuid references public.outreach_sequences(id) on delete set null,
  sequence_step integer not null default 1 check (sequence_step >= 0),
  step_number integer not null default 1 check (step_number >= 0),
  external_target text,
  recipient_email text,
  current_subject text not null default '',
  current_body text not null default '',
  current_model text,
  research_quality text not null default 'unknown' check (research_quality in ('verified','partial','missing','unknown')),
  current_version_id uuid,
  research_snapshot_id uuid references public.outreach_research_snapshots(id) on delete set null,
  assigned_reviewer_id text,
  status text not null default 'research_ready' check (status in (
    'research_ready','ai_draft_made','needs_review','comments_made','regenerated',
    'final_check','approved','sent','research_missing','generation_failed',
    'changes_requested','rejected','sending_failed'
  )),
  provenance text not null default 'voitech_generated' check (provenance in (
    'voitech_generated','smartlead_history','combined','incomplete_history'
  )),
  approved_version_id uuid,
  approved_by text,
  approved_at timestamptz,
  sent_at timestamptz,
  smartlead_campaign_id text,
  smartlead_lead_id text,
  smartlead_message_id text,
  generation_history_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, contact_id, campaign_id, batch_name, channel, step_number)
);

create table if not exists public.outreach_email_versions (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.outreach_emails(id) on delete cascade,
  parent_version_id uuid references public.outreach_email_versions(id) on delete set null,
  version_number integer not null check (version_number > 0),
  subject text not null default '',
  body text not null default '',
  author_type text not null check (author_type in ('ai','human','import')),
  author_id text,
  model text,
  prompt_manifest jsonb not null default '{}'::jsonb,
  knowledge_manifest jsonb not null default '[]'::jsonb,
  annotations jsonb not null default '[]'::jsonb,
  validation_results jsonb not null default '[]'::jsonb,
  generation_reason text,
  state text not null default 'current' check (state in ('candidate','current','superseded')),
  created_at timestamptz not null default now(),
  unique(email_id, version_number)
);

do $$ begin
  alter table public.outreach_emails add constraint outreach_emails_current_version_fk foreign key (current_version_id) references public.outreach_email_versions(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.outreach_emails add constraint outreach_emails_approved_version_fk foreign key (approved_version_id) references public.outreach_email_versions(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.outreach_email_status_events (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.outreach_emails(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_type text not null default 'user' check (actor_type in ('user','agent','system','smartlead','import')),
  actor_id text,
  reason text,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.outreach_email_comments (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.outreach_emails(id) on delete cascade,
  source_version_id uuid not null references public.outreach_email_versions(id) on delete cascade,
  selected_quote text not null,
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null check (end_offset >= start_offset),
  context_before text not null default '',
  context_after text not null default '',
  body text not null,
  author_id text,
  status text not null default 'open' check (status in ('open','resolved')),
  mapped_start_offset integer,
  mapped_end_offset integer,
  mapped_version_id uuid references public.outreach_email_versions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.outreach_email_comment_replies (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.outreach_email_comments(id) on delete cascade,
  body text not null,
  author_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.outreach_email_feedback_resolutions (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.outreach_emails(id) on delete cascade,
  version_id uuid not null references public.outreach_email_versions(id) on delete cascade,
  comment_id uuid not null references public.outreach_email_comments(id) on delete cascade,
  outcome text not null check (outcome in ('addressed','not_followed','not_mapped')),
  explanation text not null,
  created_at timestamptz not null default now(),
  unique(version_id, comment_id)
);

create table if not exists public.outreach_email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'smartlead',
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  email_id uuid references public.outreach_emails(id) on delete set null,
  match_status text not null check (match_status in ('matched','unmatched','ambiguous','ignored')),
  match_reason text,
  occurred_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, provider_event_id)
);

create index if not exists outreach_emails_queue_idx on public.outreach_emails(project_id, status, updated_at desc);
create index if not exists outreach_sequences_project_contact_idx on public.outreach_sequences(project_id, contact_id, status, updated_at desc);
create index if not exists outreach_emails_contact_idx on public.outreach_emails(project_id, contact_id, step_number);
create index if not exists outreach_emails_sequence_idx on public.outreach_emails(project_id, sequence_id, step_number);
create index if not exists outreach_emails_channel_idx on public.outreach_emails(project_id, contact_id, channel, step_number);
create index if not exists outreach_emails_search_idx on public.outreach_emails(project_id, contact_name, company_name);
create index if not exists outreach_email_versions_email_idx on public.outreach_email_versions(email_id, version_number desc);
create index if not exists outreach_email_comments_open_idx on public.outreach_email_comments(email_id, status);
create index if not exists outreach_email_status_events_idx on public.outreach_email_status_events(email_id, created_at desc);

commit;
