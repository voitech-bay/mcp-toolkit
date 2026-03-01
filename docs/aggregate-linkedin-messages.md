# Aggregating LinkedinMessages with Senders and Contacts

## Join keys (verified)

| From (LinkedinMessages) | To table | To column | Notes |
|-------------------------|----------|-----------|--------|
| `lead_uuid`             | **Contacts** | `uuid` | Every message’s lead = one contact. |
| `linkedin_account_uuid` | **Senders**  | `linkedin_account_uuid` | Account that sent/received. |
| `sender_profile_uuid`    | **Senders**  | `uuid` | Same sender, by primary key. |

All 283 current messages have valid `lead_uuid` → Contacts and both sender links → Senders.

## SQL: messages with sender and contact

```sql
SELECT
  m.uuid AS message_uuid,
  m.text,
  m.status,
  m.sent_at,
  m.type,
  s.uuid AS sender_uuid,
  s.first_name AS sender_first_name,
  s.last_name AS sender_last_name,
  s.label AS sender_label,
  c.uuid AS contact_uuid,
  c.name AS contact_name,
  c.company_name,
  c.work_email
FROM "LinkedinMessages" m
LEFT JOIN "Senders" s ON s.uuid = m.sender_profile_uuid
LEFT JOIN "Contacts" c ON c.uuid = m.lead_uuid
ORDER BY m.sent_at DESC;
```

## Aggregations

**By sender (message counts per sender):**
```sql
SELECT
  s.uuid AS sender_uuid,
  s.first_name,
  s.last_name,
  s.label,
  COUNT(m.uuid) AS message_count
FROM "Senders" s
LEFT JOIN "LinkedinMessages" m ON m.sender_profile_uuid = s.uuid
GROUP BY s.uuid, s.first_name, s.last_name, s.label;
```

**By contact (message counts per contact):**
```sql
SELECT
  c.uuid AS contact_uuid,
  c.name,
  c.company_name,
  COUNT(m.uuid) AS message_count
FROM "Contacts" c
LEFT JOIN "LinkedinMessages" m ON m.lead_uuid = c.uuid
GROUP BY c.uuid, c.name, c.company_name;
```

**By sender and contact (matrix):**
```sql
SELECT
  s.uuid AS sender_uuid,
  s.first_name || ' ' || s.last_name AS sender_name,
  c.uuid AS contact_uuid,
  c.name AS contact_name,
  COUNT(m.uuid) AS message_count
FROM "Senders" s
CROSS JOIN "Contacts" c
LEFT JOIN "LinkedinMessages" m
  ON m.sender_profile_uuid = s.uuid AND m.lead_uuid = c.uuid
GROUP BY s.uuid, s.first_name, s.last_name, c.uuid, c.name
HAVING COUNT(m.uuid) > 0
ORDER BY message_count DESC;
```

## In code (Supabase client)

Use **foreign-key style selects** so one request returns messages with embedded sender and contact:

```ts
const { data, error } = await client
  .from("LinkedinMessages")
  .select(`
    *,
    sender:Senders!sender_profile_uuid(first_name, last_name, label),
    contact:Contacts!lead_uuid(name, company_name, work_email)
  `);
```

Or by `linkedin_account_uuid` for sender:

```ts
const { data, error } = await client
  .from("LinkedinMessages")
  .select(`
    *,
    sender:Senders!linkedin_account_uuid(first_name, last_name, label),
    contact:Contacts!lead_uuid(name, company_name, work_email)
  `);
```

(Ensure FK relationships exist in Supabase or use the join keys above in raw SQL / custom views.)
