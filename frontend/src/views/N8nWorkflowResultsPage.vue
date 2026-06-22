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
  NSelect,
  NDatePicker,
  NAvatar,
  NRadioGroup,
  NRadioButton,
} from "naive-ui";
import type { DataTableColumns, SelectOption } from "naive-ui";
import LeadViewsPanel from "../components/LeadViewsPanel.vue";

export type N8nWorkflowResultRow = {
  id: string;
  contact_id: string | null;
  contact_label: string | null;
  contact_avatar_url: string | null;
  company_id: string | null;
  company_label: string | null;
  company_logo_url: string | null;
  workflow: string;
  execution_id: string | null;
  created_at: string;
  agent_previews: Record<string, string>;
  result: Record<string, unknown>;
};

type FilterField =
  | "execution_id"
  | "workflow"
  | "created_at"
  | "contact_id"
  | "company_id"
  | "contact_name"
  | "company_name"
  | "result_text";

type FilterOp = "eq" | "neq" | "like" | "not_like" | "gte" | "lte";

type FilterRow = {
  field: FilterField | "";
  op: FilterOp | "";
  value: string;
  /** Naive datetime picker (ms) when field is created_at */
  _ts?: number | null;
};

const FIELD_OPTIONS: SelectOption[] = [
  { label: "Execution id", value: "execution_id" },
  { label: "Workflow", value: "workflow" },
  { label: "Created at", value: "created_at" },
  { label: "Contact id (UUID)", value: "contact_id" },
  { label: "Company id (UUID)", value: "company_id" },
  { label: "Contact name (contains)", value: "contact_name" },
  { label: "Company name / domain (contains)", value: "company_name" },
  { label: "Result JSON (contains)", value: "result_text" },
];

function opsForField(field: string): SelectOption[] {
  switch (field) {
    case "execution_id":
    case "workflow":
      return [
        { label: "equals", value: "eq" },
        { label: "not equals", value: "neq" },
        { label: "contains", value: "like" },
        { label: "does not contain", value: "not_like" },
      ];
    case "created_at":
      return [
        { label: "on or after", value: "gte" },
        { label: "on or before", value: "lte" },
      ];
    case "contact_id":
    case "company_id":
      return [
        { label: "equals", value: "eq" },
        { label: "not equals", value: "neq" },
      ];
    case "contact_name":
    case "company_name":
    case "result_text":
      return [
        { label: "contains", value: "like" },
        { label: "does not contain", value: "not_like" },
      ];
    default:
      return [];
  }
}

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

// View mode: classic filterable table vs. bucketed lead-views (Best Fit / Review / Disqualified).
const mode = ref<"table" | "leadviews">(route.query.mode === "leadviews" ? "leadviews" : "table");
const leadViewsLaunchId = computed(() => String(route.query.launchId ?? "").trim() || undefined);
const leadViewsExecutionId = computed(() => String(route.query.executionId ?? "").trim() || undefined);
function setMode(m: "table" | "leadviews"): void {
  mode.value = m;
  const q = queryToRecord();
  if (m === "leadviews") q.mode = "leadviews";
  else delete q.mode;
  router.replace({ path: "/n8n/workflow-results", query: q });
}

const PAGE_SIZE = 25;

const loading = ref(false);
const loadError = ref("");
const rows = ref<N8nWorkflowResultRow[]>([]);
const total = ref(0);
const agentKeyUnion = ref<string[]>([]);

const filterRows = ref<FilterRow[]>([]);

const page = computed({
  get: () => Math.max(1, parseInt(String(route.query.page ?? "1"), 10) || 1),
  set: (p: number) => {
    const q = queryToRecord();
    if (p <= 1) delete q.page;
    else q.page = String(p);
    router.replace({ path: "/n8n/workflow-results", query: q });
  },
});

function parseFiltersFromQuery(filtersEncoded: string | undefined): FilterRow[] {
  if (!filtersEncoded?.trim()) return [];
  try {
    const raw = decodeURIComponent(filtersEncoded.trim());
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: FilterRow[] = [];
    for (const el of arr) {
      if (!el || typeof el !== "object") continue;
      const o = el as Record<string, unknown>;
      const field = typeof o.field === "string" ? o.field : "";
      const op = typeof o.op === "string" ? o.op : "";
      const value = typeof o.value === "string" ? o.value : "";
      if (!field || !op) continue;
      const row: FilterRow = {
        field: field as FilterField,
        op: op as FilterOp,
        value,
      };
      if (field === "created_at" && value) {
        const t = Date.parse(value);
        if (Number.isFinite(t)) row._ts = t;
      }
      out.push(row);
    }
    return out;
  } catch {
    return [];
  }
}

function syncFiltersFromRoute(): void {
  const fq = route.query.filters;
  const fromFilters =
    typeof fq === "string" && fq.trim().length > 0 ? parseFiltersFromQuery(fq) : null;
  if (fromFilters && fromFilters.length > 0) {
    filterRows.value = fromFilters;
    return;
  }
  const rowsFromLegacy: FilterRow[] = [];
  const eid = String(route.query.executionId ?? "").trim();
  const cid = String(route.query.contactId ?? "").trim();
  const coid = String(route.query.companyId ?? "").trim();
  if (eid) rowsFromLegacy.push({ field: "execution_id", op: "eq", value: eid });
  if (cid) rowsFromLegacy.push({ field: "contact_id", op: "eq", value: cid });
  if (coid) rowsFromLegacy.push({ field: "company_id", op: "eq", value: coid });
  filterRows.value = rowsFromLegacy.length > 0 ? rowsFromLegacy : [{ field: "", op: "", value: "" }];
}

function buildClausesForApi(): { field: FilterField; op: FilterOp; value: string }[] {
  const out: { field: FilterField; op: FilterOp; value: string }[] = [];
  for (const row of filterRows.value) {
    const f = row.field as string;
    const o = row.op as string;
    const v = row.value?.trim() ?? "";
    if (!f || !o) continue;
    if ((o === "gte" || o === "lte") && !v) continue;
    if (o !== "gte" && o !== "lte" && !v) continue;
    out.push({ field: f as FilterField, op: o as FilterOp, value: v });
  }
  return out;
}

function applyFiltersToRoute() {
  const q = queryToRecord();
  delete q.contactId;
  delete q.companyId;
  delete q.executionId;
  const clauses = buildClausesForApi();
  const encoded = encodeURIComponent(JSON.stringify(clauses));
  if (encoded.length < 1600) q.filters = encoded;
  else delete q.filters;
  delete q.page;
  router.push({ path: "/n8n/workflow-results", query: q });
}

function addFilterRow() {
  filterRows.value.push({ field: "", op: "", value: "" });
}

function removeFilterRow(i: number) {
  filterRows.value.splice(i, 1);
  if (filterRows.value.length === 0) filterRows.value.push({ field: "", op: "", value: "" });
}

function clearFilters() {
  filterRows.value = [{ field: "", op: "", value: "" }];
  router.push({ path: "/n8n/workflow-results" });
}

function onFieldChange(row: FilterRow) {
  const ops = opsForField(row.field);
  if (!ops.some((o) => o.value === row.op)) {
    row.op = (ops[0]?.value as FilterOp) ?? "";
  }
  if (row.field !== "created_at") {
    row._ts = undefined;
  } else if (row.value) {
    const t = Date.parse(row.value);
    row._ts = Number.isFinite(t) ? t : null;
  }
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const offset = (page.value - 1) * PAGE_SIZE;
    const filters = buildClausesForApi();
    const r = await fetch("/api/n8n/workflow-results/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filters,
        limit: PAGE_SIZE,
        offset,
      }),
    });
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
    syncFiltersFromRoute();
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

function filterByContact(id: string | null) {
  if (!id) {
    clearFilters();
    return;
  }
  filterRows.value = [{ field: "contact_id", op: "eq", value: id }];
  applyFiltersToRoute();
}

function filterByCompany(id: string | null) {
  if (!id) {
    clearFilters();
    return;
  }
  filterRows.value = [{ field: "company_id", op: "eq", value: id }];
  applyFiltersToRoute();
}

function avatarFallback(label: string | null): string {
  const s = label?.trim() || "?";
  return s.charAt(0).toUpperCase();
}

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
      minWidth: 200,
      render(row) {
        if (!row.contact_id) return "—";
        return h(
          NSpace,
          { align: "center", size: 8, wrap: false },
          {
            default: () => [
              h(
                NAvatar,
                {
                  round: true,
                  size: 28,
                  src: row.contact_avatar_url || undefined,
                  style: { flexShrink: "0" },
                },
                { default: () => avatarFallback(row.contact_label) }
              ),
              h(
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
              ),
            ],
          }
        );
      },
    },
    {
      title: "Company",
      key: "company",
      minWidth: 200,
      render(row) {
        if (!row.company_id) return "—";
        return h(
          NSpace,
          { align: "center", size: 8, wrap: false },
          {
            default: () => [
              h(
                NAvatar,
                {
                  round: false,
                  size: 28,
                  src: row.company_logo_url || undefined,
                  style: { flexShrink: "0" },
                },
                { default: () => avatarFallback(row.company_label) }
              ),
              h(
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
              ),
            ],
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
      <NSpace align="center" justify="space-between" style="width: 100%">
        <span>n8n workflow results</span>
        <NRadioGroup :value="mode" size="small" @update:value="setMode">
          <NRadioButton value="table">Table</NRadioButton>
          <NRadioButton value="leadviews">Lead views</NRadioButton>
        </NRadioGroup>
      </NSpace>
    </template>

    <LeadViewsPanel
      v-if="mode === 'leadviews'"
      :initial-launch-id="leadViewsLaunchId"
      :initial-execution-id="leadViewsExecutionId"
    />

    <NSpace v-show="mode === 'table'" vertical size="medium" style="width: 100%">
      <NSpace vertical size="small" style="width: 100%">
        <NSpace align="center" wrap>
          <NButton size="small" @click="addFilterRow">Add filter</NButton>
          <NButton type="primary" size="small" :disabled="loading" @click="applyFiltersToRoute">
            Apply filters
          </NButton>
          <NButton quaternary size="small" :disabled="loading" @click="clearFilters">Clear all</NButton>
          <NTag v-if="route.query.filters && String(route.query.filters).length >= 1600" size="small" type="warning">
            Filter state too large for URL; bookmark may omit filters
          </NTag>
        </NSpace>

        <div v-for="(row, i) in filterRows" :key="i" class="filter-row">
          <NSelect
            v-model:value="row.field"
            placeholder="Field"
            clearable
            style="width: 220px"
            :options="FIELD_OPTIONS"
            :disabled="loading"
            @update:value="() => onFieldChange(row)"
          />
          <NSelect
            v-model:value="row.op"
            placeholder="Operator"
            clearable
            style="width: 160px"
            :options="opsForField(row.field)"
            :disabled="loading || !row.field"
          />
          <NDatePicker
            v-if="row.field === 'created_at'"
            :value="row._ts ?? null"
            type="datetime"
            clearable
            style="width: 280px"
            :disabled="loading"
            @update:value="
              (v: number | null) => {
                row._ts = v ?? undefined;
                row.value = v ? new Date(v).toISOString() : '';
              }
            "
          />
          <NInput
            v-else
            v-model:value="row.value"
            placeholder="Value"
            clearable
            style="min-width: 200px; flex: 1"
            :disabled="loading"
          />
          <NButton quaternary size="tiny" :disabled="loading" @click="removeFilterRow(i)">Remove</NButton>
        </div>
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
.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}
</style>
