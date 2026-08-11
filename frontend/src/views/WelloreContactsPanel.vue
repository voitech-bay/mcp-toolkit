<script setup lang="ts">
import { ref, computed, watch, h } from "vue";
import { useDebounceFn } from "@vueuse/core";
import {
  NCard,
  NDataTable,
  NInput,
  NButton,
  NSpace,
  NAlert,
  NEmpty,
  NSelect,
  NTag,
  NCheckbox,
  NCollapse,
  NCollapseItem,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { RouterLink } from "vue-router";
import { UsersIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";
import { WELLORE_PROJECT_ID } from "../project-ids";

interface WelloreContactRow {
  id: number;
  company_id: number;
  company_name: string | null;
  name: string | null;
  title: string | null;
  linkedin_url: string | null;
  email: string | null;
  email_status: string | null;
  source: string | null;
  icp_fit: string | null;
  fit: string | null;
  contact_segment: string | null;
  outreach_list: string | null;
  outreach_channel: string | null;
  outreach_decision: string | null;
  contact_outreach_eligible: boolean | null;
  contact_exclusion_reason?: string | null;
  verification_status: string | null;
  is_person: boolean;
  is_gp_support: boolean;
  company_final_verification_status: string | null;
  linkedin_duplicate?: boolean | null;
  is_linkedin_duplicate?: boolean;
}

interface ContactsSummary {
  people: number;
  gp_support: number;
  all: number;
  with_email?: number;
  eligible?: number;
}

const projectStore = useProjectStore();
const message = useMessage();
const loading = ref(false);
const error = ref("");
const data = ref<WelloreContactRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(25);
const searchInput = ref("");
const appliedSearch = ref("");

const presence = ref("people");
const population = ref("foxdata");
const companySegment = ref<string | null>("verified");
const source = ref<string | null>(null);
const emailStatus = ref<string | null>(null);
const fit = ref<string | null>(null);
const contactSegment = ref<string | null>(null);
const outreachList = ref<string | null>(null);
const outreachChannel = ref<string | null>(null);
const outreachDecision = ref<string | null>(null);
const eligibleOnly = ref(false);
const sortBy = ref("name");
const sortDirection = ref<"asc" | "desc">("asc");

const summary = ref<ContactsSummary | null>(null);
const summaryLoading = ref(false);

const presenceOptions = [
  { label: "People", value: "people" },
  { label: "Google Play support", value: "gp_support" },
  { label: "All contacts", value: "all" },
];
const populationOptions = [
  { label: "FoxData cohort", value: "foxdata" },
  { label: "All Wellore", value: "all" },
];
const companySegmentOptions = [
  { label: "Verified companies", value: "verified" },
  { label: "Disqualified companies", value: "disqualified" },
  { label: "Backlog companies", value: "backlog" },
];
const sourceOptions = [
  { label: "prospeo", value: "prospeo" },
  { label: "blitz", value: "blitz" },
  { label: "coresignal", value: "coresignal" },
  { label: "website_email", value: "website_email" },
  { label: "google_play_support_email", value: "google_play_support_email" },
];
const emailStatusOptions = [
  { label: "verified", value: "verified" },
  { label: "guessed", value: "guessed" },
  { label: "generic", value: "generic" },
  { label: "none", value: "none" },
];
const fitOptions = [
  { label: "high", value: "high" },
  { label: "medium", value: "medium" },
  { label: "low", value: "low" },
  { label: "exclude", value: "exclude" },
];
const segmentOptions = [
  { label: "economic_buyers", value: "economic_buyers" },
  { label: "production_art", value: "production_art" },
  { label: "technical_evaluators", value: "technical_evaluators" },
  { label: "commercial", value: "commercial" },
  { label: "excluded", value: "excluded" },
];
const outreachListOptions = [
  { label: "A_Economic_Buyers", value: "A_Economic_Buyers" },
  { label: "A_Production_Art", value: "A_Production_Art" },
  { label: "A_Technical_Evaluators", value: "A_Technical_Evaluators" },
  { label: "A_Commercial", value: "A_Commercial" },
  { label: "B_Selectively_Reach", value: "B_Selectively_Reach" },
  { label: "D_Disqualified", value: "D_Disqualified" },
  { label: "Excluded_Contacts", value: "Excluded_Contacts" },
];
const outreachChannelOptions = [
  { label: "linkedin_and_email", value: "linkedin_and_email" },
  { label: "linkedin", value: "linkedin" },
  { label: "email", value: "email" },
  { label: "none", value: "none" },
];
const outreachDecisionOptions = [
  { label: "send", value: "send" },
  { label: "park", value: "park" },
  { label: "exclude", value: "exclude" },
  { label: "skip", value: "skip" },
];

function isDup(row: WelloreContactRow): boolean {
  return Boolean(
    row.is_linkedin_duplicate
    || row.linkedin_duplicate
    || row.contact_exclusion_reason === "duplicate_linkedin_stale_employer"
  );
}

function clearFilters() {
  searchInput.value = "";
  appliedSearch.value = "";
  presence.value = "people";
  population.value = "foxdata";
  companySegment.value = "verified";
  source.value = null;
  emailStatus.value = null;
  fit.value = null;
  contactSegment.value = null;
  outreachList.value = null;
  outreachChannel.value = null;
  outreachDecision.value = null;
  eligibleOnly.value = false;
  sortBy.value = "name";
  sortDirection.value = "asc";
  page.value = 1;
}

const debouncedSearch = useDebounceFn(() => {
  appliedSearch.value = searchInput.value.trim();
  page.value = 1;
}, 300);
watch(searchInput, () => debouncedSearch());

async function fetchSummary() {
  if (projectStore.selectedProjectId !== WELLORE_PROJECT_ID) {
    summary.value = null;
    return;
  }
  summaryLoading.value = true;
  try {
    const q = new URLSearchParams({
      projectId: WELLORE_PROJECT_ID,
      population: population.value,
    });
    const r = await fetch(`/api/wellore/contacts-summary?${q}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Summary failed");
    summary.value = j.data as ContactsSummary;
  } catch (e) {
    summary.value = null;
    message.error(e instanceof Error ? e.message : "Summary failed");
  } finally {
    summaryLoading.value = false;
  }
}

async function fetchContacts() {
  if (projectStore.selectedProjectId !== WELLORE_PROJECT_ID) {
    data.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const q = new URLSearchParams({
      projectId: WELLORE_PROJECT_ID,
      limit: String(pageSize.value),
      offset: String((page.value - 1) * pageSize.value),
      presence: presence.value,
      population: population.value,
      sortBy: sortBy.value,
      sortDirection: sortDirection.value,
    });
    if (appliedSearch.value) q.set("search", appliedSearch.value);
    if (companySegment.value) q.set("companySegment", companySegment.value);
    if (source.value) q.set("source", source.value);
    if (emailStatus.value) q.set("emailStatus", emailStatus.value);
    if (fit.value) q.set("fit", fit.value);
    if (contactSegment.value) q.set("contactSegment", contactSegment.value);
    if (outreachList.value) q.set("outreachList", outreachList.value);
    if (outreachChannel.value) q.set("outreachChannel", outreachChannel.value);
    if (outreachDecision.value) q.set("outreachDecision", outreachDecision.value);
    if (eligibleOnly.value) q.set("eligible", "true");

    const r = await fetch(`/api/wellore/contacts?${q}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Request failed");
    data.value = (j.data ?? []) as WelloreContactRow[];
    total.value = Number(j.total) || 0;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Request failed";
    data.value = [];
    total.value = 0;
    message.error(error.value);
  } finally {
    loading.value = false;
  }
}

watch(
  [() => projectStore.selectedProjectId, population],
  () => {
    void fetchSummary();
  },
  { immediate: true }
);

watch(
  [
    () => projectStore.selectedProjectId,
    page,
    pageSize,
    appliedSearch,
    presence,
    population,
    companySegment,
    source,
    emailStatus,
    fit,
    contactSegment,
    outreachList,
    outreachChannel,
    outreachDecision,
    eligibleOnly,
    sortBy,
    sortDirection,
  ],
  () => {
    void fetchContacts();
  },
  { immediate: true }
);

const rangeLabel = computed(() => {
  if (total.value === 0) return "Showing 0 of 0";
  const start = (page.value - 1) * pageSize.value + 1;
  const end = Math.min(page.value * pageSize.value, total.value);
  return `Showing ${start}–${end} of ${total.value}`;
});

const columns = computed<DataTableColumns<WelloreContactRow>>(() => [
  {
    title: "Person",
    key: "name",
    sorter: true,
    render: (row) =>
      h("div", { class: "person-cell" }, [
        h(
          "div",
          { class: "person-name" },
          row.name || (row.is_gp_support ? "GP support" : "—")
        ),
        row.title ? h("div", { class: "meta" }, row.title) : null,
      ]),
  },
  {
    title: "Company",
    key: "company_name",
    render: (row) =>
      h(
        RouterLink,
        { to: `/company/wellore/${row.company_id}`, class: "company-link" },
        { default: () => row.company_name || `#${row.company_id}` }
      ),
  },
  {
    title: "Email",
    key: "email",
    render: (row) => {
      if (!row.email) return h("span", { class: "muted" }, "—");
      return h("div", [
        h("div", row.email),
        row.email_status
          ? h("div", { class: "meta" }, row.email_status)
          : null,
      ]);
    },
  },
  {
    title: "LinkedIn",
    key: "linkedin_url",
    width: 90,
    render: (row) =>
      row.linkedin_url
        ? h(
            "a",
            {
              href: row.linkedin_url,
              target: "_blank",
              rel: "noopener",
              class: "company-link",
            },
            "Profile"
          )
        : h("span", { class: "muted" }, "—"),
  },
  {
    title: "Fit",
    key: "fit",
    width: 90,
    render: (row) => row.fit || row.icp_fit || "—",
  },
  {
    title: "Status",
    key: "contact_outreach_eligible",
    render: (row) => {
      const children = [];
      if (row.contact_outreach_eligible) {
        children.push(
          h(
            NTag,
            { size: "small", type: "success", bordered: false },
            { default: () => "eligible" }
          )
        );
      }
      if (row.outreach_list) {
        children.push(h("span", { class: "meta" }, row.outreach_list));
      }
      if (isDup(row)) {
        children.push(
          h(
            NTag,
            { size: "small", type: "warning", bordered: false },
            { default: () => "Dup" }
          )
        );
      }
      if (children.length === 0) return h("span", { class: "muted" }, "—");
      return h("div", { class: "status-cell" }, children);
    },
  },
]);

const pagination = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  itemCount: total.value,
  showSizePicker: true,
  pageSizes: [25, 50, 100],
  onUpdatePage: (p: number) => {
    page.value = p;
  },
  onUpdatePageSize: (ps: number) => {
    pageSize.value = ps;
    page.value = 1;
  },
}));
</script>

<template>
  <NCard>
    <template #header>
      <div class="header-row">
        <NSpace align="center">
          <UsersIcon :size="18" class="page-icon" />
          <span class="page-title">Wellore contacts</span>
          <NTag size="small" :bordered="false">{{ total }}</NTag>
        </NSpace>
        <span class="range">{{ rangeLabel }}</span>
      </div>
    </template>

    <div class="metrics">
      <div class="metric">
        <div class="v">{{ summaryLoading ? "…" : (summary?.people ?? "—") }}</div>
        <div class="l">People</div>
      </div>
      <div class="metric">
        <div class="v">
          {{
            summaryLoading
              ? "…"
              : summary?.with_email != null
                ? summary.with_email
                : (summary?.gp_support ?? "—")
          }}
        </div>
        <div class="l">
          {{ summary?.with_email != null ? "With email" : "GP support" }}
        </div>
      </div>
      <div class="metric">
        <div class="v">
          {{
            summaryLoading
              ? "…"
              : summary?.eligible != null
                ? summary.eligible
                : (summary?.all ?? "—")
          }}
        </div>
        <div class="l">
          {{ summary?.eligible != null ? "Eligible" : "All contacts" }}
        </div>
      </div>
    </div>

    <div class="filters">
      <NInput
        v-model:value="searchInput"
        placeholder="Search name, title, email, company…"
        clearable
        size="small"
      />
      <NSelect v-model:value="presence" :options="presenceOptions" size="small" />
      <NSelect
        v-model:value="companySegment"
        :options="companySegmentOptions"
        placeholder="Company segment…"
        clearable
        size="small"
      />
      <NSelect
        v-model:value="emailStatus"
        :options="emailStatusOptions"
        placeholder="Email status…"
        clearable
        size="small"
      />
      <NCheckbox v-model:checked="eligibleOnly" size="small">Eligible only</NCheckbox>
      <NButton size="small" @click="clearFilters">Clear</NButton>
    </div>

    <NCollapse class="advanced">
      <NCollapseItem title="Advanced filters" name="adv">
        <div class="filters">
          <NSelect
            v-model:value="population"
            :options="populationOptions"
            size="small"
          />
          <NSelect
            v-model:value="source"
            :options="sourceOptions"
            placeholder="Source…"
            clearable
            size="small"
          />
          <NSelect
            v-model:value="fit"
            :options="fitOptions"
            placeholder="Fit…"
            clearable
            size="small"
          />
          <NSelect
            v-model:value="contactSegment"
            :options="segmentOptions"
            placeholder="Contact segment…"
            clearable
            size="small"
          />
          <NSelect
            v-model:value="outreachList"
            :options="outreachListOptions"
            placeholder="Outreach list…"
            clearable
            size="small"
          />
          <NSelect
            v-model:value="outreachChannel"
            :options="outreachChannelOptions"
            placeholder="Outreach channel…"
            clearable
            size="small"
          />
          <NSelect
            v-model:value="outreachDecision"
            :options="outreachDecisionOptions"
            placeholder="Decision…"
            clearable
            size="small"
          />
        </div>
      </NCollapseItem>
    </NCollapse>

    <NAlert v-if="error" type="error" style="margin-bottom: 0.75rem">{{ error }}</NAlert>
    <NEmpty v-else-if="!loading && data.length === 0" description="No contacts match these filters" />
    <NDataTable
      v-else
      :columns="columns"
      :data="data"
      :loading="loading"
      :pagination="pagination"
      remote
      size="small"
      :max-height="600"
      :row-key="(row: WelloreContactRow) => row.id"
      @update:sorter="(sorter: any) => {
        sortBy = sorter?.columnKey ?? 'name';
        sortDirection = sorter?.order === 'descend' ? 'desc' : 'asc';
        page = 1;
      }"
    />
  </NCard>
</template>

<style scoped>
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.page-icon { opacity: 0.7; }
.page-title { font-size: 1.1rem; font-weight: 600; }
.range { font-size: 12px; color: #6b7280; }
.metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.metric {
  background: #fafbfc;
  border: 1px solid #e8eaed;
  border-radius: 8px;
  padding: 12px 14px;
}
.metric .v {
  font-size: 22px;
  font-weight: 700;
  color: #2563eb;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.metric .l {
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
}
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  align-items: center;
}
.advanced { margin-bottom: 0.75rem; }
.company-link { color: #2080f0; text-decoration: none; }
.company-link:hover { text-decoration: underline; }
.person-cell { display: flex; flex-direction: column; gap: 2px; }
.person-name { font-weight: 600; }
.status-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.meta { font-size: 0.75rem; opacity: 0.65; }
.muted { color: #9ca3af; }
@media (max-width: 900px) {
  .metrics { grid-template-columns: 1fr; }
}
</style>
