<script setup lang="ts">
import { computed, h } from "vue";
import { useDark } from "@vueuse/core";
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
  ClipboardListIcon,
  CpuIcon,
} from "lucide-vue-next";
import { useProjectStore } from "./stores/project";
import { useWorkers } from "./composables/useWorkers";

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

const { workers, loading: workersLoading, error: workersError } = useWorkers(8000);

const onlineWorkerCount = computed(() => workers.value.length);
const busyWorkerCount = computed(() => workers.value.filter((w) => w.status === "busy").length);

function formatSeen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

const workerMenuOptions = computed<DropdownOption[]>(() => {
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
    label: w.name,
    icon: () => h('div', { 
      style: "height: 8px; width: 8px; border-radius: 50%; align-self: center;",
      class: w.status === "busy" ? "worker-dd-row__icon--busy" : "worker-dd-row__icon--idle"
    }),
  }));
});
</script>

<template>
  <NMessageProvider>
    <NConfigProvider :theme="naiveTheme">
      <div class="app">
        <NCard class="header-card">
          <header class="header">
            <div class="header-project">
              <NSelect
                v-model:value="selectedProjectId"
                :options="projectOptions"
                :loading="projectStore.loading"
                :render-label="renderProjectLabel"
                placeholder="Select project…"
                clearable
                size="small"
                style="width: 220px"
              />
              <NDropdown
                trigger="click"
                placement="bottom-start"
                :options="workerMenuOptions"
                :show-arrow="true"
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
                    <span class="workers-trigger__count">{{ onlineWorkerCount }} online</span>
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

                <NDropdown
                  trigger="hover"
                  placement="bottom-start"
                  :options="dataMenuOptions"
                  :show-arrow="true"
                  @select="onNavSelect"
                >
                  <NButton quaternary size="small" :type="isDataGroupActive ? 'primary' : undefined" class="nav-dropdown-trigger">
                    Data
                    <ChevronDownIcon :size="14" class="nav-chevron" />
                  </NButton>
                </NDropdown>

                <NDropdown
                  trigger="hover"
                  placement="bottom-start"
                  :options="contextMenuOptions"
                  :show-arrow="true"
                  @select="onNavSelect"
                >
                  <NButton quaternary size="small" :type="isContextGroupActive ? 'primary' : undefined" class="nav-dropdown-trigger">
                    Context
                    <ChevronDownIcon :size="14" class="nav-chevron" />
                  </NButton>
                </NDropdown>

                <NDropdown
                  trigger="hover"
                  placement="bottom-start"
                  :options="pipelineMenuOptions"
                  :show-arrow="true"
                  @select="onNavSelect"
                >
                  <NButton quaternary size="small" :type="isPipelineGroupActive ? 'primary' : undefined" class="nav-dropdown-trigger">
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

        <main class="main">
          <template v-if="!projectStore.selectedProjectId">
            <img src="https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExcjV0cTJibmdkZmJ0YmZ5ODJoa3BqMHlibTU1eTBmdmpleW5lbmlscyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/a3kvBNAcxPv9TdEnkq/giphy.gif" alt="No project selected" />
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
</style>

<!-- Dropdown body is teleported; render() nodes use global classes -->
<style>
.worker-dd-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px 16px;
  min-width: 300px;
  max-width: 420px;
  padding: 6px 4px;
  font-size: 13px;
}

.worker-dd-row__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: var(--n-text-color-1);
}

.worker-dd-row__status {
  font-size: 12px;
  color: var(--n-text-color-2);
  text-transform: lowercase;
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
