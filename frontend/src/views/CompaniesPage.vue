<script setup lang="ts">
import { ref, computed, watch, h } from "vue";
import { useDebounceFn } from "@vueuse/core";
import {
  NCard,
  NDataTable,
  NInput,
  NButton,
  NSpace,
  NAlert,
  NEmpty,
  NModal,
  NForm,
  NFormItem,
  NSelect,
  NInputNumber,
  NTag,
  NCheckbox,
  NPopover,
  NSpin,
  useMessage,
} from "naive-ui";
import type { DataTableColumns, DataTableRowKey } from "naive-ui";
import { BuildingIcon, LinkIcon, PlusCircleIcon, FileTextIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";

const projectStore = useProjectStore();
const message = useMessage();

// --- Types ---
interface CompanyContact {
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  project_id: string | null;
}

function normalizeCompanyTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => {
    if (typeof x === "string") return x;
    if (typeof x === "number" && Number.isFinite(x)) return String(x);
    return String(x);
  });
}

interface CompanyRow {
  id: string;
  company_id: string;
  name: string | null;
  domain: string | null;
  linkedin: string | null;
  created_at: string;
  /** Tag values from companies.tags (jsonb). */
  tags: string[];
  in_project: boolean;
  project_company_id: string | null;
  hypotheses: Array<{ id: string; name: string }>;
  contact_count: number;
  contacts_preview: CompanyContact[];
}

type ContextRow = { id: string; created_at: string; rootContext: string | null; company_id: string | null };

interface HypothesisOption {
  label: string;
  value: string;
}

// --- Table state ---
const data = ref<CompanyRow[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref("");
const page = ref(1);
const pageSize = ref(25);
const PAGE_SIZES = [10, 25, 50, 100];
const searchInput = ref("");
const appliedSearch = ref("");
const checkedKeys = ref<DataTableRowKey[]>([]);
const showAll = ref(false);

// --- Context modal ---
const ctxModalOpen = ref(false);
const ctxModalName = ref("");
const ctxModalCompanyId = ref<string>("");
const ctxLoading = ref(false);
const ctxRows = ref<ContextRow[]>([]);
const newCtxText = ref("");
const addingCtx = ref(false);

// Context count per company_id (for badge next to button)
const companyContextCounts = ref<Record<string, number>>({});

async function fetchCompanyContextCounts(rows: CompanyRow[]) {
  const ids = [...new Set(rows.map((r) => r.company_id).filter(Boolean))] as string[];
  if (ids.length === 0) return;
  try {
    const r = await fetch(`/api/company-context-counts?company_ids=${ids.map((id) => encodeURIComponent(id)).join(",")}`);
    const j = await r.json();
    if (!r.ok) return;
    const counts = (j.data as Record<string, number>) ?? {};
    companyContextCounts.value = { ...companyContextCounts.value, ...counts };
  } catch {
    // keep existing counts on error
  }
}

watch(data, (rows) => {
  if (rows.length > 0) void fetchCompanyContextCounts(rows);
}, { immediate: true });

async function openContextModal(row: CompanyRow) {
  const companyId = (row.company_id ?? "").trim();
  if (!companyId) {
    message.warning("Company has no id.");
    return;
  }
  ctxModalCompanyId.value = companyId;
  ctxModalName.value = row.name ?? "";
  ctxModalOpen.value = true;
  newCtxText.value = "";
  await loadContexts();
}

async function loadContexts() {
  if (!ctxModalCompanyId.value) return;
  ctxLoading.value = true;
  try {
    const r = await fetch(`/api/company-context?company_id=${encodeURIComponent(ctxModalCompanyId.value)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to load contexts");
    ctxRows.value = j.data ?? [];
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to load contexts");
  } finally {
    ctxLoading.value = false;
  }
}

async function addContext() {
  const text = newCtxText.value.trim();
  if (!text) return;
  if (!ctxModalCompanyId.value) {
    message.warning("Company id is missing.");
    return;
  }
  addingCtx.value = true;
  try {
    const r = await fetch("/api/company-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: ctxModalCompanyId.value,
        rootContext: text,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to add context");
    newCtxText.value = "";
    await loadContexts();
    if (ctxModalCompanyId.value) {
      companyContextCounts.value = {
        ...companyContextCounts.value,
        [ctxModalCompanyId.value]: ctxRows.value.length,
      };
    }
    message.success("Context added.");
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to add context");
  } finally {
    addingCtx.value = false;
  }
}

const debouncedSearch = useDebounceFn(() => {
  appliedSearch.value = searchInput.value.trim();
  page.value = 1;
}, 300);

watch(searchInput, () => debouncedSearch());

// --- Fetch companies ---
async function fetchCompanies() {
  const projectId = projectStore.selectedProjectId;
  // When not showing all, require a project to be selected
  if (!showAll.value && !projectId) {
    data.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({
      limit: String(pageSize.value),
      offset: String((page.value - 1) * pageSize.value),
    });
    if (projectId) q.set("projectId", projectId);
    if (appliedSearch.value) q.set("search", appliedSearch.value);

    let url: string;
    if (showAll.value) {
      // All companies with in_project flag
      url = `/api/companies?${q}`;
    } else {
      // Only project-connected companies
      url = `/api/project-companies?${q}`;
    }

    const r = await fetch(url);
    const json = await r.json();
    if (!r.ok) {
      error.value = json.error ?? "Request failed";
      data.value = [];
      total.value = 0;
      return;
    }

    if (showAll.value) {
      data.value = (json.data ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        company_id: (row.company_id as string) ?? (row.id as string),
        tags: normalizeCompanyTags(row.tags),
        hypotheses: [],
        contact_count: 0,
        contacts_preview: [],
      }));
    } else {
      // Normalise project-companies response into same shape
      data.value = (json.data ?? []).map((row: Record<string, unknown>) => ({
        id: row.project_company_id as string,
        company_id: (row.company_id as string) ?? (row.project_company_id as string),
        name: row.name as string | null,
        domain: row.domain as string,
        linkedin: row.linkedin as string | null,
        created_at: row.created_at as string,
        tags: normalizeCompanyTags(row.tags),
        in_project: true,
        project_company_id: row.project_company_id as string,
        hypotheses: Array.isArray(row.hypotheses) ? row.hypotheses : [],
        contact_count: Number(row.contact_count) || 0,
        contacts_preview: Array.isArray(row.contacts_preview) ? row.contacts_preview : [],
      }));
    }
    total.value = Number(json.total) || 0;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Request failed";
    data.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

watch(
  [() => projectStore.selectedProjectId, page, pageSize, appliedSearch, showAll],
  () => fetchCompanies(),
  { immediate: true }
);

// Reset selection and search on project change
watch(
  () => projectStore.selectedProjectId,
  () => {
    page.value = 1;
    checkedKeys.value = [];
    searchInput.value = "";
    appliedSearch.value = "";
  }
);

// Reset page and selection when toggling the view
watch(showAll, () => {
  page.value = 1;
  checkedKeys.value = [];
});

// --- Columns ---
const columns = computed<DataTableColumns<CompanyRow>>(() => [
  { type: "selection", fixed: "left" },
  {
    key: "name",
    title: "Name",
    ellipsis: { tooltip: true },
    render: (row) => {
      const label = row.name ?? row.domain;
      if (!row.in_project) return label;
      return h(NSpace, { align: "center", size: 6, wrap: false }, [
        label,
        h(NTag, { size: "tiny", type: "success", bordered: false }, { default: () => "in project" }),
      ]);
    },
  },
  {
    key: "domain",
    title: "Domain",
    ellipsis: { tooltip: true },
    render: (row) => row.domain ?? "—",
  },
  {
    key: "tags",
    title: "Tags",
    width: 120,
    render: (row: CompanyRow) => {
      const ids = row.tags ?? [];
      if (ids.length === 0) return h("span", { style: "opacity:.4" }, "—");
      return h(
        NSpace,
        { size: 4, wrap: true },
        {
          default: () =>
            ids.map((id) =>
              h(NTag, { size: "tiny", bordered: false, key: String(id) }, { default: () => String(id) })
            ),
        }
      );
    },
  },
  {
    key: "linkedin",
    title: "LinkedIn",
    width: 100,
    render: (row) => {
      if (!row.linkedin) return "—";
      return h(
        "a",
        { href: row.linkedin, target: "_blank", rel: "noopener", style: "color: inherit" },
        [h(LinkIcon, { size: 13 })]
      );
    },
  },
  ...(!showAll.value ? [
    {
      key: "hypotheses",
      title: "In hypothesis",
      width: 130,
      render: (row: CompanyRow) => {
        const hyps = row.hypotheses ?? [];
        if (hyps.length === 0) return h("span", { style: "opacity:.4" }, "—");
        return h(
          NPopover,
          { trigger: "hover", placement: "top" },
          {
            trigger: () =>
              h(NTag, { size: "small", type: "info", bordered: false, style: "cursor:default" }, {
                default: () => `${String(hyps.length)} hypothesis`,
              }),
            default: () =>
              h("div", { style: "max-width:260px" },
                hyps.map((hyp) =>
                  h("div", { key: hyp.id, style: "padding:2px 0;font-size:0.82rem" }, `• ${hyp.name}`)
                )
              ),
          }
        );
      },
    },
    {
      key: "contacts",
      title: "Contacts",
      width: 110,
      render: (row: CompanyRow) => {
        const count = row.contact_count ?? 0;
        const preview = row.contacts_preview ?? [];
        if (count === 0) return h("span", { style: "opacity:.4" }, "—");
        return h(
          NPopover,
          { trigger: "hover", placement: "top-start" },
          {
            trigger: () =>
              h(NTag, { size: "small", type: "default", bordered: false, style: "cursor:default" }, {
                default: () => `${String(count)} contact`,
              }),
            default: () =>
              h("div", { style: "min-width:200px;max-width:320px" },
                preview.map((c, i) => {
                  const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
                  const TAG_TYPES = ["primary", "info", "success", "warning", "error"] as const;
                  const projIdx = c.project_id
                    ? projectStore.projects.findIndex((p) => p.id === c.project_id)
                    : -1;
                  const proj = projIdx >= 0 ? projectStore.projects[projIdx] : null;
                  const tagType = proj ? TAG_TYPES[projIdx % TAG_TYPES.length] : "default";
                  return h("div", { key: i, style: "padding:4px 0;font-size:0.82rem;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap" }, [
                    proj
                      ? h(NTag, { size: "tiny", type: tagType, bordered: false, style: "flex-shrink:0;font-size:0.7rem" }, { default: () => proj.name })
                      : null,
                    h("span", { style: "font-weight:500" }, fullName),
                    c.position
                      ? h("span", { style: "opacity:.55" }, c.position)
                      : null,
                  ]);
                })
              ),
          }
        );
      },
    },
  ] : []),
  {
    key: "context",
    title: "Context",
    width: 150,
    render: (row: CompanyRow) => {
      const count = row.company_id ? (companyContextCounts.value[row.company_id] ?? null) : null;
      return h(
        NSpace,
        { align: "center", size: 6, wrap: false },
        [
          h(
            NTag,
            { style: "cursor:pointer", onClick: () => openContextModal(row), size: "small", bordered: false, type: count && count > 0 ? "info" : "warning" },
            { default: () => count ? `${count} context` : "Click to add context" }
          ),
        ].filter(Boolean)
      );
    },
  },
  {
    key: "created_at",
    title: "Added",
    width: 120,
    render: (row) => new Date(row.created_at).toLocaleDateString(),
  },
]);

// --- Selection helpers ---
const selectedRows = computed(() =>
  data.value.filter((r) => checkedKeys.value.includes(r.id))
);
const selectedCount = computed(() => checkedKeys.value.length);
const notInProjectSelected = computed(() => selectedRows.value.filter((r) => !r.in_project));
const inProjectSelected = computed(() => selectedRows.value.filter((r) => r.in_project && r.project_company_id));

// --- Add to project ---
const addingToProject = ref(false);

async function addToProject() {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) { message.error("No project selected."); return; }
  const ids = notInProjectSelected.value.map((r) => r.id);
  if (ids.length === 0) { message.warning("All selected companies are already in the project."); return; }
  addingToProject.value = true;
  try {
    const r = await fetch("/api/project-companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, companyIds: ids }),
    });
    const json = await r.json();
    if (!r.ok) { message.error(json.error ?? "Failed to add companies."); return; }
    message.success(`Added ${json.added} company(s) to project.`);
    checkedKeys.value = [];
    fetchCompanies();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Request failed");
  } finally {
    addingToProject.value = false;
  }
}

// --- Add to hypothesis modal ---
const hypotheses = ref<HypothesisOption[]>([]);
const hypothesesLoading = ref(false);
const modalOpen = ref(false);
const modalHypothesisId = ref<string | null>(null);
const modalScore = ref<number | null>(null);
const submitting = ref(false);

async function fetchHypotheses() {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) return;
  hypothesesLoading.value = true;
  try {
    const r = await fetch(`/api/hypotheses?projectId=${projectId}`);
    const json = await r.json();
    hypotheses.value = (json.data ?? []).map((h: { id: string; name: string }) => ({
      label: h.name,
      value: h.id,
    }));
  } catch {
    hypotheses.value = [];
  } finally {
    hypothesesLoading.value = false;
  }
}

function openHypothesisModal() {
  modalHypothesisId.value = null;
  modalScore.value = null;
  fetchHypotheses();
  modalOpen.value = true;
}

async function submitAddToHypothesis() {
  if (!modalHypothesisId.value) { message.warning("Please select a hypothesis."); return; }
  const targets = inProjectSelected.value;
  if (targets.length === 0) { message.warning("Selected companies must be added to the project first."); return; }
  submitting.value = true;
  try {
    const r = await fetch(`/api/hypotheses/${modalHypothesisId.value}/targets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectCompanyIds: targets.map((r) => r.project_company_id),
        score: modalScore.value,
      }),
    });
    const json = await r.json();
    if (!r.ok) { message.error(json.error ?? "Failed to add to hypothesis."); return; }
    message.success(`Added ${json.inserted ?? targets.length} company(s) to hypothesis.`);
    modalOpen.value = false;
    checkedKeys.value = [];
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Request failed");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="companies-page">
    <NCard>
      <div class="toolbar">
        <div class="toolbar-left">
          <BuildingIcon :size="18" class="page-icon" />
          <span class="page-title">Companies</span>
          <NTag v-if="total > 0" size="small" :bordered="false">{{ total }}</NTag>
        </div>
        <div class="toolbar-right">
          <span v-if="loading" class="toolbar-loading-hint">Loading…</span>
          <NCheckbox v-model:checked="showAll" size="small">Show all</NCheckbox>
          <NInput
            v-model:value="searchInput"
            placeholder="Search name or domain…"
            clearable
            size="small"
            style="width: 220px"
          />
        </div>
      </div>

      <!-- Bulk action bar -->
      <div v-if="selectedCount > 0" class="bulk-bar">
        <span class="bulk-count">{{ selectedCount }} selected</span>
        <NButton
          v-if="notInProjectSelected.length > 0 && projectStore.selectedProjectId"
          type="primary"
          size="small"
          :loading="addingToProject"
          @click="addToProject"
        >
          <template #icon><LinkIcon :size="14" /></template>
          Add {{ notInProjectSelected.length }} to project
        </NButton>
        <NButton
          v-if="inProjectSelected.length > 0"
          type="primary"
          size="small"
          @click="openHypothesisModal"
        >
          <template #icon><PlusCircleIcon :size="14" /></template>
          Add {{ inProjectSelected.length }} to hypothesis
        </NButton>
        <NButton quaternary size="small" @click="checkedKeys = []">Clear</NButton>
      </div>

      <NAlert v-if="error" type="error" style="margin-bottom: 0.75rem">{{ error }}</NAlert>

      <NDataTable
        v-if="data.length > 0 || loading"
        v-model:checked-row-keys="checkedKeys"
        :columns="columns"
        :data="data"
        :bordered="false"
        size="small"
        :max-height="600"
        :scroll-x="760"
        remote
        :row-key="(row: CompanyRow) => row.id"
        :pagination="{
          page,
          pageSize,
          itemCount: total,
          showSizePicker: true,
          pageSizes: PAGE_SIZES,
          onUpdatePage: (p: number) => { page = p; },
          onUpdatePageSize: (ps: number) => { pageSize = ps; page = 1; },
        }"
      />
      <NEmpty
        v-else-if="!loading"
        :description="showAll ? 'No companies found' : 'No companies in this project — check \'Show all\' to browse and add'"
      />
    </NCard>

    <!-- Add to hypothesis modal -->
    <NModal
      v-model:show="modalOpen"
      preset="card"
      title="Add to hypothesis"
      style="max-width: 480px"
      :mask-closable="!submitting"
    >
      <NForm label-placement="left" label-width="120px">
        <NFormItem label="Hypothesis" required>
          <NSelect
            v-model:value="modalHypothesisId"
            :options="hypotheses"
            :loading="hypothesesLoading"
            placeholder="Select hypothesis…"
            filterable
          />
        </NFormItem>
        <NFormItem label="Score">
          <NInputNumber
            v-model:value="modalScore"
            placeholder="0–100"
            :min="0"
            :max="100"
            style="width: 100%"
            clearable
          />
        </NFormItem>
      </NForm>
      <div class="modal-hint">
        {{ inProjectSelected.length }} company(s) will be added. Score applies to all rows.
      </div>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="modalOpen = false" :disabled="submitting">Cancel</NButton>
          <NButton type="primary" :loading="submitting" @click="submitAddToHypothesis">Add</NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- Company context modal -->
    <NModal v-model:show="ctxModalOpen" preset="card" style="width: 760px">
      <template #header>
        <div style="display:flex;align-items:center;gap:8px">
          <FileTextIcon :size="16" />
          <span>Company contexts</span>
          <NTag size="small" :bordered="false" type="info">{{ ctxRows.length }}</NTag>
        </div>
        <div style="opacity:.6;font-size:.85rem;margin-top:4px">{{ ctxModalName }}</div>
      </template>

      <div v-if="ctxLoading" style="display:flex;justify-content:center;padding:18px 0">
        <NSpin />
      </div>

      <div v-else>
        <div v-if="ctxRows.length === 0" style="opacity:.6;margin-bottom:10px">No context yet.</div>
        <div v-else style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px">
          <NCard v-for="c in ctxRows" :key="c.id" size="small" embedded>
            <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:6px">
              <span style="opacity:.65;font-size:.82rem">{{ new Date(c.created_at).toLocaleString() }}</span>
            </div>
            <div style="white-space:pre-wrap">{{ c.rootContext || "—" }}</div>
          </NCard>
        </div>

        <NForm>
          <NFormItem label="Add new context entry">
            <NInput v-model:value="newCtxText" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" />
          </NFormItem>
        </NForm>
      </div>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="ctxModalOpen = false">Close</NButton>
          <NButton type="primary" :loading="addingCtx" :disabled="!newCtxText.trim()" @click="addContext">
            Add context
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.companies-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.page-icon { opacity: 0.7; }

.page-title {
  font-size: 1.1rem;
  font-weight: 600;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.toolbar-loading-hint {
  font-size: 0.82rem;
  opacity: 0.65;
  margin-right: 0.25rem;
}

.bulk-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
  border-radius: 6px;
  background: rgba(99, 226, 183, 0.06);
  border: 1px solid rgba(99, 226, 183, 0.18);
}

.bulk-count {
  font-size: 0.85rem;
  opacity: 0.8;
  flex: 1;
}

.modal-hint {
  font-size: 0.82rem;
  opacity: 0.6;
  margin-top: 0.5rem;
}
</style>
