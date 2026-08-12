import type { WelloreChannel } from "./types.js";

export type WelloreValidationResult = {
  code: string;
  severity: "warning" | "error";
  message: string;
};

const EMAIL_WORD_CAP_BY_STEP: Record<number, number> = { 1: 69, 2: 60, 3: 50 };
/** Backstop only -- the primary LinkedIn length constraint is the 3-sentence cap below. */
const LINKEDIN_WORD_CAP = 40;
const BANNED_FILLER = ["split", "cleanly", "quietly", "the call is", "useful talk", "intro works"];
const BANNED_ABSTRACTIONS = [
  "map",
  "land",
  "stretch",
  "bandwidth",
  "creative bar",
  "keep landing",
  "modular handoff",
  "combat fantasy",
  // 2026-08-12 messaging pack — SaaS / AI-slop nouns
  "slate",
  "capacity",
  "cadence",
  "lane",
  "lanes",
  "overflow",
  "production queue",
  "own the calendar",
  "still needs",
  "happy for an intro",
  "worth 20 minutes",
];
const AAA_NAMES = ["Tencent", "Activision", "Blizzard", "THQ Nordic", "G5"];

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sentenceCount(text: string): number {
  return text.split(/[.?!]+/).map((s) => s.trim()).filter(Boolean).length;
}

function questionMarkCount(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

function checkGreeting(body: string, step: number): WelloreValidationResult | null {
  const trimmed = body.trimStart();
  if (step === 1) {
    if (!/^Hi\s+\S+,/.test(trimmed)) return { code: "greeting", severity: "error", message: 'E1 must start with "Hi Name,".' };
  } else if (step === 2 || step === 3) {
    if (/^Hi\b/i.test(trimmed)) return { code: "greeting", severity: "error", message: `E${step} must not start with "Hi" — use "Name,".` };
    if (!/^\S+,/.test(trimmed)) return { code: "greeting", severity: "error", message: `E${step} must start with "Name,".` };
  }
  return null;
}

/**
 * Locked 4-message LinkedIn sequence structure (Wellore Phase 11): steps 1-2 make an
 * observation / establish expertise with a soft, question-free close; steps 3-4 close on
 * exactly one real question each. See wellore-messaging/prompt.ts's linkedin_dm tail for
 * the full per-step job description given to the model.
 */
function checkLinkedinStep(body: string, step: number): WelloreValidationResult[] {
  const results: WelloreValidationResult[] = [];
  const questions = questionMarkCount(body);
  if (step === 1 || step === 2) {
    if (questions > 0) results.push({ code: "question_not_allowed", severity: "error", message: `LinkedIn step ${step} must not ask a question (found ${questions}).` });
  } else if (step === 3 || step === 4) {
    if (questions !== 1) results.push({ code: "question_required", severity: "error", message: `LinkedIn step ${step} must ask exactly one question (found ${questions}).` });
  }
  const sentences = sentenceCount(body);
  if (sentences > 3) results.push({ code: "sentence_count", severity: "error", message: `LinkedIn step ${step} has ${sentences} sentences; cap is 3.` });
  return results;
}

export function validateWelloreDraft(
  channel: WelloreChannel,
  subject: string | null | undefined,
  body: string,
  opts: { sequenceStep?: number | null } = {},
): WelloreValidationResult[] {
  const results: WelloreValidationResult[] = [];
  const step = opts.sequenceStep ?? 1;
  const words = wordCount(body);

  if (channel === "email") {
    const cap = EMAIL_WORD_CAP_BY_STEP[step] ?? 60;
    if (words > cap) results.push({ code: "word_count", severity: "error", message: `E${step} has ${words} words; cap is ${cap}.` });
    const greeting = checkGreeting(body, step);
    if (greeting) results.push(greeting);
    if (step === 1 && subject?.trim()) {
      const firstLine = (body.split(/\n|(?<=[.?!])\s/)[0] ?? "").toLowerCase();
      const title = subject.trim().toLowerCase();
      if (title.length > 2 && firstLine.includes(title)) {
        results.push({ code: "subject_restated", severity: "error", message: "E1 body opening restates the subject-line game title." });
      }
    }
    if (!subject?.trim()) results.push({ code: "subject_required", severity: "error", message: "Email subject is required." });
  } else if (channel === "linkedin_dm") {
    if (subject?.trim()) results.push({ code: "subject_not_allowed", severity: "error", message: "LinkedIn DM must not have a subject." });
    if (words > LINKEDIN_WORD_CAP) results.push({ code: "word_count", severity: "error", message: `LinkedIn step ${step} has ${words} words; cap is ${LINKEDIN_WORD_CAP}.` });
    results.push(...checkLinkedinStep(body, step));
  }

  if (/[a-zA-Z]-[a-zA-Z]/.test(`${subject ?? ""} ${body}`)) results.push({ code: "hyphen_joined_words", severity: "error", message: "Contains hyphen joined words." });
  if (/[–—]/.test(`${subject ?? ""} ${body}`)) results.push({ code: "dash", severity: "error", message: "Contains an em dash or en dash." });
  if (/\babout\s+\d/i.test(body)) results.push({ code: "about_number", severity: "error", message: 'Contains "about" immediately before a number.' });

  const lowerBody = body.toLowerCase();
  for (const phrase of BANNED_FILLER) {
    if (lowerBody.includes(phrase)) results.push({ code: "banned_filler", severity: "warning", message: `Contains banned filler phrase "${phrase}".` });
  }
  for (const phrase of BANNED_ABSTRACTIONS) {
    if (new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "i").test(body)) {
      results.push({ code: "banned_abstraction", severity: "warning", message: `Contains banned consultant abstraction "${phrase}".` });
    }
  }
  for (const name of AAA_NAMES) {
    if (new RegExp(`\\b${name}\\b`, "i").test(body)) {
      results.push({ code: "aaa_name", severity: "warning", message: `Names "${name}" — confirm the contact's own company is itself a large studio/publisher before sending; otherwise use a portfolio case instead.` });
    }
  }

  return results;
}
