<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NInput,
  NSpace,
  NSpin,
  NTag,
  NText,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { CheckIcon, RefreshCwIcon, SearchIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";

type Json = Record<string, any>;

type ResearchRow = {
  contact: Json & { uuid: string; display_name: string };
  snapshot: Json | null;
};

const store = useProjectStore();
const route = useRoute();
const toast = useMessage();

const rows = ref<ResearchRow[]>([]);
const loading = ref(false);
const search = ref(String(route.query.search ?? ""));
const selectedIds = ref<string[]>([]);
const actionLoading = ref(false);
const detailOpen = ref(false);
const detailRow = ref<ResearchRow | null>(null);

function researchState(row: ResearchRow): { label: string; type: "default" | "warning" | "success" } {
  if (!row.snapshot) return { label: "No research", type: "default" };
  if (row.snapshot.reviewed_at) return { label: "Approved", type: "success" };
  return { label: "Needs review", type: "warning" };
}

function fmt(iso: unknown): string {
  const d = new Date(String(iso ?? ""));
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

async function load() {
  if (!store.selectedProjectId) return;
  loading.value = true;
  try {
    const params = new URLSearchParams({ projectId: store.selectedProjectId });
    if (search.value.trim()) params.set("search", search.value.trim());
    const r = await fetch(`/api/sequence-studio/research-snapshots?${params}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Could not load research");
    rows.value = j.data ?? [];
    const visible = new Set(rows.value.map((row) => row.contact.uuid));
    selectedIds.value = selectedIds.value.filter((id) => visible.has(id));
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not load research");
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => store.selectedProjectId, load);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 350);
});

async function assembleResearch(contactIds: string[]) {
  if (!store.selectedProjectId || !contactIds.length) return;
  actionLoading.value = true;
  try {
    const r = await fetch("/api/sequence-studio/assemble-research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: store.selectedProjectId, contactIds }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Assemble failed");
    const failed = (j.failed ?? []) as Array<{ reason: string }>;
    if (failed.length) toast.warning(`${failed.length} contact(s) had no usable POV: ${failed.map((f) => f.reason).join("; ")}`, { duration: 12000 });
    toast.success(`Assembled research for ${(j.assembled ?? []).length} contact(s)`);
    await load();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Assemble failed");
  } finally {
    actionLoading.value = false;
  }
}

async function approveResearch(contactIds: string[]) {
  if (!store.selectedProjectId || !contactIds.length) return;
  actionLoading.value = true;
  try {
    const r = await fetch("/api/sequence-studio/approve-research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: store.selectedProjectId, contactIds }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Approve failed");
    const skipped = (j.skipped ?? []) as string[];
    if (skipped.length) toast.warning(`${skipped.length} contact(s) have no assembled research to approve yet`);
    toast.success(`Approved ${(j.approved ?? []).length} contact(s)`);
    await load();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Approve failed");
  } finally {
    actionLoading.value = false;
  }
}

function openDetail(row: ResearchRow) {
  detailRow.value = row;
  detailOpen.value = true;
}

const assembleDisabled = computed(() => !selectedIds.value.length || actionLoading.value);
const approveDisabled = computed(() => {
  if (!selectedIds.value.length || actionLoading.value) return true;
  const selected = rows.value.filter((r) => selectedIds.value.includes(r.contact.uuid));
  return !selected.some((r) => r.snapshot && !r.snapshot.reviewed_at);
});

const columns = computed<DataTableColumns<ResearchRow>>(() => [
  {
    type: "selection",
  },
  {
    title: "Company",
    key: "company",
    render: (row) => row.contact.company_name || "-",
  },
  {
    title: "Contact",
    key: "contact",
    render: (row) => h("div", {}, [
      h("div", {}, row.contact.display_name),
      h(NText, { depth: 3, style: "font-size:12px" }, { default: () => row.contact.title || "" }),
    ]),
  },
  {
    title: "Research state",
    key: "state",
    render: (row) => {
      const s = researchState(row);
      return h(NTag, { size: "small", type: s.type }, { default: () => s.label });
    },
  },
  {
    title: "Assembled",
    key: "assembled_at",
    render: (row) => fmt(row.snapshot?.assembled_at),
  },
  {
    title: "Approved",
    key: "reviewed_at",
    render: (row) => fmt(row.snapshot?.reviewed_at),
  },
  {
    title: "",
    key: "actions",
    render: (row) => h(NButton, { size: "tiny", secondary: true, onClick: () => openDetail(row) }, { default: () => "Review" }),
  },
]);
</script>

<template>
  <NSpace vertical size="large" class="page">
    <NCard>
      <NSpace vertical size="medium">
        <div class="top-row">
          <div>
            <h1>Wellore research</h1>
            <NText depth="3">Review and approve each contact's research before it can be drafted into a sequence.</NText>
          </div>
        </div>
        <NSpace justify="space-between" align="center">
          <NInput v-model:value="search" placeholder="Search company, contact, email" clearable style="max-width: 320px">
            <template #prefix><SearchIcon :size="14" /></template>
          </NInput>
          <NSpace>
            <NButton :disabled="assembleDisabled" :loading="actionLoading" @click="assembleResearch(selectedIds)">
              <template #icon><RefreshCwIcon :size="14" /></template>
              Assemble research ({{ selectedIds.length }})
            </NButton>
            <NButton type="primary" :disabled="approveDisabled" :loading="actionLoading" @click="approveResearch(selectedIds)">
              <template #icon><CheckIcon :size="14" /></template>
              Approve research
            </NButton>
          </NSpace>
        </NSpace>
      </NSpace>
    </NCard>

    <NSpin :show="loading">
      <NDataTable
        v-if="rows.length"
        :columns="columns"
        :data="rows"
        :row-key="(row: ResearchRow) => row.contact.uuid"
        v-model:checked-row-keys="selectedIds"
        :pagination="{ pageSize: 25 }"
        size="small"
      />
      <NEmpty v-else description="No Wellore contacts found" style="margin-top: 28px" />
    </NSpin>

    <NDrawer v-model:show="detailOpen" width="min(720px, 96vw)">
      <NDrawerContent :title="detailRow?.contact?.display_name || 'Research'" closable>
        <NSpace vertical size="medium" v-if="detailRow">
          <NSpace align="center">
            <NTag size="small">{{ detailRow.contact.company_name || "-" }}</NTag>
            <NTag size="small" :type="researchState(detailRow).type">{{ researchState(detailRow).label }}</NTag>
          </NSpace>
          <NText depth="3">{{ detailRow.contact.title }} &middot; {{ detailRow.contact.work_email || "no email" }}</NText>

          <NAlert v-if="!detailRow.snapshot" type="info" :show-icon="false">
            No research assembled yet for this contact.
          </NAlert>
          <template v-else>
            <NCard title="POV summary" size="small">
              <NText>{{ detailRow.snapshot.research?.pov_summary || "-" }}</NText>
            </NCard>
            <NCard v-if="detailRow.snapshot.research?.pov_hook" title="Hook" size="small">
              <NText>{{ detailRow.snapshot.research.pov_hook }}</NText>
            </NCard>
            <NCard v-if="detailRow.snapshot.research?.pov_wellore_angle" title="Wellore angle" size="small">
              <NText>{{ detailRow.snapshot.research.pov_wellore_angle }}</NText>
            </NCard>
            <NCard v-if="detailRow.snapshot.research?.verified_signals?.length" title="Verified signals" size="small">
              <NSpace vertical size="small">
                <div v-for="(s, i) in detailRow.snapshot.research.verified_signals" :key="i">
                  <NText strong>{{ s.type }}</NText>
                  <NText depth="3"> &middot; {{ s.date }}</NText>
                  <div>{{ s.summary }}</div>
                </div>
              </NSpace>
            </NCard>
            <NText depth="3" style="font-size: 12px">
              Assembled {{ fmt(detailRow.snapshot.assembled_at) }}
              <template v-if="detailRow.snapshot.reviewed_at"> &middot; approved {{ fmt(detailRow.snapshot.reviewed_at) }} by {{ detailRow.snapshot.reviewed_by }}</template>
            </NText>
          </template>

          <NSpace>
            <NButton :loading="actionLoading" @click="assembleResearch([detailRow.contact.uuid])">
              {{ detailRow.snapshot ? "Re-assemble" : "Assemble research" }}
            </NButton>
            <NButton
              type="primary"
              :disabled="!detailRow.snapshot || !!detailRow.snapshot.reviewed_at"
              :loading="actionLoading"
              @click="approveResearch([detailRow.contact.uuid])"
            >
              Approve
            </NButton>
          </NSpace>
        </NSpace>
      </NDrawerContent>
    </NDrawer>
  </NSpace>
</template>

<style scoped lang="less">
.page {
  padding: 1rem 0 2rem;
}

.top-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

h1 {
  margin: 0 0 0.25rem;
  font-size: 22px;
  line-height: 1.2;
}
</style>
