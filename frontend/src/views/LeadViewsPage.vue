<script setup lang="ts">
import { ref, computed, h, onMounted } from "vue";
import {
  NCard, NDataTable, NInput, NButton, NTag, NAlert, NEmpty, NSpace, NSelect, NTabs, NTabPane,
  NTooltip, NDrawer, NDrawerContent, NPopconfirm, useMessage,
} from "naive-ui";
import type { DataTableColumns, DataTableRowKey, SelectOption } from "naive-ui";
import { LayersIcon, LinkedinIcon, FileTextIcon, MailIcon, RocketIcon } from "lucide-vue-next";
import { RouterLink, useRoute } from "vue-router";
import { marked } from "marked";
import DOMPurify from "dompurify";
import FeasibleComposer from "../components/FeasibleComposer.vue";
import { useProjectStore } from "../stores/project";

type LeadView = "best_fit" | "review" | "disqualified";

interface BundleContact {
  lead_uuid: string;
  name: string;
  position: string;
  linkedin_url: string | null;
  role_family: string;
  seniority: string;
  tier: string;
  phase_a_eligibility: string;
}
interface CompanyRow {
  result_id: string;
  company_id: string | null;
  company_name: string;
  company_domain: string;
  company_type_tag: string;
  fit_status: string;
  motion: string;
  competing_product_risk: string;
  hard_exclusion: boolean;
  hard_exclusion_reason: string;
  relevant_contact_count: number;
  pov_markdown: string;
  research_one_liner: string;
  created_at: string;
  view: LeadView;
  contacts: BundleContact[];
  qualification_status: string;
  qualification_decided_at: string | null;
}

const message = useMessage();
const route = useRoute();
const projectStore = useProjectStore();

const items = ref<CompanyRow[]>([]);
const counts = ref<Record<LeadView, number>>({ best_fit: 0, review: 0, disqualified: 0 });
const loading = ref(false);
const error = ref("");
const search = ref("");
const activeView = ref<LeadView>("best_fit");
const checkedKeys = ref<DataTableRowKey[]>([]);

type ScopeMode = "recent" | "launch" | "execution";
const scopeMode = ref<ScopeMode>(
  typeof route.query.launchId === "string" ? "launch" : typeof route.query.executionId === "string" ? "execution" : "recent"
);
const scopeValue = ref<string>(String(route.query.launchId ?? route.query.executionId ?? ""));
const scopeOptions: SelectOption[] = [
  { label: "Recent research", value: "recent" },
  { label: "By launch id", value: "launch" },
  { label: "By execution id", value: "execution" },
];

const workflows = ref<{ key: string; label: string; configured: boolean }[]>([]);
const launchWorkflow = ref<string | null>(null);
const launching = ref(false);
const workflowOptions = computed<SelectOption[]>(() =>
  workflows.value.map((w) => ({ label: w.configured ? w.label : `${w.label} (not configured)`, value: w.key, disabled: !w.configured }))
);

const viewItems = computed(() => {
  const q = search.value.trim().toLowerCase();
  return items.value.filter((r) => {
    if (r.view !== activeView.value) return false;
    if (q && !`${r.company_name} ${r.company_domain} ${r.motion}`.toLowerCase().includes(q)) return false;
    return true;
  });
});
const selectedIds = computed(() => checkedKeys.value.map(String));
const selectedCompanies = computed(() => items.value.filter((i) => selectedIds.value.includes(i.result_id)));

async function loadWorkflows(): Promise<void> {
  try {
    const r = await fetch("/api/n8n/workflows");
    const j = (await r.json()) as { items?: typeof workflows.value };
    workflows.value = j.items ?? [];
    const f = workflows.value.find((w) => w.configured);
    if (f && !launchWorkflow.value) launchWorkflow.value = f.key;
  } catch { /* non-fatal */ }
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  checkedKeys.value = [];
  try {
    const body: Record<string, unknown> = {};
    if (scopeMode.value === "launch" && scopeValue.value.trim()) body.launchId = scopeValue.value.trim();
    if (scopeMode.value === "execution" && scopeValue.value.trim()) body.executionId = scopeValue.value.trim();
    const r = await fetch("/api/lead-views/items", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = (await r.json()) as { items?: CompanyRow[]; counts?: Record<LeadView, number>; error?: string };
    if (!r.ok) throw new Error(j.error ?? "Failed to load");
    items.value = j.items ?? [];
    counts.value = j.counts ?? { best_fit: 0, review: 0, disqualified: 0 };
    const order: LeadView[] = ["best_fit", "review", "disqualified"];
    activeView.value = order.find((v) => counts.value[v] > 0) ?? "best_fit";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load";
    items.value = [];
    counts.value = { best_fit: 0, review: 0, disqualified: 0 };
  } finally {
    loading.value = false;
  }
}

async function decide(companyId: string | null, decision: "approved" | "refused" | "pending"): Promise<void> {
  if (!companyId) { message.warning("Company has no id"); return; }
  try {
    const r = await fetch("/api/lead-views/decide", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, decision }),
    });
    const j = (await r.json()) as { ok?: boolean; error?: string };
    if (!r.ok || !j.ok) throw new Error(j.error ?? "Failed");
    const row = items.value.find((i) => i.company_id === companyId);
    if (row) row.qualification_status = decision;
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to save decision");
  }
}
async function decideSelected(decision: "approved" | "refused"): Promise<void> {
  const cos = selectedCompanies.value.filter((c) => c.company_id);
  if (!cos.length) return;
  await Promise.all(cos.map((c) => decide(c.company_id, decision)));
  message.success(`${cos.length} marked ${decision}`);
  checkedKeys.value = [];
}

async function launchSelected(): Promise<void> {
  if (!projectStore.selectedProjectId) { message.warning("Select a project first"); return; }
  if (!launchWorkflow.value) { message.warning("Choose a workflow"); return; }
  const leadUuids = [...new Set(selectedCompanies.value.flatMap((c) => c.contacts.map((ct) => ct.lead_uuid)).filter(Boolean))];
  if (!leadUuids.length) { message.warning("Selected companies have no relevant contacts"); return; }
  launching.value = true;
  try {
    const r = await fetch("/api/n8n/launch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: projectStore.selectedProjectId, workflowKey: launchWorkflow.value, leadUuids }),
    });
    const j = (await r.json()) as { launchId?: string; error?: string };
    if (!r.ok || !j.launchId) throw new Error(j.error ?? "Launch failed");
    message.success(`Launched ${leadUuids.length} contact(s) from ${selectedCompanies.value.length} company(ies)`);
    checkedKeys.value = [];
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Launch failed");
  } finally {
    launching.value = false;
  }
}

// POV drawer
const povRow = ref<CompanyRow | null>(null);
const povHtml = computed(() => (povRow.value?.pov_markdown ? DOMPurify.sanitize(marked.parse(povRow.value.pov_markdown) as string) : "<em>No POV.</em>"));
// Message composer drawer (per relevant contact)
const composerLead = ref<{ uuid: string; name: string } | null>(null);

const qualType = (s: string) => (s === "approved" ? "success" : s === "refused" ? "error" : "default");
const fitType = (s: string) => (s === "tier_1" ? "success" : s === "tier_2" ? "info" : "default");
const riskType = (s: string) => (s === "high" ? "error" : s === "medium" ? "warning" : "default");
const typeTagType = (s: string) => (s === "not_relevant" ? "warning" : "info");
function chip(value: string, type: "default" | "success" | "info" | "warning" | "error") {
  return value ? h(NTag, { size: "small", bordered: false, type }, { default: () => value }) : "—";
}

function renderExpand(row: CompanyRow) {
  if (!row.contacts.length) return h("div", { style: "opacity:.6;padding:4px 8px" }, "No relevant contacts.");
  return h("div", { style: "padding:6px 8px;display:flex;flex-direction:column;gap:4px" },
    row.contacts.map((ct) =>
      h(NSpace, { align: "center", size: 8, wrap: false, key: ct.lead_uuid }, {
        default: () => [
          ct.tier ? h(NTag, { size: "tiny", bordered: false, type: ct.tier === "tier_1" ? "success" : "default" }, { default: () => ct.tier }) : null,
          h(RouterLink, { to: `/contact/${ct.lead_uuid}`, style: "color:#2080f0;text-decoration:none;font-weight:500" }, { default: () => ct.name || "(no name)" }),
          h("span", { style: "opacity:.7;font-size:.82rem" }, `${ct.position || "—"}${ct.role_family ? " · " + ct.role_family : ""}`),
          ct.linkedin_url ? h("a", { href: ct.linkedin_url, target: "_blank", rel: "noopener", style: "color:#0a66c2;display:inline-flex" }, h(LinkedinIcon, { size: 13 })) : null,
          h(NButton, { size: "tiny", quaternary: true, onClick: () => (composerLead.value = { uuid: ct.lead_uuid, name: ct.name }) }, { icon: () => h(MailIcon, { size: 13 }), default: () => "Message" }),
        ],
      })
    )
  );
}

const columns = computed<DataTableColumns<CompanyRow>>(() => [
  { type: "selection", width: 36, fixed: "left" },
  { type: "expand", width: 36, expandable: (r) => r.contacts.length > 0, renderExpand },
  {
    title: "Company", key: "company_name", width: 200, fixed: "left", ellipsis: { tooltip: true },
    render: (r) => r.company_id
      ? h(RouterLink, { to: `/company/${r.company_id}`, style: "color:#2080f0;text-decoration:none" }, { default: () => r.company_name || "—" })
      : (r.company_name || "—"),
  },
  { title: "Type", key: "company_type_tag", width: 130, render: (r) => chip(r.company_type_tag, typeTagType(r.company_type_tag)) },
  { title: "Fit", key: "fit_status", width: 90, render: (r) => chip(r.fit_status, fitType(r.fit_status)) },
  { title: "Motion", key: "motion", width: 90, render: (r) => r.motion || "—" },
  { title: "Compete risk", key: "competing_product_risk", width: 110, render: (r) => chip(r.competing_product_risk, riskType(r.competing_product_risk)) },
  { title: "Contacts", key: "relevant_contact_count", width: 80, render: (r) => r.relevant_contact_count || r.contacts.length },
  {
    title: "Reason", key: "hard_exclusion_reason", width: 160, ellipsis: { tooltip: true },
    render: (r) => (r.hard_exclusion ? h(NTag, { size: "small", bordered: false, type: "warning" }, { default: () => r.hard_exclusion_reason || "excluded" }) : "—"),
  },
  { title: "Decision", key: "qualification_status", width: 100, render: (r) => chip(r.qualification_status, qualType(r.qualification_status)) },
  {
    title: "Actions", key: "actions", width: 170, fixed: "right",
    render: (row) => h(NSpace, { size: 4, wrap: false }, {
      default: () => [
        h(NTooltip, null, {
          trigger: () => h(NButton, { size: "tiny", secondary: true, disabled: !row.pov_markdown, onClick: () => (povRow.value = row) }, { icon: () => h(FileTextIcon, { size: 14 }), default: () => "POV" }),
          default: () => "View POV",
        }),
        h(NButton, { size: "tiny", type: "success", secondary: row.qualification_status !== "approved", onClick: () => decide(row.company_id, "approved") }, { default: () => "✓" }),
        h(NButton, { size: "tiny", type: "error", secondary: row.qualification_status !== "refused", onClick: () => decide(row.company_id, "refused") }, { default: () => "✕" }),
      ],
    }),
  },
]);

onMounted(async () => { await Promise.all([loadWorkflows(), load()]); });
</script>

<template>
  <NCard>
    <template #header>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px">
          <LayersIcon :size="16" />
          <span>Lead views</span>
          <span v-if="loading" style="opacity:.6;font-size:.82rem">Loading…</span>
        </div>
        <NSpace size="small" align="center" wrap>
          <NSelect v-model:value="scopeMode" :options="scopeOptions" size="small" style="width: 160px" />
          <NInput v-if="scopeMode !== 'recent'" v-model:value="scopeValue" :placeholder="scopeMode === 'launch' ? 'launch id' : 'execution id'" clearable size="small" style="width: 220px" />
          <NInput v-model:value="search" placeholder="Search company, domain…" clearable size="small" style="width: 190px" />
          <NButton size="small" type="primary" :loading="loading" @click="load">Load</NButton>
        </NSpace>
      </div>
    </template>

    <NAlert v-if="error" type="error" :show-icon="false" style="margin-bottom:8px">{{ error }}</NAlert>

    <NSpace align="center" wrap size="small" style="margin-bottom:8px">
      <span style="opacity:.7;font-size:.85rem">{{ selectedIds.length }} companies selected</span>
      <NButton size="tiny" type="success" secondary :disabled="!selectedIds.length" @click="decideSelected('approved')">Approve</NButton>
      <NButton size="tiny" type="error" secondary :disabled="!selectedIds.length" @click="decideSelected('refused')">Refuse</NButton>
      <NSelect v-model:value="launchWorkflow" :options="workflowOptions" placeholder="Workflow" size="small" style="width: 240px" />
      <NPopconfirm @positive-click="launchSelected">
        <template #trigger>
          <NButton size="small" type="primary" :disabled="!selectedIds.length || !launchWorkflow" :loading="launching">
            <template #icon><RocketIcon :size="14" /></template>
            Launch selected
          </NButton>
        </template>
        Launch all relevant contacts from {{ selectedIds.length }} selected company(ies) into "{{ launchWorkflow }}"?
      </NPopconfirm>
    </NSpace>

    <NTabs v-model:value="activeView" type="line" animated>
      <NTabPane name="best_fit" :tab="`Best Fit (${counts.best_fit})`" />
      <NTabPane name="review" :tab="`Review (${counts.review})`" />
      <NTabPane name="disqualified" :tab="`Disqualified (${counts.disqualified})`" />
    </NTabs>

    <NEmpty v-if="!loading && viewItems.length === 0" description="No companies in this view." style="margin-top:24px" />
    <NDataTable
      v-else
      :columns="columns"
      :data="viewItems"
      :scroll-x="1300"
      :row-key="(r: CompanyRow) => r.result_id"
      v-model:checked-row-keys="checkedKeys"
      :pagination="{ pageSize: 25, showSizePicker: true, pageSizes: [25, 50, 100] }"
      :loading="loading"
    />

    <NDrawer :show="!!povRow" :width="640" placement="right" @update:show="(v: boolean) => { if (!v) povRow = null; }">
      <NDrawerContent :title="`POV — ${povRow?.company_name ?? ''}`" closable>
        <div class="pov-md" v-html="povHtml" />
      </NDrawerContent>
    </NDrawer>

    <NDrawer :show="!!composerLead" :width="620" placement="right" @update:show="(v: boolean) => { if (!v) composerLead = null; }">
      <NDrawerContent :title="`Message — ${composerLead?.name ?? ''}`" closable>
        <FeasibleComposer v-if="composerLead" :lead-uuid="composerLead.uuid" :contact-name="composerLead.name" />
      </NDrawerContent>
    </NDrawer>
  </NCard>
</template>

<style scoped>
.pov-md {
  font-size: 0.86rem;
  line-height: 1.5;
}
.pov-md :deep(h1), .pov-md :deep(h2), .pov-md :deep(h3) { font-size: 1rem; margin: 0.8em 0 0.3em; }
.pov-md :deep(ul) { padding-left: 1.2em; }
</style>
