<script setup lang="ts">
import { computed, onMounted, h } from "vue";
import { useDark } from "@vueuse/core";
import { useRoute, useRouter } from "vue-router";
import { NConfigProvider, NButton, NSpace, NSelect, NMessageProvider, NCard } from "naive-ui";
import type { SelectOption } from "naive-ui";
import { darkTheme, lightTheme } from "naive-ui";
import { MoonIcon, SunIcon, LayoutDashboardIcon, TableIcon, RefreshCwIcon } from "lucide-vue-next";
import { useProjectStore } from "./stores/project";

const isDark = useDark();
isDark.value = true;

const naiveTheme = computed(() => (isDark.value ? darkTheme : lightTheme));

const route = useRoute();
const router = useRouter();
const isTables = computed(() => route.path === "/tables");
const isHome = computed(() => route.path === "/");
const isSync = computed(() => route.path === "/sync");

const projectStore = useProjectStore();

const projectOptions = computed<SelectOption[]>(() =>
  projectStore.projects.map((p) => ({ label: p.name, value: p.id }))
);

const selectedProjectId = computed({
  get: () => projectStore.selectedProjectId,
  set: (id: string | null) => projectStore.selectProject(id),
});

function renderProjectLabel(option: SelectOption) {
  const proj = projectStore.projects.find((p) => p.id === option.value);
  return h("div", { style: "display:flex;align-items:center;gap:8px" }, [
    h("span", {
      style: `width:8px;height:8px;border-radius:50%;background:${proj?.api_key_set ? "#18a058" : "#d03050"};flex-shrink:0`,
    }),
    h("span", {}, option.label as string),
    proj?.description
      ? h("span", { style: "opacity:.5;font-size:.85em;margin-left:4px" }, proj.description)
      : null,
  ].filter(Boolean) as ReturnType<typeof h>[]);
}

function toggleTheme() {
  isDark.value = !isDark.value;
}

onMounted(() => projectStore.loadProjects());
</script>

<template>
  <NMessageProvider>
    <NConfigProvider :theme="naiveTheme">
      <div class="app">
        <NCard class="header-card">
          <header class="header">
            <div class="header-project">
              <NSelect
                v-model:value="selectedProjectId"
                :options="projectOptions"
                :loading="projectStore.loading"
                :render-label="renderProjectLabel"
                placeholder="Select project…"
                clearable
                size="small"
                style="width: 220px"
              />
            </div>
            <div class="nav-row">
              <NSpace>
                <NButton quaternary :type="isHome ? 'primary' : undefined" size="small" @click="router.push('/')">
                  <LayoutDashboardIcon :size="14" style="margin-right: 4px" />
                  Home
                </NButton>
                <NButton quaternary :type="isTables ? 'primary' : undefined" size="small" @click="router.push('/tables')">
                  <TableIcon :size="14" style="margin-right: 4px" />
                  Tables
                </NButton>
                <NButton quaternary :type="isSync ? 'primary' : undefined" size="small" @click="router.push('/sync')">
                  <RefreshCwIcon :size="14" style="margin-right: 4px" />
                  Sync
                </NButton>
                <NButton quaternary @click="toggleTheme()" size="small">
                  <SunIcon :size="14" v-if="isDark" />
                  <MoonIcon :size="14" v-else />
                </NButton>
              </NSpace>
            </div>
          </header>
        </NCard>

        <main class="main">
          <template v-if="!projectStore.selectedProjectId">
            <img src="https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExcjV0cTJibmdkZmJ0YmZ5ODJoa3BqMHlibTU1eTBmdmpleW5lbmlscyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/a3kvBNAcxPv9TdEnkq/giphy.gif" alt="No project selected" />
            <NAlert type="info" class="no-project-alert">
              Select a project in the header to browse its data.
            </NAlert>
          </template>
          <template v-else>
            <router-view />
          </template>
        </main>
      </div>
    </NConfigProvider>
  </NMessageProvider>
</template>

<style scoped>
.header-card {
  max-width: 1600px;
  margin: 0 auto;
}

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  padding: 0.5rem 1.5rem 0.75rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 0 auto;
}

.header-project {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.nav-row {
  display: flex;
  align-items: center;
}

.main {
  flex: 1;
  max-width: 1600px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  width: 100%;
}
</style>
