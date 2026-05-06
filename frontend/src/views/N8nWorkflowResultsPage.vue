<script setup lang="ts">
import { ref, computed, watch, h } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  NCard,
  NDataTable,
  NButton,
  NInput,
  NPagination,
  NSpace,
  NTag,
  NAlert,
  NDrawer,
  NDrawerContent,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";

export type N8nWorkflowResultRow = {
  id: string;
  contact_id: string | null;
  contact_label: string | null;
  company_id: string | null;
  company_label: string | null;
  workflow: string;
  execution_id: string | null;
  created_at: string;
  agent_previews: Record<string, string>;
  result: Record<string, unknown>;
};

const route = useRoute();
const router = useRouter();

function queryToRecord(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(route.query)) {
    if (typeof v === "string" && v) out[k] = v;
    else if (Array.isArray(v) && typeof v[0] === "string") out[k] = v[0];
  }
  return out;
}

const PAGE_SIZE = 25;

const loading = ref(false);
const loadError = ref("");
const rows = ref<N8nWorkflowResultRow[]>([]);
const total = ref(0);
const agentKeyUnion = ref<string[]>([]);

const executionInput = ref("");

const page = computed({
  get: () => Math.max(1, parseInt(String(route.query.page ?? "1"), 10) || 1),
  set: (p: number) => {
    const q = queryToRecord();
    if (p <= 1) delete q.page;
    else q.page = String(p);
    router.replace({ path: "/n8n/workflow-results", query: q });
  },
});

const contactIdFilter = computed(() => String(route.query.contactId ?? "").trim());
const companyIdFilter = computed(() => String(route.query.companyId ?? "").trim());
const executionIdFilter = computed(() => String(route.query.executionId ?? "").trim());

function navQuery(partial: Record<string, string | undefined>) {
  const q = queryToRecord();
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined || v === "") delete q[k];
    else q[k] = v;
  }
  delete q.page;
  router.push({ path: "/n8n/workflow-results", query: q });
}

function filterByContact(id: string | null) {
  navQuery({
    contactId: id ?? undefined,
    companyId: companyIdFilter.value || undefined,
    executionId: executionIdFilter.value || undefined,
    page: undefined,
  });
}

function filterByCompany(id: string | null) {
  navQuery({
    contactId: contactIdFilter.value || undefined,
    companyId: id ?? undefined,
    executionId: executionIdFilter.value || undefined,
    page: undefined,
  });
}

function applyExecutionFilter() {
  const v = executionInput.value.trim();
  navQuery({
    contactId: contactIdFilter.value || undefined,
    companyId: companyIdFilter.value || undefined,
    executionId: v || undefined,
    page: undefined,
  });
}

function clearFilters() {
  router.push({ path: "/n8n/workflow-results" });
  executionInput.value = "";
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const offset = (page.value - 1) * PAGE_SIZE;
    const q = new URLSearchParams();
    q.set("limit", String(PAGE_SIZE));
    q.set("offset", String(offset));
    if (contactIdFilter.value) q.set("contactId", contactIdFilter.value);
    if (companyIdFilter.value) q.set("companyId", companyIdFilter.value);
    if (executionIdFilter.value) q.set("executionId", executionIdFilter.value);
    const r = await fetch(`/api/n8n/workflow-results?${q.toString()}`);
    const data = (await r.json()) as {
      rows?: N8nWorkflowResultRow[];
      total?: number;
      agent_key_union?: string[];
      error?: string;
    };
    if (!r.ok) throw new Error(data.error ?? "Failed to load");
    rows.value = data.rows ?? [];
    total.value = data.total ?? 0;
    agentKeyUnion.value = data.agent_key_union ?? [];
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "Failed to load";
    rows.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

watch(
  () => ({ ...route.query }),
  () => {
    executionInput.value = executionIdFilter.value;
    void load();
  },
  { deep: true, immediate: true }
);

const drawerOpen = ref(false);
const drawerTitle = ref("");
const drawerJson = ref("");

function openRowDetail(row: N8nWorkflowResultRow) {
  drawerTitle.value = row.id.slice(0, 8) + "…";
  drawerJson.value = JSON.stringify(row.result, null, 2);
  drawerOpen.value = true;
}

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

const columns = computed<DataTableColumns<N8nWorkflowResultRow>>(() => {
  const agentCols: DataTableColumns<N8nWorkflowResultRow> = agentKeyUnion.value.map((key) => ({
    title: key,
    key: `agent:${key}`,
    minWidth: 168,
    ellipsis: { tooltip: true },
    render(row) {
      return row.agent_previews[key] ?? "—";
    },
  }));

  const tail: DataTableColumns<N8nWorkflowResultRow> = [
    {
      title: "Workflow",
      key: "workflow",
      minWidth: 120,
      ellipsis: { tooltip: true },
    },
    {
      title: "Execution",
      key: "execution_id",
      width: 120,
      ellipsis: { tooltip: true },
    },
    {
      title: "Created",
      key: "created_at",
      width: 168,
      render(row) {
        try {
          return new Date(row.created_at).toLocaleString();
        } catch {
          return row.created_at;
        }
      },
    },
    {
      title: "Detail",
      key: "detail",
      width: 72,
      fixed: "right",
      render(row) {
        return h(
          NButton,
          { size: "tiny", quaternary: true, onClick: () => openRowDetail(row) },
          { default: () => "JSON" }
        );
      },
    },
  ];

  const head: DataTableColumns<N8nWorkflowResultRow> = [
    {
      title: "Contact",
      key: "contact",
      fixed: "left",
      minWidth: 140,
      render(row) {
        if (!row.contact_id) return "—";
        return h(
          NButton,
          {
            text: true,
            type: "primary",
            size: "small",
            onClick: () => filterByContact(row.contact_id),
          },
          {
            default: () =>
              row.contact_label ?? `${row.contact_id!.slice(0, 8)}…`,
          }
        );
      },
    },
    {
      title: "Company",
      key: "company",
      minWidth: 140,
      render(row) {
        if (!row.company_id) return "—";
        return h(
          NButton,
          {
            text: true,
            type: "primary",
            size: "small",
            onClick: () => filterByCompany(row.company_id),
          },
          {
            default: () =>
              row.company_label ?? `${row.company_id!.slice(0, 8)}…`,
          }
        );
      },
    },
  ];

  return [...head, ...agentCols, ...tail];
});
</script>

<template>
  <NCard>
    <template #header>
      <span>n8n workflow results</span>
    </template>

    <NSpace vertical size="medium" style="width: 100%">
      <NSpace align="center" wrap>
        <span class="muted">Execution id</span>
        <NInput
          v-model:value="executionInput"
          placeholder="Filter by execution id"
          clearable
          style="width: 260px"
          :disabled="loading"
          @keyup.enter="applyExecutionFilter"
        />
        <NButton type="primary" size="small" :disabled="loading" @click="applyExecutionFilter">
          Apply
        </NButton>
        <NButton quaternary size="small" :disabled="loading" @click="clearFilters">Clear filters</NButton>
        <NTag v-if="contactIdFilter" size="small" closable @close="filterByContact(null)">
          contact: {{ contactIdFilter.slice(0, 8) }}…
        </NTag>
        <NTag v-if="companyIdFilter" size="small" closable @close="filterByCompany(null)">
          company: {{ companyIdFilter.slice(0, 8) }}…
        </NTag>
      </NSpace>

      <NAlert v-if="loadError" type="error">{{ loadError }}</NAlert>

      <NDataTable
        :columns="columns"
        :data="rows"
        :loading="loading"
        :scroll-x="Math.min(3200, 900 + agentKeyUnion.length * 170)"
        :max-height="640"
        size="small"
        striped
      />

      <div class="pager">
        <NPagination
          :page="page"
          :page-count="pageCount"
          :disabled="loading"
          @update:page="(p: number) => (page = p)"
        />
        <span class="muted total-line">Total rows: {{ total }}</span>
      </div>
    </NSpace>

    <NDrawer v-model:show="drawerOpen" :width="520" placement="right">
      <NDrawerContent :title="`Result JSON (${drawerTitle})`" closable>
        <pre class="json-pre">{{ drawerJson }}</pre>
      </NDrawerContent>
    </NDrawer>
  </NCard>
</template>

<style scoped>
.muted {
  font-size: 0.875rem;
  opacity: 0.75;
}
.pager {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.total-line {
  margin-left: auto;
}
.json-pre {
  margin: 0;
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 70vh;
  overflow: auto;
}
</style>
