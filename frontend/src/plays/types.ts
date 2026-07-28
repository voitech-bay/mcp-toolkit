export type PlayStatus = "ready" | "coming_soon";

export type PlayChannel = "email" | "linkedin" | "any";

export type PlayDefinition = {
  id: string;
  title: string;
  description: string;
  status: PlayStatus;
  /** Short hint for where results will surface later */
  resultsHint: string;
  defaultParams?: Record<string, number | string>;
};

export type ReengageLead = {
  id: string;
  contactName: string;
  title: string;
  company: string;
  channel: "email" | "linkedin";
  lastReplyAt: string; // ISO date
  lastReplySnippet: string;
  email?: string;
};

export type MockPlayRunResult = {
  selectedCount: number;
  weeksSinceReply: number;
  channel: PlayChannel;
  prompt: string;
  draftIds: string[];
  ranAt: string;
};
