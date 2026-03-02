<script setup lang="ts">
import { NDataTable, NEmpty, NAlert } from "naive-ui";
import type { DataTableColumns, DataTableFilterState } from "naive-ui";

withDefaults(
  defineProps<{
    columns: DataTableColumns<Record<string, unknown>>;
    data: Record<string, unknown>[];
    loading?: boolean;
    error?: string;
    totalItemCount: number;
    page: number;
    pageSize: number;
    pageSizes: number[];
    filterState: DataTableFilterState;
    scrollX: number;
  }>(),
  { loading: false, error: "" }
);

const emit = defineEmits<{
  "update:filters": [value: DataTableFilterState];
  "update:page": [value: number];
  "update:pageSize": [value: number];
}>();

function onUpdateFilters(f: DataTableFilterState) {
  emit("update:filters", f);
}
function onUpdatePage(p: number) {
  emit("update:page", p);
}
function onUpdatePageSize(ps: number) {
  emit("update:pageSize", ps);
}
</script>

<template>
  <NAlert v-if="error" type="error" class="table-error">
    {{ error }}
  </NAlert>
  <NDataTable
    v-if="data.length > 0 || loading"
    :columns="columns"
    :data="data"
    :filters="filterState"
    :loading="loading"
    :bordered="false"
    size="small"
    :max-height="600"
    :scroll-x="scrollX"
    remote
    :pagination="{
      page,
      pageSize,
      itemCount: totalItemCount,
      showSizePicker: true,
      pageSizes,
      onUpdatePage: onUpdatePage,
      onUpdatePageSize: onUpdatePageSize,
    }"
    @update:filters="onUpdateFilters"
  />
  <NEmpty v-else-if="!loading" description="No rows" />
</template>

<style scoped>
.table-error {
  margin-bottom: 0.5rem;
}
</style>
