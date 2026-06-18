/**
 * Feasible product + style grounding for the in-app message agent.
 *
 * Mirrored from ai-toolkit canonical sources (kept in sync manually):
 *   projects/Feasible/context/feasible-mssp-partner-email-copy.md (positioning, angles, revenue, bans)
 *   projects/Feasible/context/feasible-practitioner-approach-canonical.md (LinkedIn replies)
 *   memory: feasible-exec-email-copy, feasible-no-vm-gap-framing, getsales-feasible-senders
 *
 * The 4 MSSP angles, revenue table, and the hard copy bans are encoded so the
 * model generates on-brand, partner-appropriate copy. Sender persona is matched
 * per lead so the signature is truthful (never one hardcoded signature).
 */

export const FEASIBLE_PROJECT_ID = "94dc3b92-1cae-4360-a958-917a58063309";

export interface FeasibleSender {
  sender_profile_uuid: string;
  persona: string;
  /** First name used in the signature. */
  signature: string;
}

/** GetSales (team 11114) Feasible sender profiles. Signature MUST match the lead's sender. */
export const FEASIBLE_SENDERS: FeasibleSender[] = [
  { sender_profile_uuid: "585db700-6175-43ed-907d-5238b0997872", persona: "Paul Pashkevich", signature: "Paul" },
  { sender_profile_uuid: "64758169-0a29-4bdd-b0a8-c4dd49e0565a", persona: "Emil Lerner", signature: "Emil" },
  { sender_profile_uuid: "78c5ee6d-652e-4463-af3c-0f5d71782507", persona: "Diana Mesropyan", signature: "Diana" },
  { sender_profile_uuid: "50f1c3a7-39f0-4d7f-ae41-1e74562b4783", persona: "Julia Rach", signature: "Julia" },
  { sender_profile_uuid: "df34a709-3705-4469-a1e7-056224bd59b8", persona: "Ayush Singh", signature: "Ayush" },
];

export function senderForUuid(uuid: string): FeasibleSender | null {
  return FEASIBLE_SENDERS.find((s) => s.sender_profile_uuid === uuid) ?? null;
}

export type FeasibleChannel = "linkedin" | "inmail";
export type FeasibleAngle = "productize" | "scale" | "win_rate" | "margin" | "practitioner";

/** Conservative partner-level new-recurring-revenue line by employee count. Null if unknown. */
export function feasibleRevenueLine(employeeCount: number | null): string | null {
  if (employeeCount == null || !Number.isFinite(employeeCount) || employeeCount <= 0) return null;
  let amount: string;
  if (employeeCount < 20) amount = "$20k";
  else if (employeeCount < 40) amount = "$30k";
  else if (employeeCount < 60) amount = "$40k";
  else if (employeeCount < 100) amount = "$50k";
  else if (employeeCount < 200) amount = "$60k";
  else amount = "$70k";
  return `A partner your size adds around ${amount} a year in new recurring revenue.`;
}

const POSITIONING = `WHAT FEASIBLE IS (factual ground; do not paraphrase loosely):
Feasible is an attack-path security platform. One license covers EASM, VM, DAST and leak checks across 21 engines, chaining findings into realistic attack paths to a client's critical assets (crown jewels). For MSSP partners, Feasible runs as the engine underneath the partner's own branded service: Feasible handles scanning, correlation and reporting per client; the partner's analysts validate; the whole stack runs under the partner brand. One license replaces a stack of separate scanners plus the integration work between them. It is an IT-network and web scanning platform (EASM/VM/DAST/leaks). It is NOT an OT/ICS, CSPM/cloud-posture, AD-connector, or business-logic-DAST product; never claim those.

WHO YOU WRITE TO: leaders and practitioners at MSSPs / security service providers (founders, BD, security engineers, VM/exposure analysts). For technical practitioners, use the canonical practitioner block below.`;

const FOUR_ANGLES = `THE FOUR MSSP ANGLES (pick the one that fits the contact; only ONE per message):
1. Productize - Feasible becomes a new recurring product line the partner sells. $ revenue line ALLOWED.
4. Scale - serve more clients with the same headcount. $ revenue line ALLOWED.
2. Win rate - win more bids / higher ticket. NO $ line (only a real % proof if you truly have one).
3. Margin - lower delivery cost via consolidation. NO $ line. Frame consolidation positively: "one license for the whole scanner stack."
The single dollar figure, when used, is NEW RECURRING REVENUE the partner books. Never write margin, profit, savings, or "+ margin on top."`;

const PRACTITIONER_BLOCK = `CANONICAL PRACTITIONER BLOCK (use near-verbatim when a security practitioner asks about exploitability / CVSS vs real risk / attack-path correlation; peer-to-peer, plain English):
"Our approach is to combine data from external and internal scans, app findings and leak signals, then map how an attacker could realistically move through that environment toward critical assets. So yes, we do graph-style correlation, but we use context to decide if a path is actually meaningful: what's exposed publicly, how assets connect, how critical the target is, and whether the finding is exploitable in practice. The point is to focus on the few paths that are both realistic and high impact. We're also planning AI-driven active validation in the near future to tighten exploit proof on the paths we surface."
AI-driven active validation is roadmap / near-term, never described as shipped.`;

const HARD_BANS = `HARD STYLE RULES (every message):
- No em dashes or en dashes. Use periods or new sentences.
- No "already". No throat-clearing openers ("I wanted to reach out", "I'm reaching out because", "just following up").
- No trailing contrast: never ", not X" / "no separate X" / "instead of Y". State the positive and stop.
- No tricolons / 3-item lists in new prose.
- Advisory tone only. BANNED presumptive verbs about Feasible: changes/changes that/solves/fixes/eliminates/transforms/removes/collapses/will change. Use "Feasible could help with that part", "partners often...".
- No regional-presence claims (Feasible is not yet in the target region): reference other MSSPs without geography, or one concrete partner.
- Second-person opener: address the reader as you/your in the first sentence. Never describe their company back to them in third person, and never paste a research one-liner.
- Lead with attack paths / critical assets, never "exposure" as an umbrella category. Say "feasible paths from reachability", never "validated paths".
- Spoken patterns for non-native readers; standard acronyms (EASM, VM, DAST, SOC, OT) as scannable anchors; no idioms.
- No vm_gap / competing-product framing as a selling point.`;

const CTA_SIG = `CTA + SIGNATURE:
- CTA (cold / value touches): end with the trial outcome then "Interested in an intro meeting?". For a warm reply, match the thread and keep one clear ask.
- Sign with the sender persona's first name ONLY (provided below). Never use a different name.
- A LinkedIn P.S. is only truthful if THIS sender persona actually did that LinkedIn touch with this lead; omit otherwise.`;

export interface FeasiblePromptOptions {
  channel: FeasibleChannel;
  sender: FeasibleSender;
  angle?: FeasibleAngle | null;
  revenueLine?: string | null;
}

/** Build the system prompt for the Feasible message agent. */
export function buildFeasibleSystemPrompt(opts: FeasiblePromptOptions): string {
  const channelGuide =
    opts.channel === "inmail"
        ? "FORMAT: LinkedIn InMail. Provide a short subject (under 50 chars) and a body under ~120 words. Lowercase by default except proper nouns."
        : "FORMAT: LinkedIn direct message, short (2-5 sentences), no subject. Lowercase by default except proper nouns. Conversational, like a real operator.";

  const angleLine = opts.angle
    ? `ANGLE TO USE: ${opts.angle}. ${opts.angle === "productize" || opts.angle === "scale" ? "The $ revenue line is allowed." : "Do NOT include a $ figure."}`
    : "Pick the single most fitting MSSP angle from the four; if employee count is unknown, omit any $ figure.";

  const revenue = opts.revenueLine ? `REVENUE LINE (use verbatim if the angle allows $): "${opts.revenueLine}"` : "";

  return [
    "You write Feasible partner outreach to MSSPs. Return ONLY the message (and a subject line first if asked), no preamble, no quotes around it.",
    POSITIONING,
    FOUR_ANGLES,
    PRACTITIONER_BLOCK,
    HARD_BANS,
    CTA_SIG,
    channelGuide,
    angleLine,
    revenue,
    `SENDER PERSONA: ${opts.sender.persona}. Sign as "${opts.sender.signature}".`,
  ]
    .filter((s) => s && s.trim())
    .join("\n\n");
}

/** Light validator for Feasible copy — flags the hard bans (non-fatal, surfaced to reviewer). */
export function feasibleViolations(text: string): string[] {
  const v: string[] = [];
  const lowered = text.toLowerCase();
  if (/[—–]/.test(text)) v.push("contains_em_or_en_dash");
  if (/,\s+not\s+\w/.test(lowered) || /\bno separate\b/.test(lowered) || /\binstead of\b/.test(lowered)) v.push("trailing_contrast");
  if (/\balready\b/.test(lowered)) v.push("uses_already");
  if (/\b(i wanted to reach out|i'm reaching out because|just following up)\b/.test(lowered)) v.push("throat_clearing");
  if (/\bfeasible\s+(changes|solves|fixes|eliminates|transforms|removes|collapses|will change)\b/.test(lowered)) v.push("presumptive_claim");
  if (/\bvalidated paths\b/.test(lowered)) v.push("validated_paths");
  if (/\b(margin|profit|savings)\b/.test(lowered)) v.push("money_word_not_recurring_revenue");
  return v;
}
