begin;

alter table public.outreach_emails
  add column if not exists channel text not null default 'email'
  check (channel in ('email', 'linkedin_dm', 'inmail', 'reply'));

alter table public.outreach_emails drop constraint if exists outreach_emails_sequence_step_check;
alter table public.outreach_emails
  add constraint outreach_emails_sequence_step_check check (sequence_step >= 0);

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

create unique index if not exists outreach_emails_identity_idx
  on public.outreach_emails(project_id, contact_id, campaign_id, batch_name, channel, sequence_step);

create index if not exists outreach_emails_channel_idx
  on public.outreach_emails(project_id, contact_id, channel, sequence_step);

commit;
