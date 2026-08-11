<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NDataTable,
  NInput,
  NSelect,
  NSpace,
  NSpin,
  NTag,
  useMessage,
  type DataTableColumns,
} from "naive-ui";
import { BotIcon, ExternalLinkIcon, SearchIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";
import { WELLORE_PROJECT_ID, isWelloreProjectId } from "../project-ids";
import WelloreScoreIcons from "../components/WelloreScoreIcons.vue";

const GTM_BASE = "https://wellore-gtm-production.up.railway.app";

type Mode = "catalog_only" | "full";
type HermesJob = {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  stage: string;
  progress: number;
  content?: string | null;
  model?: string | null;
  error?: string | null;
  degradedReasons?: string[];
  stages?: Array<{ stage?: string; status?: string; degraded_reasons?: string[] }>;
};
type CompanyHit = {
  id: number;
  name: string | null;
  slug: string | null;
  domain: string | null;
  website: string | null;
  hq_country: string | null;
  company_priority_segment: string | null;
  score_total: number | null;
  people_count: number;
  has_verified_email: boolean;
};
type RunnerResult = {
  slug?: string;
  mode?: string;
  wrote?: boolean;
  company?: { name?: string; domain?: string; existing_segment?: string };
  catalog?: {
    titles?: Array<Record<string, unknown>>;
    source_counts?: Record<string, number>;
    upcoming_count?: number;
  };
  score?: {
    score?: Record<string, unknown>;
    score_total?: number;
    relevanceScore?: number;
    company_priority_segment?: string;
    company_segment_reason?: string;
    disqualification_reason?: string | null;
    outreach_eligible_company?: boolean | null;
    strong_triggers?: string[];
    missing_evidence?: string[];
    verdict_mode?: string;
  };
  contacts_count?: number;
  signals_count?: number;
  pov?: {
    status?: string;
    hook?: string | null;
    summary?: string | null;
    fail_reason?: string | null;
  };
  stages?: Array<{
    stage?: string;
    status?: string;
    degraded_reasons?: string[];
    acceptance?: Record<string, unknown>;
  }>;
  contacts?: Array<Record<string, unknown>>;
};

const store = useProjectStore();
const message = useMessage();

const healthLoading = ref(false);
const healthOk = ref<boolean | null>(null);
const healthError = ref("");
const hermesConfigured = ref(false);

const models = ref<Array<{ label: string; value: string }>>([{ label: "Auto (policy)", value: "auto" }]);
const selectedModel = ref("auto");

const search = ref("");
const searchLoading = ref(false);
const searchHits = ref<CompanyHit[]>([]);
const selected = ref<CompanyHit | null>(null);
const freeCompany = ref("");
const freeSlug = ref("");
const freeDomain = ref("");

const mode = ref<Mode>("catalog_only");
const writeDb = ref(false);
const forceResearch = ref(true);
const allowPaid = ref(false);

const running = ref(false);
const activeJob = ref<HermesJob | null>(null);
const runError = ref("");
const result = ref<RunnerResult | null>(null);
const rawContent = ref("");
const elapsedMs = ref<number | null>(null);
const sessionId = ref(`wellore-${Date.now().toString(36)}`);

const isWellore = computed(() => isWelloreProjectId(store.selectedProjectId));

const companyName = computed(() => selected.value?.name?.trim() || freeCompany.value.trim());
const companySlug = computed(() => selected.value?.slug?.trim() || freeSlug.value.trim());
const companyDomain = computed(
  () => selected.value?.domain?.trim() || freeDomain.value.trim() || companySlug.value
);
const canRun = computed(() => Boolean(companyName.value) && isWellore.value && !running.value);

const scoreBits = computed(() => {
  const score = result.value?.score?.score || {};
  return {
    own_domain: score.own_domain,
    linkedin: score.linkedin,
    store_catalog: score.store_catalog,
    icp_contact_email: score.icp_contact ?? score.icp_contact_email,
    release_in_window: score.release_in_window,
    portfolio_hit: score.portfolio_hit,
    art_or_production_jobs: score.jobs_signal ?? score.art_or_production_jobs,
    money: score.money_signal ?? score.money,
  };
});

const titleRows = computed(() => {
  const titles = result.value?.catalog?.titles || [];
  return titles
    .filter((t) => {
      const storeName = String(t.store || "");
      const title = String(t.title || "");
      if (!title.trim()) return false;
      if (/^(contact us|investors|read more|want to join|get in touch|old classics|partner projects|previous games)/i.test(title)) {
        return false;
      }
      return ["AS", "GP", "google_play", "app_store", "Steam", "steam"].includes(storeName) || Boolean(t.package_id);
    })
    .slice(0, 20)
    .map((t, i) => ({
      key: i,
      title: String(t.title || ""),
      store: String(t.store || ""),
      status: String(t.status || t.stage || ""),
      package_id: String(t.package_id || ""),
    }));
});

const stageRows = computed(() =>
  (result.value?.stages || activeJob.value?.stages || []).map((s, i) => ({
    key: i,
    stage: String(s.stage || ""),
    status: String(s.status || ""),
    reasons: Array.isArray(s.degraded_reasons) ? s.degraded_reasons.join("; ") : "",
  }))
);

const titleColumns: DataTableColumns<(typeof titleRows.value)[number]> = [
  { title: "Title", key: "title", ellipsis: { tooltip: true } },
  { title: "Store", key: "store", width: 90 },
  { title: "Status", key: "status", width: 110 },
];

const stageColumns: DataTableColumns<(typeof stageRows.value)[number]> = [
  { title: "Stage", key: "stage", width: 140 },
  { title: "Status", key: "status", width: 110 },
  { title: "Notes", key: "reasons", ellipsis: { tooltip: true } },
];

watch(mode, (value) => {
  if (value === "catalog_only") {
    allowPaid.value = false;
    writeDb.value = false;
  } else {
    allowPaid.value = true;
  }
});

function statusTone(status: string): "success" | "warning" | "error" | "default" {
  if (status === "complete" || status === "ok") return "success";
  if (status === "degraded" || status === "skipped") return "warning";
  if (status === "failed") return "error";
  return "default";
}

function segmentLabel(seg: string | null | undefined): string {
  if (!seg) return "—";
  return seg.replace(/_/g, " ");
}

function extractJson(content: string): RunnerResult | null {
  const cleaned = content
    .replace(/\n\n⚠️ File-mutation verifier:[\s\S]*$/u, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as RunnerResult;
  } catch {
    return null;
  }
}

function buildPrompt(): string {
  const skill =
    mode.value === "catalog_only" ? "wellore-research-catalog-only" : "wellore-research-company";
  const lines = [
    `Use the ${skill} skill and the deterministic hermes_research runner.`,
    "Do not manually reproduce the pipeline with browser/terminal calls.",
    "Return only the runner result JSON so Voitech can render the dossier. No markdown fence.",
    "",
    `Company: ${companyName.value}`,
    `slug: ${companySlug.value || "<derive-if-needed>"}`,
    `domain: ${companyDomain.value || "<unknown>"}`,
    `website: ${selected.value?.website || (companyDomain.value ? `https://${companyDomain.value}` : "<unknown>")}`,
    `mode: ${mode.value}`,
    `force_research: ${forceResearch.value}`,
    `fresh_run: false`,
    `write: ${writeDb.value}`,
    `allow_paid: ${mode.value === "full" ? allowPaid.value : false}`,
    `run_id: voitech-ui-${Date.now().toString(36)}`,
  ];
  if (!writeDb.value) {
    lines.push("This is a dry run: do not write or alter Supabase.");
  }
  return lines.join("\n");
}

async function refreshHealth(): Promise<void> {
  healthLoading.value = true;
  healthError.value = "";
  try {
    const r = await fetch("/api/hermes/health");
    const j = (await r.json()) as { ok?: boolean; configured?: boolean; error?: string };
    hermesConfigured.value = Boolean(j.configured);
    healthOk.value = Boolean(j.ok);
    if (!j.ok) healthError.value = j.error || `Hermes unhealthy (${r.status})`;
  } catch (e) {
    healthOk.value = false;
    healthError.value = e instanceof Error ? e.message : String(e);
  } finally {
    healthLoading.value = false;
  }
}

async function loadModels(): Promise<void> {
  try {
    const r = await fetch("/api/hermes/models");
    const j = (await r.json()) as { data?: Array<{ id: string; label: string }> };
    const rows = Array.isArray(j.data) ? j.data : [];
    models.value = rows.map((m) => ({ label: m.label || m.id, value: m.id }));
    if (!models.value.some((m) => m.value === selectedModel.value)) selectedModel.value = "auto";
  } catch {
    /* keep defaults */
  }
}

async function searchCompanies(): Promise<void> {
  const q = search.value.trim();
  if (!q || !isWellore.value) return;
  searchLoading.value = true;
  try {
    const params = new URLSearchParams({
      projectId: WELLORE_PROJECT_ID,
      search: q,
      population: "foxdata",
      segment: "all",
      limit: "12",
      offset: "0",
    });
    const r = await fetch(`/api/wellore/companies?${params}`);
    const j = (await r.json()) as { data?: CompanyHit[]; error?: string };
    if (!r.ok) throw new Error(j.error || `Search failed (${r.status})`);
    searchHits.value = Array.isArray(j.data) ? j.data : [];
    if (!searchHits.value.length) message.info("No company matches in Wellore DB");
  } catch (e) {
    searchHits.value = [];
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    searchLoading.value = false;
  }
}

function pickCompany(row: CompanyHit): void {
  selected.value = row;
  freeCompany.value = row.name || "";
  freeSlug.value = row.slug || "";
  freeDomain.value = row.domain || "";
  searchHits.value = [];
  search.value = row.name || "";
}

function clearSelection(): void {
  selected.value = null;
  freeCompany.value = "";
  freeSlug.value = "";
  freeDomain.value = "";
  search.value = "";
  result.value = null;
  rawContent.value = "";
  runError.value = "";
  elapsedMs.value = null;
}

async function pollHermesJob(id: string): Promise<HermesJob> {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(`/api/hermes/jobs?id=${encodeURIComponent(id)}`);
    const body = (await response.json()) as { job?: HermesJob; error?: string };
    if (!response.ok || !body.job) {
      throw new Error(body.error || `Job status failed (${response.status})`);
    }
    activeJob.value = body.job;
    if (body.job.status === "complete" || body.job.status === "failed") return body.job;
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error("Hermes job exceeded the 15-minute UI deadline");
}

async function runResearch(): Promise<void> {
  if (!canRun.value) return;
  if (!isWellore.value) {
    message.error("Select the Wellore project in the header.");
    return;
  }
  running.value = true;
  runError.value = "";
  result.value = null;
  rawContent.value = "";
  elapsedMs.value = null;
  const started = Date.now();
  try {
    const prompt = buildPrompt();
    const r = await fetch("/api/hermes/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: WELLORE_PROJECT_ID,
        model: selectedModel.value,
        sessionId: sessionId.value,
        sessionKey: "wellore-operator",
        messages: [
          {
            role: "system",
            content:
              "You are the Wellore GTM Hermes operator inside Voitech. Run company research only through hermes_research via the named skill. Return the runner JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    const j = (await r.json()) as { job?: HermesJob; error?: string };
    if (!r.ok || !j.job?.id) throw new Error(j.error || `Request failed (${r.status})`);
    activeJob.value = j.job;
    const job = await pollHermesJob(j.job.id);
    elapsedMs.value = Date.now() - started;
    if (job.status === "failed") {
      runError.value = job.error || "Hermes research job failed";
      return;
    }
    rawContent.value = job.content || "";
    const parsed = extractJson(job.content || "");
    if (!parsed) {
      runError.value = "Hermes returned text, but no runnable research JSON. Open raw output below.";
      return;
    }
    result.value = parsed;
    if (parsed.score?.disqualification_reason) {
      message.warning(`Disqualification: ${parsed.score.disqualification_reason}`);
    }
  } catch (e) {
    runError.value = e instanceof Error ? e.message : String(e);
  } finally {
    running.value = false;
  }
}

function openGtm(): void {
  const slug = companySlug.value || result.value?.slug || "";
  window.open(slug ? `${GTM_BASE}/research.html#${encodeURIComponent(slug)}` : GTM_BASE, "_blank");
}

onMounted(async () => {
  await Promise.all([refreshHealth(), loadModels()]);
});
</script>

<template>
  <div class="hermes-page">
    <div class="head">
      <div>
        <h1><BotIcon :size="22" style="vertical-align: -4px; margin-right: 8px" />Hermes research</h1>
        <p class="sub">
          Pick a studio → run catalog or full research → read the dossier. No prompt crafting.
        </p>
      </div>
      <NSpace>
        <NTag :type="healthOk ? 'success' : healthOk === false ? 'error' : 'default'" size="small">
          {{ healthLoading ? "checking…" : healthOk ? "Hermes up" : hermesConfigured ? "Hermes down" : "not configured" }}
        </NTag>
        <NButton size="small" quaternary @click="refreshHealth">Refresh</NButton>
        <NButton size="small" quaternary @click="openGtm">
          <template #icon><ExternalLinkIcon :size="14" /></template>
          Open GTM
        </NButton>
      </NSpace>
    </div>

    <NAlert v-if="!isWellore" type="warning" style="margin-bottom: 12px" :bordered="false">
      Select the <strong>Wellore</strong> project in the header. This console is Wellore-only.
    </NAlert>
    <NAlert v-if="healthError" type="error" style="margin-bottom: 12px" :bordered="false">
      {{ healthError }}
    </NAlert>

    <div class="layout">
      <NCard size="small" title="1. Company">
        <NSpace vertical :size="10">
          <div>
            <div class="lbl">Search Wellore DB</div>
            <div class="search-row">
              <NInput
                v-model:value="search"
                placeholder="Nitro Games"
                :disabled="!isWellore || running"
                @keyup.enter="searchCompanies"
              />
              <NButton :loading="searchLoading" :disabled="!search.trim() || !isWellore" @click="searchCompanies">
                <template #icon><SearchIcon :size="14" /></template>
                Search
              </NButton>
            </div>
          </div>

          <div v-if="searchHits.length" class="hits">
            <button
              v-for="hit in searchHits"
              :key="hit.id"
              type="button"
              class="hit"
              @click="pickCompany(hit)"
            >
              <div class="hit-name">{{ hit.name || "Untitled" }}</div>
              <div class="hit-meta">
                {{ hit.domain || hit.slug || "no domain" }}
                · {{ segmentLabel(hit.company_priority_segment) }}
                · score {{ hit.score_total ?? "—" }}
                · {{ hit.people_count }} contacts
                <span v-if="hit.has_verified_email"> · verified email</span>
              </div>
            </button>
          </div>

          <div v-if="selected" class="selected">
            <div class="selected-top">
              <strong>{{ selected.name }}</strong>
              <NButton size="tiny" quaternary @click="clearSelection">Clear</NButton>
            </div>
            <div class="hit-meta">
              {{ selected.slug }} · {{ selected.domain || "no domain" }} · {{ selected.hq_country || "?" }}
            </div>
            <div class="hit-meta">
              Current: {{ segmentLabel(selected.company_priority_segment) }} · score {{ selected.score_total ?? "—" }}
            </div>
          </div>

          <div v-else>
            <div class="lbl">Or run a new / unknown company</div>
            <NSpace vertical :size="8">
              <NInput v-model:value="freeCompany" placeholder="Company name" :disabled="running" />
              <NInput v-model:value="freeDomain" placeholder="domain.com (optional)" :disabled="running" />
              <NInput v-model:value="freeSlug" placeholder="slug (optional)" :disabled="running" />
            </NSpace>
          </div>
        </NSpace>
      </NCard>

      <NCard size="small" title="2. Run">
        <NSpace vertical :size="12">
          <div>
            <div class="lbl">Mode</div>
            <NSelect
              v-model:value="mode"
              :disabled="running"
              :options="[
                { label: 'Catalog only (free, provisional)', value: 'catalog_only' },
                { label: 'Full research (contacts + POV)', value: 'full' },
              ]"
            />
          </div>
          <div>
            <div class="lbl">Model</div>
            <NSelect v-model:value="selectedModel" :options="models" :disabled="running" />
          </div>
          <NCheckbox v-model:checked="forceResearch" :disabled="running">Force research even if dossier exists</NCheckbox>
          <NCheckbox v-model:checked="writeDb" :disabled="running || mode === 'catalog_only'">
            Write results to Supabase
          </NCheckbox>
          <NCheckbox
            v-if="mode === 'full'"
            v-model:checked="allowPaid"
            :disabled="running"
          >
            Allow paid providers (Prospeo / Parallel)
          </NCheckbox>
          <NAlert v-if="writeDb" type="warning" :bordered="false">
            Write is on. A successful validated run can change the live dossier.
          </NAlert>
          <NAlert v-else type="info" :bordered="false">
            Dry run. Hermes researches and returns a packet; DB stays untouched.
          </NAlert>
          <NButton type="primary" block size="large" :loading="running" :disabled="!canRun" @click="runResearch">
            {{ running ? "Running…" : mode === "catalog_only" ? "Run catalog research" : "Run full research" }}
          </NButton>
          <div v-if="running || activeJob" class="progress">
            <NSpin size="small" />
            <div>
              <div>{{ activeJob ? `${activeJob.stage} · ${activeJob.progress}%` : "Starting job…" }}</div>
              <div v-if="activeJob?.degradedReasons?.length" class="degraded">
                Degraded: {{ activeJob.degradedReasons.join("; ") }}
              </div>
            </div>
          </div>
        </NSpace>
      </NCard>
    </div>

    <NCard size="small" title="3. Result dossier" style="margin-top: 14px">
      <NAlert v-if="runError" type="error" style="margin-bottom: 12px" :bordered="false">{{ runError }}</NAlert>

      <div v-if="!result && !runError && !running" class="empty">
        Search a company, choose catalog or full, then run. You should see segment, score, titles, contacts, POV, and stage health — not a chat dump.
      </div>

      <template v-if="result">
        <div class="result-head">
          <div>
            <h2>{{ result.company?.name || companyName }}</h2>
            <p class="sub">
              {{ result.slug || companySlug || "no slug" }}
              · mode {{ result.mode || mode }}
              · wrote {{ result.wrote ? "yes" : "no" }}
              <span v-if="elapsedMs != null"> · {{ (elapsedMs / 1000).toFixed(1) }}s</span>
            </p>
          </div>
          <NSpace>
            <NTag :type="result.score?.outreach_eligible_company ? 'success' : 'default'">
              {{ segmentLabel(result.score?.company_priority_segment) }}
            </NTag>
            <NTag>
              score {{ result.score?.score_total ?? "—" }}/8
              <span v-if="result.score?.relevanceScore != null"> · relevance {{ result.score.relevanceScore }}</span>
            </NTag>
            <NTag v-if="result.score?.verdict_mode" type="info">{{ result.score.verdict_mode }}</NTag>
          </NSpace>
        </div>

        <p v-if="result.score?.company_segment_reason" class="reason">
          {{ result.score.company_segment_reason }}
        </p>
        <p v-if="result.score?.disqualification_reason" class="dq">
          DQ: {{ result.score.disqualification_reason }}
        </p>

        <div class="score-row">
          <WelloreScoreIcons :score="scoreBits" :score-total="result.score?.score_total ?? null" />
        </div>

        <div class="stat-grid">
          <div class="stat"><div class="stat-v">{{ titleRows.length }}</div><div class="stat-l">Store titles shown</div></div>
          <div class="stat"><div class="stat-v">{{ result.catalog?.upcoming_count ?? 0 }}</div><div class="stat-l">Upcoming</div></div>
          <div class="stat"><div class="stat-v">{{ result.contacts_count ?? (result.contacts?.length ?? 0) }}</div><div class="stat-l">Contacts returned</div></div>
          <div class="stat"><div class="stat-v">{{ result.signals_count ?? 0 }}</div><div class="stat-l">Signals</div></div>
        </div>

        <div class="split">
          <div>
            <h3>Stages</h3>
            <NDataTable :columns="stageColumns" :data="stageRows" size="small" :bordered="false" />
          </div>
          <div>
            <h3>POV</h3>
            <div v-if="result.pov?.status" class="pov-status">
              <NTag :type="statusTone(result.pov.status)" size="small">{{ result.pov.status }}</NTag>
              <span v-if="result.pov.hook" class="hook">{{ result.pov.hook }}</span>
            </div>
            <p class="pov-body">{{ result.pov?.summary || result.pov?.fail_reason || "No POV in this run." }}</p>
          </div>
        </div>

        <h3>Titles</h3>
        <NDataTable
          :columns="titleColumns"
          :data="titleRows"
          size="small"
          :bordered="false"
          :max-height="280"
          empty="No usable store titles in packet"
        />

        <NCollapse style="margin-top: 12px">
          <NCollapseItem title="Raw runner JSON" name="raw">
            <pre class="raw">{{ rawContent || JSON.stringify(result, null, 2) }}</pre>
          </NCollapseItem>
        </NCollapse>
      </template>
    </NCard>
  </div>
</template>

<style scoped>
.hermes-page {
  max-width: 1400px;
  margin: 0 auto;
  color: #f8fafc;
  padding: 8px 4px 32px;
}
.head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 16px;
}
h1 {
  margin: 0 0 4px;
  font-size: 1.35rem;
  font-weight: 650;
}
h2 {
  margin: 0 0 4px;
  font-size: 1.15rem;
}
h3 {
  margin: 16px 0 8px;
  font-size: 0.95rem;
  font-weight: 600;
  opacity: 0.9;
}
.sub {
  margin: 0;
  opacity: 0.72;
  font-size: 0.92rem;
}
.layout {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 14px;
}
@media (max-width: 960px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
.lbl {
  font-size: 12px;
  opacity: 0.7;
  margin-bottom: 4px;
}
.search-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}
.hits {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow: auto;
}
.hit {
  text-align: left;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(15, 23, 42, 0.35);
  color: inherit;
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
}
.hit:hover {
  border-color: rgba(96, 165, 250, 0.55);
}
.hit-name {
  font-weight: 600;
}
.hit-meta {
  font-size: 12px;
  opacity: 0.7;
  margin-top: 2px;
}
.selected {
  border: 1px solid rgba(52, 211, 153, 0.45);
  background: rgba(16, 185, 129, 0.1);
  border-radius: 8px;
  padding: 10px;
}
.selected-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}
.progress {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 0.92rem;
}
.degraded {
  margin-top: 4px;
  color: #fbbf24;
  font-size: 12px;
}
.empty {
  opacity: 0.55;
  padding: 28px 8px;
  line-height: 1.45;
}
.result-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.reason {
  opacity: 0.8;
  margin: 8px 0 0;
}
.dq {
  color: #fca5a5;
  margin: 6px 0 0;
}
.score-row {
  margin: 14px 0;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 8px;
}
@media (max-width: 800px) {
  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.stat {
  background: rgba(148, 163, 184, 0.08);
  border-radius: 8px;
  padding: 10px 12px;
}
.stat-v {
  font-size: 1.25rem;
  font-weight: 650;
}
.stat-l {
  font-size: 12px;
  opacity: 0.65;
}
.split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 960px) {
  .split {
    grid-template-columns: 1fr;
  }
}
.pov-status {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.hook {
  opacity: 0.8;
  font-size: 0.9rem;
}
.pov-body {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.45;
  max-height: 260px;
  overflow: auto;
  opacity: 0.9;
}
.raw {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  max-height: 360px;
  overflow: auto;
}
</style>
