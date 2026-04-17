import { createHash } from "node:crypto";
import { generateOpenRouterMessage } from "./openrouter.js";

export type RawPresetSettings = Record<string, unknown>;

export type NormalizedPromptStrategy = {
  objective: string;
  hardConstraints: {
    questionCountMax: number;
    paragraphs: number;
    sentences: number;
  };
  styleProfile: {
    toneProfile: string;
    readingLevel: string;
    lengthProfile: string;
    methodology: string;
    focus: string;
    emojiPolicy: string;
  };
  ctaPolicy: {
    ctaType: string;
    pressure: string;
  };
  contextPolicy: {
    mentionBlocks: string[];
    prioritizeRecentConversation: boolean;
  };
  antiHallucinationPolicy: {
    groundedOnly: boolean;
    omitMissingClaims: boolean;
  };
  precedence: string[];
  systemPromptCompact: string;
};

export function normalizationHash(rawSettings: RawPresetSettings): string {
  const json = JSON.stringify(rawSettings, Object.keys(rawSettings).sort());
  return createHash("sha256").update(json).digest("hex");
}

function asStr(v: unknown, fallback: string): string {
  if (typeof v !== "string" || !v.trim()) return fallback;
  return v.trim();
}

function asInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.min(max, Math.max(min, n));
}

function asMentionBlocks(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function fallbackStrategy(raw: RawPresetSettings): NormalizedPromptStrategy {
  const format = (typeof raw.format === "object" && raw.format != null
    ? (raw.format as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const questionCountMax = asInt(raw.questionCountMax, 1, 0, 2);
  const paragraphs = asInt(format.paragraphs, 1, 1, 6);
  const sentences = asInt(format.sentences, 3, 1, 12);
  const toneProfile = asStr(raw.tonePreset, asStr(raw.tone, "casual"));
  const readingLevel = asStr(raw.readingLevelPreset, asStr(raw.readingLevel, "high_school"));
  const lengthProfile = asStr(raw.lengthPreset, "medium");
  const methodology = asStr(raw.methodology, "pas");
  const focus = asStr(raw.focus, "pain");
  const ctaType = asStr(raw.ctaType, "initiate_conversation");
  const pressure = asStr(raw.ctaStyle, "soft");
  const mentionBlocks = asMentionBlocks(raw.mentionBlocks);
  const emojiPolicy = asStr(raw.emojiPolicy, "none");
  const objective = `${asStr(raw.goal, "follow_up")}/${ctaType}/${pressure}`;
  const systemPromptCompact =
    `YOU ARE OUTBOUND GTM MESSAGE MANAGER for generating high-converting outbound messages. ` +
    `Primary objective: maximize probability of reply with factual, relevant personalization. ` +
    `Strategy: objective=${objective}; tone=${toneProfile}; readingLevel=${readingLevel}; length=${lengthProfile}; methodology=${methodology}; focus=${focus}. ` +
    `Hard constraints: questions<=${questionCountMax}; paragraphs=${paragraphs}; sentences~${sentences}. ` +
    `Never invent facts. Omit unsupported claims.`;
  return {
    objective,
    hardConstraints: { questionCountMax, paragraphs, sentences },
    styleProfile: {
      toneProfile,
      readingLevel,
      lengthProfile,
      methodology,
      focus,
      emojiPolicy,
    },
    ctaPolicy: { ctaType, pressure },
    contextPolicy: {
      mentionBlocks,
      prioritizeRecentConversation: true,
    },
    antiHallucinationPolicy: {
      groundedOnly: true,
      omitMissingClaims: true,
    },
    precedence: [
      "factual_grounding",
      "hard_constraints",
      "additional_instructions",
      "style_examples",
      "soft_tone_preferences",
    ],
    systemPromptCompact,
  };
}

function parseJsonBlock(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const a = trimmed.indexOf("{");
    const b = trimmed.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try {
      return JSON.parse(trimmed.slice(a, b + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export async function normalizePresetWithLlm(params: {
  rawSettings: RawPresetSettings;
  model?: string;
}): Promise<{ strategy: NormalizedPromptStrategy; model: string; error: string | null }> {
  const fallback = fallbackStrategy(params.rawSettings);
  const model = params.model?.trim() || process.env.OPENROUTER_PRESET_NORMALIZER_MODEL || "openai/gpt-4o-mini";
  const systemPrompt =
    "You normalize prompt preset settings into a compact canonical strategy for outbound LinkedIn message generation. " +
    "Return valid JSON only. No markdown.";
  const userPrompt = [
    "Normalize this preset JSON into schema:",
    "{",
    '  "objective": string,',
    '  "hardConstraints": { "questionCountMax": number, "paragraphs": number, "sentences": number },',
    '  "styleProfile": { "toneProfile": string, "readingLevel": string, "lengthProfile": string, "methodology": string, "focus": string, "emojiPolicy": string },',
    '  "ctaPolicy": { "ctaType": string, "pressure": string },',
    '  "contextPolicy": { "mentionBlocks": string[], "prioritizeRecentConversation": boolean },',
    '  "antiHallucinationPolicy": { "groundedOnly": boolean, "omitMissingClaims": boolean },',
    '  "precedence": string[],',
    '  "systemPromptCompact": string',
    "}",
    "Preserve intent but remove redundant fields.",
    "Input:",
    JSON.stringify(params.rawSettings),
  ].join("\n");
  const llm = await generateOpenRouterMessage({
    model,
    systemPrompt,
    userPrompt,
    temperature: 0,
  });
  if (llm.error || !llm.data) {
    return { strategy: fallback, model, error: llm.error ?? "normalization failed" };
  }
  const parsed = parseJsonBlock(llm.data.text);
  if (!parsed) return { strategy: fallback, model: llm.data.model, error: "normalizer returned invalid JSON" };
  const merged = {
    ...fallback,
    ...parsed,
    hardConstraints: {
      ...fallback.hardConstraints,
      ...(typeof parsed.hardConstraints === "object" && parsed.hardConstraints != null
        ? (parsed.hardConstraints as Record<string, unknown>)
        : {}),
    },
    styleProfile: {
      ...fallback.styleProfile,
      ...(typeof parsed.styleProfile === "object" && parsed.styleProfile != null
        ? (parsed.styleProfile as Record<string, unknown>)
        : {}),
    },
    ctaPolicy: {
      ...fallback.ctaPolicy,
      ...(typeof parsed.ctaPolicy === "object" && parsed.ctaPolicy != null
        ? (parsed.ctaPolicy as Record<string, unknown>)
        : {}),
    },
    contextPolicy: {
      ...fallback.contextPolicy,
      ...(typeof parsed.contextPolicy === "object" && parsed.contextPolicy != null
        ? (parsed.contextPolicy as Record<string, unknown>)
        : {}),
    },
    antiHallucinationPolicy: {
      ...fallback.antiHallucinationPolicy,
      ...(typeof parsed.antiHallucinationPolicy === "object" && parsed.antiHallucinationPolicy != null
        ? (parsed.antiHallucinationPolicy as Record<string, unknown>)
        : {}),
    },
  } as NormalizedPromptStrategy;
  if (!merged.systemPromptCompact || merged.systemPromptCompact.trim().length < 80) {
    return { strategy: fallback, model: llm.data.model, error: "normalizer returned weak system prompt" };
  }
  return { strategy: merged, model: llm.data.model, error: null };
}
