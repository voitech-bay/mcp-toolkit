<script setup lang="ts">
import { ref } from "vue";
import type { LatestRows } from "../types";

defineProps<{ latest: LatestRows }>();

const activeTab = ref<keyof LatestRows>("contacts");

const tabs: { key: keyof LatestRows; label: string }[] = [
  { key: "contacts", label: "Contacts" },
  { key: "linkedin_messages", label: "LinkedIn messages" },
  { key: "senders", label: "Senders" },
];

function formatCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function keysFromRows(rows: Record<string, unknown>[]): string[] {
  const set = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => set.add(k)));
  return Array.from(set).sort();
}
</script>

<template>
  <div class="latest-tables">
    <h3 class="latest-title">Latest rows (newest first)</h3>
    <div class="tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.label }} ({{ latest[t.key].length }})
      </button>
    </div>
    <div class="table-wrap">
      <table v-if="latest[activeTab].length > 0" class="data-table">
        <thead>
          <tr>
            <th v-for="k in keysFromRows(latest[activeTab])" :key="k" scope="col">
              {{ k }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in latest[activeTab]" :key="i">
            <td v-for="k in keysFromRows(latest[activeTab])" :key="k" class="cell">
              {{ formatCell(row[k]) }}
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">No rows</p>
    </div>
  </div>
</template>

<style scoped>
.latest-tables {
  margin-top: 0.5rem;
}
.latest-title {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0 0 0.75rem 0;
  color: var(--muted);
}
.tabs {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 1rem;
}
.tabs button {
  padding: 0.4rem 0.75rem;
  font-size: 0.85rem;
  border-radius: 6px;
}
.tabs button.active {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: white;
}
.table-wrap {
  overflow: auto;
  max-height: 360px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
.data-table th,
.data-table td {
  padding: 0.5rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.data-table th {
  position: sticky;
  top: 0;
  background: var(--surface);
  color: var(--muted);
  font-weight: 500;
  white-space: nowrap;
}
.data-table td.cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.data-table tr:hover td {
  background: rgba(255, 255, 255, 0.02);
}
.empty {
  padding: 1.5rem;
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}
</style>
