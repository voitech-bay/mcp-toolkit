<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  NCard,
  NSpace,
  NTag,
  NAlert,
  NEmpty,
  NSpin,
  NCollapse,
  NCollapseItem,
  useMessage,
} from "naive-ui";
import { RouterLink } from "vue-router";
import { LightbulbIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";
import { WELLORE_PROJECT_ID } from "../project-ids";

interface HypothesisBrief {
  version?: number;
  thesis?: string;
  who?: { icp?: string; signal?: string; why_now?: string };
  sources?: Array<{ name?: string; role?: string }>;
  research?: {
    steps?: string[];
    exclusions?: string[];
    historical_note?: string;
  };
  scope?: {
    population?: string;
    geos?: string[];
    segment_default?: string;
    companies_query?: { population?: string; segment?: string };
    attach_policy?: string;
  };
  status?: string;
}

interface HypothesisRow {
  id: string;
  name: string;
  description: string | null;
  target_persona: string | null;
  brief: HypothesisBrief | null;
  created_at: string;
  target_count: number;
}

interface CompaniesSummary {
  developers: number;
  with_domain: number;
  gp_support_emails: number;
  named_verified_email_people: number;
  segments?: Record<string, number>;
  contact_presence?: Record<string, number>;
}

interface ContactsSummary {
  people: number;
  gp_support: number;
  all: number;
}

interface TargetPreview {
  id: string;
  name: string | null;
  domain: string | null;
  company_id: string | null;
}

const projectStore = useProjectStore();
const message = useMessage();
const loading = ref(false);
const error = ref("");
const hypotheses = ref<HypothesisRow[]>([]);
const companiesSummary = ref<CompaniesSummary | null>(null);
const contactsSummary = ref<ContactsSummary | null>(null);
const targetsPreview = ref<Record<string, TargetPreview[]>>({});
const targetsLoading = ref<Record<string, boolean>>({});

const isWellore = computed(() => projectStore.selectedProjectId === WELLORE_PROJECT_ID);

async function load() {
  if (!isWellore.value) {
    hypotheses.value = [];
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const [hRes, cRes, pRes] = await Promise.all([
      fetch(`/api/hypotheses?projectId=${WELLORE_PROJECT_ID}`),
      fetch(`/api/wellore/companies-summary?projectId=${WELLORE_PROJECT_ID}&population=foxdata&segment=all`),
      fetch(`/api/wellore/contacts-summary?projectId=${WELLORE_PROJECT_ID}&population=foxdata`),
    ]);
    const hJson = await hRes.json();
    const cJson = await cRes.json();
    const pJson = await pRes.json();
    if (!hRes.ok) throw new Error(hJson.error ?? "Failed to load hypotheses");
    if (!cRes.ok) throw new Error(cJson.error ?? "Failed to load company summary");
    if (!pRes.ok) throw new Error(pJson.error ?? "Failed to load contacts summary");
    hypotheses.value = (hJson.data ?? []) as HypothesisRow[];
    companiesSummary.value = cJson.data as CompaniesSummary;
    contactsSummary.value = pJson.data as ContactsSummary;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Request failed";
    message.error(error.value);
  } finally {
    loading.value = false;
  }
}

async function loadTargetsPreview(id: string) {
  if (targetsPreview.value[id]) return;
  targetsLoading.value = { ...targetsLoading.value, [id]: true };
  try {
    const r = await fetch(`/api/hypotheses/${id}/targets`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed");
    const rows = (j.data ?? []) as TargetPreview[];
    targetsPreview.value = { ...targetsPreview.value, [id]: rows.slice(0, 25) };
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to load targets");
    targetsPreview.value = { ...targetsPreview.value, [id]: [] };
  } finally {
    targetsLoading.value = { ...targetsLoading.value, [id]: false };
  }
}

function welloreCompanyPath(companyUuid: string | null): string | null {
  // Deterministic uuid = md5('wellore:company:'||id); reverse not available in UI.
  // Targets preview links to CRM company if needed; prefer listing via Companies verified.
  return companyUuid ? `/company/${companyUuid}` : null;
}

watch(() => projectStore.selectedProjectId, () => void load(), { immediate: true });
</script>

<template>
  <div class="wellore-hyp">
    <div class="toolbar">
      <NSpace align="center">
        <LightbulbIcon :size="18" class="icon" />
        <span class="title">Wellore hypotheses</span>
        <NTag size="small" :bordered="false">{{ hypotheses.length }}</NTag>
      </NSpace>
    </div>

    <NAlert v-if="error" type="error" style="margin-bottom: 0.75rem">{{ error }}</NAlert>
    <NSpin :show="loading">
      <NEmpty v-if="!loading && hypotheses.length === 0" description="No hypotheses yet" />
      <div v-else class="cards">
        <NCard v-for="h in hypotheses" :key="h.id" class="hyp-card">
          <template #header>
            <div class="card-header">
              <div>
                <div class="name">{{ h.name }}</div>
                <div class="meta">
                  <NTag size="small" :bordered="false">{{ h.brief?.status || "active" }}</NTag>
                  <span>{{ h.target_count }} attached</span>
                  <span>·</span>
                  <span>{{ new Date(h.created_at).toLocaleDateString() }}</span>
                </div>
              </div>
              <NSpace>
                <RouterLink
                  class="cta"
                  :to="{ path: '/companies', query: { segment: 'verified' } }"
                >
                  Open Verified
                </RouterLink>
                <RouterLink class="cta" to="/contacts">Open Contacts</RouterLink>
              </NSpace>
            </div>
          </template>

          <section v-if="h.brief?.thesis" class="section">
            <h3>Thesis</h3>
            <p>{{ h.brief.thesis }}</p>
          </section>

          <section v-if="h.brief?.who" class="section">
            <h3>Who &amp; why</h3>
            <dl class="facts">
              <div v-if="h.brief.who.icp"><dt>ICP</dt><dd>{{ h.brief.who.icp }}</dd></div>
              <div v-if="h.brief.who.signal"><dt>Signal</dt><dd>{{ h.brief.who.signal }}</dd></div>
              <div v-if="h.brief.who.why_now"><dt>Why now</dt><dd>{{ h.brief.who.why_now }}</dd></div>
            </dl>
          </section>

          <section v-if="h.brief?.sources?.length" class="section">
            <h3>Data sources</h3>
            <ul class="plain">
              <li v-for="(s, i) in h.brief.sources" :key="i">
                <strong>{{ s.name }}</strong>
                <span v-if="s.role" class="muted"> — {{ s.role }}</span>
              </li>
            </ul>
          </section>

          <section v-if="h.brief?.research" class="section">
            <h3>Research trail</h3>
            <ol v-if="h.brief.research.steps?.length" class="plain">
              <li v-for="(step, i) in h.brief.research.steps" :key="i">{{ step }}</li>
            </ol>
            <div v-if="h.brief.research.exclusions?.length" class="exclusions">
              <div class="subhead">Exclusions</div>
              <ul class="plain">
                <li v-for="(ex, i) in h.brief.research.exclusions" :key="i">{{ ex }}</li>
              </ul>
            </div>
            <p v-if="h.brief.research.historical_note" class="note">
              {{ h.brief.research.historical_note }}
            </p>
          </section>

          <section class="section">
            <h3>Live readiness</h3>
            <div class="metrics">
              <div class="metric">
                <div class="v">{{ companiesSummary?.developers ?? "—" }}</div>
                <div class="l">Developers (All)</div>
              </div>
              <div class="metric">
                <div class="v">{{ companiesSummary?.with_domain ?? "—" }}</div>
                <div class="l">With own domain</div>
              </div>
              <div class="metric">
                <div class="v">{{ companiesSummary?.gp_support_emails ?? "—" }}</div>
                <div class="l">GP support emails</div>
              </div>
              <div class="metric">
                <div class="v">{{ companiesSummary?.named_verified_email_people ?? "—" }}</div>
                <div class="l">Named verified-email</div>
              </div>
            </div>
          </section>

          <section class="section">
            <h3>Cohort breakdown</h3>
            <dl class="facts">
              <div>
                <dt>Verified</dt>
                <dd>
                  {{ companiesSummary?.segments?.verified ?? "—" }}
                  <span class="muted">
                    ({{ companiesSummary?.segments?.verified_email ?? "—" }} email /
                    {{ companiesSummary?.segments?.verified_linkedin ?? "—" }} LinkedIn)
                  </span>
                </dd>
              </div>
              <div>
                <dt>Disqualified</dt>
                <dd>{{ companiesSummary?.segments?.disqualified ?? "—" }}</dd>
              </div>
              <div>
                <dt>Backlog</dt>
                <dd>{{ companiesSummary?.segments?.backlog ?? "—" }}</dd>
              </div>
              <div>
                <dt>All</dt>
                <dd>{{ companiesSummary?.segments?.all ?? "—" }}</dd>
              </div>
              <div>
                <dt>Contact presence</dt>
                <dd>
                  people {{ companiesSummary?.contact_presence?.people ?? "—" }} ·
                  GP-only {{ companiesSummary?.contact_presence?.gp_email_only ?? "—" }} ·
                  none {{ companiesSummary?.contact_presence?.no_contacts ?? "—" }}
                </dd>
              </div>
              <div>
                <dt>Contacts</dt>
                <dd>
                  people {{ contactsSummary?.people ?? "—" }} ·
                  GP {{ contactsSummary?.gp_support ?? "—" }} ·
                  all {{ contactsSummary?.all ?? "—" }}
                </dd>
              </div>
              <div>
                <dt>Attached (source population)</dt>
                <dd>{{ h.target_count }} — provenance for this hyp</dd>
              </div>
            </dl>
          </section>

          <NCollapse @item-header-click="() => loadTargetsPreview(h.id)">
            <NCollapseItem title="Attached companies preview" :name="h.id">
              <NSpin :show="!!targetsLoading[h.id]">
                <NEmpty
                  v-if="!targetsLoading[h.id] && !(targetsPreview[h.id]?.length)"
                  description="No preview loaded"
                />
                <ul v-else class="plain preview">
                  <li v-for="t in targetsPreview[h.id] || []" :key="t.id">
                    <a
                      v-if="welloreCompanyPath(t.company_id)"
                      :href="welloreCompanyPath(t.company_id)!"
                      class="cta"
                    >{{ t.name || t.domain || t.company_id }}</a>
                    <span v-else>{{ t.name || t.domain || "—" }}</span>
                    <span v-if="t.domain" class="muted"> · {{ t.domain }}</span>
                  </li>
                </ul>
                <p class="muted">Showing first {{ (targetsPreview[h.id] || []).length }} of {{ h.target_count }}.</p>
              </NSpin>
            </NCollapseItem>
          </NCollapse>
        </NCard>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.wellore-hyp { display: flex; flex-direction: column; gap: 1rem; }
.toolbar { display: flex; align-items: center; justify-content: space-between; }
.icon { opacity: 0.7; }
.title { font-size: 1.1rem; font-weight: 600; }
.cards { display: flex; flex-direction: column; gap: 1rem; }
.card-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  align-items: flex-start;
}
.name { font-size: 1.15rem; font-weight: 700; }
.meta {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.35rem;
  font-size: 0.85rem;
  color: #6b7280;
  flex-wrap: wrap;
}
.section { margin-bottom: 1.1rem; }
.section h3 {
  margin: 0 0 0.4rem;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6b7280;
}
.section p { margin: 0; line-height: 1.45; }
.facts {
  display: grid;
  gap: 0.55rem;
  margin: 0;
}
.facts > div {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 0.5rem;
}
.facts dt { color: #6b7280; font-weight: 600; font-size: 0.85rem; }
.facts dd { margin: 0; }
.plain { margin: 0; padding-left: 1.1rem; }
.plain.preview { max-height: 240px; overflow: auto; }
.muted { color: #9ca3af; }
.note {
  margin-top: 0.65rem;
  padding: 0.65rem 0.75rem;
  background: #f8fafc;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  color: #4b5563;
  font-size: 0.9rem;
}
.subhead { font-weight: 600; margin: 0.5rem 0 0.25rem; font-size: 0.85rem; }
.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.metric {
  background: #fafbfc;
  border: 1px solid #e8eaed;
  border-radius: 8px;
  padding: 10px 12px;
}
.metric .v {
  font-size: 20px;
  font-weight: 700;
  color: #2563eb;
  font-variant-numeric: tabular-nums;
}
.metric .l { font-size: 12px; color: #6b7280; margin-top: 2px; }
.cta { color: #2080f0; text-decoration: none; font-weight: 600; }
.cta:hover { text-decoration: underline; }
@media (max-width: 900px) {
  .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .facts > div { grid-template-columns: 1fr; }
}
</style>
