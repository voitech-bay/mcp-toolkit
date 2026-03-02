<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { StateResponse, SyncResult } from "./types";
import CountCards from "./components/CountCards.vue";
import LatestTables from "./components/LatestTables.vue";

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
</script>

<template>
  <div class="app">
    <header class="header">
      <h1>MCP Toolkit</h1>
      <p class="subtitle">
        MCP endpoint: <a href="/api/mcp" target="_blank" rel="noopener">/api/mcp</a>
      </p>
    </header>

    <main class="main">
      <section class="section">
        <div class="section-header">
          <h2>Supabase state</h2>
          <div class="actions">
            <button type="button" :disabled="loading" @click="loadState()">
              {{ loading ? "Loading…" : "Refresh" }}
            </button>
            <button type="button" class="primary" :disabled="syncing" @click="runSync()">
              {{ syncing ? "Syncing…" : "Sync from source" }}
            </button>
          </div>
        </div>
        <p v-if="stateError" class="error">{{ stateError }}</p>
        <CountCards v-if="state?.counts" :counts="state.counts" />
        <LatestTables v-if="state?.latest" :latest="state.latest" />
        <p v-if="state?.latestError" class="muted small">
          Latest rows: {{ state.latestError }}
        </p>
      </section>

      <section v-if="syncResult" class="section sync-result">
        <h3>Last sync result</h3>
        <pre>{{ JSON.stringify(syncResult, null, 2) }}</pre>
      </section>
    </main>
  </div>
</template>

<style scoped>
.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}
.header {
  margin-bottom: 2rem;
}
.header h1 {
  font-size: 1.75rem;
  font-weight: 600;
  margin: 0 0 0.25rem 0;
}
.subtitle {
  margin: 0;
  color: var(--muted);
  font-size: 0.95rem;
}
.main {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
}
.section-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.section-header h2 {
  font-size: 1.15rem;
  font-weight: 600;
  margin: 0;
}
.actions {
  display: flex;
  gap: 0.5rem;
}
.error {
  color: var(--error);
  margin: 0 0 1rem 0;
  font-size: 0.9rem;
}
.muted.small {
  color: var(--muted);
  font-size: 0.85rem;
  margin: 0.5rem 0 0 0;
}
.sync-result pre {
  margin: 0;
  padding: 1rem;
  background: var(--bg);
  border-radius: 8px;
  font-size: 0.8rem;
  overflow: auto;
  max-height: 280px;
}
.sync-result h3 {
  font-size: 1rem;
  margin: 0 0 0.75rem 0;
}
</style>
