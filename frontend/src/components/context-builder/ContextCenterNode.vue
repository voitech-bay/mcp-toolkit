<script setup lang="ts">
import { ref, computed, inject } from "vue";
import { Handle, Position } from "@vue-flow/core";
import type { NodeProps } from "@vue-flow/core";
import {
  NButton,
  NCheckbox,
  NModal,
  NDataTable,
  NInput,
  NSpace,
  NSpin,
} from "naive-ui";
import type { DataTableColumns, DataTableRowKey } from "naive-ui";
import { LightbulbIcon, BuildingIcon, UserIcon } from "lucide-vue-next";
import {
  CONTEXT_BUILDER_KEY,
  type CenterNodeData,
  type HypothesisListItem,
  type ContactListItem,
  type ProjectCompanyListItem,
} from "../../composables/useContextBuilder";

defineProps<NodeProps<CenterNodeData>>();

const ctx = inject(CONTEXT_BUILDER_KEY)!;

// ── Picker state ──────────────────────────────────────────────────────────────

type PickerType = "hypothesis" | "company" | "contact";

const pickerType = ref<PickerType | null>(null);
const pickerSearch = ref("");
const hypData = ref<HypothesisListItem[]>([]);
const companyData = ref<ProjectCompanyListItem[]>([]);
const contactData = ref<ContactListItem[]>([]);
const pickerLoading = ref(false);
const selectedKeys = ref<DataTableRowKey[]>([]);

// Auto-expand options (hypothesis picker only)
const autoExpand = ref(false);
const withConversations = ref(true);
const expanding = ref(false);

const filteredHyps = computed(() => {
  const q = pickerSearch.value.trim().toLowerCase();
  if (!q) return hypData.value;
  return hypData.value.filter((h) => h.name.toLowerCase().includes(q));
});

const filteredCompanies = computed(() => {
  const q = pickerSearch.value.trim().toLowerCase();
  if (!q) return companyData.value;
  return companyData.value.filter(
    (c) =>
      (c.name ?? "").toLowerCase().includes(q) ||
      (c.domain ?? "").toLowerCase().includes(q)
  );
});

const filteredContacts = computed(() => {
  const q = pickerSearch.value.trim().toLowerCase();
  if (!q) return contactData.value;
  return contactData.value.filter((c) => {
    const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.toLowerCase();
    return name.includes(q) || (c.position ?? "").toLowerCase().includes(q);
  });
});

async function openPicker(type: PickerType) {
  pickerType.value = type;
  pickerSearch.value = "";
  selectedKeys.value = [];
  pickerLoading.value = true;
  try {
    if (type === "hypothesis") {
      hypData.value = await ctx.fetchHypothesesList();
    } else if (type === "company") {
      companyData.value = await ctx.fetchProjectCompaniesList();
    } else {
      contactData.value = await ctx.fetchProjectContactsList();
    }
  } finally {
    pickerLoading.value = false;
  }
}

function closePicker() {
  pickerType.value = null;
}

async function applyPicker() {
  if (pickerType.value === "hypothesis") {
    const items = selectedKeys.value
      .map((key) => hypData.value.find((h) => h.id === key))
      .filter((x): x is HypothesisListItem => x != null);

    if (autoExpand.value && items.length > 0) {
      expanding.value = true;
      try {
        for (const item of items) {
          await ctx.expandHypothesis(item, { withConversations: withConversations.value });
        }
      } finally {
        expanding.value = false;
      }
    } else {
      for (const item of items) ctx.addHypothesis(item);
    }
  } else if (pickerType.value === "company") {
    for (const key of selectedKeys.value) {
      const item = companyData.value.find((c) => c.project_company_id === key);
      if (item) ctx.addCompany(item, null);
    }
  } else if (pickerType.value === "contact") {
    for (const key of selectedKeys.value) {
      const item =
        typeof key === "string"
          ? contactData.value.find((c) => c.id === key)
          : contactData.value[key as number];
      if (item) ctx.addContact(item, null);
    }
  }
  closePicker();
}

// ── Table columns ─────────────────────────────────────────────────────────────

const hypColumns: DataTableColumns<HypothesisListItem> = [
  { type: "selection", fixed: "left" },
  { key: "name", title: "Hypothesis", ellipsis: { tooltip: true } },
  {
    key: "description",
    title: "Description",
    ellipsis: { tooltip: true },
    render: (r) => r.description ?? "—",
  },
  { key: "target_count", title: "Companies", width: 100 },
];

const companyColumns: DataTableColumns<ProjectCompanyListItem> = [
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

type ContactRow = ContactListItem & { __key: string | number; __label: string };
const contactRows = computed<ContactRow[]>(() =>
  filteredContacts.value.map((c, i) => ({
    ...c,
    __key: (c.id as string | undefined) ?? i,
    __label: [c.first_name, c.last_name].filter(Boolean).join(" ") || "—",
  }))
);

const contactColumns: DataTableColumns<ContactRow> = [
  { type: "selection", fixed: "left" },
  { key: "__label", title: "Name", ellipsis: { tooltip: true }, render: (r) => r.__label },
  { key: "position", title: "Position", ellipsis: { tooltip: true }, render: (r) => r.position ?? "—" },
];
</script>

<template>
  <Handle id="top" type="source" :position="Position.Top" />
  <Handle id="left" type="source" :position="Position.Left" />
  <Handle id="right" type="source" :position="Position.Right" />

  <div class="center-node nopan">
    <div class="center-node__title">CONTEXT</div>
    <div class="center-node__count">
      {{ data.sourceCount }} source{{ data.sourceCount !== 1 ? "s" : "" }}
    </div>
    <div class="center-node__meta">
      <span>Hypotheses: {{ data.hypothesisCount }}</span>
      <span>Companies: {{ data.companyCount }}</span>
      <span>Contacts: {{ data.contactCount }}</span>
      <span>With context: {{ data.customContextCount }}</span>
    </div>
    <div class="center-node__actions">
      <NButton size="small" type="primary" @click="openPicker('hypothesis')">
        <template #icon><LightbulbIcon :size="13" /></template>
        Hypothesis
      </NButton>
      <NButton size="small" @click="openPicker('company')">
        <template #icon><BuildingIcon :size="13" /></template>
        Company
      </NButton>
      <NButton size="small" @click="openPicker('contact')">
        <template #icon><UserIcon :size="13" /></template>
        Contact
      </NButton>
    </div>
  </div>

  <!-- Hypothesis picker -->
  <NModal
    :show="pickerType === 'hypothesis'"
    preset="card"
    title="Add Hypothesis"
    style="width: 660px"
    :closable="!expanding"
    :mask-closable="!expanding"
    @update:show="(v) => { if (!v && !expanding) closePicker() }"
  >
    <NInput
      v-model:value="pickerSearch"
      placeholder="Search hypotheses…"
      clearable
      size="small"
      style="margin-bottom: 12px"
    />
    <div v-if="pickerLoading" class="picker-loading"><NSpin /></div>
    <NDataTable
      v-else
      :columns="hypColumns"
      :data="filteredHyps"
      :row-key="(r: HypothesisListItem) => r.id"
      v-model:checked-row-keys="selectedKeys"
      size="small"
      :max-height="280"
      :scroll-x="560"
    />

    <div class="expand-options">
      <NCheckbox v-model:checked="autoExpand" :disabled="expanding">
        Auto-expand: add all companies &amp; contacts
      </NCheckbox>
      <NCheckbox
        v-if="autoExpand"
        v-model:checked="withConversations"
        :disabled="expanding"
        style="margin-left: 24px"
      >
        Include conversations
      </NCheckbox>
    </div>

    <template #footer>
      <NSpace justify="end" align="center">
        <NSpin v-if="expanding" size="small" />
        <span v-if="expanding" style="font-size: 0.8rem; opacity: 0.6">Expanding…</span>
        <NButton :disabled="expanding" @click="closePicker">Cancel</NButton>
        <NButton
          type="primary"
          :disabled="selectedKeys.length === 0 || expanding"
          :loading="expanding"
          @click="applyPicker"
        >
          Add{{ selectedKeys.length > 0 ? ` (${selectedKeys.length})` : "" }}
        </NButton>
      </NSpace>
    </template>
  </NModal>

  <!-- Company picker -->
  <NModal
    :show="pickerType === 'company'"
    preset="card"
    title="Add Company"
    style="width: 580px"
    @update:show="(v) => { if (!v) closePicker() }"
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
      :columns="companyColumns"
      :data="filteredCompanies"
      :row-key="(r: ProjectCompanyListItem) => r.project_company_id"
      v-model:checked-row-keys="selectedKeys"
      size="small"
      :max-height="320"
      :scroll-x="480"
    />
    <template #footer>
      <NSpace justify="end">
        <NButton @click="closePicker">Cancel</NButton>
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

  <!-- Contact picker -->
  <NModal
    :show="pickerType === 'contact'"
    preset="card"
    title="Add Contact"
    style="width: 600px"
    @update:show="(v) => { if (!v) closePicker() }"
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
      :columns="contactColumns"
      :data="contactRows"
      :row-key="(r: ContactRow) => r.__key"
      v-model:checked-row-keys="selectedKeys"
      size="small"
      :max-height="320"
      :scroll-x="560"
    />
    <template #footer>
      <NSpace justify="end">
        <NButton @click="closePicker">Cancel</NButton>
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
.center-node {
  min-width: 210px;
  background: linear-gradient(
    135deg,
    rgba(99, 102, 241, 0.18),
    rgba(139, 92, 246, 0.18)
  );
  border: 1.5px solid rgba(99, 102, 241, 0.55);
  border-radius: 14px;
  padding: 14px 18px;
  box-shadow: 0 0 24px rgba(99, 102, 241, 0.25), 0 4px 16px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: default;
  user-select: none;
}

.center-node__title {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: rgba(165, 180, 252, 0.85);
  text-transform: uppercase;
}

.center-node__count {
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.45);
}

.center-node__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  justify-content: center;
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.35);
}

.center-node__actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 2px;
}

.picker-loading {
  text-align: center;
  padding: 24px 0;
}

.expand-options {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}
</style>
