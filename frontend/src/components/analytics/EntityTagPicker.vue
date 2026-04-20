<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NButton, NTag, NText, NTooltip } from "naive-ui";

interface EntityTagItem {
  id: string;
  label: string;
  meta?: string;
  tooltip?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string[];
    items: EntityTagItem[];
    title: string;
    loading?: boolean;
    badgeLimit?: number;
  }>(),
  {
    loading: false,
    badgeLimit: 25,
  }
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string[]): void;
}>();

const expanded = ref(false);

const rowsShown = computed(() => {
  if (expanded.value || props.items.length <= props.badgeLimit) return props.items;
  return props.items.slice(0, props.badgeLimit);
});

const hasOverflow = computed(() => props.items.length > props.badgeLimit);

watch(
  () => props.items.length,
  (n) => {
    if (n <= props.badgeLimit) expanded.value = false;
  }
);

function isSelected(id: string): boolean {
  return props.modelValue.includes(id);
}

function toggle(id: string): void {
  if (isSelected(id)) {
    emit(
      "update:modelValue",
      props.modelValue.filter((x) => x !== id)
    );
  } else {
    emit("update:modelValue", [...props.modelValue, id]);
  }
}

function selectAll(): void {
  emit(
    "update:modelValue",
    props.items.map((x) => x.id)
  );
}

function clearAll(): void {
  emit("update:modelValue", []);
}
</script>

<template>
  <div class="entity-tag-picker">
    <div class="entity-tag-picker__head">
      <span class="entity-tag-picker__title">{{ title }}</span>
      <div class="entity-tag-picker__actions">
        <NButton
          size="tiny"
          quaternary
          :disabled="loading || !hasOverflow"
          @click="expanded = !expanded"
        >
          {{ expanded ? "Show less" : `Show all (${items.length})` }}
        </NButton>
        <NButton size="tiny" quaternary :disabled="loading" @click="selectAll">All</NButton>
        <NButton size="tiny" quaternary :disabled="loading" @click="clearAll">Clear</NButton>
      </div>
    </div>
    <div class="entity-tag-picker__tags">
      <NTooltip
        v-for="item in rowsShown"
        :key="`entity-tag-${item.id}`"
        placement="top"
      >
        <template #trigger>
          <NTag
            size="small"
            :type="isSelected(item.id) ? 'primary' : 'default'"
            :bordered="isSelected(item.id)"
            round
            :class="[
              'entity-tag-picker__tag',
              { 'entity-tag-picker__tag--active': isSelected(item.id) },
            ]"
            :disabled="loading"
            @click="toggle(item.id)"
          >
            <span class="entity-tag-picker__tag-name">{{ item.label }}</span>
            <span v-if="item.meta" class="entity-tag-picker__tag-meta">{{ item.meta }}</span>
          </NTag>
        </template>
        <NText>{{ item.tooltip ?? item.label }}</NText>
      </NTooltip>
    </div>
  </div>
</template>

<style scoped>
.entity-tag-picker {
  width: 100%;
}

.entity-tag-picker__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem 0.75rem;
  margin-bottom: 0.35rem;
}

.entity-tag-picker__title {
  font-weight: 600;
}

.entity-tag-picker__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.15rem;
}

.entity-tag-picker__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.entity-tag-picker__tag {
  cursor: pointer;
  user-select: none;
  max-width: 100%;
}

.entity-tag-picker__tag:not(.entity-tag-picker__tag--active) {
  opacity: 0.78;
}

.entity-tag-picker__tag--active {
  opacity: 1;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.22) inset;
}

.entity-tag-picker__tag :deep(.n-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 0.15em;
}

.entity-tag-picker__tag-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.entity-tag-picker__tag-meta {
  flex: 0 0 auto;
  font-size: 0.7rem;
  font-weight: 600;
  opacity: 0.82;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
</style>
