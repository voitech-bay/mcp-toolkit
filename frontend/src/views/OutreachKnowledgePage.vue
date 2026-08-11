<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from "vue";
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  NTag,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { useProjectStore } from "../stores/project";

type Doc = {
  id: string;
  kind: string;
  title: string;
  version: number;
  content_markdown: string;
  priority: number;
  status: string;
  source_path: string | null;
  updated_at: string;
};

const WELLORE_PROJECT_ID = "0038d0db-aab2-40f1-9f6e-38d38e157f8f";
const CLIENT_HUB_BY_PROJECT: Record<string, { label: string; href: string }> = {
  [WELLORE_PROJECT_ID]: {
    label: "Client hub · Контекст",
    href: "https://wellore-gtm-production.up.railway.app/context.html",
  },
};

const store = useProjectStore();
const toast = useMessage();
const docs = ref<Doc[]>([]);
const error = ref("");
const loading = ref(false);
const title = ref("");
const kind = ref("product_truth");
const content = ref("");
const priority = ref(100);
const sourcePath = ref("");
const statusFilter = ref<"active" | "all">("active");
const kindFilter = ref<string>("");
const search = ref("");

const kinds = [
  "product_truth",
  "proof_points",
  "icp_angle_framework",
  "forbidden_claims",
  "messaging_style",
  "inmail_guidelines",
  "message_guidelines",
  "examples",
  "demo_assets",
  "meeting_summary",
  "canonical_context",
].map((v) => ({ label: v.replace(/_/g, " "), value: v }));

const statusOptions = [
  { label: "Active only", value: "active" },
  { label: "All versions", value: "all" },
];

const kindFilterOptions = computed(() => [
  { label: "All kinds", value: "" },
  ...kinds,
]);

const clientHub = computed(() => {
  const id = store.selectedProjectId;
  return id ? CLIENT_HUB_BY_PROJECT[id] ?? null : null;
});

const previewOpen = ref(false);
const previewDoc = ref<Doc | null>(null);

function openPreview(row: Doc) {
  previewDoc.value = row;
  previewOpen.value = true;
}

async function load() {
  if (!store.selectedProjectId) {
    docs.value = [];
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch(`/api/projects/${store.selectedProjectId}/outreach-knowledge`);
    const j = await r.json();
    if (!r.ok) error.value = j.error ?? "Could not load knowledge";
    else docs.value = j.data ?? [];
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!store.selectedProjectId) return;
  const r = await fetch(`/api/projects/${store.selectedProjectId}/outreach-knowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: title.value,
      kind: kind.value,
      contentMarkdown: content.value,
      priority: priority.value,
      sourcePath: sourcePath.value || null,
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    error.value = j.error ?? "Could not save";
    return;
  }
  title.value = "";
  content.value = "";
  sourcePath.value = "";
  toast.success("New draft version created");
  await load();
}

async function activate(id: string) {
  if (!store.selectedProjectId) return;
  const r = await fetch(`/api/projects/${store.selectedProjectId}/outreach-knowledge/${id}/activate`, {
    method: "POST",
  });
  const j = await r.json();
  if (!r.ok) {
    error.value = j.error ?? "Could not activate";
    return;
  }
  toast.success("Version activated");
  await load();
}

function copyPreview() {
  const text = previewDoc.value?.content_markdown ?? "";
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
}

const filteredDocs = computed(() => {
  const q = search.value.trim().toLowerCase();
  return docs.value
    .filter((d) => (statusFilter.value === "active" ? d.status === "active" : true))
    .filter((d) => (kindFilter.value ? d.kind === kindFilter.value : true))
    .filter((d) => {
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        d.kind.toLowerCase().includes(q) ||
        (d.source_path ?? "").toLowerCase().includes(q) ||
        d.content_markdown.toLowerCase().includes(q)
      );
    })
    .slice()
    .sort((a, b) => a.priority - b.priority || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title) || b.version - a.version);
});

const columns = computed<DataTableColumns<Doc>>(() => [
  {
    title: "Kind",
    key: "kind",
    width: 160,
    render: (r) =>
      h(NTag, { size: "small", bordered: false }, { default: () => r.kind.replace(/_/g, " ") }),
  },
  { title: "Title", key: "title", ellipsis: { tooltip: true } },
  { title: "Version", key: "version", width: 80 },
  { title: "Priority", key: "priority", width: 80 },
  {
    title: "Status",
    key: "status",
    width: 100,
    render: (r) =>
      h(
        NTag,
        { size: "small", type: r.status === "active" ? "success" : r.status === "draft" ? "warning" : "default" },
        { default: () => r.status }
      ),
  },
  { title: "Source", key: "source_path", ellipsis: { tooltip: true } },
  {
    title: "",
    key: "actions",
    width: 200,
    render: (r) =>
      h(
        NSpace,
        { size: 6 },
        {
          default: () => [
            h(NButton, { size: "small", onClick: () => openPreview(r) }, { default: () => "View" }),
            r.status === "active"
              ? h("span", { style: "opacity:.65;font-size:12px;line-height:28px" }, "Active")
              : h(NButton, { size: "small", type: "primary", onClick: () => activate(r.id) }, { default: () => "Activate" }),
          ],
        }
      ),
  },
]);

onMounted(load);
watch(() => store.selectedProjectId, load);
</script>

<template>
  <NSpace vertical size="large">
    <NCard title="Outreach Knowledge Hub">
      <NAlert type="info" :show-icon="false" style="margin-bottom:14px">
        The agent reads active versions only. Saving creates an immutable draft; activation is explicit.
        This is the project knowledge library for messaging — not Saved reply contexts.
      </NAlert>
      <NSpace v-if="clientHub" style="margin-bottom:12px">
        <a :href="clientHub.href" target="_blank" rel="noopener noreferrer">{{ clientHub.label }} →</a>
      </NSpace>
      <NAlert v-if="error" type="error" style="margin-bottom:12px">{{ error }}</NAlert>
      <NSpace style="margin-bottom:12px" wrap>
        <NSelect v-model:value="statusFilter" :options="statusOptions" style="width:160px" />
        <NSelect v-model:value="kindFilter" :options="kindFilterOptions" placeholder="Kind" style="width:200px" />
        <NInput v-model:value="search" clearable placeholder="Search title, kind, source, body" style="width:280px" />
      </NSpace>
      <NDataTable
        :columns="columns"
        :data="filteredDocs"
        :loading="loading"
        :pagination="{ pageSize: 20 }"
        :row-key="(r: Doc) => r.id"
      />
    </NCard>

    <NCard title="Create a new version">
      <NForm>
        <NFormItem label="Kind">
          <NSelect v-model:value="kind" :options="kinds" />
        </NFormItem>
        <NFormItem label="Title">
          <NInput v-model:value="title" placeholder="Use the same title to create the next version" />
        </NFormItem>
        <NFormItem label="Knowledge and guidelines">
          <NInput v-model:value="content" type="textarea" :autosize="{ minRows: 8, maxRows: 20 }" />
        </NFormItem>
        <NFormItem label="Priority (lower takes precedence)">
          <NInputNumber v-model:value="priority" :min="1" />
        </NFormItem>
        <NFormItem label="Source path">
          <NInput v-model:value="sourcePath" />
        </NFormItem>
        <NButton type="primary" :disabled="!title.trim() || !content.trim()" @click="save">
          Save draft version
        </NButton>
      </NForm>
    </NCard>

    <NModal
      v-model:show="previewOpen"
      preset="card"
      style="width: min(840px, 94vw)"
      :title="previewDoc ? `${previewDoc.title} (v${previewDoc.version})` : 'Knowledge'"
    >
      <template v-if="previewDoc">
        <NSpace style="margin-bottom:10px" size="small">
          <NTag size="small">{{ previewDoc.kind.replace(/_/g, " ") }}</NTag>
          <NTag size="small" :type="previewDoc.status === 'active' ? 'success' : 'default'">{{ previewDoc.status }}</NTag>
          <span style="opacity:.65;font-size:12px">{{ previewDoc.source_path || "no source path" }}</span>
        </NSpace>
        <pre class="knowledge-preview">{{ previewDoc.content_markdown }}</pre>
        <NSpace style="margin-top:12px">
          <NButton @click="copyPreview">Copy markdown</NButton>
          <NButton
            v-if="previewDoc.status !== 'active'"
            type="primary"
            @click="activate(previewDoc.id)"
          >
            Activate
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </NSpace>
</template>

<style scoped>
.knowledge-preview {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.45;
  max-height: 60vh;
  overflow: auto;
  margin: 0;
  padding: 12px 14px;
  background: var(--n-color-embedded, rgba(0, 0, 0, 0.04));
  border-radius: 8px;
}
</style>
