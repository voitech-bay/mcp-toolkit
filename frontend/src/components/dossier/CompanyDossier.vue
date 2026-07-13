<script setup lang="ts">
import { computed } from "vue";
import { NCard, NSpace, NTag, NText, NCollapse, NCollapseItem } from "naive-ui";

type HeadlineFact = { fact?: string; type?: string; tier?: number | string; source?: string };
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
type Dossier = {
  pov_ok?: boolean;
  from_contract?: boolean;
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
  discovery_questions?: string[];
  brief_markdown?: string | null;
  company_name?: string | null;
};

const props = defineProps<{ dossier: Dossier }>();

const facts = computed<HeadlineFact[]>(() => props.dossier.headline_facts ?? []);
const supportingFacts = computed(() => facts.value.filter((f) => Number(f.tier) >= 2));
const tech = computed(() => (props.dossier.tech_stack ?? []).map((t) => String(t)).filter(Boolean));
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

    <div class="dossier-grid">
      <!-- Hook (tier 1, outreach) -->
      <div v-if="dossier.hook" class="tile tile-accent tile-wide">
        <div class="tile-label">why now · used in outreach</div>
        <div class="tile-hook">{{ dossier.hook }}</div>
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
        <div v-if="f.source" class="tile-source">{{ f.source }}</div>
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
        </div>
      </div>

      <!-- Persona lanes -->
      <div v-for="lane in personaLanes" :key="lane.lane" class="tile">
        <div class="tile-label">{{ laneLabel(lane.lane) }} lane</div>
        <div v-for="(c, ci) in lane.contacts.slice(0, 3)" :key="ci" class="tile-contact">
          {{ contactName(c) }}<span class="tile-contact-title"> · {{ c.title }}</span>
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
          <div class="tile-label">brief</div>
          <pre class="detail-brief">{{ dossier.brief_markdown }}</pre>
        </div>
      </NCollapseItem>
    </NCollapse>
  </NCard>
</template>

<style scoped>
.dossier-title {
  font-weight: 600;
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
.tile-source {
  font-size: 11px;
  opacity: 0.5;
  margin-top: 4px;
  word-break: break-all;
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
.detail-block {
  margin-bottom: 12px;
}
.detail-list {
  margin: 4px 0 0;
  padding-left: 18px;
}
.detail-brief {
  white-space: pre-wrap;
  font-size: 12px;
  opacity: 0.85;
  margin: 4px 0 0;
}
</style>
