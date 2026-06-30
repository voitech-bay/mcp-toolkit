import type { IncomingMessage, ServerResponse } from "node:http";
import { getSupabase } from "./services/supabase.js";
import { assembleOutreachContext, generatePov, generateVariants, getOrCreateResearch, loadKnowledge, PovSchema, type OutreachChannel, type OutreachPov } from "./services/outreach-agent.js";

type Json = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function send(res: ServerResponse, status: number, data: unknown) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); }
async function body(req: IncomingMessage): Promise<Json> { const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); try { const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v as Json : {}; } catch { return {}; } }
function query(req: IncomingMessage, key: string) { return new URL(req.url ?? "", "http://localhost").searchParams.get(key)?.trim() ?? ""; }
function stage(res: ServerResponse, name: string, data: Json = {}) { res.write(`event: stage\ndata: ${JSON.stringify({ stage: name, ...data })}\n\n`); }

async function settings(client: NonNullable<ReturnType<typeof getSupabase>>, projectId: string) {
  const r = await client.from("project_outreach_settings").select("*").eq("project_id", projectId).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  if (!r.data?.enabled) throw new Error("Outreach Agent is not enabled for this project");
  return r.data as Json;
}

export async function handleCreateOutreachRun(req: IncomingMessage, res: ServerResponse) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" });
  const b = await body(req); const projectId = String(b.projectId ?? ""); const contactId = String(b.contactId ?? ""); const channel = String(b.channel ?? "") as OutreachChannel; const prompt = String(b.userPrompt ?? "").trim();
  if (!UUID_RE.test(projectId) || !UUID_RE.test(contactId) || !["inmail", "message"].includes(channel) || !prompt) return send(res, 400, { error: "projectId, contactId, channel and userPrompt are required" });
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  let runId = "";
  try {
    stage(res, "context"); const s = await settings(client, projectId); const context = await assembleOutreachContext(client, contactId, Number(s.contact_message_limit ?? 100), Number(s.company_message_limit ?? 100));
    const companyId = context.company ? String(context.company.id ?? "") || null : null; const model = String(s.default_model ?? "openai/gpt-5.2"); const knowledge = await loadKnowledge(client, projectId);
    if (!knowledge.documents.length) throw new Error("No active project knowledge documents");
    const created = await client.from("outreach_agent_runs").insert({ project_id: projectId, contact_id: contactId, company_id: companyId, channel, user_prompt: prompt, guideline_profile: String(b.guidelineProfile ?? s.active_guideline_profile ?? "default"), context_snapshot: context, knowledge_manifest: knowledge.manifest, model, stage: "context" }).select("*").single();
    if (created.error) throw new Error(created.error.message); runId = String(created.data.id); stage(res, "research", { runId });
    const research = await getOrCreateResearch(client, { projectId, contactId, companyId, model, ttlDays: Number(s.research_ttl_days ?? 30), context, force: b.forceResearchRefresh === true });
    const warnings = research.snapshot.partial ? ["Live research returned insufficient citations; drafts use stored evidence only."] : [];
    await client.from("outreach_agent_runs").update({ research_snapshot_id: research.snapshot.id, stage: "research", warnings }).eq("id", runId);
    stage(res, "pov", { cachedResearch: research.cached, partialResearch: Boolean(research.snapshot.partial) });
    const pov = await generatePov({ model, projectId, contactId, channel, prompt, context, knowledge: knowledge.documents, research: research.snapshot });
    await client.from("outreach_agent_runs").update({ original_pov: pov.pov, stage: "pov", usage: { pov: pov.usage } }).eq("id", runId);
    stage(res, "variants"); const generated = await generateVariants({ model, projectId, contactId, channel, prompt, pov: pov.pov, context, knowledge: knowledge.documents });
    const pc = companyId ? await client.from("project_companies").select("id").eq("project_id", projectId).eq("company_id", companyId).maybeSingle() : { data: null, error: null };
    const drafts: Json[] = [];
    if (pc.data?.id) for (let i = 0; i < generated.variants.length; i++) {
      const v = generated.variants[i]; const ins = await client.from("generated_messages").insert({ contact_id: contactId, project_company_id: pc.data.id, content: v.body, generation_context: { provider: "openrouter", feature: "outreach-agent", rationale: v.rationale, warnings: v.warnings }, outreach_run_id: runId, channel, subject: v.subject, variant_index: i + 1, draft_status: "draft" }).select("*").single();
      if (!ins.error && ins.data) drafts.push(ins.data as Json);
    }
    const allWarnings = [...warnings, ...generated.variants.flatMap((v, i) => v.warnings.map((w) => `Variant ${i + 1}: ${w}`))];
    const done = await client.from("outreach_agent_runs").update({ stage: "complete", status: "complete", warnings: allWarnings, usage: { pov: pov.usage, variants: generated.usage }, updated_at: new Date().toISOString() }).eq("id", runId).select("*").single();
    stage(res, "completion", { run: done.data, research: research.snapshot, pov: pov.pov, variants: generated.variants, drafts, warnings: allWarnings }); res.write("event: done\ndata: {}\n\n"); res.end();
  } catch (e) { const message = e instanceof Error ? e.message : "Outreach generation failed"; if (runId) await client.from("outreach_agent_runs").update({ status: "error", error: message, updated_at: new Date().toISOString() }).eq("id", runId); res.write(`event: error\ndata: ${JSON.stringify({ error: message, runId })}\n\n`); res.end(); }
}

export async function handleListOutreachRuns(req: IncomingMessage, res: ServerResponse) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const projectId = query(req, "projectId"), contactId = query(req, "contactId");
  if (!UUID_RE.test(projectId) || !UUID_RE.test(contactId)) return send(res, 400, { error: "projectId and contactId are required" });
  const r = await client.from("outreach_agent_runs").select("id,channel,user_prompt,stage,status,warnings,error,model,created_at,updated_at").eq("project_id", projectId).eq("contact_id", contactId).order("created_at", { ascending: false }).limit(30);
  return send(res, r.error ? 500 : 200, r.error ? { error: r.error.message } : { data: r.data });
}
export async function handleGetOutreachRun(req: IncomingMessage, res: ServerResponse, id: string) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const projectId = query(req, "projectId"); if (!UUID_RE.test(projectId)) return send(res, 400, { error: "projectId is required" }); const r = await client.from("outreach_agent_runs").select("*,outreach_research_snapshots(*)").eq("id", id).eq("project_id", projectId).single(); if (r.error) return send(res, 404, { error: r.error.message });
  const d = await client.from("generated_messages").select("*").eq("outreach_run_id", id).order("variant_index"); send(res, 200, { data: r.data, drafts: d.data ?? [] });
}
export async function handlePatchOutreachPov(req: IncomingMessage, res: ServerResponse, id: string) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const b = await body(req); const projectId = String(b.projectId ?? ""); if (!UUID_RE.test(projectId)) return send(res, 400, { error: "projectId is required" }); const parsed = PovSchema.safeParse(b.pov); if (!parsed.success) return send(res, 400, { error: parsed.error.flatten() });
  const r = await client.from("outreach_agent_runs").update({ edited_pov: parsed.data, updated_at: new Date().toISOString() }).eq("id", id).eq("project_id", projectId).select("*").single(); send(res, r.error ? 500 : 200, r.error ? { error: r.error.message } : { data: r.data });
}
export async function handleRegenerateVariants(req: IncomingMessage, res: ServerResponse, id: string) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const b = await body(req); const projectId = String(b.projectId ?? ""); if (!UUID_RE.test(projectId)) return send(res, 400, { error: "projectId is required" }); const run = await client.from("outreach_agent_runs").select("*").eq("id", id).eq("project_id", projectId).single(); if (run.error || !run.data) return send(res, 404, { error: "Run not found" });
  try { const r = run.data as Json; const knowledge = await loadKnowledge(client, String(r.project_id)); const pov = PovSchema.parse(r.edited_pov ?? r.original_pov); const generated = await generateVariants({ model: String(r.model), projectId: String(r.project_id), contactId: String(r.contact_id), channel: r.channel as OutreachChannel, prompt: String(r.user_prompt), pov, context: r.context_snapshot as never, knowledge: knowledge.documents });
    const selected = Number(b.variantIndex ?? 0); const variants = selected >= 1 && selected <= 3 ? [generated.variants[selected - 1]] : generated.variants; const old = await client.from("generated_messages").select("project_company_id").eq("outreach_run_id", id).limit(1).maybeSingle(); if (!old.data?.project_company_id) throw new Error("Run has no project company draft target");
    if (selected) await client.from("generated_messages").delete().eq("outreach_run_id", id).eq("variant_index", selected); else await client.from("generated_messages").delete().eq("outreach_run_id", id);
    for (let i = 0; i < variants.length; i++) { const v = variants[i]; await client.from("generated_messages").insert({ contact_id: r.contact_id, project_company_id: old.data.project_company_id, content: v.body, generation_context: { provider: "openrouter", feature: "outreach-agent", rationale: v.rationale, warnings: v.warnings }, outreach_run_id: id, channel: r.channel, subject: v.subject, variant_index: selected || i + 1, draft_status: "draft" }); }
    return send(res, 200, { data: variants });
  } catch (e) { return send(res, 500, { error: e instanceof Error ? e.message : "Regeneration failed" }); }
}

export async function handleKnowledge(req: IncomingMessage, res: ServerResponse, projectId: string) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); if (!UUID_RE.test(projectId)) return send(res, 400, { error: "Invalid project ID" });
  if (req.method === "GET") { const r = await client.from("project_knowledge_documents").select("*").eq("project_id", projectId).order("priority").order("title").order("version", { ascending: false }); return send(res, r.error ? 500 : 200, r.error ? { error: r.error.message } : { data: r.data }); }
  if (req.method === "POST") { const b = await body(req); const title = String(b.title ?? "").trim(), kind = String(b.kind ?? ""), content = String(b.contentMarkdown ?? "").trim(); if (!title || !kind || !content) return send(res, 400, { error: "title, kind and contentMarkdown are required" }); const latest = await client.from("project_knowledge_documents").select("version").eq("project_id", projectId).eq("kind", kind).eq("title", title).order("version", { ascending: false }).limit(1).maybeSingle(); const r = await client.from("project_knowledge_documents").insert({ project_id: projectId, kind, title, content_markdown: content, version: Number(latest.data?.version ?? 0) + 1, priority: Number(b.priority ?? 100), status: "draft", source_path: b.sourcePath ?? null }).select("*").single(); return send(res, r.error ? 500 : 201, r.error ? { error: r.error.message } : { data: r.data }); }
  return send(res, 405, { error: "Method not allowed" });
}
export async function handleActivateKnowledge(_req: IncomingMessage, res: ServerResponse, projectId: string, id: string) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const row = await client.from("project_knowledge_documents").select("kind,title").eq("project_id", projectId).eq("id", id).single(); if (row.error) return send(res, 404, { error: row.error.message });
  await client.from("project_knowledge_documents").update({ status: "archived", updated_at: new Date().toISOString() }).eq("project_id", projectId).eq("kind", row.data.kind).eq("title", row.data.title).eq("status", "active"); const r = await client.from("project_knowledge_documents").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", id).eq("project_id", projectId).select("*").single(); send(res, r.error ? 500 : 200, r.error ? { error: r.error.message } : { data: r.data });
}
