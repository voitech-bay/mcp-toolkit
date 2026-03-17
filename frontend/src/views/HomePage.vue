<script setup lang="ts">
import { NH1, NH3, NButton } from "naive-ui";
import { useRouter } from "vue-router";

const router = useRouter();
</script>

<template>
  <div class="home">
    <NH1 class="title">MCP Toolkit</NH1>
    <NH3 class="subtitle">
      MCP endpoint: <a href="/api/mcp" target="_blank" rel="noopener">/api/mcp</a>
    </NH3>
    <div class="actions">
      <NButton type="primary" size="large" @click="router.push('/tables')">
        Open Tables
      </NButton>
    </div>
  </div>
</template>

<style scoped>
.home {
  max-width: 640px;
  margin: 0 auto;
  padding: 3rem 1.5rem;
  text-align: center;
}
.title {
  font-size: 2rem;
  font-weight: 600;
  margin: 0 0 0.5rem 0;
}
.subtitle {
  margin: 0 0 2rem 0;
  opacity: 0.8;
  font-size: 1rem;
}
.subtitle a {
  color: var(--n-primary-color);
}
.actions {
  display: flex;
  justify-content: center;
  gap: 0.75rem;
}
</style>
