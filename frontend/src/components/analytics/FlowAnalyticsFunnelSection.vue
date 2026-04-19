<script setup lang="ts">
import { NCard, NSelect, NText, NAlert } from "naive-ui";
import type { SelectOption } from "naive-ui";
import type { EChartsOption } from "echarts";
import VChart from "vue-echarts";
import { FUNNEL_REACH_DISPLAY_CAP, FUNNEL_SANKEY_FLOW_LIMIT } from "./flow-analytics-constants.js";

const funnelSankeyMode = defineModel<string>("funnelSankeyMode", { required: true });

defineProps<{
  funnelSankeyModeOptions: SelectOption[];
  funnelSankeyOption: EChartsOption;
  groupEntityPlural: string;
  groupEntitySingular: string;
  flowsLength: number;
  selectedCount: number;
  chartUpdateOptions: { notMerge: boolean };
}>();
</script>

<template>
  <div class="flow-analytics-funnel">
    <NText v-if="flowsLength > 0" depth="3" class="flow-analytics-funnel__hint">
      Pick {{ groupEntityPlural }} under <strong>Filters</strong>. Funnels match <code>render_funnel_chart</code>:
      connection sent → accepted → inbox reply → inbox positive (<code>sort: none</code>).
    </NText>
    <template v-if="flowsLength > 0">
      <NAlert v-if="selectedCount === 0" type="info" :title="`No ${groupEntityPlural} selected`" class="flow-dash__alert">
        Select at least one tag under <strong>Filters</strong> to render charts.
      </NAlert>
      <template v-else>
        <NCard title="Funnel Alluvial" size="small" class="flow-dash__card flow-dash__card--spaced">
          <div class="flow-dash__sankey-toolbar">
            <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
              Per-{{ groupEntitySingular }} attribution through every stage:
              <strong>Sent → Accepted → Inbox → Positive</strong> (absolute &amp; conversion), or
              <strong>Accepted → …</strong> (downstream only), or
              <strong>Reach → Sent → …</strong> when <strong>Hypotheses</strong> is selected and tagged-reach exists. Top
              {{ FUNNEL_SANKEY_FLOW_LIMIT }} selected {{ groupEntityPlural }} by connection sent; remainder rolled into "Other".
              When available, a final <strong>Pipeline</strong> stage is appended from
              <code>FlowLeads → Contacts.pipeline_stage_uuid → PipelineStages</code>.
              All modes normalize each stage column to <strong>100%</strong>; strata heights show that stage’s shares by
              {{ groupEntitySingular }}. Reach basis uses max(tagged reach, sent) (reach capped at
              {{ FUNNEL_REACH_DISPLAY_CAP.toLocaleString() }}); later links use funnel counts — read tooltips.
            </NText>
            <NSelect
              v-model:value="funnelSankeyMode"
              :options="funnelSankeyModeOptions"
              size="small"
              class="flow-dash__sankey-mode-select"
            />
          </div>
          <div class="flow-dash__compare-host flow-dash__chart-tall">
            <VChart
              class="flow-dash__echart-compare flow-dash__echart-fill"
              :option="funnelSankeyOption"
              :update-options="chartUpdateOptions"
              :autoresize="{ throttle: 200 }"
            />
          </div>
        </NCard>
      </template>
    </template>
  </div>
</template>

<style scoped>
.flow-analytics-funnel__hint {
  display: block;
  margin-bottom: 0.75rem;
  font-size: 0.8125rem;
}
</style>
