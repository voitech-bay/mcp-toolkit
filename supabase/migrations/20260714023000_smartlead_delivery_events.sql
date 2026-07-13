begin;

alter table public.outreach_emails
  add column if not exists recipient_email text,
  add column if not exists sent_at timestamptz,
  add column if not exists smartlead_campaign_id text,
  add column if not exists smartlead_lead_id text,
  add column if not exists smartlead_message_id text;

create table if not exists public.outreach_email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  email_id uuid references public.outreach_emails(id) on delete set null,
  match_status text not null default 'unmatched' check (match_status in ('matched', 'ambiguous', 'unmatched')),
  match_reason text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists outreach_email_delivery_events_email_idx
  on public.outreach_email_delivery_events(email_id, occurred_at desc);

create index if not exists outreach_email_delivery_events_provider_idx
  on public.outreach_email_delivery_events(provider, event_type, occurred_at desc);

create index if not exists outreach_emails_smartlead_message_idx
  on public.outreach_emails(smartlead_message_id)
  where smartlead_message_id is not null;

create index if not exists outreach_emails_smartlead_lead_campaign_idx
  on public.outreach_emails(smartlead_lead_id, smartlead_campaign_id)
  where smartlead_lead_id is not null and smartlead_campaign_id is not null;

create index if not exists outreach_emails_recipient_campaign_step_idx
  on public.outreach_emails(recipient_email, smartlead_campaign_id, sequence_step)
  where recipient_email is not null;

commit;
