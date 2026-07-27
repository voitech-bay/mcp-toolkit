-- Pinned prospect lists for the Voitech lists-checker views ("MSSP Leaders in MENA" etc).
--
-- Membership lives here, in Supabase, and nowhere else. Previously these views read
-- Contacts.tags and filtered on a GetSales tag UUID, which meant any bulk retag in
-- GetSales silently emptied the view: on 2026-07-23 the MENA tag was swapped to a
-- "new enrich" tag and the list collapsed from 134 to 22 visible contacts.
--
-- curated_list_members is deliberately NOT foreign-keyed to Contacts. A contact row
-- being re-synced, moved between GetSales lists, retagged, or briefly absent must
-- never drop it from a pinned list. Membership changes only when someone removes a
-- contact in the app.
--
-- Safe to run repeatedly.

create table if not exists public.curated_lists (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  project_id uuid references public."Projects"(id) on delete cascade,
  -- Legacy GetSales tag this list replaced. Lets existing links and API callers
  -- keep passing ?tag=<uuid> while membership resolves from curated_list_members.
  legacy_tag_uuid uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.curated_list_members (
  list_id uuid not null references public.curated_lists(id) on delete cascade,
  contact_uuid uuid not null,
  added_at timestamptz not null default now(),
  -- How the row got here: 'seed_getsales_list', 'seed_getsales_tag', 'app'.
  source text,
  primary key (list_id, contact_uuid)
);

create index if not exists curated_list_members_contact_idx
  on public.curated_list_members(contact_uuid);

drop trigger if exists curated_lists_set_updated_at on public.curated_lists;
create trigger curated_lists_set_updated_at
before update on public.curated_lists
for each row execute function public.set_updated_at();
