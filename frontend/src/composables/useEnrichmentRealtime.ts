import { ref, watch, onMounted, onUnmounted, type Ref } from "vue";

const SAFETY_POLL_MS = 90_000;

/** Server-built snapshot (same shape as GET enrichment-table + agents). */
export type EnrichmentDataPayload = {
  type: "enrichment_data";
  projectId: string;
  entityType: "company" | "contact";
  limit: number;
  offset: number;
  total: number;
  agentNames: string[];
  rows: unknown[];
  agents: unknown[];
  error?: string | null;
};

/** One WebSocket message so the table can mark every row in the batch as working together. */
export type EnrichmentBatchStartedPayload = {
  type: "enrichment_batch_started";
  projectId: string;
  agentName: string;
  workerName?: string | null;
  items: Array<{ taskId: string; companyId: string | null; contactId: string | null }>;
};

/**
 * WebSocket to `/api/enrichment-ws` — receives full table + agents in `enrichment_data` messages
 * (no extra HTTP on each DB change). Client sends `{ entityType, limit, offset }` after connect
 * and whenever pagination/tab changes.
 */
export function useEnrichmentRealtime(
  projectId: Ref<string | null>,
  tableParams: Ref<{ entityType: "company" | "contact"; limit: number; offset: number }>,
  options: {
    onEnrichmentData: (payload: EnrichmentDataPayload) => void;
    pausePoll: () => void;
    resumePoll: () => void;
    /** Slow HTTP fallback while connected (optional). */
    onSafetyPoll?: () => void | Promise<void>;
    /** Batch run starting (all task ids) — update UI before per-row DB realtime. */
    onBatchStarted?: (payload: EnrichmentBatchStartedPayload) => void;
  }
): { connected: Ref<boolean> } {
  const connected = ref(false);
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let safetyTimer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let attempt = 0;

  function clearReconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  }

  function clearSafetyPoll(): void {
    if (safetyTimer) {
      clearInterval(safetyTimer);
      safetyTimer = undefined;
    }
  }

  function sendTableParams(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(tableParams.value));
    } catch {
      /* ignore */
    }
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    clearReconnect();
    const delay = Math.min(30_000, 800 * 2 ** Math.min(attempt, 6));
    attempt++;
    reconnectTimer = setTimeout(() => connect(), delay);
  }

  function disconnect(): void {
    clearReconnect();
    clearSafetyPoll();
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.onopen = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
    }
    connected.value = false;
    options.resumePoll();
  }

  function connect(): void {
    const id = projectId.value;
    if (!id || stopped) {
      disconnect();
      return;
    }

    disconnect();
    clearReconnect();
    attempt = 0;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/enrichment-ws?projectId=${encodeURIComponent(id)}`;

    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      attempt = 0;
      connected.value = true;
      options.pausePoll();
      clearSafetyPoll();
      sendTableParams();
      if (options.onSafetyPoll) {
        safetyTimer = setInterval(() => {
          void Promise.resolve(options.onSafetyPoll?.());
        }, SAFETY_POLL_MS);
      }
    };

    ws.onmessage = (ev: MessageEvent) => {
      try {
        const j = JSON.parse(String(ev.data)) as { type?: string };
        if (j.type === "enrichment_data") {
          options.onEnrichmentData(j as EnrichmentDataPayload);
        } else if (j.type === "enrichment_batch_started" && options.onBatchStarted) {
          options.onBatchStarted(j as EnrichmentBatchStartedPayload);
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      clearSafetyPoll();
      connected.value = false;
      options.resumePoll();
      ws = null;
      if (!stopped) scheduleReconnect();
    };

    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }

  watch(projectId, () => {
    attempt = 0;
    connect();
  });

  watch(
    tableParams,
    () => {
      sendTableParams();
    },
    { deep: true }
  );

  onMounted(() => {
    stopped = false;
    connect();
  });

  onUnmounted(() => {
    stopped = true;
    disconnect();
  });

  return { connected };
}
