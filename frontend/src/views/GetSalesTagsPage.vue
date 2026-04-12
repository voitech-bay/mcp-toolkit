<script setup lang="ts">
import { ref, watch, computed, h } from "vue";
import {
  NCard,
  NDataTable,
  NEmpty,
  NSpin,
  NAlert,
  NButton,
  NSpace,
  NTag,
  useMessage,
} from "naive-ui";
import type { DataTableColumns, DataTableRowKey } from "naive-ui";
import { TagsIcon, LightbulbIcon, LightbulbOffIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";

interface TagRow {
  uuid: string;
  name: string | null;
  team_id: number | null;
  user_id: number | null;
  created_at: string | null;
  updated_at: string | null;
  hypothesis_id: string | null;
}

const projectStore = useProjectStore();
const message = useMessage();

const loading = ref(false);
const error = ref("");
const data = ref<TagRow[]>([]);
const checkedRowKeys = ref<DataTableRowKey[]>([]);
const marking = ref(false);

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function load() {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) {
    data.value = [];
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const r = await fetch(`/api/getsales-tags?projectId=${encodeURIComponent(projectId)}`);
    const j = (await r.json()) as { data?: TagRow[]; error?: string };
    if (!r.ok) throw new Error(j.error ?? "Failed to load tags");
    data.value = j.data ?? [];
    checkedRowKeys.value = checkedRowKeys.value.filter((k) =>
      data.value.some((row) => row.uuid === k)
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    data.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => projectStore.selectedProjectId,
  () => {
    checkedRowKeys.value = [];
    void load();
  },
  { immediate: true }
);

const selectedRows = computed(() =>
  data.value.filter((row) => checkedRowKeys.value.includes(row.uuid))
);

const selectedUnmarked = computed(() => selectedRows.value.filter((r) => !r.hypothesis_id));
const selectedMarked = computed(() => selectedRows.value.filter((r) => r.hypothesis_id));

async function markAsHypothesis() {
  const projectId = projectStore.selectedProjectId;
  if (!projectId || selectedUnmarked.value.length === 0) return;
  marking.value = true;
  try {
    const r = await fetch("/api/getsales-tags/mark-hypothesis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        tagUuids: selectedUnmarked.value.map((x) => x.uuid),
      }),
    });
    const j = (await r.json()) as { created?: number; skipped?: number; error?: string };
    if (!r.ok) throw new Error(j.error ?? "Failed");
    message.success(
      `Created ${j.created ?? 0} hypothesis(es); skipped ${j.skipped ?? 0} (already linked or missing).`
    );
    checkedRowKeys.value = [];
    await load();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed");
  } finally {
    marking.value = false;
  }
}

async function unmarkHypothesis() {
  const projectId = projectStore.selectedProjectId;
  if (!projectId || selectedMarked.value.length === 0) return;
  marking.value = true;
  try {
    const r = await fetch("/api/getsales-tags/unmark-hypothesis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        tagUuids: selectedMarked.value.map((x) => x.uuid),
      }),
    });
    const j = (await r.json()) as { error?: string };
    if (!r.ok) throw new Error(j.error ?? "Failed");
    message.success("Removed tag link from hypothesis(es). Hypotheses are kept.");
    checkedRowKeys.value = [];
    await load();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed");
  } finally {
    marking.value = false;
  }
}

const columns: DataTableColumns<TagRow> = [
  { type: "selection" },
  {
    title: "Hypothesis",
    key: "hypothesis_id",
    width: 120,
    render: (row) =>
      row.hypothesis_id
        ? h(NTag, { size: "small", type: "success", bordered: false }, { default: () => "Linked" })
        : h(NTag, { size: "small", type: "default", bordered: false }, { default: () => "—" }),
  },
  {
    title: "Name",
    key: "name",
    ellipsis: { tooltip: true },
    render: (row) => row.name ?? "—",
  },
  { title: "UUID", key: "uuid", ellipsis: { tooltip: true }, width: 320 },
  {
    title: "Team",
    key: "team_id",
    width: 90,
    render: (row) => (row.team_id != null ? String(row.team_id) : "—"),
  },
  {
    title: "User",
    key: "user_id",
    width: 90,
    render: (row) => (row.user_id != null ? String(row.user_id) : "—"),
  },
  {
    title: "Updated",
    key: "updated_at",
    width: 180,
    render: (row) => formatTs(row.updated_at),
  },
  {
    title: "Created",
    key: "created_at",
    width: 180,
    render: (row) => formatTs(row.created_at),
  },
];
</script>

<template>
  <div class="getsales-tags-page">
    <NCard>
      <template #header>
        <div class="page-header">
          <TagsIcon :size="18" class="page-header__icon" />
          <span>GetSales tags</span>
        </div>
      </template>
      <p class="page-lead">
        Tag definitions synced from GetSales (<code>GET /leads/api/tags</code>). Run <strong>Pipeline → Sync</strong>
        with “GetSales tags” enabled to refresh. Select rows to create a hypothesis linked by
        <code>getsales_tag_uuid</code>, or clear that link without deleting the hypothesis.
      </p>

      <NSpace v-if="data.length > 0" style="margin-bottom: 12px" align="center">
        <NButton
          type="primary"
          size="small"
          :disabled="selectedUnmarked.length === 0 || marking"
          :loading="marking"
          @click="markAsHypothesis"
        >
          <template #icon><LightbulbIcon :size="14" /></template>
          Mark as hypothesis ({{ selectedUnmarked.length }})
        </NButton>
        <NButton
          size="small"
          :disabled="selectedMarked.length === 0 || marking"
          :loading="marking"
          @click="unmarkHypothesis"
        >
          <template #icon><LightbulbOffIcon :size="14" /></template>
          Unmark hypothesis link ({{ selectedMarked.length }})
        </NButton>
      </NSpace>

      <NSpin :show="loading">
        <NAlert v-if="error" type="error" style="margin-bottom: 12px" :title="error" />
        <NEmpty v-else-if="!loading && data.length === 0" description="No tags for this project yet." />
        <NDataTable
          v-else
          v-model:checked-row-keys="checkedRowKeys"
          :columns="columns"
          :data="data"
          :bordered="true"
          :single-line="false"
          :row-key="(row: TagRow) => row.uuid"
          size="small"
          :scroll-x="1100"
        />
      </NSpin>
    </NCard>
  </div>
</template>

<style scoped lang="less">
.getsales-tags-page {
  padding: 1rem 1.25rem 2rem;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.page-header__icon {
  opacity: 0.85;
  flex-shrink: 0;
}

.page-lead {
  margin: 0 0 1rem;
  font-size: 13px;
  line-height: 1.5;
  color: var(--n-text-color-3);
  max-width: 52rem;
}

.page-lead code {
  font-size: 12px;
}
</style>
