<script setup lang="ts">
import { h, toRef, computed } from "vue";
import { NButton, NPopover, NSpace } from "naive-ui";
import type { DataTableFilterState } from "naive-ui";
import { MessageCircle, User, UserCircle } from "lucide-vue-next";
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
  /** Applied search term for highlighting matches in the text column. */
  searchTerm?: string;
}>();

const emit = defineEmits<{
  "update:filters": [value: DataTableFilterState];
  "update:page": [value: number];
  "update:pageSize": [value: number];
  action: [row: Record<string, unknown>];
  goToContact: [row: Record<string, unknown>];
  goToSender: [row: Record<string, unknown>];
}>();

const highlightTerm = computed(() => (props.searchTerm ?? "").trim());
const { tableColumns, scrollX } = useDataTableColumns(
  toRef(props, "data"),
  toRef(props, "filterState"),
  toRef(props, "visibleColumnKeys"),
  (v) => emit("update:filters", v),
  (row) => {
    const hasLeadUuid = row.lead_uuid != null && String(row.lead_uuid).trim() !== "";
    const conversationBtn = h(
      NPopover,
      { trigger: "hover", placement: "top", showArrow: true },
      {
        default: () => "Find conversation by message",
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
    const hasSenderUuid = row.sender_profile_uuid != null && String(row.sender_profile_uuid).trim() !== "";
    const goToContactBtn = hasLeadUuid
      ? h(
          NPopover,
          { trigger: "hover", placement: "top", showArrow: true },
          {
            default: () => "Go to contact",
            trigger: () =>
              h(
                NButton,
                {
                  size: "small",
                  quaternary: true,
                  onClick: () => emit("goToContact", row),
                },
                { default: () => h(User, { size: 16 }) }
              ),
          }
        )
      : null;
    const goToSenderBtn = hasSenderUuid
      ? h(
          NPopover,
          { trigger: "hover", placement: "top", showArrow: true },
          {
            default: () => "Go to sender",
            trigger: () =>
              h(
                NButton,
                {
                  size: "small",
                  quaternary: true,
                  onClick: () => emit("goToSender", row),
                },
                { default: () => h(UserCircle, { size: 16 }) }
              ),
          }
        )
      : null;
    return h(NSpace, { size: 4 }, [conversationBtn, goToContactBtn, goToSenderBtn].filter(Boolean));
  },
  { highlightTerm, highlightColumnKeys: ["text"] }
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
