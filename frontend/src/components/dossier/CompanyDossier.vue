<script setup lang="ts">
import { computed } from "vue";
import { NCard, NSpace, NTag, NText, NCollapse, NCollapseItem } from "naive-ui";

type HeadlineFact = { fact?: string; type?: string; tier?: number | string; source?: string };
type PainItem = { claim?: string; source?: string };
type JobItem = {
  title?: string;
  date?: string;
  location?: string;
  department?: string;
  status?: string;
};
type Target = {
  name?: string;
  title?: string;
  persona?: string;
  role_type?: string;
  linkedin_url?: string;
  contact_key?: string;
  tenure_months?: number | null;
  profile_highlight?: string;
};
type TeamSignal = {
  dept_headcount?: Record<string, unknown>;
  employees_count?: number | null;
  capacity_gaps?: string[];
  it_contact_count?: number;
  roster_absent?: boolean;
};
type Dossier = {
  pov_ok?: boolean;
  from_contract?: boolean;
  narrative_from_contract?: boolean;
  account_narrative?: string | null;
  hook?: string | null;
  lead_question?: string | null;
  headline_facts?: HeadlineFact[];
  target?: Target | null;
  tech_stack?: unknown[];
  fit_contacts_by_persona?: Record<string, Array<Record<string, unknown>>>;
  fit_score?: number | string | null;
  score_rationale?: string | null;
  vertical?: string | null;
  build_risk?: string | null;
  pressure_points?: unknown[];
  data_integration_pain?: PainItem[];
  transformation_signals?: unknown[];
  discovery_questions?: string[];
  job_postings?: JobItem[];
  leadership_openings?: JobItem[];
  jobs_error?: string | null;
  active_job_postings_count?: number | null;
  job_postings_researched_count?: number | null;
  jobs_window_months?: number | null;
  eligible_contact_count?: number | null;
  discovery_error?: string | null;
  research_source_urls?: string[];
  team_signal?: TeamSignal;
  brief_markdown?: string | null;
  company_name?: string | null;
  as_of?: string | null;
  run_id?: string | null;
};

const META_PAIN_RE = /no public evidence of a data or integration problem/i;
const ROSTER_CAVEAT_RE = /roster was not sampled|not in the sample|roster_absent/i;

const props = defineProps<{
  dossier: Dossier;
  // Set only from the contact page: contact_key or linkedin_url of the contact
  // currently being viewed, so their entry in the persona lanes below is
  // tagged "this contact" instead of rendering identically to their peers.
  highlightContactKey?: string | null;
}>();

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;?/g, "&")
    .replace(/&#38;?/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
function isUrl(s?: string): boolean {
  return !!s && /^https?:\/\//i.test(s);
}
function sourceHost(s: string): string {
  try {
    return new URL(s).hostname.replace(/^www\./, "");
  } catch {
    return s;
  }
}

const facts = computed<HeadlineFact[]>(() => props.dossier.headline_facts ?? []);
// Systems facts duplicate the chips; pain facts have their own block below.
const supportingFacts = computed(() =>
  facts.value.filter((f) => Number(f.tier) >= 2 && f.type !== "systems" && f.type !== "pain")
);
const painItems = computed<PainItem[]>(() =>
  (props.dossier.data_integration_pain ?? []).filter(
    (p) => p && p.claim && !META_PAIN_RE.test(String(p.claim))
  )
);
const tech = computed(() => (props.dossier.tech_stack ?? []).map((t) => String(t)).filter(Boolean));
const narrativeParas = computed(() =>
  String(props.dossier.account_narrative ?? "")
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
);
const jobs = computed<JobItem[]>(() => props.dossier.job_postings ?? []);
const leadOpenings = computed<JobItem[]>(() => props.dossier.leadership_openings ?? []);
const sourceUrls = computed<string[]>(() => props.dossier.research_source_urls ?? []);
const teamSignal = computed<TeamSignal>(() => props.dossier.team_signal ?? {});
const rosterAbsent = computed(() => teamSignal.value.roster_absent === true);

const deptSummary = computed(() => {
  const d = (teamSignal.value.dept_headcount ?? {}) as Record<string, unknown>;
  const bits: string[] = [];
  const techN = Number(d.technical ?? 0);
  const ops = Number(d.operations ?? 0);
  const fin = Number(d.finance ?? 0);
  const admin = Number(d.administrative ?? 0);
  if (techN) bits.push(`Technical: ${techN}`);
  if (ops) bits.push(`Operations: ${ops}`);
  if (fin) bits.push(`Finance: ${fin}`);
  if (admin) bits.push(`Administrative: ${admin}`);
  const total = Number(teamSignal.value.employees_count ?? 0);
  if (total > 0) bits.push(`Employees: ${total}`);
  return bits.join(" · ");
});

const capacityGaps = computed(() => {
  const raw = (teamSignal.value.capacity_gaps ?? []).map(String).filter(Boolean);
  const observations = raw.filter((g) => !ROSTER_CAVEAT_RE.test(g)).slice(0, 2);
  const caveat = raw.find((g) => ROSTER_CAVEAT_RE.test(g)) ?? null;
  return { observations, caveat };
});

// Only claim "no IT leader in sampled roster" when a roster was actually sampled.
const noItLeader = computed(
  () => !rosterAbsent.value && Number(teamSignal.value.it_contact_count ?? 0) === 0
);
const hasOrgSnapshot = computed(
  () =>
    !!deptSummary.value ||
    capacityGaps.value.observations.length > 0 ||
    !!capacityGaps.value.caveat ||
    noItLeader.value ||
    rosterAbsent.value
);

const jobsError = computed(() => String(props.dossier.jobs_error ?? "").trim());
const hasHiringList = computed(() => jobs.value.length > 0 || leadOpenings.value.length > 0);
const jobsWindowMonths = computed(() => {
  const n = Number(props.dossier.jobs_window_months);
  return Number.isFinite(n) && n > 0 ? n : 24;
});
const researchedJobCount = computed(() => {
  const n = Number(props.dossier.job_postings_researched_count);
  return Number.isFinite(n) ? n : jobs.value.length;
});
const activeJobCount = computed(() => {
  const n = Number(props.dossier.active_job_postings_count);
  return Number.isFinite(n) ? n : null;
});

const personaLanes = computed(() => {
  const g = props.dossier.fit_contacts_by_persona ?? {};
  return (["it", "ops", "finance"] as const)
    .map((lane) => ({ lane, contacts: g[lane] ?? [] }))
    .filter((x) => x.contacts.length);
});

const eligibleContactCount = computed(() => {
  const n = Number(props.dossier.eligible_contact_count);
  if (Number.isFinite(n)) return n;
  return personaLanes.value.reduce((sum, lane) => sum + lane.contacts.length, 0);
});
const discoveryError = computed(() => String(props.dossier.discovery_error ?? "").trim());
const contactCoverageNote = computed(() => {
  if (personaLanes.value.length) return "";
  if (discoveryError.value) {
    const short =
      /504|timeout|timed out/i.test(discoveryError.value)
        ? "discovery timed out"
        : discoveryError.value.slice(0, 120);
    return `No eligible contacts — ${short}`;
  }
  if (eligibleContactCount.value === 0 || rosterAbsent.value) {
    return "No eligible contacts after scoring";
  }
  return "";
});

const fitScore = computed(() => {
  const n = Number(props.dossier.fit_score);
  return Number.isFinite(n) ? Math.round(n) : null;
});
const fitMetaClass = computed(() => {
  const s = fitScore.value;
  if (s === null) return "";
  if (s >= 75) return "meta-chip--ok";
  if (s >= 50) return "meta-chip--mid";
  return "meta-chip--low";
});
const buildRiskMetaClass = computed(() => {
  const r = String(props.dossier.build_risk ?? "").toLowerCase();
  if (r === "low") return "meta-chip--ok";
  if (r === "medium" || r === "med") return "meta-chip--mid";
  if (r === "high") return "meta-chip--warn";
  return "";
});
const asOf = computed(() => {
  const d = props.dossier.as_of;
  if (!d) return "";
  const dt = new Date(String(d));
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toISOString().slice(0, 10);
});
const factTypeLabel: Record<string, string> = {
  trigger: "Why now",
  systems: "Systems",
  leadership: "Leadership",
  growth: "Hiring",
  pain: "Pain",
  ma: "M&A",
  profile: "Profile",
};
function laneLabel(lane: string): string {
  return lane === "it" ? "IT / Data" : lane === "ops" ? "Operations" : "Finance";
}
function contactName(c: Record<string, unknown>): string {
  return String(c.name ?? "");
}
function isHighlighted(c: Record<string, unknown>): boolean {
  const key = (props.highlightContactKey ?? "").trim().toLowerCase();
  if (!key) return false;
  const contactKey = String(c.contact_key ?? "").trim().toLowerCase();
  const linkedinUrl = String(c.linkedin_url ?? "").trim().toLowerCase();
  if (contactKey && contactKey === key) return true;
  if (linkedinUrl && (linkedinUrl.includes(key) || key.includes(linkedinUrl))) return true;
  return false;
}
</script>

<template>
  <NCard size="small">
    <template #header>
      <div class="dossier-header">
        <span class="dossier-title">Account dossier</span>
        <div class="dossier-meta" aria-label="Account summary">
          <span v-if="dossier.vertical" class="meta-chip">
            <span class="meta-label">Vertical</span>
            <span class="meta-value">{{ dossier.vertical }}</span>
          </span>
          <span v-if="dossier.build_risk" class="meta-chip" :class="buildRiskMetaClass">
            <span class="meta-label">Build risk</span>
            <span class="meta-value">{{ dossier.build_risk }}</span>
          </span>
          <span v-if="fitScore !== null" class="meta-chip" :class="fitMetaClass">
            <span class="meta-label">Fit</span>
            <span class="meta-value">{{ fitScore }}</span>
          </span>
          <span v-if="!dossier.from_contract" class="meta-chip meta-chip--warn">
            <span class="meta-label">Source</span>
            <span class="meta-value">derived</span>
          </span>
        </div>
      </div>
    </template>

    <div class="dossier-grid">
      <!-- Account narrative (primary analyst block) -->
      <div v-if="narrativeParas.length" class="tile tile-accent tile-wide">
        <div class="tile-label">
          Account narrative<template v-if="!dossier.narrative_from_contract"> · derived, re-run for synthesis</template>
        </div>
        <p v-for="(para, pi) in narrativeParas" :key="pi" class="narrative-p">{{ para }}</p>
      </div>

      <!-- Hook (tier 1, outreach) -->
      <div v-if="dossier.hook" class="tile tile-accent tile-wide">
        <div class="tile-label">Why now · used in outreach</div>
        <div class="tile-hook">{{ dossier.hook }}</div>
      </div>

      <!-- Problem hypothesis / pain (prominent) -->
      <div v-if="painItems.length" class="tile tile-warn tile-wide">
        <div class="tile-label">Problem hypothesis</div>
        <div v-for="(p, pi) in painItems" :key="pi" class="pain-item">
          <span class="tile-fact">{{ p.claim }}</span>
          <a
            v-if="isUrl(p.source)"
            :href="p.source"
            target="_blank"
            rel="noopener"
            class="src-link"
            >{{ sourceHost(String(p.source)) }}</a
          >
          <span v-else-if="p.source && p.source !== 'people_analysis'" class="tile-source">{{ p.source }}</span>
        </div>
      </div>

      <!-- Lead question -->
      <div v-if="dossier.lead_question" class="tile tile-accent tile-wide">
        <div class="tile-label">Lead question · used in outreach</div>
        <div class="tile-lead-q">{{ dossier.lead_question }}</div>
      </div>

      <!-- Systems fingerprint -->
      <div v-if="tech.length" class="tile tile-wide">
        <div class="tile-label">Systems fingerprint · the integration surface</div>
        <NSpace size="small" style="margin-top: 6px">
          <NTag v-for="t in tech" :key="t" size="small" :bordered="true">{{ t }}</NTag>
        </NSpace>
      </div>

      <!-- Supporting facts -->
      <div v-for="(f, i) in supportingFacts" :key="i" class="tile">
        <div class="tile-label">{{ factTypeLabel[String(f.type)] || f.type }}</div>
        <div class="tile-fact">{{ f.fact }}</div>
        <a
          v-if="isUrl(f.source)"
          :href="f.source"
          target="_blank"
          rel="noopener"
          class="src-link"
          >{{ sourceHost(String(f.source)) }}</a
        >
        <div v-else-if="f.source" class="tile-source">{{ f.source }}</div>
      </div>

      <!-- Target -->
      <div v-if="dossier.target" class="tile tile-accent tile-wide">
        <div class="tile-label">Primary target · {{ dossier.target.persona }}</div>
        <div class="tile-target-name">
          {{ dossier.target.name }} — {{ dossier.target.title }}
          <a
            v-if="dossier.target.linkedin_url"
            :href="dossier.target.linkedin_url"
            target="_blank"
            rel="noopener"
            class="tile-link"
            >in</a
          >
        </div>
        <div v-if="dossier.target.profile_highlight" class="tile-target-hl">
          {{ dossier.target.profile_highlight }}
          <span class="tile-source">— LinkedIn summary</span>
        </div>
      </div>

      <!-- Org snapshot -->
      <div v-if="hasOrgSnapshot" class="tile tile-wide">
        <div class="tile-label">Org snapshot</div>
        <div v-if="deptSummary" class="tile-fact">{{ deptSummary }}</div>
        <div v-if="noItLeader" class="tile-fact team-flag">No verified IT leader in the sampled roster.</div>
        <div v-if="rosterAbsent" class="tile-fact tile-muted">Contact roster was not sampled for this run.</div>
        <ul v-if="capacityGaps.observations.length" class="detail-list">
          <li v-for="(g, gi) in capacityGaps.observations" :key="gi">{{ g }}</li>
        </ul>
        <div v-if="capacityGaps.caveat" class="tile-muted">{{ capacityGaps.caveat }}</div>
      </div>

      <!-- Persona lanes -->
      <div v-for="lane in personaLanes" :key="lane.lane" class="tile">
        <div class="tile-label">{{ laneLabel(lane.lane) }} lane</div>
        <div
          v-for="(c, ci) in lane.contacts.slice(0, 3)"
          :key="ci"
          class="tile-contact"
          :class="{ 'tile-contact-self': isHighlighted(c) }"
        >
          {{ contactName(c) }}<span class="tile-contact-title"> · {{ c.title }}</span>
          <span v-if="isHighlighted(c)" class="self-tag">this contact</span>
        </div>
      </div>

      <!-- Contact coverage when lanes are empty -->
      <div v-if="contactCoverageNote" class="tile tile-wide">
        <div class="tile-label">Contacts</div>
        <div class="tile-fact">{{ contactCoverageNote }}</div>
      </div>

      <!-- Hiring (always shown) -->
      <div class="tile tile-wide">
        <div class="tile-label">Hiring</div>
        <template v-if="hasHiringList">
          <div class="tile-muted" style="margin-bottom: 0.35rem">
            IT/data + leadership, last {{ jobsWindowMonths }} months (active and historical)
          </div>
          <div v-for="(j, ji) in jobs" :key="'j' + ji" class="job-item">
            {{ decodeEntities(String(j.title ?? "")) }}
            <span v-if="j.location" class="tile-contact-title"> · {{ j.location }}</span>
            <span v-if="j.date" class="tile-source"> · {{ j.date }}</span>
            <span v-if="j.status" class="tile-source"> · {{ j.status }}</span>
          </div>
          <div v-for="(j, ji) in leadOpenings" :key="'l' + ji" class="job-item">
            {{ decodeEntities(String(j.title ?? "")) }}
            <span class="tile-contact-title"> · leadership</span>
            <span v-if="j.location" class="tile-contact-title"> · {{ j.location }}</span>
            <span v-if="j.date" class="tile-source"> · {{ j.date }}</span>
            <span v-if="j.status" class="tile-source"> · {{ j.status }}</span>
          </div>
        </template>
        <div v-else class="tile-fact">
          IT/data jobs checked (last {{ jobsWindowMonths }} months, active + historical) — none found
          <template v-if="researchedJobCount === 0"> ({{ researchedJobCount }})</template>
          <template v-if="activeJobCount !== null">
            · currently open company-wide: {{ activeJobCount }}
          </template>
        </div>
        <div v-if="jobsError" class="tile-muted">Jobs lookup: {{ jobsError.slice(0, 160) }}</div>
      </div>

      <!-- Sources -->
      <div v-if="sourceUrls.length" class="tile tile-wide">
        <div class="tile-label">Sources ({{ sourceUrls.length }})</div>
        <div class="src-list">
          <a
            v-for="(u, ui) in sourceUrls"
            :key="ui"
            :href="u"
            target="_blank"
            rel="noopener"
            class="src-link"
            >{{ sourceHost(u) }}</a
          >
        </div>
      </div>
    </div>

    <!-- Details drawer -->
    <NCollapse style="margin-top: 12px">
      <NCollapseItem title="Full brief, discovery questions, and rationale" name="details">
        <div v-if="dossier.score_rationale" class="detail-block">
          <div class="tile-label">Why this score</div>
          <NText>{{ dossier.score_rationale }}</NText>
        </div>
        <div v-if="(dossier.discovery_questions ?? []).length" class="detail-block">
          <div class="tile-label">Discovery questions</div>
          <ul class="detail-list">
            <li v-for="(q, qi) in dossier.discovery_questions" :key="qi">{{ q }}</li>
          </ul>
        </div>
        <div v-if="dossier.brief_markdown" class="detail-block">
          <div class="tile-label">Outreach brief</div>
          <pre class="detail-brief">{{ dossier.brief_markdown }}</pre>
        </div>
      </NCollapseItem>
    </NCollapse>

    <div v-if="asOf" class="as-of">as of {{ asOf }}<span v-if="dossier.run_id"> · {{ dossier.run_id }}</span></div>
  </NCard>
</template>

<style scoped>
.dossier-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}
.dossier-title {
  font-weight: 600;
  flex-shrink: 0;
}
.dossier-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.meta-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(148, 163, 184, 0.08);
  font-size: 12px;
  line-height: 1.3;
}
.meta-label {
  opacity: 0.55;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.meta-value {
  font-weight: 600;
  text-transform: capitalize;
}
.meta-chip--ok {
  border-color: rgba(52, 199, 89, 0.45);
  background: rgba(52, 199, 89, 0.1);
}
.meta-chip--mid {
  border-color: rgba(245, 166, 35, 0.45);
  background: rgba(245, 166, 35, 0.1);
}
.meta-chip--low {
  border-color: rgba(255, 149, 0, 0.4);
  background: rgba(255, 149, 0, 0.1);
}
.meta-chip--warn {
  border-color: rgba(255, 69, 58, 0.4);
  background: rgba(255, 69, 58, 0.1);
}
.narrative-p {
  font-size: 15px;
  line-height: 1.55;
  margin: 4px 0 8px;
}
.narrative-p:last-child {
  margin-bottom: 0;
}
.dossier-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.tile {
  border: 1px solid rgba(128, 128, 128, 0.22);
  border-radius: 10px;
  padding: 10px 12px;
}
.tile-wide {
  grid-column: 1 / -1;
}
.tile-accent {
  background: rgba(64, 128, 255, 0.08);
  border-color: rgba(64, 128, 255, 0.28);
}
.tile-warn {
  background: rgba(240, 160, 40, 0.09);
  border-color: rgba(240, 160, 40, 0.3);
}
.tile-label {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  opacity: 0.85;
  margin-bottom: 6px;
}
.tile-hook {
  font-size: 17px;
  font-weight: 500;
  line-height: 1.4;
}
.tile-lead-q {
  font-size: 15px;
  font-weight: 500;
}
.tile-fact {
  font-size: 14px;
  line-height: 1.35;
}
.tile-muted {
  font-size: 12px;
  opacity: 0.6;
  margin-top: 6px;
  line-height: 1.4;
}
.pain-item {
  margin-bottom: 6px;
}
.tile-source {
  font-size: 11px;
  opacity: 0.5;
  margin-top: 4px;
  word-break: break-all;
}
.src-link {
  font-size: 11px;
  opacity: 0.75;
  margin-left: 6px;
  word-break: break-all;
}
.src-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.src-list .src-link {
  margin-left: 0;
}
.job-item {
  font-size: 13px;
  margin-top: 2px;
}
.team-flag {
  font-weight: 500;
}
.tile-target-name {
  font-size: 15px;
  font-weight: 500;
}
.tile-target-hl {
  font-size: 13px;
  opacity: 0.75;
  margin-top: 2px;
}
.tile-link {
  font-size: 12px;
  margin-left: 6px;
  opacity: 0.7;
}
.tile-contact {
  font-size: 13px;
  margin-top: 2px;
}
.tile-contact-title {
  opacity: 0.6;
}
.tile-contact-self {
  font-weight: 500;
}
.self-tag {
  font-size: 10px;
  opacity: 0.6;
  margin-left: 6px;
  border: 1px solid rgba(64, 128, 255, 0.4);
  border-radius: 999px;
  padding: 0 6px;
}
.detail-block {
  margin-bottom: 12px;
}
.detail-list {
  margin: 4px 0 0;
  padding-left: 18px;
}
.detail-list li {
  font-size: 13px;
  line-height: 1.4;
}
.detail-brief {
  white-space: pre-wrap;
  font-size: 12px;
  opacity: 0.85;
  margin: 4px 0 0;
}
.as-of {
  font-size: 11px;
  opacity: 0.45;
  margin-top: 10px;
}
</style>
