<script setup lang="ts">
import { computed, h, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NTag,
  NText,
  useDialog,
  useMessage,
} from "naive-ui";
import type { DataTableColumns, SelectOption } from "naive-ui";
import { ArrowLeftIcon, LayersIcon, MailIcon, SendIcon } from "lucide-vue-next";
import { getPlayById } from "../plays/definitions";
import { buildReengageList, daysSinceReply } from "../plays/mock-reengage-leads";
import type { MockPlayRunResult, PlayChannel, ReengageLead } from "../plays/types";

const route = useRoute();
const router = useRouter();
const toast = useMessage();
const dialog = useDialog();

const playId = computed(() => String(route.params.playId ?? ""));
const play = computed(() => getPlayById(playId.value));

const weeksSinceReply = ref<number | null>(2);
const channel = ref<PlayChannel>("any");
const channelOptions: SelectOption[] = [
  { label: "Any channel", value: "any" },
  { label: "Email", value: "email" },
  { label: "LinkedIn", value: "linkedin" },
];

const leads = ref<ReengageLead[]>([]);
const selectedIds = ref<string[]>([]);
const listBuilt = ref(false);
const building = ref(false);
const prompt = ref("");
const running = ref(false);
const result = ref<MockPlayRunResult | null>(null);

watch(playId, () => {
  weeksSinceReply.value = Number(play.value?.defaultParams?.weeksSinceReply ?? 2);
  channel.value = "any";
  leads.value = [];
  selectedIds.value = [];
  listBuilt.value = false;
  prompt.value = "";
  result.value = null;
});

const selectedCount = computed(() => selectedIds.value.length);
const allSelectedOnPage = computed(
  () => leads.value.length > 0 && leads.value.every((l) => selectedIds.value.includes(l.id))
);

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function channelLabel(value: string): string {
  if (value === "email") return "Email";
  if (value === "linkedin") return "LinkedIn";
  return value;
}

const columns = computed<DataTableColumns<ReengageLead>>(() => [
  {
    type: "selection",
  },
  {
    title: "Contact",
    key: "contactName",
    render: (row) =>
      h("div", [
        h("div", { style: "font-weight:600" }, row.contactName),
        h("div", { class: "muted" }, row.title),
      ]),
  },
  { title: "Company", key: "company" },
  {
    title: "Channel",
    key: "channel",
    width: 110,
    render: (row) =>
      h(
        NTag,
        { size: "small", bordered: false, type: row.channel === "email" ? "info" : "warning" },
        { default: () => channelLabel(row.channel) }
      ),
  },
  {
    title: "Last reply",
    key: "lastReplyAt",
    width: 130,
    render: (row) => formatDate(row.lastReplyAt),
  },
  {
    title: "Days since",
    key: "daysSince",
    width: 100,
    render: (row) => String(daysSinceReply(row.lastReplyAt)),
  },
  {
    title: "Snippet",
    key: "lastReplySnippet",
    ellipsis: { tooltip: true },
  },
]);

function buildList() {
  const weeks = weeksSinceReply.value ?? 2;
  weeksSinceReply.value = weeks;
  building.value = true;
  result.value = null;
  selectedIds.value = [];
  // Simulate a short list-build delay (frontend-only stub)
  window.setTimeout(() => {
    leads.value = buildReengageList(weeks, channel.value);
    listBuilt.value = true;
    building.value = false;
    if (leads.value.length === 0) {
      toast.warning("No leads matched these criteria (mock data). Try lowering the weeks threshold.");
    } else {
      toast.success(`Built list of ${leads.value.length} lead${leads.value.length === 1 ? "" : "s"} (mock).`);
    }
  }, 350);
}

function toggleSelectPage() {
  if (allSelectedOnPage.value) {
    const pageIds = new Set(leads.value.map((l) => l.id));
    selectedIds.value = selectedIds.value.filter((id) => !pageIds.has(id));
  } else {
    const merged = new Set([...selectedIds.value, ...leads.value.map((l) => l.id)]);
    selectedIds.value = [...merged];
  }
}

function runPlay() {
  if (selectedIds.value.length === 0) {
    toast.warning("Select at least one lead.");
    return;
  }
  dialog.warning({
    title: "Run this play?",
    content: `Generate re-engagement messages for ${selectedIds.value.length} selected lead${
      selectedIds.value.length === 1 ? "" : "s"
    }. Frontend stub only — no backend yet.`,
    positiveText: "Run play",
    negativeText: "Cancel",
    onPositiveClick: () => {
      running.value = true;
      const loading = toast.loading("Pulling context and generating messages…", { duration: 0 });
      window.setTimeout(() => {
        loading.destroy();
        running.value = false;
        const draftIds = selectedIds.value.map((id, i) => `draft-mock-${id}-${i + 1}`);
        result.value = {
          selectedCount: selectedIds.value.length,
          weeksSinceReply: weeksSinceReply.value ?? 2,
          channel: channel.value,
          prompt: prompt.value.trim(),
          draftIds,
          ranAt: new Date().toISOString(),
        };
        toast.success(`Play complete — ${draftIds.length} mock draft${draftIds.length === 1 ? "" : "s"} ready.`);
      }, 900);
    },
  });
}

function goEmailStudio() {
  void router.push("/email-studio");
}

function goSequenceStudio() {
  void router.push("/sequence-studio");
}
</script>

<template>
  <div class="play-runner">
    <NSpace justify="space-between" align="center" style="margin-bottom: 16px">
      <div>
        <NSpace align="center" :size="8" style="margin-bottom: 4px">
          <NButton quaternary size="tiny" @click="router.push('/plays')">
            <ArrowLeftIcon :size="14" style="margin-right: 4px" />
            Plays
          </NButton>
        </NSpace>
        <template v-if="play">
          <NSpace align="center" :size="10">
            <LayersIcon :size="20" />
            <h1 style="margin: 0">{{ play.title }}</h1>
            <NTag
              size="small"
              :type="play.status === 'ready' ? 'success' : 'default'"
              :bordered="false"
            >
              {{ play.status === "ready" ? "Ready" : "Coming soon" }}
            </NTag>
          </NSpace>
          <NText depth="3" style="display: block; margin-top: 6px">{{ play.description }}</NText>
        </template>
        <template v-else>
          <h1 style="margin: 0">Play not found</h1>
          <NText depth="3">This play template does not exist.</NText>
        </template>
      </div>
    </NSpace>

    <NAlert v-if="!play" type="error" style="margin-bottom: 14px" :show-icon="false">
      Unknown play id “{{ playId }}”.
      <NButton text type="primary" style="margin-left: 8px" @click="router.push('/plays')">Back to catalog</NButton>
    </NAlert>

    <template v-else-if="play.status === 'coming_soon'">
      <NCard>
        <NEmpty description="This play is coming soon">
          <template #extra>
            <NText depth="3" style="display: block; max-width: 420px; margin: 0 auto 12px; text-align: center">
              {{ play.resultsHint }} Frontend shell only — runner and workflows will land in a later slice.
            </NText>
            <NButton @click="router.push('/plays')">Back to Plays</NButton>
          </template>
        </NEmpty>
      </NCard>
    </template>

    <template v-else-if="play.id === 're-engage-replied'">
      <NCard size="small" style="margin-bottom: 12px">
        <div class="criteria">
          <div>
            <NText depth="3" style="display: block; margin-bottom: 4px; font-size: 12px">Weeks since last reply</NText>
            <NInputNumber v-model:value="weeksSinceReply" :min="1" :max="52" style="width: 120px" />
          </div>
          <div>
            <NText depth="3" style="display: block; margin-bottom: 4px; font-size: 12px">Channel</NText>
            <NSelect v-model:value="channel" :options="channelOptions" style="width: 160px" />
          </div>
          <div class="criteria-actions">
            <NButton type="primary" :loading="building" @click="buildList">Build list</NButton>
          </div>
        </div>
        <NText depth="3" style="display: block; margin-top: 10px; font-size: 12px">
          Mock data for now. Building the list filters leads whose last reply was at least
          {{ weeksSinceReply ?? 2 }} week{{ (weeksSinceReply ?? 2) === 1 ? "" : "s" }} ago.
        </NText>
      </NCard>

      <div v-if="listBuilt" class="bulk-bar">
        <NSpace align="center">
          <NButton size="small" secondary @click="toggleSelectPage">
            {{ allSelectedOnPage ? "Clear page" : "Select page" }}
          </NButton>
          <NText depth="3">{{ selectedCount }} selected · {{ leads.length }} in list</NText>
        </NSpace>
        <NButton
          type="primary"
          :disabled="selectedCount === 0 || running"
          :loading="running"
          @click="runPlay"
        >
          Run play
        </NButton>
      </div>

      <NCard v-if="listBuilt" size="small" style="margin-bottom: 12px">
        <NDataTable
          v-model:checked-row-keys="selectedIds"
          :columns="columns"
          :data="leads"
          :row-key="(row: ReengageLead) => row.id"
          :bordered="false"
          size="small"
          :max-height="420"
        />
        <NEmpty v-if="leads.length === 0" description="No matching leads" style="padding: 24px 0" />
      </NCard>

      <NCard v-if="listBuilt && leads.length > 0" size="small" style="margin-bottom: 12px">
        <NText strong style="display: block; margin-bottom: 8px">Generation prompt</NText>
        <NText depth="3" style="display: block; margin-bottom: 8px; font-size: 12px">
          Optional direction for generated messages. The play will pull each lead’s conversation and context
          (simulated for now).
        </NText>
        <NInput
          v-model:value="prompt"
          type="textarea"
          placeholder="Optional regeneration direction… e.g. reference their SOC2 timeline and keep it under 80 words"
          :autosize="{ minRows: 3, maxRows: 8 }"
        />
        <NSpace style="margin-top: 12px" justify="end">
          <NButton
            type="primary"
            :disabled="selectedCount === 0 || running"
            :loading="running"
            @click="runPlay"
          >
            Run play for {{ selectedCount || "…" }} lead{{ selectedCount === 1 ? "" : "s" }}
          </NButton>
        </NSpace>
      </NCard>

      <NCard v-if="result" size="small" title="Play result (mock)">
        <NAlert type="success" :show-icon="false" style="margin-bottom: 12px">
          Generated {{ result.draftIds.length }} draft{{ result.draftIds.length === 1 ? "" : "s" }} for
          {{ result.selectedCount }} lead{{ result.selectedCount === 1 ? "" : "s" }}
          ({{ result.weeksSinceReply }}+ weeks, {{ channelLabel(result.channel) }}).
          <span v-if="result.prompt"> Prompt used.</span>
        </NAlert>
        <NText depth="3" style="display: block; margin-bottom: 10px; font-size: 12px">
          {{ play.resultsHint }} Review drafts in the studios below when backend wiring lands.
        </NText>
        <NSpace>
          <NButton secondary @click="goEmailStudio">
            <MailIcon :size="14" style="margin-right: 6px" />
            Open Email Studio
          </NButton>
          <NButton secondary @click="goSequenceStudio">
            <SendIcon :size="14" style="margin-right: 6px" />
            Open Sequence Studio
          </NButton>
        </NSpace>
        <div class="draft-ids">
          <NText depth="3" style="font-size: 11px">Mock draft ids: {{ result.draftIds.join(", ") }}</NText>
        </div>
      </NCard>

      <NEmpty
        v-if="!listBuilt"
        description="Set criteria and press Build list to load matching leads"
        style="padding: 48px 0"
      />
    </template>
  </div>
</template>

<style scoped>
.play-runner {
  max-width: 1760px;
  margin: auto;
  color: #f8fafc;
}
.play-runner h1 {
  margin: 0;
  font-size: 1.35rem;
}
.criteria {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: flex-end;
}
.criteria-actions {
  padding-bottom: 2px;
}
.bulk-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  margin-bottom: 10px;
  border: 1px solid rgba(128, 128, 128, 0.28);
  border-radius: 10px;
  background: rgba(24, 24, 28, 0.92);
  backdrop-filter: blur(8px);
}
.muted {
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
}
.draft-ids {
  margin-top: 12px;
  word-break: break-all;
}
</style>
