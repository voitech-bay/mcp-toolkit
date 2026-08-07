import type { WelloreChannel } from "./types.js";

export type WelloreValidationResult = {
  code: string;
  severity: "warning" | "error";
  message: string;
};

const WORD_CAP_BY_STEP: Record<number, number> = { 1: 69, 2: 60, 3: 50 };
const BANNED_FILLER = ["split", "cleanly", "quietly", "the call is", "useful talk", "intro works"];
const BANNED_ABSTRACTIONS = ["map", "land", "stretch", "bandwidth", "creative bar", "keep landing", "modular handoff", "combat fantasy"];
const AAA_NAMES = ["Tencent", "Activision", "Blizzard", "THQ Nordic", "G5"];

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
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

export function validateWelloreDraft(
  channel: WelloreChannel,
  subject: string | null | undefined,
  body: string,
  opts: { sequenceStep?: number | null } = {},
): WelloreValidationResult[] {
  const results: WelloreValidationResult[] = [];
  const step = opts.sequenceStep ?? 1;
  const words = wordCount(body);
  const cap = WORD_CAP_BY_STEP[step] ?? 60;

  if (words > cap) results.push({ code: "word_count", severity: "error", message: `E${step} has ${words} words; cap is ${cap}.` });

  const greeting = checkGreeting(body, step);
  if (greeting) results.push(greeting);

  if (/[a-zA-Z]-[a-zA-Z]/.test(`${subject ?? ""} ${body}`)) results.push({ code: "hyphen_joined_words", severity: "error", message: "Contains hyphen joined words." });
  if (/[–—]/.test(`${subject ?? ""} ${body}`)) results.push({ code: "dash", severity: "error", message: "Contains an em dash or en dash." });
  if (/\babout\s+\d/i.test(body)) results.push({ code: "about_number", severity: "error", message: 'Contains "about" immediately before a number.' });

  if (step === 1 && subject?.trim()) {
    const firstLine = (body.split(/\n|(?<=[.?!])\s/)[0] ?? "").toLowerCase();
    const title = subject.trim().toLowerCase();
    if (title.length > 2 && firstLine.includes(title)) {
      results.push({ code: "subject_restated", severity: "error", message: "E1 body opening restates the subject-line game title." });
    }
  }

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

  if (channel === "email") {
    if (!subject?.trim()) results.push({ code: "subject_required", severity: "error", message: "Email subject is required." });
  }

  return results;
}
