import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WelloreChannel } from "./types.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const PREFIX = readFileSync(join(DIR, "_generated", "n8n_wellore_messaging_system_prefix.md"), "utf8");

const CHANNEL_TAILS: Record<WelloreChannel, string> = {
  email:
    "Channel: cold email. Write one sequence-step email only. Subject and word cap depend on the sequence step (see prefix). Keep the offer arc: E1 diagnostic + first offer, E2 proof with no offer, E3 adjacent capability + second and final offer.",
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
