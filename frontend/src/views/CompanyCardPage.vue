<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  NCard,
  NSpace,
  NTag,
  NAlert,
  NSpin,
  NButton,
  NCollapse,
  NCollapseItem,
  NInput,
  NSelect,
  NText,
  NDivider,
  NDrawer,
  NDrawerContent,
  NDataTable,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { h } from "vue";
import { RouterLink } from "vue-router";

type Json = Record<string, unknown>;

interface Activity {
  thread_count: number;
  inbox_count: number;
  outbox_count: number;
  last_message_at: string | null;
  reply_status: string;
}
interface RosterRow extends Json {
  uuid: string;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  headline?: string | null;
  work_email?: string | null;
  email_status?: string | null;
  lead_category?: string | null;
  priority?: string | null;
  connection_status: "accepted" | "sent" | "withdrawn" | "none";
  activity: Activity | null;
}
interface Thread {
  conversation_uuid: string;
  lead_uuid: string | null;
  message_count: number;
  inbox_count: number;
  last_message_at: string | null;
  last_message_text: string | null;
  reply_status: string;
  messages: Array<{ text: string | null; type: string | null; sent_at: string | null; subject?: string | null; sender_profile_uuid?: string | null; sender_display_name?: string | null; channel_label?: string }>;
}
interface SummaryEntry {
  generated_at: string;
  message_watermark: number;
  model: string;
  data: {
    account_summary?: string;
    per_contact?: Array<{ name?: string; key_points?: string[]; stance?: string }>;
    suggested_next_step?: string;
  };
}
interface ListRecord extends Json {
  uuid: string;
  name: string;
  linkedin_url: string | null;
  position: string | null;
  location: string | null;
  email: string | null;
  email_status: string | null;
  company_hq: string | null;
  employee_count: number | null;
  company_type: string | null;
  pov_markdown: string | null;
  services: string[];
  vendors: string[];
  connection_status: string;
  connection_accepted_at: string | null;
  automations: string[];
  outgoing_count: number;
  reply_count: number;
  email_count: number | null;
  status: string;
}

const route = useRoute();
const router = useRouter();
const message = useMessage();

const REPLY_FILTER_OPTIONS = [
  { label: "All responses", value: "all" },
  { label: "Replied", value: "replied" },
  { label: "Never replied", value: "never_replied" },
  { label: "No outreach", value: "no_outreach" },
];
const CONNECTION_FILTER_OPTIONS = [
  { label: "All connections", value: "all" },
  { label: "Connected", value: "accepted" },
  { label: "Connection Sent", value: "sent" },
  { label: "Withdrawn", value: "withdrawn" },
  { label: "Not Connected", value: "none" },
];
const CATEGORY_FILTER_OPTIONS = ["Founder/CEO", "Business Leader", "Technical Leader", "Engineer", "Sales", "Other"].map((value) => ({ label: value, value }));
const PRIORITY_FILTER_OPTIONS = ["Top", "High", "Medium", "Low"].map((value) => ({ label: value, value }));
const EMAIL_AVAILABILITY_OPTIONS = [
  { label: "All email availability", value: "all" },
  { label: "Has email", value: "has" },
  { label: "Missing email", value: "missing" },
];

const loading = ref(false);
const loadError = ref("");
const card = ref<Json | null>(null);
const noteDraft = ref("");
const savingNote = ref(false);
const summarizing = ref(false);
const runningResearch = ref(false);
const rawDrawerOpen = ref(false);
const rawDrawerTitle = ref("");
const rawDrawerJson = ref("");

function routeString(key: string, fallback = ""): string {
  const value = route.query[key];
  return typeof value === "string" ? value : fallback;
}

const contactSearch = ref(routeString("contactSearch"));
const replyFilter = ref(routeString("contactReply", "all"));
const connectionFilter = ref(routeString("contactConnection", "all"));
const categoryFilter = ref(routeString("contactCategory"));
const priorityFilter = ref(routeString("contactPriority"));
const emailAvailabilityFilter = ref(routeString("contactEmail", "all"));
const emailStatusFilter = ref(routeString("contactEmailStatus"));

const companyId = computed(() => String(route.params.id ?? ""));
const company = computed<Json>(() => (card.value?.company as Json) ?? {});
const latestResults = computed<Json[]>(() => (card.value?.latest_results as Json[]) ?? []);
const roster = computed<RosterRow[]>(() => (card.value?.contacts as RosterRow[]) ?? []);
const threads = computed<Thread[]>(() => (card.value?.conversations as Thread[]) ?? []);
const contextEntries = computed<Json[]>(() => (card.value?.context_entries as Json[]) ?? []);
const summary = computed<SummaryEntry | null>(() => (card.value?.account_summary as SummaryEntry) ?? null);
const summaryStale = computed(() => Boolean(card.value?.account_summary_stale));
const listRecords = computed<ListRecord[]>(() => (card.value?.list_records as ListRecord[]) ?? []);

const emailStatusOptions = computed(() =>
  [...new Set(roster.value.map((row) => row.email_status?.trim() ?? "").filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ label: value, value }))
);

const filteredRoster = computed(() => {
  const search = contactSearch.value.trim().toLowerCase();
  return roster.value.filter((row) => {
    if (search) {
      const haystack = [nameByLead.value.get(row.uuid), row.position, row.headline]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    const activity = row.activity;
    if (replyFilter.value === "replied" && (activity?.inbox_count ?? 0) === 0) return false;
    if (replyFilter.value === "never_replied" && (!activity || activity.outbox_count === 0 || activity.inbox_count > 0)) return false;
    if (replyFilter.value === "no_outreach" && activity && (activity.inbox_count > 0 || activity.outbox_count > 0)) return false;
    if (connectionFilter.value !== "all" && row.connection_status !== connectionFilter.value) return false;
    if (categoryFilter.value && row.lead_category !== categoryFilter.value) return false;
    if (priorityFilter.value && row.priority !== priorityFilter.value) return false;
    const hasEmail = Boolean(row.work_email?.trim());
    if (emailAvailabilityFilter.value === "has" && !hasEmail) return false;
    if (emailAvailabilityFilter.value === "missing" && hasEmail) return false;
    if (emailStatusFilter.value && row.email_status !== emailStatusFilter.value) return false;
    return true;
  });
});

const filtersActive = computed(() => Boolean(
  contactSearch.value ||
  replyFilter.value !== "all" ||
  connectionFilter.value !== "all" ||
  categoryFilter.value ||
  priorityFilter.value ||
  emailAvailabilityFilter.value !== "all" ||
  emailStatusFilter.value
));

type ContactFilterPatch = Partial<{
  contactSearch: string;
  contactReply: string;
  contactConnection: string;
  contactCategory: string;
  contactPriority: string;
  contactEmail: string;
  contactEmailStatus: string;
}>;

function updateContactFilters(patch: ContactFilterPatch) {
  if (patch.contactSearch !== undefined) contactSearch.value = patch.contactSearch;
  if (patch.contactReply !== undefined) replyFilter.value = patch.contactReply;
  if (patch.contactConnection !== undefined) connectionFilter.value = patch.contactConnection;
  if (patch.contactCategory !== undefined) categoryFilter.value = patch.contactCategory;
  if (patch.contactPriority !== undefined) priorityFilter.value = patch.contactPriority;
  if (patch.contactEmail !== undefined) emailAvailabilityFilter.value = patch.contactEmail;
  if (patch.contactEmailStatus !== undefined) emailStatusFilter.value = patch.contactEmailStatus;
  const query = { ...route.query } as Record<string, string | string[] | null | undefined>;
  const values: Record<string, string> = {
    contactSearch: contactSearch.value,
    contactReply: replyFilter.value === "all" ? "" : replyFilter.value,
    contactConnection: connectionFilter.value === "all" ? "" : connectionFilter.value,
    contactCategory: categoryFilter.value,
    contactPriority: priorityFilter.value,
    contactEmail: emailAvailabilityFilter.value === "all" ? "" : emailAvailabilityFilter.value,
    contactEmailStatus: emailStatusFilter.value,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) query[key] = value;
    else delete query[key];
  }
  void router.replace({ query });
}

function clearContactFilters() {
  updateContactFilters({
    contactSearch: "",
    contactReply: "all",
    contactConnection: "all",
    contactCategory: "",
    contactPriority: "",
    contactEmail: "all",
    contactEmailStatus: "",
  });
}

function syncContactFiltersFromRoute() {
  contactSearch.value = routeString("contactSearch");
  replyFilter.value = routeString("contactReply", "all");
  connectionFilter.value = routeString("contactConnection", "all");
  categoryFilter.value = routeString("contactCategory");
  priorityFilter.value = routeString("contactPriority");
  emailAvailabilityFilter.value = routeString("contactEmail", "all");
  emailStatusFilter.value = routeString("contactEmailStatus");
}

const nameByLead = computed(() => {
  const m = new Map<string, string>();
  for (const r of roster.value) {
    const label =
      (typeof r.name === "string" && r.name) ||
      [r.first_name, r.last_name].filter((x) => typeof x === "string" && x).join(" ") ||
      r.uuid.slice(0, 8);
    m.set(r.uuid, label);
  }
  return m;
});

/** City, Country from hq_location jsonb or hq_raw_address fallback. */
const companyHq = computed<string | null>(() => {
  const loc = company.value.hq_location;
  if (loc && typeof loc === "object") {
    const o = loc as Json;
    const city = typeof o.city === "string" ? o.city : null;
    const country = typeof o.country === "string" ? o.country : null;
    const r = [city, country].filter(Boolean).join(", ");
    if (r) return r;
  }
  const raw = company.value.hq_raw_address;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
});

function fmtDate(s: unknown): string {
  if (typeof s !== "string" || !s) return "";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function statusType(s: string): "default" | "success" | "warning" {
  if (s === "got_response") return "success";
  if (s === "waiting_for_response") return "warning";
  return "default";
}

function connectionType(s: RosterRow["connection_status"]): "error" | "success" | "warning" | "default" {
  if (s === "accepted") return "success";
  if (s === "sent") return "warning";
  if (s === "none") return "error";
  return "default";
}

function connectionLabel(s: RosterRow["connection_status"]): string {
  if (s === "accepted") return "Connected";
  if (s === "sent") return "Connection Sent";
  if (s === "withdrawn") return "Withdrawn";
  return "Not Connected";
}

function scalarFields(result: unknown): Array<[string, string]> {
  if (!result || typeof result !== "object") return [];
  const skip = new Set(["full_json", "clean_full_json", "lead", "row_data", "workflow_context"]);
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(result as Json)) {
    if (skip.has(k) || v == null || v === "") continue;
    if (typeof v === "string" && v.length <= 600) out.push([k, v]);
    else if (typeof v === "number" || typeof v === "boolean") out.push([k, String(v)]);
    else if (Array.isArray(v) && v.every((x) => typeof x === "string") && v.length <= 12) out.push([k, v.join(" | ")]);
  }
  return out;
}

function openRaw(title: string, obj: unknown) {
  rawDrawerTitle.value = title;
  rawDrawerJson.value = JSON.stringify(obj, null, 2);
  rawDrawerOpen.value = true;
}

function openContact(uuid: string) {
  if (!uuid) return;
  void router.push(`/contact/${uuid}`);
}

function shouldIgnoreRowClick(event: MouseEvent): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest("a, button, input, textarea, select, [role='button']"));
}

function contactRowProps(row: { uuid: string }) {
  return {
    class: "clickable-contact-row",
    onClick: (event: MouseEvent) => {
      if (shouldIgnoreRowClick(event)) return;
      openContact(row.uuid);
    },
  };
}

const rosterColumns = computed<DataTableColumns<RosterRow>>(() => [
  {
    title: "Contact",
    key: "name",
    minWidth: 200,
    render: (row) =>
      h(
        RouterLink,
        { to: `/contact/${row.uuid}`, class: "card-link" },
        { default: () => nameByLead.value.get(row.uuid) ?? row.uuid.slice(0, 8) }
      ),
  },
  { title: "Position", key: "position", minWidth: 180, ellipsis: { tooltip: true } },
  {
    title: "Connection", key: "connection", width: 140,
    render: (row) => h(NTag, { size: "small", bordered: true, type: connectionType(row.connection_status) }, { default: () => connectionLabel(row.connection_status) }),
  },
  { title: "Email", key: "work_email", minWidth: 190, ellipsis: { tooltip: true }, render: (row) => row.work_email || "—" },
  { title: "Category", key: "lead_category", width: 140, render: (row) => row.lead_category || "—" },
  { title: "Priority", key: "priority", width: 90, render: (row) => row.priority || "—" },
  {
    title: "Conversations",
    key: "threads",
    width: 120,
    render: (row) => (row.activity ? `${row.activity.thread_count} (${row.activity.inbox_count}↓ ${row.activity.outbox_count}↑)` : "—"),
  },
  {
    title: "Status",
    key: "status",
    width: 170,
    render: (row) =>
      row.activity
        ? h(NTag, { size: "small", type: statusType(row.activity.reply_status) }, { default: () => row.activity!.reply_status })
        : h(NText, { depth: 3 }, { default: () => "no outreach" }),
  },
  {
    title: "Last activity",
    key: "last",
    width: 170,
    render: (row) => (row.activity?.last_message_at ? fmtDate(row.activity.last_message_at) : "—"),
  },
]);

const listColumns = computed<DataTableColumns<ListRecord>>(() => [
  {
    title: "Contact", key: "name", minWidth: 180,
    render: (row) => h(RouterLink, { to: `/contact/${row.uuid}`, class: "card-link" }, { default: () => row.name }),
  },
  {
    title: "LinkedIn", key: "linkedin_url", width: 90,
    render: (row) => row.linkedin_url ? h("a", { href: row.linkedin_url, target: "_blank", rel: "noopener noreferrer", class: "card-link", onClick: (event: MouseEvent) => event.stopPropagation() }, "Open ↗") : "—",
  },
  { title: "Title", key: "position", minWidth: 180, ellipsis: { tooltip: true }, render: (r) => r.position ?? "—" },
  { title: "Location", key: "location", minWidth: 130, render: (r) => r.location ?? "—" },
  { title: "Email", key: "email", minWidth: 210, ellipsis: { tooltip: true }, render: (r) => r.email ?? "—" },
  { title: "Email status", key: "email_status", width: 120, render: (r) => r.email_status ?? "—" },
  { title: "Connection", key: "connection_status", width: 110 },
  { title: "Accepted", key: "connection_accepted_at", width: 110, render: (r) => r.connection_accepted_at ? fmtDate(r.connection_accepted_at) : "—" },
  { title: "Automations", key: "automations", minWidth: 180, ellipsis: { tooltip: true }, render: (r) => r.automations.length ? r.automations.join(", ") : "—" },
  { title: "Out", key: "outgoing_count", width: 60 },
  { title: "Replies", key: "reply_count", width: 70 },
  { title: "Emails sent", key: "email_count", width: 90, render: (r) => r.email_count ?? "—" },
  { title: "Status", key: "status", minWidth: 160 },
]);

async function load() {
  if (!companyId.value) return;
  loading.value = true;
  loadError.value = "";
  try {
    const params = new URLSearchParams({ id: companyId.value });
    const tag = typeof route.query.tag === "string" ? route.query.tag : "";
    if (tag) params.set("tag", tag);
    const r = await fetch(`/api/cards/company?${params.toString()}`);
    const data = (await r.json()) as Json & { error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed to load");
    card.value = data;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "Failed to load";
    card.value = null;
  } finally {
    loading.value = false;
  }
}

async function regenerateSummary() {
  summarizing.value = true;
  try {
    const r = await fetch("/api/cards/company-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: companyId.value }),
    });
    const data = (await r.json()) as { error?: string };
    if (!r.ok) throw new Error(data.error ?? "Summary failed");
    message.success("Account summary refreshed.");
    await load();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Summary failed");
  } finally {
    summarizing.value = false;
  }
}

async function addNote() {
  const text = noteDraft.value.trim();
  if (!text) return;
  savingNote.value = true;
  try {
    const r = await fetch("/api/company-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId.value, rootContext: text }),
    });
    const data = (await r.json()) as { error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed");
    noteDraft.value = "";
    message.success("Context saved.");
    await load();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to save context");
  } finally {
    savingNote.value = false;
  }
}

async function runN8nResearch() {
  runningResearch.value = true;
  try {
    const r = await fetch("/api/feasible/run-phase-b-company", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: companyId.value, companyTypeTag: "services_mssp" }),
    });
    const data = (await r.json()) as { error?: string };
    if (!r.ok) throw new Error(data.error ?? "Run failed");
    message.success("Phase B research started. Refresh in a few minutes to see POV on this card and MSSP Leaders.");
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Run failed");
  } finally {
    runningResearch.value = false;
  }
}

onMounted(load);
watch(companyId, load);
watch(() => route.query, syncContactFiltersFromRoute, { deep: true });
</script>

<template>
  <NSpin :show="loading">
    <NAlert v-if="loadError" type="error" style="margin-bottom: 12px">{{ loadError }}</NAlert>

    <NSpace v-if="card" vertical size="medium" style="width: 100%">
      <!-- Header -->
      <NCard>
        <NSpace align="center" justify="space-between" wrap>
          <div>
            <h2 style="margin: 0">{{ company.name || company.domain }}</h2>
            <NSpace size="small" align="center" style="margin-top: 6px" wrap>
              <a
                v-if="company.domain"
                :href="String(company.website || `https://${company.domain}`)"
                target="_blank"
                rel="noopener"
                class="card-link"
              >{{ company.domain }} ↗</a>
              <NTag v-if="company.industry" size="small">{{ company.industry }}</NTag>
              <NTag v-if="company.employees_on_linkedin" size="small" type="info">
                {{ Number(company.employees_on_linkedin).toLocaleString() }} employees on LinkedIn
              </NTag>
              <NTag v-else-if="company.employees_range" size="small">{{ company.employees_range }} employees</NTag>
              <NText v-if="companyHq" depth="3" style="font-size: 0.85rem">{{ companyHq }}</NText>
            </NSpace>
          </div>
        </NSpace>
        <template v-if="company.about">
          <NDivider style="margin: 12px 0" />
          <NText depth="3" style="font-size: 0.85rem">{{ String(company.about).slice(0, 400) }}</NText>
        </template>
      </NCard>

      <!-- Fields carried from the MSSP Leaders list when opened from that list. -->
      <NCard v-if="listRecords.length" title="MSSP Leaders list details" size="small">
        <NSpace vertical size="small">
          <NSpace wrap size="small">
            <NTag v-if="listRecords[0].company_type" type="info" size="small">
              {{ listRecords[0].company_type }}
            </NTag>
            <NTag v-if="listRecords[0].company_hq" size="small">HQ: {{ listRecords[0].company_hq }}</NTag>
            <NTag v-if="listRecords[0].employee_count != null" size="small">
              {{ listRecords[0].employee_count.toLocaleString() }} employees on LinkedIn
            </NTag>
          </NSpace>
          <div v-if="listRecords[0].services.length"><strong>Services:</strong> {{ listRecords[0].services.join(", ") }}</div>
          <div v-if="listRecords[0].vendors.length"><strong>Vendors:</strong> {{ listRecords[0].vendors.join(", ") }}</div>
          <div v-if="listRecords[0].pov_markdown" style="white-space: pre-wrap">{{ listRecords[0].pov_markdown }}</div>
          <NDataTable
            :columns="listColumns"
            :data="listRecords"
            :row-props="contactRowProps"
            size="small"
            striped
            :scroll-x="1900"
          />
        </NSpace>
      </NCard>

      <!-- Research Summary -->
      <NCard v-if="company.research_company_one_liner" title="Research Summary" size="small">
        <NText style="font-size: 0.9rem">{{ String(company.research_company_one_liner) }}</NText>
      </NCard>

      <!-- Account summary -->
      <NCard title="Account summary" size="small">
        <template #header-extra>
          <NSpace align="center" size="small">
            <NTag v-if="summaryStale" size="small" type="warning">stale — new messages since generated</NTag>
            <NButton size="small" type="primary" :loading="summarizing" @click="regenerateSummary">
              {{ summary ? "Regenerate" : "Generate" }}
            </NButton>
          </NSpace>
        </template>
        <template v-if="summary">
          <p style="margin-top: 0">{{ summary.data.account_summary }}</p>
          <div v-for="(pc, i) in summary.data.per_contact ?? []" :key="i" class="msg">
            <NSpace align="center" size="small">
              <strong>{{ pc.name }}</strong>
              <NTag size="tiny" :type="pc.stance === 'positive' ? 'success' : pc.stance === 'negative' ? 'error' : 'default'">{{ pc.stance }}</NTag>
            </NSpace>
            <ul style="margin: 4px 0 0; padding-left: 18px">
              <li v-for="(kp, j) in pc.key_points ?? []" :key="j">{{ kp }}</li>
            </ul>
          </div>
          <NAlert v-if="summary.data.suggested_next_step" type="info" style="margin-top: 8px">
            Next step: {{ summary.data.suggested_next_step }}
          </NAlert>
          <NText depth="3" style="font-size: 0.72rem">generated {{ fmtDate(summary.generated_at) }} · {{ summary.model }}</NText>
        </template>
        <NText v-else depth="3">no summary yet — Generate builds one from all conversations at this account</NText>
      </NCard>

      <!-- Contacts roster -->
      <NCard :title="`Contacts (${filteredRoster.length}/${roster.length})`" size="small">
        <NSpace vertical size="small">
          <div class="contact-filters">
            <NInput
              :value="contactSearch"
              clearable
              placeholder="Search name or title"
              @update:value="(value) => updateContactFilters({ contactSearch: value })"
            />
            <NSelect
              :value="replyFilter"
              :options="REPLY_FILTER_OPTIONS"
              @update:value="(value) => updateContactFilters({ contactReply: value })"
            />
            <NSelect
              :value="connectionFilter"
              :options="CONNECTION_FILTER_OPTIONS"
              @update:value="(value) => updateContactFilters({ contactConnection: value })"
            />
            <NSelect
              :value="categoryFilter || null"
              :options="CATEGORY_FILTER_OPTIONS"
              clearable
              placeholder="Lead category"
              @update:value="(value) => updateContactFilters({ contactCategory: value || '' })"
            />
            <NSelect
              :value="priorityFilter || null"
              :options="PRIORITY_FILTER_OPTIONS"
              clearable
              placeholder="Priority"
              @update:value="(value) => updateContactFilters({ contactPriority: value || '' })"
            />
            <NSelect
              :value="emailAvailabilityFilter"
              :options="EMAIL_AVAILABILITY_OPTIONS"
              @update:value="(value) => updateContactFilters({ contactEmail: value })"
            />
            <NSelect
              :value="emailStatusFilter || null"
              :options="emailStatusOptions"
              clearable
              placeholder="Email status"
              @update:value="(value) => updateContactFilters({ contactEmailStatus: value || '' })"
            />
            <NButton :disabled="!filtersActive" @click="clearContactFilters">Clear all</NButton>
          </div>
          <NText v-if="filtersActive && !filteredRoster.length" depth="3">No contacts match these filters.</NText>
          <NDataTable
            :columns="rosterColumns"
            :data="filteredRoster"
            :row-props="contactRowProps"
            size="small"
            :max-height="420"
            :scroll-x="1450"
            striped
          />
        </NSpace>
      </NCard>

      <!-- Company research -->
      <NCard title="Company research (n8n)" size="small">
        <template #header-extra>
          <NButton size="small" type="primary" :loading="runningResearch" @click="runN8nResearch">
            Run n8n research
          </NButton>
        </template>
        <NText v-if="!latestResults.length" depth="3">no company research yet — use Run n8n research above</NText>
        <NCollapse v-else>
          <NCollapseItem
            v-for="r in latestResults"
            :key="String(r.id)"
            :title="`${r.workflow_name || 'result'} — ${fmtDate(r.created_at)}`"
            :name="String(r.id)"
          >
            <template #header-extra>
              <NButton size="tiny" quaternary @click.stop="openRaw(String(r.workflow_name || 'result'), r.result)">raw JSON</NButton>
            </template>
            <div class="kv-grid">
              <template v-for="[k, v] in scalarFields(r.result)" :key="k">
                <div class="kv-key">{{ k }}</div>
                <div class="kv-val">{{ v }}</div>
              </template>
            </div>
          </NCollapseItem>
        </NCollapse>
      </NCard>

      <!-- Account conversations rollup -->
      <NCard :title="`Account conversations (${threads.length})`" size="small">
        <NText v-if="!threads.length" depth="3">no conversations at this account yet</NText>
        <NCollapse v-else>
          <NCollapseItem v-for="t in threads" :key="t.conversation_uuid" :name="t.conversation_uuid">
            <template #header>
              <NSpace align="center" size="small">
                <strong>{{ nameByLead.get(t.lead_uuid ?? "") ?? "unknown" }}</strong>
                <NTag size="tiny" :type="statusType(t.reply_status)">{{ t.reply_status }}</NTag>
                <span>{{ t.message_count }} msgs · {{ fmtDate(t.last_message_at) }}</span>
              </NSpace>
            </template>
            <div
              v-for="(m, i) in t.messages"
              :key="i"
              class="msg"
              :class="{ inbox: (m.type || '').toLowerCase() === 'inbox' }"
            >
              <NText depth="3" style="font-size: 0.72rem">
                {{ (m.type || "").toLowerCase() === "inbox" ? nameByLead.get(t.lead_uuid ?? "") ?? "prospect" : (m.sender_display_name || "Unknown sender") }} · {{ m.channel_label || "LinkedIn" }} · {{ fmtDate(m.sent_at) }}
              </NText>
              <div v-if="m.subject"><strong>Subject:</strong> {{ m.subject }}</div>
              <div>{{ m.text }}</div>
            </div>
          </NCollapseItem>
        </NCollapse>
      </NCard>

      <!-- Context notes -->
      <NCard :title="`Context notes (${contextEntries.length})`" size="small">
        <NSpace vertical size="small">
          <div v-for="e in contextEntries" :key="String(e.id)" class="msg">
            <NText depth="3" style="font-size: 0.72rem">{{ fmtDate(e.created_at) }}</NText>
            <div style="white-space: pre-wrap">{{ e.rootContext }}</div>
          </div>
          <NSpace align="center" style="width: 100%">
            <NInput
              v-model:value="noteDraft"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 4 }"
              placeholder="add a context note for this account"
              style="flex: 1; min-width: 320px"
            />
            <NButton size="small" type="primary" :loading="savingNote" :disabled="!noteDraft.trim()" @click="addNote">Add</NButton>
          </NSpace>
        </NSpace>
      </NCard>
    </NSpace>

    <NDrawer v-model:show="rawDrawerOpen" :width="560" placement="right">
      <NDrawerContent :title="rawDrawerTitle" closable>
        <pre class="json-pre">{{ rawDrawerJson }}</pre>
      </NDrawerContent>
    </NDrawer>
  </NSpin>
</template>

<style scoped>
.card-link {
  color: #2080f0;
  text-decoration: none;
}
.card-link:hover {
  text-decoration: underline;
}
:deep(.clickable-contact-row) {
  cursor: pointer;
}
:deep(.clickable-contact-row:hover td) {
  background: rgba(32, 128, 240, 0.06);
}
.contact-filters {
  display: grid;
  grid-template-columns: minmax(220px, 1.5fr) repeat(6, minmax(145px, 1fr)) auto;
  gap: 8px;
  align-items: center;
}
@media (max-width: 1200px) {
  .contact-filters {
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  }
}
.kv-grid {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 4px 12px;
  font-size: 0.85rem;
}
.kv-key {
  opacity: 0.65;
  word-break: break-word;
}
.kv-val {
  white-space: pre-wrap;
  word-break: break-word;
}
.msg {
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(128, 128, 128, 0.07);
  margin-bottom: 6px;
  font-size: 0.85rem;
}
.msg.inbox {
  background: rgba(32, 128, 240, 0.09);
}
.json-pre {
  margin: 0;
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 80vh;
  overflow: auto;
}
</style>
