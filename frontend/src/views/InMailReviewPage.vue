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
import { RouterLink } from "vue-router";

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
type ReviewActive = Pick<Item, "result_id" | "pipeline" | "workflow" | "research">;
const drawerOpen = ref(false);
const drawerLoading = ref(false);
const active = ref<ReviewActive | null>(null);
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

async function openReview(resultId: string) {
  active.value = null;
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
      body: JSON.stringify({ resultId }),
    });
    const data = (await r.json()) as {
      result_id?: string;
      pipeline?: Pipeline;
      workflow?: string;
      research?: Research;
      versions?: Version[];
      comments?: Comment[];
      current_version_id?: string | null;
      status?: string;
      error?: string;
    };
    if (!r.ok) throw new Error(data.error ?? "Failed to open");
    active.value = {
      result_id: data.result_id ?? resultId,
      pipeline: (data.pipeline as Pipeline) ?? "inmail",
      workflow: data.workflow ?? "",
      research: data.research ?? ({} as Research),
    };
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

// ---- contact name search + run-new ----
interface ContactHit {
  uuid: string;
  name: string;
  company_name: string;
  position: string;
  linkedin: string;
  execution_count: number;
  last_execution_at: string | null;
}
interface ExecutionRow {
  result_id: string;
  created_at: string;
  workflow: string;
  pipeline: string;
  has_inmail: boolean;
  has_followup: boolean;
}

const searchName = ref("");
const searching = ref(false);
const contactHits = ref<ContactHit[]>([]);
const selectedContact = ref<ContactHit | null>(null);
const executions = ref<ExecutionRow[]>([]);
const execLoading = ref(false);
const runningNew = ref(false);

function fmtDate(s: string | null): string {
  if (!s) return "";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

async function searchContacts() {
  const q = searchName.value.trim();
  if (!q) return;
  searching.value = true;
  contactHits.value = [];
  selectedContact.value = null;
  executions.value = [];
  try {
    const r = await fetch(`/api/inmail-review/contact-search?name=${encodeURIComponent(q)}`);
    const data = (await r.json()) as { items?: ContactHit[]; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Search failed");
    contactHits.value = data.items ?? [];
    if (!contactHits.value.length) message.info("No contacts found.");
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Search failed");
  } finally {
    searching.value = false;
  }
}

async function selectContact(c: ContactHit) {
  selectedContact.value = c;
  executions.value = [];
  execLoading.value = true;
  try {
    const r = await fetch(`/api/inmail-review/contact-executions?contactUuid=${encodeURIComponent(c.uuid)}`);
    const data = (await r.json()) as { executions?: ExecutionRow[]; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed to load executions");
    executions.value = data.executions ?? [];
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to load executions");
  } finally {
    execLoading.value = false;
  }
}

async function runNew() {
  const c = selectedContact.value;
  if (!c) return;
  runningNew.value = true;
  try {
    const before = new Set(executions.value.map((e) => e.result_id));
    const r = await fetch("/api/inmail-review/run-new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadUuid: c.uuid }),
    });
    const data = (await r.json()) as { accepted?: boolean; error?: string };
    if (!r.ok) throw new Error(data.error ?? "Run failed");
    message.success("Run started. Waiting for results...");
    for (let i = 0; i < 36; i++) {
      await new Promise((res) => setTimeout(res, 5000));
      await selectContact(c);
      const fresh = executions.value.find((e) => !before.has(e.result_id));
      if (fresh) {
        message.success("Results are in.");
        await openReview(fresh.result_id);
        break;
      }
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Run failed");
  } finally {
    runningNew.value = false;
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
      if (r.lead_uuid) {
        return h(
          RouterLink,
          { to: `/contact/${r.lead_uuid}`, class: "ln-link" },
          { default: () => label }
        );
      }
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
    render: (row) => h(NButton, { size: "small", type: "primary", onClick: () => openReview(row.result_id) }, { default: () => "Review" }),
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

      <NCard size="small" title="Find a contact by name" embedded>
        <NSpace vertical size="small" style="width: 100%">
          <NSpace align="center">
            <NInput
              v-model:value="searchName"
              placeholder="full name"
              style="width: 260px"
              @keyup.enter="searchContacts"
            />
            <NButton type="primary" size="small" :loading="searching" @click="searchContacts">Search</NButton>
          </NSpace>

          <NSpace v-if="contactHits.length" size="small" wrap>
            <NButton
              v-for="c in contactHits"
              :key="c.uuid"
              size="small"
              :type="selectedContact?.uuid === c.uuid ? 'primary' : 'default'"
              @click="selectContact(c)"
            >
              {{ c.name }}<span v-if="c.company_name" class="muted"> · {{ c.company_name }}</span>
              <NTag size="tiny" :type="c.execution_count ? 'info' : 'default'" style="margin-left: 6px">
                {{ c.execution_count ? c.execution_count + " runs" : "no runs" }}
              </NTag>
            </NButton>
          </NSpace>

          <div v-if="selectedContact">
            <NSpace align="center" justify="space-between">
              <strong>{{ selectedContact.name }}</strong>
              <NButton type="primary" size="small" :loading="runningNew" @click="runNew">
                Run new research + InMail
              </NButton>
            </NSpace>
            <NSpin :show="execLoading">
              <NSpace v-if="executions.length" vertical size="small" style="margin-top: 8px">
                <div v-for="e in executions" :key="e.result_id" class="exec-row">
                  <NTag size="tiny" :type="e.has_inmail ? 'success' : 'default'">
                    {{ e.has_inmail ? "inmail" : e.pipeline }}
                  </NTag>
                  <span class="muted">{{ fmtDate(e.created_at) }}</span>
                  <span class="muted">{{ e.workflow ? e.workflow.slice(0, 40) : "" }}</span>
                  <NButton size="tiny" @click="openReview(e.result_id)">Use this</NButton>
                </div>
              </NSpace>
              <NText v-else depth="3" style="font-size: 0.85rem">no prior executions for this contact</NText>
            </NSpin>
          </div>
        </NSpace>
      </NCard>

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
.exec-row {
  font-size: 0.8rem;
  display: flex;
  gap: 0.6rem;
  align-items: center;
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
