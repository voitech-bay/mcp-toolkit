/**
 * Conversations → Generate: rich context assembly + 3 LinkedIn reply variants.
 * Reuses Outreach Agent context/research; stays separate from Email Studio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  assembleOutreachContext,
  getOrCreateResearch,
  loadKnowledge,
  structuredCall,
  validateVariant,
  type OutreachContext,
} from "./outreach-agent.js";
import { loadPriorityAnchors } from "./pov-facts.js";
import {
  buildGeneratedMessagePrompt,
  evaluateGeneratedMessageQuality,
  type PromptInput,
  type RichReplyContext,
} from "./generated-message-prompt.js";
import {
  listCompanyContextsByCompanyId,
  listContactContextsByContactId,
} from "./supabase.js";
import { isVelvetechProjectId } from "./velvetech-messaging/types.js";
import { buildVelvetechSystemPrompt } from "./velvetech-messaging/prompt.js";
import { validateVelvetechDraft } from "./velvetech-messaging/validate.js";
import { generateOpenRouterMessage } from "./openrouter.js";

type Json = Record<string, unknown>;

const ReplyVariantsSchema = z.object({
  variants: z
    .array(z.object({ subject: z.string().nullable(), body: z.string().min(1), rationale: z.string().min(1) }))
    .length(3),
});

export type ReplyVariantResult = {
  subject: string | null;
  body: string;
  rationale: string;
  warnings: string[];
};

export type ReplyContextMeta = {
  siblingMessageCount: number;
  researchCached: boolean;
  hasCuratedCompanyNotes: boolean;
  hasCuratedContactNotes: boolean;
  priorityAnchorCount: number;
  researchPartial: boolean;
};

function isAccountSummaryNote(text: string): boolean {
  return text.includes('"kind":"account_summary"');
}

export async function loadCuratedNotes(
  client: SupabaseClient,
  contactId: string,
  companyId: string
): Promise<{ contactNotes: string[]; companyNotes: string[] }> {
  const [contactRes, companyRes, companyAlt] = await Promise.all([
    listContactContextsByContactId(client, contactId),
    listCompanyContextsByCompanyId(client, companyId),
    client
      .from("CompaniesContext")
      .select("id,rootContext,created_at")
      .eq("companyId", companyId)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);
  const contactNotes = (contactRes.data ?? [])
    .map((r) => (r.rootContext ?? "").trim())
    .filter(Boolean);
  const fromCompanyId = (companyRes.data ?? [])
    .map((r) => (r.rootContext ?? "").trim())
    .filter((t) => t && !isAccountSummaryNote(t));
  const fromCamel = ((companyAlt.data ?? []) as Array<{ rootContext?: string | null }>)
    .map((r) => (r.rootContext ?? "").trim())
    .filter((t) => t && !isAccountSummaryNote(t));
  const companyNotes = [...new Set([...fromCompanyId, ...fromCamel])];
  return { contactNotes, companyNotes };
}

export async function assembleReplyRichContext(
  client: SupabaseClient,
  args: {
    projectId: string;
    contactId: string;
    companyId: string;
    model: string;
    forceResearchRefresh?: boolean;
  }
): Promise<{
  outreach: OutreachContext;
  rich: RichReplyContext;
  contextMeta: ReplyContextMeta;
  knowledge: Json[];
}> {
  const outreach = await assembleOutreachContext(client, args.contactId);
  const { contactNotes, companyNotes } = await loadCuratedNotes(client, args.contactId, args.companyId);

  let researchSnapshot: Json | null = null;
  let researchCached = false;
  let researchPartial = false;
  try {
    const research = await getOrCreateResearch(client, {
      projectId: args.projectId,
      contactId: args.contactId,
      companyId: args.companyId,
      model: args.model,
      ttlDays: 30,
      context: outreach,
      force: Boolean(args.forceResearchRefresh),
    });
    researchSnapshot = research.snapshot;
    researchCached = research.cached;
    researchPartial = Boolean(research.snapshot.partial);
  } catch (e) {
    console.warn("[conversation-reply] research skipped:", e instanceof Error ? e.message : e);
  }

  let priorityAnchors: RichReplyContext["priorityAnchors"] = [];
  try {
    const anchors = await loadPriorityAnchors(client, {
      projectId: args.projectId,
      contactId: args.contactId,
      companyId: args.companyId,
    });
    priorityAnchors = anchors.map((a) => ({
      factId: a.factId,
      text: a.text,
      comment: a.comment ?? null,
    }));
  } catch (e) {
    console.warn("[conversation-reply] POV anchors skipped:", e instanceof Error ? e.message : e);
  }

  let knowledge: Json[] = [];
  try {
    const k = await loadKnowledge(client, args.projectId);
    knowledge = k.documents;
  } catch {
    knowledge = [];
  }

  const rich: RichReplyContext = {
    siblingCompanyMessages: outreach.company_messages as Array<Record<string, unknown>>,
    curatedContactNotes: contactNotes,
    curatedCompanyNotes: companyNotes,
    researchSnapshot,
    priorityAnchors,
    n8nContactSummaries: outreach.n8n_contact,
    n8nCompanySummaries: outreach.n8n_company,
    companySummary: outreach.company_summary,
  };

  return {
    outreach,
    rich,
    knowledge,
    contextMeta: {
      siblingMessageCount: outreach.company_messages.length,
      researchCached,
      hasCuratedCompanyNotes: companyNotes.length > 0,
      hasCuratedContactNotes: contactNotes.length > 0,
      priorityAnchorCount: priorityAnchors?.length ?? 0,
      researchPartial,
    },
  };
}

export async function generateReplyVariants(args: {
  model: string;
  projectId: string;
  contactId: string;
  promptInput: PromptInput;
  knowledge: Json[];
}): Promise<{ variants: ReplyVariantResult[]; usage: Json | null; prompt: ReturnType<typeof buildGeneratedMessagePrompt> }> {
  const prompt = buildGeneratedMessagePrompt({ ...args.promptInput, multiVariant: true });
  const velvetech = isVelvetechProjectId(args.projectId);
  const knowledgeBlock = args.knowledge
    .map((d) => `## ${d.kind}: ${d.title} (v${d.version})\n${d.content_markdown}`)
    .join("\n\n");

  const system = velvetech
    ? `${buildVelvetechSystemPrompt("reply")}\n\n${prompt.systemPrompt}\n\nWrite exactly three genuinely distinct LinkedIn reply variants. Return JSON only: {"variants":[{"subject":null,"body":string,"rationale":string}, ... exactly 3]}.`
    : `${prompt.systemPrompt}${knowledgeBlock ? `\n\nACTIVE KNOWLEDGE:\n${knowledgeBlock}` : ""}`;

  const call = await structuredCall({
    model: args.model,
    system,
    user: prompt.userPrompt,
    schema: ReplyVariantsSchema,
    trace: {
      feature: "generated-message",
      stage: "variants",
      project_id: args.projectId,
      contact_id: args.contactId,
    },
  });

  const variants = call.value.variants.map((v) => {
    const subject = null;
    const warnings = validateVariant("message", { subject, body: v.body });
    if (velvetech) {
      warnings.push(...validateVelvetechDraft("linkedin_dm", subject, v.body).map((r) => r.message));
    }
    const quality = evaluateGeneratedMessageQuality(v.body, args.promptInput);
    warnings.push(...quality.warnings);
    return { subject, body: v.body, rationale: v.rationale, warnings };
  });

  return { variants, usage: call.usage, prompt };
}

export async function refineReplyDraft(args: {
  model: string;
  projectId: string;
  baseContent: string;
  instructions: string;
  temperature?: number;
}): Promise<{ content: string; model: string }> {
  const instructions = args.instructions.trim();
  if (!instructions) throw new Error("instructions are required");
  const base = args.baseContent.trim();
  if (!base) throw new Error("baseContent is required");

  const system = isVelvetechProjectId(args.projectId)
    ? `${buildVelvetechSystemPrompt("reply")} Revise the LinkedIn reply per the operator instructions. Keep it a natural continuation of the thread. Return final message text only.`
    : "You revise LinkedIn reply drafts. Apply the operator instructions precisely. Keep factual grounding. Do not invent claims. Return final message text only.";

  const llm = await generateOpenRouterMessage({
    model: args.model,
    systemPrompt: system,
    userPrompt: `CURRENT DRAFT:\n${base}\n\nREFINE INSTRUCTIONS:\n${instructions}`,
    temperature: args.temperature ?? 0.5,
    trace: { feature: "generated-message", stage: "refine", project_id: args.projectId },
  });
  if (llm.error || !llm.data) throw new Error(llm.error ?? "Refine failed");
  const content = llm.data.text.trim();
  if (!content) throw new Error("Refine returned empty content");
  return { content, model: llm.data.model };
}
