<script setup lang="ts">
import { computed, h, ref, watch } from "vue";
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
  TagsIcon,
  MessageCircleIcon,
  Table2Icon,
  ChevronDownIcon,
  ClipboardListIcon,
  Link2Icon,  
  BarChart3Icon,
  CopyIcon,
} from "lucide-vue-next";
import { useProjectStore } from "./stores/project";

const isDark = useDark();
isDark.value = true;

const naiveTheme = computed(() => (isDark.value ? darkTheme : lightTheme));

const route = useRoute();
const router = useRouter();

const isHome = computed(() => route.path === "/");
const isFlowDashboard = computed(
  () => route.path === "/flow-dashboard" || route.path === "/analytics"
);

/** Grouped routes — highlight parent when any child is active. */
const DATA_PATHS = ["/tables", "/companies", "/contacts", "/conversations", "/getsales-tags"] as const;
const CONTEXT_PATHS = ["/context", "/context-snapshots", "/hypotheses", "/hypothesis-tag-contacts"] as const;
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
  {
    label: "GetSales tags",
    key: "/getsales-tags",
    icon: () => h(TagsIcon, { size: 14 }),
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
  {
    label: "Hypothesis → contacts",
    key: "/hypothesis-tag-contacts",
    icon: () => h(Link2Icon, { size: 14 }),
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

/** Random rectangular loop for the empty “no project” GIF (new params each load). */
type NoProjectOrbit = {
  hw: number;
  hh: number;
  durationSec: number;
  delaySec: number;
};

function randomNoProjectOrbit(): NoProjectOrbit {
  const r = () => Math.random();
  const hw = Math.round(70 + r() * 200);
  const hh = Math.round(35 + r() * 150);
  const durationSec = Math.round(12 + r() * 24);
  const delaySec = -r() * durationSec;
  return { hw, hh, durationSec, delaySec };
}

const noProjectOrbit = ref<NoProjectOrbit>(randomNoProjectOrbit());

const noProjectOrbitStageStyle = computed(() => ({
  "--orbit-hw": `${noProjectOrbit.value.hw}px`,
  "--orbit-hh": `${noProjectOrbit.value.hh}px`,
  "--orbit-duration": `${noProjectOrbit.value.durationSec}s`,
  "--orbit-delay": `${noProjectOrbit.value.delaySec}s`,
}));

const projectOptions = computed<SelectOption[]>(() =>
  projectStore.projects.map((p) => ({ label: p.name, value: p.id }))
);

const selectedProjectId = computed({
  get: () => projectStore.selectedProjectId,
  set: (id: string | null) => projectStore.selectProject(id),
});

function normalizeClientPortalHost(raw: string | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const withProtocol =
    /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const host = withProtocol.replace(/\/+$/, "");
  try {
    return new URL(host).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

const clientPortalHost = normalizeClientPortalHost(
  import.meta.env.VITE_CLIENT_PORTAL_HOST as string | undefined
);
const clientPortalCopyState = ref<"idle" | "copied" | "failed">("idle");
let clientPortalCopyTimer: ReturnType<typeof setTimeout> | null = null;

const clientPortalProjectUrl = computed(() => {
  if (!clientPortalHost || !selectedProjectId.value) return null;
  return `${clientPortalHost}/analytics/${selectedProjectId.value}`;
});

async function copyClientPortalUrl(): Promise<void> {
  const url = clientPortalProjectUrl.value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    clientPortalCopyState.value = "copied";
  } catch {
    clientPortalCopyState.value = "failed";
  }
  if (clientPortalCopyTimer != null) clearTimeout(clientPortalCopyTimer);
  clientPortalCopyTimer = setTimeout(() => {
    clientPortalCopyState.value = "idle";
    clientPortalCopyTimer = null;
  }, 2200);
}

const clientPortalCtaLabel = computed(() => {
  if (clientPortalCopyState.value === "copied") return "Copied";
  if (clientPortalCopyState.value === "failed") return "Copy failed";
  return "Copy client portal URL";
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

/** Header chips: last sync + analytics day range (same payload as home overview). */
interface HeaderDashboardPayload {
  lastSyncFinishedAt: string | null;
  firstAnalyticsDate: string | null;
  lastAnalyticsDate: string | null;
}

const headerDashboard = ref<HeaderDashboardPayload | null>(null);
const headerDashboardLoading = ref(false);

async function loadHeaderDashboard() {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) {
    headerDashboard.value = null;
    return;
  }
  headerDashboardLoading.value = true;
  try {
    const r = await fetch(`/api/project-dashboard?projectId=${encodeURIComponent(projectId)}`);
    const data = (await r.json()) as HeaderDashboardPayload & { error?: string };
    if (!r.ok) {
      headerDashboard.value = null;
      return;
    }
    headerDashboard.value = {
      lastSyncFinishedAt: data.lastSyncFinishedAt ?? null,
      firstAnalyticsDate: data.firstAnalyticsDate ?? null,
      lastAnalyticsDate: data.lastAnalyticsDate ?? null,
    };
  } catch {
    headerDashboard.value = null;
  } finally {
    headerDashboardLoading.value = false;
  }
}

watch(
  () => projectStore.selectedProjectId,
  () => {
    void loadHeaderDashboard();
  },
  { immediate: true }
);

function formatHeaderDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function formatHeaderYmd(ymd: string | null): string {
  if (!ymd) return "—";
  try {
    return new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
  } catch {
    return ymd;
  }
}

function formatHeaderAnalyticsRange(first: string | null, last: string | null): string {
  if (!first && !last) return "—";
  if (!first || !last) return formatHeaderYmd(first ?? last);
  if (first === last) return formatHeaderYmd(first);
  return `${formatHeaderYmd(first)} – ${formatHeaderYmd(last)}`;
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
              <NSpace
                v-if="selectedProjectId"
                size="small"
                align="center"
                wrap
                class="header-dash-btns"
              >
                <NButton
                  quaternary
                  size="small"
                  class="header-dash-btn"
                  title="When the last pipeline sync finished — open Sync"
                  @click="router.push('/sync')"
                >
                  <span class="header-dash-btn__k">Latest data sync</span>
                  <span class="header-dash-btn__v">{{
                    headerDashboardLoading ? "…" : formatHeaderDateTime(headerDashboard?.lastSyncFinishedAt ?? null)
                  }}</span>
                </NButton>
                <NButton
                  quaternary
                  size="small"
                  class="header-dash-btn"
                  title="Calendar days covered by stored analytics snapshots — open Analytics"
                  @click="router.push('/analytics')"
                >
                  <span class="header-dash-btn__k">Analytics range synced</span>
                  <span class="header-dash-btn__v">{{
                    headerDashboardLoading
                      ? "…"
                      : formatHeaderAnalyticsRange(
                          headerDashboard?.firstAnalyticsDate ?? null,
                          headerDashboard?.lastAnalyticsDate ?? null
                        )
                  }}</span>
                </NButton>
              </NSpace>
            </div>
            <nav class="nav-row" aria-label="Main">
              <NSpace wrap size="small" align="center">
                <NButton quaternary :type="isHome ? 'primary' : undefined" size="small" @click="router.push('/')">
                  <LayoutDashboardIcon :size="14" style="margin-right: 4px" />
                  Home
                </NButton>

                <NButton
                  quaternary
                  :type="isFlowDashboard ? 'primary' : undefined"
                  size="small"
                  @click="router.push('/analytics')"
                >
                  <BarChart3Icon :size="14" style="margin-right: 4px" />
                  Analytics
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

        <main class="main">
          <template v-if="!projectStore.selectedProjectId">
            <div class="no-project-orbit-wrap" :style="noProjectOrbitStageStyle">
              <img
                class="no-project-orbit-img"
                src="https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExcjV0cTJibmdkZmJ0YmZ5ODJoa3BqMHlibTU1eTBmdmpleW5lbmlscyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/a3kvBNAcxPv9TdEnkq/giphy.gif"
                alt="No project selected"
                draggable="false"
              />
            </div>
            <NAlert type="info">
              Select a project in the header to browse its data.
            </NAlert>
          </template>
          <template v-else>
            <div v-if="isFlowDashboard" class="main-portal-cta">
              <NButton
                type="primary"
                size="small"
                :disabled="!clientPortalProjectUrl"
                :title="
                  clientPortalProjectUrl
                    ? 'Copy client portal analytics URL'
                    : 'Set VITE_CLIENT_PORTAL_HOST and select project'
                "
                @click="copyClientPortalUrl"
              >
                <template #icon>
                  <CopyIcon :size="14" />
                </template>
                <span>{{ clientPortalCtaLabel }}</span>
              </NButton>
            </div>
            <router-view />
          </template>
        </main>
      </div>
    </NConfigProvider>
  </NMessageProvider>
</template>

<style scoped lang="less">
.header-card {
  max-width: 1760px;
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
  flex-wrap: wrap;
  min-width: 0;
}

.header-dash-btns {
  min-width: 0;
}

.header-dash-btn {
  max-width: min(100%, 260px);
  height: auto !important;
  min-height: auto !important;
  padding: 5px 10px !important;
  border-radius: 8px;
  font-weight: inherit;

  :deep(.n-button__content) {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    line-height: 1.25;
    text-align: left;
    white-space: normal;
  }
}

.header-dash-btn__k {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.65;
}

.header-dash-btn__v {
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  word-break: break-word;
  color: var(--n-text-color);
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
  max-width: min(1760px, 96vw);
  margin: 0 auto;
  width: 100%;
}

.main-portal-cta {
  display: flex;
  justify-content: flex-end;
  margin: 1rem 0;
}

.no-project-orbit-wrap {
  position: relative;
  width: 100%;
  min-height: calc(2 * var(--orbit-hh) + min(132px, 30vw) + 24px);
  overflow: hidden;
}

.no-project-orbit-img {
  position: absolute;
  left: 50%;
  top: 50%;
  display: block;
  width: min(132px, 30vw);
  height: auto;
  animation: no-project-orbit-rect var(--orbit-duration) linear infinite;
  animation-delay: var(--orbit-delay);
}

@keyframes no-project-orbit-rect {
  0% {
    transform: translate(-50%, -50%) translate(calc(-1 * var(--orbit-hw)), calc(-1 * var(--orbit-hh))) rotate(-4deg);
  }
  25% {
    transform: translate(-50%, -50%) translate(var(--orbit-hw), calc(-1 * var(--orbit-hh))) rotate(5deg);
  }
  50% {
    transform: translate(-50%, -50%) translate(var(--orbit-hw), var(--orbit-hh)) rotate(-3deg);
  }
  75% {
    transform: translate(-50%, -50%) translate(calc(-1 * var(--orbit-hw)), var(--orbit-hh)) rotate(4deg);
  }
  100% {
    transform: translate(-50%, -50%) translate(calc(-1 * var(--orbit-hw)), calc(-1 * var(--orbit-hh))) rotate(-4deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .no-project-orbit-img {
    animation: none;
    transform: translate(-50%, -50%);
  }
}

</style>
