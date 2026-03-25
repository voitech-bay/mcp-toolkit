import { onMounted, onUnmounted, ref } from "vue";

export type WorkerEntry = {
  workerId: string;
  name: string;
  kind: string;
  status: "idle" | "busy" | "stopping";
  tasksInProgress: Array<{
    taskId: string;
    agentName: string;
    operationName?: string | null;
  }>;
  pendingBatches: Array<{
    agentName: string;
    count: number;
    batchSize: number;
    waitingSince: string;
  }>;
  lastSeenAt: string;
  /** Worker process tuning (e.g. ENRICHMENT_*), when the worker sends it. */
  runtime?: Record<string, string | number>;
  /**
   * False when the row is only from Supabase (worker heartbeats another API). Drawer runtime detail needs true.
   */
  hasRuntime?: boolean;
};

function workersSubscribeUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/workers-ws?role=subscribe`;
}

export function useWorkers(fallbackPollMs = 30000) {
  const workers = ref<WorkerEntry[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  let ws: WebSocket | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | undefined;

  function applyPayload(j: { workers?: WorkerEntry[] }): void {
    workers.value = (j.workers ?? []).map((w) => ({
      ...w,
      tasksInProgress: w.tasksInProgress ?? [],
      pendingBatches: w.pendingBatches ?? [],
      runtime: w.runtime,
      hasRuntime: w.hasRuntime !== false,
    }));
    error.value = null;
    loading.value = false;
  }

  async function load(): Promise<void> {
    try {
      const r = await fetch("/api/workers");
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { workers?: WorkerEntry[] };
      applyPayload(j);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      loading.value = false;
    }
  }

  function startFallbackPolling(): void {
    if (fallbackTimer) clearInterval(fallbackTimer);
    fallbackTimer = setInterval(() => void load(), fallbackPollMs);
  }

  function stopFallbackPolling(): void {
    if (fallbackTimer) {
      clearInterval(fallbackTimer);
      fallbackTimer = undefined;
    }
  }

  function connectWs(): void {
    const url = workersSubscribeUrl();
    try {
      ws = new WebSocket(url);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      void load();
      startFallbackPolling();
      return;
    }

    ws.onopen = () => {
      stopFallbackPolling();
      error.value = null;
    };

    ws.onmessage = (ev: MessageEvent) => {
      try {
        const j = JSON.parse(String(ev.data)) as { type?: string; workers?: WorkerEntry[] };
        if (j.type === "workers" && Array.isArray(j.workers)) {
          applyPayload(j);
        }
      } catch {
        /* ignore */
      }
    };

    ws.onerror = () => {
      if (!workers.value.length) {
        error.value = "WebSocket unavailable";
      }
    };

    ws.onclose = () => {
      ws = null;
      void load();
      startFallbackPolling();
    };
  }

  onMounted(() => {
    void load().then(() => {
      connectWs();
    });
  });

  onUnmounted(() => {
    stopFallbackPolling();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    ws = null;
  });

  return { workers, loading, error, reload: load };
}
