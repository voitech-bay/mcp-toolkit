import type { VelvetechChannel, VelvetechSequenceMode } from "./types.js";

export type VelvetechValidationResult = {
  code: string;
  severity: "warning" | "error";
  message: string;
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function hardBanResults(text: string): VelvetechValidationResult[] {
  const results: VelvetechValidationResult[] = [];
  if (/[\u2013\u2014]/.test(text)) results.push({ code: "dash", severity: "error", message: "Contains an em dash or en dash." });
  if (/[a-zA-Z]-[a-zA-Z]/.test(text)) results.push({ code: "hyphen_joined_words", severity: "error", message: "Contains hyphen joined words." });
  if (/,\s*(not|never|instead of)\s/i.test(text)) results.push({ code: "contrast_tail", severity: "error", message: "Contains trailing contrast framing." });
  if (/source of truth/i.test(text)) results.push({ code: "source_of_truth", severity: "error", message: "Uses banned phrase source of truth." });
  if (/\{\{|\bTBD\b|\[first.?name\]/i.test(text)) results.push({ code: "placeholder", severity: "error", message: "Contains an unresolved placeholder." });
  return results;
}

export function validateVelvetechDraft(
  channel: VelvetechChannel,
  subject: string | null | undefined,
  body: string,
  opts: { sequenceMode?: VelvetechSequenceMode; sequenceStep?: number | null } = {},
): VelvetechValidationResult[] {
  const results = hardBanResults(`${subject ?? ""}\n${body}`);
  const words = wordCount(body);
  if (channel === "email") {
    const cap = opts.sequenceMode === "cfo" ? 80 : 60;
    if (!subject?.trim()) results.push({ code: "subject_required", severity: "error", message: "Email subject is required." });
    if ((subject ?? "").length > 50) results.push({ code: "subject_length", severity: "error", message: "Email subject exceeds 50 characters." });
    if (words > cap) results.push({ code: "word_count", severity: "error", message: `Email has ${words} words; cap is ${cap}.` });
    if ((body.match(/\?/g) ?? []).length > 1) results.push({ code: "question_count", severity: "warning", message: "Email contains more than one question." });
  } else if (channel === "inmail") {
    if (!subject?.trim()) results.push({ code: "subject_required", severity: "error", message: "InMail subject is required." });
    if ((subject ?? "").length > 50) results.push({ code: "subject_length", severity: "error", message: "InMail subject exceeds 50 characters." });
    if (words > 100) results.push({ code: "word_count", severity: "error", message: `InMail has ${words} words; hard cap is 100.` });
    else if (words > 60) results.push({ code: "word_count_target", severity: "warning", message: `InMail has ${words} words; target is 60 or fewer.` });
  } else if (channel === "linkedin_dm" || channel === "reply") {
    if (subject?.trim()) results.push({ code: "subject_forbidden", severity: "error", message: "LinkedIn DM/reply should not have a subject." });
    if (words > 130) results.push({ code: "word_count", severity: "error", message: `Message has ${words} words; cap is 130.` });
    if ((body.match(/\?/g) ?? []).length > 1) results.push({ code: "question_count", severity: "warning", message: "Message contains more than one question." });
  }
  return results;
}
