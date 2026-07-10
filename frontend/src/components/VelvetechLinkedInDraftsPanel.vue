<script setup lang="ts">
import { ref, computed, onMounted, watch, h } from "vue";
import { RouterLink, useRouter } from "vue-router";
import {
  NDataTable,
  NTag,
  NButton,
  NSpace,
  NEmpty,
  NModal,
  NInput,
  NAlert,
  NText,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";

export interface DraftRow {
  id: string;
  contact_id: string;
  company_id: string | null;
  contact_name: string;
  company_name: string;
  execution_id: string;
  status: string;
  sends: string[];
  copy_ok: boolean;
  copy_violations: string[];
  sender_profile_uuid: string;
  created_at: string;
}

const props = defineProps<{
  projectId: string | null;
}>();

const router = useRouter();
const message = useMessage();

const drafts = ref<DraftRow[]>([]);
const loading = ref(false);
const approvingDraftId = ref<string | null>(null);
const editingDraft = ref<DraftRow | null>(null);
const editText = ref("");

async function loadDrafts(): Promise<void> {
  drafts.value = [];
  if (!props.projectId) return;
  loading.value = true;
  try {
    const r = await fetch(`/api/n8n/velvetech/drafts?projectId=${encodeURIComponent(props.projectId)}`);
    const data = (await r.json()) as { rows?: DraftRow[]; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed to load drafts");
    drafts.value = data.rows ?? [];
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to load drafts");
  } finally {
    loading.value = false;
  }
}

async function approveDraft(row: DraftRow, editedSends?: string[]): Promise<void> {
  if (!props.projectId) return;
  approvingDraftId.value = row.id;
  try {
    const body: Record<string, unknown> = { projectId: props.projectId, draftId: row.id };
    if (editedSends && editedSends.length > 0) body.sends = editedSends;
    const r = await fetch("/api/n8n/velvetech/drafts/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await r.json()) as { ok?: boolean; error?: string };
    if (!r.ok || !data.ok) throw new Error(data.error ?? "Approval failed");
    message.success("Sent LinkedIn messages");
    editingDraft.value = null;
    await loadDrafts();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Approval failed");
  } finally {
    approvingDraftId.value = null;
  }
}

function openDraftEditor(row: DraftRow): void {
  editingDraft.value = row;
  editText.value = row.sends.join("\n\n");
}

function editedSendsFromText(): string[] {
  return editText.value
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function approveEditedDraft(): Promise<void> {
  const row = editingDraft.value;
  if (!row) return;
  const sends = editedSendsFromText();
  if (sends.length === 0) {
    message.error("Draft is empty");
    return;
  }
  await approveDraft(row, sends);
}

function viewExecutionResults(executionId: string): void {
  router.push({ path: "/n8n/workflow-results", query: { executionId } });
}

function viewResultRow(rowId: string): void {
  router.push({ path: "/n8n/workflow-results", query: { highlight: rowId } });
}

const columns = computed<DataTableColumns<DraftRow>>(() => [
  {
    title: "When",
    key: "created_at",
    width: 160,
    render: (r) => new Date(r.created_at).toLocaleString(),
  },
  {
    title: "Contact",
    key: "contact_name",
    minWidth: 150,
    ellipsis: { tooltip: true },
    render: (r) =>
      h(
        RouterLink,
        { to: `/contact/${r.contact_id}`, class: "draft-link" },
        { default: () => r.contact_name || r.contact_id }
      ),
  },
  {
    title: "Company",
    key: "company_name",
    minWidth: 160,
    ellipsis: { tooltip: true },
    render: (r) =>
      r.company_id
        ? h(
            RouterLink,
            { to: `/company/${r.company_id}`, class: "draft-link" },
            { default: () => r.company_name || r.company_id }
          )
        : r.company_name || "—",
  },
  {
    title: "Status",
    key: "status",
    width: 128,
    render: (r) =>
      h(
        NTag,
        {
          size: "small",
          type: r.status === "sent" ? "success" : r.status === "needs_human" ? "warning" : "info",
        },
        { default: () => r.status }
      ),
  },
  {
    title: "Draft",
    key: "sends",
    minWidth: 360,
    render: (r) => h("div", { style: "white-space:pre-wrap;line-height:1.35" }, r.sends.join("\n\n")),
  },
  {
    title: "Issues",
    key: "copy_violations",
    width: 180,
    render: (r) => (r.copy_violations.length ? r.copy_violations.join(", ") : "—"),
  },
  {
    title: "Actions",
    key: "actions",
    width: 220,
    fixed: "right",
    render: (r) =>
      h(NSpace, { size: 4 }, {
        default: () => [
          h(
            RouterLink,
            { to: `/contact/${r.contact_id}`, class: "draft-link" },
            { default: () => "Thread" }
          ),
          h(NButton, { size: "tiny", quaternary: true, onClick: () => viewResultRow(r.id) }, { default: () => "Result" }),
          h(NButton, { size: "tiny", quaternary: true, onClick: () => viewExecutionResults(r.execution_id) }, { default: () => "Run" }),
          h(NButton, {
            size: "tiny",
            disabled: (r.status !== "pending_approval" && r.status !== "needs_human") || !r.sender_profile_uuid,
            onClick: () => openDraftEditor(r),
          }, { default: () => "Edit" }),
          h(NButton, {
            size: "tiny",
            type: "primary",
            disabled: r.status !== "pending_approval" || !r.sender_profile_uuid,
            loading: approvingDraftId.value === r.id,
            onClick: () => approveDraft(r),
          }, { default: () => "Approve" }),
        ],
      }),
  },
]);

onMounted(() => void loadDrafts());
watch(() => props.projectId, () => void loadDrafts());

defineExpose({ reload: loadDrafts });
</script>

<template>
  <div>
    <NDataTable
      :columns="columns"
      :data="drafts"
      :loading="loading"
      :row-key="(row: DraftRow) => row.id"
      :max-height="520"
      :scroll-x="1200"
      size="small"
      striped
    />
    <NEmpty v-if="!loading && drafts.length === 0" description="No Velvetech LinkedIn reply drafts yet" />

    <NModal
      :show="editingDraft !== null"
      preset="card"
      style="max-width: 640px"
      :title="editingDraft ? `Edit draft — ${editingDraft.contact_name}` : ''"
      @update:show="(v: boolean) => { if (!v) editingDraft = null; }"
    >
      <NSpace vertical size="medium">
        <NAlert v-if="editingDraft?.status === 'needs_human'" type="warning">
          This draft needs human review. Edit the messages below, then approve to send.
        </NAlert>
        <NAlert v-if="editingDraft && editingDraft.copy_violations.length" type="warning">
          {{ editingDraft.copy_violations.join(", ") }}
        </NAlert>
        <NText depth="3">One LinkedIn message per block; separate messages with a blank line.</NText>
        <NInput
          v-model:value="editText"
          type="textarea"
          :autosize="{ minRows: 8, maxRows: 18 }"
          placeholder="Message 1&#10;&#10;Message 2"
        />
        <NSpace justify="end">
          <NButton @click="editingDraft = null">Cancel</NButton>
          <NButton
            type="primary"
            :loading="editingDraft !== null && approvingDraftId === editingDraft.id"
            @click="approveEditedDraft"
          >
            Approve &amp; send
          </NButton>
        </NSpace>
      </NSpace>
    </NModal>
  </div>
</template>

<style scoped>
.draft-link {
  color: #2080f0;
  text-decoration: none;
  font-weight: 500;
}
.draft-link:hover {
  text-decoration: underline;
}
</style>
