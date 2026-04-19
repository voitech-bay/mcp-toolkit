<script setup lang="ts">
import { ref } from "vue";
import { NCard, NText, NInputNumber, NSpace } from "naive-ui";
import ConversationsGeoInsights from "./ConversationsGeoInsights.vue";

defineProps<{
  projectId: string | null;
}>();

const conversationScanLimit = ref(500);
</script>

<template>
  <div class="flow-analytics-geo">
    <NCard size="small" title="Geo filters" class="flow-dash__card flow-dash__card--spaced">
      <NSpace align="center" wrap>
        <NText depth="3">Recent conversations to scan (API limit)</NText>
        <NInputNumber
          v-model:value="conversationScanLimit"
          size="small"
          :min="50"
          :max="2000"
          :step="50"
          :show-button="false"
          style="width: 7rem"
        />
      </NSpace>
    </NCard>
    <NText depth="3" class="flow-analytics-geo__hint">
      Country distribution of recent LinkedIn conversations. Country is parsed from free-text
      <code>Contacts.location</code>; an <strong>Unknown</strong> bucket is expected.
    </NText>
    <ConversationsGeoInsights
      :project-id="projectId"
      hide-limit-control
      :conversation-limit="conversationScanLimit"
    />
  </div>
</template>

<style scoped>
.flow-analytics-geo__hint {
  display: block;
  margin: 0.75rem 0;
  font-size: 0.8125rem;
}
</style>
