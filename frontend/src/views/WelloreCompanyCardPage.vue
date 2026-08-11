<script setup lang="ts">
import { ref, computed, watch, h } from "vue";
import { useRoute, RouterLink } from "vue-router";
import {
  NCard,
  NSpace,
  NTag,
  NAlert,
  NSpin,
  NButton,
  NDataTable,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NDivider,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import WelloreScoreIcons from "../components/WelloreScoreIcons.vue";

interface TitleRow {
  id: number;
  title: string | null;
  store: string | null;
  category: string | null;
  status: string | null;
  stage: string | null;
  est_release: string | null;
  rating: number | null;
  installs_band: string | null;
  is_hit: boolean | null;
  package_id: string | null;
  source_url: string | null;
}

interface ContactRow {
  id: number;
  name: string | null;
  title: string | null;
  linkedin_url: string | null;
  email: string | null;
  email_status: string | null;
  source: string | null;
  fit: string | null;
  icp_fit: string | null;
  contact_segment: string | null;
  outreach_list: string | null;
  contact_outreach_eligible: boolean | null;
}

const route = useRoute();
const loading = ref(false);
const error = ref("");
const company = ref<Record<string, unknown> | null>(null);
const titles = ref<TitleRow[]>([]);
const people = ref<ContactRow[]>([]);
const gpSupport = ref<ContactRow[]>([]);

const welloreId = computed(() => {
  const raw = route.params.id;
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : null;
});

async function load() {
  if (!welloreId.value) {
    error.value = "Invalid company id";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch(`/api/wellore/company-card?id=${welloreId.value}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Request failed");
    company.value = (j.data?.company ?? null) as Record<string, unknown> | null;
    titles.value = (j.data?.titles ?? []) as TitleRow[];
    people.value = (j.data?.people ?? []) as ContactRow[];
    gpSupport.value = (j.data?.gp_support ?? []) as ContactRow[];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Request failed";
    company.value = null;
  } finally {
    loading.value = false;
  }
}

watch(welloreId, () => void load(), { immediate: true });

function tag(status: unknown): "success" | "warning" | "error" | "default" | "info" {
  const s = String(status ?? "");
  if (s.startsWith("launch_ready")) return "success";
  if (s.startsWith("disqualified")) return "error";
  if (s === "qualified_no_contact_found") return "warning";
  return "info";
}

const titleColumns: DataTableColumns<TitleRow> = [
  { title: "Title", key: "title", render: (r) => r.title || "—" },
  { title: "Store", key: "store", render: (r) => r.store || "—" },
  { title: "Category", key: "category", render: (r) => r.category || "—" },
  { title: "Status", key: "status", render: (r) => r.status || "—" },
  { title: "Est. release", key: "est_release", render: (r) => r.est_release || "—" },
  { title: "Rating", key: "rating", render: (r) => (r.rating == null ? "—" : String(r.rating)) },
  { title: "Installs", key: "installs_band", render: (r) => r.installs_band || "—" },
  {
    title: "Hit",
    key: "is_hit",
    render: (r) => (r.is_hit ? h(NTag, { size: "small", type: "success", bordered: false }, { default: () => "hit" }) : "—"),
  },
  {
    title: "Link",
    key: "source_url",
    render: (r) =>
      r.source_url
        ? h("a", { href: r.source_url, target: "_blank", rel: "noopener" }, "Open")
        : "—",
  },
];

const contactColumns: DataTableColumns<ContactRow> = [
  { title: "Name", key: "name", render: (r) => r.name || "—" },
  { title: "Title", key: "title", render: (r) => r.title || "—" },
  {
    title: "Email",
    key: "email",
    render: (r) => (r.email ? `${r.email}${r.email_status ? ` (${r.email_status})` : ""}` : "—"),
  },
  {
    title: "LinkedIn",
    key: "linkedin_url",
    render: (r) =>
      r.linkedin_url
        ? h("a", { href: r.linkedin_url, target: "_blank", rel: "noopener" }, "Profile")
        : "—",
  },
  { title: "Source", key: "source", render: (r) => r.source || "—" },
  { title: "Fit", key: "fit", render: (r) => r.fit || r.icp_fit || "—" },
  { title: "Segment", key: "contact_segment", render: (r) => r.contact_segment || "—" },
  { title: "List", key: "outreach_list", render: (r) => r.outreach_list || "—" },
  {
    title: "Eligible",
    key: "contact_outreach_eligible",
    render: (r) => (r.contact_outreach_eligible ? "yes" : "—"),
  },
];

const scoreBits = computed(() => {
  const score = company.value?.score;
  if (!score || typeof score !== "object") return null;
  return score as Record<string, boolean>;
});
</script>

<template>
  <div class="page">
    <NSpace style="margin-bottom: 0.75rem">
      <RouterLink to="/companies">← Companies</RouterLink>
      <RouterLink to="/contacts">Contacts</RouterLink>
    </NSpace>

    <NSpin :show="loading">
      <NAlert v-if="error" type="error">{{ error }}</NAlert>
      <template v-else-if="company">
        <NCard>
          <template #header>
            <div class="header">
              <div>
                <h1 class="title">{{ company.name || "Company" }}</h1>
                <div class="sub">
                  <span v-if="company.domain">{{ company.domain }}</span>
                  <span v-if="company.hq_country"> · {{ company.hq_country }}</span>
                  <span v-if="company.slug"> · {{ company.slug }}</span>
                </div>
              </div>
              <NSpace>
                <NTag :type="tag(company.final_verification_status)" :bordered="false">
                  {{ company.final_verification_status || "unstamped" }}
                </NTag>
                <NTag v-if="company.company_priority_segment" :bordered="false">
                  {{ company.company_priority_segment }}
                </NTag>
                <NButton
                  v-if="company.website"
                  tag="a"
                  :href="String(company.website)"
                  target="_blank"
                  size="small"
                >
                  Website
                </NButton>
                <NButton
                  v-if="company.linkedin_company_url"
                  tag="a"
                  :href="String(company.linkedin_company_url)"
                  target="_blank"
                  size="small"
                >
                  LinkedIn
                </NButton>
              </NSpace>
            </div>
          </template>

          <NSpace class="meta-row">
            <span>People: {{ people.length }}</span>
            <span>GP support: {{ gpSupport.length }}</span>
            <span>Titles: {{ titles.length }}</span>
            <span v-if="company.recommended_channel">Channel: {{ company.recommended_channel }}</span>
            <span v-if="company.disqualification_reason" class="disq">
              Disqualifier: {{ company.disqualification_reason }}
            </span>
          </NSpace>

          <div style="margin: 0.75rem 0 1rem">
            <WelloreScoreIcons
              :score="scoreBits"
              :score-total="company.score_total == null ? null : Number(company.score_total)"
            />
          </div>

          <NDivider />

          <h3>Verification</h3>
          <NSpace style="margin-bottom: 1rem">
            <NTag size="small" :bordered="false">identity: {{ company.identity_verification_status || "—" }}</NTag>
            <NTag size="small" :bordered="false">geo: {{ company.geo_verification_status || "—" }}</NTag>
            <NTag size="small" :bordered="false">size: {{ company.size_verification_status || "—" }}</NTag>
            <NTag size="small" :bordered="false">title: {{ company.title_verification_status || "—" }}</NTag>
            <NTag size="small" :bordered="false">contacts: {{ company.contact_search_status || "—" }}</NTag>
          </NSpace>
          <p v-if="company.company_segment_reason" class="reason">{{ company.company_segment_reason }}</p>

          <h3>Game titles</h3>
          <NEmpty v-if="titles.length === 0" description="No titles attached" />
          <NDataTable
            v-else
            :columns="titleColumns"
            :data="titles"
            size="small"
            :bordered="false"
            :row-key="(r: TitleRow) => r.id"
          />

          <h3 style="margin-top: 1.25rem">People contacts</h3>
          <NEmpty v-if="people.length === 0" description="No named people found" />
          <NDataTable
            v-else
            :columns="contactColumns"
            :data="people"
            size="small"
            :bordered="false"
            :row-key="(r: ContactRow) => r.id"
          />

          <NCollapse style="margin-top: 1rem">
            <NCollapseItem title="Google Play support emails" name="gp">
              <NEmpty v-if="gpSupport.length === 0" description="None" />
              <NDataTable
                v-else
                :columns="contactColumns"
                :data="gpSupport"
                size="small"
                :bordered="false"
                :row-key="(r: ContactRow) => r.id"
              />
            </NCollapseItem>
            <NCollapseItem title="POV / notes" name="pov">
              <pre v-if="company.pov || company.notes" class="pov">{{ company.pov || company.notes }}</pre>
              <NEmpty v-else description="No POV yet" />
            </NCollapseItem>
          </NCollapse>
        </NCard>
      </template>
    </NSpin>
  </div>
</template>

<style scoped>
.page { max-width: 1100px; }
.header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  align-items: flex-start;
}
.title { margin: 0; font-size: 1.35rem; }
.sub { opacity: 0.7; font-size: 0.9rem; margin-top: 0.25rem; }
.meta-row { opacity: 0.85; margin-bottom: 0.5rem; }
.disq { color: #d03050; }
.reason { opacity: 0.8; margin-bottom: 1rem; }
h3 { margin: 0.5rem 0 0.75rem; font-size: 1rem; }
.score-list { margin: 0; padding-left: 1.1rem; }
.pov {
  white-space: pre-wrap;
  font-size: 0.85rem;
  background: rgba(0,0,0,0.04);
  padding: 0.75rem;
  border-radius: 6px;
}
</style>
