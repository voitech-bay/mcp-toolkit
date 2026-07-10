<script setup lang="ts">
import { ref, computed, watch, h } from "vue";
import { useDebounceFn } from "@vueuse/core";
import {
  NCard,
  NDataTable,
  NInput,
  NSelect,
  NButton,
  NSpace,
  NAlert,
  NEmpty,
  NModal,
  NForm,
  NFormItem,
  NTag,
  NAvatar,
  NSpin,
  NDrawer,
  NDrawerContent,
  useMessage,
} from "naive-ui";
import type { DataTableColumns, DataTableRowKey } from "naive-ui";
import { UsersIcon, FileTextIcon, BuildingIcon, Pencil, Plus, Trash2 } from "lucide-vue-next";
import { RouterLink } from "vue-router";
import { useProjectStore } from "../stores/project";
import AttachCompanyModal from "../components/AttachCompanyModal.vue";
import { useResizableTableColumns } from "../composables/useResizableTableColumns";

const CONTACT_COLUMN_WIDTHS = {
  avatar: 54,
  name: 200,
  position: 180,
  company_id: 180,
  company_name: 200,
  email: 220,
  personal_email: 220,
  context: 160,
  actions: 90,
} as const;

const { applyResizable, onColumnResize, scrollXFor } = useResizableTableColumns(
  "contacts-page",
  CONTACT_COLUMN_WIDTHS
);

const projectStore = useProjectStore();
const message = useMessage();

interface ContactRow {
  id?: string;
  uuid?: string; // Contacts table PK; API may return as uuid or id
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  avatar_url?: string | null;
  company_name?: string | null;
  work_email_domain?: string | null;
  work_email?: string | null;
  email?: string | null;
  company_uuid?: string | null;
  project_id?: string | null;
  created_at?: string | null;
}

// --- Table state ---
const data = ref<ContactRow[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref("");
const page = ref(1);
const pageSize = ref(25);
const PAGE_SIZES = [10, 25, 50, 100];
const searchInput = ref("");
const appliedSearch = ref("");
const checkedKeys = ref<DataTableRowKey[]>([]);
const roleFilter = ref("");
const emailFilter = ref("");
const listFilter = ref<string | null>(null);
const sortBy = ref("created_at");
const sortDirection = ref<"asc" | "desc">("desc");
const listOptions = ref<Array<{ label: string; value: string }>>([]);
const editorOpen = ref(false);
const editorSaving = ref(false);
const editingContactId = ref<string | null>(null);
const contactForm = ref({ first_name: "", last_name: "", position: "", work_email: "", personal_email: "", company_name: "", location: "" });

function openContactEditor(row?: ContactRow) {
  editingContactId.value = row ? contactRowId(row) : null;
  contactForm.value = {
    first_name: row?.first_name ?? "", last_name: row?.last_name ?? "",
    position: row?.position ?? "", work_email: row?.work_email ?? "",
    personal_email: row?.email ?? "", company_name: row?.company_name ?? "", location: "",
  };
  editorOpen.value = true;
}

async function saveContact() {
  const projectId = projectStore.selectedProjectId;
  if (!projectId || (!contactForm.value.first_name.trim() && !contactForm.value.last_name.trim())) {
    message.warning("A first or last name is required."); return;
  }
  editorSaving.value = true;
  try {
    const r = await fetch("/api/project-contact-records", {
      method: editingContactId.value ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, contactId: editingContactId.value, ...contactForm.value }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Save failed");
    editorOpen.value = false; message.success(editingContactId.value ? "Contact updated." : "Contact created.");
    await fetchContacts();
  } catch (e) { message.error(e instanceof Error ? e.message : "Save failed"); }
  finally { editorSaving.value = false; }
}

async function deleteContacts(ids: string[]) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId || ids.length === 0 || !window.confirm(`Remove ${ids.length} contact(s) from this project?`)) return;
  const r = await fetch("/api/project-contact-records", {
    method: "DELETE", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, contactIds: ids }),
  });
  const j = await r.json();
  if (!r.ok) { message.error(j.error ?? "Delete failed"); return; }
  checkedKeys.value = []; message.success(`Removed ${j.data?.removed ?? ids.length} contact(s).`); await fetchContacts();
}

function clearFilters() {
  searchInput.value = ""; appliedSearch.value = ""; roleFilter.value = ""; emailFilter.value = "";
  listFilter.value = null; sortBy.value = "created_at"; sortDirection.value = "desc"; page.value = 1;
}

const debouncedSearch = useDebounceFn(() => {
  appliedSearch.value = searchInput.value.trim();
  page.value = 1;
}, 300);

watch(searchInput, () => debouncedSearch());

function fullName(row: ContactRow): string {
  return [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "—";
}

// --- Context modal ---
type ContextRow = { id: string; created_at: string; rootContext: string | null; contact_id: string | null };
const ctxModalOpen = ref(false);
const ctxModalName = ref("");
const ctxModalContactId = ref<string>("");
const ctxLoading = ref(false);
const ctxRows = ref<ContextRow[]>([]);
const newCtxText = ref("");
const addingCtx = ref(false);

function contactRowId(row: ContactRow): string | null {
  const id = row.id ?? row.uuid;
  return id != null ? String(id) : null;
}

// Context count per contact id (for badge next to button)
const contactContextCounts = ref<Record<string, number>>({});

async function fetchContactContextCounts(rows: ContactRow[]) {
  const ids = [...new Set(rows.map(contactRowId).filter(Boolean))] as string[];
  if (ids.length === 0) return;
  try {
    const r = await fetch(`/api/contact-context-counts?contact_ids=${ids.map((id) => encodeURIComponent(id)).join(",")}`);
    const j = await r.json();
    if (!r.ok) return;
    const counts = (j.data as Record<string, number>) ?? {};
    contactContextCounts.value = { ...contactContextCounts.value, ...counts };
  } catch {
    // keep existing counts on error
  }
}

watch(data, (rows) => {
  if (rows.length > 0) void fetchContactContextCounts(rows);
}, { immediate: true });

async function openContextModal(row: ContactRow) {
  const contactId = (row.id ?? row.uuid) != null ? String(row.id ?? row.uuid) : "";
  if (!contactId) {
    message.warning("Contact has no id.");
    return;
  }
  ctxModalContactId.value = contactId;
  ctxModalName.value = fullName(row);
  ctxModalOpen.value = true;
  newCtxText.value = "";
  await loadContexts();
}

async function loadContexts() {
  if (!ctxModalContactId.value) {
    ctxRows.value = [];
    return;
  }
  ctxLoading.value = true;
  try {
    const r = await fetch(`/api/contact-context?contact_id=${encodeURIComponent(ctxModalContactId.value)}`);
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
  if (!ctxModalContactId.value) {
    message.warning("Contact id is missing.");
    return;
  }
  addingCtx.value = true;
  try {
    const r = await fetch("/api/contact-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact_id: ctxModalContactId.value,
        rootContext: text,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to add context");
    newCtxText.value = "";
    await loadContexts();
    if (ctxModalContactId.value) {
      contactContextCounts.value = {
        ...contactContextCounts.value,
        [ctxModalContactId.value]: ctxRows.value.length,
      };
    }
    message.success("Context added.");
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to add context");
  } finally {
    addingCtx.value = false;
  }
}

// --- Company name resolution ---
// Map company_uuid → company name; populated lazily per visible page
const companyNameCache = ref<Record<string, string>>({});

async function resolveCompanyNames(rows: ContactRow[]) {
  const ids = [...new Set(rows.map((r) => r.company_uuid).filter(Boolean) as string[])];
  const missing = ids.filter((id) => !(id in companyNameCache.value));
  if (missing.length === 0) return;
  try {
    const params = new URLSearchParams();
    params.set("ids", missing.join(","));
    const r = await fetch(`/api/companies/by-ids?${params.toString()}`);
    if (!r.ok) return;
    const j = await r.json();
    const patch: Record<string, string> = {};
    for (const c of (j.data ?? []) as Array<{ id: string; name: string | null }>) {
      if (c.id && c.name) patch[c.id] = c.name;
    }
    companyNameCache.value = { ...companyNameCache.value, ...patch };
  } catch { /* silent */ }
}

watch(data, (rows) => {
  if (rows.length > 0) void resolveCompanyNames(rows);
}, { immediate: true });

function resolvedCompanyName(row: ContactRow): string {
  if (row.company_uuid && companyNameCache.value[row.company_uuid]) return companyNameCache.value[row.company_uuid];
  return "—";
}

// --- Attach company modal ---
const attachModalOpen = ref(false);
const attachTargetRow = ref<ContactRow | null>(null);

function openAttachModal(row: ContactRow) {
  attachTargetRow.value = row;
  attachModalOpen.value = true;
}

function onCompanyAttached(payload: { contactId: string; companyId: string; companyName: string }) {
  const row = attachTargetRow.value;
  if (row) {
    row.company_uuid = payload.companyId;
    row.company_name = payload.companyName;
    companyNameCache.value = { ...companyNameCache.value, [payload.companyId]: payload.companyName };
  }
}

// --- Fetch contacts ---
async function fetchContacts() {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) {
    data.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const filterValues: Record<string, string> = { project_id: projectId };
    if (roleFilter.value.trim()) filterValues.position = roleFilter.value.trim();
    if (emailFilter.value.trim()) filterValues.work_email = emailFilter.value.trim();
    if (listFilter.value) filterValues.list_uuid = listFilter.value;
    const q = new URLSearchParams({
      table: "contacts",
      filters: encodeURIComponent(JSON.stringify(filterValues)),
      limit: String(pageSize.value),
      offset: String((page.value - 1) * pageSize.value),
    });
    if (appliedSearch.value) q.set("search", appliedSearch.value);
    q.set("sortBy", sortBy.value);
    q.set("sortDirection", sortDirection.value);
    const r = await fetch(`/api/supabase-table-query?${q.toString()}`);
    const j = await r.json();
    if (!r.ok) {
      error.value = j.error ?? "Request failed";
      data.value = [];
      total.value = 0;
      return;
    }
    data.value = j.data ?? [];
    total.value = j.total ?? 0;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Request failed";
    data.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

watch(
  () => [projectStore.selectedProjectId, page.value, pageSize.value, appliedSearch.value, roleFilter.value, emailFilter.value, listFilter.value, sortBy.value, sortDirection.value],
  () => {
    checkedKeys.value = [];
    fetchContacts();
  },
  { immediate: true }
);

watch(() => projectStore.selectedProjectId, async (projectId) => {
  listOptions.value = [];
  if (!projectId) return;
  const r = await fetch(`/api/contact-lists?projectId=${encodeURIComponent(projectId)}`);
  const j = await r.json();
  listOptions.value = (j.data ?? []).map((row: { uuid: string; name: string }) => ({ label: row.name, value: row.uuid }));
}, { immediate: true });

function onUpdatePage(p: number) {
  page.value = p;
}
function onUpdatePageSize(s: number) {
  pageSize.value = s;
  page.value = 1;
}

const pagination = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  itemCount: total.value,
  pageSizes: PAGE_SIZES,
  showSizePicker: true,
  onUpdatePage,
  onUpdatePageSize,
}));

const baseColumns = computed((): DataTableColumns<ContactRow> => [
  { type: "selection" },
  {
    key: "avatar",
    title: "",
    width: 54,
    render: (row) =>
      h(NAvatar, {
        size: 28,
        round: true,
        src: (row.avatar_url as string) || undefined,
      }),
  },
  {
    key: "name",
    title: "Name",
    sorter: true,
    width: 200,
    ellipsis: { tooltip: true },
    render: (row) => {
      const uuid = row.uuid ?? row.id;
      if (!uuid) return fullName(row);
      return h(
        RouterLink,
        { to: `/contact/${uuid}`, style: "color: #2080f0; text-decoration: none" },
        { default: () => fullName(row) }
      );
    },
  },
  {
    key: "position",
    title: "Role",
    sorter: true,
    width: 180,
    ellipsis: { tooltip: true },
    render: (row) => row.position ?? "—",
  },
  {
    key: "company_id",
    title: "Company(from sync)",
    width: 180,
    ellipsis: { tooltip: true },
    render: (row) => {
      if (row.company_name) {
        return h(NTag, { title: row.company_name, type: "error", bordered: false, size: "small" }, row.company_name);
      }
      return h(NButton, {
        size: "tiny",
        type: "warning",
        quaternary: true,
        onClick: () => openAttachModal(row),
      });
    }
  },
  {
    key: "company_name",
    title: "Company(from DB)",
    width: 200,
    render: (row) => {
      // Show resolved name if company_uuid is set (even while cache is loading)
      if (row.company_uuid) {
        const name = resolvedCompanyName(row);
        return h(NTag, { title: name, type: "success", bordered: false, size: "small" }, name);
      }
      return h(
        NButton,
        {
          size: "tiny",
          type: "warning",
          quaternary: true,
          onClick: () => openAttachModal(row),
          style: "padding:0 6px",
        },
        {
          default: () => [
            h(BuildingIcon, { size: 12, style: "margin-right:4px" }),
            "Attach company",
          ],
        }
      );
    },
  },
  {
    key: "email",
    title: "Work email",
    width: 220,
    ellipsis: { tooltip: true },
    render: (row) => row.work_email ?? "—",
  },
  {
    key: "personal_email",
    title: "Personal email",
    width: 220,
    ellipsis: { tooltip: true },
    render: (row) => row.email ?? "—",
  },
  {
    key: "context",
    title: "Context",
    width: 160,
    render: (row: ContactRow) => {
      const id = contactRowId(row);
      const count = id ? (contactContextCounts.value[id] ?? null) : null;
      return h(
        NSpace,
        { align: "center", size: 6, wrap: false },
        [
          h(
            NTag,
            { style: "cursor:pointer", onClick: () => openContextModal(row), size: "small", bordered: false, type: count && count > 0 ? "info" : "warning" },
            { default: () => count ? `${count} context` : "Click to add context" }
          )
          
        ].filter(Boolean)
      );
    },
  },
  {
    key: "actions",
    title: "",
    width: 90,
    fixed: "right",
    render: (row) => h(NSpace, { size: 2 }, () => [
      h(NButton, { quaternary: true, size: "tiny", onClick: () => openContactEditor(row) }, () => h(Pencil, { size: 13 })),
      h(NButton, { quaternary: true, size: "tiny", type: "error", onClick: () => { const id = contactRowId(row); if (id) void deleteContacts([id]); } }, () => h(Trash2, { size: 13 })),
    ]),
  },
]);

const columns = computed((): DataTableColumns<ContactRow> =>
  applyResizable(baseColumns.value, CONTACT_COLUMN_WIDTHS)
);

const tableScrollX = computed(() =>
  Math.max(1200, scrollXFor(columns.value as Array<{ key?: string | number; width?: number; type?: string }>, CONTACT_COLUMN_WIDTHS))
);
</script>

<template>
  <NCard>
    <template #header>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <UsersIcon :size="16" />
          <span>Contacts</span>
          <span v-if="loading" style="opacity:0.6;font-size:0.82rem">Loading…</span>
        </div>
        <NSpace>
          <NButton size="small" type="primary" @click="openContactEditor()"><template #icon><Plus :size="13" /></template>New</NButton>
          <NInput v-model:value="searchInput" placeholder="Search name or role…" clearable size="small" style="width: 220px" />
        </NSpace>
      </div>
      <div class="filters">
        <NInput v-model:value="roleFilter" placeholder="Exact role…" clearable size="small" />
        <NInput v-model:value="emailFilter" placeholder="Exact work email…" clearable size="small" />
        <NSelect v-model:value="listFilter" :options="listOptions" placeholder="Contact list…" clearable filterable size="small" />
        <NButton size="small" @click="clearFilters">Clear filters</NButton>
        <NButton v-if="checkedKeys.length" size="small" type="error" @click="deleteContacts(checkedKeys.map(String))">
          Delete {{ checkedKeys.length }}
        </NButton>
      </div>
    </template>

    <template v-if="error">
      <NAlert type="error" :show-icon="false">{{ error }}</NAlert>
    </template>
    <template v-else-if="!projectStore.selectedProjectId">
      <NEmpty description="Select a project to view contacts." />
    </template>
    <template v-else>
      <NDataTable
        :columns="columns"
        :data="data"
        :scroll-x="tableScrollX"
        :row-key="(r: ContactRow) => (r.id ?? `${r.company_uuid ?? ''}/${r.first_name ?? ''}/${r.last_name ?? ''}/${r.position ?? ''}`)"
        v-model:checked-row-keys="checkedKeys"
        remote
        :pagination="pagination"
        @unstable-column-resize="onColumnResize"
        @update:sorter="(sorter: any) => { sortBy = sorter?.columnKey === 'name' ? 'first_name' : (sorter?.columnKey ?? 'created_at'); sortDirection = sorter?.order === 'ascend' ? 'asc' : 'desc'; page = 1; }"
      />
    </template>
  </NCard>

  <NDrawer v-model:show="editorOpen" :width="440" placement="right">
    <NDrawerContent :title="editingContactId ? 'Edit contact' : 'New contact'" closable>
      <NForm>
        <NFormItem label="First name"><NInput v-model:value="contactForm.first_name" /></NFormItem>
        <NFormItem label="Last name"><NInput v-model:value="contactForm.last_name" /></NFormItem>
        <NFormItem label="Role"><NInput v-model:value="contactForm.position" /></NFormItem>
        <NFormItem label="Work email"><NInput v-model:value="contactForm.work_email" /></NFormItem>
        <NFormItem label="Personal email"><NInput v-model:value="contactForm.personal_email" /></NFormItem>
        <NFormItem label="Company"><NInput v-model:value="contactForm.company_name" /></NFormItem>
        <NFormItem label="Location"><NInput v-model:value="contactForm.location" /></NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end"><NButton @click="editorOpen = false">Cancel</NButton><NButton type="primary" :loading="editorSaving" @click="saveContact">Save</NButton></NSpace>
      </template>
    </NDrawerContent>
  </NDrawer>

  <NModal v-model:show="ctxModalOpen" preset="card" style="width: 720px">
    <template #header>
      <div style="display:flex;align-items:center;gap:8px">
        <FileTextIcon :size="16" />
        <span>Contact contexts</span>
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

  <AttachCompanyModal
    v-model:show="attachModalOpen"
    :contact-id="attachTargetRow ? contactRowId(attachTargetRow) : null"
    :contact-name="attachTargetRow ? ([attachTargetRow.first_name, attachTargetRow.last_name].filter(Boolean).join(' ') || 'Contact') : null"
    :initial-search="attachTargetRow?.company_name ?? ''"
    @attached="onCompanyAttached"
  />
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: repeat(3, minmax(150px, 1fr)) auto auto;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
</style>
