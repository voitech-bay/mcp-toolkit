import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { VelvetechChannel, VelvetechSequenceMode } from "./types.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const PREFIX = readFileSync(join(DIR, "_generated", "n8n_velvetech_messaging_system_prefix.md"), "utf8");

const CHANNEL_TAILS: Record<VelvetechChannel, string> = {
  email:
    "Channel: cold email. Write one sequence-step email only. Subject is 2 to 4 words and under 50 chars. Body cap is 60 words unless sequence_mode is cfo, then 80. Keep the offer arc: email 1 diagnostic, email 2 proof plus different diagnostic, email 3 future-tense offer.",
  linkedin_dm:
    "Channel: LinkedIn connection DM after acceptance. No subject. Use the connection-message register: short, natural, one idea, no pasted email paragraph. Cap 130 words.",
  inmail:
    "Channel: LinkedIn InMail fallback. Use cold inbox register, not chat register. Subject under 50 chars. Body target 40 to 60 words, hard cap 100.",
  reply:
    "Channel: reactive conversation reply. Continue the existing thread naturally. Do not restart a proactive cadence, repeat an old pitch, or create a meeting ask unless the thread warrants it. Cap 130 words.",
};

export function buildVelvetechSystemPrompt(
  channel: VelvetechChannel,
  sequenceStep?: number | null,
  personaRoute?: string | null,
  sequenceMode: VelvetechSequenceMode = "standard",
): string {
  const step = sequenceStep ? `\nSequence step: ${sequenceStep}` : "";
  const persona = personaRoute ? `\nPersona route: ${personaRoute}` : "";
  return [
    PREFIX.trim(),
    "---",
    CHANNEL_TAILS[channel],
    `Sequence mode: ${sequenceMode}`,
    step,
    persona,
    "Per-contact evidence, research, prior messages, and operator comments must appear only in the user message. Return JSON only matching the caller schema.",
  ].join("\n\n");
}

export function velvetechStaticPrefix(): string {
  return PREFIX;
}
