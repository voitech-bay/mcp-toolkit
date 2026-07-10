<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, h, watch } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import {
  NCard,
  NSpace,
  NSelect,
  NButton,
  NDataTable,
  NTag,
  NAlert,
  NText,
  NEmpty,
  NTabs,
  NTabPane,
  NInput,
  useMessage,
} from "naive-ui";
import type { DataTableColumns, SelectOption } from "naive-ui";
import { RocketIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";
import { useWorkflowLaunch } from "../composables/useWorkflowLaunch";
import { isFeasibleProjectId, isVelvetechProjectId } from "../project-ids";

type TargetMode = "list" | "contacts" | "company";

interface ContactRow {
  uuid: string;
  name: string;
  position: string;
  company_name: string;
  company_id: string | null;
  linkedin_url: string | null;
  synced: boolean;
}

interface LaunchRun {
  id: string;
  workflow_key: string;
  source_list_uuid: string | null;
  source_list_name: string | null;
  requested_count: number;
  contacts_count: number;
  companies_count: number;
  succeeded_count: number;
  failed_count: number;
  status: string;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
}

interface CompanyOption {
  company_id: string;
  name: string;
  domain: string | null;
}

const TARGET_MODE_KEY = "n8n-launch-target-mode";

const route = useRoute();
const router = useRouter();
const message = useMessage();
const projectStore = useProjectStore();
const { launching, workflows, loadWorkflows, launch: launchWorkflow } = useWorkflowLaunch();

const projectId = computed(() => projectStore.selectedProjectId);
const isVelvetech = computed(() => isVelvetechProjectId(projectId.value));
const isFeasible = computed(() => isFeasibleProjectId(projectId.value));
const showTargetTabs = computed(() => isVelvetech.value);

const selectedWorkflow = ref<string | null>(null);
const targetMode = ref<TargetMode>("list");

const lists = ref<{ uuid: string; name: string }[]>([]);
const selectedList = ref<string | null>(null);

const contacts = ref<ContactRow[]>([]);
const contactsLoading = ref(false);
const contactsError = ref("");
const checkedContactKeys = ref<string[]>([]);

const contactSearch = ref("");
const contactPickerPage = ref(1);
const contactPickerPageSize = ref(50);
const contactPickerTotal = ref(0);

const companySearch = ref("");
const companyOptions = ref<CompanyOption[]>([]);
const selectedCompanyId = ref<string | null>(null);
const companyLoading = ref(false);
const companyCardLoading = ref(false);
const selectedCompanyName = ref("");

const currentRun = ref<LaunchRun | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const history = ref<LaunchRun[]>([]);
const historyLoading = ref(false);

const workflowOptions = computed<SelectOption[]>(() =>
  workflows.value.map((w) => ({
    label: w.configured ? w.label : `${w.label} (webhook not configured)`,
    value: w.key,
    disabled: !w.configured,
  }))
);

const listOptions = computed<SelectOption[]>(() =>
  lists.value.map((l) => ({ label: l.name, value: l.uuid }))
);

const companySelectOptions = computed<SelectOption[]>(() =>
  companyOptions.value.map((c) => ({
    label: c.domain ? `${c.name} (${c.domain})` : c.name,
    value: c.company_id,
  }))
);

const selectedWorkflowOption = computed(() =>
  workflows.value.find((w) => w.key === selectedWorkflow.value) ?? null
);

const requiresList = computed(() => selectedWorkflowOption.value?.adapter === "feasible_list");

const selectedContacts = computed(() => {
  if (checkedContactKeys.value.length) {
    return contacts.value.filter((c) => checkedContactKeys.value.includes(c.uuid));
  }
  return contacts.value;
});

const unsyncedSelectedCount = computed(
  () => selectedContacts.value.filter((c) => !c.synced).length
);

const selectedCount = computed(() => selectedContacts.value.length);

const launchButtonText = computed(() => {
  const adapter = selectedWorkflowOption.value?.adapter;
  if (adapter === "velvetech_reply") return `Draft replies for ${selectedCount.value}`;
  if (adapter === "velvetech_research") return `Launch research for ${selectedCount.value}`;
  return `Launch workflow for ${selectedCount.value}`;
});

const canLaunch = computed(() => {
  if (!selectedWorkflow.value || contactsLoading.value || selectedCount.value === 0) return false;
  if (requiresList.value && !selectedList.value) return false;
  if (unsyncedSelectedCount.value > 0) return false;
  return true;
});

function statusType(status: string): "default" | "info" | "success" | "warning" | "error" {
  switch (status) {
    case "success":
      return "success";
    case "partial":
      return "warning";
    case "failed":
      return "error";
    case "running":
      return "info";
    default:
      return "default";
  }
}

function workflowLabel(key: string): string {
  return workflows.value.find((w) => w.key === key)?.label ?? key;
}

function persistTargetMode(mode: TargetMode): void {
  try {
    localStorage.setItem(TARGET_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function restoreTargetMode(): TargetMode {
  try {
    const v = localStorage.getItem(TARGET_MODE_KEY);
    if (v === "contacts" || v === "company" || v === "list") return v;
  } catch {
    /* ignore */
  }
  return "list";
}

function mapContactRow(row: Record<string, unknown>, synced = true): ContactRow {
  const first = typeof row.first_name === "string" ? row.first_name : "";
  const last = typeof row.last_name === "string" ? row.last_name : "";
  const nameJoined = `${first} ${last}`.trim();
  return {
    uuid: typeof row.uuid === "string" ? row.uuid : "",
    name: nameJoined || (typeof row.name === "string" ? row.name : "") || "(no name)",
    position: typeof row.position === "string" ? row.position : "",
    company_name: typeof row.company_name === "string" ? row.company_name : "",
    company_id: typeof row.company_uuid === "string" ? row.company_uuid : null,
    linkedin_url: typeof row.linkedin_url === "string" ? row.linkedin_url : null,
    synced,
  };
}

async function markSyncedFlags(rows: ContactRow[]): Promise<ContactRow[]> {
  if (!projectId.value || rows.length === 0) return rows;
  const uuids = rows.map((r) => r.uuid).filter(Boolean);
  const syncedSet = new Set<string>();
  try {
    for (let i = 0; i < uuids.length; i += 100) {
      const batch = uuids.slice(i, i + 100);
      const q = new URLSearchParams({
        table: "contacts",
        filters: encodeURIComponent(JSON.stringify({ project_id: projectId.value, uuid: batch })),
        limit: "100",
        offset: "0",
      });
      const r = await fetch(`/api/supabase-table-query?${q}`);
      const j = (await r.json()) as { data?: Record<string, unknown>[] };
      for (const row of j.data ?? []) syncedSet.add(String(row.uuid ?? ""));
    }
    return rows.map((row) => ({ ...row, synced: syncedSet.has(row.uuid) }));
  } catch {
    return rows.map((row) => ({ ...row, synced: true }));
  }
}

async function loadLists(): Promise<void> {
  if (!projectId.value) return;
  try {
    const r = await fetch(`/api/contact-lists?projectId=${encodeURIComponent(projectId.value)}`);
    const data = (await r.json()) as { data?: { uuid: string; name: string }[]; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed to load lists");
    lists.value = data.data ?? [];
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to load lists");
  }
}

async function loadListContacts(): Promise<void> {
  contacts.value = [];
  checkedContactKeys.value = [];
  contactsError.value = "";
  if (!projectId.value || !selectedList.value) return;
  contactsLoading.value = true;
  try {
    const params = new URLSearchParams({
      projectId: projectId.value,
      listUuid: selectedList.value,
    });
    const r = await fetch(`/api/contacts/gs-by-list?${params.toString()}`);
    const data = (await r.json()) as { data?: Record<string, unknown>[]; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed to load contacts");
    const rows = (data.data ?? []).map((row) => mapContactRow(row, false)).filter((c) => c.uuid);
    contacts.value = await markSyncedFlags(rows);
  } catch (e) {
    contactsError.value = e instanceof Error ? e.message : "Failed to load contacts";
  } finally {
    contactsLoading.value = false;
  }
}

async function loadPickerContacts(): Promise<void> {
  contacts.value = [];
  checkedContactKeys.value = [];
  contactsError.value = "";
  if (!projectId.value || targetMode.value !== "contacts") return;
  contactsLoading.value = true;
  try {
    const q = new URLSearchParams({
      table: "contacts",
      filters: encodeURIComponent(JSON.stringify({ project_id: projectId.value })),
      limit: String(contactPickerPageSize.value),
      offset: String((contactPickerPage.value - 1) * contactPickerPageSize.value),
      sortBy: "first_name",
      sortDirection: "asc",
    });
    if (contactSearch.value.trim()) q.set("search", contactSearch.value.trim());
    const r = await fetch(`/api/supabase-table-query?${q}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to load contacts");
    contactPickerTotal.value = j.total ?? 0;
    contacts.value = (j.data ?? [])
      .map((row: Record<string, unknown>) => mapContactRow(row, true))
      .filter((c: ContactRow) => c.uuid);
  } catch (e) {
    contactsError.value = e instanceof Error ? e.message : "Failed to load contacts";
  } finally {
    contactsLoading.value = false;
  }
}

async function searchCompanies(): Promise<void> {
  if (!projectId.value) return;
  companyLoading.value = true;
  try {
    const q = new URLSearchParams({
      projectId: projectId.value,
      limit: "25",
      offset: "0",
      sortBy: "name",
      sortDirection: "asc",
    });
    if (companySearch.value.trim()) q.set("search", companySearch.value.trim());
    const r = await fetch(`/api/project-companies?${q}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to search companies");
    companyOptions.value = (j.data ?? []).map((row: Record<string, unknown>) => ({
      company_id: String(row.company_id ?? row.id ?? ""),
      name: String(row.name ?? "Unknown"),
      domain: typeof row.domain === "string" ? row.domain : null,
    })).filter((c: CompanyOption) => c.company_id);
  } catch (e) {
    companyOptions.value = [];
    message.error(e instanceof Error ? e.message : "Company search failed");
  } finally {
    companyLoading.value = false;
  }
}

async function loadCompanyRoster(companyId: string): Promise<void> {
  contacts.value = [];
  checkedContactKeys.value = [];
  contactsError.value = "";
  if (!companyId) return;
  companyCardLoading.value = true;
  try {
    const r = await fetch(`/api/cards/company?id=${encodeURIComponent(companyId)}`);
    const data = (await r.json()) as { contacts?: Record<string, unknown>[]; company?: { name?: string }; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed to load company");
    selectedCompanyName.value = String(data.company?.name ?? selectedCompanyName.value);
    const rows = (data.contacts ?? [])
      .map((row) =>
        mapContactRow(
          {
            uuid: row.uuid,
            first_name: row.first_name,
            last_name: row.last_name,
            name: row.name,
            position: row.position,
            company_name: selectedCompanyName.value,
            company_uuid: companyId,
            linkedin_url: row.linkedin,
          },
          true
        )
      )
      .filter((c) => c.uuid);
    contacts.value = rows;
  } catch (e) {
    contactsError.value = e instanceof Error ? e.message : "Failed to load company roster";
  } finally {
    companyCardLoading.value = false;
  }
}

async function reloadContactsForMode(): Promise<void> {
  if (targetMode.value === "list") await loadListContacts();
  else if (targetMode.value === "contacts") await loadPickerContacts();
  else if (targetMode.value === "company" && selectedCompanyId.value) await loadCompanyRoster(selectedCompanyId.value);
}

async function launch(): Promise<void> {
  if (!projectId.value || !selectedWorkflow.value) return;
  if (requiresList.value && !selectedList.value) {
    message.warning("Select a GetSales list");
    return;
  }
  const leadUuids = selectedContacts.value.map((c) => c.uuid).filter(Boolean);
  if (leadUuids.length === 0) {
    message.warning("Select at least one contact");
    return;
  }
  if (unsyncedSelectedCount.value > 0) {
    message.warning(`${unsyncedSelectedCount.value} selected contact(s) are not synced in Contacts`);
    return;
  }

  const adapter = selectedWorkflowOption.value?.adapter;
  const successMessage =
    adapter === "velvetech_reply"
      ? `Draft reply started for ${leadUuids.length} contact${leadUuids.length === 1 ? "" : "s"}. Review in Email Studio → LinkedIn.`
      : undefined;

  const launchId = await launchWorkflow(selectedWorkflow.value, leadUuids, {
    sourceListUuid: targetMode.value === "list" ? selectedList.value : null,
    successMessage,
  });
  if (launchId) {
    checkedContactKeys.value = [];
    startPolling(launchId);
    void loadHistory();
  }
}

async function pollStatus(launchId: string): Promise<void> {
  try {
    const r = await fetch(`/api/n8n/launch/${encodeURIComponent(launchId)}/status`);
    const data = (await r.json()) as { run?: LaunchRun; error?: string };
    if (r.ok && data.run) {
      currentRun.value = data.run;
      if (data.run.status !== "running") {
        stopPolling();
        void loadHistory();
      }
    }
  } catch {
    /* keep polling */
  }
}

function startPolling(launchId: string): void {
  stopPolling();
  void pollStatus(launchId);
  pollTimer = setInterval(() => void pollStatus(launchId), 5000);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function loadHistory(): Promise<void> {
  if (!projectId.value) return;
  historyLoading.value = true;
  try {
    const r = await fetch(`/api/n8n/launch/history?projectId=${encodeURIComponent(projectId.value)}`);
    const data = (await r.json()) as { runs?: LaunchRun[]; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed to load history");
    history.value = data.runs ?? [];
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to load history");
  } finally {
    historyLoading.value = false;
  }
}

function viewLaunchResults(launchId: string): void {
  const filters = encodeURIComponent(
    JSON.stringify([{ field: "launch_id", op: "eq", value: launchId }])
  );
  router.push({ path: "/n8n/workflow-results", query: { filters } });
}

const contactColumns = computed<DataTableColumns<ContactRow>>(() => [
  { type: "selection", width: 42 },
  {
    title: "Name",
    key: "name",
    minWidth: 160,
    ellipsis: { tooltip: true },
    render(row) {
      return h(RouterLink, { to: `/contact/${row.uuid}`, class: "launch-link" }, { default: () => row.name });
    },
  },
  { title: "Position", key: "position", minWidth: 180, ellipsis: { tooltip: true } },
  {
    title: "Company",
    key: "company_name",
    minWidth: 160,
    ellipsis: { tooltip: true },
    render(row) {
      if (row.company_id) {
        return h(
          RouterLink,
          { to: `/company/${row.company_id}`, class: "launch-link" },
          { default: () => row.company_name || row.company_id }
        );
      }
      return row.company_name || "—";
    },
  },
  {
    title: "Synced",
    key: "synced",
    width: 88,
    render: (row) =>
      h(NTag, { size: "small", type: row.synced ? "success" : "warning" }, { default: () => (row.synced ? "Yes" : "No") }),
  },
  {
    title: "LinkedIn",
    key: "linkedin_url",
    minWidth: 120,
    render(row) {
      if (!row.linkedin_url) return "—";
      return h("a", { href: row.linkedin_url, target: "_blank", rel: "noopener" }, "profile");
    },
  },
]);

const historyColumns = computed<DataTableColumns<LaunchRun>>(() => [
  {
    title: "When",
    key: "created_at",
    width: 168,
    render: (r) => new Date(r.created_at).toLocaleString(),
  },
  { title: "Workflow", key: "workflow_key", minWidth: 200, render: (r) => workflowLabel(r.workflow_key) },
  {
    title: "GetSales list",
    key: "source_list_name",
    minWidth: 180,
    ellipsis: { tooltip: true },
    render: (r) =>
      r.source_list_name
        ? h("span", { title: r.source_list_uuid ?? "" }, r.source_list_name)
        : r.source_list_uuid
          ? `${r.source_list_uuid.slice(0, 8)}…`
          : "—",
  },
  { title: "Requested", key: "requested_count", width: 96 },
  { title: "Contacts", key: "contacts_count", width: 90 },
  { title: "Companies", key: "companies_count", width: 96 },
  { title: "OK", key: "succeeded_count", width: 70 },
  { title: "Failed", key: "failed_count", width: 80 },
  {
    title: "Status",
    key: "status",
    width: 100,
    render: (r) => h(NTag, { size: "small", type: statusType(r.status) }, { default: () => r.status }),
  },
  {
    title: "Results",
    key: "actions",
    width: 110,
    fixed: "right",
    render: (r) =>
      h(NButton, { size: "tiny", quaternary: true, onClick: () => viewLaunchResults(r.id) }, { default: () => "View" }),
  },
]);

function applyDeepLinkQuery(): void {
  const mode = typeof route.query.mode === "string" ? route.query.mode : "";
  if (mode === "contacts" || mode === "company" || mode === "list") {
    if (showTargetTabs.value || mode === "list") targetMode.value = mode;
  }
  const contactId = typeof route.query.contactId === "string" ? route.query.contactId : "";
  if (contactId && showTargetTabs.value) {
    targetMode.value = "contacts";
    checkedContactKeys.value = [contactId];
  }
  const companyId = typeof route.query.companyId === "string" ? route.query.companyId : "";
  if (companyId && showTargetTabs.value) {
    targetMode.value = "company";
    selectedCompanyId.value = companyId;
  }
}

onMounted(async () => {
  if (projectStore.projects.length === 0) await projectStore.loadProjects();
  targetMode.value = restoreTargetMode();
  if (isFeasible.value) targetMode.value = "list";
  applyDeepLinkQuery();
  await Promise.all([loadWorkflows(), loadLists(), loadHistory()]);
  if (selectedWorkflow.value === null && workflows.value.length) {
    const firstConfigured = workflows.value.find((w) => w.configured);
    selectedWorkflow.value = firstConfigured?.key ?? null;
  }
  if (targetMode.value === "company" && selectedCompanyId.value) {
    await searchCompanies();
    await loadCompanyRoster(selectedCompanyId.value);
  } else if (targetMode.value === "contacts") {
    await loadPickerContacts();
  }
});

onUnmounted(stopPolling);

watch(projectId, async () => {
  selectedWorkflow.value = null;
  selectedList.value = null;
  selectedCompanyId.value = null;
  contacts.value = [];
  checkedContactKeys.value = [];
  currentRun.value = null;
  if (isFeasible.value) targetMode.value = "list";
  await Promise.all([loadWorkflows(), loadLists(), loadHistory()]);
  const firstConfigured = workflows.value.find((w) => w.configured);
  selectedWorkflow.value = firstConfigured?.key ?? null;
  await reloadContactsForMode();
});

watch(targetMode, (mode) => {
  if (isFeasible.value && mode !== "list") {
    targetMode.value = "list";
    return;
  }
  persistTargetMode(mode);
  contacts.value = [];
  checkedContactKeys.value = [];
  void reloadContactsForMode();
});

watch(selectedList, () => {
  if (targetMode.value === "list") void loadListContacts();
});

watch(selectedCompanyId, async (id) => {
  if (targetMode.value !== "company" || !id) return;
  const match = companyOptions.value.find((c) => c.company_id === id);
  if (match) selectedCompanyName.value = match.name;
  await loadCompanyRoster(id);
});

let contactSearchTimer: ReturnType<typeof setTimeout> | undefined;
watch(contactSearch, () => {
  contactPickerPage.value = 1;
  window.clearTimeout(contactSearchTimer);
  contactSearchTimer = setTimeout(() => {
    if (targetMode.value === "contacts") void loadPickerContacts();
  }, 250);
});

let companySearchTimer: ReturnType<typeof setTimeout> | undefined;
watch(companySearch, () => {
  window.clearTimeout(companySearchTimer);
  companySearchTimer = setTimeout(() => void searchCompanies(), 250);
});

watch(workflows, (items) => {
  if (!selectedWorkflow.value && items.length) {
    const firstConfigured = items.find((w) => w.configured);
    selectedWorkflow.value = firstConfigured?.key ?? null;
  }
});
</script>

<template>
  <NSpace vertical size="large" style="width: 100%">
    <NCard>
      <template #header>
        <NSpace align="center" size="small">
          <RocketIcon :size="18" />
          <span>Workflow launch</span>
        </NSpace>
      </template>

      <NAlert v-if="!projectId" type="warning">
        Select a project in the top bar to choose targets and launch workflows.
      </NAlert>

      <NSpace v-else vertical size="medium" style="width: 100%">
        <NSpace align="center" wrap>
          <NSelect
            v-model:value="selectedWorkflow"
            :options="workflowOptions"
            placeholder="Workflow"
            style="width: 320px"
          />
          <NButton
            type="primary"
            :loading="launching"
            :disabled="!canLaunch"
            @click="launch"
          >
            {{ launchButtonText }}
          </NButton>
        </NSpace>

        <NAlert v-if="unsyncedSelectedCount > 0" type="warning">
          {{ unsyncedSelectedCount }} selected contact(s) are not synced in Supabase Contacts. Sync them before launching.
        </NAlert>

        <NTabs v-if="showTargetTabs" v-model:value="targetMode" type="line" animated>
          <NTabPane name="list" tab="GetSales list">
            <NSpace vertical size="medium" style="width: 100%; margin-top: 8px">
              <NSelect
                v-model:value="selectedList"
                :options="listOptions"
                placeholder="GetSales list (optional for Velvetech)"
                filterable
                clearable
                style="max-width: 420px"
              />
              <NAlert v-if="contactsError" type="error">{{ contactsError }}</NAlert>
              <template v-if="selectedList">
                <NSpace align="center" size="small">
                  <NText depth="3">{{ contacts.length }} contacts in this list</NText>
                  <NText depth="3">
                    {{ checkedContactKeys.length ? `${checkedContactKeys.length} selected` : "No selection means all contacts" }}
                  </NText>
                </NSpace>
                <NDataTable
                  :columns="contactColumns"
                  :data="contacts"
                  :loading="contactsLoading"
                  :row-key="(row: ContactRow) => row.uuid"
                  v-model:checked-row-keys="checkedContactKeys"
                  :max-height="420"
                  size="small"
                  striped
                />
              </template>
              <NEmpty v-else description="Select a GetSales list to preview contacts (optional for Velvetech launch)" />
            </NSpace>
          </NTabPane>

          <NTabPane name="contacts" tab="Contacts">
            <NSpace vertical size="medium" style="width: 100%; margin-top: 8px">
              <NInput v-model:value="contactSearch" clearable placeholder="Search synced project contacts…" style="max-width: 420px" />
              <NAlert v-if="contactsError" type="error">{{ contactsError }}</NAlert>
              <NSpace align="center" size="small">
                <NText depth="3">{{ contactPickerTotal }} synced contacts</NText>
                <NText depth="3">
                  {{ checkedContactKeys.length ? `${checkedContactKeys.length} selected` : "No selection means all on this page" }}
                </NText>
              </NSpace>
              <NDataTable
                :columns="contactColumns"
                :data="contacts"
                :loading="contactsLoading"
                :row-key="(row: ContactRow) => row.uuid"
                v-model:checked-row-keys="checkedContactKeys"
                :max-height="420"
                size="small"
                striped
              />
            </NSpace>
          </NTabPane>

          <NTabPane name="company" tab="Company">
            <NSpace vertical size="medium" style="width: 100%; margin-top: 8px">
              <NSpace align="center" wrap>
                <NInput v-model:value="companySearch" clearable placeholder="Search companies…" style="width: 240px" />
                <NSelect
                  v-model:value="selectedCompanyId"
                  :options="companySelectOptions"
                  :loading="companyLoading"
                  filterable
                  placeholder="Select company"
                  style="width: 320px"
                  @focus="searchCompanies"
                />
              </NSpace>
              <NAlert v-if="contactsError" type="error">{{ contactsError }}</NAlert>
              <template v-if="selectedCompanyId">
                <NSpace align="center" size="small">
                  <NText depth="3">{{ selectedCompanyName || "Company" }} — {{ contacts.length }} contacts</NText>
                  <NText depth="3">
                    {{ checkedContactKeys.length ? `${checkedContactKeys.length} selected` : "No selection means all contacts" }}
                  </NText>
                </NSpace>
                <NDataTable
                  :columns="contactColumns"
                  :data="contacts"
                  :loading="companyCardLoading"
                  :row-key="(row: ContactRow) => row.uuid"
                  v-model:checked-row-keys="checkedContactKeys"
                  :max-height="420"
                  size="small"
                  striped
                />
              </template>
              <NEmpty v-else description="Search and select a company to view its contact roster" />
            </NSpace>
          </NTabPane>
        </NTabs>

        <template v-else>
          <NSelect
            v-model:value="selectedList"
            :options="listOptions"
            placeholder="GetSales list"
            filterable
            style="width: 320px"
            @update:value="loadListContacts"
          />
          <NAlert v-if="contactsError" type="error">{{ contactsError }}</NAlert>
          <template v-if="selectedList">
            <NSpace align="center" size="small">
              <NText depth="3">{{ contacts.length }} contacts in this list</NText>
              <NText depth="3">
                {{ checkedContactKeys.length ? `${checkedContactKeys.length} selected` : "No selection means all contacts" }}
              </NText>
            </NSpace>
            <NDataTable
              :columns="contactColumns"
              :data="contacts"
              :loading="contactsLoading"
              :row-key="(row: ContactRow) => row.uuid"
              v-model:checked-row-keys="checkedContactKeys"
              :max-height="420"
              size="small"
              striped
            />
          </template>
          <NEmpty v-else description="Select a GetSales list to preview contacts" />
        </template>
      </NSpace>
    </NCard>

    <NCard v-if="currentRun" title="Current run">
      <NSpace align="center" wrap size="medium">
        <NTag :type="statusType(currentRun.status)">{{ currentRun.status }}</NTag>
        <NText>{{ workflowLabel(currentRun.workflow_key) }}</NText>
        <NText depth="3">
          {{ currentRun.contacts_count }}/{{ currentRun.requested_count }} contacts •
          {{ currentRun.companies_count }} companies •
          {{ currentRun.succeeded_count }} ok • {{ currentRun.failed_count }} failed
        </NText>
        <NButton size="small" @click="viewLaunchResults(currentRun.id)">View results</NButton>
      </NSpace>
      <NAlert v-if="currentRun.error_message" type="error" style="margin-top: 8px">
        {{ currentRun.error_message }}
      </NAlert>
    </NCard>

    <NCard title="Execution history">
      <NDataTable
        :columns="historyColumns"
        :data="history"
        :loading="historyLoading"
        :row-key="(row: LaunchRun) => row.id"
        :max-height="420"
        :scroll-x="1200"
        size="small"
        striped
      />
    </NCard>
  </NSpace>
</template>

<style scoped>
.launch-link {
  color: #2080f0;
  text-decoration: none;
  font-weight: 500;
}
.launch-link:hover {
  text-decoration: underline;
}
</style>
