<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useUrlSearchParams, useDebounceFn } from "@vueuse/core";
import type { LatestRows, TableCounts } from "../types";
import {
  NTabs,
  NTabPane,
  NButton,
  NInput,
  NPopover,
  NCheckbox,
  NSpace,
} from "naive-ui";
import type { DataTableFilterState } from "naive-ui";
import ContactsTable from "./ContactsTable.vue";
import LinkedinMessagesTable from "./LinkedinMessagesTable.vue";
import SendersTable from "./SendersTable.vue";
import ConversationModal from "./ConversationModal.vue";

const props = defineProps<{ latest: LatestRows; counts?: TableCounts }>();

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

const DEFAULT_VISIBLE_COLUMNS: Record<TableKey, string[]> = {
  contacts: [
    "avatar_url",
    "name",
    "company_name",
    "position",
    "connections_number",
    "location",
    "personal_email",
    "work_email",
  ],
  linkedin_messages: ["text", "type", "sent_at", "read_at"],
  senders: ["avatar_url", "first_name", "last_name", "status", "smart_limits_enabled"],
};

const STORAGE_KEY_PREFIX = "mcp-toolkit/table-visible-columns";

function getVisibleColumnsFromStorage(table: TableKey): string[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}/${table}`);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((x) => typeof x === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function setVisibleColumnsInStorage(table: TableKey, cols: string[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}/${table}`, JSON.stringify(cols));
  } catch {
    /* ignore */
  }
}

const activeTab = ref<TableKey>(
  validTableKeys.includes((params.table as TableKey) ?? "") ? (params.table as TableKey) : "contacts"
);
const visibleColumnKeysByTable = ref<Partial<Record<TableKey, string[]>>>({});
const filterStateByTable = ref<Partial<Record<TableKey, DataTableFilterState>>>({});
const pageByTable = ref<Partial<Record<TableKey, number>>>({});
const pageSizeByTable = ref<Partial<Record<TableKey, number>>>({});
const searchByTable = ref<Partial<Record<TableKey, string>>>({});
const searchInputByTable = ref<Partial<Record<TableKey, string>>>({});

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
const debouncedApplySearch = useDebounceFn(() => {
  const tab = activeTab.value;
  const value = (searchInputByTable.value[tab] ?? "").trim();
  searchByTable.value = { ...searchByTable.value, [tab]: value };
  currentPage.value = 1;
}, 300);

const searchQuery = computed({
  get: () => searchInputByTable.value[activeTab.value] ?? searchByTable.value[activeTab.value] ?? "",
  set: (v: string) => {
    const next = { ...searchInputByTable.value };
    next[activeTab.value] = (v ?? "").trim();
    searchInputByTable.value = next;
    debouncedApplySearch();
  },
});

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
  // Fill visible columns from localStorage or defaults for any table not set (e.g. from URL)
  const nextCols = { ...visibleColumnKeysByTable.value };
  for (const t of validTableKeys) {
    if (nextCols[t] === undefined) {
      nextCols[t] = getVisibleColumnsFromStorage(t as TableKey) ?? DEFAULT_VISIBLE_COLUMNS[t as TableKey];
    }
  }
  visibleColumnKeysByTable.value = nextCols;
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
  try {
    const search = params.search;
    if (search != null && typeof search === "string") {
      searchByTable.value = { ...searchByTable.value, [tab]: search };
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
  else try {
    delete (params as Record<string, string>).page;
  } catch {
    /* ignore */
  }
  const ps = currentPageSize.value;
  if (ps !== DEFAULT_PAGE_SIZE) (params as Record<string, string>).pageSize = String(ps);
  else try {
    delete (params as Record<string, string>).pageSize;
  } catch {
    /* ignore */
  }
  const search = (searchByTable.value[activeTab.value] ?? "").trim();
  if (search.length > 0) (params as Record<string, string>).search = search;
  else try {
    delete (params as Record<string, string>).search;
  } catch {
    /* ignore */
  }
}

parseUrlState();
if (typeof window !== "undefined") {
  window.addEventListener("popstate", parseUrlState);
}

watch(
  [activeTab, visibleColumnKeysByTable, filterStateByTable, pageByTable, pageSizeByTable, searchByTable],
  () => {
    writeUrlState();
    visibleColumnKeysByTable.value &&
      (validTableKeys as TableKey[]).forEach((t) => {
        const cols = visibleColumnKeysByTable.value[t];
        if (cols !== undefined) setVisibleColumnsInStorage(t, cols);
      });
  },
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
    const search = searchQuery.value.trim();
    if (search.length > 0) q.set("search", search);
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
  [activeTab, filterStateByTable, pageByTable, pageSizeByTable, searchByTable],
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

// --- Column visibility (for Columns popover) ---
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

function toggleColumn(key: string, visible: boolean) {
  const all = allKeys.value;
  if (visible) {
    if (visibleColumnKeys.value.length === 0) return;
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

// --- Conversation modal ---
const conversationModalOpen = ref(false);
const conversationLoading = ref(false);
const conversationError = ref("");
const conversationData = ref<{ contact?: Record<string, unknown> | null; messages: unknown[] }>({
  messages: [],
});
const lastConversationParams = ref<{
  leadUuid?: string;
  conversationUuid?: string;
  senderProfileUuid?: string;
}>({});

async function fetchConversation(params: {
  leadUuid?: string;
  conversationUuid?: string;
  senderProfileUuid?: string;
}) {
  conversationError.value = "";
  conversationModalOpen.value = true;
  conversationLoading.value = true;
  lastConversationParams.value = { ...params };
  try {
    const q = new URLSearchParams();
    if (params.leadUuid) q.set("leadUuid", params.leadUuid);
    if (params.conversationUuid) q.set("conversationUuid", params.conversationUuid);
    if (params.senderProfileUuid) q.set("senderProfileUuid", params.senderProfileUuid);
    const r = await fetch(`/api/conversation?${q.toString()}`);
    const json = await r.json();
    conversationData.value = {
      contact: json.contact ?? null,
      messages: Array.isArray(json.messages) ? json.messages : [],
    };
    if (json.error) conversationError.value = json.error;
  } catch (e) {
    conversationError.value = e instanceof Error ? e.message : "Request failed";
    conversationData.value = { messages: [] };
  } finally {
    conversationLoading.value = false;
  }
}

const cursorDeeplink = computed(() => {
  const p = lastConversationParams.value;
  let text = "";
  if (p.leadUuid) {
    const name =
      conversationData.value.contact && typeof conversationData.value.contact.name === "string"
        ? conversationData.value.contact.name
        : null;
    if (name) {
      text = `Use MCP tool get_conversation_by_contact_name with contactFullName: "${name.replace(/"/g, '\\"')}" to show this LinkedIn conversation.`;
    } else {
      text = `Get the LinkedIn conversation for contact with lead_uuid ${p.leadUuid}. Use get_contacts filtered by uuid then get_conversation_by_contact_name with that contact's name.`;
    }
  } else if (p.conversationUuid) {
    text = `Use MCP tool get_conversation_by_message with conversationUuid: "${p.conversationUuid}" to show this LinkedIn conversation thread.`;
  } else if (p.senderProfileUuid) {
    text = `Use MCP tool get_conversation_by_sender with senderProfileUuid: "${p.senderProfileUuid}" to show all LinkedIn messages from this sender.`;
  } else {
    return "";
  }
  const encoded = encodeURIComponent(text);
  return `cursor://anysphere.cursor-deeplink/prompt?text=${encoded}`;
});

function openInCursor() {
  const url = cursorDeeplink.value;
  if (url) window.open(url, "_blank", "noopener");
}

function onFindConversationByContact(row: Record<string, unknown>) {
  const uuid = row.uuid != null ? String(row.uuid) : undefined;
  if (uuid) fetchConversation({ leadUuid: uuid });
  else {
    conversationModalOpen.value = true;
    conversationLoading.value = false;
    conversationError.value = "Contact has no uuid";
    conversationData.value = { messages: [] };
  }
}

function onFindConversationByMessage(row: Record<string, unknown>) {
  const convUuid =
    row.linkedin_conversation_uuid != null ? String(row.linkedin_conversation_uuid) : undefined;
  const leadUuid = row.lead_uuid != null ? String(row.lead_uuid) : undefined;
  if (convUuid) fetchConversation({ conversationUuid: convUuid });
  else if (leadUuid) fetchConversation({ leadUuid: leadUuid });
  else {
    conversationModalOpen.value = true;
    conversationLoading.value = false;
    conversationError.value = "Message has no linkedin_conversation_uuid";
    conversationData.value = { messages: [] };
  }
}

function onFindConversationBySender(row: Record<string, unknown>) {
  const uuid = row.uuid != null ? String(row.uuid) : undefined;
  if (uuid) fetchConversation({ senderProfileUuid: uuid });
  else {
    conversationModalOpen.value = true;
    conversationLoading.value = false;
    conversationError.value = "Sender has no uuid";
    conversationData.value = { messages: [] };
  }
}
</script>

<template>
  <div class="latest-tables">
    <div class="latest-header">
      <h3 class="latest-title">Latest rows (newest first)</h3>
    </div>
    <NTabs v-model:value="activeTab" type="line" size="medium">
      <template #suffix>
        <NSpace align="center" :size="12">
        <NInput
          v-model:value="searchQuery"
          type="text"
          placeholder="Search…"
          clearable
          size="small"
          style="width: 200px"
        />
        <NPopover trigger="click" placement="bottom-end">
          <template #trigger>
            <NButton quaternary size="small">Columns</NButton>
          </template>
        <div class="columns-popover">
          <NButton quaternary size="tiny" @click="setAllColumnsVisible">Show all</NButton>
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
      </NSpace>
       </template>
      <NTabPane
        v-for="t in tabs"
        :key="t.key"
        :name="t.key"
        :tab="`${t.label} (${props.counts?.[t.key] ?? '—'})`"
      >
        <ContactsTable
          v-if="activeTab === 'contacts'"
          :data="tableData"
          :loading="tableDataLoading"
          :error="tableDataError"
          :filter-state="filterState"
          :visible-column-keys="visibleColumnKeys"
          :search-term="searchByTable.contacts ?? ''"
          :total-item-count="totalItemCount"
          :page="currentPage"
          :page-size="currentPageSize"
          :page-sizes="PAGE_SIZES"
          @update:filters="onUpdateFilters"
          @update:page="onUpdatePage"
          @update:page-size="onUpdatePageSize"
          @action="onFindConversationByContact"
        />
        <LinkedinMessagesTable
          v-else-if="activeTab === 'linkedin_messages'"
          :data="tableData"
          :loading="tableDataLoading"
          :error="tableDataError"
          :filter-state="filterState"
          :visible-column-keys="visibleColumnKeys"
          :search-term="searchByTable.linkedin_messages ?? ''"
          :total-item-count="totalItemCount"
          :page="currentPage"
          :page-size="currentPageSize"
          :page-sizes="PAGE_SIZES"
          @update:filters="onUpdateFilters"
          @update:page="onUpdatePage"
          @update:page-size="onUpdatePageSize"
          @action="onFindConversationByMessage"
        />
        <SendersTable
          v-else-if="activeTab === 'senders'"
          :data="tableData"
          :loading="tableDataLoading"
          :error="tableDataError"
          :filter-state="filterState"
          :visible-column-keys="visibleColumnKeys"
          :search-term="searchByTable.senders ?? ''"
          :total-item-count="totalItemCount"
          :page="currentPage"
          :page-size="currentPageSize"
          :page-sizes="PAGE_SIZES"
          @update:filters="onUpdateFilters"
          @update:page="onUpdatePage"
          @update:page-size="onUpdatePageSize"
          @action="onFindConversationBySender"
        />
      </NTabPane>
    </NTabs>

    <ConversationModal
      :show="conversationModalOpen"
      :loading="conversationLoading"
      :error="conversationError"
      :contact="conversationData.contact"
      :messages="conversationData.messages"
      :cursor-deeplink="cursorDeeplink"
      @update:show="conversationModalOpen = $event"
      @open-in-cursor="openInCursor"
    />
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
</style>
