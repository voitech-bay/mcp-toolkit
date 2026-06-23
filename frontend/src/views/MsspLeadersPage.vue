<script setup lang="ts">
import { ref, computed, h, onMounted, watch } from "vue";
import {
  NCard, NDataTable, NInput, NButton, NTag, NAlert, NEmpty, NSpace, NSelect, NTooltip, NPopconfirm,
  NDrawer, NDrawerContent,
} from "naive-ui";
import type { DataTableColumns, DataTableRowKey, SelectOption } from "naive-ui";
import {
  UsersIcon,
  LinkedinIcon,
  MessageCircleIcon,
  IdCardIcon,
  TrashIcon,
  RefreshCwIcon,
  MailIcon,
  RotateCcwIcon,
} from "lucide-vue-next";
import { RouterLink } from "vue-router";
import FeasibleComposer from "../components/FeasibleComposer.vue";
import { useProjectStore } from "../stores/project";

const composerLead = ref<{ uuid: string; name: string; connected: boolean; email?: string } | null>(null);
function openComposer(row: LeaderRecord) {
  composerLead.value = {
    uuid: row.uuid,
    name: row.name,
    connected: row.connection_status === "accepted",
    email: row.email ?? undefined,
  };
}

const TAG_UUID = "b108ac8f-5049-466d-bc48-982c5a7e2201";
const COLUMN_STORAGE_KEY = "voitech/mssp-leaders/visible-columns";

interface LeaderRecord {
  uuid: string;
  name: string;
  position: string | null;
  headline: string | null;
  linkedin_url: string | null;
  location: string | null;
  email: string | null;
  email_status: string | null;
  company_id: string | null;
  company_name: string | null;
  company_hq: string | null;
  employee_count: number | null;
  pov_markdown: string | null;
  company_type: string | null;
  services: string[];
  vendors: string[];
  connection_status: "accepted" | "sent" | "withdrawn" | "none";
  connection_accepted_at: string | null;
  automations: string[];
  outgoing_count: number;
  reply_count: number;
  email_count: number | null;
  status: string;
}

type ConfigurableColumn = DataTableColumns<LeaderRecord>[number] & {
  key: string;
  title?: unknown;
  width?: number;
};

const data = ref<LeaderRecord[]>([]);
const loading = ref(false);
const syncing = ref(false);
const removing = ref(false);
const error = ref("");
const search = ref("");
const statusFilter = ref<string | null>(null);
const connFilter = ref<string | null>(null);
const typeFilter = ref<string | null>(null);
const checkedKeys = ref<DataTableRowKey[]>([]);
const projectStore = useProjectStore();

const DEFAULT_VISIBLE_COLUMN_KEYS = [
  "linkedin",
  "name",
  "position",
  "company_name",
  "location",
  "company_hq",
  "employee_count",
  "company_type",
  "connection_status",
  "connection_accepted_at",
  "automations",
  "outgoing_count",
  "reply_count",
  "email_count",
  "status",
] as const;

const visibleColumnKeys = ref<string[]>(loadVisibleColumnKeys());

function loadVisibleColumnKeys(): string[] {
  if (typeof localStorage === "undefined") return [...DEFAULT_VISIBLE_COLUMN_KEYS];
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string")
      ? parsed
      : [...DEFAULT_VISIBLE_COLUMN_KEYS];
  } catch {
    return [...DEFAULT_VISIBLE_COLUMN_KEYS];
  }
}

watch(visibleColumnKeys, (keys) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(keys));
});

function showAllColumns() {
  visibleColumnKeys.value = columnOptions.value.map((option) => String(option.value));
}

function resetColumns() {
  visibleColumnKeys.value = [...DEFAULT_VISIBLE_COLUMN_KEYS];
}

async function fetchList() {
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch(`/api/lists/tagged?tag=${TAG_UUID}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to load list");
    data.value = (j.data ?? []) as LeaderRecord[];
    checkedKeys.value = [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load list";
    data.value = [];
  } finally {
    loading.value = false;
  }
}

async function syncEmails() {
  if (!projectStore.selectedProjectId) {
    error.value = "Select the Feasible project before syncing GetSales markers.";
    return;
  }
  syncing.value = true;
  error.value = "";
  try {
    const r = await fetch("/api/contacts/sync-markers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: TAG_UUID, projectId: projectStore.selectedProjectId }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Sync failed");
    await fetchList();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Sync failed";
  } finally {
    syncing.value = false;
  }
}

async function removeFromList(uuids: string[]) {
  if (!uuids.length) return;
  removing.value = true;
  error.value = "";
  try {
    const r = await fetch("/api/lists/tagged/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: TAG_UUID, uuids }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Remove failed");
    // Optimistically remove from local data, then refresh
    data.value = data.value.filter((d) => !uuids.includes(d.uuid));
    checkedKeys.value = checkedKeys.value.filter((k) => !uuids.includes(String(k)));
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Remove failed";
  } finally {
    removing.value = false;
  }
}

onMounted(fetchList);

const STATUS_FILTER_ORDER = [
  "Not Contacted",
  "No Reply",
  "No reply after 3+ messages",
  "Contacted",
  "Awaiting Their Reply",
  "Waiting for Reply",
  "Replied",
  "Engaging",
  "Positive Reply",
  "Meeting / Opportunity",
  "Bad Timing",
  "Not Interested",
  "Current Customer",
];

function uniq(vals: (string | null)[]): { label: string; value: string }[] {
  return [...new Set(vals.filter((v): v is string => Boolean(v)))]
    .sort()
    .map((v) => ({ label: v, value: v }));
}
const statusOptions = computed(() => {
  const inData = new Set(data.value.map((d) => d.status));
  const options = STATUS_FILTER_ORDER
    .filter((s) => inData.has(s) || s === "No Reply" || s === "No reply after 3+ messages" || s === "Replied")
    .map((v) => ({ label: v, value: v }));
  for (const s of [...inData].sort()) {
    if (!STATUS_FILTER_ORDER.includes(s)) options.push({ label: s, value: s });
  }
  return options;
});
const typeOptions = computed(() => uniq(data.value.map((d) => d.company_type)));
const connOptions = [
  { label: "Accepted", value: "accepted" },
  { label: "Sent", value: "sent" },
  { label: "Withdrawn", value: "withdrawn" },
  { label: "None", value: "none" },
];

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return data.value.filter((d) => {
    if (statusFilter.value && d.status !== statusFilter.value) return false;
    if (connFilter.value && d.connection_status !== connFilter.value) return false;
    if (typeFilter.value && d.company_type !== typeFilter.value) return false;
    if (q) {
      const hay = `${d.name} ${d.company_name ?? ""} ${d.position ?? ""} ${d.location ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
});

const selectedUuids = computed(() => checkedKeys.value.map(String));

const connType = (s: string) =>
  s === "accepted" ? "success" : s === "sent" ? "warning" : s === "withdrawn" ? "error" : "default";
const statusType = (s: string) => {
  const l = s.toLowerCase();
  if (l.includes("positive") || l.includes("opportunity") || l.includes("meeting") || l.includes("customer")) return "success";
  if (l.includes("replied") && !l.includes("no reply")) return "success";
  if (l.includes("not interested") || l.includes("bad timing")) return "error";
  if (l.includes("no reply")) return "warning";
  if (l.includes("waiting")) return "info";
  return "default";
};
function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

const dataColumns = computed<ConfigurableColumn[]>(() => [
  {
    title: "", key: "linkedin", width: 36,
    render: (row) =>
      row.linkedin_url
        ? h("a", { href: row.linkedin_url, target: "_blank", rel: "noopener noreferrer", title: "Open LinkedIn", style: "color:#0a66c2;display:inline-flex;align-items:center" },
            h(LinkedinIcon, { size: 16 }))
        : "",
  },
  {
    title: "Name", key: "name", width: 160, fixed: "left", ellipsis: { tooltip: true },
    sorter: (a, b) => a.name.localeCompare(b.name),
    render: (row) => h(RouterLink, { to: `/contact/${row.uuid}`, style: "color:#2080f0;text-decoration:none" }, { default: () => row.name }),
  },
  { title: "Title", key: "position", width: 190, ellipsis: { tooltip: true }, render: (r) => r.position ?? "—" },
  {
    title: "Company", key: "company_name", width: 170, ellipsis: { tooltip: true },
    sorter: (a, b) => (a.company_name ?? "").localeCompare(b.company_name ?? ""),
    render: (row) =>
      row.company_id
        ? h(RouterLink, { to: { path: `/company/${row.company_id}`, query: { tag: TAG_UUID } }, style: "color:#2080f0;text-decoration:none" }, { default: () => row.company_name ?? "—" })
        : (row.company_name ?? "—"),
  },
  { title: "Location", key: "location", width: 130, ellipsis: { tooltip: true }, render: (r) => r.location ?? "—" },
  { title: "Company HQ", key: "company_hq", width: 130, ellipsis: { tooltip: true }, render: (r) => r.company_hq ?? "—" },
  {
    title: "Employees", key: "employee_count", width: 96,
    sorter: (a, b) => (a.employee_count ?? 0) - (b.employee_count ?? 0),
    render: (r) => r.employee_count != null ? r.employee_count.toLocaleString() : "—",
  },
  {
    title: "Type", key: "company_type", width: 120, ellipsis: { tooltip: true },
    render: (r) => (r.company_type ? h(NTag, { size: "small", bordered: false, type: "info" }, { default: () => r.company_type }) : "—"),
  },
  {
    title: "Connection", key: "connection_status", width: 110,
    sorter: (a, b) => a.connection_status.localeCompare(b.connection_status),
    render: (r) => h(NTag, { size: "small", bordered: false, type: connType(r.connection_status) }, { default: () => r.connection_status }),
  },
  { title: "Accepted", key: "connection_accepted_at", width: 96, render: (r) => fmtDate(r.connection_accepted_at) },
  {
    title: "Automations", key: "automations", width: 160, ellipsis: { tooltip: true },
    render: (r) => (r.automations.length ? r.automations.join(", ") : "—"),
  },
  { title: "Out", key: "outgoing_count", width: 56, sorter: (a, b) => a.outgoing_count - b.outgoing_count, render: (r) => r.outgoing_count },
  { title: "Replies", key: "reply_count", width: 68, sorter: (a, b) => a.reply_count - b.reply_count, render: (r) => r.reply_count },
  { title: "Emails", key: "email_count", width: 64, sorter: (a, b) => (a.email_count ?? -1) - (b.email_count ?? -1), render: (r) => r.email_count ?? "—" },
  {
    title: "Status", key: "status", width: 160, ellipsis: { tooltip: true },
    sorter: (a, b) => a.status.localeCompare(b.status),
    render: (r) => h(NTag, { size: "small", bordered: false, type: statusType(r.status) }, { default: () => r.status }),
  },
  {
    title: "Actions", key: "actions", width: 130, fixed: "right",
    render: (row) =>
      h(NSpace, { size: 4, wrap: false }, {
        default: () => [
          h(NTooltip, null, {
            trigger: () => h(RouterLink, { to: `/contact/${row.uuid}` },
              { default: () => h(NButton, { size: "tiny", type: "primary", secondary: true }, { icon: () => h(IdCardIcon, { size: 14 }), default: () => "POV" }) }),
            default: () => "Open contact card",
          }),
          h(NTooltip, null, {
            trigger: () => h(RouterLink, { to: { path: "/conversations", query: { search: row.name } } },
              { default: () => h(NButton, { size: "tiny", quaternary: true }, { icon: () => h(MessageCircleIcon, { size: 14 }) }) }),
            default: () => "Open conversation",
          }),
          h(NTooltip, null, {
            trigger: () => h(NButton, { size: "tiny", quaternary: true, onClick: () => openComposer(row) },
              { icon: () => h(MailIcon, { size: 14 }) }),
            default: () => "Feasible message agent",
          }),
          h(NPopconfirm, {
            onPositiveClick: () => removeFromList([row.uuid]),
          }, {
            trigger: () => h(NButton, { size: "tiny", quaternary: true, type: "error" }, { icon: () => h(TrashIcon, { size: 14 }) }),
            default: () => `Remove ${row.name} from this list?`,
          }),
        ],
      }),
  },
]);

const columnOptions = computed<SelectOption[]>(() =>
  dataColumns.value.map((column) => ({
    label: typeof column.title === "string" && column.title ? column.title : "LinkedIn",
    value: String(column.key),
  }))
);

const visibleDataColumns = computed(() => {
  const visibleKeys = new Set(visibleColumnKeys.value);
  return dataColumns.value.filter((column) => visibleKeys.has(String(column.key)));
});

const columns = computed<DataTableColumns<LeaderRecord>>(() => [
  { type: "selection", width: 36, fixed: "left" },
  ...visibleDataColumns.value,
]);

const scrollX = computed(() =>
  columns.value.reduce((total, column) => total + (Number((column as { width?: number }).width) || 160), 0)
);
</script>

<template>
  <NCard>
    <template #header>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px">
          <UsersIcon :size="16" />
          <span>MSSP Leaders in MENA</span>
          <NTag size="small" :bordered="false" type="info">{{ filtered.length }} / {{ data.length }}</NTag>
          <span v-if="loading" style="opacity:.6;font-size:.82rem">Loading…</span>
        </div>
        <NSpace size="small" align="center" wrap>
          <NInput v-model:value="search" placeholder="Search name, company, title…" clearable size="small" style="width: 220px" />
          <NSelect v-model:value="statusFilter" :options="statusOptions" placeholder="Status" clearable size="small" style="width: 150px" />
          <NSelect v-model:value="connFilter" :options="connOptions" placeholder="Connection" clearable size="small" style="width: 120px" />
          <NSelect v-model:value="typeFilter" :options="typeOptions" placeholder="Company type" clearable size="small" style="width: 140px" />
          <NSelect
            v-model:value="visibleColumnKeys"
            :options="columnOptions"
            multiple
            filterable
            clearable
            max-tag-count="responsive"
            placeholder="Columns"
            size="small"
            style="width: 220px"
          />
          <NTooltip>
            <template #trigger>
              <NButton size="small" quaternary circle @click="resetColumns">
                <template #icon><RotateCcwIcon :size="14" /></template>
              </NButton>
            </template>
            Reset columns
          </NTooltip>
          <NButton size="small" quaternary @click="showAllColumns">Show all</NButton>
          <NTooltip v-if="selectedUuids.length > 0">
            <template #trigger>
              <NPopconfirm @positive-click="removeFromList(selectedUuids)">
                <template #trigger>
                  <NButton size="small" type="error" secondary :loading="removing">
                    <template #icon><TrashIcon :size="14" /></template>
                    Remove {{ selectedUuids.length }} selected
                  </NButton>
                </template>
                Remove {{ selectedUuids.length }} contacts from this list?
              </NPopconfirm>
            </template>
            Remove selected contacts from "MSSP Leaders in MENA" tag
          </NTooltip>
          <NTooltip>
            <template #trigger>
              <NButton size="small" secondary :loading="syncing" @click="syncEmails">
                <template #icon><RefreshCwIcon :size="14" /></template>
                Sync emails
              </NButton>
            </template>
            Fetch email + connection stats from GetSales API for all {{ data.length }} contacts
          </NTooltip>
          <NButton size="small" @click="fetchList" :loading="loading">Refresh</NButton>
        </NSpace>
      </div>
    </template>

    <NAlert v-if="error" type="error" :show-icon="false" style="margin-bottom:8px">{{ error }}</NAlert>
    <NEmpty v-else-if="!loading && data.length === 0" description="No contacts tagged for this list." />
    <NDataTable
      v-else
      :columns="columns"
      :data="filtered"
      :scroll-x="scrollX"
      :row-key="(r: LeaderRecord) => r.uuid"
      v-model:checked-row-keys="checkedKeys"
      :pagination="{ pageSize: 25, showSizePicker: true, pageSizes: [25, 50, 100] }"
      :loading="loading"
    />

    <NDrawer :show="!!composerLead" :width="620" placement="right" @update:show="(v: boolean) => { if (!v) composerLead = null; }">
      <NDrawerContent :title="`Feasible message — ${composerLead?.name ?? ''}`" closable>
        <FeasibleComposer
          v-if="composerLead"
          :lead-uuid="composerLead.uuid"
          :contact-name="composerLead.name"
          :connected="composerLead.connected"
          :email="composerLead.email"
        />
      </NDrawerContent>
    </NDrawer>
  </NCard>
</template>
