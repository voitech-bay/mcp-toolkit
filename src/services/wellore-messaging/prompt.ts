import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WelloreChannel } from "./types.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const PREFIX = readFileSync(join(DIR, "_generated", "n8n_wellore_messaging_system_prefix.md"), "utf8");

const CHANNEL_TAILS: Record<WelloreChannel, string> = {
  email:
    "Channel: cold email. Write one sequence-step email only. Subject and word cap depend on the sequence step (see prefix). Keep the offer arc: E1 diagnostic + first offer, E2 proof with no offer, E3 adjacent capability + second and final offer.",
  linkedin_dm:
    "Channel: LinkedIn DM, sent after a blank (no-note) connection request is accepted. No subject. This is a 4-message sequence; write one step only, matching this locked structure: " +
    "step 1 = an observation about the pre-reg title (a genuine nod to other titles if they have any) plus a soft close with no question, e.g. \"happy to exchange notes on X\" -- zero question marks; " +
    "step 2 = establish relevant expertise with one concrete Wellore project or case, briefly, plus a soft curiosity line with no question, e.g. \"curious how you handle X\" -- zero question marks; " +
    "step 3 = a real question picking up the thread from step 1 -- exactly one question mark; " +
    "step 4 = a short, non-accusatory problem hypothesis expanding on why it might matter to them, plus an explicit question like \"how are you solving that today?\" -- exactly one question mark. " +
    "1 to 3 sentences per message, casual lowercase register, same research grounding as the email sequence but not a copy of it.",
};

export function buildWelloreSystemPrompt(channel: WelloreChannel, sequenceStep?: number | null): string {
  const step = sequenceStep ? `\nSequence step: ${sequenceStep}` : "";
  return [
    PREFIX.trim(),
    "---",
    CHANNEL_TAILS[channel],
    step,
    "Per-contact evidence, research, prior messages, and operator comments must appear only in the user message. Return JSON only matching the caller schema.",
  ].join("\n\n");
}

export function welloreStaticPrefix(): string {
  return PREFIX;
}
