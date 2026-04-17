export type GenerationTone =
  | "professional"
  | "friendly"
  | "confident"
  | "consultative"
  | "direct";

export type GenerationGoal =
  | "book_call"
  | "ask_question"
  | "reengage"
  | "follow_up"
  | "close_loop";

export type GenerationCtaStyle = "soft" | "medium" | "hard" | "no_cta";
export type PersonalizationDepth = "low" | "medium" | "high";
export type ReadingLevel = "simple" | "expert";
export type FormalityLevel = "casual" | "formal";
export type EmojiPolicy = "none" | "light" | "allowed";
export type ReadingLevelPreset = "eighth_grade" | "high_school" | "college" | "professional";
export type TonePreset = "casual" | "neutral" | "formal";
export type LengthPreset = "extra_short" | "short" | "medium" | "long" | "extra_long";
export type MethodologyPreset = "pas" | "aida" | "bab" | "jtbd";
export type FocusPreset = "pain" | "neutral" | "benefits";
export type CtaType =
  | "initiate_conversation"
  | "schedule_meeting"
  | "request_introduction"
  | "ask_for_feedback"
  | "find_time_to_connect"
  | "politely_disengage"
  | "smart_cta"
  | "custom";

export type MentionBlock =
  | "contact_experience"
  | "contact_posts"
  | "contact_headline"
  | "company_about"
  | "company_industry"
  | "conversation_recap";

export interface GenerationFormat {
  sentences: number;
  paragraphs: number;
}

export type PromptInput = {
  tone: GenerationTone;
  goal: GenerationGoal;
  ctaStyle: GenerationCtaStyle;
  personalizationDepth: PersonalizationDepth;
  readingLevel: ReadingLevel;
  formality: FormalityLevel;
  emojiPolicy: EmojiPolicy;
  questionCountMax: 0 | 1 | 2;
  readingLevelPreset: ReadingLevelPreset;
  tonePreset: TonePreset;
  lengthPreset: LengthPreset;
  methodology: MethodologyPreset;
  focus: FocusPreset;
  ctaType: CtaType;
  format: GenerationFormat;
  mentionBlocks: MentionBlock[];
  additionalInstructions?: string;
  messageExamples?: string[];
  contact: Record<string, unknown>;
  company: Record<string, unknown> | null;
  messages: Array<Record<string, unknown>>;
};

export interface GeneratedMessageQuality {
  questionCount: number;
  maxQuestionsOk: boolean;
  paragraphCount: number;
  paragraphCountOk: boolean;
  hasSpecificPersonalization: boolean;
  warnings: string[];
}

function methodologyInstruction(methodology: MethodologyPreset): string {
  if (methodology === "pas") {
    return "Methodology=PAS (Problem-Agitate-Solution): 1) state concrete problem from context, 2) agitate business impact briefly, 3) propose practical path to improvement, 4) close with low-friction CTA.";
  }
  if (methodology === "aida") {
    return "Methodology=AIDA (Attention-Interest-Desire-Action): hook in first line, add relevant signal, describe clear benefit, end with single explicit action request.";
  }
  if (methodology === "bab") {
    return "Methodology=BAB (Before-After-Bridge): describe current state, show improved future state, then bridge with specific next step.";
  }
  return "Methodology=JTBD: center on job-to-be-done and desired progress; frame message around what recipient needs to accomplish, then offer concise help path.";
}

function readingLevelPresetInstruction(level: ReadingLevelPreset): string {
  if (level === "eighth_grade") {
    return "ReadingLevelPreset=8th Grade: very plain language, short words, short sentences, no jargon.";
  }
  if (level === "high_school") {
    return "ReadingLevelPreset=High School: simple business language, minimal jargon, clear direct phrasing.";
  }
  if (level === "college") {
    return "ReadingLevelPreset=College: professional but readable language, moderate domain terms allowed.";
  }
  return "ReadingLevelPreset=Professional: concise expert language, precise terms allowed, still avoid buzzword stuffing.";
}

function tonePresetInstruction(tone: TonePreset): string {
  if (tone === "casual") return "TonePreset=Casual: warm, human, low-pressure, conversational.";
  if (tone === "neutral") return "TonePreset=Neutral: balanced, factual, clear, non-pushy.";
  return "TonePreset=Formal: polished, respectful, structured business tone.";
}

function lengthPresetInstruction(length: LengthPreset): string {
  if (length === "extra_short") return "LengthPreset=Extra Short target: ~30-50 words.";
  if (length === "short") return "LengthPreset=Short target: ~50-70 words.";
  if (length === "medium") return "LengthPreset=Medium target: ~70-100 words.";
  if (length === "long") return "LengthPreset=Long target: ~100-150 words.";
  return "LengthPreset=Extra Long target: ~150-200 words.";
}

function focusInstruction(focus: FocusPreset): string {
  if (focus === "pain") {
    return "Focus=Pain: lead with specific problem/cost/risk from context; prioritize urgency and consequence.";
  }
  if (focus === "benefits") {
    return "Focus=Benefits: lead with positive outcomes, upside, and value realization.";
  }
  return "Focus=Neutral: balanced pain + value framing without emotional over-amplification.";
}

function formalityInstruction(formality: FormalityLevel): string {
  if (formality === "formal") {
    return "Formality=Formal: use complete sentences, professional sign-off style, avoid slang and contractions where it reads natural; stay respectful and business-appropriate.";
  }
  return "Formality=Casual: write like a peer on LinkedIn—natural, approachable, contractions OK; still professional, never sloppy or overly familiar.";
}

function emojiPolicyInstruction(policy: EmojiPolicy): string {
  if (policy === "none") {
    return "EmojiPolicy=None: do not use emojis or emoticons in the message.";
  }
  if (policy === "light") {
    return "EmojiPolicy=Light: at most one emoji total, only if it fits tone; prefer none; never stack or decorate every line.";
  }
  return "EmojiPolicy=Allowed: emojis optional; use sparingly for warmth; never replace substance or look unprofessional.";
}

function ctaTypeInstruction(ctaType: CtaType): string {
  if (ctaType === "initiate_conversation") {
    return "CTAType=Initiate Conversation: ask an open-ended question to continue dialogue.";
  }
  if (ctaType === "schedule_meeting") {
    return "CTAType=Schedule Meeting: ask for short call/meeting with minimal commitment language.";
  }
  if (ctaType === "request_introduction") {
    return "CTAType=Request Introduction: ask to be directed to right owner if they are not best contact.";
  }
  if (ctaType === "ask_for_feedback") {
    return "CTAType=Ask for Feedback: request brief reaction/opinion instead of meeting ask.";
  }
  if (ctaType === "find_time_to_connect") {
    return "CTAType=Find Time to Connect: ask if there is a better time/window to reconnect.";
  }
  if (ctaType === "politely_disengage") {
    return "CTAType=Politely Disengage: close thread respectfully while leaving door open for future.";
  }
  if (ctaType === "smart_cta") {
    return "CTAType=Smart CTA: choose the least-friction CTA that fits conversation stage and sentiment.";
  }
  return "CTAType=Custom: follow additionalInstructions for CTA wording and intensity.";
}

function asCleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function toMessageLines(messages: Array<Record<string, unknown>>, max = 8): string {
  if (messages.length === 0) return "(no conversation history)";
  const recent = messages.slice(-Math.max(1, max));
  return recent
    .map((m) => {
      const type = String(m.type ?? m.linkedin_type ?? "").toLowerCase();
      const direction = type === "outbox" ? "You" : "Contact";
      const text = asCleanText(m.text) ?? "(empty)";
      return `- ${direction}: ${text}`;
    })
    .join("\n");
}

function normalizeMessageExamples(examples: string[] | undefined): string[] {
  if (!Array.isArray(examples)) return [];
  return examples
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);
}

function contactBlock(contact: Record<string, unknown>, mentionBlocks: MentionBlock[]): string[] {
  const lines: string[] = [];
  const fullName =
    asCleanText(contact.name) ||
    [asCleanText(contact.first_name), asCleanText(contact.last_name)].filter(Boolean).join(" ") ||
    "Unknown";
  lines.push(`Name: ${fullName}`);
  const title = asCleanText(contact.title) || asCleanText(contact.position);
  if (title) lines.push(`Title: ${title}`);
  if (mentionBlocks.includes("contact_headline")) {
    const headline = asCleanText(contact.headline);
    if (headline) lines.push(`Headline: ${headline}`);
  }
  if (mentionBlocks.includes("contact_experience")) {
    const experience = asCleanText(contact.experience);
    if (experience) lines.push(`Experience: ${experience}`);
  }
  if (mentionBlocks.includes("contact_posts")) {
    const posts = asCleanText(contact.posts);
    if (posts) lines.push(`Latest posts: ${posts}`);
  }
  return lines;
}

function companyBlock(company: Record<string, unknown> | null, mentionBlocks: MentionBlock[]): string[] {
  if (!company) return ["Company info: unavailable"];
  const lines: string[] = [];
  const name = asCleanText(company.name);
  if (name) lines.push(`Name: ${name}`);
  const domain = asCleanText(company.domain);
  if (domain) lines.push(`Domain: ${domain}`);
  const website = asCleanText(company.website);
  if (website) lines.push(`Website: ${website}`);
  if (mentionBlocks.includes("company_industry")) {
    const industry = asCleanText(company.industry);
    if (industry) lines.push(`Industry: ${industry}`);
  }
  if (mentionBlocks.includes("company_about")) {
    const about = asCleanText(company.about);
    if (about) lines.push(`About: ${about}`);
  }
  return lines.length > 0 ? lines : ["Company info: unavailable"];
}

function gatherTopSignals(input: PromptInput, mentionBlocks: MentionBlock[]): string[] {
  const out: string[] = [];
  const last = input.messages.length > 0 ? input.messages[input.messages.length - 1] : null;
  const lastText = last ? asCleanText(last.text) : null;
  const lastType = last ? String(last.type ?? last.linkedin_type ?? "").toLowerCase() : "";
  if (lastText) {
    const who = lastType === "outbox" ? "you" : "contact";
    out.push(`Most recent message from ${who}: ${lastText}`);
  }
  const contactTitle = asCleanText(input.contact.title) || asCleanText(input.contact.position);
  if (contactTitle) out.push(`Contact role: ${contactTitle}`);
  const companyName = asCleanText(input.company?.name);
  if (companyName) out.push(`Company: ${companyName}`);
  if (mentionBlocks.includes("company_industry")) {
    const industry = asCleanText(input.company?.industry);
    if (industry) out.push(`Industry: ${industry}`);
  }
  return out.slice(0, 6);
}

function questionCount(text: string): number {
  const m = text.match(/\?/g);
  return m ? m.length : 0;
}

function paragraphCount(text: string): number {
  return text
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean).length;
}

function hasPersonalization(text: string, input: PromptInput): boolean {
  const lc = text.toLowerCase();
  const probes = [
    asCleanText(input.contact.first_name),
    asCleanText(input.contact.name),
    asCleanText(input.contact.title),
    asCleanText(input.contact.position),
    asCleanText(input.company?.name),
    asCleanText(input.company?.industry),
  ]
    .filter((x): x is string => Boolean(x))
    .map((x) => x.toLowerCase());
  return probes.some((p) => p.length >= 3 && lc.includes(p));
}

export function evaluateGeneratedMessageQuality(text: string, input: PromptInput): GeneratedMessageQuality {
  const qCount = questionCount(text);
  const pCount = paragraphCount(text);
  const maxQuestionsOk = qCount <= input.questionCountMax;
  const paragraphCountOk = pCount === input.format.paragraphs;
  const personalized = hasPersonalization(text, input);
  const warnings: string[] = [];
  if (!maxQuestionsOk) warnings.push(`questions_exceeded:${qCount}>${input.questionCountMax}`);
  if (!paragraphCountOk) warnings.push(`paragraph_mismatch:${pCount}!=${input.format.paragraphs}`);
  if (!personalized) warnings.push("weak_personalization_signal");
  return {
    questionCount: qCount,
    maxQuestionsOk,
    paragraphCount: pCount,
    paragraphCountOk,
    hasSpecificPersonalization: personalized,
    warnings,
  };
}

export function buildGeneratedMessagePrompt(input: PromptInput): {
  systemPrompt: string;
  userPrompt: string;
  contextPayload: Record<string, unknown>;
} {
  const mentionBlocks = [...new Set(input.mentionBlocks)];
  const messageExamples = normalizeMessageExamples(input.messageExamples);
  const hasMessageExamples = messageExamples.length > 0;
  const topSignals = gatherTopSignals(input, mentionBlocks);
  const objective = `${input.goal}/${input.ctaType}/${input.ctaStyle}`;
  const systemPrompt = [
    "YOU ARE OUTBOUND GTM MESSAGE MANAGER for generating high-converting outbound messages.",
    "You write high-converting LinkedIn reply drafts.",
    "Primary objective: maximize likelihood of a positive reply while staying factual and specific.",
    "Instruction precedence (highest to lowest): factual grounding > hard format constraints > additional instructions > style examples > tone preferences.",
    "Never invent facts not present in context.",
    `Strategy: objective=${objective}; toneProfile=${input.tonePreset}; readingLevel=${input.readingLevelPreset}; length=${input.lengthPreset}.`,
    `Hard constraints: questions<=${input.questionCountMax}; paragraphs=${input.format.paragraphs}; sentences~${input.format.sentences}.`,
    methodologyInstruction(input.methodology),
    readingLevelPresetInstruction(input.readingLevelPreset),
    tonePresetInstruction(input.tonePreset),
    lengthPresetInstruction(input.lengthPreset),
    focusInstruction(input.focus),
    ctaTypeInstruction(input.ctaType),
    formalityInstruction(input.formality),
    emojiPolicyInstruction(input.emojiPolicy),
    ...(hasMessageExamples ? ["Use message examples to match rhythm and wording style, but do not copy lines verbatim."] : []),
    "If context missing for claim, omit claim.",
    "Return final message text only.",
  ].join(" ");

  const sections: string[] = [];
  sections.push("Top signals (highest relevance):");
  if (topSignals.length > 0) sections.push(...topSignals.map((x) => `- ${x}`));
  else sections.push("- (none)");
  sections.push("");
  sections.push("Conversation recap:");
  sections.push(
    mentionBlocks.includes("conversation_recap") ? toMessageLines(input.messages, 8) : "(conversation recap disabled)"
  );
  sections.push("");
  sections.push("Contact context:");
  sections.push(...contactBlock(input.contact, mentionBlocks).map((x) => `- ${x}`));
  sections.push("");
  sections.push("Company context:");
  sections.push(...companyBlock(input.company, mentionBlocks).map((x) => `- ${x}`));
  if (hasMessageExamples) {
    sections.push("", "Message examples:", ...messageExamples.map((x) => `- ${x}`));
  }
  if (input.additionalInstructions?.trim()) {
    sections.push("", `Additional instructions: ${input.additionalInstructions.trim()}`);
  }

  return {
    systemPrompt,
    userPrompt: sections.join("\n"),
    contextPayload: {
      tone: input.tone,
      goal: input.goal,
      ctaStyle: input.ctaStyle,
      personalizationDepth: input.personalizationDepth,
      readingLevel: input.readingLevel,
      readingLevelPreset: input.readingLevelPreset,
      tonePreset: input.tonePreset,
      lengthPreset: input.lengthPreset,
      methodology: input.methodology,
      focus: input.focus,
      ctaType: input.ctaType,
      formality: input.formality,
      emojiPolicy: input.emojiPolicy,
      questionCountMax: input.questionCountMax,
      format: input.format,
      mentionBlocks,
      messageExamples,
      topSignals,
      additionalInstructions: input.additionalInstructions?.trim() || null,
      contact: input.contact,
      company: input.company,
      messageCount: input.messages.length,
    },
  };
}
