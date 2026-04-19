<script setup lang="ts">
import {
  NAlert,
  NSpin,
  NCard,
  NText,
  NRadioGroup,
  NRadioButton,
  NDataTable,
  NGrid,
  NGi,
  NSelect,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import type { EChartsOption } from "echarts";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { LineChart, HeatmapChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
} from "echarts/components";
import VChart from "vue-echarts";
import { useDark } from "@vueuse/core";
import {
  makeDailyFunnelChartOption,
  DAILY_HEATMAP_METRIC_OPTIONS,
  type DailyHeatmapMetricId,
} from "./flowAnalyticsDailyCharts.js";
import type { DailyMetricPoint, DailyWowRow } from "./flow-analytics-types.js";

use([
  CanvasRenderer,
  LineChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
]);

const dailyFunnelDisplay = defineModel<"lines" | "stacked">("dailyFunnelDisplay", { required: true });
const dailyRolling7Display = defineModel<"lines" | "stacked">("dailyRolling7Display", { required: true });
const dailyHeatmapMetric = defineModel<DailyHeatmapMetricId>("dailyHeatmapMetric", { required: true });

defineProps<{
  dailyError: string;
  dailyWarnings: string[];
  dailyLoading: boolean;
  dailyFunnelPrimaryOption: EChartsOption;
  dailyMessagesSentOption: EChartsOption;
  dailyRatesOption: EChartsOption;
  dailyRolling7Option: EChartsOption;
  weeklyFunnelSankeyOption: EChartsOption;
  dailyEntityHeatmapOption: EChartsOption;
  dailyMergedHeatmapOption: EChartsOption;
  dailyWeekWowColumns: DataTableColumns<DailyWowRow>;
  dailyWeekOverWeekRows: DailyWowRow[];
  dailySeries: DailyMetricPoint[];
  dailyByEntity: Array<{ entityId: string; entityName: string; series: DailyMetricPoint[] }>;
  groupEntityPlural: string;
  groupEntitySingular: string;
  flowsLength: number;
  selectedCount: number;
  chartUpdateOptions: { notMerge: boolean };
}>();

const isDark = useDark();
const dailyHeatmapMetricSelectOptions = DAILY_HEATMAP_METRIC_OPTIONS;
</script>

<template>
  <div class="flow-analytics-daily">
    <NText v-if="flowsLength > 0" depth="3" class="flow-analytics-daily__hint">
      X = calendar day in the <strong>Date range</strong> filter. Y = summed snapshot metrics for the
      <strong>{{ groupEntityPlural }}</strong> you selected (hypothesis mode uses the union of underlying flows once per
      day, so overlaps are not double-counted). Values are deltas stored per snapshot day, not cumulative pipeline totals.
    </NText>
    <NAlert v-if="dailyError" type="error" class="flow-dash__alert" :title="dailyError" />
    <NAlert v-if="dailyWarnings.length > 0" type="warning" class="flow-dash__alert" title="Notice">
      <ul class="flow-dash__warn-list">
        <li v-for="(w, i) in dailyWarnings" :key="`dw-${i}`">{{ w }}</li>
      </ul>
    </NAlert>
    <template v-if="flowsLength > 0">
      <NAlert v-if="selectedCount === 0" type="info" :title="`No ${groupEntityPlural} selected`" class="flow-dash__alert">
        Select at least one tag under <strong>Filters</strong> to load daily series.
      </NAlert>
      <NSpin v-else :show="dailyLoading">
        <NCard title="Funnel counts by day" size="small" class="flow-dash__card flow-dash__card--spaced">
          <div class="flow-dash__daily-toolbar">
            <NText depth="3" class="flow-dash__daily-toolbar-label">Funnel chart</NText>
            <NRadioGroup v-model:value="dailyFunnelDisplay" size="small">
              <NRadioButton value="lines">Lines</NRadioButton>
              <NRadioButton value="stacked">Stacked area</NRadioButton>
            </NRadioGroup>
          </div>
          <div class="flow-dash__daily-chart-host">
            <VChart
              class="flow-dash__echart-daily"
              :option="dailyFunnelPrimaryOption"
              :update-options="chartUpdateOptions"
              :autoresize="{ throttle: 200 }"
            />
          </div>
        </NCard>
        <NCard title="Messages sent by day" size="small" class="flow-dash__card flow-dash__card--spaced">
          <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
            LinkedIn messages sent (<code>linkedin_sent_count</code>) — often larger than connection requests; useful volume
            trend alongside the funnel chart.
          </NText>
          <div class="flow-dash__daily-chart-host">
            <VChart
              class="flow-dash__echart-daily"
              :option="dailyMessagesSentOption"
              :update-options="chartUpdateOptions"
              :autoresize="{ throttle: 200 }"
            />
          </div>
        </NCard>
        <NCard title="Rates by day" size="small" class="flow-dash__card flow-dash__card--spaced">
          <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
            Accepted, inbox reply, and inbox positive as a percentage of <strong>that day’s</strong> connection sent (combined
            selection). Gaps when sent = 0.
          </NText>
          <div class="flow-dash__daily-chart-host">
            <VChart
              class="flow-dash__echart-daily"
              :option="dailyRatesOption"
              :update-options="chartUpdateOptions"
              :autoresize="{ throttle: 200 }"
            />
          </div>
        </NCard>
        <NCard title="7-day rolling average" size="small" class="flow-dash__card flow-dash__card--spaced">
          <div class="flow-dash__daily-toolbar">
            <NText depth="3" class="flow-dash__daily-toolbar-label">Rolling chart</NText>
            <NRadioGroup v-model:value="dailyRolling7Display" size="small">
              <NRadioButton value="lines">Lines</NRadioButton>
              <NRadioButton value="stacked">Stacked area</NRadioButton>
            </NRadioGroup>
          </div>
          <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
            Same four funnel counts, smoothed with a trailing 7-day mean (shorter windows at the start of the range use fewer
            days).
          </NText>
          <div class="flow-dash__daily-chart-host">
            <VChart
              class="flow-dash__echart-daily"
              :option="dailyRolling7Option"
              :update-options="chartUpdateOptions"
              :autoresize="{ throttle: 200 }"
            />
          </div>
        </NCard>
        <NCard title="Week over week" size="small" class="flow-dash__card flow-dash__card--spaced">
          <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
            Weeks start Monday (UTC). Totals sum daily snapshot deltas in each week. “Sent Δ” compares this week’s connection
            sent to the previous week’s total.
          </NText>
          <NDataTable
            size="small"
            :bordered="true"
            :single-line="false"
            :columns="dailyWeekWowColumns"
            :data="dailyWeekOverWeekRows"
            :pagination="false"
            class="flow-dash__daily-wow-table"
          />
        </NCard>
        <NCard
          v-if="dailySeries.length > 0 && dailyWeekOverWeekRows.length > 0"
          title="Weekly funnel Sankey"
          size="small"
          class="flow-dash__card flow-dash__card--spaced"
        >
          <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
            Last weeks (Mon UTC) as parallel mini-funnels: Sent → Accepted → Inbox → Positive with drop-offs. Not a single
            time-alluvial—each week is its own chain so weeks are comparable side by side.
          </NText>
          <div class="flow-dash__daily-chart-host flow-dash__weekly-sankey-host">
            <VChart
              class="flow-dash__echart-daily"
              :option="weeklyFunnelSankeyOption"
              :update-options="chartUpdateOptions"
              :autoresize="{ throttle: 200 }"
            />
          </div>
        </NCard>
        <NCard
          v-if="dailyByEntity.length > 0"
          :title="`By ${groupEntitySingular} (1–2 selected)`"
          size="small"
          class="flow-dash__card flow-dash__card--spaced"
        >
          <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
            Same funnel lines as the first chart, but each {{ groupEntitySingular }} separately (not merged).
          </NText>
          <NGrid cols="24" responsive="screen" :x-gap="16" :y-gap="16">
            <NGi v-for="ent in dailyByEntity" :key="ent.entityId" span="24 m:12">
              <div class="flow-dash__daily-entity-chart">
                <VChart
                  class="flow-dash__echart-daily flow-dash__echart-daily--compact"
                  :option="makeDailyFunnelChartOption(ent.series, ent.entityName, 'lines', isDark)"
                  :update-options="chartUpdateOptions"
                  :autoresize="{ throttle: 200 }"
                />
              </div>
            </NGi>
          </NGrid>
        </NCard>
        <NCard
          v-if="dailySeries.length > 0 || (dailyByEntity.length >= 1 && dailyByEntity.length <= 2)"
          title="Daily heatmaps"
          size="small"
          class="flow-dash__card flow-dash__card--spaced"
        >
          <div class="flow-dash__daily-toolbar">
            <NText depth="3" class="flow-dash__daily-toolbar-label">Heatmap metric</NText>
            <NSelect
              v-model:value="dailyHeatmapMetric"
              size="small"
              :options="dailyHeatmapMetricSelectOptions"
              placeholder="Metric"
              class="flow-dash__heatmap-metric-select"
              :consistent-menu-width="false"
            />
          </div>
          <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
            Color encodes the chosen metric per calendar day. Counts are daily snapshot deltas; rate metrics are % of that
            day’s connection sent (0% when sent = 0).
          </NText>
          <template v-if="dailySeries.length > 0">
            <NText depth="3" class="flow-analytics-daily__heatmap-section-title">Merged selection</NText>
            <div class="flow-dash__daily-chart-host flow-dash__heatmap-host flow-dash__heatmap-host--merged">
              <VChart
                class="flow-dash__echart-daily"
                :option="dailyMergedHeatmapOption"
                :update-options="chartUpdateOptions"
                :autoresize="{ throttle: 200 }"
              />
            </div>
          </template>
          <template v-if="dailyByEntity.length >= 1 && dailyByEntity.length <= 2">
            <NText depth="3" class="flow-analytics-daily__heatmap-section-title flow-analytics-daily__heatmap-gap">
              By {{ groupEntitySingular }} (1–2 selected)
            </NText>
            <div class="flow-dash__daily-chart-host flow-dash__heatmap-host">
              <VChart
                class="flow-dash__echart-daily"
                :option="dailyEntityHeatmapOption"
                :update-options="chartUpdateOptions"
                :autoresize="{ throttle: 200 }"
              />
            </div>
          </template>
        </NCard>
      </NSpin>
    </template>
  </div>
</template>

<style scoped>
.flow-analytics-daily__hint {
  display: block;
  margin-bottom: 0.75rem;
  font-size: 0.8125rem;
}

.flow-dash__heatmap-metric-select {
  min-width: 220px;
  max-width: min(420px, 100%);
}

.flow-analytics-daily__heatmap-section-title {
  display: block;
  font-size: 0.8125rem;
  font-weight: 600;
  margin: 0 0 0.35rem;
}

.flow-analytics-daily__heatmap-gap {
  margin-top: 1rem;
}

.flow-dash__heatmap-host--merged {
  min-height: 200px;
  height: min(320px, 40vh);
}
</style>
