<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";

defineProps<NodeProps<Record<string, unknown>>>();
</script>

<template>
  <Handle type="target" :position="Position.Left" />
  <div class="insight-node">
    <div class="insight-node__type">{{ data.source_type }}</div>
    <div class="insight-node__label">{{ data.label }}</div>
  </div>
</template>

<style scoped>
.insight-node {
  width: 190px;
  border: 1px solid rgba(99, 226, 183, 0.55);
  border-radius: 8px;
  padding: 10px;
  background: #15211f;
  color: #f3f7f6;
}
.insight-node__type {
  color: #63e2b7;
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: .06em;
}
.insight-node__label {
  font-size: .78rem;
  font-weight: 600;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
