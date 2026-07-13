import type { IncomingMessage, ServerResponse } from "node:http";
import { CONTACTS_TABLE, N8N_WORKFLOW_RESULTS_TABLE, escapeIlikeMetacharacters, getSupabase } from "./services/supabase.js";
import { assembleOutreachContext, getOrCreateResearch, loadKnowledge, structuredCall } from "./services/outreach-agent.js";
import { canTransition, EmailDraftSchema, EMAIL_STATUSES, normalizeAnnotationRanges, normalizeOutreachMessageChannel, normalizeSequenceStep, parseEmailStudioChannelFilter, reanchorQuote, stableResearchPoints, validateDraft, validateDraftForProject, type EmailStatus, type OutreachMessageChannel } from "./services/email-studio.js";
import { buildVelvetechSystemPrompt } from "./services/velvetech-messaging/prompt.js";
import { isVelvetechProjectId } from "./services/velvetech-messaging/types.js";
import { loadPriorityAnchors, type PriorityAnchor } from "./services/pov-facts.js";

type Json = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function send(res: ServerResponse, status: number, data: unknown) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); }
async function body(req: IncomingMessage): Promise<Json> { const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); try { const x = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); return x && typeof x === "object" && !Array.isArray(x) ? x as Json : {}; } catch { return {}; } }
function url(req: IncomingMessage) { return new URL(req.url ?? "", "http://localhost"); }
function actor(req: IncomingMessage) { return String(req.headers["x-user-id"] ?? "voitech-user").slice(0, 200); }
function actorUserId(req: IncomingMessage) { const value = String(req.headers["x-user-id"] ?? ""); return UUID_RE.test(value) ? value : null; }
function validProject(value: unknown): value is string { return typeof value === "string" && UUID_RE.test(value); }
function str(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

async function loadStyleSource(client: NonNullable<ReturnType<typeof getSupabase>>, projectId: string, styleSourceId: unknown): Promise<Json | null> {
  const id = str(styleSourceId);
  if (!UUID_RE.test(id)) return null;
  const result = await client
    .from("style_sources")
    .select("id, name, origin_url, technique_summary, prompt_block, tags")
    .eq("id", id)
    .eq("status", "active")
    .or(`project_id.is.null,project_id.eq.${projectId}`)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data as Json | null) ?? null;
}

type ResolvedContact = {
  uuid: string;
  name: string;
  company_name: string;
  company_uuid: string | null;
  work_email: string | null;
};

function contactSummary(row: Record<string, unknown>): ResolvedContact {
  const first = str(row.first_name);
  const last = str(row.last_name);
  const name = str(row.name) || [first, last].filter(Boolean).join(" ");
  return {
    uuid: String(row.uuid),
    name,
    company_name: str(row.company_name),
    company_uuid: row.company_uuid ? String(row.company_uuid) : null,
    work_email: row.work_email ? String(row.work_email) : null,
  };
}

async function findContactsByName(
  client: NonNullable<ReturnType<typeof getSupabase>>,
  projectId: string,
  firstName: string,
  lastName: string,
  companyName = "",
) {
  const first = firstName.trim();
  const last = lastName.trim();
  const company = companyName.trim();
  const fullName = [first, last].filter(Boolean).join(" ");
  const select = "uuid, name, first_name, last_name, company_name, company_uuid, work_email";

  let byParts = client.from(CONTACTS_TABLE).select(select).eq("project_id", projectId).ilike("first_name", first).ilike("last_name", last);
  if (company) byParts = byParts.ilike("company_name", `%${escapeIlikeMetacharacters(company)}%`);
  const partsResult = await byParts.order("created_at", { ascending: false }).limit(10);
  if (partsResult.error) throw new Error(partsResult.error.message);
  if ((partsResult.data ?? []).length > 0) return (partsResult.data ?? []) as Record<string, unknown>[];

  let byName = client.from(CONTACTS_TABLE).select(select).eq("project_id", projectId).ilike("name", fullName);
  if (company) byName = byName.ilike("company_name", `%${escapeIlikeMetacharacters(company)}%`);
  const nameResult = await byName.order("created_at", { ascending: false }).limit(10);
  if (nameResult.error) throw new Error(nameResult.error.message);
  return (nameResult.data ?? []) as Record<string, unknown>[];
}

async function resolveContactForEmailStudio(
  client: NonNullable<ReturnType<typeof getSupabase>>,
  projectId: string,
  input: { contactId?: unknown; firstName?: unknown; lastName?: unknown; companyName?: unknown },
): Promise<{ contact: ResolvedContact } | { error: string; status: number; matches?: ResolvedContact[] }> {
  const contactId = str(input.contactId);
  if (validProject(contactId)) {
    const found = await client.from(CONTACTS_TABLE).select("uuid, name, first_name, last_name, company_name, company_uuid, work_email").eq("project_id", projectId).eq("uuid", contactId).maybeSingle();
    if (found.error) return { error: found.error.message, status: 500 };
    if (!found.data) return { error: "Contact not found in this project.", status: 404 };
    return { contact: contactSummary(found.data as Record<string, unknown>) };
  }

  const firstName = str(input.firstName);
  const lastName = str(input.lastName);
  const companyName = str(input.companyName);
  if (!firstName || !lastName) {
    return { error: "First name and last name are required.", status: 400 };
  }

  const matches = (await findContactsByName(client, projectId, firstName, lastName, companyName)).map((row) => contactSummary(row));
  if (matches.length === 0) {
    return { error: "No contact found with that name in this project.", status: 404 };
  }
  if (matches.length > 1) {
    return {
      error: companyName
        ? "Multiple contacts still match. Pick one from the list."
        : "Multiple contacts match. Add a company name or pick one from the list.",
      status: 409,
      matches,
    };
  }
  return { contact: matches[0] };
}

async function getScopedEmail(client: NonNullable<ReturnType<typeof getSupabase>>, id: string, projectId: string) {
  if (!UUID_RE.test(id) || !validProject(projectId)) return null;
  const enabled = await client.from("project_outreach_settings").select("email_studio_enabled").eq("project_id", projectId).maybeSingle();
  if (!enabled.data?.email_studio_enabled) return null;
  const r = await client.from("outreach_emails").select("*").eq("id", id).eq("project_id", projectId).maybeSingle();
  return r.data as Json | null;
}

async function statusChange(client: NonNullable<ReturnType<typeof getSupabase>>, email: Json, to: EmailStatus, actorType: string, actorId: string | null, reason?: string, idempotencyKey?: string, userId: string | null = null) {
  const from = String(email.status) as EmailStatus;
  if (!canTransition(from, to, actorType)) throw new Error(`Status cannot move from ${from} to ${to}`);
  const now = new Date().toISOString();
  const event = await client.from("outreach_email_status_events").insert({ email_id: email.id, from_status: from, to_status: to, actor_type: actorType, actor_id: actorId, actor_user_id: userId, reason: reason ?? null, idempotency_key: idempotencyKey ?? null }).select("id").single();
  if (event.error) {
    if (idempotencyKey && event.error.code === "23505") return email;
    throw new Error(event.error.message);
  }
  const patch: Json = { status: to, updated_at: now };
  if (to !== "approved") Object.assign(patch, { approved_by: null, approved_by_user_id: null, approved_at: null, approved_version_id: null });
  const updated = await client.from("outreach_emails").update(patch).eq("id", email.id).select("*").single();
  if (updated.error) throw new Error(updated.error.message);
  return updated.data as Json;
}

async function nextVersion(client: NonNullable<ReturnType<typeof getSupabase>>, emailId: string) {
  const r = await client.from("outreach_email_versions").select("version_number").eq("email_id", emailId).order("version_number", { ascending: false }).limit(1).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return Number(r.data?.version_number ?? 0) + 1;
}

export async function handleEmailStudioList(req: IncomingMessage, res: ServerResponse) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" });
  const q = url(req).searchParams; const projectId = q.get("projectId") ?? "";
  if (!validProject(projectId)) return send(res, 400, { error: "projectId is required" });
  const enabled = await client.from("project_outreach_settings").select("email_studio_enabled").eq("project_id", projectId).maybeSingle(); if (!enabled.data?.email_studio_enabled) return send(res, 403, { error: "Email Studio is not enabled for this project" });
  const page = Math.max(1, Number(q.get("page") ?? 1)); const pageSize = Math.min(100, Math.max(1, Number(q.get("pageSize") ?? 25))); const from = (page - 1) * pageSize;
  let query = client.from("outreach_emails").select("*", { count: "exact" }).eq("project_id", projectId);
  const channels = parseEmailStudioChannelFilter(q.get("channel"));
  query = channels.length === 1 ? query.eq("channel", channels[0]) : query.in("channel", channels);
  const status = q.get("status"); if (status === "failed") query = query.in("status", ["research_missing", "generation_failed", "sending_failed"]); else if (status && EMAIL_STATUSES.includes(status as EmailStatus)) query = query.eq("status", status);
  const batch = q.get("batch"); if (batch) query = query.eq("batch_name", batch);
  const campaign = q.get("campaign"); if (campaign) query = query.eq("campaign_id", campaign);
  const sequenceId = q.get("sequenceId"); if (sequenceId && UUID_RE.test(sequenceId)) query = query.eq("sequence_id", sequenceId);
  const persona = q.get("persona"); if (persona) query = query.eq("persona", persona);
  const reviewer = q.get("reviewer"); if (reviewer) query = query.eq("assigned_reviewer_id", reviewer);
  const quality = q.get("researchQuality"); if (quality && ["verified","partial","missing","unknown"].includes(quality)) query = query.eq("research_quality", quality);
  const model = q.get("model"); if (model) query = query.eq("current_model", model);
  const dateFrom = q.get("dateFrom"); if (dateFrom) query = query.gte("updated_at", `${dateFrom}T00:00:00.000Z`);
  const dateTo = q.get("dateTo"); if (dateTo) query = query.lte("updated_at", `${dateTo}T23:59:59.999Z`);
  const search = q.get("search")?.trim(); if (search) query = query.or(`current_subject.ilike.%${search.replace(/[%_,()]/g, "") }%,recipient_email.ilike.%${search.replace(/[%_,()]/g, "")}%,contact_name.ilike.%${search.replace(/[%_,()]/g, "")}%,company_name.ilike.%${search.replace(/[%_,()]/g, "")}%,batch_name.ilike.%${search.replace(/[%_,()]/g, "")}%,persona.ilike.%${search.replace(/[%_,()]/g, "")}%`);
  if (q.get("hasOpenComments") === "true") {
    const comments = await client.from("outreach_email_comments").select("email_id").eq("status", "open");
    query = query.in("id", [...new Set((comments.data ?? []).map((x: { email_id: string }) => x.email_id))]);
  }
  const result = await query.order("updated_at", { ascending: false }).range(from, from + pageSize - 1);
  if (result.error) return send(res, 500, { error: result.error.message });
  const rows = (result.data ?? []) as Json[]; const ids = rows.map((x) => String(x.id));
  const comments = ids.length ? await client.from("outreach_email_comments").select("email_id").in("email_id", ids).eq("status", "open") : { data: [] };
  const counts = new Map<string, number>(); for (const c of comments.data ?? []) counts.set(c.email_id, (counts.get(c.email_id) ?? 0) + 1);
  return send(res, 200, { data: rows.map((x) => ({ ...x, open_comment_count: counts.get(String(x.id)) ?? 0 })), total: result.count ?? 0, page, pageSize });
}

export async function handleEmailStudioContactSearch(req: IncomingMessage, res: ServerResponse) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" });
  const q = url(req).searchParams;
  const projectId = q.get("projectId") ?? "";
  if (!validProject(projectId)) return send(res, 400, { error: "projectId is required" });
  const enabled = await client.from("project_outreach_settings").select("email_studio_enabled").eq("project_id", projectId).maybeSingle();
  if (!enabled.data?.email_studio_enabled) return send(res, 403, { error: "Email Studio is not enabled for this project" });

  const firstName = q.get("firstName")?.trim() ?? "";
  const lastName = q.get("lastName")?.trim() ?? "";
  const companyName = q.get("companyName")?.trim() ?? "";
  if (!firstName || !lastName) return send(res, 400, { error: "firstName and lastName are required" });

  try {
    const matches = (await findContactsByName(client, projectId, firstName, lastName, companyName)).map((row) => contactSummary(row));
    return send(res, 200, { data: matches });
  } catch (e) {
    return send(res, 500, { error: e instanceof Error ? e.message : "Contact search failed" });
  }
}

export async function handleEmailStudioCreate(req: IncomingMessage, res: ServerResponse) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const b = await body(req);
  if (!validProject(b.projectId)) return send(res, 400, { error: "projectId is required" });
  const enabled = await client.from("project_outreach_settings").select("email_studio_enabled").eq("project_id", b.projectId).maybeSingle(); if (!enabled.data?.email_studio_enabled) return send(res, 403, { error: "Email Studio is not enabled for this project" });

  const resolved = await resolveContactForEmailStudio(client, b.projectId, {
    contactId: b.contactId,
    firstName: b.firstName,
    lastName: b.lastName,
    companyName: b.companyName,
  });
  if ("error" in resolved) return send(res, resolved.status, resolved.matches ? { error: resolved.error, matches: resolved.matches } : { error: resolved.error });
  const contact = resolved.contact;

  const channel = normalizeOutreachMessageChannel(b.channel);
  const stepNumber = normalizeSequenceStep(b.stepNumber ?? b.sequenceStep ?? 1);
  const row = {
    project_id: b.projectId,
    contact_id: contact.uuid,
    contact_name: str(b.contactName) || contact.name,
    company_name: str(b.companyName) || contact.company_name,
    company_id: validProject(b.companyId) ? b.companyId : contact.company_uuid,
    campaign_id: String(b.campaignId ?? ""),
    batch_name: String(b.batchName ?? ""),
    persona: String(b.persona ?? ""),
    channel,
    sequence_id: validProject(b.sequenceId) ? b.sequenceId : null,
    sequence_step: stepNumber,
    step_number: stepNumber,
    external_target: str(b.externalTarget) || null,
    recipient_email: b.recipientEmail ? String(b.recipientEmail).trim().toLowerCase() : contact.work_email,
    assigned_reviewer_id: b.assignedReviewerId ? String(b.assignedReviewerId) : null,
    provenance: String(b.provenance ?? "voitech_generated"),
    status: b.researchSnapshotId ? "research_ready" : "research_missing",
    research_quality: b.researchSnapshotId ? "unknown" : "missing",
    research_snapshot_id: validProject(b.researchSnapshotId) ? b.researchSnapshotId : null,
  };
  const r = await client.from("outreach_emails").upsert(row, { onConflict: "project_id,contact_id,campaign_id,batch_name,channel,step_number", ignoreDuplicates: false }).select("*").single();
  if (r.error) return send(res, 500, { error: r.error.message });
  await client.from("outreach_email_status_events").insert({ email_id: r.data.id, from_status: null, to_status: r.data.status, actor_type: "user", actor_id: actor(req), actor_user_id: actorUserId(req), reason: "Email Studio record created" });
  return send(res, 201, { data: r.data });
}

export async function handleEmailStudioGet(req: IncomingMessage, res: ServerResponse, id: string) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const projectId = url(req).searchParams.get("projectId") ?? "";
  const email = await getScopedEmail(client, id, projectId); if (!email) return send(res, 404, { error: "Email not found" });
  const [versions, comments, events, research, knowledge] = await Promise.all([
    client.from("outreach_email_versions").select("*").eq("email_id", id).order("version_number", { ascending: false }),
    client.from("outreach_email_comments").select("*,outreach_email_comment_replies(*)").eq("email_id", id).order("created_at"),
    client.from("outreach_email_status_events").select("*").eq("email_id", id).order("created_at", { ascending: false }),
    email.research_snapshot_id ? client.from("outreach_research_snapshots").select("*").eq("id", email.research_snapshot_id).maybeSingle() : Promise.resolve({ data: null }),
    client.from("project_knowledge_documents").select("id,kind,title,version,priority").eq("project_id", projectId).eq("status", "active").order("priority"),
  ]);
  const current = (versions.data ?? []).find((x: Json) => x.id === email.current_version_id) ?? null;
  // No synthesized snapshot yet (e.g. imported/sent history that never ran generation):
  // surface whatever raw n8n research pipeline output already exists for this contact/company
  // so the panel isn't empty even though nothing has been synthesized into a snapshot.
  let rawN8nResearch: Json[] = [];
  if (!research.data) {
    const filters: string[] = [`contact_id.eq.${email.contact_id}`];
    if (email.company_id) filters.push(`company_id.eq.${email.company_id}`);
    const raw = await client.from(N8N_WORKFLOW_RESULTS_TABLE).select("id,workflow_name,result,created_at").or(filters.join(",")).order("created_at", { ascending: false }).limit(20);
    rawN8nResearch = (raw.data ?? []) as Json[];
  }
  return send(res, 200, { data: email, currentVersion: current, versions: versions.data ?? [], comments: comments.data ?? [], statusEvents: events.data ?? [], research: research.data ?? null, researchPoints: stableResearchPoints((research.data ?? {}) as Json), rawN8nResearch, instructions: knowledge.data ?? [] });
}

export async function handleEmailStudioStatus(req: IncomingMessage, res: ServerResponse, id: string) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const b = await body(req); const projectId = String(b.projectId ?? "");
  const email = await getScopedEmail(client, id, projectId); if (!email) return send(res, 404, { error: "Email not found" }); const to = String(b.status) as EmailStatus;
  if (!EMAIL_STATUSES.includes(to)) return send(res, 400, { error: "Invalid status" });
  try { return send(res, 200, { data: await statusChange(client, email, to, "user", actor(req), String(b.reason ?? "Manual workflow update"), undefined, actorUserId(req)) }); } catch (e) { return send(res, 409, { error: e instanceof Error ? e.message : "Status update failed" }); }
}

async function generateDraft(client: NonNullable<ReturnType<typeof getSupabase>>, email: Json, prompt: string, previous?: Json, comments: Json[] = [], includedResearchPointIds: string[] = [], styleSourceId?: unknown) {
  const settings = await client.from("project_outreach_settings").select("*").eq("project_id", email.project_id).maybeSingle(); if (settings.error || !settings.data?.enabled) throw new Error("Outreach Agent is not enabled for this project");
  const velvetech = isVelvetechProjectId(email.project_id);
  const model = String(settings.data.default_model ?? (velvetech ? "openai/gpt-5.5" : "openai/gpt-5.2")); const context = await assembleOutreachContext(client, String(email.contact_id), Number(settings.data.contact_message_limit ?? 100), Number(settings.data.company_message_limit ?? 100));
  const researchResult = email.research_snapshot_id ? await client.from("outreach_research_snapshots").select("*").eq("id", email.research_snapshot_id).single() : null;
  const research = researchResult?.data ?? (await getOrCreateResearch(client, { projectId: String(email.project_id), contactId: String(email.contact_id), companyId: email.company_id ? String(email.company_id) : null, model, ttlDays: Number(settings.data.research_ttl_days ?? 30), context, force: false })).snapshot;
  const knowledge = await loadKnowledge(client, String(email.project_id)); const points = stableResearchPoints(research as Json); const allowed = includedResearchPointIds.length ? points.filter((p) => includedResearchPointIds.includes(String(p.id))) : points;
  const channel = normalizeOutreachMessageChannel(email.channel);
  const sequenceStep = normalizeSequenceStep(email.step_number ?? email.sequence_step ?? 1);
  // B4: operator-prioritized POV facts anchor the draft. They stay citable even when
  // includedResearchPointIds narrowed the research set, and lead the hook for message 1.
  const anchors = await loadPriorityAnchors(client, { projectId: String(email.project_id), contactId: String(email.contact_id), companyId: email.company_id ? String(email.company_id) : null });
  const styleSource = await loadStyleSource(client, String(email.project_id), styleSourceId);
  const anchorPoints = anchors.map((a: PriorityAnchor) => ({ id: `pov:${a.factId}`, kind: "verified", statement: a.text, source: "operator_priority" }));
  const anchoredAllowed = anchorPoints.length ? [...anchorPoints, ...allowed] : allowed;
  const priorityAnchors = anchors.map((a: PriorityAnchor, i: number) => ({ id: `pov:${a.factId}`, rank: a.rank ?? i + 1, statement: a.text, operator_comment: a.comment }));
  const anchorDirective = priorityAnchors.length
    ? ` The operator prioritized these account facts as the preferred anchor for this sequence${sequenceStep === 1 ? "; open message 1 on the top-ranked one" : ""}. Prefer them over other research when choosing the hook, keep their meaning exact, follow any operator_comment, and cite them by id.`
    : "";
  const styleDirective = styleSource
    ? ` Apply the selected style technique: ${str(styleSource.name)}. ${str(styleSource.prompt_block)}`
    : "";
  const systemPrompt = velvetech
    ? buildVelvetechSystemPrompt(channel === "linkedin_inmail" ? "inmail" : channel === "linkedin_dm" ? "linkedin_dm" : "email", sequenceStep, String(email.persona ?? ""), "standard")
    : "Write one research-based cold email. Return JSON only matching the supplied schema. Annotations use zero-based offsets into body only and exact text. Use concise user-facing audit explanations, never hidden chain-of-thought. Verified claims must reference supplied research IDs. Follow active project knowledge. Do not send or schedule anything.";
  const call = await structuredCall({ model, schema: EmailDraftSchema, trace: { feature: "email-studio", stage: previous ? "regenerate" : "generate", project_id: email.project_id, contact_id: email.contact_id },
    system: systemPrompt,
    user: JSON.stringify({ task: `${prompt}${anchorDirective}${styleDirective}`, recipient_context: context, research_points: anchoredAllowed, priority_anchors: priorityAnchors, selected_style_source: styleSource, active_knowledge: knowledge.documents, previous_version: previous ?? null, unresolved_comments: comments.map((c) => ({ id: c.id, selected_quote: c.selected_quote, body: c.body })), required_comment_ids: comments.map((c) => c.id), sequence_step: sequenceStep, step_number: sequenceStep }) });
  call.value.annotations = normalizeAnnotationRanges(call.value.body, call.value.annotations); const validation = validateDraftForProject(String(email.project_id), channel, sequenceStep, call.value.subject, call.value.body, call.value.annotations, new Set(anchoredAllowed.map((x) => String(x.id))), new Set(knowledge.documents.map((x) => String(x.id)))); if (validation.some((x) => x.severity === "error")) throw new Error(`Generated draft failed validation: ${validation.filter((x) => x.severity === "error").map((x) => x.message).join("; ")}`);
  return { draft: call.value, validation, model, knowledgeManifest: knowledge.manifest, research, usage: call.usage, priorityAnchors, styleSource };
}

async function insertVersion(client: NonNullable<ReturnType<typeof getSupabase>>, email: Json, values: Json, makeCurrent: boolean) {
  const versionNumber = await nextVersion(client, String(email.id));
  if (makeCurrent) await client.from("outreach_email_versions").update({ state: "superseded" }).eq("email_id", email.id).eq("state", "current");
  const ins = await client.from("outreach_email_versions").insert({ email_id: email.id, parent_version_id: email.current_version_id ?? null, version_number: versionNumber, state: makeCurrent ? "current" : "candidate", ...values }).select("*").single();
  if (ins.error) throw new Error(ins.error.message);
  if (makeCurrent) { const u = await client.from("outreach_emails").update({ current_version_id: ins.data.id, current_subject: ins.data.subject, current_body: ins.data.body, current_model: ins.data.model ?? null, updated_at: new Date().toISOString() }).eq("id", email.id); if (u.error) throw new Error(u.error.message); }
  return ins.data as Json;
}

export async function handleEmailStudioGenerate(req: IncomingMessage, res: ServerResponse, id: string) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const b = await body(req); const email = await getScopedEmail(client, id, String(b.projectId ?? "")); if (!email) return send(res, 404, { error: "Email not found" });
  try { const result = await generateDraft(client, email, String(b.prompt ?? "Create a concise, research-led cold email."), undefined, [], Array.isArray(b.includedResearchPointIds) ? b.includedResearchPointIds.map(String) : [], b.styleSourceId); const version = await insertVersion(client, email, { subject: result.draft.subject, body: result.draft.body, author_type: "ai", author_id: "email-studio-agent", model: result.model, knowledge_manifest: result.knowledgeManifest, annotations: result.draft.annotations, validation_results: result.validation, generation_reason: "initial_generation", prompt_manifest: { usage: result.usage, priority_anchors: result.priorityAnchors, style_source: result.styleSource } }, true); const updated = await statusChange(client, email, "ai_draft_made", "agent", "email-studio-agent", "Initial email generated"); await client.from("outreach_emails").update({ research_snapshot_id: (result.research as Json).id, research_quality: (result.research as Json).partial ? "partial" : "verified" }).eq("id", id); return send(res, 201, { data: updated, version }); } catch (e) { try { await statusChange(client, email, "generation_failed", "agent", "email-studio-agent", e instanceof Error ? e.message : "Generation failed"); } catch {} return send(res, 500, { error: e instanceof Error ? e.message : "Generation failed" }); }
}

export async function handleEmailStudioRegenerate(req: IncomingMessage, res: ServerResponse, id: string) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const b = await body(req); const email = await getScopedEmail(client, id, String(b.projectId ?? "")); if (!email) return send(res, 404, { error: "Email not found" });
  const current = await client.from("outreach_email_versions").select("*").eq("id", email.current_version_id).single(); const comments = await client.from("outreach_email_comments").select("*").eq("email_id", id).eq("status", "open");
  try { const scope = String(b.scope ?? "full"); const selectionDirective = scope === "full" ? "" : ` Preserve all content outside this exact ${scope}: ${JSON.stringify(b.selection ?? null)}.`; const result = await generateDraft(client, email, `${String(b.prompt ?? `Regenerate the ${scope} email and address every unresolved comment.`)}${selectionDirective}`, current.data as Json, (comments.data ?? []) as Json[], Array.isArray(b.includedResearchPointIds) ? b.includedResearchPointIds.map(String) : [], b.styleSourceId); const version = await insertVersion(client, email, { subject: result.draft.subject, body: result.draft.body, author_type: "ai", author_id: "email-studio-agent", model: result.model, knowledge_manifest: result.knowledgeManifest, prompt_manifest: { scope, selection: b.selection ?? null, usage: result.usage, priority_anchors: result.priorityAnchors, style_source: result.styleSource }, annotations: result.draft.annotations, validation_results: result.validation, generation_reason: `feedback_${scope}` }, false);
    const returnedResolutions = result.draft.feedback_resolutions ?? []; const resolutions = new Map(returnedResolutions.map((x) => [x.comment_id, x])); for (const c of (comments.data ?? []) as Json[]) { const rr = resolutions.get(String(c.id)) ?? { outcome: "not_followed", explanation: "The model did not return a resolution for this comment." }; await client.from("outreach_email_feedback_resolutions").upsert({ email_id: id, version_id: version.id, comment_id: c.id, outcome: rr.outcome, explanation: rr.explanation }, { onConflict: "version_id,comment_id" }); }
    await statusChange(client, email, "regenerated", "agent", "email-studio-agent", "Feedback regeneration candidate created"); return send(res, 201, { version, resolutions: returnedResolutions });
  } catch (e) { return send(res, 500, { error: e instanceof Error ? e.message : "Regeneration failed" }); }
}

export async function handleEmailStudioAdoptVersion(req: IncomingMessage, res: ServerResponse, emailId: string, versionId: string) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const b = await body(req); const email = await getScopedEmail(client, emailId, String(b.projectId ?? "")); if (!email) return send(res, 404, { error: "Email not found" }); const v = await client.from("outreach_email_versions").select("*").eq("id", versionId).eq("email_id", emailId).single(); if (v.error) return send(res, 404, { error: "Version not found" });
  await client.from("outreach_email_versions").update({ state: "superseded" }).eq("email_id", emailId).eq("state", "current"); await client.from("outreach_email_versions").update({ state: "current" }).eq("id", versionId);
  const comments = await client.from("outreach_email_comments").select("*").eq("email_id", emailId).eq("status", "open"); for (const c of (comments.data ?? []) as Json[]) { const anchor = reanchorQuote(String(v.data.body), String(c.selected_quote), Number(c.start_offset), String(c.context_before), String(c.context_after)); await client.from("outreach_email_comments").update({ mapped_version_id: versionId, mapped_start_offset: anchor?.start ?? null, mapped_end_offset: anchor?.end ?? null, updated_at: new Date().toISOString() }).eq("id", c.id); }
  const updated = await client.from("outreach_emails").update({ current_version_id: versionId, current_subject: v.data.subject, current_body: v.data.body, current_model: v.data.model ?? null, updated_at: new Date().toISOString() }).eq("id", emailId).select("*").single(); return send(res, 200, { data: updated.data, version: v.data });
}

export async function handleEmailStudioHumanVersion(req: IncomingMessage, res: ServerResponse, id: string) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const b = await body(req); const email = await getScopedEmail(client, id, String(b.projectId ?? "")); if (!email) return send(res, 404, { error: "Email not found" }); const subject = String(b.subject ?? "").trim(), content = String(b.body ?? "").trim(); if (!subject || !content) return send(res, 400, { error: "subject and body are required" });
  try { const validation = validateDraft(subject, content, []); const version = await insertVersion(client, email, { subject, body: content, author_type: "human", author_id: actor(req), author_user_id: actorUserId(req), annotations: [], validation_results: validation, generation_reason: "manual_edit" }, true); let updated: Json = email; if (email.status === "approved" || email.status === "final_check") updated = await statusChange(client, email, "needs_review", "user", actor(req), "Content edited; prior approval invalidated", undefined, actorUserId(req)); return send(res, 201, { data: updated, version }); } catch (e) { return send(res, 500, { error: e instanceof Error ? e.message : "Save failed" }); }
}

export async function handleEmailStudioCreateComment(req: IncomingMessage, res: ServerResponse, id: string) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const b = await body(req); const email = await getScopedEmail(client, id, String(b.projectId ?? "")); if (!email) return send(res, 404, { error: "Email not found" }); const version = await client.from("outreach_email_versions").select("body").eq("id", email.current_version_id).single(); const start = Number(b.startOffset), end = Number(b.endOffset), quote = String(b.selectedQuote ?? ""); if (!quote || start < 0 || end <= start || String(version.data?.body ?? "").slice(start, end) !== quote) return send(res, 400, { error: "Comment selection no longer matches the current version" });
  const r = await client.from("outreach_email_comments").insert({ email_id: id, source_version_id: email.current_version_id, selected_quote: quote, start_offset: start, end_offset: end, context_before: String(b.contextBefore ?? ""), context_after: String(b.contextAfter ?? ""), body: String(b.body ?? "").trim(), author_id: actor(req), author_user_id: actorUserId(req), mapped_version_id: email.current_version_id, mapped_start_offset: start, mapped_end_offset: end }).select("*").single(); if (r.error) return send(res, 500, { error: r.error.message });
  if (email.status !== "comments_made") try { await statusChange(client, email, "comments_made", "user", actor(req), "Review comment added", undefined, actorUserId(req)); } catch {}
  return send(res, 201, { data: r.data });
}

function nestedProjectId(value: unknown): unknown { return Array.isArray(value) ? value[0]?.project_id : (value as Json | null)?.project_id; }

export async function handleEmailStudioPatchComment(req: IncomingMessage, res: ServerResponse, commentId: string) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const b = await body(req); if (!validProject(b.projectId)) return send(res, 400, { error: "projectId is required" }); const c = await client.from("outreach_email_comments").select("*,outreach_emails!inner(project_id)").eq("id", commentId).single(); if (c.error || nestedProjectId(c.data.outreach_emails) !== b.projectId) return send(res, 404, { error: "Comment not found" }); const patch: Json = { updated_at: new Date().toISOString() }; if (b.status === "open" || b.status === "resolved") { patch.status = b.status; patch.resolved_at = b.status === "resolved" ? new Date().toISOString() : null; } if (typeof b.body === "string" && b.body.trim()) patch.body = b.body.trim(); const r = await client.from("outreach_email_comments").update(patch).eq("id", commentId).select("*").single(); return send(res, r.error ? 500 : 200, r.error ? { error: r.error.message } : { data: r.data });
}

export async function handleEmailStudioReply(req: IncomingMessage, res: ServerResponse, commentId: string) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const b = await body(req); if (!validProject(b.projectId) || !String(b.body ?? "").trim()) return send(res, 400, { error: "projectId and body are required" }); const c = await client.from("outreach_email_comments").select("email_id,outreach_emails!inner(project_id)").eq("id", commentId).single(); if (c.error || nestedProjectId(c.data.outreach_emails) !== b.projectId) return send(res, 404, { error: "Comment not found" }); const r = await client.from("outreach_email_comment_replies").insert({ comment_id: commentId, body: String(b.body).trim(), author_id: actor(req), author_user_id: actorUserId(req) }).select("*").single(); return send(res, r.error ? 500 : 201, r.error ? { error: r.error.message } : { data: r.data });
}

export async function handleEmailStudioApprove(req: IncomingMessage, res: ServerResponse, id: string) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const b = await body(req); const email = await getScopedEmail(client, id, String(b.projectId ?? "")); if (!email) return send(res, 404, { error: "Email not found" }); const open = await client.from("outreach_email_comments").select("id", { count: "exact", head: true }).eq("email_id", id).eq("status", "open"); if ((open.count ?? 0) > 0) return send(res, 409, { error: "Resolve all comments before approval" });
  try { const updated = await statusChange(client, email, "approved", "user", actor(req), "Current version approved", undefined, actorUserId(req)); const r = await client.from("outreach_emails").update({ approved_version_id: email.current_version_id, approved_by: actor(req), approved_by_user_id: actorUserId(req), approved_at: new Date().toISOString() }).eq("id", id).select("*").single(); return send(res, 200, { data: r.data ?? updated }); } catch (e) { return send(res, 409, { error: e instanceof Error ? e.message : "Approval failed" }); }
}

export async function handleEmailStudioVersions(req: IncomingMessage, res: ServerResponse, id: string) { const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const projectId = url(req).searchParams.get("projectId") ?? ""; const email = await getScopedEmail(client, id, projectId); if (!email) return send(res, 404, { error: "Email not found" }); const r = await client.from("outreach_email_versions").select("*").eq("email_id", id).order("version_number", { ascending: false }); return send(res, r.error ? 500 : 200, r.error ? { error: r.error.message } : { data: r.data }); }

type IngestTouch = { step?: unknown; subject?: unknown; body?: unknown; message?: unknown };
const LI_MSG_FIELD_ORDER = ["li_msg_1a", "li_msg_1b", "li_msg_2a", "li_msg_2b", "li_msg_3", "li_msg_4a", "li_msg_4b", "li_msg_4c", "li_msg_5a", "li_msg_5b"] as const;

export async function handleEmailStudioIngestFromN8n(req: IncomingMessage, res: ServerResponse) {
  const client = getSupabase();
  if (!client) return send(res, 500, { error: "Supabase not configured" });
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const b = await body(req);
  const projectId = str(b.projectId);
  const contactId = str(b.contactId);
  const batchName = str(b.batchName) || str(b.launchId);
  const persona = str(b.persona) || "ops";
  const sequenceMode = str(b.sequenceMode) === "cfo" ? "cfo" : "standard";
  if (!validProject(projectId) || !validProject(contactId)) return send(res, 400, { error: "projectId and contactId are required UUIDs" });
  const enabled = await client.from("project_outreach_settings").select("email_studio_enabled").eq("project_id", projectId).maybeSingle();
  if (!enabled.data?.email_studio_enabled) return send(res, 403, { error: "Email Studio is not enabled for this project" });

  const contactRow = await client.from(CONTACTS_TABLE).select("uuid, name, first_name, last_name, company_name, company_uuid, work_email").eq("project_id", projectId).eq("uuid", contactId).maybeSingle();
  if (contactRow.error) return send(res, 500, { error: contactRow.error.message });
  if (!contactRow.data) return send(res, 404, { error: "Contact not found in this project" });
  const contact = contactSummary(contactRow.data as Record<string, unknown>);

  const critique = b.critique && typeof b.critique === "object" ? (b.critique as Json) : {};
  const pass = critique.pass === true;
  const status: EmailStatus = pass ? "needs_review" : "generation_failed";
  const campaignId = str(b.campaignId) || "velvetech-proactive";
  const rows: Array<{ channel: OutreachMessageChannel; sequence_step: number; subject: string; body: string; external_target: string | null }> = [];

  for (const touch of (Array.isArray(b.emailSequence) ? b.emailSequence : []) as IngestTouch[]) {
    const step = Math.max(1, Number(touch.step ?? rows.length + 1));
    rows.push({ channel: "email", sequence_step: step, subject: str(touch.subject), body: str(touch.body), external_target: `smartlead:body_${step}` });
  }
  const liMsgFields = b.liMsgFields && typeof b.liMsgFields === "object" ? b.liMsgFields as Record<string, unknown> : null;
  if (liMsgFields) {
    LI_MSG_FIELD_ORDER.forEach((field, index) => {
      const text = str(liMsgFields[field]);
      if (text) rows.push({ channel: "linkedin_dm", sequence_step: index + 1, subject: "", body: text, external_target: `getsales:${field}` });
    });
  } else {
    for (const touch of (Array.isArray(b.linkedinSequence) ? b.linkedinSequence : []) as IngestTouch[]) {
      const step = Math.max(1, Number(touch.step ?? 1));
      rows.push({ channel: "linkedin_dm", sequence_step: step, subject: "", body: str(touch.message) || str(touch.body), external_target: `getsales:li_msg_${step}` });
    }
  }
  const inmail = b.inmailFallback && typeof b.inmailFallback === "object" ? (b.inmailFallback as Json) : null;
  if (inmail) {
    rows.push({ channel: "linkedin_inmail", sequence_step: 0, subject: str(inmail.subject), body: str(inmail.body), external_target: "getsales:inmail" });
  }
  if (rows.length === 0) return send(res, 400, { error: "No sequence rows to ingest" });

  const ingested: Json[] = [];
  for (const row of rows) {
    const validation = validateDraftForProject(projectId, row.channel, row.sequence_step, row.subject, row.body, [], undefined, undefined, sequenceMode);
    const upsert = await client.from("outreach_emails").upsert({
      project_id: projectId,
      contact_id: contact.uuid,
      contact_name: contact.name,
      company_name: contact.company_name,
      company_id: contact.company_uuid,
      campaign_id: campaignId,
      batch_name: batchName,
      persona,
      channel: row.channel,
      sequence_step: row.sequence_step,
      step_number: row.sequence_step,
      external_target: row.external_target,
      recipient_email: contact.work_email,
      current_subject: row.subject,
      current_body: row.body,
      provenance: "voitech_generated",
      status,
      research_quality: "verified",
    }, { onConflict: "project_id,contact_id,campaign_id,batch_name,channel,step_number", ignoreDuplicates: false }).select("*").single();
    if (upsert.error) return send(res, 500, { error: upsert.error.message, channel: row.channel, step: row.sequence_step });
    const email = upsert.data as Json;
    const version = await insertVersion(client, email, {
      subject: row.subject,
      body: row.body,
      author_type: "ai",
      author_id: "n8n-messaging-agent",
      model: "openai/gpt-5.5",
      annotations: [],
      validation_results: validation,
      generation_reason: "n8n_messaging_ingest",
      prompt_manifest: {
        launchId: str(b.launchId),
        sequenceMode,
        tacticsUsed: b.tacticsUsed ?? [],
        critique,
        n8nResultId: b.n8nResultId ?? null,
      },
    }, true);
    await client.from("outreach_email_status_events").insert({
      email_id: email.id,
      from_status: null,
      to_status: status,
      actor_type: "agent",
      actor_id: "n8n-messaging-agent",
      reason: pass ? "n8n messaging ingest" : "n8n messaging ingest with critique failures",
      idempotency_key: `n8n-ingest:${batchName}:${contact.uuid}:${row.channel}:${row.sequence_step}`,
    });
    ingested.push({ email, version });
  }
  return send(res, 201, { data: ingested, count: ingested.length, pass });
}

export async function handleSmartleadEmailEvent(req: IncomingMessage, res: ServerResponse) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" }); const b = await body(req); const eventId = String(b.event_id ?? b.eventId ?? ""), eventType = String(b.event_type ?? b.eventType ?? "").toLowerCase(); if (!eventId || !eventType) return send(res, 400, { error: "event_id and event_type are required" });
  const existing = await client.from("outreach_email_delivery_events").select("*").eq("provider", "smartlead").eq("provider_event_id", eventId).maybeSingle(); if (existing.data) return send(res, 200, { data: existing.data, replay: true });
  const messageId = String(b.message_id ?? b.messageId ?? ""), leadId = String(b.lead_id ?? b.leadId ?? ""), campaignId = String(b.campaign_id ?? b.campaignId ?? ""), recipient = String(b.recipient_email ?? b.email ?? "").trim().toLowerCase(), step = Number(b.sequence_step ?? b.sequenceNumber ?? 0);
  let candidates: Json[] = []; if (messageId) { const r = await client.from("outreach_emails").select("*").eq("smartlead_message_id", messageId); candidates = (r.data ?? []) as Json[]; } if (!candidates.length && leadId && campaignId) { const r = await client.from("outreach_emails").select("*").eq("smartlead_lead_id", leadId).eq("smartlead_campaign_id", campaignId); candidates = (r.data ?? []) as Json[]; } if (!candidates.length && recipient && campaignId && step > 0) { const r = await client.from("outreach_emails").select("*").eq("recipient_email", recipient).eq("smartlead_campaign_id", campaignId).eq("sequence_step", step); candidates = (r.data ?? []) as Json[]; }
  const matchStatus = candidates.length === 1 ? "matched" : candidates.length > 1 ? "ambiguous" : "unmatched"; const occurred = String(b.occurred_at ?? b.timestamp ?? new Date().toISOString()); const ins = await client.from("outreach_email_delivery_events").insert({ provider: "smartlead", provider_event_id: eventId, event_type: eventType, payload: b, email_id: candidates.length === 1 ? candidates[0].id : null, match_status: matchStatus, match_reason: candidates.length === 1 ? "Unique Smartlead identifiers matched" : `${candidates.length} matching records`, occurred_at: occurred }).select("*").single(); if (ins.error) return send(res, 500, { error: ins.error.message });
  if (candidates.length === 1 && ["sent", "email_sent", "delivered"].includes(eventType)) { const email = candidates[0]; try { await statusChange(client, email, "sent", "smartlead", "smartlead", `Verified Smartlead ${eventType} event`, `smartlead:${eventId}:sent`); await client.from("outreach_emails").update({ sent_at: occurred, smartlead_message_id: messageId || email.smartlead_message_id }).eq("id", email.id); } catch (e) { return send(res, 409, { error: e instanceof Error ? e.message : "Delivery status failed", event: ins.data }); } }
  return send(res, 202, { data: ins.data });
}
