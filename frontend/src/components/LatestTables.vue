<script setup lang="ts">
import { ref, computed, watch, h } from "vue";
import { useUrlSearchParams } from "@vueuse/core";
import type { LatestRows } from "../types";
import {
  NTabs,
  NTabPane,
  NDataTable,
  NEmpty,
  NButton,
  NPopover,
  NCheckbox,
  NSpace,
  NInput,
  NAlert,
} from "naive-ui";
import type { DataTableColumns, DataTableFilterState } from "naive-ui";

const props = defineProps<{ latest: LatestRows }>();

const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

type TableKey = keyof LatestRows;

const tabs: { key: TableKey; label: string }[] = [
  { key: "contacts", label: "Contacts" },
  { key: "linkedin_messages", label: "LinkedIn messages" },
  { key: "senders", label: "Senders" },
];

// --- URL state (shareable) ---
const params = useUrlSearchParams("history", {
  removeNullishValues: true,
  initialValue: {} as Record<string, string>,
});

const validTableKeys: TableKey[] = ["contacts", "linkedin_messages", "senders"];
const activeTab = ref<TableKey>(
  validTableKeys.includes((params.table as TableKey) ?? "") ? (params.table as TableKey) : "contacts"
);
// Per-tab state (URL only stores current tab)
const visibleColumnKeysByTable = ref<Partial<Record<TableKey, string[]>>>({});
const filterStateByTable = ref<Partial<Record<TableKey, DataTableFilterState>>>({});
const pageByTable = ref<Partial<Record<TableKey, number>>>({});
const pageSizeByTable = ref<Partial<Record<TableKey, number>>>({});

const visibleColumnKeys = computed({
  get: () => visibleColumnKeysByTable.value[activeTab.value] ?? [],
  set: (v: string[]) => {
    const next = { ...visibleColumnKeysByTable.value };
    next[activeTab.value] = v;
    visibleColumnKeysByTable.value = next;
  },
});
const filterState = computed({
  get: () => filterStateByTable.value[activeTab.value] ?? {},
  set: (v: DataTableFilterState) => {
    const next = { ...filterStateByTable.value };
    next[activeTab.value] = v;
    filterStateByTable.value = next;
  },
});
const currentPage = computed({
  get: () => pageByTable.value[activeTab.value] ?? 1,
  set: (v: number) => {
    const next = { ...pageByTable.value };
    next[activeTab.value] = v;
    pageByTable.value = next;
  },
});
const currentPageSize = computed({
  get: () => pageSizeByTable.value[activeTab.value] ?? DEFAULT_PAGE_SIZE,
  set: (v: number) => {
    const next = { ...pageSizeByTable.value };
    next[activeTab.value] = v;
    pageSizeByTable.value = next;
  },
});

// Initialize from URL on mount and on popstate
function parseUrlState() {
  const table = params.table;
  if (table && validTableKeys.includes(table as TableKey)) {
    activeTab.value = table as TableKey;
  }
  const tab = activeTab.value;
  try {
    if (params.cols && typeof params.cols === "string") {
      const cols = params.cols.split(",").filter(Boolean);
      visibleColumnKeysByTable.value = { ...visibleColumnKeysByTable.value, [tab]: cols.length > 0 ? cols : [] };
    }
  } catch {
    /* ignore */
  }
  try {
    if (params.filters && typeof params.filters === "string") {
      const decoded = decodeURIComponent(params.filters);
      const parsed = JSON.parse(decoded) as DataTableFilterState;
      const f = typeof parsed === "object" && parsed !== null ? parsed : {};
      filterStateByTable.value = { ...filterStateByTable.value, [tab]: f };
    }
  } catch {
    /* ignore */
  }
  try {
    const p = params.page;
    if (p != null && p !== "") {
      const num = parseInt(String(p), 10);
      if (Number.isInteger(num) && num >= 1) {
        pageByTable.value = { ...pageByTable.value, [tab]: num };
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const ps = params.pageSize;
    if (ps != null && ps !== "") {
      const num = parseInt(String(ps), 10);
      if (PAGE_SIZES.includes(num)) {
        pageSizeByTable.value = { ...pageSizeByTable.value, [tab]: num };
      }
    }
  } catch {
    /* ignore */
  }
}

function writeUrlState() {
  params.table = activeTab.value;
  const cols = visibleColumnKeys.value;
  params.cols = cols.length > 0 ? cols.join(",") : "";
  const f = filterState.value;
  const hasFilters = Object.keys(f).some(
    (k) => f[k] !== null && f[k] !== undefined && (Array.isArray(f[k]) ? (f[k] as unknown[]).length > 0 : true)
  );
  if (hasFilters) {
    params.filters = encodeURIComponent(JSON.stringify(f));
  } else {
    try {
      delete (params as Record<string, string>).filters;
    } catch {
      (params as Record<string, string>).filters = "";
    }
  }
  const p = currentPage.value;
  if (p > 1) (params as Record<string, string>).page = String(p);
  else try { delete (params as Record<string, string>).page; } catch { /* ignore */ }
  const ps = currentPageSize.value;
  if (ps !== DEFAULT_PAGE_SIZE) (params as Record<string, string>).pageSize = String(ps);
  else try { delete (params as Record<string, string>).pageSize; } catch { /* ignore */ }
}

// Sync URL -> state on init and when user changes URL (e.g. back/forward)
parseUrlState();
if (typeof window !== "undefined") {
  window.addEventListener("popstate", parseUrlState);
}

// Sync state -> URL when table, columns, filters or pagination change
watch(
  [activeTab, visibleColumnKeysByTable, filterStateByTable, pageByTable, pageSizeByTable],
  () => writeUrlState(),
  { deep: true }
);

// --- Backend-filtered table data (paginated) ---
const tableData = ref<Record<string, unknown>[]>([]);
const totalItemCount = ref(0);
const tableDataLoading = ref(false);
const tableDataError = ref("");

function filtersToApiFormat(state: DataTableFilterState): Record<string, (string | number)[]> {
  const out: Record<string, (string | number)[]> = {};
  for (const [k, v] of Object.entries(state)) {
    if (v === null || v === undefined) continue;
    const arr = Array.isArray(v) ? v : [v];
    const trimmed = arr.filter((x) => x !== "" && x !== null && x !== undefined);
    if (trimmed.length > 0) out[k] = trimmed;
  }
  return out;
}

async function fetchTableData() {
  tableDataError.value = "";
  tableDataLoading.value = true;
  try {
    const filters = filtersToApiFormat(filterState.value);
    const page = currentPage.value;
    const pageSize = currentPageSize.value;
    const offset = (page - 1) * pageSize;
    const q = new URLSearchParams({
      table: activeTab.value,
      limit: String(pageSize),
      offset: String(offset),
    });
    if (Object.keys(filters).length > 0) {
      q.set("filters", encodeURIComponent(JSON.stringify(filters)));
    }
    const r = await fetch(`/api/supabase-table-query?${q.toString()}`);
    const json = await r.json();
    if (!r.ok) {
      tableData.value = [];
      totalItemCount.value = 0;
      tableDataError.value = json.error ?? "Request failed";
      return;
    }
    tableData.value = Array.isArray(json.data) ? json.data : [];
    totalItemCount.value = Number(json.total) || 0;
  } catch (e) {
    tableData.value = [];
    totalItemCount.value = 0;
    tableDataError.value = e instanceof Error ? e.message : "Request failed";
  } finally {
    tableDataLoading.value = false;
  }
}

watch(
  [activeTab, filterStateByTable, pageByTable, pageSizeByTable],
  () => fetchTableData(),
  { immediate: true, deep: true }
);

function onUpdatePage(page: number) {
  currentPage.value = page;
}
function onUpdatePageSize(pageSize: number) {
  currentPageSize.value = pageSize;
  currentPage.value = 1;
}
function onUpdateFilters(filters: DataTableFilterState) {
  filterState.value = { ...filters };
  currentPage.value = 1;
}

// --- Table data and columns ---
const currentRows = computed(() => {
  if (tableData.value.length > 0) return tableData.value;
  return (props.latest[activeTab.value] ?? []) as Record<string, unknown>[];
});
const allKeys = computed(() => {
  const set = new Set<string>();
  currentRows.value.forEach((r) => Object.keys(r).forEach((k) => set.add(k)));
  return Array.from(set).sort();
});

const effectiveVisibleKeys = computed(() => {
  const visible = visibleColumnKeys.value;
  if (visible.length === 0) return allKeys.value;
  const set = new Set(visible);
  return allKeys.value.filter((k) => set.has(k));
});

function formatCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getUniqueValues(key: string): { label: string; value: string }[] {
  const set = new Set<string>();
  currentRows.value.forEach((row) => {
    const v = row[key];
    const s = formatCell(v);
    if (s) set.add(s);
  });
  return Array.from(set)
    .sort()
    .slice(0, 200)
    .map((s) => ({ label: s, value: s }));
}

const manualFilterInputByColumn = ref<Record<string, string>>({});

function addCustomFilterValue(colKey: string) {
  const raw = (manualFilterInputByColumn.value[colKey] ?? "").trim();
  if (!raw) return;
  const current = filterState.value[colKey];
  const values = Array.isArray(current) ? [...current] : current != null ? [current] : [];
  if (values.includes(raw)) return;
  filterState.value = { ...filterState.value, [colKey]: [...values, raw] };
  manualFilterInputByColumn.value = { ...manualFilterInputByColumn.value, [colKey]: "" };
}

function buildFilterMenu(key: string) {
  return (actions: { hide: () => void }) => {
    const options = getUniqueValues(key);
    const selected = filterState.value[key];
    const values = Array.isArray(selected) ? selected : selected != null ? [selected] : [];
    const inputVal = manualFilterInputByColumn.value[key] ?? "";
    return h("div", { class: "filter-menu" }, [
      h(
        "div",
        { class: "filter-menu-options" },
        options.map((opt) =>
          h(NCheckbox, {
            checked: values.includes(opt.value),
            onUpdateChecked: (checked: boolean) => {
              const next = checked ? [...values, opt.value] : values.filter((v) => v !== opt.value);
              filterState.value = { ...filterState.value, [key]: next };
            },
          }, () => opt.label)
        )
      ),
      h("div", { class: "filter-menu-custom" }, [
        h(NInput, {
          value: inputVal,
          onUpdateValue: (v: string) => {
            manualFilterInputByColumn.value = { ...manualFilterInputByColumn.value, [key]: v };
          },
          placeholder: "Type value…",
          size: "small",
          onKeydown: (e: KeyboardEvent) => {
            if (e.key === "Enter") addCustomFilterValue(key);
          },
        }),
        h(NButton, { size: "small", onClick: () => addCustomFilterValue(key) }, "Add"),
      ]),
      h("div", { class: "filter-menu-actions" }, [
        h(NButton, { size: "small", type: "primary", onClick: actions.hide }, "OK"),
      ]),
    ]);
  };
}

const tableColumns = computed((): DataTableColumns<Record<string, unknown>> => {
  return effectiveVisibleKeys.value.map((key) => {
    const options = getUniqueValues(key);
    return {
      width: 200,
      title: key,
      key,
      ellipsis: { tooltip: true },
      filter: true,
      filterOptions: options.length > 0 ? options : [{ label: "(empty)", value: "—" }],
      filterOptionValues: filterState.value[key] as string[] | undefined,
      filterMultiple: true,
      renderFilterMenu: buildFilterMenu(key),
      render(row: Record<string, unknown>) {
        return formatCell(row[key]);
      },
    };
  });
});

function toggleColumn(key: string, visible: boolean) {
  const all = allKeys.value;
  if (visible) {
    if (visibleColumnKeys.value.length === 0) return; // already "all"
    const next = [...visibleColumnKeys.value, key].sort();
    visibleColumnKeys.value = next;
  } else {
    if (visibleColumnKeys.value.length === 0) {
      visibleColumnKeys.value = all.filter((k) => k !== key);
    } else {
      visibleColumnKeys.value = visibleColumnKeys.value.filter((k) => k !== key);
    }
  }
}

function setAllColumnsVisible() {
  visibleColumnKeys.value = [];
}
</script>

<template>
  <div class="latest-tables">
    <div class="latest-header">
      <h3 class="latest-title">Latest rows (newest first)</h3>
      <NPopover trigger="click" placement="bottom-end">
        <template #trigger>
          <NButton quaternary size="small">Columns</NButton>
        </template>
        <div class="columns-popover">
          <NButton quaternary size="tiny" @click="setAllColumnsVisible">
            Show all
          </NButton>
          <NSpace vertical :size="4" style="margin-top: 8px">
            <NCheckbox
              v-for="key in allKeys"
              :key="key"
              :checked="effectiveVisibleKeys.includes(key)"
              @update:checked="(v: boolean) => toggleColumn(key, v)"
            >
              {{ key }}
            </NCheckbox>
          </NSpace>
        </div>
      </NPopover>
    </div>
    <NTabs v-model:value="activeTab" type="line" size="medium">
      <NTabPane
        v-for="t in tabs"
        :key="t.key"
        :name="t.key"
        :tab="`${t.label} (${props.latest[t.key].length})`"
      >
        <NAlert v-if="tableDataError" type="error" class="table-error">
          {{ tableDataError }}
        </NAlert>
        <NDataTable
          v-if="currentRows.length > 0 || tableDataLoading"
          :columns="tableColumns"
          :data="currentRows"
          :filters="filterState"
          :loading="tableDataLoading"
          :bordered="false"
          size="small"
          :max-height="360"
          remote
          :pagination="{
            page: currentPage,
            pageSize: currentPageSize,
            itemCount: totalItemCount,
            showSizePicker: true,
            pageSizes: PAGE_SIZES,
            onUpdatePage: onUpdatePage,
            onUpdatePageSize: onUpdatePageSize,
          }"
          @update:filters="onUpdateFilters"
        />
        <NEmpty v-else-if="!tableDataLoading" description="No rows" />
      </NTabPane>
    </NTabs>
  </div>
</template>

<style scoped>
.latest-tables {
  margin-top: 0.5rem;
}
.latest-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.latest-title {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0;
  opacity: 0.85;
}
.columns-popover {
  padding: 0.25rem 0;
  min-width: 180px;
  max-height: 320px;
  overflow-y: auto;
}
.table-error {
  margin-bottom: 0.5rem;
}
.filter-menu {
  padding: 8px;
  min-width: 220px;
  max-height: 360px;
  overflow-y: auto;
}
.filter-menu-options {
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 8px;
}
.filter-menu-custom {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}
.filter-menu-custom .n-input {
  flex: 1;
}
.filter-menu-actions {
  border-top: 1px solid var(--n-border-color);
  padding-top: 6px;
}
</style>
