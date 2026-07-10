alter table public."Contacts"
  add column if not exists call_messenger_status text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'contacts_call_messenger_status_check'
      and conrelid = 'public."Contacts"'::regclass
  ) then
    alter table public."Contacts"
      add constraint contacts_call_messenger_status_check
      check (
        call_messenger_status is null
        or call_messenger_status in (
          'No phone',
          'Whatsapp - Replied',
          'Whatsapp - No reply',
          'Called - No reply',
          'Called - Positive',
          'Called - Neutral'
        )
      );
  end if;
end $$;

comment on column public."Contacts".call_messenger_status is
  'Manual call / messenger outcome for MSSP Leaders and similar contact workflows.';
