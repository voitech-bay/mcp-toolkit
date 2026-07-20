<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  NAlert,
  NAvatar,
  NButton,
  NCheckbox,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NInput,
  NPagination,
  NSelect,
  NSpace,
  NSpin,
  NTag,
  useDialog,
  useMessage,
} from "naive-ui";
import { ChevronDownIcon, ChevronRightIcon, ExternalLinkIcon, MailIcon, SendIcon, StarIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";
import { useWorkflowLaunch } from "../composables/useWorkflowLaunch";
import { plaintextParagraphs } from "../utils/htmlPlaintext";

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
  persona?: string | null;
  fit_score?: number | null;
  contact_key?: string | null;
}

interface StudioScope {
  companyId: string;
  companyName: string | null;
  eligible: boolean;
  eligibleCount: number | null;
}

const store = useProjectStore();
const route = useRoute();
const router = useRouter();
const toast = useMessage();
const dialog = useDialog();
const { launching, loadWorkflows, launch: launchWorkflow } = useWorkflowLaunch();

const rows = ref<StudioLead[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(25);
const search = ref("");
const companySearch = ref("");
const companyIdFilter = ref("");
const eligibleOnly = ref(false);
const scope = ref<StudioScope | null>(null);
const selectedIds = ref<string[]>([]);
const statusFilter = ref<string[]>([]);
const channelFilter = ref<string[]>([]);
const draftState = ref("all");
const sendState = ref("all");
const campaignFilter = ref("");
const batchFilter = ref("");
const sequenceIdFilter = ref("");
const hypothesisIdFilter = ref("");
const createdFrom = ref("");
const createdTo = ref("");
const sentFrom = ref("");
const sentTo = ref("");
const sortBy = ref("latest_draft");
const sortDir = ref("desc");
const loading = ref(false);
const error = ref("");
const detailOpen = ref(false);
const detailLoading = ref(false);
const detail = ref<Json | null>(null);
const selectedContactId = ref("");
const actionLoading = ref("");
const expandedIds = ref<Set<string>>(new Set());
const factComments = ref<Record<string, string>>({});

const allSelectedOnPage = computed(
  () => rows.value.length > 0 && rows.value.every((row) => selectedIds.value.includes(row.contact.uuid))
);
const selectedCount = computed(() => selectedIds.value.length);

const messages = computed<Json[]>(() => detail.value?.messages ?? []);
const facts = computed<Json[]>(() => detail.value?.facts ?? []);
const marks = computed<Json[]>(() => detail.value?.marks ?? []);
const markKeys = computed(() => new Set(marks.value.filter((m) => m.priority !== false).map((m) => `${m.entity_key}:${m.fact_id}`)));
const statusOptions = [
  "needs_attention",
  "research_ready",
  "ai_draft_made",
  "needs_review",
  "comments_made",
  "regenerated",
  "final_check",
  "approved",
  "sent",
  "research_missing",
  "generation_failed",
  "changes_requested",
  "rejected",
  "sending_failed",
].map((value) => ({ label: humanize(value), value }));
const channelOptions = [
  { label: "Email", value: "email" },
  { label: "LinkedIn", value: "linkedin_dm" },
  { label: "InMail", value: "linkedin_inmail" },
  { label: "Replies", value: "reply" },
];
const draftStateOptions = [
  { label: "All", value: "all" },
  { label: "Has drafts", value: "has_drafts" },
  { label: "No drafts", value: "no_drafts" },
  { label: "Needs attention", value: "needs_attention" },
  { label: "Approved", value: "approved" },
  { label: "Sent", value: "sent" },
];
const sendStateOptions = [
  { label: "All", value: "all" },
  { label: "Sent", value: "sent" },
  { label: "Unsent", value: "unsent" },
  { label: "Pushed to GetSales", value: "pushed" },
  { label: "Not pushed", value: "not_pushed" },
];
const sortOptions = [
  { label: "Latest draft activity", value: "latest_draft" },
  { label: "Contact created", value: "contact_created" },
  { label: "Contact name", value: "contact_name" },
  { label: "Company name", value: "company_name" },
  { label: "Email created", value: "email_created" },
  { label: "Sent date", value: "sent_at" },
];
const sortDirOptions = [
  { label: "Newest / Z-A", value: "desc" },
  { label: "Oldest / A-Z", value: "asc" },
];

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

function approvedLinkedInCount(row: StudioLead) {
  return (row.messages ?? []).filter((message) => ["linkedin_dm", "linkedin_inmail"].includes(String(message.channel)) && message.status === "approved").length;
}

function detailApprovedLinkedInCount() {
  return messages.value.filter((message) => ["linkedin_dm", "linkedin_inmail"].includes(String(message.channel)) && message.status === "approved").length;
}

function messageTitle(message: Json) {
  const channel = channelLabel(String(message.channel));
  const step = message.step_number ?? message.sequence_step ?? "-";
  return `${channel} ${step}`;
}

function messageParagraphs(value: unknown): string[] {
  const paragraphs = plaintextParagraphs(value);
  return paragraphs.length ? paragraphs : ["No body yet"];
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
  const next = new Set<string>();
  if (!expandedIds.value.has(row.contact.uuid)) next.add(row.contact.uuid);
  expandedIds.value = next;
  if (next.has(row.contact.uuid)) await openLead(row.contact.uuid, false);
}

function rowFacts(row: StudioLead): Json[] {
  return selectedContactId.value === row.contact.uuid ? facts.value : [];
}

function rowFactMarked(row: StudioLead, fact: Json): boolean {
  if (selectedContactId.value !== row.contact.uuid) return false;
  return markKeys.value.has(`${fact.entityKey}:${fact.id}`);
}

function qs() {
  const q = new URLSearchParams({
    projectId: String(store.selectedProjectId),
    page: String(page.value),
    pageSize: String(pageSize.value),
    draftState: draftState.value,
    sendState: sendState.value,
    sortBy: sortBy.value,
    sortDir: sortDir.value,
  });
  if (search.value.trim()) q.set("search", search.value.trim());
  if (companySearch.value.trim()) q.set("company", companySearch.value.trim());
  if (companyIdFilter.value.trim()) q.set("companyId", companyIdFilter.value.trim());
  if (eligibleOnly.value) q.set("eligible", "1");
  if (statusFilter.value.length) q.set("status", statusFilter.value.join(","));
  if (channelFilter.value.length) q.set("channel", channelFilter.value.join(","));
  if (campaignFilter.value.trim()) q.set("campaign", campaignFilter.value.trim());
  if (batchFilter.value.trim()) q.set("batch", batchFilter.value.trim());
  if (sequenceIdFilter.value.trim()) q.set("sequenceId", sequenceIdFilter.value.trim());
  if (hypothesisIdFilter.value.trim()) q.set("hypothesisId", hypothesisIdFilter.value.trim());
  if (createdFrom.value.trim()) q.set("createdFrom", createdFrom.value.trim());
  if (createdTo.value.trim()) q.set("createdTo", createdTo.value.trim());
  if (sentFrom.value.trim()) q.set("sentFrom", sentFrom.value.trim());
  if (sentTo.value.trim()) q.set("sentTo", sentTo.value.trim());
  return q;
}

function applyRouteQuery() {
  const q = route.query;
  const companyId = String(q.companyId ?? "").trim();
  const eligible = q.eligible === "1" || q.eligible === "true";
  const projectId = String(q.projectId ?? "").trim();
  if (projectId && projectId !== store.selectedProjectId) {
    store.selectProject(projectId);
  }
  companyIdFilter.value = companyId;
  eligibleOnly.value = eligible && Boolean(companyId);
}

function clearCompanyScope() {
  companyIdFilter.value = "";
  eligibleOnly.value = false;
  scope.value = null;
  selectedIds.value = [];
  const nextQuery = { ...route.query };
  delete nextQuery.companyId;
  delete nextQuery.eligible;
  void router.replace({ path: "/sequence-studio", query: nextQuery });
  page.value = 1;
  void load();
}

function toggleSelected(id: string, checked: boolean) {
  if (checked) {
    if (!selectedIds.value.includes(id)) selectedIds.value = [...selectedIds.value, id];
    return;
  }
  selectedIds.value = selectedIds.value.filter((x) => x !== id);
}

function toggleSelectAllOnPage(checked: boolean) {
  const pageIds = rows.value.map((row) => row.contact.uuid);
  if (checked) {
    selectedIds.value = [...new Set([...selectedIds.value, ...pageIds])];
    return;
  }
  const drop = new Set(pageIds);
  selectedIds.value = selectedIds.value.filter((id) => !drop.has(id));
}

function generateSequences() {
  const leadUuids = [...selectedIds.value];
  if (!leadUuids.length) {
    toast.warning("Select at least one contact");
    return;
  }
  dialog.warning({
    title: "Generate sequences",
    content: `Launch Velvetech messaging (n8n) for ${leadUuids.length} selected contact${leadUuids.length === 1 ? "" : "s"}? Full multi-step sequences will be composed and ingested into Email Studio when complete.`,
    positiveText: "Generate",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      const launchId = await launchWorkflow("velvetech_messaging", leadUuids, {
        successMessage: `Proactive sequence started for ${leadUuids.length} contact${leadUuids.length === 1 ? "" : "s"}. Results will ingest into Email Studio when n8n completes.`,
      });
      if (launchId) selectedIds.value = [];
    },
  });
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
    scope.value = j.scope ?? null;
    const visible = new Set(rows.value.map((row) => row.contact.uuid));
    selectedIds.value = selectedIds.value.filter((id) => visible.has(id));
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

async function refreshDetail(openDrawer = detailOpen.value) {
  if (selectedContactId.value) await openLead(selectedContactId.value, openDrawer);
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

async function previewSequencePush(contactId: string) {
  if (!store.selectedProjectId) return;
  actionLoading.value = `preview-sequence:${contactId}`;
  try {
    const r = await fetch("/api/sequence-studio/push-linkedin-sequence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: store.selectedProjectId, contactId, dryRun: true }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Preview failed");
    dialog.info({
      title: "GetSales sequence field preview",
      content: () => h("div", { class: "preview-dialog" }, [
        h("p", { class: "muted" }, `Lead ${j.leadUuid} · ${Object.keys(j.fields ?? {}).length} field${Object.keys(j.fields ?? {}).length === 1 ? "" : "s"}`),
        ...Object.entries(j.fields ?? {}).map(([name, value]) => h("div", { class: "field-preview" }, [
          h("strong", name),
          h("pre", String(value)),
        ])),
        ...(j.warnings ?? []).map((warning: string) => h(NAlert, { type: "warning", showIcon: false }, { default: () => warning })),
      ]),
      positiveText: "Close",
    });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Preview failed");
  } finally {
    actionLoading.value = "";
  }
}

async function pushSequenceToGetSales(contactId: string) {
  if (!store.selectedProjectId) return;
  dialog.warning({
    title: "Push approved sequence to GetSales?",
    content: "This writes all approved LinkedIn and InMail drafts for this contact to GetSales custom fields. It does not send messages.",
    positiveText: "Push sequence",
    negativeText: "Cancel",
    onPositiveClick: async () => {
      actionLoading.value = `push-sequence:${contactId}`;
      try {
        const r = await fetch("/api/sequence-studio/push-linkedin-sequence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: store.selectedProjectId, contactId, dryRun: false }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Push failed");
        toast.success(`Pushed ${j.updatedDrafts ?? 0} approved draft${j.updatedDrafts === 1 ? "" : "s"} to GetSales`);
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
watch([search, companySearch, statusFilter, channelFilter, draftState, sendState, campaignFilter, batchFilter, sequenceIdFilter, hypothesisIdFilter, createdFrom, createdTo, sentFrom, sentTo, sortBy, sortDir], () => {
  page.value = 1;
  window.clearTimeout(timer);
  timer = window.setTimeout(load, 250);
});
watch([page, pageSize], load);
watch(() => store.selectedProjectId, () => { page.value = 1; selectedIds.value = []; void loadWorkflows(); void load(); });
watch(
  () => [route.query.companyId, route.query.eligible, route.query.projectId],
  () => {
    applyRouteQuery();
    page.value = 1;
    selectedIds.value = [];
    void load();
  }
);
watch(marks, seedFactComments);
onMounted(async () => {
  applyRouteQuery();
  await loadWorkflows();
  await load();
});
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

    <NAlert
      v-if="scope?.companyId"
      type="info"
      :show-icon="false"
      style="margin-bottom: 12px"
    >
      <div class="scope-banner">
        <div>
          <strong>{{ scope.companyName || "Company" }}</strong>
          <span class="muted">
            ·
            {{
              scope.eligible
                ? "Eligible contacts from research"
                : "Company contacts"
            }}
            <template v-if="scope.eligible && scope.eligibleCount != null">
              ({{ scope.eligibleCount }})
            </template>
          </span>
        </div>
        <NButton size="tiny" quaternary @click="clearCompanyScope">Clear filter</NButton>
      </div>
    </NAlert>

    <div class="toolbar">
      <NInput v-model:value="search" clearable placeholder="Contact, role, email..." />
      <NInput v-model:value="companySearch" clearable placeholder="Company" :disabled="Boolean(companyIdFilter)" />
      <NSelect v-model:value="statusFilter" multiple clearable filterable :options="statusOptions" placeholder="Statuses" />
      <NSelect v-model:value="channelFilter" multiple clearable :options="channelOptions" placeholder="Channels" />
      <NSelect v-model:value="draftState" :options="draftStateOptions" placeholder="Draft state" />
      <NSelect v-model:value="sendState" :options="sendStateOptions" placeholder="Send/push state" />
      <NInput v-model:value="campaignFilter" clearable placeholder="Campaign / flow" />
      <NInput v-model:value="batchFilter" clearable placeholder="Batch / launch" />
      <NInput v-model:value="sequenceIdFilter" clearable placeholder="Sequence ID" />
      <NInput v-model:value="hypothesisIdFilter" clearable placeholder="Hypothesis ID" />
      <NInput v-model:value="createdFrom" clearable placeholder="Created from YYYY-MM-DD" />
      <NInput v-model:value="createdTo" clearable placeholder="Created to YYYY-MM-DD" />
      <NInput v-model:value="sentFrom" clearable placeholder="Sent from YYYY-MM-DD" />
      <NInput v-model:value="sentTo" clearable placeholder="Sent to YYYY-MM-DD" />
      <NSelect v-model:value="sortBy" :options="sortOptions" placeholder="Sort by" />
      <NSelect v-model:value="sortDir" :options="sortDirOptions" placeholder="Direction" />
      <NButton :loading="loading" @click="load">Refresh</NButton>
    </div>

    <div v-if="rows.length || selectedCount" class="bulk-bar">
      <NCheckbox
        :checked="allSelectedOnPage"
        :indeterminate="selectedCount > 0 && !allSelectedOnPage"
        @update:checked="toggleSelectAllOnPage"
      >
        Select page
      </NCheckbox>
      <span class="muted">{{ selectedCount }} selected</span>
      <NButton
        type="primary"
        size="small"
        :disabled="!selectedCount"
        :loading="launching"
        @click="generateSequences"
      >
        Generate sequences (n8n)
      </NButton>
    </div>

    <NAlert v-if="error" type="error" :show-icon="false" style="margin-bottom: 12px">{{ error }}</NAlert>
    <NSpin :show="loading">
      <div v-if="rows.length" class="lead-stack">
        <article v-for="row in rows" :key="row.contact.uuid" class="lead-card">
          <header class="lead-header">
            <NCheckbox
              :checked="selectedIds.includes(row.contact.uuid)"
              @update:checked="(v: boolean) => toggleSelected(row.contact.uuid, v)"
              @click.stop
            />
            <button class="expand-button" @click="toggleLead(row)">
              <ChevronDownIcon v-if="isExpanded(row.contact.uuid)" :size="16" />
              <ChevronRightIcon v-else :size="16" />
            </button>
            <NAvatar round :size="38" :src="row.contact.avatar_url || undefined">
              {{ row.contact.display_name.charAt(0).toUpperCase() }}
            </NAvatar>
            <div class="lead-title">
              <button class="link-button" @click="toggleLead(row)">{{ row.contact.display_name }}</button>
              <div class="muted">
                {{ row.contact.position || "No role" }} · {{ row.contact.company_name || "No company" }}
                <template v-if="row.persona"> · {{ humanize(row.persona) }}</template>
                <template v-if="row.fit_score != null"> · fit {{ row.fit_score }}</template>
              </div>
            </div>
            <div class="channel-pills">
              <div v-for="pill in ['email','linkedin_dm','linkedin_inmail'].map((channel) => renderChannelPill(row, channel))" :key="pill.channel" class="channel-pill" :class="{ empty: pill.empty }">
                <span class="pill-label">{{ pill.label }}</span>
                <NTag v-if="!pill.empty" size="tiny" :type="statusType(pill.summary.latestStatus)">{{ humanize(pill.summary.latestStatus) }}</NTag>
                <span v-else class="muted">empty</span>
                <span v-if="!pill.empty" class="muted">{{ pill.summary.total }} draft{{ pill.summary.total === 1 ? "" : "s" }}{{ pill.summary.pushed ? ` · ${pill.summary.pushed} pushed` : "" }}</span>
              </div>
            </div>
            <NSpace size="small">
              <NButton
                size="small"
                secondary
                :disabled="!approvedLinkedInCount(row)"
                :loading="actionLoading === `preview-sequence:${row.contact.uuid}`"
                @click="previewSequencePush(row.contact.uuid)"
              >
                Preview sync
              </NButton>
              <NButton
                size="small"
                type="primary"
                :disabled="!approvedLinkedInCount(row)"
                :loading="actionLoading === `push-sequence:${row.contact.uuid}`"
                @click="pushSequenceToGetSales(row.contact.uuid)"
              >
                Sync sequence
              </NButton>
              <NButton size="small" secondary @click="openLead(row.contact.uuid)">Studio</NButton>
            </NSpace>
          </header>

          <div v-if="isExpanded(row.contact.uuid)" class="lead-expanded">
            <div class="tracks-grid">
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

            <aside class="pov-side-panel">
              <div class="pov-head">
                <span>POV points</span>
                <span class="muted">Use while reviewing copy</span>
              </div>
              <NSpin :show="detailLoading && selectedContactId === row.contact.uuid">
                <div v-if="rowFacts(row).length" class="side-fact-list">
                  <article v-for="fact in rowFacts(row)" :key="`${fact.entityKey}:${fact.id}`" class="side-fact">
                    <div class="side-fact-main">
                      <NButton
                        circle
                        size="small"
                        :type="rowFactMarked(row, fact) ? 'warning' : 'default'"
                        @click="markFact(fact, !rowFactMarked(row, fact))"
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
                      @blur="rowFactMarked(row, fact) && markFact(fact, true)"
                    />
                    <div class="muted">{{ fact.source }} · {{ fmt(fact.createdAt) }}</div>
                  </article>
                </div>
                <NEmpty v-else size="small" description="No POV points for this lead/company yet" />
              </NSpin>
            </aside>
          </div>
        </article>
      </div>
      <NEmpty
        v-if="!loading && rows.length === 0"
        :description="
          scope?.eligible
            ? 'No eligible contacts resolved for this company (POV fit contacts not linked in CRM)'
            : 'No sequence records found'
        "
        style="margin-top: 28px"
      />
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
                <div class="panel-head">
                  <h3>Drafts</h3>
                  <NSpace size="small">
                    <NButton
                      size="small"
                      secondary
                      :disabled="!detailApprovedLinkedInCount() || !detail?.contact?.uuid"
                      :loading="actionLoading === `preview-sequence:${detail?.contact?.uuid}`"
                      @click="detail?.contact?.uuid && previewSequencePush(detail.contact.uuid)"
                    >
                      Preview sync
                    </NButton>
                    <NButton
                      size="small"
                      type="primary"
                      :disabled="!detailApprovedLinkedInCount() || !detail?.contact?.uuid"
                      :loading="actionLoading === `push-sequence:${detail?.contact?.uuid}`"
                      @click="detail?.contact?.uuid && pushSequenceToGetSales(detail.contact.uuid)"
                    >
                      <template #icon><SendIcon :size="14" /></template>
                      Sync approved sequence
                    </NButton>
                  </NSpace>
                </div>
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
.sequence-studio{max-width:1760px;margin:auto;color:#f8fafc}
.header-row{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}
.header-row h1{margin:0}
.toolbar{display:grid;grid-template-columns:repeat(6,minmax(150px,1fr)) auto;gap:10px;align-items:center;margin-bottom:12px}
.toolbar :deep(.n-input),.toolbar :deep(.n-base-selection){min-height:34px}
.scope-banner{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.bulk-bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;border:1px solid rgba(148,163,184,.25);border-radius:10px;background:rgba(15,23,42,.45);position:sticky;top:0;z-index:2}
.muted{color:#cbd5e1;font-size:.86em}
.lead-stack{display:flex;flex-direction:column;gap:10px}
.lead-card{border:1px solid #334155;border-radius:8px;background:#111827;overflow:hidden}
.lead-header{display:grid;grid-template-columns:22px 28px 38px minmax(180px,1fr) minmax(280px,1.4fr) auto;gap:10px;align-items:center;padding:12px}
.expand-button,.link-button,.message-title{border:0;background:transparent;color:#93c5fd;padding:0;cursor:pointer}
.expand-button{display:flex;align-items:center;justify-content:center;color:inherit}
.link-button{font-weight:700;text-align:left}
.link-button:hover,.message-title:hover{text-decoration:underline}
.lead-title{min-width:0}
.channel-pills{display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:8px}
.channel-pill{border:1px solid #475569;border-radius:8px;padding:7px 9px;display:flex;align-items:center;gap:7px;min-height:38px;background:#1f2937;color:#f8fafc}
.channel-pill.empty{background:#172033;color:#cbd5e1}
.pill-label{font-weight:700;font-size:.88em}
.lead-expanded{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,380px);gap:12px;padding:0 12px 12px}
.tracks-grid{display:grid;grid-template-columns:repeat(3,minmax(230px,1fr));gap:10px;min-width:0}
.track{border-top:1px solid #475569;padding-top:10px;min-width:0}
.track-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:700}
.track-messages{display:flex;flex-direction:column;gap:8px}
.message-preview{border:1px solid #475569;border-radius:8px;padding:10px;background:#0f172a;color:#f8fafc}
.message-title{display:inline-flex;align-items:center;gap:6px;font-weight:700;margin-right:8px}
.subject{font-weight:700;margin-top:8px;color:#ffffff}
.message-body{margin-top:8px;color:#e5e7eb}
.message-body p{white-space:pre-line;line-height:1.52;margin:0 0 10px;word-break:break-word}
.message-body p:last-child{margin-bottom:0}
.message-body.full{border:1px solid #475569;border-radius:8px;padding:12px;background:#0f172a}
.pov-side-panel{border:1px solid #475569;border-radius:8px;background:#0b1220;padding:12px;min-height:180px}
.pov-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-weight:800;margin-bottom:10px}
.side-fact-list{display:flex;flex-direction:column;gap:9px;max-height:620px;overflow:auto;padding-right:2px}
.side-fact{border:1px solid #334155;border-radius:8px;background:#111827;padding:10px;color:#f8fafc}
.side-fact-main{display:grid;grid-template-columns:32px 1fr;gap:9px;align-items:start;line-height:1.45;margin-bottom:8px}
.pagination-row{display:flex;justify-content:flex-end;margin-top:14px}
.detail-grid{display:grid;grid-template-columns:minmax(420px,1.25fr) minmax(300px,.75fr);gap:14px}
.panel{border:1px solid rgba(128,128,128,.24);border-radius:8px;padding:14px;min-height:200px}
.panel h3{margin-top:0}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.panel-head h3{margin:0}
.message-list,.fact-list{display:flex;flex-direction:column;gap:10px}
.message-item,.fact-item{border:1px solid rgba(128,128,128,.2);border-radius:8px;padding:12px;background:rgba(128,128,128,.05)}
.message-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px}
.fact-row{display:grid;grid-template-columns:32px 1fr;gap:9px;align-items:start;line-height:1.45;margin-bottom:8px}
.field-preview{margin:10px 0}
.field-preview pre{white-space:pre-wrap;word-break:break-word;padding:8px;border-radius:6px;background:rgba(128,128,128,.12)}
@media(max-width:1400px){.toolbar{grid-template-columns:repeat(4,minmax(150px,1fr)) auto}.lead-header{grid-template-columns:22px 28px 38px minmax(160px,1fr) auto}.channel-pills{grid-column:1/-1}}
@media(max-width:1280px){.tracks-grid{grid-template-columns:1fr}.lead-expanded{grid-template-columns:1fr}.side-fact-list{max-height:none}}
@media(max-width:1180px){.lead-header{grid-template-columns:22px 28px 38px minmax(160px,1fr) auto}.tracks-grid{grid-template-columns:1fr}}
@media(max-width:960px){.header-row,.message-head{flex-direction:column}.toolbar,.detail-grid{grid-template-columns:1fr}.lead-header{grid-template-columns:22px 28px 38px 1fr}.lead-header>.n-button{grid-column:1/-1}.channel-pills{grid-template-columns:1fr}}
</style>
