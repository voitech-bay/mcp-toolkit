<script setup lang="ts">
import { ref, computed, watch, h } from "vue";
import {
  NCard,
  NDataTable,
  NButton,
  NSpace,
  NAlert,
  NEmpty,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NTag,
  NPopover,
  NSpin,
  useMessage,
} from "naive-ui";
import type { DataTableColumns, DataTableRowKey } from "naive-ui";
import { LightbulbIcon, PlusIcon, Pencil, Trash2 } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";

const projectStore = useProjectStore();
const message = useMessage();

// --- Types ---
interface HypothesisRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  target_persona: string | null;
  created_at: string;
  target_count: number;
}

interface TargetRow {
  id: string;
  project_company_id: string;
  score: number | null;
  company_id: string | null;
  name: string | null;
  domain: string | null;
  linkedin_url: string | null;
  status: string | null;
}

// --- Hypotheses list state ---
const hypotheses = ref<HypothesisRow[]>([]);
const loading = ref(false);
const error = ref("");

async function fetchHypotheses() {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) {
    hypotheses.value = [];
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch(`/api/hypotheses?projectId=${projectId}`);
    const json = await r.json();
    if (!r.ok) {
      error.value = json.error ?? "Request failed";
      return;
    }
    hypotheses.value = json.data ?? [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Request failed";
  } finally {
    loading.value = false;
  }
}

// --- Expandable row targets ---
const expandedKeys = ref<DataTableRowKey[]>([]);
const targetsByHypothesis = ref<Record<string, TargetRow[]>>({});
const targetsLoading = ref<Record<string, boolean>>({});
const targetsError = ref<Record<string, string>>({});

watch(() => projectStore.selectedProjectId, () => {
  hypotheses.value = [];
  expandedKeys.value = [];
  targetsByHypothesis.value = {};
  fetchHypotheses();
}, { immediate: true });

async function loadTargets(hypothesisId: string) {
  if (targetsByHypothesis.value[hypothesisId] !== undefined) return;
  targetsLoading.value = { ...targetsLoading.value, [hypothesisId]: true };
  targetsError.value = { ...targetsError.value, [hypothesisId]: "" };
  try {
    const r = await fetch(`/api/hypotheses/${hypothesisId}/targets`);
    const json = await r.json();
    if (!r.ok) {
      targetsError.value = { ...targetsError.value, [hypothesisId]: json.error ?? "Failed" };
      return;
    }
    targetsByHypothesis.value = { ...targetsByHypothesis.value, [hypothesisId]: json.data ?? [] };
  } catch (e) {
    targetsError.value = { ...targetsError.value, [hypothesisId]: e instanceof Error ? e.message : "Failed" };
  } finally {
    targetsLoading.value = { ...targetsLoading.value, [hypothesisId]: false };
  }
}

function onExpandedRowsChange(keys: DataTableRowKey[]) {
  expandedKeys.value = keys;
  for (const key of keys) {
    loadTargets(String(key));
  }
}

// --- Columns ---
const columns = computed<DataTableColumns<HypothesisRow>>(() => [
  {
    key: "name",
    title: "Name",
    ellipsis: { tooltip: true },
  },
  {
    key: "description",
    title: "Description",
    ellipsis: { tooltip: true },
    render: (row) => row.description ?? "—",
  },
  {
    key: "target_persona",
    title: "Target persona",
    ellipsis: { tooltip: true },
    render: (row) => row.target_persona ?? "—",
  },
  {
    key: "target_count",
    title: "Companies",
    width: 110,
    render: (row) => {
      if (row.target_count === 0) {
        return h(NTag, { size: "small", type: "default", bordered: false }, { default: () => "0" });
      }
      const targets = targetsByHypothesis.value[row.id];
      const isLoading = targetsLoading.value[row.id];
      const preview = targets ? targets.slice(0, 10) : [];

      return h(
        NPopover,
        {
          trigger: "hover",
          placement: "top-start",
          onUpdateShow: (show: boolean) => { if (show) loadTargets(row.id); },
        },
        {
          trigger: () =>
            h(NTag, { size: "small", type: "success", bordered: false, style: "cursor:default" }, {
              default: () => String(row.target_count),
            }),
          default: () =>
            isLoading || !targets
              ? h("div", { style: "display:flex;align-items:center;gap:6px;padding:2px 0;font-size:0.82rem;opacity:.7" }, [
                  h(NSpin, { size: "small" }),
                  " Loading…",
                ])
              : h("div", { style: "min-width:200px;max-width:320px" },
                  preview.map((t, i) =>
                    h("div", { key: i, style: "padding:3px 0;font-size:0.82rem;display:flex;align-items:baseline;gap:6px" }, [
                      h("span", { style: "font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" },
                        t.name ?? t.domain ?? "—"
                      ),
                      t.domain && t.name
                        ? h("span", { style: "opacity:.45;font-size:0.75rem;flex-shrink:0" }, t.domain)
                        : null,
                      t.score != null
                        ? h(NTag, { size: "tiny", type: "info", bordered: false, style: "flex-shrink:0" }, { default: () => String(t.score) })
                        : null,
                    ])
                  )
                ),
        }
      );
    },
  },
  {
    key: "created_at",
    title: "Created",
    width: 140,
    render: (row) => new Date(row.created_at).toLocaleDateString(),
  },
  {
    key: "actions",
    title: "",
    width: 120,
    render: (row) =>
      h(NSpace, { size: 4 }, [
        h(NPopover, { trigger: "hover", placement: "top" }, {
          default: () => "Edit",
          trigger: () => h(NButton, {
            size: "small",
            quaternary: true,
            onClick: () => openEditModal(row),
          }, { default: () => h(Pencil, { size: 14 }) }),
        }),
        h(NPopover, { trigger: "hover", placement: "top" }, {
          default: () => "Delete",
          trigger: () => h(NButton, {
            size: "small",
            quaternary: true,
            type: "error",
            onClick: () => confirmDelete(row),
          }, { default: () => h(Trash2, { size: 14 }) }),
        }),
      ]),
  },
]);

// --- Create / Edit modal ---
const formModalOpen = ref(false);
const editingId = ref<string | null>(null);
const formName = ref("");
const formDescription = ref("");
const formPersona = ref("");
const formSubmitting = ref(false);

function openCreateModal() {
  editingId.value = null;
  formName.value = "";
  formDescription.value = "";
  formPersona.value = "";
  formModalOpen.value = true;
}

function openEditModal(row: HypothesisRow) {
  editingId.value = row.id;
  formName.value = row.name;
  formDescription.value = row.description ?? "";
  formPersona.value = row.target_persona ?? "";
  formModalOpen.value = true;
}

async function submitForm() {
  if (!formName.value.trim()) {
    message.warning("Name is required.");
    return;
  }
  formSubmitting.value = true;
  try {
    if (editingId.value) {
      const r = await fetch(`/api/hypotheses/${editingId.value}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.value.trim(),
          description: formDescription.value.trim() || null,
          targetPersona: formPersona.value.trim() || null,
        }),
      });
      const json = await r.json();
      if (!r.ok) { message.error(json.error ?? "Failed to update."); return; }
      message.success("Hypothesis updated.");
    } else {
      const projectId = projectStore.selectedProjectId;
      if (!projectId) { message.error("No project selected."); return; }
      const r = await fetch("/api/hypotheses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: formName.value.trim(),
          description: formDescription.value.trim() || null,
          targetPersona: formPersona.value.trim() || null,
        }),
      });
      const json = await r.json();
      if (!r.ok) { message.error(json.error ?? "Failed to create."); return; }
      message.success("Hypothesis created.");
    }
    formModalOpen.value = false;
    // Invalidate cached targets for edited row
    if (editingId.value) {
      const { [editingId.value]: _, ...rest } = targetsByHypothesis.value;
      targetsByHypothesis.value = rest;
    }
    fetchHypotheses();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Request failed");
  } finally {
    formSubmitting.value = false;
  }
}

// --- Delete ---
const deleteModalOpen = ref(false);
const deletingRow = ref<HypothesisRow | null>(null);
const deleteSubmitting = ref(false);

function confirmDelete(row: HypothesisRow) {
  deletingRow.value = row;
  deleteModalOpen.value = true;
}

async function submitDelete() {
  if (!deletingRow.value) return;
  deleteSubmitting.value = true;
  try {
    const r = await fetch(`/api/hypotheses/${deletingRow.value.id}`, { method: "DELETE" });
    const json = await r.json();
    if (!r.ok) { message.error(json.error ?? "Failed to delete."); return; }
    message.success("Hypothesis deleted.");
    deleteModalOpen.value = false;
    const id = deletingRow.value.id;
    const { [id]: _, ...rest } = targetsByHypothesis.value;
    targetsByHypothesis.value = rest;
    expandedKeys.value = expandedKeys.value.filter((k: DataTableRowKey) => String(k) !== id);
    fetchHypotheses();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Request failed");
  } finally {
    deleteSubmitting.value = false;
  }
}

// --- Target sub-table columns ---
const targetColumns: DataTableColumns<TargetRow> = [
  {
    key: "name",
    title: "Company",
    ellipsis: { tooltip: true },
    render: (row) => row.name ?? row.domain ?? "—",
  },
  {
    key: "domain",
    title: "Domain",
    ellipsis: { tooltip: true },
    render: (row) => row.domain ?? "—",
  },
  {
    key: "score",
    title: "Score",
    width: 80,
    render: (row) => row.score != null ? String(row.score) : "—",
  },
  {
    key: "status",
    title: "Status",
    width: 110,
    render: (row) => row.status ?? "—",
  },
];

function renderExpand(row: HypothesisRow) {
  const targets = targetsByHypothesis.value[row.id];
  const isLoading = targetsLoading.value[row.id];
  const err = targetsError.value[row.id];

  if (isLoading) {
    return h("div", { class: "expand-loading" }, [h(NSpin, { size: "small" })]);
  }
  if (err) {
    return h(NAlert, { type: "error", style: "margin: 8px 0" }, { default: () => err });
  }
  if (!targets || targets.length === 0) {
    return h(NEmpty, { description: "No companies in this hypothesis yet", size: "small" });
  }
  return h(NDataTable, {
    columns: targetColumns,
    data: targets,
    size: "small",
    bordered: false,
    striped: true,
    style: "margin: 4px 0",
  });
}
</script>

<template>
  <div class="hypotheses-page">
    <NCard>
      <div class="toolbar">
        <div class="toolbar-left">
          <LightbulbIcon :size="18" class="page-icon" />
          <span class="page-title">Hypotheses</span>
          <NTag v-if="hypotheses.length > 0" size="small" :bordered="false">
            {{ hypotheses.length }}
          </NTag>
        </div>
        <NButton type="primary" size="small" @click="openCreateModal">
          <template #icon><PlusIcon :size="14" /></template>
          New hypothesis
        </NButton>
      </div>

      <NAlert v-if="error" type="error" style="margin-bottom: 0.75rem">{{ error }}</NAlert>

      <NDataTable
        v-if="hypotheses.length > 0 || loading"
        :columns="columns"
        :data="hypotheses"
        :loading="loading"
        :bordered="false"
        size="small"
        :max-height="600"
        :scroll-x="800"
        :row-key="(row: HypothesisRow) => row.id"
        :expanded-row-keys="expandedKeys"
        :render-expand="renderExpand"
        @update:expanded-row-keys="onExpandedRowsChange"
      />
      <NEmpty v-else-if="!loading" description="No hypotheses yet — create one above" />
    </NCard>

    <!-- Create / Edit modal -->
    <NModal
      v-model:show="formModalOpen"
      preset="card"
      :title="editingId ? 'Edit hypothesis' : 'New hypothesis'"
      style="max-width: 500px"
      :mask-closable="!formSubmitting"
    >
      <NForm label-placement="left" label-width="130px">
        <NFormItem label="Name" required>
          <NInput
            v-model:value="formName"
            placeholder="e.g. ICP Partner outreach"
            :disabled="formSubmitting"
          />
        </NFormItem>
        <NFormItem label="Description">
          <NInput
            v-model:value="formDescription"
            type="textarea"
            :rows="3"
            placeholder="Optional description…"
            :disabled="formSubmitting"
          />
        </NFormItem>
        <NFormItem label="Target persona">
          <NInput
            v-model:value="formPersona"
            placeholder="e.g. CTO at MSSP"
            :disabled="formSubmitting"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="formModalOpen = false" :disabled="formSubmitting">Cancel</NButton>
          <NButton type="primary" :loading="formSubmitting" @click="submitForm">
            {{ editingId ? "Save" : "Create" }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <!-- Delete confirmation modal -->
    <NModal
      v-model:show="deleteModalOpen"
      preset="dialog"
      type="error"
      title="Delete hypothesis"
      :positive-text="deleteSubmitting ? 'Deleting…' : 'Delete'"
      negative-text="Cancel"
      :positive-button-props="{ loading: deleteSubmitting, type: 'error' }"
      :mask-closable="!deleteSubmitting"
      @positive-click="submitDelete"
    >
      <template #default>
        Delete <strong>{{ deletingRow?.name }}</strong>?
        This will also remove all its company targets. This action cannot be undone.
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.hypotheses-page {
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

.page-icon {
  opacity: 0.7;
}

.page-title {
  font-size: 1.1rem;
  font-weight: 600;
}

.expand-loading {
  display: flex;
  justify-content: center;
  padding: 1rem;
}
</style>
