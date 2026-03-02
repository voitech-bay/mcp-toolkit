<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useDark } from "@vueuse/core";
import type { StateResponse, SyncResult } from "./types";
import CountCards from "./components/CountCards.vue";
import LatestTables from "./components/LatestTables.vue";
import { NConfigProvider, darkTheme, lightTheme, NH1, NH3, NCard, NButton, NSpin, NAlert, NSpace, NCode } from "naive-ui";
import { MoonIcon, SunIcon } from "lucide-vue-next";

// VueUse: dark theme by default, persisted in localStorage (vueuse-color-scheme)
const isDark = useDark();
isDark.value = true;

const naiveTheme = computed(() => (isDark.value ? darkTheme : lightTheme));

const state = ref<StateResponse | null>(null);
const stateError = ref("");
const loading = ref(true);
const syncing = ref(false);
const syncResult = ref<SyncResult | null>(null);

async function loadState(latestLimit = 10) {
  stateError.value = "";
  loading.value = true;
  try {
    const r = await fetch(`/api/supabase-state?latest=${latestLimit}`);
    const data = await r.json();
    if (!r.ok) {
      state.value = null;
      stateError.value = data.error ?? "Failed to load state";
      return;
    }
    state.value = data;
  } catch (e) {
    state.value = null;
    stateError.value = e instanceof Error ? e.message : "Request failed";
  } finally {
    loading.value = false;
  }
}

async function runSync() {
  stateError.value = "";
  syncResult.value = null;
  syncing.value = true;
  try {
    const r = await fetch("/api/supabase-sync", { method: "POST" });
    const data: SyncResult = await r.json();
    syncResult.value = data;
    if (r.ok) await loadState();
    else stateError.value = data.error ?? "Sync failed";
  } catch (e) {
    stateError.value = e instanceof Error ? e.message : "Request failed";
  } finally {
    syncing.value = false;
  }
}

onMounted(() => loadState());
function toggleTheme() {
  isDark.value = !isDark.value;
}
</script>

<template>
  <NConfigProvider :theme="naiveTheme">
    <div class="app">
      <header class="header">
        <NH1 class="title">MCP Toolkit</NH1>
        <NH3 class="subtitle">
          MCP endpoint: <a href="/api/mcp" target="_blank" rel="noopener">/api/mcp</a>
        </NH3>
      </header>

      <main class="main">
        <NCard title="Supabase state" class="section">
          <template #header-extra>
            <NSpace>
              <NButton @click="toggleTheme()">
              
                <SunIcon :size="12" v-if="isDark" />
                <MoonIcon :size="12" v-else />
              </NButton>
              <NButton :loading="loading" @click="loadState()">Refresh</NButton>
              <NButton type="primary" :loading="syncing" @click="runSync()">
                Sync from source
              </NButton>
            </NSpace>
          </template>

          <NSpin :show="loading">
            <NAlert v-if="stateError" type="error" class="mb">
              {{ stateError }}
            </NAlert>
            <CountCards v-if="state?.counts" :counts="state.counts" />
            <LatestTables v-if="state?.latest" :latest="state.latest" :counts="state?.counts" />
            <p v-if="state?.latestError" class="muted small">
              Latest rows: {{ state.latestError }}
            </p>
          </NSpin>
        </NCard>

        <NCard v-if="syncResult" title="Last sync result" class="section">
          <NCode :code="JSON.stringify(syncResult, null, 2)" language="json" word-wrap />
        </NCard>
      </main>
    </div>
  </NConfigProvider>
</template>

<style scoped>
.app {
  max-width: 1600px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}
.header {
  margin-bottom: 2rem;
}
.title {
  font-size: 1.75rem;
  font-weight: 600;
  margin: 0 0 0.25rem 0;
}
.subtitle {
  margin: 0;
  opacity: 0.8;
  font-size: 0.95rem;
}
.main {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.section {
  border-radius: 12px;
}
.mb {
  margin-bottom: 1rem;
}
.muted.small {
  opacity: 0.7;
  font-size: 0.85rem;
  margin: 0.5rem 0 0 0;
}
</style>
