<script setup lang="ts">
import { ref, computed, inject } from "vue";
import { Handle, Position } from "@vue-flow/core";
import type { NodeProps } from "@vue-flow/core";
import {
  NButton,
  NCheckbox,
  NDropdown,
  NModal,
  NDataTable,
  NInput,
  NSpace,
  NSpin,
} from "naive-ui";
import type { DataTableColumns, DataTableRowKey, DropdownOption } from "naive-ui";
import { MoreHorizontalIcon } from "lucide-vue-next";
import {
  CONTEXT_BUILDER_KEY,
  type HypothesisNodeData,
  type ProjectCompanyListItem,
} from "../../composables/useContextBuilder";

const props = defineProps<NodeProps<HypothesisNodeData>>();
const ctx = inject(CONTEXT_BUILDER_KEY)!;

const checked = computed({
  get: () => ctx.isSelected(props.id),
  set: (v: boolean) => ctx.setSelected(props.id, v),
});

// ── Add Companies picker ──────────────────────────────────────────────────────

const showPicker = ref(false);
const pickerSearch = ref("");
const pickerData = ref<ProjectCompanyListItem[]>([]);
const pickerLoading = ref(false);
const selectedKeys = ref<DataTableRowKey[]>([]);

const filteredData = computed(() => {
  const q = pickerSearch.value.trim().toLowerCase();
  if (!q) return pickerData.value;
  return pickerData.value.filter(
    (c) =>
      (c.name ?? "").toLowerCase().includes(q) ||
      (c.domain ?? "").toLowerCase().includes(q)
  );
});

async function openPicker() {
  showPicker.value = true;
  pickerSearch.value = "";
  selectedKeys.value = [];
  pickerData.value = [];
  pickerLoading.value = true;
  try {
    pickerData.value = await ctx.fetchProjectCompaniesList();
  } finally {
    pickerLoading.value = false;
  }
}

function applyPicker() {
  for (const key of selectedKeys.value) {
    const item = pickerData.value.find((c) => c.project_company_id === key);
    if (item) ctx.addCompany(item, props.id);
  }
  showPicker.value = false;
}

// ── Dropdown ──────────────────────────────────────────────────────────────────

const dropdownOptions: DropdownOption[] = [
  { key: "add-companies", label: "Add companies" },
  { key: "divider", type: "divider" },
  { key: "remove", label: "Remove" },
];

function onSelect(key: string | number) {
  if (key === "add-companies") openPicker();
  else if (key === "remove") ctx.removeNode(props.id);
}

// ── Table columns ─────────────────────────────────────────────────────────────

const columns: DataTableColumns<ProjectCompanyListItem> = [
  { type: "selection", fixed: "left" },
  {
    key: "name",
    title: "Company",
    ellipsis: { tooltip: true },
    render: (r) => r.name ?? "—",
  },
  {
    key: "domain",
    title: "Domain",
    ellipsis: { tooltip: true },
    render: (r) => r.domain ?? "—",
  },
];
</script>

<template>
  <!-- Receives edge from center (below), emits edges to companies (also below) -->
  <Handle type="target" :position="Position.Bottom" id="tgt" />
  <Handle type="source" :position="Position.Top" id="src" />

  <div class="hyp-node nopan">
    <div class="hyp-node__header">
      <div class="hyp-node__left">
        <NCheckbox v-model:checked="checked" size="small" />
        <span class="hyp-node__badge">Hypothesis</span>
      </div>
      <NDropdown
        trigger="click"
        :options="dropdownOptions"
        @select="onSelect"
        placement="bottom-end"
      >
        <NButton quaternary size="tiny" class="hyp-node__menu">
          <MoreHorizontalIcon :size="14" />
        </NButton>
      </NDropdown>
    </div>
    <div class="hyp-node__name">{{ data.name }}</div>
    <div v-if="data.description" class="hyp-node__desc">
      {{ data.description }}
    </div>
  </div>

  <NModal
    v-model:show="showPicker"
    preset="card"
    title="Add Companies to Hypothesis"
    style="width: 600px"
  >
    <NInput
      v-model:value="pickerSearch"
      placeholder="Search by name or domain…"
      clearable
      size="small"
      style="margin-bottom: 12px"
    />
    <div v-if="pickerLoading" class="picker-loading"><NSpin /></div>
    <NDataTable
      v-else
      :columns="columns"
      :data="filteredData"
      :row-key="(r: ProjectCompanyListItem) => r.project_company_id"
      v-model:checked-row-keys="selectedKeys"
      size="small"
      :max-height="300"
      :scroll-x="500"
    />
    <template #footer>
      <NSpace justify="end">
        <NButton @click="showPicker = false">Cancel</NButton>
        <NButton
          type="primary"
          :disabled="selectedKeys.length === 0"
          @click="applyPicker"
        >
          Add{{ selectedKeys.length > 0 ? ` (${selectedKeys.length})` : "" }}
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.hyp-node {
  min-width: 220px;
  max-width: 280px;
  background: rgba(20, 22, 30, 0.96);
  border: 1.5px solid rgba(251, 191, 36, 0.32);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 0 14px rgba(251, 191, 36, 0.08), 0 3px 10px rgba(0, 0, 0, 0.45);
  cursor: default;
  user-select: none;
}

.hyp-node__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
}

.hyp-node__left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hyp-node__badge {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(251, 191, 36, 0.65);
}

.hyp-node__menu {
  opacity: 0;
  transition: opacity 0.15s;
}

.hyp-node:hover .hyp-node__menu {
  opacity: 1;
}

.hyp-node__name {
  font-size: 0.87rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hyp-node__desc {
  font-size: 0.74rem;
  color: rgba(255, 255, 255, 0.42);
  margin-top: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.picker-loading {
  text-align: center;
  padding: 24px 0;
}
</style>
