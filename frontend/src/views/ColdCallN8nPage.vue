<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, h } from "vue";
import {
  NCard,
  NSpace,
  NInput,
  NButton,
  NSelect,
  NCheckbox,
  NTabs,
  NTabPane,
  NEmpty,
  NSpin,
  NDataTable,
  NTag,
  NAlert,
  NDrawer,
  NDrawerContent,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { useDebounceFn } from "@vueuse/core";
import { PhoneIcon } from "lucide-vue-next";
import { marked } from "marked";
import DOMPurify from "dompurify";

const LS_HISTORY = "coldCallN8n.searchHistory";
const LS_SUMMARIES = "coldCallN8n.summaries";
const LS_MODEL = "coldCallN8n.lastModel";
const LS_AUTO_SUMMARIZE = "coldCallN8n.autoSummarize";
const LS_SIDEBAR_WIDTH = "coldCallN8n.sidebarWidthPct";

type SearchHit = {
  uuid: string;
  label: string;
  avatar_url: string | null;
  company_name: string | null;
  company_uuid: string | null;
  position: string | null;
  work_email: string | null;
};

type HistoryEntry = {
  contactId: string;
  label: string;
  searchedAt: string;
};

type SummaryEntry = {
  text: string;
  model: string;
  createdAt: string;
};

type N8nRow = {
  id: string;
  workflow: string;
  execution_id: string | null;
  created_at: string;
  result: Record<string, unknown>;
};

const message = useMessage();

const nameQuery = ref("");
const searchLoading = ref(false);
const searchHits = ref<SearchHit[]>([]);
const searchError = ref("");
let searchSeq = 0;

const selectedContact = ref<SearchHit | null>(null);

const n8nLoading = ref(false);
const n8nError = ref("");
const n8nRows = ref<N8nRow[]>([]);
const n8nTotal = ref(0);

const modelsLoading = ref(false);
const modelsError = ref("");
const modelOptions = ref<{ label: string; value: string }[]>([]);
const selectedModel = ref<string | null>(null);

const summarizeLoading = ref(false);
const summarizeText = ref("");
const summarizeAbort = ref<AbortController | null>(null);
const showLocalCopy = ref(false);
const autoSummarize = ref(false);
const activeTab = ref<"ai_summary" | "static_summary" | "details">("static_summary");
const sidebarWidthPct = ref(42);
const resizing = ref(false);

const historyEntries = ref<HistoryEntry[]>([]);
const summariesMap = ref<Record<string, SummaryEntry>>({});

const drawerOpen = ref(false);
const drawerTitle = ref("");
const drawerJson = ref("");

function loadLocalState(): void {
  try {
    const h = localStorage.getItem(LS_HISTORY);
    if (h) {
      const parsed = JSON.parse(h) as unknown;
      historyEntries.value = Array.isArray(parsed)
        ? (parsed as HistoryEntry[]).filter(
            (e) =>
              e &&
              typeof e.contactId === "string" &&
              typeof e.label === "string" &&
              typeof e.searchedAt === "string"
          )
        : [];
    }
  } catch {
    historyEntries.value = [];
  }
  try {
    const s = localStorage.getItem(LS_SUMMARIES);
    summariesMap.value = s ? (JSON.parse(s) as Record<string, SummaryEntry>) : {};
  } catch {
    summariesMap.value = {};
  }
  const m = localStorage.getItem(LS_MODEL)?.trim();
  if (m) selectedModel.value = m;
  autoSummarize.value = localStorage.getItem(LS_AUTO_SUMMARIZE) === "1";
  const w = Number.parseInt(localStorage.getItem(LS_SIDEBAR_WIDTH) ?? "42", 10);
  if (Number.isFinite(w)) sidebarWidthPct.value = Math.min(Math.max(w, 22), 65);
}

function saveHistory(): void {
  localStorage.setItem(LS_HISTORY, JSON.stringify(historyEntries.value.slice(0, 50)));
}

function pushHistory(hit: SearchHit): void {
  const entry: HistoryEntry = {
    contactId: hit.uuid,
    label: hit.label,
    searchedAt: new Date().toISOString(),
  };
  const rest = historyEntries.value.filter((e) => e.contactId !== hit.uuid);
  historyEntries.value = [entry, ...rest].slice(0, 50);
  saveHistory();
}

function removeHistory(contactId: string): void {
  historyEntries.value = historyEntries.value.filter((e) => e.contactId !== contactId);
  saveHistory();
}

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

function companyTagStyle(companyName: string): Record<string, string> {
  const base = companyName.trim().toLowerCase();
  const hash = hashString(base);
  const hue = hash % 360;
  return {
    backgroundColor: `hsla(${hue} 72% 42% / 0.22)`,
    borderColor: `hsla(${hue} 72% 56% / 0.65)`,
    color: `hsl(${hue} 82% 78%)`,
  };
}

function saveSummary(contactId: string, text: string, model: string): void {
  const key = `${contactId}::${Date.now()}`;
  const next = { ...summariesMap.value, [key]: { text, model, createdAt: new Date().toISOString() } };
  summariesMap.value = next;
  localStorage.setItem(LS_SUMMARIES, JSON.stringify(next));
}

const latestSummaryForContact = computed(() => {
  const id = selectedContact.value?.uuid;
  if (!id) return null;
  let best: { key: string; entry: SummaryEntry } | null = null;
  for (const [key, entry] of Object.entries(summariesMap.value)) {
    if (!key.startsWith(`${id}::`)) continue;
    if (!best || entry.createdAt > best.entry.createdAt) best = { key, entry };
  }
  return best?.entry ?? null;
});

function latestSummaryForContactId(contactId: string): SummaryEntry | null {
  let best: SummaryEntry | null = null;
  for (const [key, entry] of Object.entries(summariesMap.value)) {
    if (!key.startsWith(`${contactId}::`)) continue;
    if (!best || entry.createdAt > best.createdAt) best = entry;
  }
  return best;
}

const hasLiveSummary = computed(() => summarizeLoading.value || summarizeText.value.trim().length > 0);
const renderedLiveSummaryHtml = computed(() => {
  const raw = summarizeText.value.trim();
  if (!raw) return "";
  return DOMPurify.sanitize(marked.parse(raw) as string);
});
const renderedLocalSummaryHtml = computed(() => {
  const raw = latestSummaryForContact.value?.text?.trim() ?? "";
  if (!raw) return "";
  return DOMPurify.sanitize(marked.parse(raw) as string);
});

type StaticFieldDef = { path: string; label: string; hint?: string };
type StaticSummaryCard = {
  category: "Contact" | "Company";
  title: string;
  value: string;
};
type StaticNoneCard = {
  category: "Contact" | "Company";
  title: string;
};

const STATIC_CONTACT_FIELDS: StaticFieldDef[] = [
  { path: "contacts_output.ai_marketing_depth", label: "AI Marketing Depth" },
  { path: "contacts_output.ai_tools_detected", label: "AI Tools Detected" },
  { path: "contacts_output.channel_affinity", label: "Channel Affinity" },
  { path: "contacts_output.channel_affinity_evidence", label: "Channel Affinity Evidence" },
  { path: "contacts_output.paid_media_responsibility", label: "Paid Media Responsibility" },
  { path: "contacts_output.performance_motion", label: "Performance Motion" },
];

const STATIC_COMPANY_FIELDS: StaticFieldDef[] = [
  { path: "companies_output.ad_spend_potential", label: "Ad Spend Potential" },
  { path: "companies_output.business_motion", label: "Business Motion" },
  { path: "companies_output.business_motion_evidence", label: "Business Motion Evidence" },
  { path: "companies_output.channel_affinity_company", label: "Company Channel Affinity" },
  { path: "companies_output.company_type_tag", label: "Company Type Tag" },
  { path: "companies_output.dtc_motion", label: "DTC Motion" },
  { path: "companies_output.included_contact_roles_display", label: "Included Contact Roles" },
  { path: "companies_output.marketing_team_composition", label: "Marketing Team Composition" },
  { path: "companies_output.singleton_hook_signal", label: "Hook Signal" },
  { path: "companies_output.singleton_observation_line", label: "Observation Line" },
  { path: "companies_output.sprites_account_pov", label: "Sprites Account POV" },
  { path: "companies_output.their_icp_summary", label: "ICP Summary" },
  { path: "companies_output.web_evidence_paid_media_explanation", label: "Paid Media Web Evidence" },
  { path: "companies_output.web_evidence_seo_explanation", label: "SEO Web Evidence" },
];

function getByPath(obj: unknown, dotted: string): unknown {
  if (!obj || typeof obj !== "object") return null;
  let cur: unknown = obj;
  for (const p of dotted.split(".")) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function valueToLine(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    const normalized = t.toLowerCase();
    if (
      normalized.length === 0 ||
      normalized === "none" ||
      normalized === "null" ||
      normalized === "n/a" ||
      normalized === "na" ||
      normalized === "unknown" ||
      normalized === "undefined" ||
      normalized === "-"
    ) {
      return null;
    }
    return t.length > 0 ? t : null;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const arr = v
      .map((x) => valueToLine(x))
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    if (arr.length === 0) return null;
    return arr.join(", ");
  }
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s && s !== "{}" ? s : null;
  }
  return null;
}

function collectFieldValues(path: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of n8nRows.value) {
    const raw = getByPath(row.result, path);
    const line = valueToLine(raw);
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function formatValuesForCard(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return values.map((v, i) => `${i + 1}. ${v}`).join("\n");
}

function buildStaticCards(
  fields: readonly StaticFieldDef[],
  category: "Contact" | "Company"
): { cards: StaticSummaryCard[]; none: string[] } {
  const cards: StaticSummaryCard[] = [];
  const none: string[] = [];
  for (const field of fields) {
    const values = collectFieldValues(field.path);
    if (values.length === 0) {
      none.push(field.label);
      continue;
    }
    cards.push({
      category,
      title: field.label,
      value: formatValuesForCard(values),
    });
  }
  return { cards, none };
}

const staticSummaryCards = computed<StaticSummaryCard[]>(() => {
  const contact = buildStaticCards(STATIC_CONTACT_FIELDS, "Contact");
  const company = buildStaticCards(STATIC_COMPANY_FIELDS, "Company");
  return [...contact.cards, ...company.cards];
});

const staticSummaryNoneFields = computed(() => {
  const contact = buildStaticCards(STATIC_CONTACT_FIELDS, "Contact");
  const company = buildStaticCards(STATIC_COMPANY_FIELDS, "Company");
  return [
    ...contact.none.map((x): StaticNoneCard => ({ category: "Contact", title: x })),
    ...company.none.map((x): StaticNoneCard => ({ category: "Company", title: x })),
  ];
});

async function runContactSearch(): Promise<void> {
  const q = nameQuery.value.trim();
  const seq = ++searchSeq;
  if (!q) {
    searchHits.value = [];
    searchError.value = "";
    return;
  }
  searchLoading.value = true;
  searchError.value = "";
  try {
    const sp = new URLSearchParams({ nameLike: q, limit: "25" });
    const r = await fetch(`/api/contacts/search-global?${sp.toString()}`);
    const j = (await r.json()) as { data?: SearchHit[]; error?: string };
    if (seq !== searchSeq) return;
    if (!r.ok) throw new Error(j.error ?? "Search failed");
    searchHits.value = j.data ?? [];
  } catch (e) {
    if (seq !== searchSeq) return;
    searchHits.value = [];
    searchError.value = e instanceof Error ? e.message : "Search failed";
  } finally {
    if (seq === searchSeq) searchLoading.value = false;
  }
}

const debouncedSearch = useDebounceFn(runContactSearch, 300);

watch(nameQuery, () => {
  void debouncedSearch();
});

async function loadModels(): Promise<void> {
  modelsLoading.value = true;
  modelsError.value = "";
  try {
    const r = await fetch("/api/openrouter/models");
    const j = (await r.json()) as {
      data?: Array<{ id: string; name: string }>;
      error?: string;
    };
    if (!r.ok || j.error) throw new Error(j.error ?? "Failed to load models");
    modelOptions.value = (j.data ?? []).map((m) => ({ label: m.name || m.id, value: m.id }));
    if (!selectedModel.value && modelOptions.value.length > 0) {
      selectedModel.value = modelOptions.value[0]!.value;
    }
  } catch (e) {
    modelsError.value = e instanceof Error ? e.message : "Failed to load models";
    modelOptions.value = [];
  } finally {
    modelsLoading.value = false;
  }
}

watch(selectedModel, (m) => {
  if (m) localStorage.setItem(LS_MODEL, m);
});
watch(autoSummarize, (v) => {
  localStorage.setItem(LS_AUTO_SUMMARIZE, v ? "1" : "0");
});
watch(sidebarWidthPct, (v) => {
  localStorage.setItem(LS_SIDEBAR_WIDTH, String(Math.round(v)));
});

function onResizeMove(e: MouseEvent): void {
  if (!resizing.value) return;
  const root = document.querySelector(".split-layout");
  if (!root) return;
  const rect = root.getBoundingClientRect();
  if (rect.width <= 0) return;
  const rawPct = ((e.clientX - rect.left) / rect.width) * 100;
  sidebarWidthPct.value = Math.min(Math.max(rawPct, 22), 65);
}

function stopResize(): void {
  resizing.value = false;
}

function startResize(e: MouseEvent): void {
  e.preventDefault();
  resizing.value = true;
}

async function loadN8nForContact(): Promise<void> {
  const c = selectedContact.value;
  if (!c) {
    n8nRows.value = [];
    n8nTotal.value = 0;
    return;
  }
  n8nLoading.value = true;
  n8nError.value = "";
  try {
    const r = await fetch("/api/n8n/workflow-results/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filters: [{ field: "contact_id", op: "eq", value: c.uuid }],
        limit: 50,
        offset: 0,
      }),
    });
    const j = (await r.json()) as {
      rows?: Array<Record<string, unknown>>;
      total?: number;
      error?: string;
    };
    if (!r.ok) throw new Error(j.error ?? "Failed to load n8n results");
    n8nTotal.value = j.total ?? 0;
    const raw = j.rows ?? [];
    n8nRows.value = raw.map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      workflow: typeof row.workflow === "string" ? row.workflow : "",
      execution_id: typeof row.execution_id === "string" ? row.execution_id : null,
      created_at: typeof row.created_at === "string" ? row.created_at : "",
      result:
        row.result && typeof row.result === "object" && !Array.isArray(row.result)
          ? (row.result as Record<string, unknown>)
          : {},
    }));
  } catch (e) {
    n8nRows.value = [];
    n8nTotal.value = 0;
    n8nError.value = e instanceof Error ? e.message : "Failed to load";
  } finally {
    n8nLoading.value = false;
  }
}

function selectHit(hit: SearchHit): void {
  selectedContact.value = hit;
  activeTab.value = "static_summary";
  pushHistory(hit);
  summarizeText.value = "";
  const local = latestSummaryForContactId(hit.uuid);
  showLocalCopy.value = !!local;
  void loadN8nForContact().then(() => {
    if (local) return;
    if (!autoSummarize.value) return;
    if (!selectedModel.value) return;
    if (n8nRows.value.length === 0) return;
    if (!summarizeLoading.value) void summarize();
  });
}

function selectHistory(entry: HistoryEntry): void {
  nameQuery.value = entry.label;
  const hit: SearchHit = {
    uuid: entry.contactId,
    label: entry.label,
    avatar_url: null,
    company_name: null,
    company_uuid: null,
    position: null,
    work_email: null,
  };
  selectedContact.value = hit;
  activeTab.value = "static_summary";
  pushHistory(hit);
  summarizeText.value = "";
  const local = latestSummaryForContactId(hit.uuid);
  showLocalCopy.value = !!local;
  void loadN8nForContact().then(() => {
    if (local) return;
    if (!autoSummarize.value) return;
    if (!selectedModel.value) return;
    if (n8nRows.value.length === 0) return;
    if (!summarizeLoading.value) void summarize();
  });
}

function stopSummarize(): void {
  summarizeAbort.value?.abort();
  summarizeAbort.value = null;
  summarizeLoading.value = false;
}

async function parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onText: (t: string) => void,
  onError: (msg: string) => void
): Promise<void> {
  const decoder = new TextDecoder();
  let carry = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = carry.indexOf("\n\n")) >= 0) {
      const block = carry.slice(0, sep);
      carry = carry.slice(sep + 2);
      for (const line of block.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const obj = JSON.parse(payload) as Record<string, unknown>;
          if (typeof obj.text === "string") onText(obj.text);
          if (typeof obj.error === "string") onError(obj.error);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

async function summarize(): Promise<void> {
  const c = selectedContact.value;
  if (!c || !selectedModel.value) {
    message.warning("Pick a contact and model first.");
    return;
  }
  if (n8nRows.value.length === 0) {
    message.warning("No n8n rows to summarize.");
    return;
  }
  stopSummarize();
  const ac = new AbortController();
  summarizeAbort.value = ac;
  summarizeLoading.value = true;
  summarizeText.value = "";
  showLocalCopy.value = false;
  const rowsPayload = n8nRows.value.map((r) => ({
    id: r.id,
    workflow: r.workflow,
    execution_id: r.execution_id,
    created_at: r.created_at,
    result: r.result,
  }));
  try {
    const r = await fetch("/api/openrouter/stream-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel.value,
        temperature: 0.4,
        mode: "n8n_workflow_results_summary",
        contactId: c.uuid,
        contactLabel: c.label,
        rows: rowsPayload,
        user: `cold-call:${c.uuid}`,
        sessionId: `cold-call-n8n:${c.uuid}`,
      }),
      signal: ac.signal,
    });
    if (!r.ok) {
      const t = await r.text();
      let msg = t;
      try {
        const j = JSON.parse(t) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* keep */
      }
      throw new Error(msg || `HTTP ${r.status}`);
    }
    const body = r.body;
    if (!body) throw new Error("No response body");
    await parseSseStream(
      body.getReader(),
      (delta) => {
        summarizeText.value += delta;
      },
      (err) => {
        message.error(err);
      }
    );
    if (summarizeText.value.trim()) {
      saveSummary(c.uuid, summarizeText.value, selectedModel.value);
      showLocalCopy.value = false;
      message.success("Summary saved locally.");
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      message.info("Summarize stopped.");
    } else {
      message.error(e instanceof Error ? e.message : "Summarize failed");
    }
  } finally {
    summarizeLoading.value = false;
    summarizeAbort.value = null;
  }
}

const n8nColumns = computed<DataTableColumns<N8nRow>>(() => [
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
  { title: "Workflow", key: "workflow", ellipsis: { tooltip: true }, minWidth: 140 },
  {
    title: "Execution",
    key: "execution_id",
    width: 120,
    ellipsis: { tooltip: true },
  },
  {
    title: "JSON",
    key: "j",
    width: 72,
    render(row) {
      return h(
        NButton,
        {
          size: "tiny",
          quaternary: true,
          onClick: () => {
            drawerTitle.value = row.id.slice(0, 8) + "…";
            drawerJson.value = JSON.stringify(row.result, null, 2);
            drawerOpen.value = true;
          },
        },
        { default: () => "View" }
      );
    },
  },
]);

onMounted(() => {
  loadLocalState();
  void loadModels();
  window.addEventListener("mousemove", onResizeMove);
  window.addEventListener("mouseup", stopResize);
});
onUnmounted(() => {
  window.removeEventListener("mousemove", onResizeMove);
  window.removeEventListener("mouseup", stopResize);
});
</script>

<template>
  <NCard>
    <template #header>
      <NSpace align="center" justify="space-between" style="width: 100%">
        <NSpace align="center" :size="8">
          <PhoneIcon :size="18" />
          <span>Cold call — n8n research</span>
        </NSpace>
        <NCheckbox v-model:checked="autoSummarize">auto-summarize</NCheckbox>
      </NSpace>
    </template>

    <NAlert v-if="modelsError" type="warning" title="Models">{{ modelsError }}</NAlert>

    <div
      class="split-layout"
      :style="{ gridTemplateColumns: `minmax(240px, ${sidebarWidthPct}%) 10px minmax(0, ${100 - sidebarWidthPct}%)` }"
    >
      <aside class="sidebar">
        <NSpace vertical size="small" style="width: 100%">
          <span class="label">Who answered? (n8n contacts only)</span>
          <NInput
            v-model:value="nameQuery"
            type="text"
            placeholder="Type name…"
            clearable
          />
          <NSpin v-if="searchLoading" size="small" />
          <NAlert v-if="searchError" type="error">{{ searchError }}</NAlert>
        </NSpace>

        <div v-if="searchHits.length > 0" class="contact-list">
          <button
            v-for="h in searchHits"
            :key="h.uuid"
            class="contact-row"
            :class="{ selected: selectedContact?.uuid === h.uuid }"
            type="button"
            @click="selectHit(h)"
          >
            <span class="row-line row-line-rich">
              <NTag v-if="h.company_name" size="small" bordered :style="companyTagStyle(h.company_name)">
                {{ h.company_name }}
              </NTag>
              <strong class="inline-name">{{ h.label }}</strong>
              <strong v-if="h.position" class="inline-position">{{ h.position }}</strong>
              <span v-if="summarizeLoading && selectedContact?.uuid === h.uuid" class="mini-loader" />
            </span>
          </button>
        </div>
        <NEmpty v-else-if="nameQuery.trim() && !searchLoading" description="No n8n contacts match" />

        <section v-if="historyEntries.length > 0 && !nameQuery.trim()" class="recent-section">
          <span class="label">Recent lookups</span>
          <div class="contact-list">
            <div
              v-for="e in historyEntries"
              :key="e.contactId + e.searchedAt"
              class="contact-row history-row"
              :class="{ selected: selectedContact?.uuid === e.contactId }"
              role="button"
              tabindex="0"
              @click="selectHistory(e)"
              @keydown.enter.prevent="selectHistory(e)"
            >
              <span class="row-line">{{ e.label }}</span>
              <NButton
                quaternary
                size="tiny"
                class="remove-recent-btn"
                title="Remove from recent"
                aria-label="Remove from recent"
                @click.stop="removeHistory(e.contactId)"
              >
                ×
              </NButton>
            </div>
          </div>
        </section>
      </aside>

      <div class="split-divider" :class="{ active: resizing }" @mousedown="startResize" />

      <main class="main-pane">
        <NCard v-if="selectedContact" size="small" :title="`Selected: ${selectedContact.label}`">
          <NSpace vertical size="medium">
            <NTabs v-model:value="activeTab" type="line" animated>
              <NTabPane name="ai_summary">
                <template #tab>
                  <span class="tab-label">
                    <span>AI summary</span>
                    <span v-if="summarizeLoading" class="mini-loader" />
                  </span>
                </template>
                <NSpace vertical size="medium">
                  <NSpace align="center" wrap>
                    <NTag size="small">{{ selectedContact.uuid }}</NTag>
                    <span class="muted">n8n rows: {{ n8nTotal }}</span>
                  </NSpace>

                  <NSpace align="center" wrap>
                    <span class="label">Model</span>
                    <NSelect
                      v-model:value="selectedModel"
                      :loading="modelsLoading"
                      :options="modelOptions"
                      filterable
                      placeholder="OpenRouter model"
                      style="min-width: 260px"
                    />
                    <NButton
                      type="primary"
                      :disabled="summarizeLoading || !selectedModel || n8nRows.length === 0"
                      @click="summarize"
                    >
                      Summarize (stream)
                    </NButton>
                    <NButton quaternary :disabled="!summarizeLoading" @click="stopSummarize">Stop</NButton>
                    <NButton
                      v-if="latestSummaryForContact && !hasLiveSummary"
                      quaternary
                      @click="showLocalCopy = !showLocalCopy"
                    >
                      {{ showLocalCopy ? "Hide local copy" : "Show local copy" }}
                    </NButton>
                  </NSpace>

                  <NAlert v-if="summarizeLoading" type="info">
                    <span class="typing-indicator">Summarizing<span class="dots" aria-hidden="true"></span></span>
                  </NAlert>

                  <NSpin v-if="summarizeLoading && !summarizeText" size="small" />

                  <NCard v-if="hasLiveSummary && summarizeText" size="small" title="Live summary">
                    <div class="summary-md" v-html="renderedLiveSummaryHtml" />
                    <div v-if="summarizeLoading" class="caret-line"><span class="typing-caret"></span></div>
                  </NCard>

                  <NCard
                    v-else-if="showLocalCopy && latestSummaryForContact"
                    size="small"
                    title="Saved summary (local copy)"
                  >
                    <p class="muted small">
                      Model: {{ latestSummaryForContact.model }} · {{ latestSummaryForContact.createdAt }}
                    </p>
                    <div class="summary-md" v-html="renderedLocalSummaryHtml" />
                  </NCard>
                </NSpace>
              </NTabPane>

              <NTabPane name="static_summary" tab="Static summary">
                <NSpace vertical size="small">
                  <div v-if="staticSummaryCards.length > 0" class="static-cards-grid">
                    <NCard v-for="c in staticSummaryCards" :key="`${c.category}-${c.title}`" size="small" class="data-card">
                      <NSpace vertical :size="6">
                        <NTag size="small" :type="c.category === 'Contact' ? 'info' : 'default'" bordered>
                          {{ c.category }}
                        </NTag>
                        <strong>{{ c.title }}</strong>
                        <p class="card-value">{{ c.value }}</p>
                      </NSpace>
                    </NCard>
                  </div>
                  <div v-if="staticSummaryNoneFields.length > 0" class="static-cards-grid">
                    <NCard
                      v-for="c in staticSummaryNoneFields"
                      :key="`none-${c.category}-${c.title}`"
                      size="small"
                      class="data-card none-card"
                    >
                      <NSpace vertical :size="6">
                        <NTag size="small" :type="c.category === 'Contact' ? 'info' : 'default'" bordered>
                          {{ c.category }}
                        </NTag>
                        <strong>{{ c.title }}</strong>
                        <p class="card-value muted">None</p>
                      </NSpace>
                    </NCard>
                  </div>
                  <NCard
                    v-if="staticSummaryCards.length === 0 && staticSummaryNoneFields.length === 0"
                    size="small"
                    title="Static summary"
                  >
                    <span class="muted">No structured fields found in current rows.</span>
                  </NCard>
                </NSpace>
              </NTabPane>

              <NTabPane name="details" tab="Details">
                <NSpace vertical size="small">
                  <NAlert v-if="n8nError" type="error">{{ n8nError }}</NAlert>
                  <NSpin v-if="n8nLoading" />
                  <NDataTable
                    v-else
                    :columns="n8nColumns"
                    :data="n8nRows"
                    size="small"
                    :max-height="420"
                    striped
                    :scroll-x="720"
                  />
                </NSpace>
              </NTabPane>
            </NTabs>
          </NSpace>
        </NCard>
        <NEmpty v-else description="Pick a contact from the left panel" />
      </main>
    </div>

    <NDrawer v-model:show="drawerOpen" :width="520" placement="right">
      <NDrawerContent :title="`Result (${drawerTitle})`" closable>
        <pre class="json-pre">{{ drawerJson }}</pre>
      </NDrawerContent>
    </NDrawer>
  </NCard>
</template>

<style scoped>
.label {
  font-size: 0.875rem;
  font-weight: 500;
}
.recent-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.muted {
  opacity: 0.7;
  font-size: 0.8rem;
}
.small {
  font-size: 0.75rem;
}
.summary-pre,
.json-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.8125rem;
  max-height: 50vh;
  overflow: auto;
}
.summary-md {
  font-size: 0.875rem;
  line-height: 1.5;
}
.summary-md :deep(p) {
  margin: 0 0 0.6rem;
}
.summary-md :deep(ul),
.summary-md :deep(ol) {
  margin: 0.25rem 0 0.75rem 1rem;
}
.summary-md :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8rem;
}
.summary-md :deep(table) {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
  margin: 0.5rem 0 0.85rem;
  font-size: 0.82rem;
  line-height: 1.35;
}
.summary-md :deep(th),
.summary-md :deep(td) {
  border: 1px solid rgba(255, 255, 255, 0.22);
  padding: 6px 8px;
  vertical-align: top;
  text-align: left;
  word-break: break-word;
}
.summary-md :deep(th) {
  background: rgba(255, 255, 255, 0.08);
  font-weight: 700;
}
.summary-md :deep(tr:nth-child(even) td) {
  background: rgba(255, 255, 255, 0.03);
}
.summary-md :deep(.table-wrap) {
  overflow-x: auto;
}
.split-layout {
  margin-top: 12px;
  display: grid;
  gap: 12px;
  align-items: start;
}
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.split-divider {
  width: 10px;
  cursor: col-resize;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  transition: background 0.15s ease;
  min-height: 60vh;
}
.split-divider:hover,
.split-divider.active {
  background: rgba(24, 160, 88, 0.45);
}
.main-pane {
  min-width: 0;
}
.contact-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.contact-row {
  text-align: left;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent;
  color: inherit;
  border-radius: 8px;
  padding: 6px 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}
.contact-row:hover {
  border-color: rgba(255, 255, 255, 0.24);
}
.contact-row.selected {
  border-color: rgba(24, 160, 88, 0.85);
  background: rgba(24, 160, 88, 0.06);
}
.row-line {
  display: inline-block;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 0.84rem;
  line-height: 1.2rem;
}
.row-line-rich {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.inline-name {
  font-weight: 700;
  white-space: nowrap;
  flex-shrink: 0;
}
.inline-position {
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.mini-loader {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: rgba(24, 160, 88, 0.95);
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}
.remove-recent-btn {
  flex-shrink: 0;
}
.history-row {
  border-color: rgba(255, 255, 255, 0.18);
}
.none-fields {
  font-size: 0.85rem;
  line-height: 1.45;
  opacity: 0.9;
}
.static-cards-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.data-card {
  border: 1px solid rgba(255, 255, 255, 0.16);
}
.none-card {
  opacity: 0.85;
}
.card-value {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.84rem;
  line-height: 1.42;
}
.typing-indicator {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.dots::after {
  content: "...";
  display: inline-block;
  width: 1.4em;
  text-align: left;
  animation: dots-typing 0.7s steps(4, end) infinite;
}
.caret-line {
  margin-top: 4px;
  height: 14px;
}
.typing-caret {
  display: inline-block;
  width: 2px;
  height: 14px;
  background: currentColor;
  animation: caret-blink 0.6s step-end infinite;
}
@keyframes dots-typing {
  0% {
    clip-path: inset(0 100% 0 0);
  }
  100% {
    clip-path: inset(0 0 0 0);
  }
}
@keyframes caret-blink {
  50% {
    opacity: 0;
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 1100px) {
  .split-layout {
    grid-template-columns: 1fr;
  }
  .split-divider {
    display: none;
  }
  .static-cards-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 1700px) {
  .static-cards-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 1450px) {
  .row-line {
    font-size: 0.82rem;
  }
}
</style>
