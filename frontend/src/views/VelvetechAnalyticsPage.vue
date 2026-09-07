<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { NAlert, NButton, NCard, NDataTable, NGrid, NGi, NSpace, NSpin, NStatistic, NTag, NText, NTooltip } from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { RefreshCwIcon } from "lucide-vue-next";

type StageSource = "ours" | "getsales" | "smartlead";

type FunnelStage = {
  channel: "email" | "linkedin";
  stage: string;
  ord: number;
  people: number;
  source: StageSource;
  note: string | null;
  stepPct: number | null;
  ofTopPct: number | null;
};

type CampaignRow = {
  channel: string;
  vendor: string;
  campaignId: string;
  campaignName: string | null;
  campaignStatus: string | null;
  capturedAt: string | null;
  leadsTotal: number | null;
  sent: number | null;
  opened: number | null;
  replied: number | null;
  bounced: number | null;
  connectionsSent: number | null;
  connectionsAccepted: number | null;
};

type DeptRow = {
  dept: string;
  people: number;
  sentTo: number;
  emailsSent: number;
  reachedStep2: number;
  reachedStep3: number;
  replied: number;
  unsubscribed: number;
  lastSent: string | null;
};

type ResearchStats = {
  companies: number;
  researched: number;
  partial: number;
  none: number;
  withDeep: number;
  withPov: number;
  withEvidence: number;
  withContactResearch: number;
  enrolledWithoutResearch: number;
  refreshedAt: string | null;
};

type PipelineStage = { stage: string; ord: number; companies: number; people: number; note: string | null };

type Payload = {
  funnel: FunnelStage[];
  campaigns: CampaignRow[];
  departments: DeptRow[];
  research: ResearchStats | null;
  pipeline: PipelineStage[];
  capturedAt: Record<string, string | null>;
  warnings: string[];
};

const loading = ref(false);
const refreshing = ref(false);
const error = ref("");
const data = ref<Payload | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch("/api/velvetech-analytics");
    const j = (await r.json()) as Payload & { error?: string };
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    data.value = j;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

/** Rebuilding the research snapshot re-runs the slow research view; it takes tens of seconds. */
async function rebuildSnapshots(): Promise<void> {
  refreshing.value = true;
  error.value = "";
  try {
    const r = await fetch("/api/velvetech-analytics/refresh", { method: "POST" });
    const j = (await r.json()) as { refreshedAt?: string; error?: string };
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    refreshing.value = false;
  }
}

onMounted(load);

const emailStages = computed(() => (data.value?.funnel ?? []).filter((s) => s.channel === "email"));
const linkedinStages = computed(() => (data.value?.funnel ?? []).filter((s) => s.channel === "linkedin"));

const emailCampaigns = computed(() => (data.value?.campaigns ?? []).filter((c) => c.channel === "email"));
const linkedinCampaigns = computed(() => (data.value?.campaigns ?? []).filter((c) => c.channel === "linkedin"));

/** Top-of-funnel people across both channels, so the totals row is not a sum of overlapping stages. */
const totals = computed(() => {
  const email = emailStages.value;
  const li = linkedinStages.value;
  const stageOf = (list: FunnelStage[], name: string) => list.find((s) => s.stage === name)?.people ?? 0;
  return {
    emailReached: stageOf(email, "Email 1 sent"),
    emailReplied: stageOf(email, "Replied"),
    liConnections: stageOf(li, "Connection sent"),
    liAccepted: stageOf(li, "Connection accepted"),
    positives: stageOf(email, "Positive") + stageOf(li, "Positive"),
    meetings: stageOf(email, "Meeting") + stageOf(li, "Meeting"),
  };
});

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v}%`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "no capture yet";
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function sourceTag(source: StageSource): { label: string; type: "success" | "warning" } {
  return source === "ours"
    ? { label: "our count", type: "success" }
    : { label: `${source} count`, type: "warning" };
}

const campaignColumns: DataTableColumns<CampaignRow> = [
  { title: "Campaign", key: "campaignName", render: (r) => r.campaignName || r.campaignId, minWidth: 220 },
  { title: "Status", key: "campaignStatus", width: 100 },
  { title: "Leads", key: "leadsTotal", width: 80, render: (r) => r.leadsTotal ?? "—" },
  { title: "Sent", key: "sent", width: 80, render: (r) => r.sent ?? "—" },
  { title: "Opened", key: "opened", width: 90, render: (r) => r.opened ?? "—" },
  { title: "Replied", key: "replied", width: 90, render: (r) => r.replied ?? "—" },
  { title: "Bounced", key: "bounced", width: 90, render: (r) => r.bounced ?? "—" },
  { title: "Conn. sent", key: "connectionsSent", width: 110, render: (r) => r.connectionsSent ?? "—" },
  { title: "Accepted", key: "connectionsAccepted", width: 100, render: (r) => r.connectionsAccepted ?? "—" },
];

const deptColumns: DataTableColumns<DeptRow> = [
  { title: "Department", key: "dept", minWidth: 140 },
  { title: "People", key: "people", width: 90 },
  { title: "Sent to", key: "sentTo", width: 90 },
  { title: "Emails", key: "emailsSent", width: 90 },
  { title: "Reached E2", key: "reachedStep2", width: 110 },
  { title: "Reached E3", key: "reachedStep3", width: 110 },
  { title: "Replied", key: "replied", width: 90 },
  {
    title: "Reply rate",
    key: "replyRate",
    width: 110,
    render: (r) => (r.sentTo > 0 ? `${Math.round((r.replied / r.sentTo) * 1000) / 10}%` : "—"),
  },
  { title: "Last send", key: "lastSent", width: 120, render: (r) => r.lastSent ?? "—" },
];
</script>

<template>
  <div class="velvetech-analytics">
    <NSpace justify="space-between" align="center" style="margin-bottom: 12px">
      <div>
        <h2 style="margin: 0">Velvetech analytics</h2>
        <NText depth="3" style="font-size: 12px">
          Every stage is counted from our own records, except the two LinkedIn stages we have no
          independent record of. Those are labelled.
        </NText>
      </div>
      <NSpace size="small">
        <NButton size="small" :loading="loading" @click="load">
          <RefreshCwIcon :size="14" style="margin-right: 4px" />
          Refresh
        </NButton>
        <NButton size="small" secondary :loading="refreshing" @click="rebuildSnapshots">
          Rebuild research snapshot
        </NButton>
      </NSpace>
    </NSpace>

    <NAlert v-if="error" type="error" style="margin-bottom: 12px">{{ error }}</NAlert>
    <NAlert v-for="w in data?.warnings ?? []" :key="w" type="warning" style="margin-bottom: 8px">{{ w }}</NAlert>

    <NSpin :show="loading">
      <template v-if="data">
        <NCard size="small" title="Totals" style="margin-bottom: 12px">
          <NGrid :cols="6" :x-gap="12" responsive="screen" item-responsive>
            <NGi span="6 s:3 m:1"><NStatistic label="Emailed" :value="totals.emailReached" /></NGi>
            <NGi span="6 s:3 m:1"><NStatistic label="Email replies" :value="totals.emailReplied" /></NGi>
            <NGi span="6 s:3 m:1"><NStatistic label="Connections sent" :value="totals.liConnections" /></NGi>
            <NGi span="6 s:3 m:1"><NStatistic label="Connections accepted" :value="totals.liAccepted" /></NGi>
            <NGi span="6 s:3 m:1"><NStatistic label="Positive replies" :value="totals.positives" /></NGi>
            <NGi span="6 s:3 m:1"><NStatistic label="Meetings" :value="totals.meetings" /></NGi>
          </NGrid>
        </NCard>

        <NGrid :cols="2" :x-gap="12" responsive="screen" item-responsive style="margin-bottom: 12px">
          <NGi span="2 m:1">
            <NCard size="small" title="Email funnel">
              <template #header-extra>
                <NText depth="3" style="font-size: 11px">Smartlead capture: {{ fmtDate(data.capturedAt.email) }}</NText>
              </template>
              <table class="funnel">
                <thead>
                  <tr><th>Stage</th><th>People</th><th>From previous</th><th>Of start</th><th></th></tr>
                </thead>
                <tbody>
                  <tr v-for="s in emailStages" :key="s.ord">
                    <td>
                      <NTooltip v-if="s.note" trigger="hover">
                        <template #trigger><span class="stage-name">{{ s.stage }}</span></template>
                        {{ s.note }}
                      </NTooltip>
                      <span v-else>{{ s.stage }}</span>
                    </td>
                    <td class="num">{{ s.people }}</td>
                    <td class="num">{{ fmtPct(s.stepPct) }}</td>
                    <td class="num">{{ fmtPct(s.ofTopPct) }}</td>
                    <td>
                      <NTag v-if="s.source !== 'ours'" size="tiny" :type="sourceTag(s.source).type">
                        {{ sourceTag(s.source).label }}
                      </NTag>
                    </td>
                  </tr>
                </tbody>
              </table>
            </NCard>
          </NGi>
          <NGi span="2 m:1">
            <NCard size="small" title="LinkedIn funnel">
              <template #header-extra>
                <NText depth="3" style="font-size: 11px">GetSales capture: {{ fmtDate(data.capturedAt.linkedin) }}</NText>
              </template>
              <table class="funnel">
                <thead>
                  <tr><th>Stage</th><th>People</th><th>From previous</th><th>Of start</th><th></th></tr>
                </thead>
                <tbody>
                  <tr v-for="s in linkedinStages" :key="s.ord">
                    <td>
                      <NTooltip v-if="s.note" trigger="hover">
                        <template #trigger><span class="stage-name">{{ s.stage }}</span></template>
                        {{ s.note }}
                      </NTooltip>
                      <span v-else>{{ s.stage }}</span>
                    </td>
                    <td class="num">{{ s.people }}</td>
                    <td class="num">{{ fmtPct(s.stepPct) }}</td>
                    <td class="num">{{ fmtPct(s.ofTopPct) }}</td>
                    <td>
                      <NTag v-if="s.source !== 'ours'" size="tiny" :type="sourceTag(s.source).type">
                        {{ sourceTag(s.source).label }}
                      </NTag>
                    </td>
                  </tr>
                </tbody>
              </table>
            </NCard>
          </NGi>
        </NGrid>

        <NCard size="small" title="Research coverage" style="margin-bottom: 12px" v-if="data.research">
          <template #header-extra>
            <NText depth="3" style="font-size: 11px">Snapshot: {{ fmtDate(data.research.refreshedAt) }}</NText>
          </template>
          <NGrid :cols="6" :x-gap="12" responsive="screen" item-responsive>
            <NGi span="6 s:3 m:1"><NStatistic label="Companies" :value="data.research.companies" /></NGi>
            <NGi span="6 s:3 m:1"><NStatistic label="Researched" :value="data.research.researched" /></NGi>
            <NGi span="6 s:3 m:1"><NStatistic label="Partial" :value="data.research.partial" /></NGi>
            <NGi span="6 s:3 m:1"><NStatistic label="No research" :value="data.research.none" /></NGi>
            <NGi span="6 s:3 m:1"><NStatistic label="With a POV" :value="data.research.withPov" /></NGi>
            <NGi span="6 s:3 m:1">
              <NStatistic label="Live without research" :value="data.research.enrolledWithoutResearch" />
            </NGi>
          </NGrid>
        </NCard>

        <NCard size="small" title="Pipeline" style="margin-bottom: 12px" v-if="data.pipeline.length">
          <template #header-extra>
            <NText depth="3" style="font-size: 11px">Snapshot: {{ fmtDate(data.capturedAt.pipeline) }}</NText>
          </template>
          <table class="funnel">
            <thead><tr><th>Stage</th><th>Companies</th><th>People</th><th>Note</th></tr></thead>
            <tbody>
              <tr v-for="p in data.pipeline" :key="p.ord">
                <td>{{ p.stage }}</td>
                <td class="num">{{ p.companies }}</td>
                <td class="num">{{ p.people }}</td>
                <td class="note">{{ p.note }}</td>
              </tr>
            </tbody>
          </table>
        </NCard>

        <NCard size="small" title="By department (email)" style="margin-bottom: 12px">
          <NDataTable :columns="deptColumns" :data="data.departments" size="small" :bordered="false" />
        </NCard>

        <NCard size="small" title="Email campaigns" style="margin-bottom: 12px">
          <NDataTable :columns="campaignColumns" :data="emailCampaigns" size="small" :bordered="false" :scroll-x="1100" />
        </NCard>

        <NCard size="small" title="LinkedIn flows">
          <NDataTable :columns="campaignColumns" :data="linkedinCampaigns" size="small" :bordered="false" :scroll-x="1100" />
        </NCard>
      </template>
    </NSpin>
  </div>
</template>

<style scoped>
.velvetech-analytics {
  padding: 16px;
}
table.funnel {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
table.funnel th {
  text-align: left;
  font-weight: 500;
  opacity: 0.6;
  padding: 4px 8px 4px 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
table.funnel td {
  padding: 5px 8px 5px 0;
  border-top: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.2));
}
table.funnel td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
table.funnel td.note {
  opacity: 0.6;
  font-size: 12px;
}
.stage-name {
  border-bottom: 1px dotted currentColor;
  cursor: help;
}
</style>
