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
  lastSeenAt: string;
};

export function useWorkers(pollMs = 8000) {
  const workers = ref<WorkerEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  let timer: ReturnType<typeof setInterval> | undefined;

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const r = await fetch("/api/workers");
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { workers?: WorkerEntry[] };
      workers.value = j.workers ?? [];
      error.value = null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => {
    void load();
    timer = setInterval(() => void load(), pollMs);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { workers, loading, error, reload: load };
}
