<script setup lang="ts">
import { ref, computed, h, onMounted, watch } from "vue";
import {
  NCard, NDataTable, NInput, NButton, NButtonGroup, NTag, NAlert, NEmpty, NSpace, NSelect, NTooltip, NPopconfirm,
  NDrawer, NDrawerContent, NTabs, NTabPane,
} from "naive-ui";
import type { DataTableColumns, DataTableRowKey } from "naive-ui";
import { UsersIcon, Building2Icon, LinkedinIcon, MessageCircleIcon, IdCardIcon, TrashIcon, RefreshCwIcon, MailIcon } from "lucide-vue-next";
import { RouterLink } from "vue-router";
import FeasibleComposer from "../components/FeasibleComposer.vue";
import { useProjectStore } from "../stores/project";
import { isFeasibleProjectId } from "../project-ids";
import OutreachAgentDrawer from "../components/OutreachAgentDrawer.vue";

const composerLead = ref<{ uuid: string; name: string; connected: boolean; email?: string } | null>(null);
function openComposer(row: LeaderRecord) {
  composerLead.value = {
    uuid: row.uuid,
    name: row.name,
    connected: row.connection_status === "accepted",
    email: row.email ?? undefined,
  };
}

// Region-switchable, tag-backed lists. Each region maps to its GetSalesTags uuid.
const TAG_BY_REGION = {
  MENA: "b108ac8f-5049-466d-bc48-982c5a7e2201",
  LATAM: "2cd32c55-47a2-4e3e-b69c-1d01a8b70e1b",
} as const;
type Region = keyof typeof TAG_BY_REGION;
const region = ref<Region>("MENA");
const tagUuid = computed(() => TAG_BY_REGION[region.value]);

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
  last_outbound_at: string | null;
  status: string;
}

const data = ref<LeaderRecord[]>([]);
const loading = ref(false);
const syncing = ref(false);
const removing = ref(false);
const error = ref("");
const search = ref("");
const statusFilter = ref<string | null>(null);
const connFilter = ref<string | null>(null);
const typeFilter = ref<string | null>(null);
const lastOutboundDaysFilter = ref<number | null>(null);
const checkedKeys = ref<DataTableRowKey[]>([]);
const view = ref<"contacts" | "companies">("contacts");
const projectStore = useProjectStore();
const isFeasibleProject = computed(() => isFeasibleProjectId(projectStore.selectedProjectId));
const outreachOpen = ref(false);
const outreachContact = ref<LeaderRecord | null>(null);
function createOutreach(row: LeaderRecord) { outreachContact.value = row; outreachOpen.value = true; }

async function fetchList() {
  if (!isFeasibleProject.value) {
    data.value = [];
    error.value = "";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch(`/api/lists/tagged?tag=${tagUuid.value}`);
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
  if (!isFeasibleProject.value) {
    error.value = "MSSP Leaders in MENA is available only for the Feasible project.";
    return;
  }
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
      body: JSON.stringify({ tag: tagUuid.value, projectId: projectStore.selectedProjectId }),
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
      body: JSON.stringify({ tag: tagUuid.value, uuids }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Remove failed");
    if (typeof j.removed === "number" && j.removed === 0) {
      throw new Error("Nothing was removed — the server could not write to the database (check Supabase service-role key).");
    }
    // The DB write is confirmed (removed > 0), so drop the rows locally and instantly.
    data.value = data.value.filter((d) => !uuids.includes(d.uuid));
    checkedKeys.value = checkedKeys.value.filter((k) => !uuids.includes(String(k)));
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Remove failed";
  } finally {
    removing.value = false;
  }
}

function selectRegion(r: Region) {
  if (region.value === r) return;
  region.value = r;
  // Region change is a different dataset — clear filters/selection, then reload.
  search.value = "";
  statusFilter.value = null;
  connFilter.value = null;
  typeFilter.value = null;
  lastOutboundDaysFilter.value = null;
  checkedKeys.value = [];
  fetchList();
}

onMounted(fetchList);

watch(
  () => projectStore.selectedProjectId,
  (projectId) => {
    if (!isFeasibleProjectId(projectId)) {
      data.value = [];
      checkedKeys.value = [];
      error.value = "";
      return;
    }
    void fetchList();
  }
);

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
const lastOutboundDaysOptions = [1, 2, 7, 10].map((days) => ({
  label: `Last sent > ${days}d`,
  value: days,
}));

function daysSince(dateString: string | null): number | null {
  if (!dateString) return null;
  const time = new Date(dateString).getTime();
  if (!Number.isFinite(time)) return null;
  return (Date.now() - time) / 86_400_000;
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return data.value.filter((d) => {
    if (statusFilter.value && d.status !== statusFilter.value) return false;
    if (connFilter.value && d.connection_status !== connFilter.value) return false;
    if (typeFilter.value && d.company_type !== typeFilter.value) return false;
    if (lastOutboundDaysFilter.value != null) {
      const ageDays = daysSince(d.last_outbound_at);
      if (ageDays == null || ageDays <= lastOutboundDaysFilter.value) return false;
    }
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

// --- Company aggregation (groups the same list rows by company) ---------------
interface CompanyRow {
  company_id: string | null;
  company_name: string;
  company_hq: string | null;
  employee_count: number | null;
  company_type: string | null;
  services: string[];
  vendors: string[];
  contact_count: number;
  connected_count: number;
  replied_count: number;
  contacted_count: number;
  outgoing_count: number;
  reply_count: number;
  email_count: number;
}

const companies = computed<CompanyRow[]>(() => {
  const byCompany = new Map<string, CompanyRow>();
  for (const d of data.value) {
    const key = d.company_id ?? `name:${d.company_name ?? d.uuid}`;
    let c = byCompany.get(key);
    if (!c) {
      c = {
        company_id: d.company_id,
        company_name: d.company_name ?? "—",
        company_hq: d.company_hq,
        employee_count: d.employee_count,
        company_type: d.company_type,
        services: [],
        vendors: [],
        contact_count: 0,
        connected_count: 0,
        replied_count: 0,
        contacted_count: 0,
        outgoing_count: 0,
        reply_count: 0,
        email_count: 0,
      };
      byCompany.set(key, c);
    }
    c.contact_count += 1;
    if (d.connection_status === "accepted") c.connected_count += 1;
    if (d.reply_count > 0) c.replied_count += 1;
    if (d.outgoing_count > 0 || (d.email_count ?? 0) > 0) c.contacted_count += 1;
    c.outgoing_count += d.outgoing_count;
    c.reply_count += d.reply_count;
    c.email_count += d.email_count ?? 0;
    c.services = [...new Set([...c.services, ...(d.services ?? [])])];
    c.vendors = [...new Set([...c.vendors, ...(d.vendors ?? [])])];
    // Prefer non-null company facts as we accumulate.
    if (c.company_hq == null && d.company_hq != null) c.company_hq = d.company_hq;
    if (c.employee_count == null && d.employee_count != null) c.employee_count = d.employee_count;
    if (c.company_type == null && d.company_type != null) c.company_type = d.company_type;
  }
  return [...byCompany.values()].sort((a, b) => a.company_name.localeCompare(b.company_name));
});

const filteredCompanies = computed(() => {
  const q = search.value.trim().toLowerCase();
  return companies.value.filter((c) => {
    if (typeFilter.value && c.company_type !== typeFilter.value) return false;
    if (q) {
      const hay = `${c.company_name} ${c.company_hq ?? ""} ${c.services.join(" ")} ${c.vendors.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
});

const companyColumns = computed<DataTableColumns<CompanyRow>>(() => [
  {
    title: "Company", key: "company_name", width: 200, fixed: "left", ellipsis: { tooltip: true },
    sorter: (a, b) => a.company_name.localeCompare(b.company_name),
    render: (row) =>
      row.company_id
        ? h(RouterLink, { to: { path: `/company/${row.company_id}`, query: { tag: tagUuid.value } }, style: "color:#2080f0;text-decoration:none" }, { default: () => row.company_name })
        : row.company_name,
  },
  {
    title: "Type", key: "company_type", width: 130, ellipsis: { tooltip: true },
    render: (r) => (r.company_type ? h(NTag, { size: "small", bordered: false, type: "info" }, { default: () => r.company_type }) : "—"),
  },
  { title: "HQ", key: "company_hq", width: 140, ellipsis: { tooltip: true }, render: (r) => r.company_hq ?? "—" },
  {
    title: "Employees", key: "employee_count", width: 100,
    sorter: (a, b) => (a.employee_count ?? 0) - (b.employee_count ?? 0),
    render: (r) => r.employee_count != null ? r.employee_count.toLocaleString() : "—",
  },
  {
    title: "Contacts", key: "contact_count", width: 90,
    sorter: (a, b) => a.contact_count - b.contact_count,
    render: (r) => r.contact_count,
  },
  {
    title: "Connected", key: "connected_count", width: 100,
    sorter: (a, b) => a.connected_count - b.connected_count,
    render: (r) => `${r.connected_count} / ${r.contact_count}`,
  },
  {
    title: "Contacted", key: "contacted_count", width: 100,
    sorter: (a, b) => a.contacted_count - b.contacted_count,
    render: (r) => `${r.contacted_count} / ${r.contact_count}`,
  },
  {
    title: "Replied", key: "replied_count", width: 90,
    sorter: (a, b) => a.replied_count - b.replied_count,
    render: (r) => (r.replied_count > 0 ? h(NTag, { size: "small", bordered: false, type: "success" }, { default: () => `${r.replied_count}` }) : "0"),
  },
  {
    title: "Services", key: "services", width: 200, ellipsis: { tooltip: true },
    render: (r) => (r.services.length ? r.services.join(", ") : "—"),
  },
  {
    title: "Vendors", key: "vendors", width: 200, ellipsis: { tooltip: true },
    render: (r) => (r.vendors.length ? r.vendors.join(", ") : "—"),
  },
  { title: "Out", key: "outgoing_count", width: 56, sorter: (a, b) => a.outgoing_count - b.outgoing_count, render: (r) => r.outgoing_count },
  { title: "Replies", key: "reply_count", width: 70, sorter: (a, b) => a.reply_count - b.reply_count, render: (r) => r.reply_count },
  { title: "Emails", key: "email_count", width: 70, sorter: (a, b) => a.email_count - b.email_count, render: (r) => r.email_count },
  {
    title: "", key: "actions", width: 60, fixed: "right",
    render: (row) =>
      row.company_id
        ? h(NTooltip, null, {
            trigger: () => h(RouterLink, { to: { path: `/company/${row.company_id}`, query: { tag: tagUuid.value } } },
              { default: () => h(NButton, { size: "tiny", type: "primary", secondary: true }, { icon: () => h(IdCardIcon, { size: 14 }) }) }),
            default: () => "Open company card",
          })
        : "",
  },
]);

const columns = computed<DataTableColumns<LeaderRecord>>(() => [
  { type: "selection", width: 36, fixed: "left" },
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
        ? h(RouterLink, { to: { path: `/company/${row.company_id}`, query: { tag: tagUuid.value } }, style: "color:#2080f0;text-decoration:none" }, { default: () => row.company_name ?? "—" })
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
  {
    title: "Last sent",
    key: "last_outbound_at",
    width: 96,
    sorter: (a, b) => (new Date(a.last_outbound_at ?? 0).getTime()) - (new Date(b.last_outbound_at ?? 0).getTime()),
    render: (r) => fmtDate(r.last_outbound_at),
  },
  { title: "Replies", key: "reply_count", width: 68, sorter: (a, b) => a.reply_count - b.reply_count, render: (r) => r.reply_count },
  { title: "Emails", key: "email_count", width: 64, sorter: (a, b) => (a.email_count ?? -1) - (b.email_count ?? -1), render: (r) => r.email_count ?? "—" },
  {
    title: "Status", key: "status", width: 160, ellipsis: { tooltip: true },
    sorter: (a, b) => a.status.localeCompare(b.status),
    render: (r) => h(NTag, { size: "small", bordered: false, type: statusType(r.status) }, { default: () => r.status }),
  },
  {
    title: "Actions", key: "actions", width: 220, fixed: "right",
    render: (row) =>
      h(NSpace, { size: 4, wrap: false }, {
        default: () => [
          h(NButton, { size: "tiny", type: "primary", onClick: () => createOutreach(row) }, { default: () => "Create outreach" }),
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
</script>

<template>
  <NCard v-if="!isFeasibleProject">
    <NAlert type="info" title="Feasible project only">
      MSSP Leaders in MENA is part of the Feasible project. Select Feasible in the project picker to use this view.
    </NAlert>
  </NCard>
  <NCard v-else>
    <template #header>
      <div style="display:flex;justify-content:center;margin-bottom:14px">
        <NButtonGroup>
          <NButton
            size="large"
            :type="region === 'MENA' ? 'primary' : 'default'"
            :secondary="region !== 'MENA'"
            :disabled="loading"
            style="min-width:120px;font-weight:600;letter-spacing:0"
            @click="selectRegion('MENA')"
          >MENA</NButton>
          <NButton
            size="large"
            :type="region === 'LATAM' ? 'primary' : 'default'"
            :secondary="region !== 'LATAM'"
            :disabled="loading"
            style="min-width:120px;font-weight:600;letter-spacing:0"
            @click="selectRegion('LATAM')"
          >LATAM</NButton>
        </NButtonGroup>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px">
          <component :is="view === 'companies' ? Building2Icon : UsersIcon" :size="16" />
          <span>MSSP Leaders in {{ region }}</span>
          <NTag size="small" :bordered="false" type="info">
            {{ view === 'companies' ? `${filteredCompanies.length} / ${companies.length}` : `${filtered.length} / ${data.length}` }}
          </NTag>
          <span v-if="loading" style="opacity:.6;font-size:.82rem">Loading…</span>
        </div>
        <NSpace size="small" align="center" wrap>
          <NInput v-model:value="search" :placeholder="view === 'companies' ? 'Search company, HQ, vendor…' : 'Search name, company, title…'" clearable size="small" style="width: 220px" />
          <NSelect v-if="view === 'contacts'" v-model:value="statusFilter" :options="statusOptions" placeholder="Status" clearable size="small" style="width: 150px" />
          <NSelect v-if="view === 'contacts'" v-model:value="connFilter" :options="connOptions" placeholder="Connection" clearable size="small" style="width: 120px" />
          <NSelect v-if="view === 'contacts'" v-model:value="lastOutboundDaysFilter" :options="lastOutboundDaysOptions" placeholder="Last sent" clearable size="small" style="width: 132px" />
          <NSelect v-model:value="typeFilter" :options="typeOptions" placeholder="Company type" clearable size="small" style="width: 140px" />
          <NTooltip v-if="view === 'contacts' && selectedUuids.length > 0">
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
            Remove selected contacts from "MSSP Leaders in {{ region }}" tag
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

    <NTabs v-model:value="view" type="segment" size="small" style="margin-bottom:10px;max-width:320px">
      <NTabPane name="contacts" tab="Contacts" />
      <NTabPane name="companies" tab="Companies" />
    </NTabs>

    <NAlert v-if="error" type="error" :show-icon="false" style="margin-bottom:8px">{{ error }}</NAlert>
    <NEmpty v-else-if="!loading && data.length === 0" description="No contacts tagged for this list." />
    <NDataTable
      v-else-if="view === 'contacts'"
      :columns="columns"
      :data="filtered"
      :scroll-x="2000"
      :row-key="(r: LeaderRecord) => r.uuid"
      v-model:checked-row-keys="checkedKeys"
      :pagination="{ pageSize: 25, showSizePicker: true, pageSizes: [25, 50, 100] }"
      :loading="loading"
    />
    <NDataTable
      v-else
      :columns="companyColumns"
      :data="filteredCompanies"
      :scroll-x="1800"
      :row-key="(r: CompanyRow) => r.company_id ?? r.company_name"
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
  <OutreachAgentDrawer v-if="outreachContact" v-model:show="outreachOpen" :contact-id="outreachContact.uuid" :contact-name="outreachContact.name" />
</template>
