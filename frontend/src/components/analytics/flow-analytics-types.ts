/** Shared types for flow / hypothesis analytics dashboards and matrices. */

export interface FlowFunnelRow {
  flowUuid: string;
  flowName: string;
  messagesSent: number;
  connectionSent: number;
  connectionAccepted: number;
  inbox: number;
  positiveReplies: number;
  acceptedRatePct?: number | null;
  inboxRatePct?: number | null;
  positiveRatePct?: number | null;
  connectionRequestRatePct?: number | null;
  linkedContactsCount?: number;
  linkedFlowsCount?: number;
}

export interface FlowFunnelProjectTotalsPayload {
  messagesSent: number;
  connectionSent: number;
  connectionAccepted: number;
  inbox: number;
  positiveReplies: number;
  connectionRequestRatePct: number | null;
  acceptedRatePct: number | null;
  inboxRatePct: number | null;
  positiveRatePct: number | null;
}

export interface FlowFunnelComparisonPayload {
  previousDateFrom: string;
  previousDateTo: string;
  totals: FlowFunnelProjectTotalsPayload;
}

export interface DailyMetricPoint {
  date: string;
  messagesSent: number;
  connectionSent: number;
  connectionAccepted: number;
  inbox: number;
  positiveReplies: number;
}

export interface DailyWowRow {
  weekStart: string;
  connectionSent: number;
  connectionAccepted: number;
  inbox: number;
  positiveReplies: number;
  prevWeekSent: number | null;
  sentWowPct: number | null;
}
