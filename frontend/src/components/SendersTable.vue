<script setup lang="ts">
import { h, toRef, computed } from "vue";
import { NButton, NPopover } from "naive-ui";
import type { DataTableFilterState } from "naive-ui";
import { MessageCircle } from "lucide-vue-next";
import { useDataTableColumns } from "../composables/useDataTableColumns";
import DataTableSection from "./DataTableSection.vue";

const props = defineProps<{
  data: Record<string, unknown>[];
  loading: boolean;
  error: string;
  filterState: DataTableFilterState;
  visibleColumnKeys: string[];
  totalItemCount: number;
  page: number;
  pageSize: number;
  pageSizes: number[];
  /** Applied search term for highlighting matches in searchable columns. */
  searchTerm?: string;
}>();

const emit = defineEmits<{
  "update:filters": [value: DataTableFilterState];
  "update:page": [value: number];
  "update:pageSize": [value: number];
  action: [row: Record<string, unknown>];
}>();

const highlightTerm = computed(() => (props.searchTerm ?? "").trim());
const { tableColumns, scrollX } = useDataTableColumns(
  toRef(props, "data"),
  toRef(props, "filterState"),
  toRef(props, "visibleColumnKeys"),
  (v) => emit("update:filters", v),
  (row) => {
    const tooltip = "Find all conversations by sender";
    return h(
      NPopover,
      { trigger: "hover", placement: "top", showArrow: true },
      {
        default: () => tooltip,
        trigger: () =>
          h(
            NButton,
            {
              size: "small",
              quaternary: true,
              onClick: () => emit("action", row),
            },
            { default: () => h(MessageCircle, { size: 16 }) }
          ),
      }
    );
  },
  { highlightTerm, highlightColumnKeys: ["first_name", "last_name"] }
);
</script>

<template>
  <DataTableSection
    :columns="tableColumns"
    :data="data"
    :loading="loading"
    :error="error"
    :total-item-count="totalItemCount"
    :page="page"
    :page-size="pageSize"
    :page-sizes="pageSizes"
    :filter-state="filterState"
    :scroll-x="scrollX"
    @update:filters="emit('update:filters', $event)"
    @update:page="emit('update:page', $event)"
    @update:page-size="emit('update:pageSize', $event)"
  />
</template>
