<script setup lang="ts">
import { computed } from "vue";
import { NCard, NSpace, NText } from "naive-ui";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { sections } from "./how-to-guide-content";

const renderedSections = computed(() =>
  sections.map((section) => ({
    ...section,
    html: DOMPurify.sanitize(marked.parse(section.markdown.trim()) as string),
  }))
);
</script>

<template>
  <div class="how-to-guide">
    <div class="header-row">
      <div>
        <NText tag="h1">How-to Guide</NText>
        <NText depth="3">A plain-language walkthrough of Voitech for running the Velvetech campaign.</NText>
      </div>
    </div>

    <NCard title="On this page" size="small" class="toc-card">
      <NSpace size="small" wrap>
        <a v-for="section in sections" :key="section.id" :href="`#${section.id}`" class="toc-link">
          {{ section.title }}
        </a>
      </NSpace>
    </NCard>

    <NSpace vertical size="large">
      <NCard
        v-for="section in renderedSections"
        :key="section.id"
        :id="section.id"
        :title="section.title"
        size="small"
        class="section-card"
      >
        <div class="guide-markdown" v-html="section.html" />
      </NCard>
    </NSpace>
  </div>
</template>

<style scoped>
.how-to-guide {
  max-width: 900px;
  margin: 0 auto;
}
.header-row {
  margin-bottom: 14px;
}
.header-row h1 {
  margin: 0 0 4px;
}
.toc-card {
  margin-bottom: 16px;
  scroll-margin-top: 16px;
}
.toc-link {
  color: #2080f0;
  text-decoration: none;
  font-size: 0.88rem;
}
.toc-link:hover {
  text-decoration: underline;
}
.guide-markdown {
  line-height: 1.65;
  font-size: 0.92rem;
}
.guide-markdown :deep(h3) {
  margin: 18px 0 6px;
  font-size: 1.02rem;
}
.guide-markdown :deep(h3:first-child) {
  margin-top: 0;
}
.guide-markdown :deep(p) {
  margin: 8px 0;
}
.guide-markdown :deep(ul),
.guide-markdown :deep(ol) {
  margin: 8px 0;
  padding-left: 22px;
}
.guide-markdown :deep(li) {
  margin: 4px 0;
}
.guide-markdown :deep(li > ul),
.guide-markdown :deep(li > ol) {
  margin: 4px 0;
}
.guide-markdown :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.16);
  font-size: 0.88em;
}
.guide-markdown :deep(strong) {
  font-weight: 600;
}
.section-card {
  scroll-margin-top: 16px;
}
</style>
