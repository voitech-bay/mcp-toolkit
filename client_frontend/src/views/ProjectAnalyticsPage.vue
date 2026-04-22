<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { NCard, NText } from "naive-ui";
import FlowDashboardPage from "@shared/views/FlowDashboardPage.vue";
import { useProjectStore } from "@shared/stores/project";

const route = useRoute();
const projectStore = useProjectStore();

const latestAnalyticsSnapshot = ref<string | null>(null);
const headerImageUrl = ref<string | null>(null);
const headerImageFailed = ref(false);

function isAllowedHeaderImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function formatSnapshot(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(`${value}T12:00:00`).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}

const latestAnalyticsSnapshotLabel = computed(() => formatSnapshot(latestAnalyticsSnapshot.value));

watch(
  () => route.params.projectId,
  async (projectId) => {
    const nextProjectId = typeof projectId === "string" && projectId.length > 0 ? projectId : null;
    projectStore.selectProject(nextProjectId);
    latestAnalyticsSnapshot.value = null;
    headerImageUrl.value = null;
    headerImageFailed.value = false;
    if (!nextProjectId) return;
    try {
      const r = await fetch(`/api/project-dashboard?projectId=${encodeURIComponent(nextProjectId)}`);
      const data = (await r.json()) as { lastAnalyticsDate?: string | null; imageUrl?: string | null };
      if (!r.ok) return;
      latestAnalyticsSnapshot.value =
        typeof data.lastAnalyticsDate === "string" && data.lastAnalyticsDate.length > 0
          ? data.lastAnalyticsDate
          : null;
      const rawImg =
        typeof data.imageUrl === "string" && data.imageUrl.trim().length > 0 ? data.imageUrl.trim() : null;
      headerImageUrl.value = rawImg && isAllowedHeaderImageUrl(rawImg) ? rawImg : null;
    } catch {
      latestAnalyticsSnapshot.value = null;
      headerImageUrl.value = null;
    }
  },
  { immediate: true }
);
</script>

<template>
  <div class="client-analytics-page">
    <NCard size="small" class="client-analytics-page__header">
      <div class="client-analytics-page__header-inner">
        <img
          v-if="headerImageUrl && !headerImageFailed"
          :src="headerImageUrl"
          alt=""
          class="client-analytics-page__logo"
          referrerpolicy="no-referrer"
          @error="headerImageFailed = true"
        />
        <div class="client-analytics-page__header-text">
          <div class="client-analytics-page__title">Voitech outreach analytics</div>
          <NText depth="3">Latest data snapshot: {{ latestAnalyticsSnapshotLabel }}</NText>
        </div>
      </div>
    </NCard>
    <FlowDashboardPage />
  </div>
</template>

<style scoped>
.client-analytics-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}

.client-analytics-page__header {
  max-width: min(1720px, 96vw);
  margin: 0 auto;
  width: 100%;
}

.client-analytics-page__header-inner {
  display: flex;
  align-items: center;
  gap: 14px;
}

/* Natural aspect ratio; cap height so the header stays compact. */
.client-analytics-page__logo {
  display: block;
  flex-shrink: 0;
  max-height: 48px;
  width: auto;
  height: auto;
}

.client-analytics-page__header-text {
  min-width: 0;
}

.client-analytics-page__title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
}
</style>
