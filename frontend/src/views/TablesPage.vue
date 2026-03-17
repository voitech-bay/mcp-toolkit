<script setup lang="ts">
import LatestTables from "../components/LatestTables.vue";
import { useProjectStore } from "../stores/project";

const projectStore = useProjectStore();
</script>

<template>
  <div class="tables-page">
    <LatestTables
      v-if="projectStore.selectedProjectId"
      :project-id="projectStore.selectedProjectId"
    />
  </div>
</template>

<style scoped>
.tables-page {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.no-project-alert {
  max-width: 480px;
}
</style>
