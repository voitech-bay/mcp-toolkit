<script setup lang="ts">
import { NCard, NSelect, NText, NAlert, NInputNumber } from "naive-ui";
import type { SelectOption } from "naive-ui";
import type { EChartsOption } from "echarts";
import VChart from "vue-echarts";
import { FUNNEL_REACH_DISPLAY_CAP, FUNNEL_SANKEY_FLOW_LIMIT } from "./flow-analytics-constants.js";

const funnelSankeyMode = defineModel<string>("funnelSankeyMode", { required: true });
const selectedPipelineStageUuids = defineModel<string[]>("selectedPipelineStageUuids", {
  required: true,
});
const pipelineStagePositions = defineModel<Record<string, number>>("pipelineStagePositions", {
  required: true,
});

const props = defineProps<{
  funnelSankeyModeOptions: SelectOption[];
  funnelSankeyOption: EChartsOption;
  pipelineStageOptions: SelectOption[];
  pipelineStageNameByUuid: Record<string, string>;
  groupEntityPlural: string;
  groupEntitySingular: string;
  flowsLength: number;
  selectedCount: number;
  chartUpdateOptions: { notMerge: boolean };
}>();

function pipelineStagePositionValue(uuid: string): number {
  const v = pipelineStagePositions.value?.[uuid];
  return Number.isFinite(v) ? Math.max(1, Math.trunc(v as number)) : 1;
}

function setPipelineStagePosition(uuid: string, val: number | null): void {
  const next = { ...(pipelineStagePositions.value ?? {}) };
  next[uuid] = Number.isFinite(val as number) ? Math.max(1, Math.trunc(val as number)) : 1;
  pipelineStagePositions.value = next;
}
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
              Pipeline stages are available from <code>FlowLeads → Contacts.pipeline_stage_uuid → PipelineStages</code>;
              select which to show and set stage positions below.
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
          <div v-if="pipelineStageOptions.length > 0" class="flow-dash__pipeline-stage-config">
            <NText depth="3" class="flow-dash__hint flow-dash__hint--tight">
              Pipeline stages in funnel: choose stages, then set each stage position (1 = earliest).
            </NText>
            <NSelect
              v-model:value="selectedPipelineStageUuids"
              multiple
              filterable
              clearable
              :options="pipelineStageOptions"
              placeholder="Select pipeline stages to display"
              size="small"
            />
            <div
              v-for="uuid in selectedPipelineStageUuids"
              :key="uuid"
              class="flow-dash__pipeline-stage-row"
            >
              <NText depth="3">{{ props.pipelineStageNameByUuid[uuid] ?? uuid }}</NText>
              <NInputNumber
                :value="pipelineStagePositionValue(uuid)"
                :min="1"
                :max="20"
                size="small"
                @update:value="(v) => setPipelineStagePosition(uuid, v)"
              />
            </div>
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

.flow-dash__pipeline-stage-config {
  margin: 0.5rem 0 0.75rem;
  display: grid;
  gap: 0.4rem;
}

.flow-dash__pipeline-stage-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}
</style>
