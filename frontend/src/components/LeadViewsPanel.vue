<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import {
  NSpace,
  NSelect,
  NInput,
  NButton,
  NTabs,
  NTabPane,
  NEmpty,
  NSpin,
  NAlert,
  NText,
  useMessage,
} from "naive-ui";
import type { SelectOption } from "naive-ui";
import LeadResultCard from "./LeadResultCard.vue";
import type { LeadItem } from "./LeadResultCard.vue";
import { useProjectStore } from "../stores/project";

type LeadView = "best_fit" | "review" | "disqualified";

const props = defineProps<{ initialLaunchId?: string; initialExecutionId?: string }>();

const message = useMessage();
const projectStore = useProjectStore();
const projectId = computed(() => projectStore.selectedProjectId);

type ScopeMode = "recent" | "launch" | "execution";
const scopeMode = ref<ScopeMode>(
  props.initialLaunchId ? "launch" : props.initialExecutionId ? "execution" : "recent"
);
const scopeValue = ref<string>(props.initialLaunchId || props.initialExecutionId || "");

const scopeOptions: SelectOption[] = [
  { label: "Recent results", value: "recent" },
  { label: "By launch id", value: "launch" },
  { label: "By execution id", value: "execution" },
];

const loading = ref(false);
const loadError = ref("");
const items = ref<LeadItem[]>([]);
const counts = ref<Record<LeadView, number>>({ best_fit: 0, review: 0, disqualified: 0 });
const activeView = ref<LeadView>("best_fit");
const selected = ref<Set<string>>(new Set());

// Launch-selected controls
const workflows = ref<{ key: string; label: string; configured: boolean }[]>([]);
const launchWorkflow = ref<string | null>(null);
const launching = ref(false);

const workflowOptions = computed<SelectOption[]>(() =>
  workflows.value.map((w) => ({
    label: w.configured ? w.label : `${w.label} (not configured)`,
    value: w.key,
    disabled: !w.configured,
  }))
);

const viewItems = computed(() => items.value.filter((i) => i.view === activeView.value));
const selectedItems = computed(() => items.value.filter((i) => selected.value.has(i.result_id)));

async function loadWorkflows(): Promise<void> {
  try {
    const r = await fetch("/api/n8n/workflows");
    const data = (await r.json()) as { items?: typeof workflows.value };
    workflows.value = data.items ?? [];
    const firstConfigured = workflows.value.find((w) => w.configured);
    if (firstConfigured && !launchWorkflow.value) launchWorkflow.value = firstConfigured.key;
  } catch {
    /* non-fatal */
  }
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = "";
  selected.value = new Set();
  try {
    const body: Record<string, unknown> = {};
    if (scopeMode.value === "launch" && scopeValue.value.trim()) body.launchId = scopeValue.value.trim();
    if (scopeMode.value === "execution" && scopeValue.value.trim()) body.executionId = scopeValue.value.trim();
    const r = await fetch("/api/lead-review/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await r.json()) as {
      items?: LeadItem[];
      counts?: Record<LeadView, number>;
      error?: string;
    };
    if (!r.ok) throw new Error(data.error ?? "Failed to load");
    items.value = data.items ?? [];
    counts.value = data.counts ?? { best_fit: 0, review: 0, disqualified: 0 };
    // Land on the most populated bucket.
    const order: LeadView[] = ["best_fit", "review", "disqualified"];
    activeView.value = order.find((v) => counts.value[v] > 0) ?? "best_fit";
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "Failed to load";
    items.value = [];
    counts.value = { best_fit: 0, review: 0, disqualified: 0 };
  } finally {
    loading.value = false;
  }
}

function toggleSelect(resultId: string, checked: boolean): void {
  const next = new Set(selected.value);
  if (checked) next.add(resultId);
  else next.delete(resultId);
  selected.value = next;
}

function selectAllInView(): void {
  const next = new Set(selected.value);
  for (const i of viewItems.value) next.add(i.result_id);
  selected.value = next;
}
function clearSelection(): void {
  selected.value = new Set();
}

async function decide(resultId: string, status: "approved" | "refused" | "pending"): Promise<void> {
  const lead = items.value.find((i) => i.result_id === resultId);
  try {
    const r = await fetch("/api/lead-review/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultId, decision: status, leadUuid: lead?.lead_uuid ?? null }),
    });
    const data = (await r.json()) as { ok?: boolean; error?: string };
    if (!r.ok || !data.ok) throw new Error(data.error ?? "Failed");
    if (lead) lead.decision_status = status;
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to save decision");
  }
}

async function launchSelected(): Promise<void> {
  if (!projectId.value) {
    message.warning("Select a project first");
    return;
  }
  if (!launchWorkflow.value) {
    message.warning("Choose a workflow to launch");
    return;
  }
  const leadUuids = [...new Set(selectedItems.value.map((i) => i.lead_uuid).filter(Boolean))];
  if (leadUuids.length === 0) {
    message.warning("Select at least one lead");
    return;
  }
  launching.value = true;
  try {
    const r = await fetch("/api/n8n/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: projectId.value,
        workflowKey: launchWorkflow.value,
        leadUuids,
      }),
    });
    const data = (await r.json()) as { launchId?: string; error?: string };
    if (!r.ok || !data.launchId) throw new Error(data.error ?? "Launch failed");
    message.success(`Launched ${leadUuids.length} lead(s)`);
    clearSelection();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Launch failed");
  } finally {
    launching.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadWorkflows(), load()]);
});
</script>

<template>
  <NSpace vertical size="medium" style="width: 100%">
    <NSpace align="center" wrap :size="8">
      <NSelect v-model:value="scopeMode" :options="scopeOptions" style="width: 180px" />
      <NInput
        v-if="scopeMode !== 'recent'"
        v-model:value="scopeValue"
        :placeholder="scopeMode === 'launch' ? 'launch id' : 'execution id'"
        style="width: 320px"
        clearable
      />
      <NButton type="primary" size="small" :loading="loading" @click="load">Load</NButton>
    </NSpace>

    <NAlert v-if="loadError" type="error">{{ loadError }}</NAlert>

    <NSpace align="center" wrap :size="8" class="launch-bar">
      <NText depth="3">{{ selected.size }} selected</NText>
      <NButton size="tiny" @click="selectAllInView">Select all in view</NButton>
      <NButton size="tiny" quaternary @click="clearSelection">Clear</NButton>
      <NSelect
        v-model:value="launchWorkflow"
        :options="workflowOptions"
        placeholder="Workflow"
        size="small"
        style="width: 260px"
      />
      <NButton
        size="small"
        type="primary"
        :disabled="selected.size === 0 || !launchWorkflow"
        :loading="launching"
        @click="launchSelected"
      >
        Launch selected
      </NButton>
    </NSpace>

    <NSpin :show="loading">
      <NTabs v-model:value="activeView" type="line" animated>
        <NTabPane name="best_fit" :tab="`Best Fit (${counts.best_fit})`" />
        <NTabPane name="review" :tab="`Review (${counts.review})`" />
        <NTabPane name="disqualified" :tab="`Disqualified (${counts.disqualified})`" />
      </NTabs>

      <NEmpty v-if="viewItems.length === 0" description="No leads in this view" style="margin-top: 24px" />
      <div v-else class="lead-grid">
        <LeadResultCard
          v-for="lead in viewItems"
          :key="lead.result_id"
          :lead="lead"
          :selected="selected.has(lead.result_id)"
          @toggle-select="toggleSelect"
          @decide="decide"
        />
      </div>
    </NSpin>
  </NSpace>
</template>

<style scoped>
.launch-bar {
  padding: 8px 0;
  border-bottom: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.2));
}
.lead-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
  margin-top: 12px;
}
</style>
