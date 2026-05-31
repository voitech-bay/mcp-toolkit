/**
 * Pure helpers for the InMail review feature. No I/O — safe to unit-test.
 *
 *  - validateInmailCopy: port of the n8n Parse-node validator, so copy regenerated
 *    in the app is checked identically to copy generated in the pipeline.
 *  - arrangeGetSalesFields: maps an approved subject + body into the GetSales
 *    `InMails - US` flow custom fields. The three body fields are paragraph SLOTS
 *    for spacing, NOT semantic buckets: the greeting is dropped (the flow template
 *    hardcodes `Hi {{first_name}},`) and the remaining paragraphs are grouped into
 *    three length-balanced, order-preserving slots so the rendered message reads well.
 */

export type InmailKind = "inmail" | "followup";

const BANNED_PHRASES = [
  "no agencies. no tools",
  "not a tool. not a hack",
  "best-in-class",
  "leverage synergies",
  "it is important to note",
  "as sam altman said",
  "my take:",
];

/**
 * Returns a list of violation codes (empty = clean). Mirrors the n8n Parse node:
 * word cap, em/en dash, double quote, banned phrases, trailing-antithesis; plus
 * follow-up-only CRM + greeting-casing checks.
 */
export function validateInmailCopy(
  body: string,
  opts: { kind: InmailKind; subject?: string }
): string[] {
  const violations: string[] = [];
  const text = (body ?? "").trim();
  const subject = (opts.subject ?? "").trim();
  const lowered = text.toLowerCase();

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const wordCap = opts.kind === "followup" ? 75 : 140;
  if (wordCount > wordCap) violations.push(`body_too_long_${wordCount}_words`);
  if (opts.kind === "inmail" && subject.length > 50) {
    violations.push(`subject_too_long_${subject.length}_chars`);
  }

  if (/[—–]/.test(text) || /[—–]/.test(subject)) {
    violations.push("contains_em_or_en_dash");
  }
  if (text.includes('"')) violations.push("contains_double_quote");

  for (const p of BANNED_PHRASES) {
    if (lowered.includes(p)) {
      violations.push(`banned_phrase_${p.replace(/\s+/g, "_").slice(0, 30)}`);
    }
  }

  if (/,\s+not\s+\w/.test(lowered) || /\bnot just\b/.test(lowered)) {
    violations.push("contrast_not_framing");
  }

  if (opts.kind === "followup") {
    if (/\bcrm\b/.test(lowered)) violations.push("crm_mention");
    if (!/^hi\s+\w/i.test(text)) violations.push("missing_greeting");
    else if (/^hi\s/.test(text)) violations.push("lowercase_hi");
  }

  return violations;
}

export interface GetSalesInmailFields {
  /** Subject line. */
  seq_connection_hook: string;
  /** Opening paragraph slot. */
  seq_msg1_partner_angle: string;
  /** Middle paragraph slot. */
  seq_msg2a_discovery: string;
  /** Closing paragraph slot (incl. CTA / sign-off). */
  seq_msg2a_positioning: string;
}

export interface ArrangeResult {
  fields: GetSalesInmailFields;
  /** How the flow would render the message (greeting hardcoded + 3 slots). */
  assembledPreview: string;
  /** The greeting paragraph that was dropped (flow re-adds it), or null. */
  droppedGreeting: string | null;
  /** Number of content paragraphs after dropping the greeting. */
  paragraphCount: number;
  /** Non-fatal warning the UI should surface before any (later, user-run) push. */
  warning: string | null;
}

/** Split a body into trimmed, non-empty paragraphs on blank lines. */
export function splitParagraphs(body: string): string[] {
  return (body ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Heuristic: is this paragraph a greeting line like "hi Molly," / "Hi Ben,"? */
function isGreeting(p: string): boolean {
  const firstLine = p.split("\n")[0].trim();
  return (
    /^(hi|hello|hey)\b/i.test(firstLine) &&
    firstLine.length <= 40 &&
    p.split(/\s+/).filter(Boolean).length <= 4
  );
}

/**
 * Partition `paras` into exactly `groups` contiguous, order-preserving buckets,
 * minimizing the largest bucket's total character length (tie-break: smallest
 * spread). For small paragraph counts this brute-forces all cut positions.
 * If there are fewer paragraphs than groups, fills front buckets and leaves the
 * trailing buckets empty.
 */
export function balancedGroups(paras: string[], groups: number): string[][] {
  const n = paras.length;
  if (groups <= 1) return [paras];
  if (n <= groups) {
    return Array.from({ length: groups }, (_, i) => (i < n ? [paras[i]] : []));
  }
  const len = paras.map((s) => s.length);
  const prefix = [0];
  for (let i = 0; i < n; i++) prefix.push(prefix[i] + len[i]);
  const segLen = (a: number, b: number) => prefix[b] - prefix[a];

  const boundaries: number[] = new Array(groups + 1);
  boundaries[0] = 0;
  boundaries[groups] = n;
  let best: number[] | null = null;
  let bestCost = Infinity;

  const rec = (gi: number, start: number): void => {
    if (gi === groups) {
      let max = 0;
      let min = Infinity;
      for (let i = 0; i < groups; i++) {
        const L = segLen(boundaries[i], boundaries[i + 1]);
        if (L === 0) return;
        if (L > max) max = L;
        if (L < min) min = L;
      }
      const cost = max * 100000 + (max - min);
      if (cost < bestCost) {
        bestCost = cost;
        best = boundaries.slice();
      }
      return;
    }
    for (let c = start + 1; c <= n - (groups - gi); c++) {
      boundaries[gi] = c;
      rec(gi + 1, c);
    }
  };
  rec(1, 0);

  const b = best ?? [0, 1, 2, n];
  const out: string[][] = [];
  for (let i = 0; i < groups; i++) out.push(paras.slice(b[i], b[i + 1]));
  return out;
}

/**
 * Map an approved subject + body to the GetSales `InMails - US` flow custom fields.
 * Drops the greeting paragraph (the flow hardcodes `Hi {{first_name}},`) and groups
 * the rest into 3 balanced slots purely for clean paragraph spacing.
 */
export function arrangeGetSalesFields(input: { subject: string; body: string }): ArrangeResult {
  const subject = (input.subject ?? "").trim();
  let paras = splitParagraphs(input.body);
  let droppedGreeting: string | null = null;
  if (paras.length > 0 && isGreeting(paras[0])) {
    droppedGreeting = paras[0];
    paras = paras.slice(1);
  }
  const paragraphCount = paras.length;
  const groups = balancedGroups(paras, 3);
  const slot = (g: string[]) => g.join("\n\n");

  const fields: GetSalesInmailFields = {
    seq_connection_hook: subject,
    seq_msg1_partner_angle: slot(groups[0] ?? []),
    seq_msg2a_discovery: slot(groups[1] ?? []),
    seq_msg2a_positioning: slot(groups[2] ?? []),
  };

  const assembledPreview = [
    "Hi {{first_name}},",
    fields.seq_msg1_partner_angle,
    fields.seq_msg2a_discovery,
    fields.seq_msg2a_positioning,
  ]
    .filter((s) => s && s.length > 0)
    .join("\n\n");

  let warning: string | null = null;
  if (paragraphCount < 2) {
    warning = "Body has fewer than 2 content paragraphs; the slots may look sparse.";
  }
  if (!subject) {
    warning = (warning ? warning + " " : "") + "Subject (seq_connection_hook) is empty.";
  }

  return { fields, assembledPreview, droppedGreeting, paragraphCount, warning };
}

/** The GetSales custom-field names the `InMails - US` flow reads. */
export const GETSALES_INMAIL_FIELD_NAMES = [
  "seq_connection_hook",
  "seq_msg1_partner_angle",
  "seq_msg2a_discovery",
  "seq_msg2a_positioning",
] as const;
