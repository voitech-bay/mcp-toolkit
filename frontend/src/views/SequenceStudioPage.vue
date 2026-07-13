<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  NAlert,
  NAvatar,
  NButton,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NInput,
  NPagination,
  NSpace,
  NSpin,
  NTag,
  useDialog,
  useMessage,
} from "naive-ui";
import { ChevronDownIcon, ChevronRightIcon, ExternalLinkIcon, MailIcon, SendIcon, StarIcon } from "lucide-vue-next";
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
  messages: Json[];
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
const expandedIds = ref<Set<string>>(new Set());
const factComments = ref<Record<string, string>>({});

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

function channelMessages(row: StudioLead, channel: string) {
  return (row.messages ?? []).filter((message) => String(message.channel) === channel);
}

function messageTitle(message: Json) {
  const channel = channelLabel(String(message.channel));
  const step = message.step_number ?? message.sequence_step ?? "-";
  return `${channel} ${step}`;
}

function normalizeBody(value: unknown): string {
  return String(value ?? "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li)\s*>/gi, "\n\n")
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function messageParagraphs(value: unknown): string[] {
  const normalized = normalizeBody(value);
  if (!normalized) return ["No body yet"];
  return normalized.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

function renderChannelPill(row: StudioLead, channel: string) {
  const summary = channelSummary(row, channel);
  const label = channelLabel(channel);
  return {
    channel,
    label,
    summary,
    empty: summary.total === 0,
  };
}

function isExpanded(id: string) {
  return expandedIds.value.has(id);
}

async function toggleLead(row: StudioLead) {
  const next = new Set(expandedIds.value);
  if (next.has(row.contact.uuid)) next.delete(row.contact.uuid);
  else next.add(row.contact.uuid);
  expandedIds.value = next;
  if (next.has(row.contact.uuid)) await openLead(row.contact.uuid, false);
}

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

async function openLead(contactId: string, openDrawer = true) {
  if (!store.selectedProjectId) return;
  selectedContactId.value = contactId;
  if (openDrawer) detailOpen.value = true;
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
        comment: factComments.value[`${fact.entityKey}:${fact.id}`] ?? "",
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Could not save mark");
    await refreshDetail();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not save mark");
  }
}

function seedFactComments() {
  const byKey: Record<string, string> = {};
  for (const mark of marks.value) byKey[`${mark.entity_key}:${mark.fact_id}`] = mark.comment ?? "";
  factComments.value = byKey;
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

function openEmailMessage(message: Json) {
  void router.push({ path: "/email-studio", query: { emailId: String(message.id), projectId: String(store.selectedProjectId ?? "") } });
}

let timer: number | undefined;
watch(search, () => {
  page.value = 1;
  window.clearTimeout(timer);
  timer = window.setTimeout(load, 250);
});
watch([page, pageSize], load);
watch(() => store.selectedProjectId, () => { page.value = 1; void load(); });
watch(marks, seedFactComments);
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
      <div v-if="rows.length" class="lead-stack">
        <article v-for="row in rows" :key="row.contact.uuid" class="lead-card">
          <header class="lead-header">
            <button class="expand-button" @click="toggleLead(row)">
              <ChevronDownIcon v-if="isExpanded(row.contact.uuid)" :size="16" />
              <ChevronRightIcon v-else :size="16" />
            </button>
            <NAvatar round :size="38" :src="row.contact.avatar_url || undefined">
              {{ row.contact.display_name.charAt(0).toUpperCase() }}
            </NAvatar>
            <div class="lead-title">
              <button class="link-button" @click="toggleLead(row)">{{ row.contact.display_name }}</button>
              <div class="muted">{{ row.contact.position || "No role" }} · {{ row.contact.company_name || "No company" }}</div>
            </div>
            <div class="channel-pills">
              <div v-for="pill in ['email','linkedin_dm','linkedin_inmail'].map((channel) => renderChannelPill(row, channel))" :key="pill.channel" class="channel-pill" :class="{ empty: pill.empty }">
                <span class="pill-label">{{ pill.label }}</span>
                <NTag v-if="!pill.empty" size="tiny" :type="statusType(pill.summary.latestStatus)">{{ humanize(pill.summary.latestStatus) }}</NTag>
                <span v-else class="muted">empty</span>
                <span v-if="!pill.empty" class="muted">{{ pill.summary.total }} draft{{ pill.summary.total === 1 ? "" : "s" }}{{ pill.summary.pushed ? ` · ${pill.summary.pushed} pushed` : "" }}</span>
              </div>
            </div>
            <NButton size="small" secondary @click="openLead(row.contact.uuid)">Studio</NButton>
          </header>

          <div v-if="isExpanded(row.contact.uuid)" class="lead-expanded">
            <section v-for="channel in ['email','linkedin_dm','linkedin_inmail']" :key="channel" class="track">
              <div class="track-head">
                <span>{{ channelLabel(channel) }}</span>
                <span class="muted">{{ channelMessages(row, channel).length }} step{{ channelMessages(row, channel).length === 1 ? "" : "s" }}</span>
              </div>
              <div v-if="channelMessages(row, channel).length" class="track-messages">
                <article v-for="message in channelMessages(row, channel)" :key="message.id" class="message-preview">
                  <button class="message-title" @click="openEmailMessage(message)">
                    <MailIcon :size="14" />
                    {{ messageTitle(message) }}
                  </button>
                  <NTag size="tiny" :type="statusType(message.status)">{{ humanize(message.status) }}</NTag>
                  <div v-if="message.current_subject" class="subject">{{ message.current_subject }}</div>
                  <div class="message-body">
                    <p v-for="(paragraph, index) in messageParagraphs(message.current_body)" :key="index">{{ paragraph }}</p>
                  </div>
                  <NSpace v-if="['linkedin_dm','linkedin_inmail'].includes(message.channel)" size="small">
                    <NButton size="tiny" secondary :loading="actionLoading === `preview:${message.id}`" @click="previewPush(message)">Preview fields</NButton>
                    <NButton size="tiny" type="primary" :disabled="message.status !== 'approved'" :loading="actionLoading === `push:${message.id}`" @click="pushToGetSales(message)">Push</NButton>
                    <NTag v-if="message.external_pushed_at" size="tiny" type="success">Pushed</NTag>
                  </NSpace>
                </article>
              </div>
              <NEmpty v-else size="small" description="No drafts" />
            </section>
          </div>
        </article>
      </div>
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
                    <div class="message-body full">
                      <p v-for="(paragraph, index) in messageParagraphs(message.current_body)" :key="index">{{ paragraph }}</p>
                    </div>
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
                    <div class="fact-row">
                      <NButton
                        circle
                        size="small"
                        :type="markKeys.has(`${fact.entityKey}:${fact.id}`) ? 'warning' : 'default'"
                        @click="markFact(fact, !markKeys.has(`${fact.entityKey}:${fact.id}`))"
                      >
                        <template #icon><StarIcon :size="14" /></template>
                      </NButton>
                      <span>{{ fact.text }}</span>
                    </div>
                    <NInput
                      v-model:value="factComments[`${fact.entityKey}:${fact.id}`]"
                      size="small"
                      type="textarea"
                      :autosize="{ minRows: 1, maxRows: 3 }"
                      placeholder="Comment for this fact"
                      @blur="markKeys.has(`${fact.entityKey}:${fact.id}`) && markFact(fact, true)"
                    />
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
.muted{opacity:.62;font-size:.86em}
.lead-stack{display:flex;flex-direction:column;gap:10px}
.lead-card{border:1px solid rgba(148,163,184,.24);border-radius:8px;background:rgba(15,23,42,.24);overflow:hidden}
.lead-header{display:grid;grid-template-columns:28px 38px minmax(210px,1fr) minmax(420px,1.6fr) auto;gap:10px;align-items:center;padding:12px}
.expand-button,.link-button,.message-title{border:0;background:transparent;color:#7db7ff;padding:0;cursor:pointer}
.expand-button{display:flex;align-items:center;justify-content:center;color:inherit}
.link-button{font-weight:700;text-align:left}
.link-button:hover,.message-title:hover{text-decoration:underline}
.lead-title{min-width:0}
.channel-pills{display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:8px}
.channel-pill{border:1px solid rgba(148,163,184,.22);border-radius:8px;padding:7px 9px;display:flex;align-items:center;gap:7px;min-height:38px;background:rgba(148,163,184,.08)}
.channel-pill.empty{opacity:.58}
.pill-label{font-weight:700;font-size:.88em}
.lead-expanded{display:grid;grid-template-columns:repeat(3,minmax(260px,1fr));gap:10px;padding:0 12px 12px}
.track{border-top:1px solid rgba(148,163,184,.18);padding-top:10px;min-width:0}
.track-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:700}
.track-messages{display:flex;flex-direction:column;gap:8px}
.message-preview{border:1px solid rgba(148,163,184,.2);border-radius:8px;padding:10px;background:rgba(2,6,23,.2)}
.message-title{display:inline-flex;align-items:center;gap:6px;font-weight:700;margin-right:8px}
.subject{font-weight:700;margin-top:8px}
.message-body{margin-top:8px;color:rgba(241,245,249,.9)}
.message-body p{white-space:pre-line;line-height:1.52;margin:0 0 10px;word-break:break-word}
.message-body p:last-child{margin-bottom:0}
.message-body.full{border:1px solid rgba(148,163,184,.18);border-radius:8px;padding:12px;background:rgba(2,6,23,.16)}
.pagination-row{display:flex;justify-content:flex-end;margin-top:14px}
.detail-grid{display:grid;grid-template-columns:minmax(420px,1.25fr) minmax(300px,.75fr);gap:14px}
.panel{border:1px solid rgba(128,128,128,.24);border-radius:8px;padding:14px;min-height:200px}
.panel h3{margin-top:0}
.message-list,.fact-list{display:flex;flex-direction:column;gap:10px}
.message-item,.fact-item{border:1px solid rgba(128,128,128,.2);border-radius:8px;padding:12px;background:rgba(128,128,128,.05)}
.message-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px}
.fact-row{display:grid;grid-template-columns:32px 1fr;gap:9px;align-items:start;line-height:1.45;margin-bottom:8px}
.field-preview{margin:10px 0}
.field-preview pre{white-space:pre-wrap;word-break:break-word;padding:8px;border-radius:6px;background:rgba(128,128,128,.12)}
@media(max-width:1180px){.lead-header{grid-template-columns:28px 38px minmax(180px,1fr) auto}.channel-pills{grid-column:1/-1}.lead-expanded{grid-template-columns:1fr}}
@media(max-width:960px){.header-row,.message-head{flex-direction:column}.toolbar,.detail-grid{grid-template-columns:1fr}.lead-header{grid-template-columns:28px 38px 1fr}.lead-header>.n-button{grid-column:1/-1}.channel-pills{grid-template-columns:1fr}}
</style>
