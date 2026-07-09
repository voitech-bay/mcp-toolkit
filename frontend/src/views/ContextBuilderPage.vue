<script setup lang="ts">
import { computed, provide, ref, watch } from "vue";
import { VueFlow } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { NButton, NCard, NDrawer, NDrawerContent, NEmpty, NInput, NModal, NSelect, NSpace, NTag, useMessage } from "naive-ui";
import { useProjectStore } from "../stores/project";
import { useContextBuilder, CONTEXT_BUILDER_KEY } from "../composables/useContextBuilder";
import { mergeConversationsForBuildContext } from "../lib/conversationBuildContext";
import ContextCenterNode from "../components/context-builder/ContextCenterNode.vue";
import HypothesisNode from "../components/context-builder/HypothesisNode.vue";
import CompanyNode from "../components/context-builder/CompanyNode.vue";
import ContactNode from "../components/context-builder/ContactNode.vue";
import ConversationNode from "../components/context-builder/ConversationNode.vue";
import InsightNode from "../components/context-builder/InsightNode.vue";

const projectStore = useProjectStore();
const ctx = useContextBuilder();
const message = useMessage();

const vueFlowRef = ref<InstanceType<typeof VueFlow> | null>(null);
const search = ref("");
const insightLimit = ref(100);
const insightSource = ref<string | null>(null);
const insights = ref<Array<Record<string, any>>>([]);
const insightWarnings = ref<string[]>([]);
const inspectedNode = ref<Record<string, unknown> | null>(null);
const inspectedTitle = computed(() => {
  const d = inspectedNode.value;
  return String(d?.name ?? [d?.firstName, d?.lastName].filter(Boolean).join(" ") ?? d?.nodeType ?? "Map node");
});

function inspectNode(event: { node?: { data?: Record<string, unknown> } }) {
  inspectedNode.value = event.node?.data ?? null;
}

// Destructure computed refs as top-level bindings so Vue's template compiler
// auto-unwraps them — without this, VueFlow receives the ComputedRef wrapper
// object instead of the plain array, causing a spread error on init.
const { flowNodes, flowEdges, selectedNodes } = ctx;
const sourceNodes = computed(() => flowNodes.value);
const insightNodes = computed(() => {
  const sources = sourceNodes.value;
  const filtered = insights.value
    .filter((item) => !insightSource.value || item.source_type === insightSource.value)
    .slice(0, insightLimit.value);
  return filtered.map((item, index) => {
    const parent = item.parent_type === "project"
      ? sources.find((node) => node.id === "center")
      : sources.find((node) => String((node.data as any)?.entityId ?? "") === item.parent_id);
    return {
      id: item.id, type: "insight",
      position: {
        x: (parent?.position.x ?? 0) + 300 + (index % 4) * 215,
        y: (parent?.position.y ?? 0) + Math.floor(index / 4) * 115,
      },
      data: { nodeType: "insight", ...item },
    };
  });
});
const allMapNodes = computed(() => [...sourceNodes.value, ...insightNodes.value] as any[]);
const insightEdges = computed(() => insightNodes.value.map((node) => {
  const item = node.data as Record<string, any>;
  const parent = item.parent_type === "project"
    ? sourceNodes.value.find((source) => source.id === "center")
    : sourceNodes.value.find((source) => String((source.data as any)?.entityId ?? "") === item.parent_id);
  return parent ? { id: `edge-${parent.id}-${node.id}`, source: parent.id, target: node.id, type: "smoothstep" } : null;
}).filter(Boolean) as any[]);
const allMapEdges = computed(() => [...flowEdges.value, ...insightEdges.value]);
const displayedNodes = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle) return allMapNodes.value;
  return allMapNodes.value.filter((node) =>
    node.id === "center" || JSON.stringify(node.data ?? {}).toLowerCase().includes(needle)
  );
});
const displayedNodeIds = computed(() => new Set(displayedNodes.value.map((node) => node.id)));
const displayedEdges = computed(() =>
  allMapEdges.value.filter((edge) => displayedNodeIds.value.has(edge.source) && displayedNodeIds.value.has(edge.target))
);

async function loadInsights(projectId: string | null) {
  insights.value = []; insightWarnings.value = [];
  if (!projectId) return;
  const r = await fetch(`/api/context-map?projectId=${encodeURIComponent(projectId)}`);
  const j = await r.json();
  if (!r.ok) { message.error(j.error ?? "Failed to load insights"); return; }
  insights.value = j.data ?? []; insightWarnings.value = j.warnings ?? [];
}

// Provide context builder to all descendant node components
provide(CONTEXT_BUILDER_KEY, ctx);

// Clear graph when the project changes
watch(
  () => projectStore.selectedProjectId,
  () => {
    ctx.clearGraph();
    void loadInsights(projectStore.selectedProjectId);
    vueFlowRef.value?.fitView();
  },
  { immediate: false }
);
void loadInsights(projectStore.selectedProjectId);

setTimeout(() => {
  vueFlowRef.value?.fitView();
}, 50);

// ── Save map snapshot ─────────────────────────────────────────────────────────

const buildLoading = ref(false);
const showResult = ref(false);
const resultText = ref("");

function copyResult() {
  navigator.clipboard.writeText(resultText.value).then(() => {
    message.success("Copied to clipboard");
  });
}

async function saveMapSnapshot() {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) {
    message.warning("No project selected.");
    return;
  }

  const selectedSet = new Set(ctx.selectedNodeIds.value);

  buildLoading.value = true;
  try {
    const selectedContacts = ctx.contacts.value.filter((ct) => selectedSet.has(ct.nodeId));
    const selectedConversations = ctx.conversations.value.filter((cv) => selectedSet.has(cv.nodeId));
    const conversations = await mergeConversationsForBuildContext(selectedContacts, selectedConversations);

    const selectedNodes_ = {
      hypotheses: ctx.hypotheses.value.filter((h) => selectedSet.has(h.nodeId)),
      companies: ctx.companies.value.filter((c) => selectedSet.has(c.nodeId)),
      contacts: selectedContacts,
      conversations,
    };

    const res = await fetch("/api/build-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, selectedNodes: selectedNodes_ }),
    });
    const json = (await res.json()) as { data?: { context_text: string }; error?: string };
    if (!res.ok || json.error) {
      message.error(json.error ?? "Failed to save map snapshot.");
      return;
    }
    resultText.value = json.data!.context_text;
    showResult.value = true;
    message.success("Map snapshot saved.");
  } catch (e) {
    message.error("Network error while saving map snapshot.");
  } finally {
    buildLoading.value = false;
  }
}
</script>

<template>
  <div class="context-page">
    <div class="overlay">
      <NCard size="small" class="overlay-card" embedded>
        <div class="map-heading">Context Map</div>
        <NInput
          v-model:value="search"
          size="small"
          clearable
          placeholder="Search visible sources…"
          style="margin: 8px 0"
        />
        <NSelect
          v-model:value="insightSource"
          size="small"
          clearable
          placeholder="All insight sources"
          :options="[
            { label: 'Project context', value: 'project_context' },
            { label: 'Company context', value: 'company_context' },
            { label: 'Contact context', value: 'contact_context' },
            { label: 'Enrichment', value: 'enrichment' },
            { label: 'Research', value: 'research' },
            { label: 'Job postings', value: 'job_posting' },
          ]"
        />
        <div v-if="insightWarnings.length" class="map-warning">{{ insightWarnings.length }} source warning(s)</div>
        <div class="overlay-title">
          <span>Selected</span>
          <NTag size="small" :bordered="false" type="info">{{ selectedNodes.length }}</NTag>
        </div>

        <div v-if="selectedNodes.length === 0" style="margin-top: 8px">
          <NEmpty size="small" description="No nodes selected" />
        </div>

        <div v-else class="overlay-list">
          <div v-for="n in selectedNodes" :key="n.id" class="overlay-item">
            <div class="overlay-item__label">
              <span class="overlay-item__type">{{ n.type }}</span>
              <span class="overlay-item__text">{{ n.label }}</span>
            </div>
            <NButton size="tiny" quaternary @click="ctx.setSelected(n.id, false)">Remove</NButton>
          </div>
        </div>

        <template #footer>
          <NSpace justify="end" size="small">
            <NButton
              v-if="selectedNodes.length > 0"
              size="small"
              @click="ctx.clearSelection()"
            >
              Clear
            </NButton>

            <NButton
              v-if="selectedNodes.length > 0"
              size="small"
              type="primary"
              :loading="buildLoading"
              @click="saveMapSnapshot"
            >
              Save map snapshot
            </NButton>

            <NButton
              v-if="selectedNodes.length === 0"
              size="small"
              type="primary"
              @click="ctx.selectAllNodes()"
            >
              Select all
            </NButton>

            <NButton
              v-else
              size="small"
              type="error"
              @click="ctx.clearSelection()"
            >
              Clear selection
            </NButton>
          </NSpace>
        </template>
      </NCard>
    </div>

    <VueFlow
      ref="vueFlowRef"
      :nodes="displayedNodes"
      :edges="displayedEdges"
      :min-zoom="0.15"
      :max-zoom="2"
      :default-edge-options="{ type: 'smoothstep', animated: false }"
      class="context-flow"
      @node-click="inspectNode"
    >
      <!-- Custom node types via slots -->
      <template #node-center="nodeProps">
        <ContextCenterNode v-bind="nodeProps" />
      </template>
      <template #node-hypothesis="nodeProps">
        <HypothesisNode v-bind="nodeProps" />
      </template>
      <template #node-company="nodeProps">
        <CompanyNode v-bind="nodeProps" />
      </template>
      <template #node-contact="nodeProps">
        <ContactNode v-bind="nodeProps" />
      </template>
      <template #node-conversation="nodeProps">
        <ConversationNode v-bind="nodeProps" />
      </template>
      <template #node-insight="nodeProps">
        <InsightNode v-bind="nodeProps" />
      </template>

      <Background pattern-color="rgba(255,255,255,0.06)" :gap="24" />
      <Controls position="bottom-right" />
    </VueFlow>
    <NButton v-if="insights.length > insightLimit" class="show-more" size="small" @click="insightLimit += 100">
      Show 100 more insights
    </NButton>
  </div>

  <NDrawer :show="Boolean(inspectedNode)" :width="440" placement="right" @update:show="(show) => { if (!show) inspectedNode = null; }">
    <NDrawerContent :title="inspectedTitle" closable>
      <NSpace vertical size="large">
        <NTag size="small" type="info" :bordered="false">{{ inspectedNode?.nodeType }}</NTag>
        <div v-for="(value, key) in inspectedNode" :key="key" class="detail-row">
          <div class="detail-label">{{ String(key).replace(/_/g, " ") }}</div>
          <div class="detail-value">{{ value == null || value === "" ? "—" : value }}</div>
        </div>
      </NSpace>
    </NDrawerContent>
  </NDrawer>

  <!-- Context result modal -->
  <NModal
    v-model:show="showResult"
    preset="card"
    title="Saved Map Snapshot"
    style="width: 720px; max-width: 95vw"
  >
    <pre class="context-result">{{ resultText }}</pre>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="showResult = false">Close</NButton>
        <NButton
          type="primary"
          @click="copyResult"
        >
          Copy
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style>
/* Import Vue Flow base styles globally (not scoped so they apply to teleported elements) */
@import "@vue-flow/core/dist/style.css";
@import "@vue-flow/core/dist/theme-default.css";
@import "@vue-flow/controls/dist/style.css";
</style>

<style scoped>
.context-page {
  /* Escape the 2rem padding from .main in App.vue */
  height: calc(100vh - 250px);
  display: flex;
  flex-direction: column;
  position: relative;
}

.context-flow {
  flex: 1;
  background: #0e1017;
}

.map-heading {
  font-weight: 700;
  font-size: 1rem;
}

.detail-row {
  border-bottom: 1px solid rgba(128, 128, 128, 0.18);
  padding-bottom: 0.75rem;
}

.detail-label {
  text-transform: capitalize;
  font-size: 0.72rem;
  opacity: 0.55;
  margin-bottom: 0.25rem;
}

.detail-value {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.map-warning { color: #f2c97d; font-size: .72rem; margin-top: 6px; }
.show-more { position: absolute; right: 58px; bottom: 16px; z-index: 5; }

.context-result {
  font-family: "Consolas", "Fira Mono", "Menlo", monospace;
  font-size: 0.8rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(10, 12, 18, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 16px;
  max-height: 55vh;
  overflow-y: auto;
  margin: 0;
}

.overlay {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  width: 320px;
  pointer-events: none;
}

.overlay-card {
  pointer-events: auto;
  background: rgba(16, 20, 28, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
}

.overlay-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

.overlay-list {
  margin-top: 10px;
  max-height: 220px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.overlay-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.overlay-item__label {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.overlay-item__type {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.55;
  flex-shrink: 0;
}

.overlay-item__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.9;
}

/* Subtle handle dots — don't distract from content */
:deep(.vue-flow__handle) {
  width: 7px;
  height: 7px;
  background: rgba(100, 116, 139, 0.4);
  border: 1.5px solid rgba(100, 116, 139, 0.5);
  border-radius: 50%;
}

:deep(.vue-flow__handle:hover) {
  background: rgba(99, 102, 241, 0.6);
  border-color: rgba(99, 102, 241, 0.8);
}

/* Smooth edge lines */
:deep(.vue-flow__edge-path) {
  stroke: rgba(100, 116, 139, 0.45);
  stroke-width: 1.5;
}

:deep(.vue-flow__edge.selected .vue-flow__edge-path) {
  stroke: rgba(99, 102, 241, 0.7);
}

/* Controls panel */
:deep(.vue-flow__controls) {
  background: rgba(20, 24, 32, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

:deep(.vue-flow__controls-button) {
  background: transparent;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.6);
}

:deep(.vue-flow__controls-button:hover) {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.9);
}

:deep(.vue-flow__controls-button svg) {
  fill: currentColor;
}
</style>
