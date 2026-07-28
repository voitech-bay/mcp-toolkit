<script setup lang="ts">
import { useRouter } from "vue-router";
import { NButton, NCard, NSpace, NTag, NText } from "naive-ui";
import { ArrowLeftIcon, ArrowRightIcon, LayersIcon } from "lucide-vue-next";
import { PLAY_DEFINITIONS } from "../plays/definitions";
import type { PlayDefinition, PlayStatus } from "../plays/types";

const router = useRouter();

function statusLabel(status: PlayStatus): string {
  return status === "ready" ? "Ready" : "Coming soon";
}

function statusType(status: PlayStatus): "success" | "default" {
  return status === "ready" ? "success" : "default";
}

function openPlay(play: PlayDefinition) {
  void router.push(`/plays/${play.id}`);
}
</script>

<template>
  <div class="plays">
    <NSpace justify="space-between" align="center" style="margin-bottom: 18px">
      <div>
        <NSpace align="center" :size="10">
          <LayersIcon :size="22" />
          <h1 style="margin: 0">Plays</h1>
        </NSpace>
        <NText depth="3" style="display: block; margin-top: 6px">
          Outbound play templates that build a lead list, generate messages from context, and link into Email or Sequence Studio.
        </NText>
      </div>
      <NButton quaternary @click="router.push('/')">
        <ArrowLeftIcon :size="14" style="margin-right: 6px" />
        Overview
      </NButton>
    </NSpace>

    <div class="play-grid">
      <NCard
        v-for="play in PLAY_DEFINITIONS"
        :key="play.id"
        class="play-card"
        hoverable
        @click="openPlay(play)"
      >
        <NSpace justify="space-between" align="start" style="margin-bottom: 10px">
          <h2 class="play-title">{{ play.title }}</h2>
          <NTag size="small" :type="statusType(play.status)" :bordered="false">
            {{ statusLabel(play.status) }}
          </NTag>
        </NSpace>
        <NText depth="3" style="display: block; min-height: 3.2em">{{ play.description }}</NText>
        <NSpace justify="space-between" align="center" style="margin-top: 16px">
          <NText depth="3" style="font-size: 12px">{{ play.resultsHint }}</NText>
          <NButton
            size="small"
            :type="play.status === 'ready' ? 'primary' : 'default'"
            secondary
            @click.stop="openPlay(play)"
          >
            {{ play.status === "ready" ? "Open" : "Preview" }}
            <ArrowRightIcon :size="14" style="margin-left: 6px" />
          </NButton>
        </NSpace>
      </NCard>
    </div>
  </div>
</template>

<style scoped>
.plays {
  max-width: 1760px;
  margin: auto;
  color: #f8fafc;
}
.plays h1 {
  margin: 0;
  font-size: 1.45rem;
}
.play-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 14px;
}
.play-card {
  cursor: pointer;
}
.play-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 650;
  line-height: 1.3;
  padding-right: 8px;
}
</style>
