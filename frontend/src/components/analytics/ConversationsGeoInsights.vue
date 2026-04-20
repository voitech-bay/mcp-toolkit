<script setup lang="ts">
/**
 * Geo + flow-country insights for a project's recent LinkedIn conversations.
 *
 * Renders three views over the same /api/project-conversation-geo payload:
 *   1. World choropleth (only when a world GeoJSON is available at /maps/world.json).
 *   2. Top-countries horizontal bar chart (always works — the safe fallback).
 *   3. Flow → Country → reply tag sankey (only when FlowLeads edges exist).
 *
 * The aggregator extracts country from the free-text `Contacts.location`, so an
 * "Unknown" bucket and unparseable samples are surfaced for data-quality hinting.
 */
import { computed, onMounted, ref, watch } from "vue";
import {
  NCard,
  NAlert,
  NSpin,
  NText,
  NDataTable,
  NTag,
  NEmpty,
  NInputNumber,
  NSelect,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { useDark } from "@vueuse/core";
import { use, registerMap } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { BarChart, MapChart, SankeyChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  GeoComponent,
  ToolboxComponent,
} from "echarts/components";
import type { EChartsOption } from "echarts";
import VChart from "vue-echarts";
import EntityTagPicker from "./EntityTagPicker.vue";

use([
  CanvasRenderer,
  BarChart,
  MapChart,
  SankeyChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  GeoComponent,
  ToolboxComponent,
]);

const props = defineProps<{
  projectId: string | null;
  /** When true, hide the built-in limit input and use `conversationLimit` from the parent. */
  hideLimitControl?: boolean;
  /** Recent-conversation scan cap (1–2000). Used when `hideLimitControl` is true. */
  conversationLimit?: number | null;
}>();

type ReplyTag = "no_response" | "waiting_for_response" | "got_response";

interface GeoCountryRow {
  country: string;
  iso2: string | null;
  conversations: number;
  contacts: number;
  messagesIn: number;
  messagesOut: number;
  positiveReplies: number;
  noResponse: number;
  waiting: number;
  lastMessageAt: string | null;
}

interface GeoFlowEdge {
  flowUuid: string;
  flowName: string;
  country: string;
  replyTag: ReplyTag;
  conversations: number;
}

interface GeoPayload {
  totals: {
    conversationsScanned: number;
    conversationsMapped: number;
    conversationsUnknown: number;
    countries: number;
  };
  byCountry: GeoCountryRow[];
  flowCountryEdges: GeoFlowEdge[];
  unknownLocationSamples: string[];
  unknownCountryCandidates: Array<{ token: string; count: number }>;
  error: string | null;
}

interface GeoFlowOption {
  flowUuid: string;
  flowName: string;
  conversations: number;
}

const FLOW_TAG_EMOJIS = [
  "📨",
  "📬",
  "🎯",
  "🌊",
  "⚡",
  "🔁",
  "✉️",
  "🧭",
  "📣",
  "🚀",
  "💬",
  "🔔",
] as const;

const isDark = useDark();

const loading = ref(false);
const error = ref("");
const data = ref<GeoPayload | null>(null);
const limitSelf = ref<number>(500);
const topCountriesLimit = ref<number>(15);
const topCountriesSortKey = ref<
  "conversations" | "positiveReplies" | "messagesIn" | "messagesOut" | "replyRate"
>("conversations");
const topCountriesSortDir = ref<"desc" | "asc">("desc");
const sankeyTopFlows = ref<number>(8);
const sankeyTopCountries = ref<number>(10);
const selectedFlowUuids = ref<string[]>([]);
const knownFlowOptions = ref<Map<string, GeoFlowOption>>(new Map());

function clampScanLimit(n: unknown): number {
  const v = Math.floor(Number(n) || 500);
  return Math.max(1, Math.min(2000, v));
}

const scanLimit = computed(() =>
  props.hideLimitControl ? clampScanLimit(props.conversationLimit) : clampScanLimit(limitSelf.value)
);

/** Tracks the world GeoJSON load state. Fetched once per session, shared across component instances. */
const mapState = ref<"idle" | "loading" | "ready" | "missing">("idle");
let worldMapRegistered = false;

async function ensureWorldMap(): Promise<void> {
  if (mapState.value === "ready" || mapState.value === "loading") return;
  mapState.value = "loading";
  try {
    const r = await fetch("/maps/world.json", { cache: "force-cache" });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const geo = (await r.json()) as unknown;
    if (!worldMapRegistered) {
      registerMap("world", geo as Parameters<typeof registerMap>[1]);
      worldMapRegistered = true;
    }
    mapState.value = "ready";
  } catch {
    mapState.value = "missing";
  }
}

async function loadData(): Promise<void> {
  const pid = props.projectId;
  if (!pid) {
    data.value = null;
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const urlParams = new URLSearchParams({
      projectId: pid,
      limit: String(scanLimit.value),
    });
    if (selectedFlowUuids.value.length > 0) {
      urlParams.set("flowUuids", selectedFlowUuids.value.join(","));
    }
    const url = `/api/project-conversation-geo?${urlParams.toString()}`;
    const r = await fetch(url);
    const body = (await r.json()) as GeoPayload & { error?: string };
    if (!r.ok) {
      error.value = body.error ?? `Failed to load geo data (HTTP ${r.status})`;
      data.value = null;
      return;
    }
    data.value = body;
    const nextKnown = new Map(knownFlowOptions.value);
    const flowAgg = new Map<string, GeoFlowOption>();
    for (const e of body.flowCountryEdges ?? []) {
      const cur = flowAgg.get(e.flowUuid) ?? {
        flowUuid: e.flowUuid,
        flowName: e.flowName,
        conversations: 0,
      };
      cur.conversations += e.conversations;
      flowAgg.set(e.flowUuid, cur);
    }
    for (const [k, v] of flowAgg) nextKnown.set(k, v);
    knownFlowOptions.value = nextKnown;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load geo data";
    data.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void ensureWorldMap();
  void loadData();
});

watch(
  () => [props.projectId, scanLimit.value, selectedFlowUuids.value.join("|")] as const,
  () => void loadData()
);

const mappedRows = computed((): GeoCountryRow[] =>
  (data.value?.byCountry ?? []).filter((r) => r.country !== "Unknown")
);

const unknownRow = computed((): GeoCountryRow | null =>
  (data.value?.byCountry ?? []).find((r) => r.country === "Unknown") ?? null
);

const topCountriesLimitClamped = computed(() =>
  Math.max(1, Math.min(250, Math.floor(Number(topCountriesLimit.value) || 15)))
);

const topCountriesSortOptions = [
  { label: "Conversations", value: "conversations" },
  { label: "Positive replies", value: "positiveReplies" },
  { label: "Reply rate %", value: "replyRate" },
  { label: "Messages in", value: "messagesIn" },
  { label: "Messages out", value: "messagesOut" },
];

const topCountriesSortDirOptions = [
  { label: "High → low", value: "desc" },
  { label: "Low → high", value: "asc" },
];

const topCountriesCardTitle = computed(() => {
  const metricLabel =
    topCountriesSortOptions.find((x) => x.value === topCountriesSortKey.value)?.label ??
    "Conversations";
  return `Top ${topCountriesLimitClamped.value} countries (${metricLabel}, ${topCountriesSortDir.value === "desc" ? "high → low" : "low → high"})`;
});

const sankeyTopFlowsClamped = computed(() =>
  Math.max(1, Math.min(30, Math.floor(Number(sankeyTopFlows.value) || 8)))
);
const sankeyTopCountriesClamped = computed(() =>
  Math.max(1, Math.min(50, Math.floor(Number(sankeyTopCountries.value) || 10)))
);

const sankeyCardTitle = computed(
  () =>
    `Flow → Country → Reply (top ${sankeyTopFlowsClamped.value} flows × top ${sankeyTopCountriesClamped.value} countries)`
);

const topCountriesForBar = computed(() => {
  const sorted = [...mappedRows.value].sort((a, b) => {
    const metricOf = (row: GeoCountryRow): number => {
      if (topCountriesSortKey.value === "replyRate") {
        if (row.conversations <= 0) return 0;
        return (100 * row.positiveReplies) / row.conversations;
      }
      return Number(row[topCountriesSortKey.value]);
    };
    const av = metricOf(a);
    const bv = metricOf(b);
    const cmp = Number(av) - Number(bv);
    if (cmp !== 0) return topCountriesSortDir.value === "desc" ? -cmp : cmp;
    return a.country.localeCompare(b.country, undefined, { sensitivity: "base" });
  });
  return sorted.slice(0, topCountriesLimitClamped.value);
});

const flowFilterRows = computed(() =>
  [...knownFlowOptions.value.values()]
    .sort(
      (a, b) =>
        b.conversations - a.conversations ||
        a.flowName.localeCompare(b.flowName, undefined, { sensitivity: "base" })
    )
);
const flowFilterItems = computed(() =>
  flowFilterRows.value.map((f, idx) => ({
    id: f.flowUuid,
    label: `${FLOW_TAG_EMOJIS[idx % FLOW_TAG_EMOJIS.length]!} ${f.flowName}`,
    meta: `· ${f.conversations.toLocaleString()} conversations`,
    tooltip: `${f.flowName} · ${f.conversations.toLocaleString()} conversations`,
  }))
);

function chartTextColor(dark: boolean): string {
  return dark ? "rgba(255, 255, 255, 0.78)" : "rgba(0, 0, 0, 0.72)";
}

function chartSurfaceBg(dark: boolean): string {
  return dark ? "rgba(28, 28, 32, 0.96)" : "rgba(248, 249, 252, 0.98)";
}

/** Horizontal bar chart of the top countries by conversation count. */
const topCountriesOption = computed((): EChartsOption => {
  const rows = topCountriesForBar.value;
  const text = chartTextColor(isDark.value);
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 8, right: 32, top: 8, bottom: 8, containLabel: true },
    backgroundColor: "transparent",
    xAxis: {
      type: "value",
      axisLabel: { color: text },
      splitLine: { lineStyle: { color: isDark.value ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" } },
    },
    yAxis: {
      type: "category",
      data: rows.map((r) => r.country),
      inverse: true,
      axisLabel: { color: text },
    },
    series: [
      {
        name: "Conversations",
        type: "bar",
        data: rows.map((r) => r.conversations),
        itemStyle: { color: "#5470c6" },
        label: {
          show: true,
          position: "right",
          color: text,
          formatter: (p) => String((p as { value?: unknown })?.value ?? ""),
        },
      },
      {
        name: "Positive",
        type: "bar",
        data: rows.map((r) => r.positiveReplies),
        itemStyle: { color: "#91cc75" },
      },
    ],
    legend: { top: 0, textStyle: { color: text } },
  };
});

/** Choropleth world map colored by conversation count. */
const mapOption = computed((): EChartsOption => {
  const rows = mappedRows.value;
  const text = chartTextColor(isDark.value);
  const maxVal = rows.reduce((m, r) => Math.max(m, r.conversations), 0);
  return {
    tooltip: {
      trigger: "item",
      formatter: (p) => {
        const first = Array.isArray(p) ? p[0] : p;
        const name = String((first as { name?: unknown })?.name ?? "");
        const row = rows.find((r) => r.country === name);
        if (!row) return `${name}<br/>no data`;
        return [
          `<strong>${row.country}</strong>`,
          `Conversations: ${row.conversations}`,
          `Contacts: ${row.contacts}`,
          `Positive replies: ${row.positiveReplies}`,
          `Messages (in/out): ${row.messagesIn} / ${row.messagesOut}`,
        ].join("<br/>");
      },
    },
    backgroundColor: "transparent",
    visualMap: {
      min: 0,
      max: Math.max(1, maxVal),
      left: 16,
      bottom: 16,
      text: ["High", "Low"],
      calculable: true,
      inRange: {
        color: isDark.value
          ? ["#1a2a4a", "#2e4b85", "#3e6bb5", "#5992e6", "#89b7ff"]
          : ["#e6ecff", "#9fbcff", "#5a87e6", "#2f5cc7", "#1a3e99"],
      },
      textStyle: { color: text },
    },
    series: [
      {
        name: "Conversations",
        type: "map",
        map: "world",
        // Natural Earth uses `NAME` (uppercase); data rows use those canonical values.
        nameProperty: "NAME",
        roam: true,
        emphasis: { label: { show: true } },
        itemStyle: {
          borderColor: isDark.value ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.15)",
          areaColor: isDark.value ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
        },
        data: rows.map((r) => ({ name: r.country, value: r.conversations })),
      },
    ],
  };
});

const REPLY_TAG_LABEL: Record<ReplyTag, string> = {
  got_response: "Got response",
  waiting_for_response: "Waiting for response",
  no_response: "No response",
};

const REPLY_TAG_COLOR: Record<ReplyTag, string> = {
  got_response: "#91cc75",
  waiting_for_response: "#fac858",
  no_response: "#ee6666",
};

/**
 * Flow → Country → reply tag (counts = conversations) for a sankey.
 *
 * Node names include a type prefix to avoid collisions (e.g. a flow called
 * "Germany" would clash with the Germany country node). The display label is
 * derived from the prefix inside the formatter below.
 */
const sankeyOption = computed((): EChartsOption | null => {
  const edges = data.value?.flowCountryEdges ?? [];
  if (edges.length === 0) return null;

  const flowTotals = new Map<string, { name: string; total: number }>();
  const countryTotals = new Map<string, number>();
  for (const e of edges) {
    const f = flowTotals.get(e.flowUuid) ?? { name: e.flowName, total: 0 };
    f.total += e.conversations;
    flowTotals.set(e.flowUuid, f);
    countryTotals.set(e.country, (countryTotals.get(e.country) ?? 0) + e.conversations);
  }
  const topFlowUuids = new Set(
    [...flowTotals.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, sankeyTopFlowsClamped.value)
      .map(([uuid]) => uuid)
  );
  const topCountries = new Set(
    [...countryTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, sankeyTopCountriesClamped.value)
      .map(([name]) => name)
  );

  const flowPrefix = "flow:";
  const countryPrefix = "country:";
  const replyPrefix = "reply:";

  interface LocalNode {
    name: string;
    itemStyle?: { color?: string };
  }
  const nodeSet = new Map<string, LocalNode>();
  const links: Array<{ source: string; target: string; value: number }> = [];

  const aggFlowCountry = new Map<string, number>();
  const aggCountryReply = new Map<string, { country: string; tag: ReplyTag; value: number }>();

  for (const e of edges) {
    if (!topFlowUuids.has(e.flowUuid)) continue;
    if (!topCountries.has(e.country)) continue;
    const flowNode = flowPrefix + e.flowName;
    const countryNode = countryPrefix + e.country;
    const replyNode = replyPrefix + e.replyTag;
    if (!nodeSet.has(flowNode)) nodeSet.set(flowNode, { name: flowNode });
    if (!nodeSet.has(countryNode)) nodeSet.set(countryNode, { name: countryNode });
    if (!nodeSet.has(replyNode))
      nodeSet.set(replyNode, { name: replyNode, itemStyle: { color: REPLY_TAG_COLOR[e.replyTag] } });

    const fcKey = `${flowNode}__${countryNode}`;
    aggFlowCountry.set(fcKey, (aggFlowCountry.get(fcKey) ?? 0) + e.conversations);

    const crKey = `${countryNode}__${replyNode}`;
    const prev = aggCountryReply.get(crKey);
    if (prev) prev.value += e.conversations;
    else aggCountryReply.set(crKey, { country: countryNode, tag: e.replyTag, value: e.conversations });
  }

  for (const [key, value] of aggFlowCountry) {
    const [flowNode, countryNode] = key.split("__");
    if (!flowNode || !countryNode) continue;
    links.push({ source: flowNode, target: countryNode, value });
  }
  for (const entry of aggCountryReply.values()) {
    links.push({ source: entry.country, target: replyPrefix + entry.tag, value: entry.value });
  }

  const nodes = [...nodeSet.values()];
  const text = chartTextColor(isDark.value);

  return {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      triggerOn: "mousemove",
      formatter: (p) => {
        const first = (Array.isArray(p) ? p[0] : p) as {
          name?: unknown;
          dataType?: unknown;
          data?: unknown;
        };
        const name = typeof first?.name === "string" ? first.name : "";
        if (first?.dataType === "edge") {
          const d = first.data as { source?: string; target?: string; value?: number };
          return `${stripSankeyPrefix(d.source ?? "")} → ${stripSankeyPrefix(d.target ?? "")}<br/>${d.value ?? 0}`;
        }
        return stripSankeyPrefix(name);
      },
    },
    series: [
      {
        type: "sankey",
        data: nodes,
        links,
        emphasis: { focus: "adjacency" },
        nodeAlign: "justify",
        lineStyle: { color: "gradient", curveness: 0.5 },
        label: {
          color: text,
          fontSize: 12,
          formatter: (p) => stripSankeyPrefix(String((p as { name?: unknown })?.name ?? "")),
        },
      },
    ],
  };
});

function stripSankeyPrefix(raw: string): string {
  if (raw.startsWith("flow:")) return raw.slice(5);
  if (raw.startsWith("country:")) return raw.slice(8);
  if (raw.startsWith("reply:")) {
    const tag = raw.slice(6) as ReplyTag;
    return REPLY_TAG_LABEL[tag] ?? tag;
  }
  return raw;
}

const tableColumns = computed<DataTableColumns<GeoCountryRow>>(() => [
  { title: "Country", key: "country", minWidth: 160, ellipsis: { tooltip: true } },
  { title: "ISO", key: "iso2", width: 64 },
  { title: "Convs", key: "conversations", align: "right", width: 80 },
  { title: "Contacts", key: "contacts", align: "right", width: 90 },
  { title: "Positive", key: "positiveReplies", align: "right", width: 90 },
  { title: "Waiting", key: "waiting", align: "right", width: 90 },
  { title: "No reply", key: "noResponse", align: "right", width: 90 },
  {
    title: "In / Out",
    key: "messages",
    align: "right",
    width: 110,
    render: (row) => `${row.messagesIn} / ${row.messagesOut}`,
  },
  {
    title: "Last message",
    key: "lastMessageAt",
    width: 170,
    render: (row) => (row.lastMessageAt ? new Date(row.lastMessageAt).toLocaleString() : "—"),
  },
]);

const totals = computed(() => data.value?.totals ?? null);

const mapCoverageText = computed(() => {
  const t = totals.value;
  if (!t) return "";
  const scanned = t.conversationsScanned;
  if (scanned === 0) return "No conversations in this project yet.";
  const mappedPct = Math.round((t.conversationsMapped / scanned) * 100);
  return `${t.conversationsMapped} of ${scanned} conversations (${mappedPct}%) resolved to a country across ${t.countries} countries.`;
});

const unknownCountriesSummaryText = computed(() => {
  const list = data.value?.unknownCountryCandidates ?? [];
  if (list.length === 0) return "";
  const names = list.map((x) => x.token).join(", ");
  return `${list.length} countries not found. Countries: ${names}`;
});

const unknownContactsSummaryText = computed(() => {
  const contacts = unknownRow.value?.contacts ?? 0;
  const verb = contacts === 1 ? "has" : "have";
  return `${contacts} contacts ${verb} no country in data`;
});
</script>

<template>
  <div class="cg-insights">
    <NAlert v-if="!projectId" type="info" title="Select a project" class="cg-insights__alert">
      Choose a project in the header to load conversation geo data.
    </NAlert>
    <template v-else>
      <NCard size="small" title="Conversation coverage" class="cg-insights__card">
        <template #header-extra>
          <div class="cg-insights__header-filters">
            <div v-if="!hideLimitControl" class="cg-insights__limit">
              <NText depth="3" class="cg-insights__limit-label">Scan recent</NText>
              <NInputNumber
                v-model:value="limitSelf"
                size="small"
                :min="50"
                :max="2000"
                :step="50"
                :disabled="loading"
                :show-button="false"
                class="cg-insights__limit-input"
                @blur="loadData"
                @keydown.enter="loadData"
              />
              <NText depth="3">conversations</NText>
            </div>
          </div>
        </template>

        <NSpin :show="loading">
          <NAlert v-if="error" type="error" :title="error" class="cg-insights__alert" />
          <template v-else-if="totals">
            <NText class="cg-insights__coverage">{{ mapCoverageText }}</NText>
            <EntityTagPicker
              v-if="flowFilterItems.length > 0"
              v-model:model-value="selectedFlowUuids"
              :items="flowFilterItems"
              title="Flows (charts & matrix)"
              :loading="loading"
              :badge-limit="25"
              class="cg-insights__flow-tags-wrap"
            />
            <div v-if="unknownRow && unknownRow.conversations > 0" class="cg-insights__unknown">
              <NTag type="warning" size="small" :bordered="false">Unknown</NTag>
              <div class="cg-insights__unknown-lines">
                <NText depth="3">
                  {{ unknownRow.conversations }} conversations have an unparseable or missing
                  <code>location</code>.
                </NText>
                <NText depth="3" v-if="unknownCountriesSummaryText">{{ unknownCountriesSummaryText }}</NText>
                <NText depth="3">{{ unknownContactsSummaryText }}</NText>
              </div>
            </div>
            <div
              v-if="(data?.unknownCountryCandidates?.length ?? 0) > 0"
              class="cg-insights__samples"
            >
              <NText depth="3" class="cg-insights__samples-label">Not found country candidates:</NText>
              <span
                v-for="(c, i) in data!.unknownCountryCandidates"
                :key="`uc-${i}`"
                class="cg-insights__sample-chip"
              >{{ c.token }} ({{ c.count }})</span>
            </div>
            <div
              v-if="(data?.unknownLocationSamples?.length ?? 0) > 0"
              class="cg-insights__samples"
            >
              <NText depth="3" class="cg-insights__samples-label">Raw samples:</NText>
              <span
                v-for="(s, i) in data!.unknownLocationSamples"
                :key="`us-${i}`"
                class="cg-insights__sample-chip"
              >{{ s }}</span>
            </div>
          </template>
        </NSpin>
      </NCard>

      <NCard size="small" title="World map · conversations by country" class="cg-insights__card">
        <NSpin :show="loading || mapState === 'loading'">
          <template v-if="mapState === 'missing'">
            <NAlert type="info" title="World map unavailable" class="cg-insights__alert">
              Add a world GeoJSON at
              <code>frontend/public/maps/world.json</code> to enable the choropleth. The
              <strong>Top countries</strong> chart below works without it.
            </NAlert>
          </template>
          <template v-else-if="mapState === 'ready'">
            <NEmpty
              v-if="mappedRows.length === 0 && !loading"
              description="No conversations mapped to a country yet."
            />
            <div v-else class="cg-insights__map-host" :style="{ background: chartSurfaceBg(isDark) }">
              <VChart
                class="cg-insights__echart"
                :option="mapOption"
                :update-options="{ notMerge: true }"
                :autoresize="{ throttle: 200 }"
              />
            </div>
          </template>
        </NSpin>
      </NCard>

      <NCard size="small" :title="topCountriesCardTitle" class="cg-insights__card">
        <template #header-extra>
          <div class="cg-insights__top-controls">
            <NText depth="3">Top</NText>
            <NInputNumber
              v-model:value="topCountriesLimit"
              size="small"
              :min="1"
              :max="250"
              :step="1"
              :show-button="false"
              class="cg-insights__top-count"
            />
            <NSelect
              v-model:value="topCountriesSortKey"
              size="small"
              :options="topCountriesSortOptions"
              class="cg-insights__top-sort"
            />
            <NSelect
              v-model:value="topCountriesSortDir"
              size="small"
              :options="topCountriesSortDirOptions"
              class="cg-insights__top-dir"
            />
          </div>
        </template>
        <NSpin :show="loading">
          <NEmpty v-if="mappedRows.length === 0 && !loading" description="No country data in range." />
          <div v-else class="cg-insights__bar-host">
            <VChart
              class="cg-insights__echart"
              :option="topCountriesOption"
              :update-options="{ notMerge: true }"
              :autoresize="{ throttle: 200 }"
            />
          </div>
        </NSpin>
      </NCard>

      <NCard
        v-if="sankeyOption"
        size="small"
        :title="sankeyCardTitle"
        class="cg-insights__card"
      >
        <template #header-extra>
          <div class="cg-insights__sankey-controls">
            <NText depth="3">Top flows</NText>
            <NInputNumber
              v-model:value="sankeyTopFlows"
              size="small"
              :min="1"
              :max="30"
              :step="1"
              :show-button="false"
              class="cg-insights__sankey-count"
            />
            <NText depth="3">Top countries</NText>
            <NInputNumber
              v-model:value="sankeyTopCountries"
              size="small"
              :min="1"
              :max="50"
              :step="1"
              :show-button="false"
              class="cg-insights__sankey-count"
            />
          </div>
        </template>
        <NText depth="3" class="cg-insights__hint">
          Edge thickness = conversation count. Colors on the right stream group conversations by reply status
          (green = got response, yellow = waiting, red = no response).
        </NText>
        <div class="cg-insights__sankey-host">
          <VChart
            class="cg-insights__echart"
            :option="sankeyOption"
            :update-options="{ notMerge: true }"
            :autoresize="{ throttle: 200 }"
          />
        </div>
      </NCard>

      <NCard size="small" title="Countries table" class="cg-insights__card">
        <NDataTable
          size="small"
          :columns="tableColumns"
          :data="mappedRows"
          :bordered="true"
          :single-line="false"
          :pagination="{ pageSize: 20 }"
        />
      </NCard>
    </template>
  </div>
</template>

<style scoped>
.cg-insights {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cg-insights__alert {
  margin-bottom: 8px;
}

.cg-insights__card {
  width: 100%;
}

.cg-insights__coverage {
  display: block;
  margin-bottom: 8px;
}

.cg-insights__unknown {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 4px;
}

.cg-insights__unknown-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cg-insights__samples {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.cg-insights__samples-label {
  margin-right: 4px;
}

.cg-insights__sample-chip {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(125, 125, 125, 0.15);
}

.cg-insights__map-host {
  height: 520px;
  width: 100%;
  border-radius: 6px;
}

.cg-insights__bar-host {
  height: 720px;
  width: 100%;
}

.cg-insights__sankey-host {
  height: 800px;
  width: 100%;
}

.cg-insights__echart {
  width: 100%;
  height: 100%;
}

.cg-insights__limit {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cg-insights__header-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.cg-insights__limit-label {
  font-size: 12px;
}

.cg-insights__limit-input {
  width: 96px;
}

.cg-insights__flow-tags-wrap {
  margin-bottom: 8px;
}

.cg-insights__hint {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
}

.cg-insights__top-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cg-insights__top-count {
  width: 72px;
}

.cg-insights__top-sort {
  width: 170px;
}

.cg-insights__top-dir {
  width: 125px;
}

.cg-insights__sankey-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cg-insights__sankey-count {
  width: 72px;
}
</style>
