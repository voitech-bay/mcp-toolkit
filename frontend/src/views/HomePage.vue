<script setup lang="ts">
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  NH1,
  NH3,
  NCard,
  NGrid,
  NGi,
  NStatistic,
  NSpin,
  NAlert,
  NText,
  NSpace,
} from "naive-ui";
import type { TableCounts } from "../types";
import { useProjectStore } from "../stores/project";

const router = useRouter();
const projectStore = useProjectStore();

interface DashboardPayload {
  lastSyncFinishedAt: string | null;
  lastAnalyticsDate: string | null;
  totalAnalyticsDays: number;
  counts: TableCounts;
  hypothesesTotal: number;
  conversationsTotal: number | null;
  warnings: string[];
}

const loading = ref(false);
const loadError = ref("");
const dashboard = ref<DashboardPayload | null>(null);

function formatDateTime(iso: string | null): string {
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

function formatYmd(ymd: string | null): string {
  if (!ymd) return "—";
  try {
    return new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
  } catch {
    return ymd;
  }
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
</script>

<template>
  <div class="home">
    <div class="home__header">
      <NH1 class="home__title">Overview</NH1>
      <NH3 class="home__subtitle">
        MCP endpoint:
        <a href="/api/mcp" target="_blank" rel="noopener">/api/mcp</a>
      </NH3>
    </div>

    <NSpin :show="loading">
      <div class="home__body">
        <NAlert v-if="loadError" type="error" class="home__alert" :title="loadError" />

        <template v-if="!loadError && dashboard">
          <NAlert
            v-if="dashboard.warnings.length > 0"
            type="warning"
            class="home__alert"
            title="Some metrics could not be loaded"
          >
            <ul class="home__warn-list">
              <li v-for="(w, i) in dashboard.warnings" :key="i">{{ w }}</li>
            </ul>
          </NAlert>

          <NText depth="3" class="home__section-label">Sync & analytics</NText>
          <NGrid :cols="24" :x-gap="12" :y-gap="12" responsive="screen">
            <NGi span="24 m:8">
              <NCard size="small" title="Last sync" class="home__card">
                <NStatistic :value="formatDateTime(dashboard.lastSyncFinishedAt)" tabular-nums />
                <NText depth="3" class="home__hint">When the last pipeline sync finished</NText>
              </NCard>
            </NGi>
            <NGi span="24 m:8">
              <NCard size="small" title="Last analytics day" class="home__card">
                <NStatistic :value="formatYmd(dashboard.lastAnalyticsDate)" tabular-nums />
                <NText depth="3" class="home__hint">Latest date with stored metrics snapshots</NText>
              </NCard>
            </NGi>
            <NGi span="24 m:8">
              <NCard size="small" title="Analytics days collected" class="home__card">
                <NStatistic :value="dashboard.totalAnalyticsDays" tabular-nums />
                <NText depth="3" class="home__hint">Distinct days with analytics data</NText>
              </NCard>
            </NGi>
          </NGrid>

          <NText depth="3" class="home__section-label home__section-label--spaced">Data in this project</NText>
          <NGrid :cols="24" :x-gap="12" :y-gap="12" responsive="screen">
            <NGi span="24 s:12 m:8">
              <NCard size="small" title="Contacts" class="home__card home__card--click" @click="router.push('/contacts')">
                <NStatistic :value="dashboard.counts.contacts" tabular-nums />
              </NCard>
            </NGi>
            <NGi span="24 s:12 m:8">
              <NCard
                size="small"
                title="Companies (in project)"
                class="home__card home__card--click"
                @click="router.push('/companies')"
              >
                <NStatistic :value="dashboard.counts.companies_in_project" tabular-nums />
              </NCard>
            </NGi>
            <NGi span="24 s:12 m:8">
              <NCard size="small" title="GetSales tags" class="home__card home__card--click" @click="router.push('/getsales-tags')">
                <NStatistic :value="dashboard.counts.getsales_tags" tabular-nums />
              </NCard>
            </NGi>
            <NGi span="24 s:12 m:8">
              <NCard size="small" title="Hypotheses" class="home__card home__card--click" @click="router.push('/hypotheses')">
                <NStatistic :value="dashboard.hypothesesTotal" tabular-nums />
              </NCard>
            </NGi>
            <NGi span="24 s:12 m:8">
              <NCard
                size="small"
                title="Conversations"
                class="home__card home__card--click"
                @click="router.push('/conversations')"
              >
                <NStatistic
                  :value="dashboard.conversationsTotal === null ? '—' : dashboard.conversationsTotal"
                  tabular-nums
                />
              </NCard>
            </NGi>
          </NGrid>

          <NSpace class="home__links" size="small">
            <NText depth="3">Quick links:</NText>
            <a class="home__link" href="#" @click.prevent="router.push('/sync')">Sync</a>
            <span class="home__dot">·</span>
            <a class="home__link" href="#" @click.prevent="router.push('/tables')">Tables</a>
          </NSpace>
        </template>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.home {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 2.5rem;
}

.home__header {
  text-align: center;
  margin-bottom: 1.5rem;
}

.home__title {
  font-size: 1.65rem;
  font-weight: 600;
  margin: 0 0 0.35rem 0;
}

.home__subtitle {
  margin: 0;
  opacity: 0.8;
  font-size: 0.95rem;
  font-weight: normal;
}

.home__subtitle a {
  color: var(--n-primary-color);
}

.home__body {
  min-height: 120px;
}

.home__alert {
  margin-bottom: 1rem;
}

.home__warn-list {
  margin: 0.35rem 0 0;
  padding-left: 1.2rem;
  font-size: 13px;
}

.home__section-label {
  display: block;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.5rem;
}

.home__section-label--spaced {
  margin-top: 1.25rem;
}

.home__card {
  height: 100%;
}

.home__card--click {
  cursor: pointer;
  transition: box-shadow 0.15s ease, transform 0.12s ease;
}

.home__card--click:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
}

.home__hint {
  display: block;
  margin-top: 0.5rem;
  font-size: 12px;
  line-height: 1.35;
}

.home__links {
  margin-top: 1.25rem;
  align-items: center;
}

.home__link {
  color: var(--n-primary-color);
  cursor: pointer;
  text-decoration: none;
}

.home__link:hover {
  text-decoration: underline;
}

.home__dot {
  opacity: 0.45;
}
</style>
