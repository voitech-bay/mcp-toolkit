<script setup lang="ts">
import { ref, watch, computed, h } from "vue";
import {
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NModal,
  NSpin,
  NTag,
  NSpace,
  useMessage,
} from "naive-ui";
import type { DataTableColumns, DataTableExpandColumn } from "naive-ui";
import { useProjectStore } from "../stores/project";

const projectStore = useProjectStore();
const message = useMessage();

// ── Types ─────────────────────────────────────────────────────────────────────

interface SnapshotHypothesis { name: string; description: string | null }
interface SnapshotCompany    { name: string | null; domain: string | null }
interface SnapshotContact    { firstName: string | null; lastName: string | null; position: string | null }
interface SnapshotConversation { messageCount: number; latestMessageText: string | null; latestMessageDate: string | null }

interface SnapshotNodes {
  hypotheses:    SnapshotHypothesis[];
  companies:     SnapshotCompany[];
  contacts:      SnapshotContact[];
  conversations: SnapshotConversation[];
}

interface ContextSnapshot {
  id: string;
  project_id: string;
  name: string | null;
  nodes: SnapshotNodes;
  context_text: string;
  created_at: string;
}

// ── Data loading ──────────────────────────────────────────────────────────────

const snapshots = ref<ContextSnapshot[]>([]);
const total     = ref(0);
const loading   = ref(false);
const page      = ref(1);
const pageSize  = 20;

async function load() {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) { snapshots.value = []; total.value = 0; return; }
  loading.value = true;
  try {
    const offset = (page.value - 1) * pageSize;
    const r = await fetch(
      `/api/context-snapshots?projectId=${encodeURIComponent(projectId)}&limit=${pageSize}&offset=${offset}`
    );
    const j = (await r.json()) as { data?: ContextSnapshot[]; total?: number; error?: string };
    if (!r.ok || j.error) { message.error(j.error ?? "Failed to load"); return; }
    snapshots.value = j.data ?? [];
    total.value     = j.total ?? 0;
  } finally {
    loading.value = false;
  }
}

watch(() => projectStore.selectedProjectId, () => { page.value = 1; load(); }, { immediate: true });
watch(page, load);

// ── Context text modal ────────────────────────────────────────────────────────

const viewText   = ref("");
const showModal  = ref(false);

function openText(snap: ContextSnapshot) {
  viewText.value  = snap.context_text;
  showModal.value = true;
}

function copyText() {
  navigator.clipboard.writeText(viewText.value).then(() => message.success("Copied"));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function contactName(c: SnapshotContact) {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown";
}

// ── Table ─────────────────────────────────────────────────────────────────────

type Row = ContextSnapshot;

const columns: (DataTableColumns<Row>[number] | DataTableExpandColumn<Row>)[] = [
  {
    type: "expand",
    expandable: () => true,
    renderExpand: (row) => {
      const nodes = row.nodes ?? {};
      const hyps  = (nodes.hypotheses    ?? []) as SnapshotHypothesis[];
      const cos   = (nodes.companies     ?? []) as SnapshotCompany[];
      const cts   = (nodes.contacts      ?? []) as SnapshotContact[];
      const convs = (nodes.conversations ?? []) as SnapshotConversation[];

      return h("div", { class: "expand-grid" }, [
        // Hypotheses
        h("div", { class: "expand-section" }, [
          h("div", { class: "expand-label" }, "Hypotheses"),
          hyps.length === 0
            ? h("span", { class: "expand-empty" }, "—")
            : h("div", { class: "expand-list" },
                hyps.map((hh) =>
                  h("div", { class: "expand-item" }, [
                    h("span", { class: "item-name" }, hh.name),
                    hh.description
                      ? h("span", { class: "item-sub" }, hh.description)
                      : null,
                  ].filter(Boolean) as ReturnType<typeof h>[])
                )
              ),
        ]),
        // Companies
        h("div", { class: "expand-section" }, [
          h("div", { class: "expand-label" }, "Companies"),
          cos.length === 0
            ? h("span", { class: "expand-empty" }, "—")
            : h("div", { class: "expand-list" },
                cos.map((co) =>
                  h("div", { class: "expand-item" }, [
                    h("span", { class: "item-name" }, co.name ?? co.domain ?? "Unknown"),
                    co.domain && co.domain !== co.name
                      ? h("span", { class: "item-sub" }, co.domain)
                      : null,
                  ].filter(Boolean) as ReturnType<typeof h>[])
                )
              ),
        ]),
        // Contacts
        h("div", { class: "expand-section" }, [
          h("div", { class: "expand-label" }, "Contacts"),
          cts.length === 0
            ? h("span", { class: "expand-empty" }, "—")
            : h("div", { class: "expand-list" },
                cts.map((ct) =>
                  h("div", { class: "expand-item" }, [
                    h("span", { class: "item-name" }, contactName(ct)),
                    ct.position
                      ? h("span", { class: "item-sub" }, ct.position)
                      : null,
                  ].filter(Boolean) as ReturnType<typeof h>[])
                )
              ),
        ]),
        // Conversations
        h("div", { class: "expand-section" }, [
          h("div", { class: "expand-label" }, "Conversations"),
          convs.length === 0
            ? h("span", { class: "expand-empty" }, "—")
            : h("div", { class: "expand-list" },
                convs.map((cv, i) => {
                  const date = cv.latestMessageDate
                    ? new Date(cv.latestMessageDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                    : null;
                  return h("div", { class: "expand-item" }, [
                    h("span", { class: "item-name" }, `Conversation ${i + 1} — ${cv.messageCount} msg${cv.messageCount !== 1 ? "s" : ""}${date ? ` · ${date}` : ""}`),
                    cv.latestMessageText
                      ? h("span", { class: "item-sub item-snippet" }, cv.latestMessageText.slice(0, 100) + (cv.latestMessageText.length > 100 ? "…" : ""))
                      : null,
                  ].filter(Boolean) as ReturnType<typeof h>[]);
                })
              ),
        ]),
      ]);
    },
  } as DataTableExpandColumn<Row>,
  {
    key: "created_at",
    title: "Date",
    width: 170,
    render: (r) => fmt(r.created_at),
  },
  {
    key: "name",
    title: "Name",
    width: 160,
    render: (r) => r.name ?? h("span", { style: "opacity:.4" }, "—"),
  },
  {
    key: "hypotheses",
    title: "Hypotheses",
    render: (r) => {
      const list = (r.nodes?.hypotheses ?? []) as SnapshotHypothesis[];
      if (list.length === 0) return h("span", { style: "opacity:.35" }, "—");
      return h(NSpace, { size: 4, wrap: true },
        () => list.slice(0, 3).map((hh) =>
          h(NTag, { size: "small", type: "warning", bordered: false }, () => hh.name)
        ).concat(
          list.length > 3
            ? [h(NTag, { size: "small", bordered: false }, () => `+${list.length - 3}`)]
            : []
        )
      );
    },
  },
  {
    key: "companies",
    title: "Companies",
    render: (r) => {
      const list = (r.nodes?.companies ?? []) as SnapshotCompany[];
      if (list.length === 0) return h("span", { style: "opacity:.35" }, "—");
      return h(NSpace, { size: 4, wrap: true },
        () => list.slice(0, 3).map((co) =>
          h(NTag, { size: "small", type: "success", bordered: false }, () => co.name ?? co.domain ?? "?")
        ).concat(
          list.length > 3
            ? [h(NTag, { size: "small", bordered: false }, () => `+${list.length - 3}`)]
            : []
        )
      );
    },
  },
  {
    key: "contacts",
    title: "Contacts",
    render: (r) => {
      const list = (r.nodes?.contacts ?? []) as SnapshotContact[];
      if (list.length === 0) return h("span", { style: "opacity:.35" }, "—");
      return h(NSpace, { size: 4, wrap: true },
        () => list.slice(0, 3).map((ct) =>
          h(NTag, { size: "small", type: "info", bordered: false }, () => contactName(ct))
        ).concat(
          list.length > 3
            ? [h(NTag, { size: "small", bordered: false }, () => `+${list.length - 3}`)]
            : []
        )
      );
    },
  },
  {
    key: "conversations",
    title: "Conv.",
    width: 70,
    render: (r) => {
      const n = (r.nodes?.conversations ?? []).length;
      return n === 0
        ? h("span", { style: "opacity:.35" }, "—")
        : h(NTag, { size: "small", bordered: false }, () => String(n));
    },
  },
  {
    key: "actions",
    title: "",
    width: 90,
    render: (r) =>
      h(NButton, { size: "tiny", onClick: () => openText(r) }, () => "View text"),
  },
];

const pagination = computed(() => ({
  page: page.value,
  pageSize,
  itemCount: total.value,
  showSizePicker: false,
  onChange: (p: number) => { page.value = p; },
}));
</script>

<template>
  <div>
    <div class="page-header">
      <h2 class="page-title">Saved Contexts</h2>
      <NButton size="small" :loading="loading" @click="load">Refresh</NButton>
    </div>

    <div v-if="loading && snapshots.length === 0" class="loading-center">
      <NSpin />
    </div>

    <NEmpty
      v-else-if="!loading && snapshots.length === 0"
      description="No saved contexts yet. Build one from the Context Builder."
      style="margin-top: 60px"
    />

    <NCard v-else size="small">
      <NDataTable
        :columns="(columns as any)"
        :data="snapshots"
        :pagination="pagination"
        :loading="loading"
        :row-key="(r: ContextSnapshot) => r.id"
        size="small"
        :bordered="false"
      />
    </NCard>
  </div>

  <!-- Context text modal -->
  <NModal
    v-model:show="showModal"
    preset="card"
    title="Context Text"
    style="width: 720px; max-width: 95vw"
  >
    <pre class="context-text">{{ viewText }}</pre>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="showModal = false">Close</NButton>
        <NButton type="primary" @click="copyText">Copy</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.page-title {
  font-size: 1.1rem;
  font-weight: 700;
  margin: 0;
  opacity: 0.9;
}

.loading-center {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

/* ── Expanded row ────────────────────────────────────────────────────────── */

:deep(.expand-grid) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px 24px;
  padding: 12px 16px 16px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 6px;
}

:deep(.expand-section) {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

:deep(.expand-label) {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: 0.4;
}

:deep(.expand-empty) {
  font-size: 0.82rem;
  opacity: 0.3;
}

:deep(.expand-list) {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

:deep(.expand-item) {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

:deep(.item-name) {
  font-size: 0.82rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.88);
}

:deep(.item-sub) {
  font-size: 0.74rem;
  color: rgba(255, 255, 255, 0.38);
  line-height: 1.3;
}

:deep(.item-snippet) {
  font-style: italic;
}

/* ── Context text ────────────────────────────────────────────────────────── */

.context-text {
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
</style>
