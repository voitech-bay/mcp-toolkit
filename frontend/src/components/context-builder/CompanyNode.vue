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
  NTag,
} from "naive-ui";
import type { DataTableColumns, DataTableRowKey, DropdownOption } from "naive-ui";
import { MoreHorizontalIcon } from "lucide-vue-next";
import {
  CONTEXT_BUILDER_KEY,
  type CompanyNodeData,
  type ContactListItem,
} from "../../composables/useContextBuilder";

const props = defineProps<NodeProps<CompanyNodeData>>();
const ctx = inject(CONTEXT_BUILDER_KEY)!;

const checked = computed({
  get: () => ctx.isSelected(props.id),
  set: (v: boolean) => ctx.setSelected(props.id, v),
});

const hasCtx = computed(() => ctx.hasCompanyContext(props.data.entityId));

// ── Add Contacts picker ───────────────────────────────────────────────────────

const showPicker = ref(false);
const pickerSearch = ref("");
const pickerData = ref<ContactListItem[]>([]);
const pickerLoading = ref(false);
const selectedKeys = ref<DataTableRowKey[]>([]);

type ContactRow = ContactListItem & { __key: number; __label: string };

const filteredData = computed(() => {
  const q = pickerSearch.value.trim().toLowerCase();
  if (!q) return pickerData.value;
  return pickerData.value.filter((c) => {
    const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.toLowerCase();
    return name.includes(q) || (c.position ?? "").toLowerCase().includes(q);
  });
});

const pickerRows = computed<ContactRow[]>(() =>
  filteredData.value.map((c, i) => ({
    ...c,
    __key: i,
    __label: [c.first_name, c.last_name].filter(Boolean).join(" ") || "—",
  }))
);

async function openPicker() {
  showPicker.value = true;
  pickerSearch.value = "";
  selectedKeys.value = [];
  pickerData.value = [];
  pickerLoading.value = true;
  try {
    pickerData.value = await ctx.fetchContactsForCompany(props.data.entityId);
  } finally {
    pickerLoading.value = false;
  }
}

function applyPicker() {
  for (const key of selectedKeys.value) {
    const row = pickerRows.value.find((r) => r.__key === key);
    if (row) ctx.addContact(row, props.id);
  }
  showPicker.value = false;
}

// ── Dropdown ──────────────────────────────────────────────────────────────────

const dropdownOptions: DropdownOption[] = [
  { key: "add-contacts", label: "Add contacts" },
  { key: "divider", type: "divider" },
  { key: "remove", label: "Remove" },
];

function onSelect(key: string | number) {
  if (key === "add-contacts") openPicker();
  else if (key === "remove") ctx.removeNode(props.id);
}

// ── Table columns ─────────────────────────────────────────────────────────────

const columns: DataTableColumns<ContactRow> = [
  { type: "selection", fixed: "left" },
  {
    key: "name",
    title: "Name",
    render: (r) => r.__label,
  },
  {
    key: "position",
    title: "Position",
    ellipsis: { tooltip: true },
    render: (r) => r.position ?? "—",
  },
];
</script>

<template>
  <!-- Receives from hypothesis (above) or center (left/right); emits to contacts (below) -->
  <Handle type="target" :position="Position.Bottom" id="tgt" />
  <Handle type="source" :position="Position.Top" id="src" />

  <div class="co-node nopan" :class="{ 'co-node--has-ctx': hasCtx }">
    <div class="co-node__header">
      <div class="co-node__left">
        <NCheckbox v-model:checked="checked" size="small" />
        <span class="co-node__badge">Company</span>
        <NTag v-if="hasCtx" size="tiny" type="success" :bordered="false">CTX</NTag>
      </div>
      <NDropdown
        trigger="click"
        :options="dropdownOptions"
        @select="onSelect"
        placement="bottom-end"
      >
        <NButton quaternary size="tiny" class="co-node__menu">
          <MoreHorizontalIcon :size="14" />
        </NButton>
      </NDropdown>
    </div>
    <div class="co-node__name">{{ data.name ?? "—" }}</div>
    <div v-if="data.domain" class="co-node__domain">{{ data.domain }}</div>
  </div>

  <NModal
    v-model:show="showPicker"
    preset="card"
    title="Add Contacts"
    style="width: 540px"
  >
    <NInput
      v-model:value="pickerSearch"
      placeholder="Search by name or position…"
      clearable
      size="small"
      style="margin-bottom: 12px"
    />
    <div v-if="pickerLoading" class="picker-loading"><NSpin /></div>
    <NDataTable
      v-else
      :columns="columns"
      :data="pickerRows"
      :row-key="(r: ContactRow) => r.__key"
      v-model:checked-row-keys="selectedKeys"
      size="small"
      :max-height="300"
      :scroll-x="440"
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
.co-node {
  min-width: 200px;
  max-width: 260px;
  background: rgba(18, 24, 28, 0.96);
  border: 1.5px solid rgba(52, 211, 153, 0.28);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 0 14px rgba(52, 211, 153, 0.06), 0 3px 10px rgba(0, 0, 0, 0.45);
  cursor: default;
  user-select: none;
}

.co-node--has-ctx {
  border-color: rgba(34, 197, 94, 0.55);
  box-shadow: 0 0 18px rgba(34, 197, 94, 0.1), 0 3px 10px rgba(0, 0, 0, 0.45);
}

.co-node__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
}

.co-node__left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.co-node__badge {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(52, 211, 153, 0.6);
}

.co-node__menu {
  opacity: 0;
  transition: opacity 0.15s;
}

.co-node:hover .co-node__menu {
  opacity: 1;
}

.co-node__name {
  font-size: 0.87rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.co-node__domain {
  font-size: 0.74rem;
  color: rgba(52, 211, 153, 0.5);
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-loading {
  text-align: center;
  padding: 24px 0;
}
</style>
