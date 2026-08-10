/**
 * Per-project messaging registry: system prompt, validator, and sequence workflow
 * key for each project with a locked messaging voice. Velvetech is the first
 * entry and wraps the existing velvetech-messaging module unchanged, so its
 * behavior is byte-identical to before this registry existed. Adding a project
 * (e.g. Wellore) means adding an entry here, not branching on project id at
 * each call site.
 */
import type { VelvetechChannel, VelvetechSequenceMode } from "./velvetech-messaging/types.js";
import { VELVETECH_PROJECT_ID } from "./velvetech-messaging/types.js";
import { buildVelvetechSystemPrompt } from "./velvetech-messaging/prompt.js";
import { validateVelvetechDraft } from "./velvetech-messaging/validate.js";
import { WELLORE_PROJECT_ID } from "./wellore-messaging/types.js";
import { buildWelloreSystemPrompt } from "./wellore-messaging/prompt.js";
import { validateWelloreDraft } from "./wellore-messaging/validate.js";

export type RegistryChannel = "email" | "linkedin_dm" | "inmail" | "reply";

export type RegistryValidationResult = {
  code: string;
  severity: "warning" | "error";
  message: string;
};

export interface MessagingRegistryEntry {
  /** Canonical project id (lowercase compared). */
  projectId: string;
  /** OpenRouter model slug used when project_outreach_settings.default_model is unset. */
  defaultModel: string;
  /** Key registered in n8n-trigger.ts WORKFLOW_REGISTRY for Sequence Studio's Generate button. */
  sequenceWorkflowKey: string;
  /** external_target prefix stamped on ingested email rows (e.g. "smartlead" -> "smartlead:body_1"). */
  emailPushTarget: string;
  /** Channels this project's messaging module has locked rules for. */
  channels: readonly RegistryChannel[];
  /** Returns null when the channel is not covered by this project's locked voice (caller should fall back to the generic prompt). */
  buildSystemPrompt(channel: RegistryChannel, opts: { sequenceStep?: number | null; persona?: string | null; sequenceMode?: string | null }): string | null;
  /** Returns [] when the channel is not covered by this project's locked voice. */
  validateDraft(channel: RegistryChannel, subject: string | null | undefined, body: string, opts: { sequenceStep?: number | null; sequenceMode?: string | null }): RegistryValidationResult[];
}

const velvetechEntry: MessagingRegistryEntry = {
  projectId: VELVETECH_PROJECT_ID,
  defaultModel: "openai/gpt-5.5",
  sequenceWorkflowKey: "velvetech_messaging",
  emailPushTarget: "smartlead",
  channels: ["email", "linkedin_dm", "inmail", "reply"],
  buildSystemPrompt: (channel, opts) =>
    buildVelvetechSystemPrompt(
      channel as VelvetechChannel,
      opts.sequenceStep,
      opts.persona,
      (opts.sequenceMode as VelvetechSequenceMode | undefined) ?? "standard",
    ),
  validateDraft: (channel, subject, body, opts) =>
    validateVelvetechDraft(channel as VelvetechChannel, subject, body, {
      sequenceMode: (opts.sequenceMode as VelvetechSequenceMode | undefined) ?? "standard",
      sequenceStep: opts.sequenceStep,
    }).map((r) => ({ code: `velvetech_${r.code}`, severity: r.severity, message: r.message })),
};

const welloreEntry: MessagingRegistryEntry = {
  projectId: WELLORE_PROJECT_ID,
  defaultModel: "openai/gpt-5.6-terra",
  sequenceWorkflowKey: "wellore_messaging",
  emailPushTarget: "instantly",
  channels: ["email", "linkedin_dm"],
  buildSystemPrompt: (channel, opts) =>
    channel === "email" || channel === "linkedin_dm" ? buildWelloreSystemPrompt(channel, opts.sequenceStep) : null,
  validateDraft: (channel, subject, body, opts) =>
    channel === "email" || channel === "linkedin_dm"
      ? validateWelloreDraft(channel, subject, body, { sequenceStep: opts.sequenceStep }).map((r) => ({ code: `wellore_${r.code}`, severity: r.severity, message: r.message }))
      : [],
};

/** Velvetech first, so it is always found first on any lookup that iterates rather than maps. */
export const MESSAGING_REGISTRY: MessagingRegistryEntry[] = [velvetechEntry, welloreEntry];

export function getMessagingEntry(projectId: unknown): MessagingRegistryEntry | null {
  if (typeof projectId !== "string" || !projectId) return null;
  const lower = projectId.toLowerCase();
  return MESSAGING_REGISTRY.find((e) => e.projectId.toLowerCase() === lower) ?? null;
}
