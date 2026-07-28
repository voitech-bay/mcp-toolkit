<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useDark } from "@vueuse/core";
import { NButton, NSpace, NText } from "naive-ui";
import { ArrowLeftIcon } from "lucide-vue-next";

const router = useRouter();
const iframeEl = ref<HTMLIFrameElement | null>(null);
const isDark = useDark();
const iframeSrc = computed(
  () => `/docs/velvetech-pipeline-dataflow.html?theme=${isDark.value ? "dark" : "light"}`
);

watch(iframeSrc, (src) => {
  if (iframeEl.value) iframeEl.value.src = src;
});
</script>

<template>
  <div class="data-flow-page">
    <div class="header-row">
      <NSpace align="center" :size="10">
        <NButton quaternary size="small" @click="router.push('/how-to-guide')">
          <ArrowLeftIcon :size="14" style="margin-right: 4px" />
          How-to Guide
        </NButton>
        <div>
          <NText tag="h1">Data Flow Diagram</NText>
          <NText depth="3">
            Field-level contract for the Velvetech research pipeline (CSV → POV).
          </NText>
        </div>
      </NSpace>
    </div>

    <iframe
      ref="iframeEl"
      class="data-flow-frame"
      :src="iframeSrc"
      title="Velvetech research pipeline data flow"
    />
  </div>
</template>

<style scoped>
.data-flow-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 120px);
  min-height: 520px;
  margin: -4px -8px 0;
}
.header-row {
  margin-bottom: 10px;
  padding: 0 8px;
}
.header-row h1 {
  margin: 0 0 2px;
  font-size: 1.15rem;
}
.data-flow-frame {
  flex: 1;
  width: 100%;
  border: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.28));
  border-radius: 8px;
  background: transparent;
}
</style>
