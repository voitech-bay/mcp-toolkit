<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  NAlert,
  NAvatar,
  NButton,
  NDataTable,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NInput,
  NPagination,
  NSpace,
  NSpin,
  NTag,
  NText,
  useDialog,
  useMessage,
  type DataTableColumns,
} from "naive-ui";
import { ExternalLinkIcon, SendIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";

type Json = Record<string, any>;

interface ChannelSummary {
  total: number;
  approved: number;
  needsReview: number;
  pushed: number;
  latestStatus: string | null;
}

interface StudioLead {
  contact: Json & { uuid: string; display_name: string };
  draftCount: number;
  statusSummary: Record<string, ChannelSummary>;
  latestDraft: Json | null;
}

const store = useProjectStore();
const router = useRouter();
const toast = useMessage();
const dialog = useDialog();

const rows = ref<StudioLead[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(25);
const search = ref("");
const loading = ref(false);
const error = ref("");
const detailOpen = ref(false);
const detailLoading = ref(false);
const detail = ref<Json | null>(null);
const selectedContactId = ref("");
const actionLoading = ref("");

const messages = computed<Json[]>(() => detail.value?.messages ?? []);
const facts = computed<Json[]>(() => detail.value?.facts ?? []);
const marks = computed<Json[]>(() => detail.value?.marks ?? []);
const markKeys = computed(() => new Set(marks.value.filter((m) => m.priority !== false).map((m) => `${m.entity_key}:${m.fact_id}`)));

function humanize(value: string | null | undefined) {
  return String(value || "none").replace(/_/g, " ");
}

function fmt(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "-";
}

function statusType(status: string | null | undefined) {
  if (status === "sent") return "success";
  if (status === "approved") return "info";
  if (["generation_failed", "sending_failed", "rejected"].includes(String(status))) return "error";
  if (["comments_made", "changes_requested", "final_check"].includes(String(status))) return "warning";
  return "default";
}

function channelLabel(channel: string) {
  if (channel === "linkedin_dm") return "LinkedIn";
  if (channel === "linkedin_inmail") return "InMail";
  return "Email";
}

function channelSummary(row: StudioLead, channel: string): ChannelSummary {
  return row.statusSummary?.[channel] ?? { total: 0, approved: 0, needsReview: 0, pushed: 0, latestStatus: null };
}

function renderChannel(row: StudioLead, channel: string) {
  const summary = channelSummary(row, channel);
  if (!summary.total) return h(NText, { depth: 3 }, { default: () => "No drafts" });
  return h("div", { class: "channel-cell" }, [
    h(NTag, { size: "small", type: statusType(summary.latestStatus) as any }, { default: () => humanize(summary.latestStatus) }),
    h("span", { class: "muted" }, `${summary.total} draft${summary.total === 1 ? "" : "s"} · ${summary.approved} approved${summary.pushed ? ` · ${summary.pushed} pushed` : ""}`),
  ]);
}

const columns: DataTableColumns<StudioLead> = [
  {
    title: "Contact",
    key: "contact",
    minWidth: 260,
    render: (row) => h("div", { class: "contact-cell" }, [
      h(NAvatar, { round: true, size: 34, src: row.contact.avatar_url || undefined }, { default: () => row.contact.display_name.charAt(0).toUpperCase() }),
      h("div", [
        h("button", { class: "link-button", onClick: () => openLead(row.contact.uuid) }, row.contact.display_name),
        h("div", { class: "muted" }, row.contact.position || row.contact.work_email || "No role"),
      ]),
    ]),
  },
  { title: "Company", key: "company", minWidth: 210, render: (row) => row.contact.company_name || "-" },
  { title: "Email", key: "email", minWidth: 180, render: (row) => renderChannel(row, "email") },
  { title: "LinkedIn", key: "linkedin", minWidth: 180, render: (row) => renderChannel(row, "linkedin_dm") },
  { title: "InMail", key: "inmail", minWidth: 180, render: (row) => renderChannel(row, "linkedin_inmail") },
  { title: "Latest", key: "latest", width: 170, render: (row) => fmt(row.latestDraft?.updated_at) },
  {
    title: "",
    key: "actions",
    width: 110,
    render: (row) => h(NButton, { size: "small", type: "primary", secondary: true, onClick: () => openLead(row.contact.uuid) }, { default: () => "Open" }),
  },
];

function qs() {
  const q = new URLSearchParams({
    projectId: String(store.selectedProjectId),
    page: String(page.value),
    pageSize: String(pageSize.value),
  });
  if (search.value.trim()) q.set("search", search.value.trim());
  return q;
}

async function load() {
  if (!store.selectedProjectId) return;
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch(`/api/sequence-studio/leads?${qs()}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Could not load Sequence Studio");
    rows.value = j.data ?? [];
    total.value = j.total ?? 0;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Could not load Sequence Studio";
  } finally {
    loading.value = false;
  }
}

async function openLead(contactId: string) {
  if (!store.selectedProjectId) return;
  selectedContactId.value = contactId;
  detailOpen.value = true;
  detailLoading.value = true;
  try {
    const r = await fetch(`/api/sequence-studio/leads/${contactId}?projectId=${store.selectedProjectId}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Could not load lead");
    detail.value = j;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not load lead");
  } finally {
    detailLoading.value = false;
  }
}

async function refreshDetail() {
  if (selectedContactId.value) await openLead(selectedContactId.value);
}

async function markFact(fact: Json, priority: boolean) {
  if (!store.selectedProjectId) return;
  try {
    const r = await fetch("/api/sequence-studio/pov-fact-marks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: store.selectedProjectId,
        entityKey: fact.entityKey,
        factId: fact.id,
        priority,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Could not save mark");
    await refreshDetail();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not save mark");
  }
}

async function previewPush(message: Json) {
  if (!store.selectedProjectId) return;
  actionLoading.value = `preview:${message.id}`;
  try {
    const r = await fetch("/api/sequence-studio/push-linkedin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: store.selectedProjectId, emailId: message.id, dryRun: true }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Preview failed");
    dialog.info({
      title: "GetSales field preview",
      content: () => h("div", { class: "preview-dialog" }, [
        h("p", { class: "muted" }, `Lead ${j.leadUuid} · ${channelLabel(j.channel)}`),
        ...Object.entries(j.fields ?? {}).map(([name, value]) => h("div", { class: "field-preview" }, [
          h("strong", name),
          h("pre", String(value)),
        ])),
        j.warning ? h(NAlert, { type: "warning", showIcon: false }, { default: () => j.warning }) : null,
      ]),
      positiveText: "Close",
    });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Preview failed");
  } finally {
    actionLoading.value = "";
  }
}

async function pushToGetSales(message: Json) {
  if (!store.selectedProjectId) return;
  dialog.warning({
    title: "Push approved draft to GetSales?",
    content: "This writes only lead custom fields in GetSales. It does not send the message.",
    positiveText: "Push",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      actionLoading.value = `push:${message.id}`;
      try {
        const r = await fetch("/api/sequence-studio/push-linkedin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: store.selectedProjectId, emailId: message.id, dryRun: false }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Push failed");
        toast.success("Pushed to GetSales custom fields");
        await refreshDetail();
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Push failed", { duration: 9000 });
      } finally {
        actionLoading.value = "";
      }
    },
  });
}

function openEmailStudio() {
  void router.push("/email-studio");
}

let timer: number | undefined;
watch(search, () => {
  page.value = 1;
  window.clearTimeout(timer);
  timer = window.setTimeout(load, 250);
});
watch([page, pageSize], load);
watch(() => store.selectedProjectId, () => { page.value = 1; void load(); });
onMounted(load);
</script>

<template>
  <div class="sequence-studio">
    <div class="header-row">
      <div>
        <h1>Sequence Studio</h1>
        <p class="muted">Review account sequences across Email, LinkedIn, InMail, POV facts, and GetSales handoff.</p>
      </div>
      <NSpace>
        <NButton secondary @click="openEmailStudio">
          <template #icon><ExternalLinkIcon :size="14" /></template>
          Email Studio
        </NButton>
      </NSpace>
    </div>

    <div class="toolbar">
      <NInput v-model:value="search" clearable placeholder="Search contacts, companies, roles..." />
      <NButton :loading="loading" @click="load">Refresh</NButton>
    </div>

    <NAlert v-if="error" type="error" :show-icon="false" style="margin-bottom: 12px">{{ error }}</NAlert>
    <NSpin :show="loading">
      <NDataTable :columns="columns" :data="rows" :row-key="(row: StudioLead) => row.contact.uuid" :pagination="false" />
      <NEmpty v-if="!loading && rows.length === 0" description="No sequence records found" style="margin-top: 28px" />
    </NSpin>
    <div class="pagination-row">
      <NPagination v-model:page="page" v-model:page-size="pageSize" :item-count="total" show-size-picker :page-sizes="[10,25,50,100]" />
    </div>

    <NDrawer v-model:show="detailOpen" width="min(1180px, 96vw)">
      <NDrawerContent :title="detail?.contact?.display_name || 'Sequence detail'" closable>
        <NSpin :show="detailLoading">
          <template v-if="detail">
            <div class="detail-grid">
              <section class="panel">
                <h3>Drafts</h3>
                <div v-if="messages.length" class="message-list">
                  <article v-for="message in messages" :key="message.id" class="message-item">
                    <div class="message-head">
                      <NSpace align="center">
                        <NTag size="small">{{ channelLabel(message.channel) }}</NTag>
                        <NTag size="small" :type="statusType(message.status)">{{ humanize(message.status) }}</NTag>
                        <span class="muted">Step {{ message.step_number ?? message.sequence_step ?? "-" }}</span>
                      </NSpace>
                      <span class="muted">{{ fmt(message.updated_at) }}</span>
                    </div>
                    <strong v-if="message.current_subject">{{ message.current_subject }}</strong>
                    <pre>{{ message.current_body || "No body yet" }}</pre>
                    <NSpace v-if="['linkedin_dm','linkedin_inmail'].includes(message.channel)" align="center">
                      <NButton size="small" secondary :loading="actionLoading === `preview:${message.id}`" @click="previewPush(message)">
                        Preview fields
                      </NButton>
                      <NButton
                        size="small"
                        type="primary"
                        :disabled="message.status !== 'approved'"
                        :loading="actionLoading === `push:${message.id}`"
                        @click="pushToGetSales(message)"
                      >
                        <template #icon><SendIcon :size="14" /></template>
                        Push to GetSales
                      </NButton>
                      <NTag v-if="message.external_pushed_at" size="small" type="success">Pushed {{ fmt(message.external_pushed_at) }}</NTag>
                    </NSpace>
                  </article>
                </div>
                <NEmpty v-else description="No drafts yet" />
              </section>

              <section class="panel">
                <h3>POV Facts</h3>
                <div v-if="facts.length" class="fact-list">
                  <article v-for="fact in facts" :key="`${fact.entityKey}:${fact.id}`" class="fact-item">
                    <label class="fact-check">
                      <input
                        type="checkbox"
                        :checked="markKeys.has(`${fact.entityKey}:${fact.id}`)"
                        @change="markFact(fact, ($event.target as HTMLInputElement).checked)"
                      />
                      <span>{{ fact.text }}</span>
                    </label>
                    <div class="muted">{{ fact.source }} · {{ fmt(fact.createdAt) }}</div>
                  </article>
                </div>
                <NEmpty v-else description="No POV facts found for this contact or company" />
              </section>
            </div>
          </template>
        </NSpin>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<style scoped>
.sequence-studio{max-width:1760px;margin:auto}
.header-row{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}
.header-row h1{margin:0}
.toolbar{display:grid;grid-template-columns:minmax(260px,520px) auto;gap:10px;align-items:center;margin-bottom:12px}
.muted{opacity:.6;font-size:.86em}
.contact-cell{display:flex;gap:10px;align-items:center}
.link-button{border:0;background:transparent;color:#63a8ff;font-weight:700;padding:0;cursor:pointer}
.link-button:hover{text-decoration:underline}
.channel-cell{display:flex;flex-direction:column;align-items:flex-start;gap:5px}
.pagination-row{display:flex;justify-content:flex-end;margin-top:14px}
.detail-grid{display:grid;grid-template-columns:minmax(420px,1.25fr) minmax(300px,.75fr);gap:14px}
.panel{border:1px solid rgba(128,128,128,.24);border-radius:8px;padding:14px;min-height:200px}
.panel h3{margin-top:0}
.message-list,.fact-list{display:flex;flex-direction:column;gap:10px}
.message-item,.fact-item{border:1px solid rgba(128,128,128,.2);border-radius:8px;padding:12px;background:rgba(128,128,128,.05)}
.message-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px}
pre{white-space:pre-wrap;word-break:break-word;margin:8px 0 10px;font-family:inherit;line-height:1.5}
.fact-check{display:grid;grid-template-columns:18px 1fr;gap:8px;align-items:start;line-height:1.45}
.field-preview{margin:10px 0}
.field-preview pre{padding:8px;border-radius:6px;background:rgba(128,128,128,.12)}
@media(max-width:960px){.header-row,.message-head{flex-direction:column}.toolbar,.detail-grid{grid-template-columns:1fr}}
</style>
