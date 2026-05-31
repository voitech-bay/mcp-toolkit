<script setup lang="ts">
import { ref, computed, h, onMounted } from "vue";
import {
  NCard,
  NDataTable,
  NButton,
  NSpace,
  NTag,
  NAlert,
  NDrawer,
  NDrawerContent,
  NSelect,
  NInput,
  NText,
  NDivider,
  NSpin,
  useMessage,
} from "naive-ui";
import type { DataTableColumns, SelectOption } from "naive-ui";

type Pipeline = "inmail" | "followup";

interface Research {
  lead_uuid: string;
  first_name: string;
  name: string;
  title: string;
  linkedin_url: string;
  company_name: string;
  company_domain: string;
  company_description: string;
  company_employees: string;
  location: string;
  pov: string;
  chosen_observation: string;
  role_bucket: string;
  assumed_channel_mix: unknown;
  assumed_target_metric: string;
  dq_reason: string;
  prompt_version: string;
}
interface Item {
  result_id: string;
  created_at: string;
  workflow: string;
  pipeline: Pipeline;
  research: Research;
  subject: string;
  body: string;
  violations: string[];
  status: string;
  current_version_id: string | null;
}
interface Version {
  id: string;
  subject: string | null;
  body: string;
  source: string;
  model: string | null;
  prompt_version: string | null;
  violations: string[];
  created_at: string;
}
interface Comment {
  id: string;
  kind: string;
  quoted_text: string | null;
  body: string;
  created_at: string;
}
interface PushPreview {
  fields: Record<string, string>;
  assembledPreview: string;
  droppedGreeting: string | null;
  warning: string | null;
  leadUuid: string;
}

const message = useMessage();

const PIPELINE_OPTIONS: SelectOption[] = [
  { label: "All", value: "" },
  { label: "InMail", value: "inmail" },
  { label: "Follow-up", value: "followup" },
];

const loading = ref(false);
const loadError = ref("");
const items = ref<Item[]>([]);
const pipelineFilter = ref<string>("");

async function loadItems() {
  loading.value = true;
  loadError.value = "";
  try {
    const r = await fetch("/api/inmail-review/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipeline: pipelineFilter.value || undefined, limit: 200 }),
    });
    const data = (await r.json()) as { items?: Item[]; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed to load");
    items.value = data.items ?? [];
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "Failed to load";
    items.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(loadItems);

// ---- review drawer ----
const drawerOpen = ref(false);
const drawerLoading = ref(false);
const active = ref<Item | null>(null);
const versions = ref<Version[]>([]);
const comments = ref<Comment[]>([]);
const currentVersionId = ref<string | null>(null);
const status = ref<string>("pending");

const currentVersion = computed<Version | null>(
  () => versions.value.find((v) => v.id === currentVersionId.value) ?? versions.value[versions.value.length - 1] ?? null
);

const feedback = ref("");
const model = ref("nousresearch/hermes-4-70b");
const regenerating = ref(false);
const pendingQuote = ref("");
const inlineDraft = ref("");
const pushPreview = ref<PushPreview | null>(null);
const pushing = ref(false);

async function openReview(item: Item) {
  active.value = item;
  drawerOpen.value = true;
  drawerLoading.value = true;
  versions.value = [];
  comments.value = [];
  pushPreview.value = null;
  feedback.value = "";
  try {
    const r = await fetch("/api/inmail-review/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultId: item.result_id }),
    });
    const data = (await r.json()) as {
      versions?: Version[];
      comments?: Comment[];
      current_version_id?: string | null;
      status?: string;
      error?: string;
    };
    if (!r.ok) throw new Error(data.error ?? "Failed to open");
    versions.value = data.versions ?? [];
    comments.value = data.comments ?? [];
    currentVersionId.value = data.current_version_id ?? null;
    status.value = data.status ?? "pending";
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to open");
  } finally {
    drawerLoading.value = false;
  }
}

function captureSelection() {
  const sel = window.getSelection()?.toString().trim() ?? "";
  if (!sel) {
    message.warning("Select some text in the body first.");
    return;
  }
  pendingQuote.value = sel;
}

async function addComment(kind: "inline" | "general") {
  if (!active.value) return;
  const text = kind === "inline" ? inlineDraft.value.trim() : feedback.value.trim();
  if (!text) {
    message.warning("Write a comment first.");
    return;
  }
  if (kind === "inline" && !pendingQuote.value) {
    message.warning("Select text and click 'Use selection' first.");
    return;
  }
  try {
    const r = await fetch("/api/inmail-review/comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resultId: active.value.result_id,
        kind,
        body: text,
        quotedText: kind === "inline" ? pendingQuote.value : undefined,
      }),
    });
    const data = (await r.json()) as { comment?: Comment; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed");
    if (data.comment) comments.value.push(data.comment);
    if (kind === "inline") {
      inlineDraft.value = "";
      pendingQuote.value = "";
    }
    message.success("Comment saved.");
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to comment");
  }
}

async function regenerate() {
  if (!active.value) return;
  regenerating.value = true;
  try {
    const r = await fetch("/api/inmail-review/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultId: active.value.result_id, model: model.value, feedback: feedback.value }),
    });
    const data = (await r.json()) as { version?: Version; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Regenerate failed");
    if (data.version) {
      versions.value.push(data.version);
      currentVersionId.value = data.version.id;
      status.value = "pending";
    }
    message.success("Regenerated.");
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Regenerate failed");
  } finally {
    regenerating.value = false;
  }
}

async function approve() {
  if (!active.value || !currentVersion.value) return;
  try {
    const r = await fetch("/api/inmail-review/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultId: active.value.result_id, versionId: currentVersion.value.id }),
    });
    const data = (await r.json()) as { ok?: boolean; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Approve failed");
    status.value = "approved";
    const it = items.value.find((i) => i.result_id === active.value?.result_id);
    if (it) it.status = "approved";
    message.success("Approved.");
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Approve failed");
  }
}

async function previewPush() {
  if (!active.value) return;
  pushing.value = true;
  pushPreview.value = null;
  try {
    const r = await fetch("/api/inmail-review/push-getsales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resultId: active.value.result_id,
        versionId: currentVersion.value?.id,
        dryRun: true,
      }),
    });
    const data = (await r.json()) as (PushPreview & { dryRun?: boolean; error?: string });
    if (!r.ok) throw new Error(data.error ?? "Preview failed");
    pushPreview.value = data;
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Preview failed");
  } finally {
    pushing.value = false;
  }
}

function statusType(s: string): "default" | "success" | "warning" | "info" {
  if (s === "approved") return "success";
  if (s === "pushed") return "info";
  if (s === "skipped") return "warning";
  return "default";
}

const columns = computed<DataTableColumns<Item>>(() => [
  {
    title: "Contact",
    key: "contact",
    minWidth: 200,
    render(row) {
      const r = row.research;
      const label = r.name || r.first_name || r.lead_uuid || "—";
      if (r.linkedin_url) {
        return h(
          "a",
          { href: r.linkedin_url, target: "_blank", rel: "noopener", class: "ln-link" },
          label
        );
      }
      return label;
    },
  },
  { title: "Title", key: "title", minWidth: 160, render: (row) => row.research.title || "—" },
  {
    title: "Company",
    key: "company",
    minWidth: 160,
    render: (row) => row.research.company_name || row.research.company_domain || "—",
  },
  {
    title: "Pipeline",
    key: "pipeline",
    width: 100,
    render: (row) => h(NTag, { size: "small", type: row.pipeline === "followup" ? "warning" : "info" }, { default: () => row.pipeline }),
  },
  {
    title: "Status",
    key: "status",
    width: 100,
    render: (row) => h(NTag, { size: "small", type: statusType(row.status) }, { default: () => row.status }),
  },
  {
    title: "Flags",
    key: "violations",
    width: 80,
    render: (row) =>
      row.violations.length
        ? h(NTag, { size: "small", type: "error" }, { default: () => String(row.violations.length) })
        : h(NTag, { size: "small", type: "success" }, { default: () => "clean" }),
  },
  {
    title: "",
    key: "action",
    width: 90,
    fixed: "right",
    render: (row) => h(NButton, { size: "small", type: "primary", onClick: () => openReview(row) }, { default: () => "Review" }),
  },
]);
</script>

<template>
  <NCard>
    <template #header><span>InMail review</span></template>

    <NSpace vertical size="medium" style="width: 100%">
      <NSpace align="center">
        <NSelect
          v-model:value="pipelineFilter"
          :options="PIPELINE_OPTIONS"
          style="width: 160px"
          @update:value="loadItems"
        />
        <NButton size="small" :disabled="loading" @click="loadItems">Refresh</NButton>
        <NText depth="3">{{ items.length }} items</NText>
      </NSpace>

      <NAlert v-if="loadError" type="error">{{ loadError }}</NAlert>

      <NDataTable
        :columns="columns"
        :data="items"
        :loading="loading"
        :scroll-x="980"
        :max-height="640"
        size="small"
        striped
      />
    </NSpace>

    <NDrawer v-model:show="drawerOpen" :width="760" placement="right">
      <NDrawerContent :title="active?.research.name || 'Review'" closable>
        <NSpin :show="drawerLoading">
          <div v-if="active" class="review-grid">
            <!-- research panel -->
            <div class="panel">
              <h4>Research</h4>
              <p>
                <strong>{{ active.research.name || active.research.first_name }}</strong>
                <span v-if="active.research.title"> — {{ active.research.title }}</span>
              </p>
              <p>{{ active.research.company_name }} <NText depth="3">{{ active.research.company_domain }}</NText></p>
              <p v-if="active.research.linkedin_url">
                <a :href="active.research.linkedin_url" target="_blank" rel="noopener" class="ln-link">LinkedIn profile ↗</a>
              </p>
              <p v-if="active.research.location"><NText depth="3">{{ active.research.location }}</NText></p>
              <p v-if="active.research.company_employees"><NText depth="3">{{ active.research.company_employees }} employees</NText></p>
              <NDivider />
              <h4>Reasoning</h4>
              <p v-if="active.research.chosen_observation"><NText depth="3">obs:</NText> {{ active.research.chosen_observation }}</p>
              <p v-if="active.research.role_bucket"><NText depth="3">role:</NText> {{ active.research.role_bucket }}</p>
              <p v-if="active.research.assumed_target_metric"><NText depth="3">metric:</NText> {{ active.research.assumed_target_metric }}</p>
              <p v-if="active.research.company_description" class="muted">{{ active.research.company_description }}</p>
            </div>

            <!-- message + actions -->
            <div class="panel">
              <NSpace align="center" justify="space-between">
                <h4 style="margin: 0">Current message</h4>
                <NTag :type="statusType(status)" size="small">{{ status }}</NTag>
              </NSpace>
              <p v-if="currentVersion?.subject"><strong>Subject:</strong> {{ currentVersion?.subject }}</p>
              <pre class="body-pre">{{ currentVersion?.body }}</pre>
              <NSpace v-if="currentVersion?.violations?.length" size="small" wrap>
                <NTag v-for="v in currentVersion?.violations" :key="v" type="error" size="small">{{ v }}</NTag>
              </NSpace>
              <NText v-else depth="3" style="font-size: 0.8rem">no validation flags</NText>

              <NDivider />
              <h4>Versions</h4>
              <NSpace size="small" wrap>
                <NButton
                  v-for="(v, i) in versions"
                  :key="v.id"
                  size="tiny"
                  :type="v.id === currentVersionId ? 'primary' : 'default'"
                  @click="currentVersionId = v.id"
                >
                  v{{ i + 1 }} ({{ v.source }})
                </NButton>
              </NSpace>

              <NDivider />
              <h4>Inline comment</h4>
              <NSpace vertical size="small">
                <NSpace align="center">
                  <NButton size="tiny" @click="captureSelection">Use selection</NButton>
                  <NText depth="3" style="font-size: 0.8rem">{{ pendingQuote ? '“' + pendingQuote.slice(0, 48) + '”' : 'select text above, then click' }}</NText>
                </NSpace>
                <NInput v-model:value="inlineDraft" placeholder="comment on the selection" size="small" />
                <NButton size="tiny" :disabled="!pendingQuote || !inlineDraft" @click="addComment('inline')">Add inline comment</NButton>
              </NSpace>
              <NSpace v-if="comments.length" vertical size="small" style="margin-top: 8px">
                <div v-for="c in comments" :key="c.id" class="comment">
                  <NTag size="tiny" :type="c.kind === 'inline' ? 'info' : 'default'">{{ c.kind }}</NTag>
                  <span v-if="c.quoted_text" class="muted">“{{ c.quoted_text.slice(0, 40) }}”</span>
                  {{ c.body }}
                </div>
              </NSpace>

              <NDivider />
              <h4>Regenerate</h4>
              <NSpace vertical size="small">
                <NInput
                  v-model:value="feedback"
                  type="textarea"
                  :autosize="{ minRows: 2, maxRows: 5 }"
                  placeholder="general feedback for regeneration"
                />
                <NSpace align="center">
                  <NInput v-model:value="model" size="small" style="width: 280px" />
                  <NButton type="primary" size="small" :loading="regenerating" @click="regenerate">Regenerate</NButton>
                  <NButton size="small" :disabled="!feedback" @click="addComment('general')">Save feedback only</NButton>
                </NSpace>
              </NSpace>

              <NDivider />
              <NSpace align="center">
                <NButton type="success" size="small" :disabled="!currentVersion" @click="approve">Approve</NButton>
                <NButton size="small" :loading="pushing" @click="previewPush">Preview GetSales (dry-run)</NButton>
              </NSpace>

              <div v-if="pushPreview" class="preview">
                <NAlert v-if="pushPreview.warning" type="warning" :show-icon="true" style="margin-bottom: 8px">
                  {{ pushPreview.warning }}
                </NAlert>
                <NText depth="3" style="font-size: 0.8rem">Assembled (as the flow renders it):</NText>
                <pre class="body-pre">{{ pushPreview.assembledPreview }}</pre>
                <NText depth="3" style="font-size: 0.8rem">Custom fields:</NText>
                <pre class="body-pre">{{ JSON.stringify(pushPreview.fields, null, 2) }}</pre>
                <NText depth="3" style="font-size: 0.75rem">Dry-run only — nothing was written to GetSales.</NText>
              </div>
            </div>
          </div>
        </NSpin>
      </NDrawerContent>
    </NDrawer>
  </NCard>
</template>

<style scoped>
.review-grid {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 1rem;
}
.panel h4 {
  margin: 0.4rem 0 0.2rem;
}
.panel p {
  margin: 0.2rem 0;
  font-size: 0.875rem;
}
.body-pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.8rem;
  background: rgba(128, 128, 128, 0.08);
  padding: 0.5rem;
  border-radius: 4px;
  margin: 0.3rem 0;
}
.muted {
  opacity: 0.7;
  font-size: 0.8rem;
}
.comment {
  font-size: 0.8rem;
  display: flex;
  gap: 0.4rem;
  align-items: baseline;
  flex-wrap: wrap;
}
.preview {
  margin-top: 0.6rem;
}
.ln-link {
  color: #2080f0;
  text-decoration: none;
}
.ln-link:hover {
  text-decoration: underline;
}
</style>
