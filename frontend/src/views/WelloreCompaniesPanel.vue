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
  NRadioGroup,
  NRadioButton,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { RouterLink } from "vue-router";
import { BuildingIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";
import { WELLORE_PROJECT_ID } from "../project-ids";

interface WelloreCompanyRow {
  id: number;
  name: string | null;
  domain: string | null;
  website: string | null;
  final_verification_status: string | null;
  disqualification_reason: string | null;
  company_priority_segment: string | null;
  contact_presence: string;
  channel_mode: string;
  people_count: number;
  gp_support_count: number;
  best_title: string | null;
  title_preview: string[];
  upcoming_count: number | null;
  released_count: number | null;
  score_total: number | null;
  recommended_channel: string | null;
  source_list: string | null;
  hq_country: string | null;
}

const projectStore = useProjectStore();
const message = useMessage();
const loading = ref(false);
const error = ref("");
const data = ref<WelloreCompanyRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(25);
const searchInput = ref("");
const appliedSearch = ref("");

const segment = ref("verified");
const population = ref("foxdata");
const contactPresence = ref<string | null>(null);
const channelMode = ref<string | null>(null);
const disqualificationReason = ref<string | null>(null);
const prioritySegment = ref<string | null>(null);
const recommendedChannel = ref<string | null>(null);
const sortBy = ref("name");
const sortDirection = ref<"asc" | "desc">("asc");

const segmentOptions = [
  { label: "Verified for outreach", value: "verified" },
  { label: "Disqualified", value: "disqualified" },
  { label: "Backlog", value: "backlog" },
  { label: "All", value: "all" },
];
const populationOptions = [
  { label: "FoxData cohort", value: "foxdata" },
  { label: "All Wellore companies", value: "all" },
];
const contactPresenceOptions = [
  { label: "People contacts", value: "people" },
  { label: "Google Play email only", value: "gp_email_only" },
  { label: "No contacts", value: "no_contacts" },
];
const channelModeOptions = [
  { label: "Multi-channel", value: "multi" },
  { label: "Email-only", value: "email_only" },
  { label: "LinkedIn-only", value: "linkedin_only" },
  { label: "Google Play email only", value: "gp_support_only" },
];
const priorityOptions = [
  { label: "1 High", value: "1_high_priority" },
  { label: "2 Medium", value: "2_medium_priority" },
  { label: "3 Low", value: "3_low_priority" },
  { label: "4 Disqualified", value: "4_disqualified" },
  { label: "Provisional high", value: "provisional_high_priority" },
  { label: "Provisional medium", value: "provisional_medium_priority" },
  { label: "Insufficient bits", value: "insufficient_bits" },
];
const disqReasonOptions = [
  { label: "no_contact_channel", value: "no_contact_channel" },
  { label: "wrong_geo", value: "wrong_geo" },
  { label: "too_large", value: "too_large" },
  { label: "vendor_domain_artifact", value: "vendor_domain_artifact" },
  { label: "no_usable_domain", value: "no_usable_domain" },
  { label: "no_domain", value: "no_domain" },
];
const recommendedOptions = [
  { label: "email", value: "email" },
  { label: "linkedin", value: "linkedin" },
  { label: "skip", value: "skip" },
];

function clearFilters() {
  searchInput.value = "";
  appliedSearch.value = "";
  contactPresence.value = null;
  channelMode.value = null;
  disqualificationReason.value = null;
  prioritySegment.value = null;
  recommendedChannel.value = null;
  population.value = "foxdata";
  segment.value = "verified";
  sortBy.value = "name";
  sortDirection.value = "asc";
  page.value = 1;
}

const debouncedSearch = useDebounceFn(() => {
  appliedSearch.value = searchInput.value.trim();
  page.value = 1;
}, 300);
watch(searchInput, () => debouncedSearch());

async function fetchCompanies() {
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
      segment: segment.value,
      population: population.value,
      sortBy: sortBy.value,
      sortDirection: sortDirection.value,
    });
    if (appliedSearch.value) q.set("search", appliedSearch.value);
    if (contactPresence.value) q.set("contactPresence", contactPresence.value);
    if (channelMode.value) q.set("channelMode", channelMode.value);
    if (disqualificationReason.value) q.set("disqualificationReason", disqualificationReason.value);
    if (prioritySegment.value) q.set("prioritySegment", prioritySegment.value);
    if (recommendedChannel.value) q.set("recommendedChannel", recommendedChannel.value);

    const r = await fetch(`/api/wellore/companies?${q}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Request failed");
    data.value = (j.data ?? []) as WelloreCompanyRow[];
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
    segment,
    population,
    contactPresence,
    channelMode,
    disqualificationReason,
    prioritySegment,
    recommendedChannel,
    sortBy,
    sortDirection,
  ],
  () => {
    void fetchCompanies();
  },
  { immediate: true }
);

function statusTagType(status: string | null): "success" | "warning" | "error" | "default" | "info" {
  if (!status) return "default";
  if (status.startsWith("launch_ready")) return "success";
  if (status.startsWith("disqualified")) return "error";
  if (status === "qualified_no_contact_found") return "warning";
  return "info";
}

const columns = computed<DataTableColumns<WelloreCompanyRow>>(() => [
  {
    title: "Company",
    key: "name",
    sorter: true,
    render: (row) =>
      h(
        RouterLink,
        { to: `/company/wellore/${row.id}`, class: "company-link" },
        { default: () => row.name || "—" }
      ),
  },
  {
    title: "Domain",
    key: "domain",
    render: (row) => row.domain || "—",
  },
  {
    title: "Status",
    key: "final_verification_status",
    render: (row) =>
      h(
        NTag,
        { size: "small", type: statusTagType(row.final_verification_status), bordered: false },
        { default: () => row.final_verification_status || "unstamped" }
      ),
  },
  {
    title: "Disqualifier",
    key: "disqualification_reason",
    render: (row) => row.disqualification_reason || "—",
  },
  {
    title: "Priority",
    key: "company_priority_segment",
    render: (row) => row.company_priority_segment || "—",
  },
  {
    title: "Contacts",
    key: "contact_presence",
    render: (row) =>
      h(NSpace, { size: 4 }, {
        default: () => [
          h(NTag, { size: "small", bordered: false }, {
            default: () => `${row.people_count} people`,
          }),
          row.gp_support_count > 0
            ? h(NTag, { size: "small", type: "warning", bordered: false }, {
                default: () => `${row.gp_support_count} GP`,
              })
            : null,
        ],
      }),
  },
  {
    title: "Channel",
    key: "channel_mode",
    render: (row) => row.channel_mode || "—",
  },
  {
    title: "Titles",
    key: "best_title",
    render: (row) => {
      const preview = (row.title_preview ?? []).slice(0, 2);
      const label = preview.length ? preview.join(" · ") : row.best_title || "—";
      const counts = `↑${row.upcoming_count ?? 0} / ✓${row.released_count ?? 0}`;
      return h("div", { class: "titles-cell" }, [
        h("div", { class: "titles-main" }, label),
        h("div", { class: "titles-meta" }, counts),
      ]);
    },
  },
  {
    title: "Score",
    key: "score_total",
    render: (row) => (row.score_total == null ? "—" : String(row.score_total)),
  },
  {
    title: "Rec. channel",
    key: "recommended_channel",
    render: (row) => row.recommended_channel || "—",
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
          <BuildingIcon :size="18" class="page-icon" />
          <span class="page-title">Wellore companies</span>
          <NTag size="small" :bordered="false">{{ total }}</NTag>
        </NSpace>
        <NInput
          v-model:value="searchInput"
          placeholder="Search name, domain, title…"
          clearable
          size="small"
          style="width: 260px"
        />
      </div>
    </template>

    <div class="segment-bar">
      <NRadioGroup v-model:value="segment" size="small">
        <NRadioButton
          v-for="opt in segmentOptions"
          :key="opt.value"
          :value="opt.value"
          :label="opt.label"
        />
      </NRadioGroup>
    </div>

    <div class="filters">
      <NSelect v-model:value="population" :options="populationOptions" size="small" />
      <NSelect
        v-model:value="contactPresence"
        :options="contactPresenceOptions"
        placeholder="Contact presence…"
        clearable
        size="small"
      />
      <NSelect
        v-model:value="channelMode"
        :options="channelModeOptions"
        placeholder="Channel…"
        clearable
        size="small"
      />
      <NSelect
        v-model:value="prioritySegment"
        :options="priorityOptions"
        placeholder="Priority…"
        clearable
        size="small"
      />
      <NSelect
        v-model:value="disqualificationReason"
        :options="disqReasonOptions"
        placeholder="Disqualifier…"
        clearable
        size="small"
      />
      <NSelect
        v-model:value="recommendedChannel"
        :options="recommendedOptions"
        placeholder="Recommended…"
        clearable
        size="small"
      />
      <NButton size="small" @click="clearFilters">Clear filters</NButton>
    </div>

    <NAlert v-if="error" type="error" style="margin-bottom: 0.75rem">{{ error }}</NAlert>
    <NEmpty v-else-if="!loading && data.length === 0" description="No companies in this segment" />
    <NDataTable
      v-else
      :columns="columns"
      :data="data"
      :loading="loading"
      :pagination="pagination"
      remote
      size="small"
      :max-height="600"
      :row-key="(row: WelloreCompanyRow) => row.id"
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
.segment-bar { margin-bottom: 0.75rem; }
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.company-link { color: #2080f0; text-decoration: none; }
.company-link:hover { text-decoration: underline; }
.titles-cell { line-height: 1.25; }
.titles-main { font-size: 0.85rem; }
.titles-meta { font-size: 0.75rem; opacity: 0.65; }
</style>
