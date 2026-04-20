type MixpanelLike = {
  track: (eventName: string, props?: Record<string, unknown>) => void;
};

function isClientFrontendRuntime(): boolean {
  const maybeWindow = globalThis as typeof globalThis & {
    __MCP_CLIENT_FRONTEND__?: unknown;
  };
  return maybeWindow.__MCP_CLIENT_FRONTEND__ === true;
}

function getMixpanel(): MixpanelLike | null {
  const maybeWindow = globalThis as typeof globalThis & {
    mixpanel?: MixpanelLike;
  };
  return maybeWindow.mixpanel ?? null;
}

export function trackAnalyticsEvent(
  eventName: string,
  props: Record<string, unknown> = {}
): void {
  if (!isClientFrontendRuntime()) return;
  const mixpanel = getMixpanel();
  if (!mixpanel) return;
  try {
    mixpanel.track(eventName, props);
  } catch {
    // Ignore tracking errors; analytics must never break UI.
  }
}
