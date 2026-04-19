<script setup lang="ts">
import { NCard, NText, NTag } from "naive-ui";
import AnalyticsMetricMatrix from "./AnalyticsMetricMatrix.vue";
import type {
  FlowFunnelRow,
  FlowFunnelProjectTotalsPayload,
  FlowFunnelComparisonPayload,
} from "./flow-analytics-types.js";

type DeltaTag = { text: string; type: "default" | "success" | "error" } | null;

defineProps<{
  groupEntityPlural: string;
  groupEntityTitle: string;
  groupEntitySingular: string;
  projectTotalsCardTitle: string;
  displayFunnelTotals: FlowFunnelProjectTotalsPayload;
  funnelComparison: FlowFunnelComparisonPayload | null;
  deltaSent: DeltaTag;
  deltaAccepted: DeltaTag;
  deltaInbox: DeltaTag;
  deltaPositive: DeltaTag;
  deltaAccRate: DeltaTag;
  deltaInboxRate: DeltaTag;
  deltaPositiveRate: DeltaTag;
  flows: FlowFunnelRow[];
  selectedFlowUuids: string[];
}>();

function formatInt(n: number): string {
  return new Intl.NumberFormat().format(Math.round(n));
}
</script>

<template>
  <div class="flow-analytics-totals">
    <NText v-if="flows.length > 0" depth="3" class="flow-analytics-totals__hint">
      Project-wide totals (always all {{ groupEntityPlural }} in range) and selected {{ groupEntityPlural }} matrix.
      Toggle tags in <strong>Filters</strong> above.
    </NText>
    <template v-if="flows.length > 0">
      <NCard :title="projectTotalsCardTitle" size="small" class="flow-dash__card flow-dash__card--spaced flow-dash__stats-card">
        <NText v-if="funnelComparison" depth="3" class="flow-dash__stats-sub">
          vs prior window {{ funnelComparison.previousDateFrom }} → {{ funnelComparison.previousDateTo }} (same length)
        </NText>
        <div class="flow-dash__stats-cols">
          <div class="flow-dash__stat-col">
            <NText depth="3" class="flow-dash__stat-col-label">Connection sent</NText>
            <div class="flow-dash__stat-col-value">
              <span class="flow-dash__stat-col-num">{{ formatInt(displayFunnelTotals.connectionSent) }}</span>
              <NTag v-if="deltaSent" size="small" :bordered="false" :type="deltaSent.type">{{ deltaSent.text }}</NTag>
            </div>
          </div>
          <div class="flow-dash__stat-col">
            <NText depth="3" class="flow-dash__stat-col-label">Connection accepted</NText>
            <div class="flow-dash__stat-col-value">
              <span class="flow-dash__stat-col-num">{{ formatInt(displayFunnelTotals.connectionAccepted) }}</span>
              <NTag v-if="deltaAccepted" size="small" :bordered="false" :type="deltaAccepted.type">{{
                deltaAccepted.text
              }}</NTag>
            </div>
          </div>
          <div class="flow-dash__stat-col">
            <NText depth="3" class="flow-dash__stat-col-label">Inbox reply</NText>
            <div class="flow-dash__stat-col-value">
              <span class="flow-dash__stat-col-num">{{ formatInt(displayFunnelTotals.inbox) }}</span>
              <NTag v-if="deltaInbox" size="small" :bordered="false" :type="deltaInbox.type">{{ deltaInbox.text }}</NTag>
            </div>
          </div>
          <div class="flow-dash__stat-col">
            <NText depth="3" class="flow-dash__stat-col-label">Inbox positive</NText>
            <div class="flow-dash__stat-col-value">
              <span class="flow-dash__stat-col-num">{{ formatInt(displayFunnelTotals.positiveReplies) }}</span>
              <NTag v-if="deltaPositive" size="small" :bordered="false" :type="deltaPositive.type">{{
                deltaPositive.text
              }}</NTag>
            </div>
          </div>
          <div class="flow-dash__stat-col">
            <NText depth="3" class="flow-dash__stat-col-label">Accepted rate (÷ sent)</NText>
            <div class="flow-dash__stat-col-value">
              <span class="flow-dash__stat-col-num">{{
                displayFunnelTotals.acceptedRatePct == null ? "—" : `${displayFunnelTotals.acceptedRatePct.toFixed(1)}%`
              }}</span>
              <NTag v-if="deltaAccRate" size="small" :bordered="false" :type="deltaAccRate.type">{{ deltaAccRate.text }}</NTag>
            </div>
          </div>
          <div class="flow-dash__stat-col">
            <NText depth="3" class="flow-dash__stat-col-label">Inbox rate (÷ sent)</NText>
            <div class="flow-dash__stat-col-value">
              <span class="flow-dash__stat-col-num">{{
                displayFunnelTotals.inboxRatePct == null ? "—" : `${displayFunnelTotals.inboxRatePct.toFixed(1)}%`
              }}</span>
              <NTag v-if="deltaInboxRate" size="small" :bordered="false" :type="deltaInboxRate.type">{{
                deltaInboxRate.text
              }}</NTag>
            </div>
          </div>
          <div class="flow-dash__stat-col">
            <NText depth="3" class="flow-dash__stat-col-label">Positive rate (÷ sent)</NText>
            <div class="flow-dash__stat-col-value">
              <span class="flow-dash__stat-col-num">{{
                displayFunnelTotals.positiveRatePct == null
                  ? "—"
                  : `${displayFunnelTotals.positiveRatePct.toFixed(1)}%`
              }}</span>
              <NTag v-if="deltaPositiveRate" size="small" :bordered="false" :type="deltaPositiveRate.type">{{
                deltaPositiveRate.text
              }}</NTag>
            </div>
          </div>
        </div>
      </NCard>

      <AnalyticsMetricMatrix
        section="performance"
        :flows="flows"
        :selected-flow-uuids="selectedFlowUuids"
        :group-entity-title="groupEntityTitle"
        :group-entity-plural="groupEntityPlural"
        :group-entity-singular="groupEntitySingular"
      />
    </template>
  </div>
</template>

<style scoped>
.flow-analytics-totals__hint {
  display: block;
  margin-bottom: 0.75rem;
  font-size: 0.8125rem;
}
</style>
