import type { PlayChannel, ReengageLead } from "./types";

/** Mock pool of Velvetech-ish leads with last-reply dates. Filtered client-side by weeks threshold. */
export const MOCK_REENGAGE_LEADS: ReengageLead[] = [
  {
    id: "lead-001",
    contactName: "Sarah Chen",
    title: "VP Engineering",
    company: "Northwind Security",
    channel: "email",
    lastReplyAt: daysAgo(18),
    lastReplySnippet: "Interesting — can you send a short overview of the MSSP offering?",
    email: "sarah.chen@northwindsec.io",
  },
  {
    id: "lead-002",
    contactName: "Marcus Webb",
    title: "CTO",
    company: "Harbor Cloud",
    channel: "linkedin",
    lastReplyAt: daysAgo(22),
    lastReplySnippet: "We're evaluating partners for Q3 — open to a brief call next month.",
  },
  {
    id: "lead-003",
    contactName: "Priya Nair",
    title: "Head of Security",
    company: "Lumenate Labs",
    channel: "email",
    lastReplyAt: daysAgo(35),
    lastReplySnippet: "Not a priority this quarter, but revisit after our SOC2 audit.",
    email: "priya.nair@lumenatelabs.com",
  },
  {
    id: "lead-004",
    contactName: "James Okonkwo",
    title: "Director of IT",
    company: "Atlas Retail Group",
    channel: "email",
    lastReplyAt: daysAgo(10),
    lastReplySnippet: "Got it — looping in our procurement lead. Will follow up soon.",
    email: "j.okonkwo@atlasretail.com",
  },
  {
    id: "lead-005",
    contactName: "Elena Volkov",
    title: "CISO",
    company: "BrightPath Health",
    channel: "linkedin",
    lastReplyAt: daysAgo(45),
    lastReplySnippet: "Appreciate the note. Bandwidth is tight until mid-summer.",
  },
  {
    id: "lead-006",
    contactName: "David Park",
    title: "Founder",
    company: "Stackline AI",
    channel: "email",
    lastReplyAt: daysAgo(16),
    lastReplySnippet: "Can you share a case study with a similar-sized team?",
    email: "david@stackline.ai",
  },
  {
    id: "lead-007",
    contactName: "Amelia Torres",
    title: "VP Operations",
    company: "Cobalt Logistics",
    channel: "linkedin",
    lastReplyAt: daysAgo(60),
    lastReplySnippet: "Interesting timing — we just kicked off a vendor review.",
  },
  {
    id: "lead-008",
    contactName: "Noah Bergman",
    title: "Security Architect",
    company: "Vertex Payments",
    channel: "email",
    lastReplyAt: daysAgo(8),
    lastReplySnippet: "Thanks — I'll review with the team this week.",
    email: "noah.bergman@vertexpay.com",
  },
  {
    id: "lead-009",
    contactName: "Yuki Tanaka",
    title: "Head of Product",
    company: "Nimbus SaaS",
    channel: "email",
    lastReplyAt: daysAgo(28),
    lastReplySnippet: "Not the right buyer — try our Head of Infra, Lisa.",
    email: "yuki.tanaka@nimbussaas.com",
  },
  {
    id: "lead-010",
    contactName: "Omar Hassan",
    title: "Managing Partner",
    company: "Gulf Cyber Advisors",
    channel: "linkedin",
    lastReplyAt: daysAgo(40),
    lastReplySnippet: "Happy to intro you to two MSSPs in our network.",
  },
  {
    id: "lead-011",
    contactName: "Claire Dubois",
    title: "COO",
    company: "Meridian Fintech",
    channel: "email",
    lastReplyAt: daysAgo(14),
    lastReplySnippet: "Send pricing ranges and typical engagement length?",
    email: "claire.dubois@meridianfin.tech",
  },
  {
    id: "lead-012",
    contactName: "Ryan Mitchell",
    title: "VP Sales Engineering",
    company: "Forge Networks",
    channel: "linkedin",
    lastReplyAt: daysAgo(52),
    lastReplySnippet: "Parked for now — ping me after our Series B closes.",
  },
];

function daysAgo(days: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function daysSinceReply(lastReplyAt: string, now = new Date()): number {
  const reply = new Date(lastReplyAt);
  const ms = now.getTime() - reply.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function buildReengageList(
  weeksSinceReply: number,
  channel: PlayChannel = "any",
  now = new Date()
): ReengageLead[] {
  const minDays = Math.max(0, weeksSinceReply) * 7;
  return MOCK_REENGAGE_LEADS.filter((lead) => {
    if (channel !== "any" && lead.channel !== channel) return false;
    return daysSinceReply(lead.lastReplyAt, now) >= minDays;
  }).sort((a, b) => daysSinceReply(b.lastReplyAt, now) - daysSinceReply(a.lastReplyAt, now));
}
