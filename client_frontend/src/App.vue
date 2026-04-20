<script setup lang="ts">
import { useDark } from "@vueuse/core";
import { NConfigProvider, darkTheme } from "naive-ui";

const isDark = useDark();
isDark.value = true;
</script>

<template>
  <NConfigProvider :theme="darkTheme">
    <main class="client-frontend-main">
      <router-view />
    </main>
  </NConfigProvider>
</template>

<style scoped>
.client-frontend-main {
  min-height: 100vh;
  background: #101014;
}
</style>
