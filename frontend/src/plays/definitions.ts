import type { PlayDefinition } from "./types";

export const PLAY_DEFINITIONS: PlayDefinition[] = [
  {
    id: "re-engage-replied",
    title: "Re-engage replied leads",
    description:
      "Find leads who replied more than N weeks ago, select who to re-engage, and generate contextual follow-ups from their conversation history.",
    status: "ready",
    resultsHint: "Generated drafts will open in Email Studio and Sequence Studio.",
    defaultParams: { weeksSinceReply: 2 },
  },
  {
    id: "follow-up-finished-sequence",
    title: "Follow-up after finished sequence",
    description:
      "Target leads whose sequence finished more than a month ago and spin up a fresh follow-up sequence.",
    status: "coming_soon",
    resultsHint: "Results will surface in Sequence Studio.",
    defaultParams: { monthsSinceFinished: 1 },
  },
  {
    id: "rerun-company-research",
    title: "Re-run company research",
    description:
      "Re-run research on companies matching selected parameters (fit, industry, prior research age, and more).",
    status: "coming_soon",
    resultsHint: "Research jobs will appear in n8n results and company cards.",
  },
  {
    id: "closed-lost-reengage",
    title: "Closed Lost re-engage",
    description:
      "Re-engage opportunities marked closed-lost with a tailored outbound play once that status exists in the pipeline.",
    status: "coming_soon",
    resultsHint: "Drafts will open in Email Studio.",
  },
];

export function getPlayById(playId: string): PlayDefinition | undefined {
  return PLAY_DEFINITIONS.find((p) => p.id === playId);
}
