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
  verification_status: string | null;
  is_person: boolean;
  is_gp_support: boolean;
  company_final_verification_status: string | null;
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
const companySegment = ref<string | null>(null);
const source = ref<string | null>(null);
const emailStatus = ref<string | null>(null);
const fit = ref<string | null>(null);
const icpFit = ref<string | null>(null);
const contactSegment = ref<string | null>(null);
const outreachList = ref<string | null>(null);
const outreachChannel = ref<string | null>(null);
const outreachDecision = ref<string | null>(null);
const eligibleOnly = ref(false);
const sortBy = ref("name");
const sortDirection = ref<"asc" | "desc">("asc");

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

function clearFilters() {
  searchInput.value = "";
  appliedSearch.value = "";
  presence.value = "people";
  population.value = "foxdata";
  companySegment.value = null;
  source.value = null;
  emailStatus.value = null;
  fit.value = null;
  icpFit.value = null;
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
    if (icpFit.value) q.set("icpFit", icpFit.value);
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
    icpFit,
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

const columns = computed<DataTableColumns<WelloreContactRow>>(() => [
  {
    title: "Name",
    key: "name",
    sorter: true,
    render: (row) => row.name || (row.is_gp_support ? "GP support" : "—"),
  },
  {
    title: "Title",
    key: "title",
    render: (row) => row.title || "—",
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
    title: "Source",
    key: "source",
    render: (row) =>
      h(
        NTag,
        {
          size: "small",
          type: row.is_gp_support ? "warning" : "default",
          bordered: false,
        },
        { default: () => row.source || "—" }
      ),
  },
  {
    title: "Email",
    key: "email",
    render: (row) => {
      if (!row.email) return "—";
      return h("div", [
        h("div", row.email),
        h("div", { class: "meta" }, row.email_status || ""),
      ]);
    },
  },
  {
    title: "LinkedIn",
    key: "linkedin_url",
    render: (row) =>
      row.linkedin_url
        ? h(
            "a",
            { href: row.linkedin_url, target: "_blank", rel: "noopener" },
            "Profile"
          )
        : "—",
  },
  {
    title: "Fit",
    key: "fit",
    render: (row) => row.fit || row.icp_fit || "—",
  },
  {
    title: "Segment",
    key: "contact_segment",
    render: (row) => row.contact_segment || "—",
  },
  {
    title: "Outreach list",
    key: "outreach_list",
    render: (row) => row.outreach_list || "—",
  },
  {
    title: "Eligible",
    key: "contact_outreach_eligible",
    render: (row) =>
      row.contact_outreach_eligible
        ? h(NTag, { size: "small", type: "success", bordered: false }, { default: () => "yes" })
        : "—",
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
        <NInput
          v-model:value="searchInput"
          placeholder="Search name, title, email, company…"
          clearable
          size="small"
          style="width: 280px"
        />
      </div>
    </template>

    <div class="filters">
      <NSelect v-model:value="presence" :options="presenceOptions" size="small" />
      <NSelect v-model:value="population" :options="populationOptions" size="small" />
      <NSelect
        v-model:value="companySegment"
        :options="companySegmentOptions"
        placeholder="Company segment…"
        clearable
        size="small"
      />
      <NSelect v-model:value="source" :options="sourceOptions" placeholder="Source…" clearable size="small" />
      <NSelect v-model:value="emailStatus" :options="emailStatusOptions" placeholder="Email status…" clearable size="small" />
      <NSelect v-model:value="fit" :options="fitOptions" placeholder="Fit…" clearable size="small" />
      <NSelect v-model:value="icpFit" :options="fitOptions" placeholder="ICP fit…" clearable size="small" />
      <NSelect v-model:value="contactSegment" :options="segmentOptions" placeholder="Contact segment…" clearable size="small" />
      <NSelect v-model:value="outreachList" :options="outreachListOptions" placeholder="Outreach list…" clearable size="small" />
      <NSelect v-model:value="outreachChannel" :options="outreachChannelOptions" placeholder="Outreach channel…" clearable size="small" />
      <NSelect v-model:value="outreachDecision" :options="outreachDecisionOptions" placeholder="Decision…" clearable size="small" />
      <NCheckbox v-model:checked="eligibleOnly" size="small">Eligible only</NCheckbox>
      <NButton size="small" @click="clearFilters">Clear filters</NButton>
    </div>

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
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  align-items: center;
}
.company-link { color: #2080f0; text-decoration: none; }
.company-link:hover { text-decoration: underline; }
.meta { font-size: 0.75rem; opacity: 0.65; }
</style>
