import { z } from "zod";
import { isVelvetechProjectId } from "./velvetech-messaging/types.js";
import { validateVelvetechDraft } from "./velvetech-messaging/validate.js";

export const EMAIL_STATUSES = [
  "research_ready", "ai_draft_made", "needs_review", "comments_made", "regenerated",
  "final_check", "approved", "sent", "research_missing", "generation_failed",
  "changes_requested", "rejected", "sending_failed",
] as const;
export type EmailStatus = typeof EMAIL_STATUSES[number];

export const EmailAnnotationSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  purpose: z.string().min(1),
  research_point_ids: z.array(z.string()),
  instruction_ids: z.array(z.string()),
  explanation: z.string().min(1),
  classification: z.enum(["verified", "product_truth", "instruction", "inference"]),
  confidence: z.enum(["high", "medium", "low"]),
  warnings: z.array(z.string()).default([]),
});

export const EmailDraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  annotations: z.array(EmailAnnotationSchema),
  feedback_resolutions: z.array(z.object({
    comment_id: z.string(),
    outcome: z.enum(["addressed", "not_followed", "not_mapped"]),
    explanation: z.string().min(1),
  })).default([]),
});

const transitions: Record<EmailStatus, readonly EmailStatus[]> = {
  research_ready: ["ai_draft_made", "research_missing", "generation_failed"],
  ai_draft_made: ["needs_review", "comments_made", "rejected"],
  needs_review: ["comments_made", "final_check", "changes_requested", "rejected"],
  comments_made: ["regenerated", "changes_requested", "rejected"],
  regenerated: ["needs_review", "comments_made", "final_check", "rejected"],
  final_check: ["approved", "needs_review", "comments_made", "changes_requested", "rejected"],
  approved: ["sent", "needs_review", "comments_made", "sending_failed"],
  sent: [],
  research_missing: ["research_ready", "ai_draft_made", "generation_failed", "rejected"],
  generation_failed: ["research_ready", "ai_draft_made", "rejected"],
  changes_requested: ["regenerated", "needs_review", "rejected"],
  rejected: ["research_ready"],
  sending_failed: ["approved", "sent", "needs_review"],
};

export function canTransition(from: EmailStatus, to: EmailStatus, actorType = "user"): boolean {
  if (from === to) return true;
  if (to === "sent" && actorType !== "smartlead") return false;
  return transitions[from].includes(to);
}

export function validateDraft(subject: string, body: string, annotations: Array<Omit<z.infer<typeof EmailAnnotationSchema>, "warnings"> & { warnings?: string[] }>, allowedResearchIds?: Set<string>, allowedInstructionIds?: Set<string>) {
  const results: Array<{ code: string; severity: "warning" | "error"; message: string }> = [];
  const combined = `${subject}\n${body}`;
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  if (words > 200) results.push({ code: "word_count", severity: "warning", message: `Email has ${words} words; target is 200 or fewer.` });
  if ((body.match(/\?/g) ?? []).length > 1) results.push({ code: "question_count", severity: "warning", message: "Email contains more than one question." });
  if (/—/.test(combined)) results.push({ code: "em_dash", severity: "warning", message: "Email contains an em dash." });
  if (/hope this (email|message) finds|reaching out|wanted to introduce myself/i.test(combined)) results.push({ code: "banned_phrase", severity: "warning", message: "Email contains a discouraged cold-outreach phrase." });
  if (/\{\{|\bTBD\b|\[first.?name\]/i.test(combined)) results.push({ code: "placeholder", severity: "error", message: "Email contains an unresolved placeholder." });
  for (const a of annotations) {
    if (a.end <= a.start || body.slice(a.start, a.end) !== a.text) results.push({ code: "annotation_range", severity: "error", message: `Annotation ${a.id} does not match the email text.` });
    if (a.classification === "verified" && a.research_point_ids.length === 0) results.push({ code: "unsupported_fact", severity: "error", message: `Verified annotation ${a.id} has no research reference.` });
    if (allowedResearchIds && a.research_point_ids.some((id) => !allowedResearchIds.has(id))) results.push({ code: "unknown_research", severity: "error", message: `Annotation ${a.id} references unknown research.` });
    if (allowedInstructionIds && a.instruction_ids.some((id) => !allowedInstructionIds.has(id))) results.push({ code: "unknown_instruction", severity: "error", message: `Annotation ${a.id} references an unknown instruction.` });
  }
  return results;
}

export function validateDraftForProject(
  projectId: string,
  channel: string,
  sequenceStep: number | null,
  subject: string,
  body: string,
  annotations: Array<Omit<z.infer<typeof EmailAnnotationSchema>, "warnings"> & { warnings?: string[] }>,
  allowedResearchIds?: Set<string>,
  allowedInstructionIds?: Set<string>,
  sequenceMode: import("./velvetech-messaging/types.js").VelvetechSequenceMode = "standard",
) {
  const generic = validateDraft(subject, body, annotations, allowedResearchIds, allowedInstructionIds);
  if (!isVelvetechProjectId(projectId)) return generic;
  const mappedChannel = channel === "linkedin_dm" ? "linkedin_dm" : channel === "inmail" ? "inmail" : "email";
  return [
    ...generic,
    ...validateVelvetechDraft(mappedChannel, subject, body, { sequenceStep, sequenceMode }).map((r) => ({
      code: `velvetech_${r.code}`,
      severity: r.severity,
      message: r.message,
    })),
  ];
}

export function normalizeAnnotationRanges<T extends { text: string; start: number; end: number }>(body: string, annotations: T[]): T[] {
  let cursor = 0;
  return annotations.map((annotation) => {
    if (body.slice(annotation.start, annotation.end) === annotation.text) { cursor = annotation.end; return annotation; }
    let start = body.indexOf(annotation.text, cursor);
    if (start < 0) start = body.indexOf(annotation.text);
    if (start < 0) return annotation;
    cursor = start + annotation.text.length;
    return { ...annotation, start, end: cursor };
  });
}

export function reanchorQuote(body: string, quote: string, oldStart: number, before = "", after = "") {
  if (!quote) return null;
  const exact: number[] = [];
  let from = 0;
  while (from <= body.length) {
    const i = body.indexOf(quote, from);
    if (i < 0) break;
    exact.push(i); from = i + 1;
  }
  if (exact.length === 1) return { start: exact[0], end: exact[0] + quote.length };
  if (exact.length > 1) {
    const scored = exact.map((start) => {
      let score = -Math.abs(start - oldStart);
      if (before && body.slice(Math.max(0, start - before.length), start) === before) score += 10000;
      if (after && body.slice(start + quote.length, start + quote.length + after.length) === after) score += 10000;
      return { start, score };
    }).sort((a, b) => b.score - a.score);
    return { start: scored[0].start, end: scored[0].start + quote.length };
  }
  return null;
}

export function stableResearchPoints(research: Record<string, unknown>) {
  const structured = (research.structured_research ?? research) as Record<string, unknown>;
  const verified = Array.isArray(structured.verified_signals) ? structured.verified_signals : [];
  const inferred = Array.isArray(structured.inferred_priorities) ? structured.inferred_priorities : [];
  return [
    ...verified.map((x, i) => ({ id: `verified-${i + 1}`, kind: "verified", ...(typeof x === "object" && x ? x : { statement: String(x) }) })),
    ...inferred.map((x, i) => ({ id: `inferred-${i + 1}`, kind: "inference", ...(typeof x === "object" && x ? x : { statement: String(x) }) })),
  ];
}
