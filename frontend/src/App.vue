<script setup lang="ts">
import { computed, h, provide, ref } from "vue";
import { useDark, useNow } from "@vueuse/core";
import { useRoute, useRouter } from "vue-router";
import {
  NConfigProvider,
  NButton,
  NSpace,
  NSelect,
  NMessageProvider,
  NCard,
  NDropdown,
  NAlert,
  NText,
  NDrawer,
  NDrawerContent,
  NScrollbar,
  NDescriptions,
  NDescriptionsItem,
  NDivider,
  NTag,
} from "naive-ui";
import type { SelectOption, DropdownOption } from "naive-ui";
import { darkTheme, lightTheme } from "naive-ui";
import {
  MoonIcon,
  SunIcon,
  LayoutDashboardIcon,
  TableIcon,
  RefreshCwIcon,
  BuildingIcon,
  LightbulbIcon,
  NetworkIcon,
  UsersIcon,
  BookmarkIcon,
  MessageCircleIcon,
  Table2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  CpuIcon,
} from "lucide-vue-next";
import { useProjectStore } from "./stores/project";
import { useWorkers, type WorkerEntry } from "./composables/useWorkers";

const isDark = useDark();
isDark.value = true;

const naiveTheme = computed(() => (isDark.value ? darkTheme : lightTheme));

const route = useRoute();
const router = useRouter();

const isHome = computed(() => route.path === "/");

/** Grouped routes — highlight parent when any child is active. */
const DATA_PATHS = ["/tables", "/companies", "/contacts", "/conversations"] as const;
const CONTEXT_PATHS = ["/context", "/context-snapshots", "/hypotheses"] as const;
const PIPELINE_PATHS = ["/sync", "/enrichment", "/enrichment/jobs"] as const;

function pathInGroup(path: string, group: readonly string[]): boolean {
  return group.includes(path);
}

const isDataGroupActive = computed(() => pathInGroup(route.path, DATA_PATHS));
const isContextGroupActive = computed(() => pathInGroup(route.path, CONTEXT_PATHS));
const isPipelineGroupActive = computed(() => pathInGroup(route.path, PIPELINE_PATHS));

const dataMenuOptions: DropdownOption[] = [
  {
    label: "Tables",
    key: "/tables",
    icon: () => h(TableIcon, { size: 14 }),
  },
  {
    label: "Companies",
    key: "/companies",
    icon: () => h(BuildingIcon, { size: 14 }),
  },
  {
    label: "Contacts",
    key: "/contacts",
    icon: () => h(UsersIcon, { size: 14 }),
  },
  {
    label: "Conversations",
    key: "/conversations",
    icon: () => h(MessageCircleIcon, { size: 14 }),
  },
];

const contextMenuOptions: DropdownOption[] = [
  {
    label: "Context builder",
    key: "/context",
    icon: () => h(NetworkIcon, { size: 14 }),
  },
  {
    label: "Saved contexts",
    key: "/context-snapshots",
    icon: () => h(BookmarkIcon, { size: 14 }),
  },
  {
    label: "Hypotheses",
    key: "/hypotheses",
    icon: () => h(LightbulbIcon, { size: 14 }),
  },
];

const pipelineMenuOptions: DropdownOption[] = [
  {
    label: "Sync",
    key: "/sync",
    icon: () => h(RefreshCwIcon, { size: 14 }),
  },
  {
    label: "Enrichment",
    key: "/enrichment",
    icon: () => h(Table2Icon, { size: 14 }),
  },
  {
    label: "Enrichment jobs",
    key: "/enrichment/jobs",
    icon: () => h(ClipboardListIcon, { size: 14 }),
  },
];

function onNavSelect(key: string | number) {
  router.push(String(key));
}

const projectStore = useProjectStore();

const projectOptions = computed<SelectOption[]>(() =>
  projectStore.projects.map((p) => ({ label: p.name, value: p.id }))
);

const selectedProjectId = computed({
  get: () => projectStore.selectedProjectId,
  set: (id: string | null) => projectStore.selectProject(id),
});

function renderProjectLabel(option: SelectOption) {
  const proj = projectStore.projects.find((p) => p.id === option.value);
  return h("div", { style: "display:flex;align-items:center;gap:8px" }, [
    h("span", {
      style: `width:8px;height:8px;border-radius:50%;background:${proj?.api_key_set ? "#18a058" : "#d03050"};flex-shrink:0`,
    }),
    h("span", {}, option.label as string),
    proj?.description
      ? h("span", { style: "opacity:.5;font-size:.85em;margin-left:4px" }, proj.description)
      : null,
  ].filter(Boolean) as ReturnType<typeof h>[]);
}

function toggleTheme() {
  isDark.value = !isDark.value;
}

projectStore.loadProjects();

const { workers, loading: workersLoading, error: workersError } = useWorkers();

provide("workersRegistry", workers);

const workerDrawerOpen = ref(false);
const selectedWorkerId = ref<string | null>(null);

const selectedWorker = computed(() =>
  selectedWorkerId.value
    ? workers.value.find((w) => w.workerId === selectedWorkerId.value) ?? null
    : null
);

function onWorkerDropdownSelect(key: string | number) {
  const k = String(key);
  if (k === "err" || k === "empty") return;
  selectedWorkerId.value = k;
  workerDrawerOpen.value = true;
}

function pendingBufferTotal(w: WorkerEntry): number {
  return w.pendingBatches.reduce((s, p) => s + p.count, 0);
}

const RUNTIME_LABELS: Record<string, string> = {
  workerName: "Worker name (ENV)",
  maxConcurrentAgentRuns: "Max concurrent agent runs (this worker)",
  pickLimit: "Max tasks claimed per pick",
  pickIntervalMs: "Pick interval — time between picks (ms)",
  maxParallel: "Max concurrent agent runs (legacy ENRICHMENT_MAX_PARALLEL)",
  claimLimit: "Max tasks per pick (legacy ENRICHMENT_CLAIM_LIMIT)",
  pollIntervalMs: "Pick interval (legacy ENRICHMENT_POLL_INTERVAL_MS)",
  lockMinutes: "Task lock (minutes)",
  batchWaitMs: "Batch wait before partial flush (ms); -1 = full batch only",
  heartbeatIntervalMs: "Presence heartbeat interval (ms)",
};

function formatRuntimeLabel(key: string): string {
  return RUNTIME_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function formatRuntimeValue(key: string, v: string | number): string {
  if (key === "batchWaitMs" && v === -1) return "full batch only (no partials)";
  if (key.endsWith("Ms") && typeof v === "number") {
    if (v === 0) return "0 (partial flush immediately after each pick)";
    if (v >= 60_000) return `${v} (${Math.round(v / 1000)}s)`;
    return String(v);
  }
  return String(v);
}

/** Tick once per second so “waiting Ns” stays accurate while the menu is open. */
const now = useNow({ interval: 1000 });

/** Connected to this API (live heartbeats); others may appear from Supabase only. */
const liveWorkerCount = computed(() => workers.value.filter((w) => w.hasRuntime !== false).length);
const remoteWorkerCount = computed(() =>
  Math.max(0, workers.value.length - liveWorkerCount.value)
);
const busyWorkerCount = computed(() =>
  workers.value.filter((w) => w.hasRuntime !== false && w.status === "busy").length
);

/** Per-worker detail expand (sub-rows). Default expanded when there is detail to show. */
const workerDetailExpanded = ref<Record<string, boolean>>({});

function hasWorkerDetail(w: {
  tasksInProgress: unknown[];
  pendingBatches: unknown[];
}): boolean {
  return w.tasksInProgress.length > 0 || w.pendingBatches.length > 0;
}

function isWorkerDetailExpanded(workerId: string, w: typeof workers.value[number]): boolean {
  if (!hasWorkerDetail(w)) return false;
  return workerDetailExpanded.value[workerId] !== false;
}

function toggleWorkerDetail(workerId: string): void {
  const wasExpanded = workerDetailExpanded.value[workerId] !== false;
  workerDetailExpanded.value = {
    ...workerDetailExpanded.value,
    [workerId]: !wasExpanded,
  };
}

function formatWorkerSeen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function waitingSeconds(waitingSince: string): number {
  const t = new Date(waitingSince).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.value.getTime() - t) / 1000));
}

function runningTasksSummary(
  tasks: Array<{ agentName: string }>
): string {
  const m = new Map<string, number>();
  for (const t of tasks) {
    m.set(t.agentName, (m.get(t.agentName) ?? 0) + 1);
  }
  return [...m.entries()].map(([a, n]) => `${a}: ${n} running`).join(" · ");
}

function pendingBatchesSummary(
  batches: Array<{ agentName: string; count: number; batchSize: number; waitingSince: string }>
): string {
  return batches
    .map((p) => {
      const sec = waitingSeconds(p.waitingSince);
      const waitLabel = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
      return `${p.agentName}: ${p.count}/${p.batchSize} (waiting ${waitLabel})`;
    })
    .join(" · ");
}

function statusPillClass(status: "idle" | "busy" | "stopping"): string {
  if (status === "busy") return "worker-dd-pill worker-dd-pill--busy";
  if (status === "stopping") return "worker-dd-pill worker-dd-pill--stopping";
  return "worker-dd-pill worker-dd-pill--idle";
}

const workerMenuOptions = computed<DropdownOption[]>(() => {
  void now.value;
  void workerDetailExpanded.value;
  if (workersError.value) {
    return [
      {
        key: "err",
        type: "render",
        disabled: true,
        render: () =>
          h("div", { class: "worker-dd-note" }, [
            h("div", { class: "worker-dd-note__line" }, "Could not load workers"),
            h(NText, { depth: 3, class: "worker-dd-note__detail" }, () => workersError.value ?? ""),
          ]),
      },
    ];
  }
  if (workers.value.length === 0) {
    return [
      {
        key: "empty",
        type: "render",
        disabled: true,
        render: () =>
          h(
            NText,
            { depth: 3, class: "worker-dd-note" },
            () => (workersLoading.value ? "Loading…" : "No workers online")
          ),
      },
    ];
  }

  return workers.value.map((w) => ({
    key: w.workerId,
    meta: {
      worker: w
    }
  }));
});


function renderWorkerLabel(option: DropdownOption) {
  const w = (option as { meta?: { worker: WorkerEntry } }).meta?.worker;
  if (!w) {
    return h(NText, { depth: 3 }, () => "—");
  }
  const detail = hasWorkerDetail(w);
  const expanded = isWorkerDetailExpanded(w.workerId, w);
  const dotBusy = w.status === "busy" || w.status === "stopping";
  const bufTotal = pendingBufferTotal(w);
  const batchTags: ReturnType<typeof h>[] = [];
  if (bufTotal > 0) {
    batchTags.push(
      h(
        NTag,
        { size: "tiny", type: "warning", bordered: false, round: true, class: "worker-dd-row__buf-tag" },
        { default: () => `buffer ${bufTotal}` }
      )
    );
  }
  for (const p of w.pendingBatches) {
    batchTags.push(
      h(
        NTag,
        {
          size: "tiny",
          bordered: false,
          round: true,
          class: "worker-dd-row__batch-tag",
          title: `${p.agentName}: ${p.count} tasks accumulating toward batch of ${p.batchSize}`,
        },
        { default: () => `${p.agentName.slice(0, 18)}${p.agentName.length > 18 ? "…" : ""} ${p.count}/${p.batchSize}` }
      )
    );
  }
  const rowChildren: ReturnType<typeof h>[] = [
    h("span", {
      class: [
        "worker-dd-row__dot",
        dotBusy ? "worker-dd-row__icon--busy" : "worker-dd-row__icon--idle",
      ],
    }),
    h("div", { class: "worker-dd-row__nameblock" }, [
      h("div", { class: "worker-dd-row__namerow" }, [
        h("span", { class: "worker-dd-row__name", title: w.name }, w.name),
        ...(w.hasRuntime === false
          ? [
              h(
                NTag,
                {
                  size: "tiny",
                  bordered: true,
                  round: true,
                  title: "Last heartbeat seen via DB — not connected to this API",
                },
                { default: () => "Remote" }
              ),
            ]
          : []),
        ...batchTags,
      ]),
    ]),
    h(
      "span",
      { class: statusPillClass(w.status) },
      w.status
    ),
    h("span", { class: "worker-dd-row__seen" }, formatWorkerSeen(w.lastSeenAt)),
  ];
  if (detail) {
    rowChildren.push(
      h(
        "button",
        {
          type: "button",
          class: "worker-dd-row__expand",
          title: expanded ? "Hide details" : "Show details",
          onClick: (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            toggleWorkerDetail(w.workerId);
          },
        },
        h(expanded ? ChevronDownIcon : ChevronRightIcon, { size: 14 })
      )
    );
  } else {
    rowChildren.push(h("span", { class: "worker-dd-row__expand-spacer", "aria-hidden": "true" }));
  }
  const children: ReturnType<typeof h>[] = [h("div", { class: "worker-dd-row" }, rowChildren)];
  if (detail && expanded) {
    if (w.tasksInProgress.length > 0) {
      children.push(
        h("div", { class: "worker-dd-sub" }, [
          h("span", { class: "worker-dd-sub__label" }, "Running · "),
          runningTasksSummary(w.tasksInProgress),
        ])
      );
    }
    if (w.pendingBatches.length > 0) {
      children.push(
        h("div", { class: "worker-dd-sub worker-dd-sub--pending" }, [
          h("span", { class: "worker-dd-sub__label" }, "Waiting · "),
          pendingBatchesSummary(w.pendingBatches),
        ])
      );
    }
  }
  return h("div", { class: "worker-dd-stack" }, children);
}
</script>

<template>
  <NMessageProvider>
    <NConfigProvider :theme="naiveTheme">
      <div class="app">
        <NCard class="header-card">
          <header class="header">
            <div class="header-project">
              <NSelect v-model:value="selectedProjectId" :options="projectOptions" :loading="projectStore.loading"
                :render-label="renderProjectLabel" placeholder="Select project…" clearable size="small"
                style="width: 220px" />
              <NDropdown
                trigger="click"
                :renderLabel="renderWorkerLabel"
                placement="bottom-start"
                :options="workerMenuOptions"
                :show-arrow="true"
                @select="onWorkerDropdownSelect"
              >
                <NButton quaternary size="small" class="workers-trigger" title="Worker status and heartbeats">
                  <CpuIcon :size="14" class="workers-trigger__icon" />
                  <span class="workers-trigger__label">Workers</span>
                  <span v-if="workersLoading" class="workers-trigger__count workers-trigger__count--muted">
                    …
                  </span>
                  <template v-else-if="workersError">
                    <span class="workers-trigger__count workers-trigger__count--err">—</span>
                  </template>
                  <template v-else>
                    <span class="workers-trigger__count">{{ liveWorkerCount }} live</span>
                    <span v-if="remoteWorkerCount > 0" class="workers-trigger__count workers-trigger__count--muted">
                      · {{ remoteWorkerCount }} remote
                    </span>
                    <span v-if="busyWorkerCount > 0" class="workers-trigger__busy">{{ busyWorkerCount }} busy</span>
                  </template>
                  <ChevronDownIcon :size="14" class="workers-trigger__chev" />
                </NButton>
              </NDropdown>
            </div>
            <nav class="nav-row" aria-label="Main">
              <NSpace wrap size="small" align="center">
                <NButton quaternary :type="isHome ? 'primary' : undefined" size="small" @click="router.push('/')">
                  <LayoutDashboardIcon :size="14" style="margin-right: 4px" />
                  Home
                </NButton>

                <NDropdown trigger="hover" placement="bottom-start" :options="dataMenuOptions" :show-arrow="true"
                  @select="onNavSelect">
                  <NButton quaternary size="small" :type="isDataGroupActive ? 'primary' : undefined"
                    class="nav-dropdown-trigger">
                    Data
                    <ChevronDownIcon :size="14" class="nav-chevron" />
                  </NButton>
                </NDropdown>

                <NDropdown trigger="hover" placement="bottom-start" :options="contextMenuOptions" :show-arrow="true"
                  @select="onNavSelect">
                  <NButton quaternary size="small" :type="isContextGroupActive ? 'primary' : undefined"
                    class="nav-dropdown-trigger">
                    Context
                    <ChevronDownIcon :size="14" class="nav-chevron" />
                  </NButton>
                </NDropdown>

                <NDropdown trigger="hover" placement="bottom-start" :options="pipelineMenuOptions" :show-arrow="true"
                  @select="onNavSelect">
                  <NButton quaternary size="small" :type="isPipelineGroupActive ? 'primary' : undefined"
                    class="nav-dropdown-trigger">
                    Pipeline
                    <ChevronDownIcon :size="14" class="nav-chevron" />
                  </NButton>
                </NDropdown>

                <NButton quaternary size="small" @click="toggleTheme()" :title="isDark ? 'Light mode' : 'Dark mode'">
                  <SunIcon :size="14" v-if="isDark" />
                  <MoonIcon :size="14" v-else />
                </NButton>
              </NSpace>
            </nav>
          </header>
        </NCard>

        <NDrawer
          v-model:show="workerDrawerOpen"
          :width="480"
          placement="right"
          display-directive="show"
        >
          <NDrawerContent
            v-if="selectedWorker"
            :title="`${selectedWorker.name} · ${selectedWorker.kind}`"
            closable
          >
            <NScrollbar style="max-height: calc(100vh - 7rem)">
              <div class="worker-drawer-body">
                <p class="worker-drawer-meta">
                  <span :class="statusPillClass(selectedWorker.status)">{{ selectedWorker.status }}</span>
                  <span class="worker-drawer-meta__sep">·</span>
                  <span class="worker-drawer-meta__seen">Last seen {{ formatWorkerSeen(selectedWorker.lastSeenAt) }}</span>
                </p>
                <NAlert
                  v-if="selectedWorker.hasRuntime === false"
                  type="warning"
                  class="worker-drawer-note"
                  title="Not connected to this API"
                >
                  This worker last heartbeated elsewhere (e.g. deployed API). The list shows basic info from the
                  database. Point <code>WORKER_API_BASE_URL</code> / WebSocket at this app to see live tasks, batch
                  buffers, and ENV here.
                </NAlert>
                <template v-else>
                <NAlert type="info" class="worker-drawer-note" title="Scope">
                  This panel shows this worker process only: tasks it has claimed (in progress), tasks it is
                  batching in memory before a run, and its ENRICHMENT_* tuning. Rows still in the database queue
                  but not yet claimed by any worker are not listed here.
                </NAlert>

                <NDivider title-placement="left">Runtime (ENV snapshot)</NDivider>
                <NDescriptions
                  v-if="selectedWorker.runtime && Object.keys(selectedWorker.runtime).length"
                  :column="1"
                  label-placement="left"
                  label-style="max-width: 12rem"
                  size="small"
                  bordered
                >
                  <NDescriptionsItem
                    v-for="key in Object.keys(selectedWorker.runtime).sort()"
                    :key="key"
                    :label="formatRuntimeLabel(key)"
                  >
                    {{ formatRuntimeValue(key, selectedWorker.runtime[key]) }}
                  </NDescriptionsItem>
                </NDescriptions>
                <NText v-else depth="3" class="worker-drawer-empty">
                  No runtime snapshot yet (worker must send heartbeats with runtime; enrichment worker does this on
                  startup).
                </NText>

                <NDivider title-placement="left">In progress</NDivider>
                <ul v-if="selectedWorker.tasksInProgress.length" class="worker-drawer-list">
                  <li v-for="t in selectedWorker.tasksInProgress" :key="t.taskId" class="worker-drawer-li">
                    <strong>{{ t.agentName }}</strong>
                    <span v-if="t.operationName" class="worker-drawer-op">{{ t.operationName }}</span>
                    <code class="worker-drawer-id">{{ t.taskId }}</code>
                  </li>
                </ul>
                <NText v-else depth="3">Nothing running on this worker right now.</NText>

                <NDivider title-placement="left">Waiting for batch (worker buffer)</NDivider>
                <p v-if="selectedWorker.pendingBatches.length" class="worker-drawer-batch-intro">
                  Tasks claimed and held until <code>batch_size</code> is reached or batch wait elapses. Per agent:
                </p>
                <div v-if="selectedWorker.pendingBatches.length" class="worker-drawer-batches">
                  <div
                    v-for="p in selectedWorker.pendingBatches"
                    :key="`${p.agentName}-${p.waitingSince}`"
                    class="worker-drawer-batch-row"
                  >
                    <NTag size="small" type="warning" bordered>{{ p.agentName }}</NTag>
                    <span class="worker-drawer-batch-count">{{ p.count }} / {{ p.batchSize }}</span>
                    <span class="worker-drawer-batch-wait">waiting {{ waitingSeconds(p.waitingSince) }}s</span>
                  </div>
                </div>
                <NText v-else depth="3">No tasks batching in memory on this worker.</NText>
                </template>
              </div>
            </NScrollbar>
          </NDrawerContent>
        </NDrawer>

        <main class="main">
          <template v-if="!projectStore.selectedProjectId">
            <img
              src="https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExcjV0cTJibmdkZmJ0YmZ5ODJoa3BqMHlibTU1eTBmdmpleW5lbmlscyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/a3kvBNAcxPv9TdEnkq/giphy.gif"
              alt="No project selected" />
            <NAlert type="info" class="no-project-alert">
              Select a project in the header to browse its data.
            </NAlert>
          </template>
          <template v-else>
            <router-view />
          </template>
        </main>
      </div>
    </NConfigProvider>
  </NMessageProvider>
</template>

<style>
.worker-dd-row__icon--busy {
  background: #e88080;
}

.worker-dd-row__icon--idle {
  background: #63e2b7;
}
</style>

<style scoped lang="less">
.header-card {
  max-width: 1600px;
  margin: 0 auto;
}

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  padding: 0.5rem 1.5rem 0.75rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 0 auto;
}

.header-project {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.workers-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: min(100%, 280px);

  :deep(.n-button__content) {
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
}

.workers-trigger__icon {
  flex-shrink: 0;
  opacity: 0.85;
}

.workers-trigger__label {
  font-weight: 500;
}

.workers-trigger__count {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(24, 160, 88, 0.18);
  color: var(--n-success-color, #18a058);
  line-height: 1.35;
  white-space: nowrap;
}

.workers-trigger__count--muted {
  background: var(--n-color-hover);
  color: var(--n-text-color-3);
  font-weight: 400;
}

.workers-trigger__count--err {
  background: rgba(208, 48, 80, 0.15);
  color: var(--n-error-color);
}

.workers-trigger__busy {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(240, 160, 32, 0.2);
  color: var(--n-warning-color, #f0a020);
  line-height: 1.35;
  white-space: nowrap;
}

.workers-trigger__chev {
  flex-shrink: 0;
  margin-left: 1px;
  opacity: 0.55;
}

.nav-row {
  display: flex;
  align-items: center;
  flex: 1;
  justify-content: flex-end;
  min-width: 0;
}

.nav-dropdown-trigger {
  gap: 2px;
}

.nav-chevron {
  margin-left: 2px;
  opacity: 0.65;
}

.main {
  flex: 1;
  max-width: 1600px;
  margin: 0 auto;
  width: 100%;
}

.worker-drawer-body {
  padding-bottom: 0.5rem;
}

.worker-drawer-meta {
  margin: 0 0 0.75rem;
  font-size: 13px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
}

.worker-drawer-meta__sep {
  opacity: 0.45;
}

.worker-drawer-meta__seen {
  font-variant-numeric: tabular-nums;
  color: var(--n-text-color-3);
}

.worker-drawer-note {
  margin-bottom: 0.75rem;
}

.worker-drawer-empty {
  display: block;
  margin-bottom: 0.75rem;
  font-size: 13px;
}

.worker-drawer-list {
  margin: 0;
  padding-left: 1.1rem;
}

.worker-drawer-li {
  margin-bottom: 0.45rem;
  font-size: 13px;
  line-height: 1.4;
}

.worker-drawer-op {
  display: inline-block;
  margin-left: 0.35rem;
  opacity: 0.75;
  font-size: 12px;
}

.worker-drawer-id {
  display: block;
  margin-top: 0.1rem;
  font-size: 11px;
  opacity: 0.55;
}

.worker-drawer-batch-intro {
  margin: 0 0 0.5rem;
  font-size: 12px;
  color: var(--n-text-color-3);
}

.worker-drawer-batches {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.worker-drawer-batch-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  font-size: 13px;
}

.worker-drawer-batch-count {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.worker-drawer-batch-wait {
  font-size: 12px;
  color: var(--n-text-color-3);
}
</style>

<!-- Dropdown body is teleported; render() nodes use global classes -->
<style>
.worker-dd-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 300px;
  max-width: 420px;
}

.worker-dd-row {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto auto 28px;
  align-items: center;
  gap: 8px 12px;
  font-size: 13px;
}

.worker-dd-row__nameblock {
  min-width: 0;
}

.worker-dd-row__namerow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.worker-dd-row__namerow .worker-dd-row__name {
  flex: 1 1 auto;
  min-width: 0;
}

.worker-dd-row__buf-tag,
.worker-dd-row__batch-tag {
  flex-shrink: 0;
  font-size: 10px !important;
  line-height: 1.35 !important;
  padding: 0 6px !important;
}

.worker-dd-row__expand-spacer {
  width: 28px;
  height: 1px;
}

.worker-dd-row__expand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  margin: 0;
  border: none;
  background: transparent;
  color: var(--n-text-color-3);
  border-radius: 4px;
  cursor: pointer;
  line-height: 0;
}

.worker-dd-row__expand:hover {
  color: var(--n-text-color-2);
  background: var(--n-color-hover);
}

.worker-dd-pill {
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: lowercase;
  white-space: nowrap;
}

.worker-dd-pill--idle {
  background: rgba(99, 226, 183, 0.2);
  color: #63e2b7;
}

.worker-dd-pill--busy {
  background: rgba(240, 160, 32, 0.22);
  color: var(--n-warning-color, #f0a020);
}

.worker-dd-pill--stopping {
  background: rgba(128, 128, 128, 0.25);
  color: var(--n-text-color-2);
}

.worker-dd-sub__label {
  font-weight: 600;
  color: var(--n-text-color-2);
}

.worker-dd-row__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.worker-dd-sub {
  font-size: 11px;
  line-height: 1.35;
  color: var(--n-text-color-3);
  padding-left: 18px;
  word-break: break-word;
}

.worker-dd-sub--pending {
  opacity: 0.95;
}

.worker-dd-row__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: var(--n-text-color-1);
}

.worker-dd-row__seen {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--n-text-color-3);
  white-space: nowrap;
}

.worker-dd-note {
  padding: 8px 12px;
  min-width: 200px;
  max-width: 320px;
  font-size: 13px;
}

.worker-dd-note__line {
  margin-bottom: 4px;
}

.worker-dd-note__detail {
  font-size: 12px;
  line-height: 1.4;
  word-break: break-word;
}
</style>
