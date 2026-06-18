<script setup lang="ts">
import { ref, computed, h, onMounted } from "vue";
import {
  NCard, NDataTable, NInput, NButton, NTag, NAlert, NEmpty, NSpace, NSelect, NTooltip,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { UsersIcon, LinkedinIcon, MessageCircleIcon, IdCardIcon } from "lucide-vue-next";
import { RouterLink } from "vue-router";

// "MSSP Leaders in MENA" GetSalesTags uuid (membership marker).
const TAG_UUID = "b108ac8f-5049-466d-bc48-982c5a7e2201";

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
  description: string | null;
  pov_markdown: string | null;
  company_type: string | null;
  services: string[];
  vendors: string[];
  connection_status: "accepted" | "sent" | "none";
  connection_accepted_at: string | null;
  automations: string[];
  outgoing_count: number;
  reply_count: number;
  status: string;
}

const data = ref<LeaderRecord[]>([]);
const loading = ref(false);
const error = ref("");
const search = ref("");
const statusFilter = ref<string | null>(null);
const connFilter = ref<string | null>(null);
const typeFilter = ref<string | null>(null);

async function fetchList() {
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch(`/api/lists/tagged?tag=${TAG_UUID}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to load list");
    data.value = (j.data ?? []) as LeaderRecord[];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load list";
    data.value = [];
  } finally {
    loading.value = false;
  }
}
onMounted(fetchList);

function uniq(vals: (string | null)[]): { label: string; value: string }[] {
  return [...new Set(vals.filter((v): v is string => Boolean(v)))]
    .sort()
    .map((v) => ({ label: v, value: v }));
}
const statusOptions = computed(() => uniq(data.value.map((d) => d.status)));
const typeOptions = computed(() => uniq(data.value.map((d) => d.company_type)));
const connOptions = [
  { label: "Accepted", value: "accepted" },
  { label: "Sent", value: "sent" },
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

const connType = (s: string) => (s === "accepted" ? "success" : s === "sent" ? "warning" : "default");
const statusType = (s: string) => {
  const l = s.toLowerCase();
  if (l.includes("positive") || l.includes("opportunity") || l.includes("meeting") || l.includes("customer")) return "success";
  if (l.includes("not interested") || l.includes("bad timing")) return "error";
  if (l.includes("waiting")) return "info";
  return "default";
};
function fmtDate(s: string | null): string {
  if (!s) return "N/A";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "N/A" : d.toLocaleDateString();
}

const columns = computed<DataTableColumns<LeaderRecord>>(() => [
  {
    title: "", key: "linkedin", width: 40,
    render: (row) =>
      row.linkedin_url
        ? h("a", { href: row.linkedin_url, target: "_blank", rel: "noopener", title: "Open LinkedIn", style: "color:#0a66c2;display:inline-flex" },
            h(LinkedinIcon, { size: 16 }))
        : "",
  },
  {
    title: "Name", key: "name", width: 170, fixed: "left", ellipsis: { tooltip: true },
    sorter: (a, b) => a.name.localeCompare(b.name),
    render: (row) => h(RouterLink, { to: `/contact/${row.uuid}`, style: "color:#2080f0;text-decoration:none" }, { default: () => row.name }),
  },
  { title: "Title", key: "position", width: 190, ellipsis: { tooltip: true }, render: (r) => r.position ?? "—" },
  {
    title: "Company", key: "company_name", width: 180, ellipsis: { tooltip: true },
    sorter: (a, b) => (a.company_name ?? "").localeCompare(b.company_name ?? ""),
    render: (row) =>
      row.company_id
        ? h(RouterLink, { to: `/company/${row.company_id}`, style: "color:#2080f0;text-decoration:none" }, { default: () => row.company_name ?? "—" })
        : (row.company_name ?? "—"),
  },
  { title: "Location", key: "location", width: 130, ellipsis: { tooltip: true }, render: (r) => r.location ?? "—" },
  { title: "Company HQ", key: "company_hq", width: 150, ellipsis: { tooltip: true }, render: (r) => r.company_hq ?? "—" },
  {
    title: "Type", key: "company_type", width: 130, ellipsis: { tooltip: true },
    render: (r) => (r.company_type ? h(NTag, { size: "small", bordered: false, type: "info" }, { default: () => r.company_type }) : "—"),
  },
  { title: "Description", key: "description", width: 240, ellipsis: { tooltip: true }, render: (r) => r.description ?? "—" },
  {
    title: "Connection", key: "connection_status", width: 110,
    sorter: (a, b) => a.connection_status.localeCompare(b.connection_status),
    render: (r) => h(NTag, { size: "small", bordered: false, type: connType(r.connection_status) }, { default: () => r.connection_status }),
  },
  { title: "Accepted", key: "connection_accepted_at", width: 100, render: (r) => fmtDate(r.connection_accepted_at) },
  {
    title: "Automations", key: "automations", width: 160, ellipsis: { tooltip: true },
    render: (r) => (r.automations.length ? r.automations.join(", ") : "—"),
  },
  { title: "Out", key: "outgoing_count", width: 64, sorter: (a, b) => a.outgoing_count - b.outgoing_count, render: (r) => r.outgoing_count },
  { title: "Replies", key: "reply_count", width: 74, sorter: (a, b) => a.reply_count - b.reply_count, render: (r) => r.reply_count },
  {
    title: "Status", key: "status", width: 160, ellipsis: { tooltip: true },
    sorter: (a, b) => a.status.localeCompare(b.status),
    render: (r) => h(NTag, { size: "small", bordered: false, type: statusType(r.status) }, { default: () => r.status }),
  },
  {
    title: "Actions", key: "actions", width: 150, fixed: "right",
    render: (row) =>
      h(NSpace, { size: 4, wrap: false }, {
        default: () => [
          h(NTooltip, null, {
            trigger: () => h(RouterLink, { to: `/contact/${row.uuid}` },
              { default: () => h(NButton, { size: "tiny", type: "primary", secondary: true }, { icon: () => h(IdCardIcon, { size: 14 }), default: () => "POV" }) }),
            default: () => "Open POV card",
          }),
          h(NTooltip, null, {
            trigger: () => h(RouterLink, { to: { path: "/conversations", query: { search: row.name } } },
              { default: () => h(NButton, { size: "tiny", quaternary: true }, { icon: () => h(MessageCircleIcon, { size: 14 }) }) }),
            default: () => "Open conversation",
          }),
        ],
      }),
  },
]);
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
        <NSpace size="small" align="center">
          <NInput v-model:value="search" placeholder="Search name, company, title…" clearable size="small" style="width: 240px" />
          <NSelect v-model:value="statusFilter" :options="statusOptions" placeholder="Status" clearable size="small" style="width: 160px" />
          <NSelect v-model:value="connFilter" :options="connOptions" placeholder="Connection" clearable size="small" style="width: 130px" />
          <NSelect v-model:value="typeFilter" :options="typeOptions" placeholder="Company type" clearable size="small" style="width: 150px" />
          <NButton size="small" @click="fetchList" :loading="loading">Refresh</NButton>
        </NSpace>
      </div>
    </template>

    <NAlert v-if="error" type="error" :show-icon="false">{{ error }}</NAlert>
    <NEmpty v-else-if="!loading && data.length === 0" description="No contacts tagged for this list." />
    <NDataTable
      v-else
      :columns="columns"
      :data="filtered"
      :scroll-x="2050"
      :row-key="(r: LeaderRecord) => r.uuid"
      :pagination="{ pageSize: 25, showSizePicker: true, pageSizes: [25, 50, 100] }"
      :loading="loading"
    />
  </NCard>
</template>
