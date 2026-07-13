begin;

create table if not exists public.style_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public."Projects"(id) on delete cascade,
  name text not null,
  origin_url text,
  technique_summary text not null,
  prompt_block text not null,
  tags text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists style_sources_project_status_idx
  on public.style_sources(project_id, status, name);

create unique index if not exists style_sources_global_name_idx
  on public.style_sources(name)
  where project_id is null;

insert into public.style_sources (project_id, name, origin_url, technique_summary, prompt_block, tags)
values
  (
    null,
    'Disarming opener',
    'projects/Velvetech/messaging/12-messaging-tactics.md',
    'A low-friction routing or curiosity question that feels cheap to answer and does not rush to a meeting.',
    'Use disarming mode: open with one cheap-to-answer routing or curiosity question. Do not pitch immediately, do not cite deep company research as a forced compliment, and do not push for a meeting in message 1. Let the reply create the next step.',
    array['linkedin', 'email', 'opener', 'low-friction']
  ),
  (
    null,
    'Specific observation',
    'projects/Velvetech/messaging/05-channel-playbooks.md',
    'A concrete company-specific observation tied to a visible initiative, system, role, or event.',
    'Use specific-observation mode: start from one verified observation about the account, tie it to a plausible operational question, and keep the claim narrow. The observation must be sourced from supplied research or active knowledge. Avoid praise and avoid unsupported assumptions.',
    array['email', 'linkedin', 'personalization', 'research-led']
  ),
  (
    null,
    'Story arc',
    'projects/Velvetech/messaging/04-copy-frameworks.md',
    'A sequence structure where each touch introduces a fresh signal and advances the business hypothesis.',
    'Use story-arc mode: make each step add a new signal instead of recapping the prior message. Email 1 frames the operational hypothesis, email 2 pivots to a second signal, and email 3 offers a concrete audit or mapping deliverable only when it follows from the evidence.',
    array['sequence', 'email', 'multi-touch', 'structure']
  )
on conflict do nothing;

commit;
