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

type PromptInput = {
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
  contact: Record<string, unknown>;
  company: Record<string, unknown> | null;
  messages: Array<Record<string, unknown>>;
};

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

function methodologyExample(methodology: MethodologyPreset): string {
  if (methodology === "pas") {
    return 'Example(PAS): "Saw many RevOps teams lose pipeline from slow lead routing (problem). Even 1-day delays can kill intent and CAC efficiency (agitate). We helped automate triage in CRM with minimal setup - open to a quick walkthrough?"';
  }
  if (methodology === "aida") {
    return 'Example(AIDA): "Noticed your team doubled outbound this quarter (attention). Curious how reps handle follow-up prioritization today (interest). We usually raise reply rate by tightening timing + targeting (desire). Worth a 15-min chat next week?"';
  }
  if (methodology === "bab") {
    return 'Example(BAB): "Before: reps manually chase warm leads and context gets lost. After: top-intent accounts get instant, personalized follow-up. Bridge: we can show the playbook we use with similar SaaS teams - interested?"';
  }
  return 'Example(JTBD): "If job is to revive stalled opportunities before quarter close, priority is fast signal + next-best action. We built a lightweight workflow for that exact outcome. Want the template?"';
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

function toMessageLines(messages: Array<Record<string, unknown>>): string {
  if (messages.length === 0) return "(no conversation history)";
  const recent = messages.slice(-15);
  return recent
    .map((m) => {
      const type = String(m.type ?? m.linkedin_type ?? "").toLowerCase();
      const direction = type === "outbox" ? "You" : "Contact";
      const text = asCleanText(m.text) ?? "(empty)";
      return `- ${direction}: ${text}`;
    })
    .join("\n");
}

function contactBlock(contact: Record<string, unknown>, mentionBlocks: MentionBlock[]): string {
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
  return lines.join("\n");
}

function companyBlock(company: Record<string, unknown> | null, mentionBlocks: MentionBlock[]): string {
  if (!company) return "Company info: unavailable";
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
  return lines.length > 0 ? lines.join("\n") : "Company info: unavailable";
}

export function buildGeneratedMessagePrompt(input: PromptInput): {
  systemPrompt: string;
  userPrompt: string;
  contextPayload: Record<string, unknown>;
} {
  const mentionBlocks = [...new Set(input.mentionBlocks)];
  const systemPrompt = [
    "You write outbound LinkedIn replies.",
    "Keep it natural and specific.",
    "Never invent facts not present in context.",
    `Goal: ${input.goal}.`,
    `CTA style: ${input.ctaStyle}.`,
    `Tone: ${input.tone}.`,
    `Personalization depth: ${input.personalizationDepth}.`,
    `Reading level: ${input.readingLevel}.`,
    `Reading level preset: ${input.readingLevelPreset}.`,
    `Tone preset: ${input.tonePreset}.`,
    `Length preset: ${input.lengthPreset}.`,
    `Methodology: ${input.methodology}.`,
    `Focus: ${input.focus}.`,
    `CTA type: ${input.ctaType}.`,
    `Formality: ${input.formality}.`,
    `Emoji policy: ${input.emojiPolicy}.`,
    `Use at most ${input.questionCountMax} question(s).`,
    `Output exactly ${input.format.paragraphs} paragraph(s) and about ${input.format.sentences} sentence(s) total.`,
    methodologyInstruction(input.methodology),
    methodologyExample(input.methodology),
    readingLevelPresetInstruction(input.readingLevelPreset),
    tonePresetInstruction(input.tonePreset),
    lengthPresetInstruction(input.lengthPreset),
    focusInstruction(input.focus),
    ctaTypeInstruction(input.ctaType),
    "If context is missing for a claim, omit the claim.",
    "Do not mention these instruction names in final output.",
    "Return only final message text. No labels or explanation.",
  ].join(" ");

  const sections = [
    "Conversation history:",
    mentionBlocks.includes("conversation_recap")
      ? toMessageLines(input.messages)
      : "(conversation recap disabled by user)",
    "",
    "Contact context:",
    contactBlock(input.contact, mentionBlocks),
    "",
    "Company context:",
    companyBlock(input.company, mentionBlocks),
  ];
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
      additionalInstructions: input.additionalInstructions?.trim() || null,
      contact: input.contact,
      company: input.company,
      messageCount: input.messages.length,
    },
  };
}
