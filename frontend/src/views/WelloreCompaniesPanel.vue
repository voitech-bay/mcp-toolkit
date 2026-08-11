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
  NRadioGroup,
  NRadioButton,
  NCollapse,
  NCollapseItem,
  NSpin,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { RouterLink } from "vue-router";
import { BuildingIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";
import { WELLORE_PROJECT_ID } from "../project-ids";
import WelloreScoreIcons from "../components/WelloreScoreIcons.vue";

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
  score: Record<string, true | false | "unknown"> | null;
  name_quality?: "ok" | "likely_app_title";
  recommended_channel: string | null;
  source_list: string | null;
  hq_country: string | null;
}

interface SummaryData {
  developers: number;
  with_domain: number;
  gp_support_emails: number;
  named_verified_email_people: number;
  segments?: Record<string, number>;
  facets?: { geos?: string[]; source_lists?: string[] };
}

interface ExpandTitle {
  id: number;
  title: string | null;
  store: string | null;
  category: string | null;
  status: string | null;
  est_release: string | null;
  rating: number | null;
  installs_band: string | null;
}
interface ExpandPerson {
  id: number;
  name: string | null;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
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
const hasDomain = ref<string | null>(null);
const hqCountry = ref<string | null>(null);
const sourceList = ref<string | null>(null);
const channelMode = ref<string | null>(null);
const disqualificationReason = ref<string | null>(null);
const prioritySegment = ref<string | null>(null);
const recommendedChannel = ref<string | null>(null);
const sortBy = ref("name");
const sortDirection = ref<"asc" | "desc">("asc");

const summary = ref<SummaryData | null>(null);
const summaryLoading = ref(false);
const expandedRowKeys = ref<Array<string | number>>([]);
const expandCache = ref<
  Record<number, { titles: ExpandTitle[]; people: ExpandPerson[]; gp: number; loading: boolean; error: string }>
>({});

const segmentOptions = [
  { label: "Verified for outreach", value: "verified" },
  { label: "Disqualified", value: "disqualified" },
  { label: "Backlog", value: "backlog" },
  { label: "All", value: "all" },
];
const contactPresenceOptions = [
  { label: "People", value: "people" },
  { label: "GP email only", value: "gp_email_only" },
  { label: "No contacts", value: "no_contacts" },
  { label: "Any", value: "any" },
];
const domainOptions = [
  { label: "Has domain", value: "yes" },
  { label: "No domain", value: "no" },
];
const pageSizeOptions = [
  { label: "10 / page", value: 10 },
  { label: "25 / page", value: 25 },
  { label: "50 / page", value: 50 },
];

const geoOptions = computed(() =>
  (summary.value?.facets?.geos ?? []).map((g) => ({ label: g, value: g }))
);
const runOptions = computed(() =>
  (summary.value?.facets?.source_lists ?? []).map((s) => ({ label: humanizeRun(s), value: s }))
);

function humanizeRun(raw: string | null): string {
  if (!raw) return "—";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\bfoxdata\b/gi, "FoxData")
    .replace(/\buae\b/gi, "UAE")
    .replace(/\bvn\b/gi, "VN");
}

function statusLabel(status: string | null): string {
  if (!status) return "backlog";
  if (status.startsWith("launch_ready")) return "outreach ready";
  if (status.startsWith("disqualified")) return "disqualified";
  if (status === "qualified_no_contact_found") return "backlog";
  return status;
}

function statusClass(status: string | null): string {
  if (status?.startsWith("launch_ready")) return "pill ok";
  if (status?.startsWith("disqualified")) return "pill stop";
  return "pill muted";
}

function clearFilters() {
  searchInput.value = "";
  appliedSearch.value = "";
  contactPresence.value = null;
  hasDomain.value = null;
  hqCountry.value = null;
  sourceList.value = null;
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
      segment: segment.value,
    });
    const r = await fetch(`/api/wellore/companies-summary?${q}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Summary failed");
    summary.value = j.data as SummaryData;
  } catch (e) {
    summary.value = null;
    message.error(e instanceof Error ? e.message : "Summary failed");
  } finally {
    summaryLoading.value = false;
  }
}

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
    if (hasDomain.value) q.set("hasDomain", hasDomain.value);
    if (hqCountry.value) q.set("hqCountry", hqCountry.value);
    if (sourceList.value) q.set("sourceList", sourceList.value);
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

async function loadExpand(id: number) {
  const existing = expandCache.value[id];
  if (existing && !existing.loading && !existing.error && (existing.titles.length || existing.people.length || existing.gp)) {
    return;
  }
  expandCache.value = {
    ...expandCache.value,
    [id]: { titles: [], people: [], gp: 0, loading: true, error: "" },
  };
  try {
    const r = await fetch(`/api/wellore/company-card?id=${id}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to load dossier");
    expandCache.value = {
      ...expandCache.value,
      [id]: {
        titles: ((j.data?.titles ?? []) as ExpandTitle[]).slice(0, 10),
        people: (j.data?.people ?? []) as ExpandPerson[],
        gp: Number(j.data?.counts?.gp_support ?? 0),
        loading: false,
        error: "",
      },
    };
  } catch (e) {
    expandCache.value = {
      ...expandCache.value,
      [id]: {
        titles: [],
        people: [],
        gp: 0,
        loading: false,
        error: e instanceof Error ? e.message : "Failed",
      },
    };
  }
}

watch(expandedRowKeys, (keys) => {
  for (const k of keys) {
    const id = Number(k);
    if (Number.isFinite(id)) void loadExpand(id);
  }
});

watch(
  [() => projectStore.selectedProjectId, segment, population],
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
    segment,
    population,
    contactPresence,
    hasDomain,
    hqCountry,
    sourceList,
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

const rangeLabel = computed(() => {
  if (total.value === 0) return "Showing 0 of 0";
  const start = (page.value - 1) * pageSize.value + 1;
  const end = Math.min(page.value * pageSize.value, total.value);
  return `Showing ${start}–${end} of ${total.value}`;
});

const columns = computed<DataTableColumns<WelloreCompanyRow>>(() => [
  {
    type: "expand",
    expandable: () => true,
    renderExpand: (row) => {
      const cache = expandCache.value[row.id];
      if (!cache || cache.loading) {
        return h("div", { class: "expand-body" }, [h(NSpin, { size: "small" })]);
      }
      if (cache.error) return h("div", { class: "expand-body" }, cache.error);
      return h("div", { class: "expand-body" }, [
        h("div", { class: "expand-section" }, [
          h("div", { class: "expand-title" }, "Titles"),
          cache.titles.length === 0
            ? h("div", { class: "muted" }, "No titles")
            : h("table", { class: "titles-table" }, [
                h("thead", {}, [
                  h("tr", {}, [
                    h("th", {}, "Title"),
                    h("th", {}, "Store"),
                    h("th", {}, "Category"),
                    h("th", {}, "Status"),
                    h("th", {}, "Est. release"),
                    h("th", {}, "Rating"),
                    h("th", {}, "Installs"),
                  ]),
                ]),
                h(
                  "tbody",
                  {},
                  cache.titles.map((t) =>
                    h("tr", { key: t.id }, [
                      h("td", {}, t.title || "—"),
                      h("td", {}, t.store || "—"),
                      h("td", {}, t.category || "—"),
                      h("td", {}, t.status || "—"),
                      h("td", {}, t.est_release || "—"),
                      h("td", {}, t.rating == null ? "—" : String(t.rating)),
                      h("td", {}, t.installs_band || "—"),
                    ])
                  )
                ),
              ]),
        ]),
        h("div", { class: "expand-section" }, [
          h("div", { class: "expand-title" }, `Named contacts (${cache.people.length})`),
          cache.people.length === 0
            ? h("div", { class: "muted" }, "No named people")
            : h(
                "ul",
                { class: "people-list" },
                cache.people.slice(0, 12).map((p) =>
                  h("li", { key: p.id }, [
                    h("strong", {}, p.name || "—"),
                    p.title ? ` · ${p.title}` : "",
                    p.email ? ` · ${p.email}` : "",
                  ])
                )
              ),
          cache.gp > 0 ? h("div", { class: "muted" }, `${cache.gp} Google Play support email(s) hidden`) : null,
        ]),
      ]);
    },
  },
  {
    title: "Company",
    key: "name",
    sorter: true,
    render: (row) =>
      h("div", { class: "company-cell" }, [
        h(
          RouterLink,
          { to: `/company/wellore/${row.id}`, class: "company-link" },
          { default: () => row.name || "—" }
        ),
        row.best_title
          ? h("div", { class: "muted company-subtitle" }, row.best_title)
          : null,
        row.name_quality === "likely_app_title"
          ? h("span", { class: "name-badge" }, "Likely app title")
          : null,
      ]),
  },
  {
    title: "Domain",
    key: "domain",
    render: (row) =>
      row.domain
        ? h("a", { href: `https://${row.domain}`, target: "_blank", rel: "noopener", class: "company-link" }, row.domain)
        : h("span", { class: "muted" }, "none"),
  },
  {
    title: "Geo",
    key: "hq_country",
    render: (row) => row.hq_country || "—",
  },
  {
    title: "Released",
    key: "released_count",
    width: 90,
    render: (row) => String(row.released_count ?? 0),
  },
  {
    title: "Announcements",
    key: "upcoming_count",
    width: 120,
    render: (row) => String(row.upcoming_count ?? 0),
  },
  {
    title: "Score",
    key: "score_total",
    width: 280,
    render: (row) =>
      h(WelloreScoreIcons, {
        score: row.score,
        scoreTotal: row.score_total,
      }),
  },
  {
    title: "Status",
    key: "final_verification_status",
    render: (row) => h("span", { class: statusClass(row.final_verification_status) }, statusLabel(row.final_verification_status)),
  },
  {
    title: "Run",
    key: "source_list",
    render: (row) => humanizeRun(row.source_list),
  },
]);

const pagination = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  itemCount: total.value,
  showSizePicker: true,
  pageSizes: [10, 25, 50],
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
        </NSpace>
      </div>
    </template>

    <div class="metrics">
      <div class="metric">
        <div class="v">{{ summaryLoading ? "…" : (summary?.developers ?? "—") }}</div>
        <div class="l">Developers in list</div>
      </div>
      <div class="metric">
        <div class="v">{{ summaryLoading ? "…" : (summary?.with_domain ?? "—") }}</div>
        <div class="l">With own domain</div>
      </div>
      <div class="metric">
        <div class="v">{{ summaryLoading ? "…" : (summary?.gp_support_emails ?? "—") }}</div>
        <div class="l">GP support emails</div>
      </div>
      <div class="metric">
        <div class="v">{{ summaryLoading ? "…" : (summary?.named_verified_email_people ?? "—") }}</div>
        <div class="l">Named verified-email people</div>
      </div>
    </div>

    <div class="segment-bar">
      <NRadioGroup v-model:value="segment" size="small">
        <NRadioButton
          v-for="opt in segmentOptions"
          :key="opt.value"
          :value="opt.value"
          :label="opt.label"
        />
      </NRadioGroup>
      <span class="range">{{ rangeLabel }}</span>
    </div>

    <div class="filters">
      <NInput
        v-model:value="searchInput"
        placeholder="Studio or domain…"
        clearable
        size="small"
      />
      <NSelect
        v-model:value="hqCountry"
        :options="geoOptions"
        placeholder="Geo"
        clearable
        filterable
        size="small"
      />
      <NSelect
        v-model:value="hasDomain"
        :options="domainOptions"
        placeholder="Domain"
        clearable
        size="small"
      />
      <NSelect
        v-model:value="contactPresence"
        :options="contactPresenceOptions"
        placeholder="Contact"
        clearable
        size="small"
      />
      <NSelect
        v-model:value="sourceList"
        :options="runOptions"
        placeholder="Run"
        clearable
        filterable
        size="small"
      />
      <NSelect
        v-model:value="pageSize"
        :options="pageSizeOptions"
        size="small"
        :consistent-menu-width="false"
      />
      <NButton size="small" @click="clearFilters">Clear</NButton>
    </div>

    <NCollapse class="advanced">
      <NCollapseItem title="Advanced filters" name="adv">
        <div class="filters">
          <NSelect
            v-model:value="channelMode"
            :options="[
              { label: 'Multi-channel', value: 'multi' },
              { label: 'Email-only', value: 'email_only' },
              { label: 'LinkedIn-only', value: 'linkedin_only' },
              { label: 'GP support only', value: 'gp_support_only' },
            ]"
            placeholder="Channel mode…"
            clearable
            size="small"
          />
          <NSelect
            v-model:value="prioritySegment"
            :options="[
              { label: '1 High', value: '1_high_priority' },
              { label: '2 Medium', value: '2_medium_priority' },
              { label: '3 Low', value: '3_low_priority' },
              { label: '4 Disqualified', value: '4_disqualified' },
            ]"
            placeholder="Priority…"
            clearable
            size="small"
          />
          <NSelect
            v-model:value="disqualificationReason"
            :options="[
              { label: 'no_contact_channel', value: 'no_contact_channel' },
              { label: 'wrong_geo', value: 'wrong_geo' },
              { label: 'too_large', value: 'too_large' },
              { label: 'no_usable_domain', value: 'no_usable_domain' },
              { label: 'no_domain', value: 'no_domain' },
            ]"
            placeholder="Disqualifier…"
            clearable
            size="small"
          />
          <NSelect
            v-model:value="recommendedChannel"
            :options="[
              { label: 'email', value: 'email' },
              { label: 'linkedin', value: 'linkedin' },
              { label: 'skip', value: 'skip' },
            ]"
            placeholder="Recommended…"
            clearable
            size="small"
          />
        </div>
      </NCollapseItem>
    </NCollapse>

    <NAlert v-if="error" type="error" style="margin-bottom: 0.75rem">{{ error }}</NAlert>
    <NEmpty v-else-if="!loading && data.length === 0" description="No companies in this segment" />
    <NDataTable
      v-else
      v-model:expanded-row-keys="expandedRowKeys"
      :columns="columns"
      :data="data"
      :loading="loading"
      :pagination="pagination"
      remote
      size="small"
      :max-height="620"
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
.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
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
.segment-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}
.range { font-size: 12px; color: #6b7280; }
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.advanced { margin-bottom: 0.75rem; }
.company-link { color: #2080f0; text-decoration: none; font-weight: 600; }
.company-link:hover { text-decoration: underline; }
.company-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.company-subtitle { font-size: 0.8em; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name-badge {
  display: inline-block;
  margin-top: 2px;
  font-size: 0.7rem;
  font-weight: 600;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #f59e0b;
  border-radius: 4px;
  padding: 1px 6px;
}
.muted { color: #9ca3af; }
.pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background: #f3f4f6;
  color: #4b5563;
}
.pill.ok { background: #dcfce7; color: #166534; }
.pill.stop { background: #fee2e2; color: #991b1b; }
.pill.muted { background: #f3f4f6; color: #6b7280; }
.expand-body { padding: 8px 4px 12px; }
.expand-section { margin-bottom: 12px; }
.expand-title { font-weight: 600; margin-bottom: 6px; }
.titles-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.titles-table th,
.titles-table td {
  border-bottom: 1px solid #eee;
  text-align: left;
  padding: 4px 8px;
  vertical-align: top;
}
.titles-table th { color: #6b7280; font-weight: 600; }
.people-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
}
@media (max-width: 900px) {
  .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
