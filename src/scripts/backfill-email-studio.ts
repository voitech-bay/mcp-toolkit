import fs from "node:fs/promises";
import { getSupabase } from "../services/supabase.js";

type Json = Record<string, unknown>;
const apply = process.argv.includes("--apply");
const projectArg = process.argv.find((x) => x.startsWith("--project-id="))?.split("=")[1] ?? "";
const smartleadPath = process.argv.find((x) => x.startsWith("--smartlead-json="))?.split("=")[1] ?? "";
const client = getSupabase();
if (!client) throw new Error("Supabase is not configured");

async function generatedRows() {
  let query = client!.from("generated_messages").select("*,project_companies!inner(id,project_id,company_id)").eq("channel", "email").order("created_at");
  if (projectArg) query = query.eq("project_companies.project_id", projectArg);
  const r = await query.limit(10000); if (r.error) throw new Error(r.error.message); return (r.data ?? []) as Json[];
}

async function contacts(ids: string[]) {
  if (!ids.length) return new Map<string, Json>(); const r = await client!.from("Contacts").select("uuid,name,first_name,last_name,email,work_email,personal_email,company_uuid,company_name,position").in("uuid", ids); if (r.error) throw new Error(r.error.message); return new Map((r.data ?? []).map((x: Json) => [String(x.uuid), x]));
}

const generated = await generatedRows(); const contactMap = await contacts([...new Set(generated.map((x) => String(x.contact_id)))]);
let generatedImported = 0, generatedSkipped = 0, smartleadImported = 0;
for (const row of generated) {
  const pcRaw = row.project_companies as Json | Json[]; const pc = Array.isArray(pcRaw) ? pcRaw[0] : pcRaw; const projectId = String(pc?.project_id ?? ""); if (!projectId) { generatedSkipped++; continue; }
  const contact = contactMap.get(String(row.contact_id)) ?? {}; const ctx = (row.generation_context ?? {}) as Json; const campaignId = String(ctx.campaign_id ?? "imported-generated-messages"), batchName = String(ctx.batch_name ?? "Imported drafts"), step = Math.max(1, Number(row.variant_index ?? ctx.sequence_step ?? 1)); const subject = String(row.subject ?? ctx.subject ?? ""), content = String(row.content ?? "");
  const email = { project_id: projectId, contact_id: row.contact_id, company_id: pc?.company_id ?? contact.company_uuid ?? null, contact_name: String(contact.name ?? `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim()), company_name: String(contact.company_name ?? ""), campaign_id: campaignId, batch_name: batchName, persona: String(ctx.persona ?? contact.position ?? ""), channel: "email", sequence_step: step, step_number: step, recipient_email: String(contact.work_email ?? contact.email ?? contact.personal_email ?? "").toLowerCase() || null, current_subject: subject, current_body: content, current_model: String(ctx.model ?? "") || null, research_quality: "unknown", status: "ai_draft_made", provenance: "voitech_generated", generation_history_available: true };
  if (!apply) { generatedImported++; continue; }
  const up = await client.from("outreach_emails").upsert(email, { onConflict: "project_id,contact_id,campaign_id,batch_name,channel,step_number", ignoreDuplicates: true }).select("*").maybeSingle(); if (up.error) throw new Error(up.error.message); if (!up.data) { generatedSkipped++; continue; }
  const v = await client.from("outreach_email_versions").insert({ email_id: up.data.id, version_number: 1, subject, body: content, author_type: "import", author_id: "generated_messages_backfill", model: String(ctx.model ?? "" ) || null, annotations: [], validation_results: [], generation_reason: "generated_messages_backfill", state: "current" }).select("id").single(); if (v.error && v.error.code !== "23505") throw new Error(v.error.message); if (v.data) await client.from("outreach_emails").update({ current_version_id: v.data.id }).eq("id", up.data.id); await client.from("outreach_email_status_events").insert({ email_id: up.data.id, from_status: null, to_status: "ai_draft_made", actor_type: "import", actor_id: "generated_messages_backfill", reason: `Imported generated_messages ${row.id}`, idempotency_key: `generated-message:${row.id}` }); generatedImported++;
}

if (smartleadPath) {
  const parsed = JSON.parse(await fs.readFile(smartleadPath, "utf8")); const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed.data) ? parsed.data : [];
  for (const raw of records as Json[]) {
    const projectId = String(raw.project_id ?? projectArg), contactId = String(raw.contact_id ?? ""), campaignId = String(raw.campaign_id ?? ""); if (!projectId || !contactId || !campaignId) continue;
    const step = Math.max(1, Number(raw.sequence_step ?? raw.step_number ?? 1));
    const record = { project_id: projectId, contact_id: contactId, company_id: raw.company_id ?? null, contact_name: String(raw.contact_name ?? ""), company_name: String(raw.company_name ?? ""), campaign_id: campaignId, batch_name: String(raw.batch_name ?? "Smartlead history"), persona: String(raw.persona ?? ""), channel: "email", sequence_step: step, step_number: step, recipient_email: String(raw.recipient_email ?? raw.email ?? "").toLowerCase() || null, current_subject: String(raw.subject ?? ""), current_body: String(raw.body ?? raw.content ?? ""), current_model: null, research_quality: "unknown", status: "sent", provenance: "smartlead_history", generation_history_available: false, sent_at: raw.sent_at ?? raw.timestamp ?? null, smartlead_campaign_id: campaignId, smartlead_lead_id: raw.lead_id ?? null, smartlead_message_id: raw.message_id ?? null };
    if (!apply) { smartleadImported++; continue; }
    const existing = await client.from("outreach_emails").select("*").eq("project_id", projectId).eq("contact_id", contactId).eq("campaign_id", campaignId).eq("batch_name", record.batch_name).eq("channel", "email").eq("step_number", record.step_number).maybeSingle(); if (existing.error) throw new Error(existing.error.message);
    const saved = existing.data
      ? await client.from("outreach_emails").update({ ...record, provenance: "combined", generation_history_available: existing.data.generation_history_available }).eq("id", existing.data.id).select("*").single()
      : await client.from("outreach_emails").insert(record).select("*").single();
    if (saved.error) throw new Error(saved.error.message);
    if (!saved.data.current_version_id && (record.current_subject || record.current_body)) { const v = await client.from("outreach_email_versions").insert({ email_id: saved.data.id, version_number: 1, subject: record.current_subject, body: record.current_body, author_type: "import", author_id: "smartlead_history_backfill", annotations: [], validation_results: [], generation_reason: "smartlead_history_backfill", state: "current" }).select("id").single(); if (v.error && v.error.code !== "23505") throw new Error(v.error.message); if (v.data) await client.from("outreach_emails").update({ current_version_id: v.data.id }).eq("id", saved.data.id); }
    await client.from("outreach_email_status_events").insert({ email_id: saved.data.id, from_status: existing.data?.status ?? null, to_status: "sent", actor_type: "import", actor_id: "smartlead_history_backfill", reason: "Imported verified Smartlead history", idempotency_key: `smartlead-history:${String(raw.message_id ?? `${campaignId}:${contactId}:${record.sequence_step}`)}` }); smartleadImported++;
  }
}

console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", generatedFound: generated.length, generatedImported, generatedSkipped, smartleadImported, smartleadPath: smartleadPath || null }, null, 2));
