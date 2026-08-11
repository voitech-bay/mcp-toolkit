<script setup lang="ts">
import { computed } from "vue";
import { NTooltip } from "naive-ui";

const ICONS = [
  {
    key: "own_domain",
    on: "Own domain",
    off: "No own domain",
    svg: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  },
  {
    key: "linkedin",
    on: "LinkedIn present",
    off: "No LinkedIn",
    svg: '<rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 10v7M7 7.5v.5M11 17v-4.5a2.5 2.5 0 015 0V17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  },
  {
    key: "store_catalog",
    on: "Store catalog",
    off: "No store catalog",
    svg: '<path d="M4 8l8-5 8 5v9a2 2 0 01-2 2H6a2 2 0 01-2-2V8z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 21V12h6v9" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  },
  {
    key: "icp_contact_email",
    on: "ICP contact with email",
    off: "No contact with email",
    svg: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 7l8.5 6 8.5-6" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  },
  {
    key: "release_in_window",
    on: "Release in window",
    off: "Release not in window",
    svg: '<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  },
  {
    key: "portfolio_hit",
    on: "Portfolio hit",
    off: "No portfolio hit",
    svg: '<path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  },
  {
    key: "art_or_production_jobs",
    on: "Art/production jobs",
    off: "No jobs found",
    svg: '<rect x="3" y="7" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  },
  {
    key: "money",
    on: "Funding / money signal",
    off: "No money signal",
    svg: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v10M9.5 9.5c0-1.1 1.1-1.8 2.5-1.8s2.5.7 2.5 1.8-1.1 1.6-2.5 1.9-2.5.8-2.5 1.9 1.1 1.8 2.5 1.8 2.5-.7 2.5-1.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  },
] as const;

const props = withDefaults(
  defineProps<{
    score?: Record<string, boolean> | null;
    scoreTotal?: number | null;
    showTotal?: boolean;
  }>(),
  { score: null, scoreTotal: null, showTotal: true }
);

const bits = computed(() =>
  ICONS.map((def) => ({
    key: def.key,
    labelOn: def.on,
    labelOff: def.off,
    svg: def.svg,
    active: Boolean(props.score?.[def.key]),
  }))
);

const total = computed(() => {
  if (props.scoreTotal != null) return props.scoreTotal;
  return bits.value.filter((b) => b.active).length;
});
</script>

<template>
  <span class="wlr-score">
    <span v-if="showTotal" class="wlr-sc">{{ total }} / 8</span>
    <span class="wlr-icos" aria-label="Score datapoints">
      <NTooltip v-for="bit in bits" :key="bit.key" placement="top">
        <template #trigger>
          <span
            class="wlr-ico"
            :class="{ off: !bit.active }"
            v-html="`<svg viewBox='0 0 24 24' width='16' height='16' aria-hidden='true'>${bit.svg}</svg>`"
          />
        </template>
        {{ bit.active ? bit.labelOn : bit.labelOff }}
      </NTooltip>
    </span>
  </span>
</template>

<style scoped>
.wlr-score {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wlr-sc {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #2563eb;
  white-space: nowrap;
}
.wlr-icos {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}
.wlr-ico {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid #2563eb;
  border-radius: 6px;
  color: #fff;
  background: #2563eb;
}
.wlr-ico.off {
  color: #c4c9d2;
  background: #f4f5f7;
  border-color: #e5e7eb;
}
.wlr-ico :deep(svg) {
  display: block;
}
</style>
