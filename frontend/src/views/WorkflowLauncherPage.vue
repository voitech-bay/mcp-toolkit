<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, h } from "vue";
import { useRouter } from "vue-router";
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
  useMessage,
} from "naive-ui";
import type { DataTableColumns, SelectOption } from "naive-ui";
import { RocketIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";

interface WorkflowOption {
  key: string;
  label: string;
  project: string;
  configured: boolean;
}

interface ContactRow {
  uuid: string;
  name: string;
  position: string;
  company_name: string;
  linkedin_url: string | null;
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

const router = useRouter();
const message = useMessage();
const projectStore = useProjectStore();

const FEASIBLE_PROJECT_ID = "94dc3b92-1cae-4360-a958-917a58063309";
const projectId = computed(() =>
  projectStore.selectedProjectId === FEASIBLE_PROJECT_ID ? FEASIBLE_PROJECT_ID : null
);

const workflows = ref<WorkflowOption[]>([]);
const selectedWorkflow = ref<string | null>(null);

const lists = ref<{ uuid: string; name: string }[]>([]);
const selectedList = ref<string | null>(null);

const contacts = ref<ContactRow[]>([]);
const contactsLoading = ref(false);
const contactsError = ref("");

const launching = ref(false);
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

const workflowLabel = (key: string): string =>
  workflows.value.find((w) => w.key === key)?.label ?? key;

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

async function loadWorkflows(): Promise<void> {
  try {
    const r = await fetch("/api/n8n/workflows");
    const data = (await r.json()) as { items?: WorkflowOption[]; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed to load workflows");
    workflows.value = data.items ?? [];
    const firstConfigured = workflows.value.find((w) => w.configured);
    if (firstConfigured && !selectedWorkflow.value) selectedWorkflow.value = firstConfigured.key;
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to load workflows");
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

async function loadContacts(): Promise<void> {
  contacts.value = [];
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
    const rows = (data.data ?? []).map((row) => {
      const first = typeof row.first_name === "string" ? row.first_name : "";
      const last = typeof row.last_name === "string" ? row.last_name : "";
      const nameJoined = `${first} ${last}`.trim();
      return {
        uuid: typeof row.uuid === "string" ? row.uuid : "",
        name: nameJoined || (typeof row.name === "string" ? row.name : "") || "(no name)",
        position: typeof row.position === "string" ? row.position : "",
        company_name: typeof row.company_name === "string" ? row.company_name : "",
        linkedin_url: typeof row.linkedin_url === "string" ? row.linkedin_url : null,
      } satisfies ContactRow;
    });
    contacts.value = rows.filter((c) => c.uuid);
  } catch (e) {
    contactsError.value = e instanceof Error ? e.message : "Failed to load contacts";
  } finally {
    contactsLoading.value = false;
  }
}


async function launch(): Promise<void> {
  if (!projectId.value) {
    message.warning("Select a project first");
    return;
  }
  if (!selectedWorkflow.value) {
    message.warning("Select a workflow");
    return;
  }
  if (!selectedList.value) {
    message.warning("Select a GetSales list");
    return;
  }
  const leadUuids = contacts.value.map((c) => c.uuid).filter(Boolean);
  if (leadUuids.length === 0) {
    message.warning("The selected list has no contacts to launch");
    return;
  }
  launching.value = true;
  try {
    const r = await fetch("/api/n8n/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: projectId.value,
        workflowKey: selectedWorkflow.value,
        sourceListUuid: selectedList.value,
        leadUuids,
      }),
    });
    const data = (await r.json()) as { launchId?: string; error?: string };
    if (!r.ok || !data.launchId) throw new Error(data.error ?? "Launch failed");
    message.success(`Launched Feasible workflow for ${leadUuids.length} contact(s)`);
    startPolling(data.launchId);
    void loadHistory();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Launch failed");
  } finally {
    launching.value = false;
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
    /* keep polling; transient */
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

function viewResults(launchId: string): void {
  const filters = encodeURIComponent(
    JSON.stringify([{ field: "result_text", op: "like", value: launchId }])
  );
  router.push({ path: "/n8n/workflow-results", query: { filters } });
}

const contactColumns = computed<DataTableColumns<ContactRow>>(() => [
  { title: "Name", key: "name", minWidth: 160, ellipsis: { tooltip: true } },
  { title: "Position", key: "position", minWidth: 180, ellipsis: { tooltip: true } },
  { title: "Company", key: "company_name", minWidth: 160, ellipsis: { tooltip: true } },
  {
    title: "LinkedIn",
    key: "linkedin_url",
    minWidth: 120,
    render(row) {
      if (!row.linkedin_url) return "—";
      return h(
        "a",
        { href: row.linkedin_url, target: "_blank", rel: "noopener" },
        "profile"
      );
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
      h(
        NButton,
        { size: "tiny", quaternary: true, onClick: () => viewResults(r.id) },
        { default: () => "View" }
      ),
  },
]);

onMounted(async () => {
  if (projectStore.projects.length === 0) await projectStore.loadProjects();
  if (projectStore.selectedProjectId !== FEASIBLE_PROJECT_ID) {
    projectStore.selectProject(FEASIBLE_PROJECT_ID);
  }
  await Promise.all([loadWorkflows(), loadLists(), loadHistory()]);
});
onUnmounted(stopPolling);
</script>

<template>
  <NSpace vertical size="large" style="width: 100%">
    <NCard>
      <template #header>
        <NSpace align="center" size="small">
          <RocketIcon :size="18" />
          <span>Feasible workflow launch</span>
        </NSpace>
      </template>

      <NAlert v-if="!projectId" type="warning">
        Select the Feasible project in the top bar to choose a GetSales list and launch.
      </NAlert>

      <NSpace v-else vertical size="medium" style="width: 100%">
        <NSpace align="center" wrap>
          <NSelect
            v-model:value="selectedWorkflow"
            :options="workflowOptions"
            placeholder="Workflow"
            style="width: 320px"
          />
          <NSelect
            v-model:value="selectedList"
            :options="listOptions"
            placeholder="GetSales list"
            filterable
            style="width: 320px"
            @update:value="loadContacts"
          />
          <NButton
            type="primary"
            :loading="launching"
            :disabled="contacts.length === 0 || !selectedWorkflow || contactsLoading"
            @click="launch"
          >
            Launch Feasible list
          </NButton>
        </NSpace>

        <NAlert v-if="contactsError" type="error">{{ contactsError }}</NAlert>

        <template v-if="selectedList">
          <NSpace align="center" size="small">
            <NText depth="3">{{ contacts.length }} contacts in this list</NText>
          </NSpace>
          <NDataTable
            :columns="contactColumns"
            :data="contacts"
            :loading="contactsLoading"
            :row-key="(row: ContactRow) => row.uuid"
            :max-height="420"
            size="small"
            striped
          />
        </template>
        <NEmpty v-else description="Select a Feasible GetSales list to preview contacts" />
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
        <NButton size="small" @click="viewResults(currentRun.id)">View results</NButton>
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
