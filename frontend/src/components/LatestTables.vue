<script setup lang="ts">
import { ref } from "vue";
import type { LatestRows } from "../types";
import { NTabs, NTabPane, NDataTable, NEmpty } from "naive-ui";
import type { DataTableColumns } from "naive-ui";

const props = defineProps<{ latest: LatestRows }>();

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

function buildColumns(rows: Record<string, unknown>[]): DataTableColumns<Record<string, unknown>> {
  return keysFromRows(rows).map((key) => ({
    width: 200,
    title: key,
    key,
    ellipsis: { tooltip: true },
    render(row: Record<string, unknown>) {
      return formatCell(row[key]);
    },
  }));
}
</script>

<template>
  <div class="latest-tables">
    <h3 class="latest-title">Latest rows (newest first)</h3>
    <NTabs v-model:value="activeTab" type="line" size="medium">
      <NTabPane
        v-for="t in tabs"
        :key="t.key"
        :name="t.key"
        :tab="`${t.label} (${props.latest[t.key].length})`"
      >
        <NDataTable
          v-if="props.latest[activeTab].length > 0"
          :columns="buildColumns(props.latest[activeTab])"
          :data="props.latest[activeTab]"
          :bordered="false"
          size="small"
          :max-height="360"
          virtual-scroll
        />
        <NEmpty v-else description="No rows" />
      </NTabPane>
    </NTabs>
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
  opacity: 0.85;
}
</style>
