<script setup lang="ts">
import { computed } from "vue";
import { NCard, NSpace, NTag, NText, NCollapse, NCollapseItem } from "naive-ui";

type HeadlineFact = { fact?: string; type?: string; tier?: number | string; source?: string };
type PainItem = { claim?: string; source?: string };
type JobItem = { title?: string; date?: string; location?: string; department?: string };
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
  capacity_gaps?: string[];
  it_contact_count?: number;
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
  research_source_urls?: string[];
  team_signal?: TeamSignal;
  brief_markdown?: string | null;
  company_name?: string | null;
  as_of?: string | null;
  run_id?: string | null;
};

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
  (props.dossier.data_integration_pain ?? []).filter((p) => p && p.claim)
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
const deptSummary = computed(() => {
  const d = (teamSignal.value.dept_headcount ?? {}) as Record<string, unknown>;
  const bits: string[] = [];
  const tech = Number(d.technical ?? 0);
  const ops = Number(d.operations ?? 0);
  const fin = Number(d.finance ?? 0);
  if (tech) bits.push(`Technical ${tech}`);
  if (ops) bits.push(`Operations ${ops}`);
  if (fin) bits.push(`Finance ${fin}`);
  return bits.join(" · ");
});
const noItLeader = computed(() => Number(teamSignal.value.it_contact_count ?? 0) === 0);
const hasTeamSignal = computed(
  () => !!deptSummary.value || (teamSignal.value.capacity_gaps ?? []).length > 0 || noItLeader.value
);

const fitScore = computed(() => {
  const n = Number(props.dossier.fit_score);
  return Number.isFinite(n) ? Math.round(n) : null;
});
const scoreTone = computed(() => {
  const s = fitScore.value;
  if (s === null) return "default";
  if (s >= 75) return "success";
  if (s >= 50) return "warning";
  return "default";
});
const personaLanes = computed(() => {
  const g = props.dossier.fit_contacts_by_persona ?? {};
  return (["it", "ops", "finance"] as const)
    .map((lane) => ({ lane, contacts: g[lane] ?? [] }))
    .filter((x) => x.contacts.length);
});
const asOf = computed(() => {
  const d = props.dossier.as_of;
  if (!d) return "";
  const dt = new Date(String(d));
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toISOString().slice(0, 10);
});
const factTypeLabel: Record<string, string> = {
  trigger: "why now",
  systems: "systems",
  leadership: "leadership",
  growth: "hiring",
  pain: "pain",
  ma: "M&A",
  profile: "profile",
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
      <NSpace align="center" size="small">
        <span class="dossier-title">Account dossier</span>
        <NTag v-if="dossier.vertical" size="small" round :bordered="false">{{ dossier.vertical }}</NTag>
        <NTag v-if="dossier.build_risk" size="small" round :bordered="false">build risk: {{ dossier.build_risk }}</NTag>
        <NTag v-if="!dossier.from_contract" size="small" round :bordered="false" type="warning">derived</NTag>
      </NSpace>
    </template>
    <template #header-extra>
      <NTag v-if="fitScore !== null" :type="scoreTone" size="small" round>fit {{ fitScore }}</NTag>
    </template>

    <!-- Account narrative (hero) -->
    <div v-if="narrativeParas.length" class="narrative">
      <div class="tile-label">
        account narrative<template v-if="!dossier.narrative_from_contract"> · derived, re-run for synthesis</template>
      </div>
      <p v-for="(para, pi) in narrativeParas" :key="pi" class="narrative-p">{{ para }}</p>
    </div>

    <div class="dossier-grid">
      <!-- Hook (tier 1, outreach) -->
      <div v-if="dossier.hook" class="tile tile-accent tile-wide">
        <div class="tile-label">why now · used in outreach</div>
        <div class="tile-hook">{{ dossier.hook }}</div>
      </div>

      <!-- Problem hypothesis / pain (prominent) -->
      <div v-if="painItems.length" class="tile tile-warn tile-wide">
        <div class="tile-label">problem hypothesis</div>
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
          <span v-else-if="p.source" class="tile-source">{{ p.source }}</span>
        </div>
      </div>

      <!-- Lead question -->
      <div v-if="dossier.lead_question" class="tile tile-accent tile-wide">
        <div class="tile-label">lead question · used in outreach</div>
        <div class="tile-lead-q">{{ dossier.lead_question }}</div>
      </div>

      <!-- Systems fingerprint -->
      <div v-if="tech.length" class="tile tile-wide">
        <div class="tile-label">systems fingerprint · the integration surface</div>
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
        <div class="tile-label">primary target · {{ dossier.target.persona }}</div>
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

      <!-- Team signal -->
      <div v-if="hasTeamSignal" class="tile tile-wide">
        <div class="tile-label">team signal</div>
        <div v-if="deptSummary" class="tile-fact">{{ deptSummary }}</div>
        <div v-if="noItLeader" class="tile-fact team-flag">No verified IT leader in the sampled roster.</div>
        <ul v-if="(teamSignal.capacity_gaps ?? []).length" class="detail-list">
          <li v-for="(g, gi) in teamSignal.capacity_gaps" :key="gi">{{ g }}</li>
        </ul>
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

      <!-- Job postings + leadership openings -->
      <div v-if="jobs.length || leadOpenings.length" class="tile tile-wide">
        <div class="tile-label">hiring signals</div>
        <div v-for="(j, ji) in jobs" :key="'j' + ji" class="job-item">
          {{ decodeEntities(String(j.title ?? "")) }}
          <span v-if="j.location" class="tile-contact-title"> · {{ j.location }}</span>
          <span v-if="j.date" class="tile-source"> · {{ j.date }}</span>
        </div>
        <div v-for="(j, ji) in leadOpenings" :key="'l' + ji" class="job-item">
          {{ decodeEntities(String(j.title ?? "")) }}
          <span class="tile-contact-title"> · open seat</span>
          <span v-if="j.location" class="tile-contact-title"> · {{ j.location }}</span>
        </div>
      </div>

      <!-- Sources -->
      <div v-if="sourceUrls.length" class="tile tile-wide">
        <div class="tile-label">sources ({{ sourceUrls.length }})</div>
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
          <div class="tile-label">why this score</div>
          <NText>{{ dossier.score_rationale }}</NText>
        </div>
        <div v-if="(dossier.discovery_questions ?? []).length" class="detail-block">
          <div class="tile-label">discovery questions</div>
          <ul class="detail-list">
            <li v-for="(q, qi) in dossier.discovery_questions" :key="qi">{{ q }}</li>
          </ul>
        </div>
        <div v-if="dossier.brief_markdown" class="detail-block">
          <div class="tile-label">outreach brief</div>
          <pre class="detail-brief">{{ dossier.brief_markdown }}</pre>
        </div>
      </NCollapseItem>
    </NCollapse>

    <div v-if="asOf" class="as-of">as of {{ asOf }}<span v-if="dossier.run_id"> · {{ dossier.run_id }}</span></div>
  </NCard>
</template>

<style scoped>
.dossier-title {
  font-weight: 600;
}
.narrative {
  margin-bottom: 12px;
}
.narrative-p {
  font-size: 14px;
  line-height: 1.55;
  margin: 4px 0 8px;
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
  font-size: 11px;
  text-transform: none;
  opacity: 0.6;
  margin-bottom: 3px;
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
