<script setup lang="ts">
import type { TableCounts } from "../types";

defineProps<{ counts: TableCounts }>();

const labels: { key: keyof TableCounts; label: string }[] = [
  { key: "contacts", label: "Contacts" },
  { key: "linkedin_messages", label: "LinkedIn messages" },
  { key: "senders", label: "Senders" },
];

function barWidth(n: number): string {
  const max = 10000;
  if (n <= 0) return "0%";
  const pct = Math.min(100, (n / max) * 100);
  return `${pct}%`;
}
</script>

<template>
  <div class="count-cards">
    <div v-for="item in labels" :key="item.key" class="card">
      <span class="card-label">{{ item.label }}</span>
      <span class="card-value">{{ counts[item.key].toLocaleString() }}</span>
      <div class="bar" :style="{ width: barWidth(counts[item.key]) }" />
    </div>
  </div>
</template>

<style scoped>
.count-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.card {
  position: relative;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1rem 1.25rem;
  overflow: hidden;
}
.card-label {
  display: block;
  font-size: 0.8rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.25rem;
}
.card-value {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--accent);
}
.card .bar {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  background: var(--accent-dim);
  border-radius: 0 2px 0 0;
  max-width: 100%;
  transition: width 0.4s ease;
}
</style>
