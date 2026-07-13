begin;

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

alter table public.outreach_emails
  add column if not exists channel text not null default 'email';

alter table public.outreach_emails
  add column if not exists sequence_id uuid references public.outreach_sequences(id) on delete set null,
  add column if not exists step_number integer,
  add column if not exists external_target text;

alter table public.outreach_emails drop constraint if exists outreach_emails_channel_check;

update public.outreach_emails
set channel = case
    when channel = 'inmail' then 'linkedin_inmail'
    when channel in ('email', 'linkedin_dm', 'linkedin_inmail', 'reply') then channel
    else 'email'
  end,
  step_number = coalesce(step_number, sequence_step, 1)
where channel is distinct from case
    when channel = 'inmail' then 'linkedin_inmail'
    when channel in ('email', 'linkedin_dm', 'linkedin_inmail', 'reply') then channel
    else 'email'
  end
  or step_number is null;

alter table public.outreach_emails
  alter column step_number set default 1,
  alter column step_number set not null;

alter table public.outreach_emails
  add constraint outreach_emails_channel_check
  check (channel in ('email', 'linkedin_dm', 'linkedin_inmail', 'reply'));

alter table public.outreach_emails drop constraint if exists outreach_emails_sequence_step_check;
alter table public.outreach_emails
  add constraint outreach_emails_sequence_step_check check (sequence_step >= 0);

alter table public.outreach_emails drop constraint if exists outreach_emails_step_number_check;
alter table public.outreach_emails
  add constraint outreach_emails_step_number_check check (step_number >= 0);

do $$
declare
  cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'outreach_emails'
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid) not like '%channel%'
  loop
    execute format('alter table public.outreach_emails drop constraint %I', cname);
  end loop;
end $$;

drop index if exists public.outreach_emails_identity_idx;
create unique index if not exists outreach_emails_identity_idx
  on public.outreach_emails(project_id, contact_id, campaign_id, batch_name, channel, step_number);

create index if not exists outreach_sequences_project_contact_idx
  on public.outreach_sequences(project_id, contact_id, status, updated_at desc);

create index if not exists outreach_emails_sequence_idx
  on public.outreach_emails(project_id, sequence_id, step_number);

create index if not exists outreach_emails_channel_idx
  on public.outreach_emails(project_id, contact_id, channel, step_number);

commit;
