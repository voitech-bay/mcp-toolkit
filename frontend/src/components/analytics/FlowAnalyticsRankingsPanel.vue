<script setup lang="ts">
import { computed } from "vue";
import { NAlert, NSpin, NText, NCard, NDatePicker, NSelect } from "naive-ui";
import type { SelectOption } from "naive-ui";
import AnalyticsMetricMatrix from "./AnalyticsMetricMatrix.vue";
import type { FlowFunnelRow } from "./flow-analytics-types.js";

const dateRange = defineModel<[number, number] | null>("dateRange", { required: true });
const statsWindowDays = defineModel<number>("statsWindowDays", { required: true });

const props = defineProps<{
  projectId: string | null;
  flows: FlowFunnelRow[];
  statsWindowOptions: SelectOption[];
  groupEntityTitle: string;
  groupEntityPlural: string;
  groupEntitySingular: string;
  loading: boolean;
  collectingDays: boolean;
  loadError: string;
}>();

/** Rankings matrix charts can compare any entity in the loaded window (no tag filter on this tab). */
const allEntityUuids = computed(() => props.flows.map((f) => f.flowUuid));
</script>

<template>
  <div class="flow-analytics-rankings">
    <NCard title="Date range" size="small" class="flow-dash__card flow-dash__card--spaced flow-dash__filters-card" :bordered="true">
      <div class="flow-dash__filters-block">
        <div class="flow-dash__filters-block-head">
          <span class="flow-dash__filters-title">Snapshot window</span>
          <span class="flow-dash__filters-sub">Same range as project analytics; changing it reloads rankings.</span>
        </div>
        <div style="display: flex; flex-direction: row; gap: 0.5rem;">
          <NDatePicker
            v-model:value="dateRange"
            type="daterange"
            size="small"
            clearable
            class="flow-dash__filters-dp"
            :disabled="collectingDays || loading"
          />
          <NSelect
            v-model:value="statsWindowDays"
            size="small"
            :options="statsWindowOptions"
            placeholder="Period"
            class="flow-dash__filters-dp"
            :disabled="collectingDays || loading"
          />
        </div>
      </div>
    </NCard>

    <NText v-if="flows.length > 0" depth="3" class="flow-analytics-rankings__hint">
      Top and least use <strong>all {{ groupEntityPlural }}</strong> in the range above.
      <strong>Group by</strong> (flow vs hypothesis) is on the <strong>Funnel &amp; daily</strong> tab.
    </NText>
    <NAlert v-if="loadError" type="error" class="flow-dash__alert" :title="loadError" />
    <NSpin :show="collectingDays || loading">
      <template v-if="flows.length > 0">
        <AnalyticsMetricMatrix
          :project-id="projectId"
          section="rankings"
          :flows="flows"
          :selected-flow-uuids="allEntityUuids"
          :group-entity-title="groupEntityTitle"
          :group-entity-plural="groupEntityPlural"
          :group-entity-singular="groupEntitySingular"
        />
      </template>
      <NAlert
        v-else-if="!loadError && !loading && !collectingDays"
        type="info"
        :title="`No ${groupEntityPlural}`"
        class="flow-dash__alert"
      >
        Nothing in this range. Widen the <strong>Date range</strong> above or switch <strong>Group by</strong> on
        <strong>Funnel &amp; daily</strong>.
      </NAlert>
    </NSpin>
  </div>
</template>

<style scoped>
.flow-analytics-rankings__hint {
  display: block;
  margin-bottom: 0.75rem;
  font-size: 0.8125rem;
}

.flow-dash__filters-dp {
  flex: 0 1 260px;
}
</style>
