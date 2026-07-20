<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NCard,
  NGi,
  NGrid,
  NH1,
  NSpin,
  NStatistic,
  NTag,
} from "naive-ui";
import {
  BarChart3Icon,
  Building2Icon,
  ClipboardListIcon,
  DatabaseIcon,
  GitBranchIcon,
  LightbulbIcon,
  MailCheckIcon,
  MessageCircleIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchCheckIcon,
  Table2Icon,
  UsersIcon,
  WorkflowIcon,
} from "lucide-vue-next";
import type { TableCounts } from "../types";
import { useProjectStore } from "../stores/project";
import { isVelvetechProjectId } from "../project-ids";

const router = useRouter();
const projectStore = useProjectStore();

interface DashboardPayload {
  lastSyncFinishedAt: string | null;
  firstAnalyticsDate: string | null;
  lastAnalyticsDate: string | null;
  totalAnalyticsDays: number;
  counts: TableCounts;
  hypothesesTotal: number;
  conversationsTotal: number | null;
  warnings: string[];
}

type TileTone = "teal" | "blue" | "amber" | "rose" | "green" | "slate" | "cyan";
type TileIcon =
  | "building"
  | "users"
  | "workflow"
  | "mail"
  | "email"
  | "chart"
  | "message"
  | "lightbulb"
  | "refresh"
  | "table"
  | "database"
  | "branch"
  | "search"
  | "clipboard";

interface HubTile {
  title: string;
  eyebrow: string;
  description: string;
  path: string;
  icon: TileIcon;
  tone: TileTone;
  metric?: string;
}

const loading = ref(false);
const loadError = ref("");
const dashboard = ref<DashboardPayload | null>(null);

const isVelvetech = computed(() => isVelvetechProjectId(projectStore.selectedProjectId));
const projectName = computed(() => projectStore.selectedProject?.name ?? "Project");
const heroTag = computed(() => (isVelvetech.value ? "Velvetech workspace" : "Workspace"));
const heroText = computed(() =>
  isVelvetech.value
    ? "Launch research, inspect workflow output, review messaging, and move between account data without hunting through menus."
    : "Jump into research, outreach review, and account data from one place."
);
const launchBandTitle = computed(() =>
  isVelvetech.value ? "Research and launch control" : "Start here"
);
const launchBandText = computed(() =>
  isVelvetech.value
    ? "Use these first when a new batch is moving through n8n, research, and message review."
    : "Refresh data and enrichment before diving into account work."
);

function formatDateTime(iso: string | null): string {
  if (!iso) return "No sync yet";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function formatYmd(ymd: string | null): string {
  if (!ymd) return "No data";
  try {
    return new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
  } catch {
    return ymd;
  }
}

function countLabel(value: number | null | undefined): string {
  if (value == null) return "-";
  return value.toLocaleString();
}

async function loadDashboard() {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) {
    dashboard.value = null;
    return;
  }
  loading.value = true;
  loadError.value = "";
  try {
    const r = await fetch(`/api/project-dashboard?projectId=${encodeURIComponent(projectId)}`);
    const data = (await r.json()) as DashboardPayload & { error?: string };
    if (!r.ok) {
      loadError.value = data.error ?? "Failed to load dashboard";
      dashboard.value = null;
      return;
    }
    dashboard.value = data;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "Failed to load dashboard";
    dashboard.value = null;
  } finally {
    loading.value = false;
  }
}

watch(
  () => projectStore.selectedProjectId,
  () => {
    void loadDashboard();
  },
  { immediate: true }
);

const launchTiles = computed<HubTile[]>(() => {
  if (isVelvetech.value) {
    return [
      {
        title: "Workflow launcher",
        eyebrow: "Start here",
        description:
          "Run Velvetech research, review generated InMail, and prepare the next batch for approval.",
        path: "/n8n/launch",
        icon: "workflow",
        tone: "teal",
      },
      {
        title: "n8n workflow results",
        eyebrow: "Inspect runs",
        description:
          "Open Research, Credit usage, and Workflow Health for each batch — expand company POV on the same page.",
        path: "/n8n/workflow-results",
        icon: "search",
        tone: "blue",
      },
    ];
  }
  return [
    {
      title: "Sync",
      eyebrow: "Data refresh",
      description: "Run project syncs and confirm the latest GetSales data landed.",
      path: "/sync",
      icon: "refresh",
      tone: "slate",
    },
    {
      title: "Enrichment",
      eyebrow: "Batch work",
      description: "Queue company and contact enrichment jobs, then inspect status and outputs.",
      path: "/enrichment",
      icon: "database",
      tone: "teal",
    },
  ];
});

const workspaceTiles = computed<HubTile[]>(() => {
  const d = dashboard.value;
  const tiles: HubTile[] = [
    {
      title: "Companies",
      eyebrow: "Account map",
      description: "Browse target accounts, company cards, context, conversations, and research history.",
      path: "/companies",
      icon: "building",
      tone: "green",
      metric: d ? countLabel(d.counts.companies_in_project) : undefined,
    },
    {
      title: "Contacts",
      eyebrow: "People view",
      description: "Find decision-makers, inspect lead cards, and check outreach readiness by person.",
      path: "/contacts",
      icon: "users",
      tone: "cyan",
      metric: d ? countLabel(d.counts.contacts) : undefined,
    },
    {
      title: "Email Studio",
      eyebrow: "Email drafts",
      description: "Draft, annotate, and approve cold emails. Sync sent status from Smartlead when needed.",
      path: "/email-studio",
      icon: "email",
      tone: "amber",
    },
    {
      title: "Sequence Studio",
      eyebrow: "Messaging QA",
      description: "Review email, LinkedIn, and InMail sequences with POV points beside the copy.",
      path: "/sequence-studio",
      icon: "mail",
      tone: "rose",
    },
    {
      title: "Conversations",
      eyebrow: "Reply context",
      description: "Search LinkedIn and email threads so follow-ups stay grounded in account history.",
      path: "/conversations",
      icon: "message",
      tone: "slate",
      metric: d ? countLabel(d.conversationsTotal) : undefined,
    },
    {
      title: "Analytics",
      eyebrow: "Performance",
      description: "See funnel movement, reply rates, and flow performance by period or in total.",
      path: "/analytics",
      icon: "chart",
      tone: "blue",
      metric: d ? `${countLabel(d.totalAnalyticsDays)} days` : undefined,
    },
  ];
  if (!isVelvetech.value) {
    tiles.splice(4, 0, {
      title: "Hypotheses",
      eyebrow: "Campaign logic",
      description: "Manage project hypotheses and connect them to target contacts and companies.",
      path: "/hypotheses",
      icon: "lightbulb",
      tone: "amber",
      metric: d ? countLabel(d.hypothesesTotal) : undefined,
    });
  }
  return tiles;
});

const operationsTiles = computed<HubTile[]>(() => {
  const base: HubTile[] = [
    {
      title: "Sync",
      eyebrow: "Data refresh",
      description: "Run project syncs, check credentials, and confirm the latest GetSales data landed.",
      path: "/sync",
      icon: "refresh",
      tone: "slate",
    },
    {
      title: "Enrichment",
      eyebrow: "Batch work",
      description: "Queue company and contact enrichment jobs, then inspect job status and outputs.",
      path: "/enrichment",
      icon: "database",
      tone: "teal",
    },
    {
      title: "Lists checker",
      eyebrow: "Import safety",
      description: "Validate list inputs before launch so bad rows do not leak into outreach.",
      path: "/lists-checker",
      icon: "clipboard",
      tone: "amber",
    },
    {
      title: "Tables",
      eyebrow: "Raw data",
      description: "Open the underlying synced tables when you need a lower-level operational view.",
      path: "/tables",
      icon: "table",
      tone: "green",
    },
    {
      title: "Context builder",
      eyebrow: "Research graph",
      description: "Assemble account context, hypotheses, and saved snapshots into reusable prep.",
      path: "/context",
      icon: "branch",
      tone: "cyan",
    },
  ];
  if (isVelvetech.value) {
    base.splice(2, 0, {
      title: "Hypotheses",
      eyebrow: "Campaign logic",
      description: "Manage project hypotheses and connect them to target contacts and companies.",
      path: "/hypotheses",
      icon: "lightbulb",
      tone: "amber",
      metric: dashboard.value ? countLabel(dashboard.value.hypothesesTotal) : undefined,
    });
  }
  return base;
});

function go(path: string) {
  void router.push(path);
}

function onTileKeydown(event: KeyboardEvent, path: string) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    go(path);
  }
}
</script>

<template>
  <div class="home">
    <section class="home-hero">
      <div class="home-hero__copy">
        <NTag size="small" round :type="isVelvetech ? 'success' : 'default'">{{ heroTag }}</NTag>
        <NH1 class="home-hero__title">{{ projectName }}</NH1>
        <p class="home-hero__text">{{ heroText }}</p>
      </div>
      <div class="home-hero__visual" aria-hidden="true">
        <div class="signal signal--one"></div>
        <div class="signal signal--two"></div>
        <div class="signal signal--three"></div>
        <WorkflowIcon :size="42" />
      </div>
    </section>

    <NSpin :show="loading">
      <div class="home__body">
        <NAlert v-if="loadError" type="error" class="home__alert" :title="loadError" />

        <NAlert
          v-if="dashboard?.warnings.length"
          type="warning"
          class="home__alert"
          title="Some metrics could not be loaded"
        >
          <ul class="home__warn-list">
            <li v-for="(w, i) in dashboard.warnings" :key="i">{{ w }}</li>
          </ul>
        </NAlert>

        <section class="launch-band">
          <div class="launch-band__summary">
            <div class="launch-band__icon"><PlayIcon :size="18" /></div>
            <div>
              <h2>{{ launchBandTitle }}</h2>
              <p>{{ launchBandText }}</p>
            </div>
          </div>
          <div class="launch-band__meta">
            <span>Last sync</span>
            <strong>{{ formatDateTime(dashboard?.lastSyncFinishedAt ?? null) }}</strong>
          </div>
        </section>

        <NGrid :cols="24" :x-gap="14" :y-gap="14" responsive="screen" class="home__grid home__grid--launch">
          <NGi v-for="(tile, index) in launchTiles" :key="tile.title" span="24 m:12">
            <NCard
              size="small"
              tabindex="0"
              role="button"
              :aria-label="`Open ${tile.title}`"
              :class="['hub-tile', 'hub-tile--large', `hub-tile--${tile.tone}`, `hub-tile--stagger-${index}`]"
              @click="go(tile.path)"
              @keydown="onTileKeydown($event, tile.path)"
            >
              <div class="hub-tile__top">
                <div class="hub-tile__icon">
                  <WorkflowIcon v-if="tile.icon === 'workflow'" :size="22" />
                  <SearchCheckIcon v-else-if="tile.icon === 'search'" :size="22" />
                  <RefreshCwIcon v-else-if="tile.icon === 'refresh'" :size="22" />
                  <DatabaseIcon v-else-if="tile.icon === 'database'" :size="22" />
                </div>
                <span>{{ tile.eyebrow }}</span>
              </div>
              <h3>{{ tile.title }}</h3>
              <p>{{ tile.description }}</p>
              <NButton size="small" secondary tabindex="-1">Open</NButton>
            </NCard>
          </NGi>
        </NGrid>

        <div class="section-head">
          <div>
            <h2>Daily workspace</h2>
            <p>Pages you will use most while researching, reviewing, and preparing outreach.</p>
          </div>
          <NTag v-if="dashboard" size="small" round>
            Analytics through {{ formatYmd(dashboard.lastAnalyticsDate) }}
          </NTag>
        </div>

        <NGrid :cols="24" :x-gap="14" :y-gap="14" responsive="screen" class="home__grid">
          <NGi v-for="tile in workspaceTiles" :key="tile.title" span="24 s:12 l:8">
            <NCard
              size="small"
              tabindex="0"
              role="button"
              :aria-label="`Open ${tile.title}`"
              :class="['hub-tile', `hub-tile--${tile.tone}`]"
              @click="go(tile.path)"
              @keydown="onTileKeydown($event, tile.path)"
            >
              <div class="hub-tile__top">
                <div class="hub-tile__icon">
                  <Building2Icon v-if="tile.icon === 'building'" :size="20" />
                  <UsersIcon v-else-if="tile.icon === 'users'" :size="20" />
                  <MailCheckIcon v-else-if="tile.icon === 'mail' || tile.icon === 'email'" :size="20" />
                  <MessageCircleIcon v-else-if="tile.icon === 'message'" :size="20" />
                  <LightbulbIcon v-else-if="tile.icon === 'lightbulb'" :size="20" />
                  <BarChart3Icon v-else-if="tile.icon === 'chart'" :size="20" />
                </div>
                <span>{{ tile.eyebrow }}</span>
              </div>
              <div class="hub-tile__title-row">
                <h3>{{ tile.title }}</h3>
                <NStatistic v-if="tile.metric" :value="tile.metric" tabular-nums class="hub-tile__metric" />
              </div>
              <p>{{ tile.description }}</p>
            </NCard>
          </NGi>
        </NGrid>

        <div class="section-head section-head--spaced">
          <div>
            <h2>Operations</h2>
            <p>Maintenance, validation, enrichment, and lower-level data tools.</p>
          </div>
        </div>

        <NGrid :cols="24" :x-gap="12" :y-gap="12" responsive="screen" class="home__grid">
          <NGi v-for="tile in operationsTiles" :key="tile.title" span="24 s:12 l:6">
            <NCard
              size="small"
              tabindex="0"
              role="button"
              :aria-label="`Open ${tile.title}`"
              :class="['hub-tile', 'hub-tile--compact', `hub-tile--${tile.tone}`]"
              @click="go(tile.path)"
              @keydown="onTileKeydown($event, tile.path)"
            >
              <div class="hub-tile__top">
                <div class="hub-tile__icon">
                  <RefreshCwIcon v-if="tile.icon === 'refresh'" :size="18" />
                  <DatabaseIcon v-else-if="tile.icon === 'database'" :size="18" />
                  <ClipboardListIcon v-else-if="tile.icon === 'clipboard'" :size="18" />
                  <Table2Icon v-else-if="tile.icon === 'table'" :size="18" />
                  <GitBranchIcon v-else-if="tile.icon === 'branch'" :size="18" />
                  <LightbulbIcon v-else-if="tile.icon === 'lightbulb'" :size="18" />
                </div>
                <span>{{ tile.eyebrow }}</span>
              </div>
              <div class="hub-tile__title-row">
                <h3>{{ tile.title }}</h3>
                <NStatistic v-if="tile.metric" :value="tile.metric" tabular-nums class="hub-tile__metric" />
              </div>
              <p>{{ tile.description }}</p>
            </NCard>
          </NGi>
        </NGrid>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.home {
  max-width: 1280px;
  margin: 0 auto;
  padding: 1.25rem 1.25rem 2.75rem;
}

.home-hero {
  position: relative;
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 1rem;
  min-height: 190px;
  padding: 1.35rem;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(18, 140, 126, 0.22), rgba(21, 24, 29, 0.92) 55%, rgba(180, 128, 44, 0.12)),
    #15181d;
  overflow: hidden;
}

.home-hero__copy {
  max-width: 720px;
  z-index: 1;
}

.home-hero__title {
  margin: 0.55rem 0 0.45rem;
  font-size: clamp(2rem, 5vw, 4rem);
  line-height: 0.95;
  font-weight: 750;
  letter-spacing: -0.02em;
}

.home-hero__text {
  max-width: 640px;
  margin: 0;
  font-size: 1rem;
  line-height: 1.55;
  opacity: 0.82;
}

.home-hero__visual {
  position: relative;
  width: min(32vw, 340px);
  min-width: 220px;
  display: grid;
  place-items: center;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  color: #54d6be;
}

.signal {
  position: absolute;
  border: 1px solid currentColor;
  border-radius: 999px;
  opacity: 0.35;
  animation: signal-pulse 4.2s ease-in-out infinite;
}

.signal--one {
  width: 84px;
  height: 84px;
  color: #54d6be;
  animation-delay: 0s;
}

.signal--two {
  width: 150px;
  height: 150px;
  color: #74a7ff;
  animation-delay: 0.35s;
}

.signal--three {
  width: 230px;
  height: 230px;
  color: #e0b15d;
  animation-delay: 0.7s;
}

@keyframes signal-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.28;
  }
  50% {
    transform: scale(1.04);
    opacity: 0.48;
  }
}

.home__body {
  min-height: 160px;
  padding-top: 1rem;
}

.home__alert {
  margin-bottom: 1rem;
}

.home__warn-list {
  margin: 0.35rem 0 0;
  padding-left: 1.2rem;
  font-size: 13px;
}

.launch-band {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  margin-bottom: 0.9rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  animation: band-in 0.45s ease both;
}

@keyframes band-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.launch-band__summary {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  min-width: 0;
}

.launch-band__icon {
  width: 42px;
  height: 42px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: rgba(84, 214, 190, 0.15);
  color: #54d6be;
  flex-shrink: 0;
}

.launch-band h2,
.section-head h2,
.hub-tile h3 {
  margin: 0;
}

.launch-band p,
.section-head p,
.hub-tile p {
  margin: 0.25rem 0 0;
  opacity: 0.72;
  line-height: 1.45;
}

.launch-band__meta {
  text-align: right;
  min-width: 190px;
}

.launch-band__meta span {
  display: block;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.58;
}

.launch-band__meta strong {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.92rem;
}

.home__grid {
  margin-bottom: 1.1rem;
}

.section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin: 1.45rem 0 0.8rem;
}

.section-head--spaced {
  margin-top: 1.65rem;
}

.hub-tile {
  height: 100%;
  cursor: pointer;
  border-radius: 8px;
  overflow: hidden;
  outline: none;
  transition:
    transform 0.14s ease,
    border-color 0.14s ease,
    background 0.14s ease;
}

.hub-tile:hover,
.hub-tile:focus-visible {
  transform: translateY(-2px);
}

.hub-tile:focus-visible {
  border-color: rgba(84, 214, 190, 0.55);
}

.hub-tile--stagger-0 {
  animation: tile-in 0.4s ease both;
}

.hub-tile--stagger-1 {
  animation: tile-in 0.4s ease 0.08s both;
}

@keyframes tile-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.hub-tile :deep(.n-card__content) {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.hub-tile__top {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.78;
}

.hub-tile__icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--tile-accent);
}

.hub-tile__title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.hub-tile__metric {
  min-width: 74px;
  text-align: right;
}

.hub-tile__metric :deep(.n-statistic-value) {
  font-size: 1.1rem;
}

.hub-tile--large :deep(.n-card__content) {
  min-height: 178px;
}

.hub-tile--large h3 {
  font-size: 1.25rem;
}

.hub-tile--large p {
  flex: 1;
}

.hub-tile--compact :deep(.n-card__content) {
  min-height: 150px;
}

.hub-tile--teal {
  --tile-accent: #54d6be;
  background: rgba(84, 214, 190, 0.08);
}

.hub-tile--blue {
  --tile-accent: #74a7ff;
  background: rgba(116, 167, 255, 0.08);
}

.hub-tile--amber {
  --tile-accent: #e0b15d;
  background: rgba(224, 177, 93, 0.09);
}

.hub-tile--rose {
  --tile-accent: #ef8b9a;
  background: rgba(239, 139, 154, 0.08);
}

.hub-tile--green {
  --tile-accent: #82c76e;
  background: rgba(130, 199, 110, 0.08);
}

.hub-tile--slate {
  --tile-accent: #aeb7c2;
  background: rgba(174, 183, 194, 0.08);
}

.hub-tile--cyan {
  --tile-accent: #62d4e8;
  background: rgba(98, 212, 232, 0.08);
}

@media (max-width: 760px) {
  .home {
    padding: 0.85rem 0.85rem 2rem;
  }

  .home-hero {
    min-height: auto;
  }

  .home-hero__visual {
    display: none;
  }

  .launch-band,
  .section-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .launch-band__meta {
    text-align: left;
    min-width: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .signal,
  .launch-band,
  .hub-tile--stagger-0,
  .hub-tile--stagger-1 {
    animation: none;
  }

  .hub-tile:hover,
  .hub-tile:focus-visible {
    transform: none;
  }
}
</style>
