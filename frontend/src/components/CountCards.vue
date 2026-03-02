<script setup lang="ts">
import type { TableCounts } from "../types";
import { NGrid, NGi, NCard, NStatistic, NProgress } from "naive-ui";

defineProps<{ counts: TableCounts }>();

const labels: { key: keyof TableCounts; label: string }[] = [
  { key: "contacts", label: "Contacts" },
  { key: "linkedin_messages", label: "LinkedIn messages" },
  { key: "senders", label: "Senders" },
];

function progressPercent(n: number): number {
  const max = 10000;
  if (n <= 0) return 0;
  return Math.min(100, (n / max) * 100);
}
</script>

<template>
  <NGrid :cols="3" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
    <NGi v-for="item in labels" :key="item.key" span="1 600:1 800:1">
      <NCard size="small" class="stat-card">
        <NStatistic :label="item.label">
          <template #default>
            {{ counts[item.key].toLocaleString() }}
          </template>
        </NStatistic>
        <NProgress
          type="line"
          :percentage="progressPercent(counts[item.key])"
          :show-indicator="false"
          :height="4"
          :border-radius="2"
          class="stat-progress"
        />
      </NCard>
    </NGi>
  </NGrid>
</template>

<style scoped>
.stat-card {
  margin-bottom: 1rem;
}
.stat-progress {
  margin-top: 8px;
}
</style>
