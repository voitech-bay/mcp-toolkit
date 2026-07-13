begin;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#64748b',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_name_lower_idx
  on public.users (lower(name));

insert into public.users(name, color)
select 'Pavel', '#2563eb'
where not exists (select 1 from public.users where lower(name) = lower('Pavel'));

insert into public.users(name, color)
select 'Reviewer', '#7c3aed'
where not exists (select 1 from public.users where lower(name) = lower('Reviewer'));

alter table public.outreach_email_versions
  add column if not exists author_user_id uuid references public.users(id) on delete set null;

alter table public.outreach_email_comments
  add column if not exists author_user_id uuid references public.users(id) on delete set null;

alter table public.outreach_email_comment_replies
  add column if not exists author_user_id uuid references public.users(id) on delete set null;

alter table public.outreach_email_status_events
  add column if not exists actor_user_id uuid references public.users(id) on delete set null;

alter table public.outreach_emails
  add column if not exists approved_by_user_id uuid references public.users(id) on delete set null;

create index if not exists outreach_email_versions_author_user_idx
  on public.outreach_email_versions(author_user_id);

create index if not exists outreach_email_comments_author_user_idx
  on public.outreach_email_comments(author_user_id);

create index if not exists outreach_email_status_events_actor_user_idx
  on public.outreach_email_status_events(actor_user_id);

commit;
