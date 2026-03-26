<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  h,
  onMounted,
  onUnmounted,
  inject,
  nextTick,
  type Ref,
} from "vue";
import {
  NCard,
  NDataTable,
  NTabs,
  NTabPane,
  NButton,
  NSpace,
  NAlert,
  NEmpty,
  NModal,
  NSpin,
  NTag,
  NPagination,
  NSelect,
  NInput,
  NInputNumber,
  NSwitch,
  NPopconfirm,
  NDrawer,
  NDrawerContent,
  useMessage,
} from "naive-ui";
import type { DataTableColumns, DataTableRowKey, SelectOption } from "naive-ui";
import { useIntervalFn } from "@vueuse/core";
import { PlayIcon, PencilIcon, RefreshCwIcon, ClockIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";
import {
  useEnrichmentRealtime,
  type EnrichmentDataPayload,
  type EnrichmentBatchStartedPayload,
} from "../composables/useEnrichmentRealtime";
import {
  fetchEnrichmentBatchDetail,
  type EnrichmentBatchDetailBatch,
  type EnrichmentBatchDetailRun,
} from "../composables/useEnrichmentBatchDetail";
import type { WorkerEntry } from "../composables/useWorkers";
import {
  COMPANY_BASE_KEYS,
  CONTACT_BASE_KEYS,
  formatCellValue,
  parseEnrichmentEntityType,
  resolvePromptPlaceholders,
  resolvePromptSegments,
  resolvePromptSegmentsBatch,
  type ResolvePromptForBatchOptions,
} from "@mcp/prompt-resolver";

type EntityTab = "company" | "contact";

type EnrichmentAgentCellStatus = "planned" | "queued" | "running" | "success" | "error";

type EnrichmentRunPhase = "batch_wait" | "working";

interface EnrichmentAgentCellState {
  status: EnrichmentAgentCellStatus;
  updatedAt: string | null;
  error?: string | null;
  resultPreview?: unknown;
  workerName?: string | null;
  /** When status is `running`: batch accumulator vs. executing agent. */
  runPhase?: EnrichmentRunPhase;
  runId?: string | null;
  batchId?: string | null;
}

interface EnrichmentRunStats {
  totalRuns: number;
  runsSuccess: number;
  runsError: number;
  runsRunning: number;
  queueQueued: number;
  queueRunning: number;
  errorSamples: string[];
}

interface EnrichmentTableRow {
  entity: Record<string, unknown>;
  agentStates: Record<string, EnrichmentAgentCellState>;
  runStats: EnrichmentRunStats;
}

interface EnrichmentAgentInfo {
  name: string;
  entity_type: string;
  operation_name: string | null;
  prompt?: string;
  batch_size?: number;
  is_active: boolean;
}

interface EnrichmentAgentRegistryRow {
  name: string;
  entity_type: string;
  operation_name: string | null;
  prompt: string;
  batch_size: number;
  is_active: boolean;
  created_at: string;
}

const projectStore = useProjectStore();
const message = useMessage();

/** Shared with App.vue (single workers WebSocket). */
const enrichmentWorkers = inject<Ref<WorkerEntry[]>>(
  "workersRegistry",
  ref<WorkerEntry[]>([])
);

const activeTab = ref<EntityTab>("company");
const checkedRowKeys = ref<DataTableRowKey[]>([]);

const agents = ref<EnrichmentAgentInfo[]>([]);
const agentsLoading = ref(false);
const agentsError = ref("");

const enqueueAgentName = ref<string | null>(null);
const enqueueOperationName = ref("");
const enqueueLoading = ref(false);

/** Per-cell POST /api/enrichment/enqueue (Run / Rerun). */
const cellEnqueueLoading = ref<Record<string, boolean>>({});

function cellEnqueueKey(row: EnrichmentTableRow, agentName: string): string {
  return `${rowKey(row)}::${agentName}`;
}

const manageAgentsOpen = ref(false);
const registryRows = ref<EnrichmentAgentRegistryRow[]>([]);
const registryLoading = ref(false);
const registryError = ref("");
const updatingAgentName = ref<string | null>(null);

type AgentModalMode = "create" | "edit";
const agentModalOpen = ref(false);
const agentModalMode = ref<AgentModalMode>("create");
const agentFormName = ref("");
const agentFormEntityType = ref<"company" | "contact" | "both">("company");
const agentFormOperation = ref("");
const agentFormPrompt = ref("");
const agentFormBatchSize = ref<number | null>(1);
const agentFormActive = ref(true);
const savingAgent = ref(false);

const promptDrawerOpen = ref(false);
const promptDrawerAgentName = ref("");
const promptDrawerText = ref("");
const promptDrawerSaving = ref(false);
const promptDrawerPreviewOpen = ref(false);
const promptDrawerPreviewRowIdx = ref(0);

/** DB-backed prefix/suffix + `{{companies}}` JSON (per project override). */
const promptSettingsOpen = ref(false);
const promptSettingsLoading = ref(false);
const promptSettingsSaving = ref(false);
const promptSettingsError = ref("");
const promptSettingsPrefix = ref("");
const promptSettingsSuffix = ref("");
const promptSettingsConfigText = ref("{}");
/** Map of profile key -> partial overlay (matches `enrichment_prompt_settings.prompt_profiles`). */
const promptSettingsProfilesText = ref("{}");

/** Server-side resolved prompt (matches worker pipeline for company batches). */
const serverPromptPreviewText = ref("");
const serverPromptPreviewLoading = ref(false);
const serverPromptPreviewError = ref("");
/** Simulates `ENRICHMENT_SYSTEM_PROMPT_TYPE` for POST /api/enrichment/prompt-preview. */
const serverPromptPreviewProfile = ref("");

const promptTextareaRef = ref<HTMLTextAreaElement | null>(null);
const promptTextareaWrapRef = ref<HTMLDivElement | null>(null);
const promptAcListRef = ref<HTMLDivElement | null>(null);
const promptAutocompleteOpen = ref(false);
const promptAutocompleteItems = ref<{ label: string; insert: string }[]>([]);
const promptAutocompleteActive = ref(0);
/** Index of `{{` in `promptDrawerText` for the active autocomplete span. */
const promptAutocompleteAnchor = ref(-1);
/** Pixel position of the autocomplete panel relative to `.prompt-drawer-textarea-wrap`. */
const promptAutocompletePos = ref({ top: 0, left: 0 });
/** When this changes, reset active index to 0 (typing); unchanged for ArrowUp/Down. */
const promptAutocompleteSig = ref("");

/** Port of `textarea-caret-position` (MIT) — caret pixel offset inside the textarea box. */
function getTextareaCaretCoordinates(
  element: HTMLTextAreaElement,
  position: number
): { top: number; left: number; height: number } {
  const div = document.createElement("div");
  document.body.appendChild(div);

  const style = div.style;
  const computed = window.getComputedStyle(element);

  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  style.position = "absolute";
  style.visibility = "hidden";
  style.overflow = "hidden";

  const properties = [
    "direction",
    "boxSizing",
    "width",
    "height",
    "overflowX",
    "overflowY",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "borderStyle",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "fontStretch",
    "fontSize",
    "fontSizeAdjust",
    "lineHeight",
    "fontFamily",
    "textAlign",
    "textTransform",
    "textIndent",
    "textDecoration",
    "letterSpacing",
    "wordSpacing",
    "tabSize",
    "MozTabSize",
  ] as const;

  for (const prop of properties) {
    style.setProperty(prop, computed.getPropertyValue(prop));
  }

  const isFirefox =
    typeof window !== "undefined" &&
    (window as Window & { mozInnerScreenX?: number }).mozInnerScreenX != null;
  if (isFirefox) {
    if (element.scrollHeight > parseInt(computed.height || "0", 10)) {
      style.overflowY = "scroll";
    }
  } else {
    style.overflow = "hidden";
  }

  div.textContent = element.value.substring(0, position);
  const span = document.createElement("span");
  span.textContent = element.value.substring(position) || ".";
  div.appendChild(span);

  const top = span.offsetTop + parseInt(computed.borderTopWidth || "0", 10);
  const left = span.offsetLeft + parseInt(computed.borderLeftWidth || "0", 10);
  const lh = computed.lineHeight;
  let height = parseFloat(lh);
  if (!Number.isFinite(height) || height <= 0) {
    const fs = parseFloat(computed.fontSize || "16");
    height = Number.isFinite(fs) ? fs * 1.25 : 16;
  }

  document.body.removeChild(div);
  return { top, left, height };
}

function updatePromptAutocompletePosition() {
  const ta = promptTextareaRef.value;
  const wrap = promptTextareaWrapRef.value;
  if (!ta || !wrap || !promptAutocompleteOpen.value) return;
  const caretPos = ta.selectionStart ?? 0;
  const coords = getTextareaCaretCoordinates(ta, caretPos);
  const taRect = ta.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const gap = 4;
  let left = taRect.left - wrapRect.left + coords.left - ta.scrollLeft;
  let top = taRect.top - wrapRect.top + coords.top - ta.scrollTop + coords.height + gap;

  const wrapW = wrap.clientWidth;
  const maxW = Math.min(320, wrapW - 8);
  if (left + maxW > wrapW - 4) {
    left = Math.max(0, wrapW - maxW - 4);
  }
  left = Math.max(0, left);
  top = Math.max(0, top);

  promptAutocompletePos.value = { top, left };
}

const entityTypeOptions: SelectOption[] = [
  { label: "Company", value: "company" },
  { label: "Contact", value: "contact" },
  { label: "Both", value: "both" },
];

const agentSelectOptions = computed<SelectOption[]>(() =>
  agents.value.map((a) => ({
    label: `${a.name} (${a.entity_type})`,
    value: a.name,
  }))
);

const rows = ref<EnrichmentTableRow[]>([]);
const total = ref(0);
const agentNames = ref<string[]>([]);
const tableLoading = ref(false);
const tableError = ref("");

const page = ref(1);
const pageSize = ref(25);
const PAGE_SIZES = [10, 25, 50, 100];

/** Tasks held in worker memory waiting to form a batch (sum across all workers). */
const workerBatchBufferCount = computed(() =>
  enrichmentWorkers.value.reduce(
    (sum, w) => sum + w.pendingBatches.reduce((s, p) => s + p.count, 0),
    0
  )
);

/** Tooltip: per-agent buffer vs target batch size from workers. */
const workerBatchBufferDetail = computed(() => {
  const parts: string[] = [];
  for (const w of enrichmentWorkers.value) {
    for (const p of w.pendingBatches) {
      parts.push(`${p.agentName}: ${p.count}/${p.batchSize}`);
    }
  }
  return parts.join(" · ");
});

/** Configured agent batch sizes (DB) for agents on this tab. */
const agentBatchSizeSummary = computed(() => {
  const sizes = agents.value.map((a) => Math.max(1, Number(a.batch_size) || 1));
  if (sizes.length === 0) return "";
  const uniq = [...new Set(sizes)].sort((a, b) => a - b);
  if (uniq.length === 1) return String(uniq[0]);
  return uniq.join(" · ");
});

const POLL_MS = 8000;
const { pause: pausePoll, resume: resumePoll } = useIntervalFn(
  () => {
    void fetchTable(false);
  },
  POLL_MS,
  { immediate: false }
);

const detailOpen = ref(false);
const detailTitle = ref("");
const detailBody = ref("");
const detailBatchId = ref<string | null>(null);
const detailRunId = ref<string | null>(null);

function openDetail(
  title: string,
  body: string,
  opts?: { batchId?: string | null; runId?: string | null }
) {
  detailTitle.value = title;
  detailBody.value = body;
  detailBatchId.value = opts?.batchId ?? null;
  detailRunId.value = opts?.runId ?? null;
  detailOpen.value = true;
}

const batchDetailOpen = ref(false);
const batchDetailLoading = ref(false);
const batchDetailError = ref("");
const batchDetailBatch = ref<EnrichmentBatchDetailBatch | null>(null);
const batchDetailRuns = ref<EnrichmentBatchDetailRun[]>([]);

const batchRowDetailOpen = ref(false);
const batchRowDetailTitle = ref("");
const batchRowDetailBody = ref("");

function openBatchRowDetail(title: string, body: string) {
  batchRowDetailTitle.value = title;
  batchRowDetailBody.value = body;
  batchRowDetailOpen.value = true;
}

function entityLabelBatchRow(r: EnrichmentBatchDetailRun): string {
  if (r.company_id) return `company ${r.company_id.slice(0, 8)}…`;
  if (r.contact_id) return `contact ${r.contact_id.slice(0, 8)}…`;
  return "—";
}

function batchRunStatusTagType(
  status: string
): "default" | "info" | "success" | "warning" | "error" {
  switch (status) {
    case "running":
      return "info";
    case "success":
      return "success";
    case "error":
      return "error";
    default:
      return "default";
  }
}

const batchDetailColumns = computed<DataTableColumns<EnrichmentBatchDetailRun>>(() => [
  {
    title: "Entity",
    key: "entity",
    width: 200,
    ellipsis: { tooltip: true },
    render: (row) => entityLabelBatchRow(row),
  },
  {
    title: "Status",
    key: "status",
    width: 96,
    render: (row) =>
      h(
        NTag,
        { size: "small", type: batchRunStatusTagType(row.status), bordered: false },
        () => row.status
      ),
  },
  {
    title: "Error",
    key: "error",
    ellipsis: { tooltip: true },
    render: (row) => row.error?.trim() || "—",
  },
  {
    title: "",
    key: "actions",
    width: 120,
    render: (row) =>
      h(
        NButton,
        {
          size: "tiny",
          quaternary: true,
          disabled: row.status !== "success" && row.status !== "error",
          onClick: () => {
            if (row.status === "success") {
              const raw = row.resultPreview;
              const text =
                raw === undefined
                  ? "(no result)"
                  : typeof raw === "string"
                    ? raw
                    : JSON.stringify(raw, null, 2);
              openBatchRowDetail(`Result · ${entityLabelBatchRow(row)}`, text);
            } else if (row.status === "error") {
              openBatchRowDetail(`Error · ${entityLabelBatchRow(row)}`, row.error ?? "(no message)");
            }
          },
        },
        { default: () => (row.status === "success" ? "View result" : row.status === "error" ? "View error" : "—") }
      ),
  },
]);

async function openBatchDetailModal(batchId: string) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId || !batchId) return;
  batchDetailOpen.value = true;
  batchDetailLoading.value = true;
  batchDetailError.value = "";
  batchDetailBatch.value = null;
  batchDetailRuns.value = [];
  try {
    const data = await fetchEnrichmentBatchDetail(projectId, batchId);
    batchDetailBatch.value = data.batch;
    batchDetailRuns.value = data.runs;
  } catch (e) {
    batchDetailError.value = e instanceof Error ? e.message : "Failed to load batch";
  } finally {
    batchDetailLoading.value = false;
  }
}

interface PromptPlaceholderItem {
  label: string;
  /** Inner token (inside `{{ }}`), e.g. `name` or `agent:OtherAgent.summary`. */
  insert: string;
}

const promptDrawerBatchSize = computed(() => {
  const n = promptDrawerAgentName.value;
  const a = agents.value.find((x) => x.name === n);
  return Math.max(1, Number(a?.batch_size) || 1);
});

/** Rows included in batch prompt preview (first N on page, capped by batch size). */
const promptBatchPreviewRowCount = computed(() =>
  Math.min(promptDrawerBatchSize.value, rows.value.length)
);

const PROMPT_TOKEN_COMPANIES = "{{companies}}";
const PROMPT_TOKEN_CONTACTS = "{{contacts}}";

/** Entity fields + `agent:name.key` from other agents’ `resultPreview` (current page). */
const availablePlaceholders = computed<PromptPlaceholderItem[]>(() => {
  const currentAgent = promptDrawerAgentName.value;
  const bs = promptDrawerBatchSize.value;

  if (bs > 1) {
    const agentInfo = agents.value.find((a) => a.name === currentAgent);
    const et = parseEnrichmentEntityType(agentInfo?.entity_type ?? activeTab.value);
    const items: PromptPlaceholderItem[] = [];
    if (et === "company" || et === "both") {
      items.push({ label: "All companies in batch (CSV table)", insert: "companies" });
    }
    if (et === "contact" || et === "both") {
      items.push({ label: "All contacts in batch (CSV table)", insert: "contacts" });
    }
    return items;
  }

  const base = activeTab.value === "company" ? COMPANY_BASE_KEYS : CONTACT_BASE_KEYS;
  const entityKeys = new Set<string>([...base]);
  for (const row of rows.value) {
    for (const k of Object.keys(row.entity ?? {})) {
      entityKeys.add(k);
    }
  }
  const items: PromptPlaceholderItem[] = [];
  for (const k of [...entityKeys].sort()) {
    items.push({ label: k, insert: k });
  }
  const others = agentNames.value.filter((n) => n !== currentAgent);
  for (const an of others) {
    const keySet = new Set<string>();
    for (const row of rows.value) {
      const rp = row.agentStates[an]?.resultPreview;
      if (rp && typeof rp === "object" && !Array.isArray(rp)) {
        for (const key of Object.keys(rp as Record<string, unknown>)) {
          keySet.add(key);
        }
      }
    }
    for (const k of [...keySet].sort()) {
      const insert = `agent:${an}.${k}`;
      items.push({ label: `${an} → ${k}`, insert });
    }
  }
  return items;
});

function rowLabelForPreview(row: EnrichmentTableRow): string {
  if (activeTab.value === "company") {
    const n = row.entity.name;
    const d = row.entity.domain;
    if (typeof n === "string" && n.trim()) {
      return typeof d === "string" && d.trim() ? `${n} (${d})` : n;
    }
    if (typeof d === "string" && d.trim()) return d;
    return "Company";
  }
  const fn = row.entity.first_name;
  const ln = row.entity.last_name;
  const parts = [fn, ln].filter((x) => typeof x === "string" && String(x).trim());
  return parts.length ? parts.join(" ") : "Contact";
}

const promptPreviewRowOptions = computed<SelectOption[]>(() =>
  rows.value.map((row, idx) => ({
    label: `${rowLabelForPreview(row)} · ${idx + 1}`,
    value: idx,
  }))
);

function buildAgentResultsMap(row: EnrichmentTableRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of agentNames.value) {
    const rp = row.agentStates[name]?.resultPreview;
    if (rp !== undefined && rp !== null) {
      out[name] = rp;
    }
  }
  return out;
}

/** `enrichment_agents.entity_type` for the drawer agent (drives `{{companies}}` / `{{contacts}}` like the worker). */
const promptDrawerEntityType = computed(() => {
  const a = agents.value.find((x) => x.name === promptDrawerAgentName.value);
  return parseEnrichmentEntityType(a?.entity_type);
});

interface PromptPreviewBlock {
  heading: string;
  segments: Array<{ resolved: boolean; text: string }>;
}

const promptPreviewBlocks = computed((): PromptPreviewBlock[] => {
  const prompt = promptDrawerText.value;
  const bs = promptDrawerBatchSize.value;

  if (rows.value.length === 0) return [];

  if (bs <= 1) {
    const row = rows.value[promptDrawerPreviewRowIdx.value];
    if (!row) return [];
    return [
      {
        heading: "",
        segments: resolvePromptSegments(prompt, row.entity, buildAgentResultsMap(row)),
      },
    ];
  }

  const n = Math.min(bs, rows.value.length);
  const batchRows = rows.value.slice(0, n);
  const heading = `Preview: first ${n} row(s) on this page (batch size ${bs})`;
  const entities = batchRows.map((row, i) => ({
    id: String(rowKey(row) ?? i),
    data: row.entity as Record<string, unknown>,
  }));
  const first = batchRows[0];
  const options: ResolvePromptForBatchOptions = {
    batchSize: bs,
    entityType: promptDrawerEntityType.value,
    rowKind: activeTab.value,
    agentResultsByAgentName: first ? buildAgentResultsMap(first) : {},
  };
  return [{ heading, segments: resolvePromptSegmentsBatch(prompt, entities, options) }];
});

/** Plain resolved string for tooltip (single-row preview). */
const promptDrawerPreviewPlainTitle = computed(() => {
  if (promptDrawerBatchSize.value > 1 || rows.value.length === 0) return "";
  const r = rows.value[promptDrawerPreviewRowIdx.value];
  if (!r) return "";
  return resolvePromptPlaceholders(promptDrawerText.value, r.entity, buildAgentResultsMap(r));
});

function updatePromptAutocomplete() {
  const ta = promptTextareaRef.value;
  if (!ta) return;
  const val = ta.value;
  const pos = ta.selectionStart ?? 0;
  const before = val.slice(0, pos);
  const openIdx = before.lastIndexOf("{{");
  if (openIdx === -1) {
    promptAutocompleteOpen.value = false;
    return;
  }
  const afterOpen = before.slice(openIdx + 2);
  if (afterOpen.includes("}}")) {
    promptAutocompleteOpen.value = false;
    return;
  }
  const partial = afterOpen;
  const p = partial.toLowerCase();
  const pool = availablePlaceholders.value;
  const filtered = pool.filter(
    (it) =>
      it.insert.toLowerCase().startsWith(p) ||
      it.label.toLowerCase().includes(p)
  );
  if (filtered.length === 0) {
    promptAutocompleteOpen.value = false;
    return;
  }
  const nextSig = `${openIdx}:${partial}`;
  if (nextSig !== promptAutocompleteSig.value) {
    promptAutocompleteSig.value = nextSig;
    promptAutocompleteActive.value = 0;
  }
  promptAutocompleteItems.value = filtered.slice(0, 40);
  promptAutocompleteAnchor.value = openIdx;
  promptAutocompleteOpen.value = true;
  nextTick(() => updatePromptAutocompletePosition());
}

function onPromptTextareaInput(e: Event) {
  const ta = e.target as HTMLTextAreaElement;
  promptDrawerText.value = ta.value;
  updatePromptAutocomplete();
}

function applyPromptAutocompleteChoice(index: number) {
  const ta = promptTextareaRef.value;
  const items = promptAutocompleteItems.value;
  if (!ta || !items[index]) return;
  const choice = items[index];
  const val = ta.value;
  const pos = ta.selectionStart ?? 0;
  const start = promptAutocompleteAnchor.value;
  if (start < 0) return;
  const insertion = `{{${choice.insert}}}`;
  const newVal = val.slice(0, start) + insertion + val.slice(pos);
  promptDrawerText.value = newVal;
  promptAutocompleteOpen.value = false;
  promptAutocompleteAnchor.value = -1;
  promptAutocompleteSig.value = "";
  const newPos = start + insertion.length;
  nextTick(() => {
    ta.focus();
    ta.setSelectionRange(newPos, newPos);
  });
}

function onPromptTextareaKeydown(e: KeyboardEvent) {
  if (!promptAutocompleteOpen.value || !promptAutocompleteItems.value.length) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation();
    const n = promptAutocompleteItems.value.length;
    promptAutocompleteActive.value = (promptAutocompleteActive.value + 1) % n;
    nextTick(() => updatePromptAutocompletePosition());
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    e.stopPropagation();
    const n = promptAutocompleteItems.value.length;
    promptAutocompleteActive.value = (promptAutocompleteActive.value - 1 + n) % n;
    nextTick(() => updatePromptAutocompletePosition());
  } else if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    applyPromptAutocompleteChoice(promptAutocompleteActive.value);
  } else if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    promptAutocompleteOpen.value = false;
  }
}

function onPromptTextareaKeyup(e: KeyboardEvent) {
  if (!promptAutocompleteOpen.value || !promptAutocompleteItems.value.length) {
    updatePromptAutocomplete();
    return;
  }
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    updatePromptAutocompletePosition();
    return;
  }
  updatePromptAutocomplete();
}

let promptAcBlurTimer: ReturnType<typeof setTimeout> | undefined;
function onPromptTextareaBlur() {
  if (promptAcBlurTimer) clearTimeout(promptAcBlurTimer);
  promptAcBlurTimer = setTimeout(() => {
    promptAutocompleteOpen.value = false;
    promptAcBlurTimer = undefined;
  }, 180);
}

watch([promptAutocompleteActive, promptAutocompleteOpen], () => {
  if (!promptAutocompleteOpen.value) return;
  nextTick(() => {
    const el = promptAcListRef.value?.querySelector(
      ".prompt-drawer-ac__item--active"
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  });
});

function columnTitle(key: string): string {
  const map: Record<string, string> = {
    company_id: "Company ID",
    project_company_id: "Project company link",
    contact_count: "Contacts",
    linkedin_url: "LinkedIn",
    work_email: "Work email",
    personal_email: "Personal email",
    connections_number: "Connections",
    uuid: "Contact ID",
    contacts_preview: "Contacts preview",
    hypotheses: "Hypotheses",
  };
  return map[key] ?? key.replace(/_/g, " ");
}

function rowKey(row: EnrichmentTableRow): string {
  const e = row.entity;
  if (activeTab.value === "company") {
    const id = e.company_id;
    return typeof id === "string" ? id : String(id ?? "");
  }
  const id = e.uuid ?? e.id;
  return typeof id === "string" ? id : String(id ?? "");
}

/** Row is busy if any agent is queued or running (checkbox disabled). */
function rowEnrichmentInProgress(row: EnrichmentTableRow): boolean {
  for (const st of Object.values(row.agentStates)) {
    if (st.status === "queued" || st.status === "running") return true;
  }
  return false;
}

function pruneCheckedRowKeys() {
  const byKey = new Map(rows.value.map((r) => [rowKey(r), r]));
  checkedRowKeys.value = checkedRowKeys.value.filter((k) => {
    const row = byKey.get(String(k));
    if (!row) return false;
    return !rowEnrichmentInProgress(row);
  });
}

/** Row ids on the current page that can be enqueued (same rules as row checkboxes). */
const enqueueableRowIdsOnPage = computed(() =>
  rows.value.filter((r) => !rowEnrichmentInProgress(r)).map((r) => rowKey(r))
);

async function fetchAgents() {
  if (!projectStore.selectedProjectId) return;
  agentsLoading.value = true;
  agentsError.value = "";
  try {
    const r = await fetch(`/api/enrichment/agents?entityType=${encodeURIComponent(activeTab.value)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to load agents");
    agents.value = (j.data ?? []) as EnrichmentAgentInfo[];
  } catch (e) {
    agents.value = [];
    agentsError.value = e instanceof Error ? e.message : "Failed to load agents";
  } finally {
    agentsLoading.value = false;
  }
}

watch(agents, (list) => {
  if (enqueueAgentName.value && !list.some((a) => a.name === enqueueAgentName.value)) {
    enqueueAgentName.value = null;
  }
});

async function fetchRegistry() {
  registryLoading.value = true;
  registryError.value = "";
  try {
    const r = await fetch("/api/enrichment/agents/registry");
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to load agents registry");
    registryRows.value = (j.data ?? []) as EnrichmentAgentRegistryRow[];
  } catch (e) {
    registryRows.value = [];
    registryError.value = e instanceof Error ? e.message : "Failed to load registry";
  } finally {
    registryLoading.value = false;
  }
}

async function openManageAgents() {
  manageAgentsOpen.value = true;
  await fetchRegistry();
}

function resetAgentForm() {
  agentFormName.value = "";
  agentFormEntityType.value = "company";
  agentFormOperation.value = "";
  agentFormPrompt.value = "";
  agentFormBatchSize.value = 1;
  agentFormActive.value = true;
}

function openCreateAgentModal() {
  agentModalMode.value = "create";
  resetAgentForm();
  agentModalOpen.value = true;
}

function openEditAgentModal(row: EnrichmentAgentRegistryRow) {
  agentModalMode.value = "edit";
  agentFormName.value = row.name;
  agentFormEntityType.value = row.entity_type as "company" | "contact" | "both";
  agentFormOperation.value = row.operation_name ?? "";
  agentFormPrompt.value = row.prompt ?? "";
  agentFormBatchSize.value = Math.max(1, Number(row.batch_size) || 1);
  agentFormActive.value = row.is_active;
  agentModalOpen.value = true;
}

function openPromptDrawer(name: string) {
  const reg = registryRows.value.find((r) => r.name === name);
  const info = agents.value.find((a) => a.name === name);
  promptDrawerAgentName.value = name;
  promptDrawerText.value = reg?.prompt ?? info?.prompt ?? "";
  promptDrawerPreviewOpen.value = false;
  promptDrawerPreviewRowIdx.value = 0;
  promptAutocompleteOpen.value = false;
  promptAutocompleteAnchor.value = -1;
  promptAutocompleteSig.value = "";
  serverPromptPreviewText.value = "";
  serverPromptPreviewError.value = "";
  promptDrawerOpen.value = true;
}

/** GET /api/enrichment/prompt-settings returns the project row; older responses nested it under `{ data }`. */
function promptProfilesFromProjectRowPayload(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") return {};
  const o = row as Record<string, unknown>;
  const direct = o.prompt_profiles;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }
  const inner = o.data;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const d = inner as Record<string, unknown>;
    const nested = d.prompt_profiles;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
  }
  return {};
}

async function loadPromptSettings() {
  const pid = projectStore.selectedProjectId;
  if (!pid) return;
  promptSettingsLoading.value = true;
  promptSettingsError.value = "";
  try {
    const r = await fetch(
      `/api/enrichment/prompt-settings?projectId=${encodeURIComponent(pid)}`
    );
    const j = (await r.json()) as {
      error?: string;
      effective?: {
        global_prompt_prefix?: string;
        global_prompt_suffix?: string;
        companies_placeholder_config?: Record<string, unknown>;
      };
      projectRow?: unknown;
    };
    if (!r.ok) throw new Error(j.error ?? "Failed to load prompt settings");
    const eff = j.effective;
    promptSettingsPrefix.value = eff?.global_prompt_prefix ?? "";
    promptSettingsSuffix.value = eff?.global_prompt_suffix ?? "";
    promptSettingsConfigText.value = JSON.stringify(
      eff?.companies_placeholder_config ?? {},
      null,
      2
    );
    promptSettingsProfilesText.value = JSON.stringify(
      promptProfilesFromProjectRowPayload(j.projectRow),
      null,
      2
    );
  } catch (e) {
    promptSettingsError.value = e instanceof Error ? e.message : "Load failed";
  } finally {
    promptSettingsLoading.value = false;
  }
}

function openPromptSettingsModal() {
  promptSettingsOpen.value = true;
  void loadPromptSettings();
}

async function savePromptSettings() {
  const pid = projectStore.selectedProjectId;
  if (!pid) return;
  let config: Record<string, unknown>;
  let profiles: Record<string, unknown>;
  try {
    const parsed = JSON.parse(promptSettingsConfigText.value || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("companies_placeholder_config must be a JSON object");
    }
    config = parsed as Record<string, unknown>;
    const pr = JSON.parse(promptSettingsProfilesText.value || "{}") as unknown;
    if (!pr || typeof pr !== "object" || Array.isArray(pr)) {
      throw new Error("prompt_profiles must be a JSON object");
    }
    profiles = pr as Record<string, unknown>;
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Invalid JSON");
    return;
  }
  promptSettingsSaving.value = true;
  promptSettingsError.value = "";
  try {
    const r = await fetch("/api/enrichment/prompt-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: pid,
        global_prompt_prefix: promptSettingsPrefix.value,
        global_prompt_suffix: promptSettingsSuffix.value,
        companies_placeholder_config: config,
        prompt_profiles: profiles,
      }),
    });
    const j = (await r.json()) as { error?: string };
    if (!r.ok) throw new Error(j.error ?? "Save failed");
    message.success("Prompt settings saved");
    promptSettingsOpen.value = false;
  } catch (e) {
    promptSettingsError.value = e instanceof Error ? e.message : "Save failed";
  } finally {
    promptSettingsSaving.value = false;
  }
}

async function fetchServerPromptPreview() {
  const pid = projectStore.selectedProjectId;
  if (!pid || activeTab.value !== "company") {
    message.warning("Server preview needs a project and the company tab.");
    return;
  }
  if (!promptDrawerAgentName.value) return;
  const n = Math.min(promptDrawerBatchSize.value, rows.value.length);
  const companyIds = rows.value
    .slice(0, n)
    .map((r) => r.entity.company_id as string | undefined)
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  if (companyIds.length === 0) {
    message.warning("No company rows to preview.");
    return;
  }
  serverPromptPreviewLoading.value = true;
  serverPromptPreviewError.value = "";
  serverPromptPreviewText.value = "";
  try {
    const r = await fetch("/api/enrichment/prompt-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: pid,
        prompt: promptDrawerText.value,
        batchSize: promptDrawerBatchSize.value,
        agentName: promptDrawerAgentName.value,
        companyIds,
        rowKind: "company",
        systemPromptType: serverPromptPreviewProfile.value.trim() || undefined,
      }),
    });
    const j = (await r.json()) as { error?: string; finalPrompt?: string };
    if (!r.ok) throw new Error(j.error ?? "Preview failed");
    serverPromptPreviewText.value = j.finalPrompt ?? "";
  } catch (e) {
    serverPromptPreviewError.value = e instanceof Error ? e.message : "Preview failed";
  } finally {
    serverPromptPreviewLoading.value = false;
  }
}

async function savePromptDrawer() {
  const name = promptDrawerAgentName.value.trim();
  if (!name) {
    message.warning("No agent selected.");
    return;
  }
  promptDrawerSaving.value = true;
  try {
    const r = await fetch("/api/enrichment/agents/registry", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, prompt: promptDrawerText.value }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Update failed");
    const prompt = promptDrawerText.value;
    const ai = agents.value.findIndex((a) => a.name === name);
    if (ai >= 0) {
      agents.value[ai] = { ...agents.value[ai], prompt };
    }
    const ri = registryRows.value.findIndex((row) => row.name === name);
    if (ri >= 0) {
      registryRows.value[ri] = { ...registryRows.value[ri], prompt };
    }
    message.success("Prompt saved.");
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Save failed");
  } finally {
    promptDrawerSaving.value = false;
  }
}

function truncatePromptText(s: string, max = 56): string {
  const t = s?.trim() ?? "";
  if (!t) return "—";
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

async function submitAgentModal() {
  const name = agentFormName.value.trim();
  if (!name) {
    message.warning("Agent name is required.");
    return;
  }
  const bs = agentFormBatchSize.value;
  const batchSize = typeof bs === "number" && Number.isFinite(bs) ? Math.floor(bs) : 1;
  if (batchSize < 1) {
    message.warning("Batch size must be at least 1.");
    return;
  }
  savingAgent.value = true;
  try {
    const payload = {
      name,
      entity_type: agentFormEntityType.value,
      operation_name: agentFormOperation.value.trim() || null,
      prompt: agentFormPrompt.value,
      batch_size: batchSize,
      is_active: agentFormActive.value,
    };
    const isCreate = agentModalMode.value === "create";
    const r = await fetch("/api/enrichment/agents/registry", {
      method: isCreate ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? (isCreate ? "Create failed" : "Update failed"));
    message.success(isCreate ? "Agent created." : "Agent updated.");
    agentModalOpen.value = false;
    await fetchRegistry();
    await fetchAgents();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Save failed");
  } finally {
    savingAgent.value = false;
  }
}

async function setRegistryAgentActive(row: EnrichmentAgentRegistryRow, isActive: boolean) {
  if (isActive === row.is_active) return;
  updatingAgentName.value = row.name;
  try {
    const r = await fetch("/api/enrichment/agents/registry", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: row.name, is_active: isActive }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Update failed");
    row.is_active = isActive;
    message.success("Agent updated.");
    await fetchAgents();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Update failed");
    await fetchRegistry();
  } finally {
    updatingAgentName.value = null;
  }
}

async function enqueueForIds(ids: string[]) {
  const projectId = projectStore.selectedProjectId;
  const agent = enqueueAgentName.value?.trim();
  if (!projectId || !agent) {
    message.warning("Select an agent.");
    return;
  }
  const filtered = ids.map((k) => String(k)).filter(Boolean);
  if (filtered.length === 0) {
    message.warning("No rows to enqueue.");
    return;
  }
  enqueueLoading.value = true;
  try {
    const body: Record<string, unknown> = {
      projectId,
      entityType: activeTab.value,
      agentName: agent,
    };
    if (activeTab.value === "company") body.companyIds = filtered;
    else body.contactIds = filtered;
    const op = enqueueOperationName.value.trim();
    if (op) body.operationName = op;
    const r = await fetch("/api/enrichment/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Enqueue failed");
    const n = Number(j.inserted ?? 0);
    message.success(`Queued ${n} task(s).`);
    checkedRowKeys.value = [];
    await fetchTable(false);
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Enqueue failed");
  } finally {
    enqueueLoading.value = false;
  }
}

async function enqueueSelected() {
  await enqueueForIds(checkedRowKeys.value.map((k) => String(k)));
}

/** Per-agent header "run all on page" loading state. */
const headerEnqueueLoading = ref<Record<string, boolean>>({});

/** Staggered row wave after header “run all on page” succeeds. */
const rowWaveActive = ref(false);
const ROW_WAVE_STAGGER_MS = 42;
const ROW_WAVE_DURATION_MS = 520;
let rowWaveClearTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleRowWaveAfterHeaderRun() {
  if (rowWaveClearTimer) {
    clearTimeout(rowWaveClearTimer);
    rowWaveClearTimer = undefined;
  }
  rowWaveActive.value = true;
  const n = rows.value.length;
  const totalMs = Math.min(n * ROW_WAVE_STAGGER_MS + ROW_WAVE_DURATION_MS + 100, 4500);
  rowWaveClearTimer = setTimeout(() => {
    rowWaveActive.value = false;
    rowWaveClearTimer = undefined;
  }, totalMs);
}

async function enqueueForAgentAllOnPage(agentName: string) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) {
    message.warning("Select a project.");
    return;
  }
  const name = agentName.trim();
  if (!name) return;
  const ids = enqueueableRowIdsOnPage.value;
  if (ids.length === 0) {
    message.warning("No rows to enqueue.");
    return;
  }
  headerEnqueueLoading.value = { ...headerEnqueueLoading.value, [name]: true };
  try {
    const op = agents.value.find((a) => a.name === name)?.operation_name?.trim();
    const body: Record<string, unknown> = {
      projectId,
      entityType: activeTab.value,
      agentName: name,
    };
    if (activeTab.value === "company") body.companyIds = ids;
    else body.contactIds = ids;
    if (op) body.operationName = op;
    const r = await fetch("/api/enrichment/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Enqueue failed");
    const n = Number(j.inserted ?? 0);
    message.success(`Queued ${n} task(s).`);
    checkedRowKeys.value = [];
    await fetchTable(false);
    await nextTick();
    scheduleRowWaveAfterHeaderRun();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Enqueue failed");
  } finally {
    const next = { ...headerEnqueueLoading.value };
    delete next[name];
    headerEnqueueLoading.value = next;
  }
}

async function enqueueOne(row: EnrichmentTableRow, agentName: string) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) {
    message.warning("Select a project.");
    return;
  }
  const entityId =
    activeTab.value === "company" ? row.entity.company_id : row.entity.uuid ?? row.entity.id;
  const idStr = typeof entityId === "string" ? entityId : String(entityId ?? "");
  if (!idStr) {
    message.warning("Missing row id.");
    return;
  }
  const k = cellEnqueueKey(row, agentName);
  cellEnqueueLoading.value = { ...cellEnqueueLoading.value, [k]: true };
  try {
    const op = agents.value.find((a) => a.name === agentName)?.operation_name?.trim();
    const body: Record<string, unknown> = {
      projectId,
      entityType: activeTab.value,
      agentName,
    };
    if (activeTab.value === "company") body.companyIds = [idStr];
    else body.contactIds = [idStr];
    if (op) body.operationName = op;
    const r = await fetch("/api/enrichment/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Enqueue failed");
    message.success("Queued.");
    await fetchTable(false);
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Enqueue failed");
  } finally {
    const next = { ...cellEnqueueLoading.value };
    delete next[k];
    cellEnqueueLoading.value = next;
  }
}

const registryColumns = computed<DataTableColumns<EnrichmentAgentRegistryRow>>(() => [
  { title: "Name", key: "name", width: 160, ellipsis: { tooltip: true } },
  { title: "Entity", key: "entity_type", width: 72 },
  {
    title: "Operation",
    key: "operation_name",
    width: 120,
    ellipsis: { tooltip: true },
    render: (row) => row.operation_name ?? "—",
  },
  {
    title: "Prompt",
    key: "prompt",
    minWidth: 140,
    render: (row) => {
      const full = row.prompt?.trim() ?? "";
      if (!full) return "—";
      const short = truncatePromptText(full, 56);
      return h("span", { title: full, style: "cursor: default" }, short);
    },
  },
  {
    title: "Batch size",
    key: "batch_size",
    width: 84,
    align: "right",
    render: (row) => String(row.batch_size ?? 1),
  },
  {
    title: "Active",
    key: "is_active",
    width: 80,
    render: (row) =>
      h(NSwitch, {
        value: row.is_active,
        loading: updatingAgentName.value === row.name,
        disabled: updatingAgentName.value !== null && updatingAgentName.value !== row.name,
        onUpdateValue: (v: boolean) => {
          void setRegistryAgentActive(row, v);
        },
      }),
  },
  {
    title: "",
    key: "actions",
    width: 72,
    render: (row) =>
      h(
        NButton,
        {
          size: "tiny",
          quaternary: true,
          onClick: () => openEditAgentModal(row),
        },
        { default: () => "Edit" }
      ),
  },
]);

async function fetchTable(showSpinner = true) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) return;
  if (showSpinner) tableLoading.value = true;
  tableError.value = "";
  try {
    const off = (page.value - 1) * pageSize.value;
    const q = new URLSearchParams({
      entityType: activeTab.value,
      projectId,
      limit: String(pageSize.value),
      offset: String(off),
    });
    const r = await fetch(`/api/enrichment-table?${q}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to load enrichment table");
    total.value = Number(j.total ?? 0);
    agentNames.value = Array.isArray(j.agentNames) ? j.agentNames : [];
    rows.value = (j.rows ?? []) as EnrichmentTableRow[];
    pruneCheckedRowKeys();
    if (j.error && typeof j.error === "string") {
      message.warning(j.error);
    }
  } catch (e) {
    rows.value = [];
    total.value = 0;
    agentNames.value = [];
    tableError.value = e instanceof Error ? e.message : "Failed to load table";
  } finally {
    tableLoading.value = false;
  }
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

/** Prefer showing a human worker name; hide UUIDs if the API still sends them. */
function workerDisplayName(state: EnrichmentAgentCellState | undefined): string | null {
  const w = state?.workerName?.trim();
  if (!w) return null;
  if (isUuidLike(w)) return null;
  return w;
}

/** Compact batch id: first 2 + last 2 characters (e.g. `ed…a3`). */
function shortBatchLabel(batchId: string | null | undefined): string | null {
  const id = batchId?.trim();
  if (!id || id.length < 4) return null;
  return `${id.slice(0, 2)}…${id.slice(-2)}`;
}

function renderAgentCell(
  agentName: string,
  state: EnrichmentAgentCellState | undefined,
  row: EnrichmentTableRow
) {
  const s = state?.status ?? "planned";
  const k = cellEnqueueKey(row, agentName);
  const enqueueBusy = !!cellEnqueueLoading.value[k];

  const onClickSuccess = () => {
    const raw = state?.resultPreview;
    const text =
      raw === undefined
        ? "(no result payload)"
        : typeof raw === "string"
          ? raw
          : JSON.stringify(raw, null, 2);
    openDetail(`Result · ${agentName}`, text, {
      batchId: state?.batchId ?? null,
      runId: state?.runId ?? null,
    });
  };
  const onClickError = () => {
    openDetail(`Error · ${agentName}`, state?.error ?? "(no message)", {
      batchId: state?.batchId ?? null,
      runId: state?.runId ?? null,
    });
  };

  function runIconBtn(
    title: string,
    type: "default" | "primary" | "success" | "error" | "info" = "default",
    icon: "play" | "refresh" = "refresh"
  ) {
    const Icon = icon === "play" ? PlayIcon : RefreshCwIcon;
    return h(NButton, {
      size: "tiny",
      circle: true,
      tertiary: true,
      type,
      renderIcon: () => h(Icon, { size: 14 }),
      title,
      disabled: enqueueBusy,
      loading: enqueueBusy,
      onClick: (e: MouseEvent) => {
        e.stopPropagation();
        void enqueueOne(row, agentName);
      },
    });
  }

  const batchChip = (): ReturnType<typeof h> | null => {
    const bid = state?.batchId?.trim();
    const short = shortBatchLabel(bid ?? null);
    if (!short || !bid) return null;
    return h(
      "span",
      {
        class: "enrichment-agent-cell__batch-tag",
        title: `Batch ${bid}`,
        onClick: (e: MouseEvent) => {
          e.stopPropagation();
          void openBatchDetailModal(bid);
        },
      },
      short
    );
  };

  if (s === "planned") {
    return h("div", { class: "enrichment-agent-cell enrichment-agent-cell--planned enrichment-agent-cell__main-row" }, [
      h("span", { class: "enrichment-agent-cell__status enrichment-agent-cell__status--muted" }, "No data"),
      runIconBtn("Run", "default", "play"),
    ]);
  }
  if (s === "queued") {
    return h("div", { class: "enrichment-agent-cell enrichment-agent-cell--queued" }, [
      h("div", { class: "enrichment-agent-cell__main-row" }, [
        h("span", { class: "enrichment-agent-cell__status enrichment-agent-cell__status--queued" }, "Queued"),
        h(
          NTag,
          {
            size: "small",
            type: "warning",
            bordered: false,
            round: true,
            class: "enrichment-agent-cell__queue-tag",
          },
          { default: () => "Waiting for worker" }
        ),
      ]),
    ]);
  }
  if (s === "running") {
    const w = workerDisplayName(state);
    const phase: EnrichmentRunPhase = state?.runPhase ?? "working";
    const workerTag = w
      ? h(
          NTag,
          {
            size: "small",
            type: "info",
            bordered: false,
            round: true,
            title: `Worker: ${w}`,
            class: "enrichment-agent-cell__worker-tag",
            style: { maxWidth: "10rem" },
          },
          { default: () => w }
        )
      : null;

    if (phase === "batch_wait") {
      return h("div", { class: "enrichment-agent-cell enrichment-agent-cell--running-batch" }, [
        h("div", { class: "enrichment-agent-cell__main-row" }, [
          h(ClockIcon, { size: 16, class: "enrichment-agent-cell__phase-icon enrichment-agent-cell__phase-icon--batch" }),
          h(
            "span",
            { class: "enrichment-agent-cell__status enrichment-agent-cell__status--running-batch" },
            "Agent waiting batch"
          ),
          workerTag,
        ]),
      ]);
    }

    return h("div", { class: "enrichment-agent-cell enrichment-agent-cell--running-working" }, [
      h("div", { class: "enrichment-agent-cell__main-row" }, [
        h(
          "span",
          { class: "enrichment-agent-cell__status enrichment-agent-cell__status--running-working" },
          "Agent working"
        ),
        workerTag,
      ]),
    ]);
  }
  if (s === "success") {
    const chip = batchChip();
    return h(
      "div",
      {
        class: "enrichment-agent-cell enrichment-agent-cell--done enrichment-agent-cell--clickable",
        onClick: onClickSuccess,
      },
      [
        h(
          "div",
          { class: "enrichment-agent-cell__main-row" },
          [
            h(
              "span",
              { class: "enrichment-agent-cell__label enrichment-agent-cell__label--success" },
              "Result"
            ),
            ...(chip ? [chip] : []),
            runIconBtn("Rerun", "default")

          ]
        ),
      ]
    );
  }
  if (s === "error") {
    const chip = batchChip();
    return h(
      "div",
      {
        class: "enrichment-agent-cell enrichment-agent-cell--failed enrichment-agent-cell--clickable",
        onClick: onClickError,
      },
      [
        h(
          "div",
          { class: "enrichment-agent-cell__main-row" },
          [
            h(
              "span",
              { class: "enrichment-agent-cell__label enrichment-agent-cell__label--error" },
              "Error"
            ),
            ...(chip ? [chip] : []),
            runIconBtn("Rerun", "error"),

          ]
        ),
      ]
    );
  }
  return h("span", { style: "opacity:0.45" }, "—");
}

const baseColumns = computed<DataTableColumns<EnrichmentTableRow>>(() => {
  const keys = activeTab.value === "company" ? COMPANY_BASE_KEYS : CONTACT_BASE_KEYS;
  const cols: DataTableColumns<EnrichmentTableRow> = [];
  for (const key of keys) {
    cols.push({
      title: columnTitle(key),
      key: `base:${key}`,
      width: key === "name" || key === "company_name" ? 200 : 140,
      ellipsis: { tooltip: true },
      render: (row) => formatCellValue(key, row.entity[key]),
    });
  }
  return cols;
});

const selectionColumn = computed<DataTableColumns<EnrichmentTableRow>>(() => [
  {
    type: "selection",
    disabled: (row) => rowEnrichmentInProgress(row),
    sticky: true,
  },
]);

const agentColumns = computed<DataTableColumns<EnrichmentTableRow>>(() => {
  void cellEnqueueLoading.value;
  void enqueueableRowIdsOnPage.value;
  void headerEnqueueLoading.value;
  const names = agentNames.value;
  const opByName = new Map(agents.value.map((a) => [a.name, a.operation_name]));
  const batchByName = new Map(agents.value.map((a) => [a.name, Math.max(1, Number(a.batch_size) || 1)]));
  return names.map((name) => ({
    title: () => {
      const nRows = enqueueableRowIdsOnPage.value.length;
      const busy = !!headerEnqueueLoading.value[name];
      const batchN = batchByName.get(name) ?? 1;
      return h("div", { class: "enrichment-col-head" }, [
        h("div", { class: "enrichment-col-head__left" }, [
          h("span", { class: "enrichment-col-head__name", title: opByName.get(name) ?? undefined }, name),
          h(
            NTag,
            {
              size: "tiny",
              bordered: false,
              round: true,
              type: "info",
              class: "enrichment-col-head__batch",
            },
            { default: () => String(batchN) }
          ),
        ]),
        h(NButton, {
          size: "tiny",
          circle: true,
          title: `Edit prompt for ${name}`,
          class: 'enrichment-col-head__edit-prompt',
          renderIcon: () => h(PencilIcon, { size: 14 }),
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            openPromptDrawer(name);
          },
        }),
        h(
          NPopconfirm,
          {
            showIcon: false,
            positiveText: "Run",
            negativeText: "Cancel",
            onPositiveClick: () => {
              void enqueueForAgentAllOnPage(name);
            },
          },
          {
            trigger: () =>
              h(NButton, {
                size: "tiny",
                circle: true,
                disabled: agentsLoading.value || nRows === 0,
                loading: busy,
                title: `Run ${name} for all rows on this page`,
                renderIcon: () => h(PlayIcon, { size: 14 }),
                onClick: (e: MouseEvent) => {
                  e.stopPropagation();
                },
              }),
            default: () =>
              h("div", { class: "enrichment-col-head-confirm" }, [
                h(
                  "p",
                  { class: "enrichment-col-head-confirm__line" },
                  `Run “${name}” for ${nRows} row(s) on this page?`
                ),
              ]),
          }
        ),
      ]);
    },
    key: `agent:${name}`,
    resizable: true,
    minWidth: 150,
    align: "center" as const,
    render: (row: EnrichmentTableRow) => renderAgentCell(name, row.agentStates[name], row),
  }));
});

const columns = computed(() => [
  ...selectionColumn.value,
  ...baseColumns.value,
  ...agentColumns.value,
]);

watch(
  () => activeTab.value,
  () => {
    checkedRowKeys.value = [];
    enqueueAgentName.value = null;
    enqueueOperationName.value = "";
    void fetchAgents();
    page.value = 1;
    void fetchTable();
  }
);

watch(
  () => projectStore.selectedProjectId,
  (id) => {
    checkedRowKeys.value = [];
    if (id) {
      void fetchAgents();
      page.value = 1;
      void fetchTable();
    }
  }
);

watch([page, pageSize], () => {
  checkedRowKeys.value = [];
  void fetchTable();
});

watch(
  () => [rows.value.length, promptDrawerOpen.value, promptDrawerAgentName.value] as const,
  () => {
    if (!promptDrawerOpen.value) return;
    const n = rows.value.length;
    if (n === 0) return;
    if (promptDrawerPreviewRowIdx.value >= n) promptDrawerPreviewRowIdx.value = 0;
  }
);

onMounted(() => {
  void fetchAgents();
  void fetchTable();
  resumePoll();
});

onUnmounted(() => {
  pausePoll();
  if (rowWaveClearTimer) {
    clearTimeout(rowWaveClearTimer);
    rowWaveClearTimer = undefined;
  }
});

const enrichmentTableParams = computed(() => ({
  entityType: activeTab.value,
  limit: pageSize.value,
  offset: (page.value - 1) * pageSize.value,
}));

function applyEnrichmentFromSocket(p: EnrichmentDataPayload) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId || p.projectId !== projectId) return;
  if (p.entityType !== activeTab.value) return;
  if (p.limit !== pageSize.value || p.offset !== (page.value - 1) * pageSize.value) return;
  total.value = Number(p.total ?? 0);
  agentNames.value = Array.isArray(p.agentNames) ? p.agentNames : [];
  rows.value = (p.rows ?? []) as EnrichmentTableRow[];
  agents.value = (p.agents ?? []) as EnrichmentAgentInfo[];
  pruneCheckedRowKeys();
  const err = p.error;
  if (err && typeof err === "string") {
    message.warning(err);
  }
}

function applyBatchStartedFromSocket(p: EnrichmentBatchStartedPayload) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId || p.projectId !== projectId) return;
  const agentName = p.agentName;
  if (!agentName) return;
  const tab = activeTab.value;
  const idSet = new Set<string>();
  for (const it of p.items) {
    if (tab === "company") {
      if (it.companyId) idSet.add(it.companyId);
    } else if (it.contactId) {
      idSet.add(it.contactId);
    }
  }
  if (idSet.size === 0) return;
  const wn = p.workerName ?? null;
  rows.value = rows.value.map((row) => {
    const eid =
      tab === "company"
        ? (row.entity.company_id as string | undefined)
        : (row.entity.uuid as string | undefined);
    if (!eid || !idSet.has(eid)) return row;
    const prev = row.agentStates[agentName];
    if (!prev) return row;
    return {
      ...row,
      agentStates: {
        ...row.agentStates,
        [agentName]: {
          ...prev,
          status: "running",
          runPhase: "working",
          workerName: wn ?? prev.workerName ?? null,
          updatedAt: new Date().toISOString(),
        },
      },
    };
  });
}

const { connected: enrichmentRealtimeConnected } = useEnrichmentRealtime(
  computed(() => projectStore.selectedProjectId),
  enrichmentTableParams,
  {
    onEnrichmentData: applyEnrichmentFromSocket,
    onBatchStarted: applyBatchStartedFromSocket,
    pausePoll,
    resumePoll,
    onSafetyPoll: () => {
      void fetchTable(false);
      void fetchAgents();
    },
  }
);
</script>

<template>
  <div class="enrichment-page">
    <NCard title="Enrichment table" class="main-card">
      <template #header-extra>
        <NSpace size="small" align="center">
          <NButton size="small" quaternary @click="fetchTable()">Refresh</NButton>
          <NPagination
            v-model:page="page"
            v-model:page-size="pageSize"
            :item-count="total"
            :page-sizes="PAGE_SIZES"
            show-size-picker
            size="small"
          />
        </NSpace>
      </template>

      <NTabs v-model:value="activeTab" type="line" animated>
        <NTabPane name="company" tab="Company enrichment">
          <p class="tab-hint">Project companies with per-agent queue and result state.</p>
        </NTabPane>
        <NTabPane name="contact" tab="Contact enrichment">
          <p class="tab-hint">Project contacts with per-agent queue and result state.</p>
        </NTabPane>
      </NTabs>

      <div class="toolbar toolbar-main">
        <NSpace wrap align="center" :size="10">
          <NSelect
            v-model:value="enqueueAgentName"
            :options="agentSelectOptions"
            :loading="agentsLoading"
            :disabled="!agentSelectOptions.length"
            placeholder="Agent…"
            filterable
            clearable
            size="small"
            style="min-width: 220px"
          />
          <NInput
            v-model:value="enqueueOperationName"
            placeholder="Operation (optional)"
            size="small"
            clearable
            style="width: 180px"
          />
          <NButton
            type="primary"
            size="small"
            :loading="enqueueLoading"
            :disabled="!enqueueAgentName || checkedRowKeys.length === 0"
            @click="enqueueSelected"
          >
            Enqueue selected
          </NButton>
          <NButton size="small" quaternary @click="openManageAgents">Manage agents</NButton>
          <NButton
            size="small"
            quaternary
            :disabled="!projectStore.selectedProjectId"
            @click="openPromptSettingsModal"
          >
            Prompt settings
          </NButton>
        </NSpace>
        <div class="toolbar-meta">
          <NSpace v-if="workerBatchBufferCount > 0 || agentBatchSizeSummary" size="small" align="center" wrap>
            <NTag
              v-if="workerBatchBufferCount > 0"
              size="small"
              type="warning"
              :bordered="true"
              :title="workerBatchBufferDetail || 'Tasks accumulating before batch run'"
            >
              Worker batch {{ workerBatchBufferCount }}
            </NTag>
            <NTag
              v-if="agentBatchSizeSummary"
              size="small"
              :bordered="true"
              title="Configured batch_size on each agent (how many entities per LLM call when full)"
            >
              Agent batch {{ agentBatchSizeSummary }}
            </NTag>
          </NSpace>
          <span v-if="enrichmentRealtimeConnected" class="muted enrichment-live">Live</span>
          <span v-if="tableLoading && rows.length > 0" class="muted">Refreshing…</span>
          <span v-if="agentsLoading" class="muted">Loading agents…</span>
          <span v-else-if="agents.length" class="muted">{{ agents.length }} active agent(s) for this tab</span>
          <span v-if="checkedRowKeys.length" class="muted selection-hint">{{ checkedRowKeys.length }} selected</span>
        </div>
      </div>

      <NAlert v-if="agentsError" type="warning" class="alert-block" :show-icon="true">
        {{ agentsError }}
      </NAlert>
      <NAlert v-if="tableError" type="error" class="alert-block" :show-icon="true">
        {{ tableError }}
      </NAlert>

      <NEmpty
        v-if="tableLoading && rows.length === 0 && !tableError"
        description="Loading…"
      />
      <NEmpty v-else-if="!tableLoading && !tableError && rows.length === 0" description="No rows for this project." />
      <NDataTable
        v-else-if="rows.length > 0"
        v-model:checked-row-keys="checkedRowKeys"
        class="enrichment-data-table"
        :columns="columns"
        :data="rows"
        :row-key="(r: EnrichmentTableRow) => rowKey(r)"
        :scroll-x="Math.max(900, 200 + columns.length * 120)"
        size="small"
        striped
        bordered
      />
    </NCard>

    <NModal
      v-model:show="detailOpen"
      preset="card"
      :title="detailTitle"
      style="width: min(720px, 92vw)"
      :mask-closable="true"
    >
      <div v-if="detailRunId || detailBatchId" class="detail-meta">
        <span v-if="detailRunId" class="muted"
          >Run: <code>{{ detailRunId }}</code></span
        >
        <span v-if="detailBatchId" class="muted"
          >Batch: <code>{{ detailBatchId }}</code></span
        >
      </div>
      <pre class="detail-pre">{{ detailBody }}</pre>
      <NSpace v-if="detailBatchId" style="margin-top: 12px">
        <NButton size="small" type="primary" @click="openBatchDetailModal(detailBatchId!)">
          View full batch
        </NButton>
      </NSpace>
    </NModal>

    <NModal
      v-model:show="batchDetailOpen"
      preset="card"
      :title="batchDetailBatch ? `Batch · ${batchDetailBatch.agent_name}` : 'Batch detail'"
      style="width: min(900px, 96vw)"
      :mask-closable="true"
    >
      <NSpin :show="batchDetailLoading">
        <NAlert v-if="batchDetailError" type="error" :show-icon="true">{{ batchDetailError }}</NAlert>
        <template v-else-if="batchDetailBatch">
          <div class="batch-detail-header">
            <span
              >Worker: <strong>{{ batchDetailBatch.worker_name }}</strong></span
            >
            <span class="muted">{{
              batchDetailBatch.created_at?.replace("T", " ").slice(0, 19)
            }}</span>
            <span class="muted"><code>{{ batchDetailBatch.id }}</code></span>
          </div>
          <NDataTable
            v-if="batchDetailRuns.length"
            :columns="batchDetailColumns"
            :data="batchDetailRuns"
            :row-key="(r: EnrichmentBatchDetailRun) => r.id"
            size="small"
            striped
            bordered
            :scroll-x="720"
          />
          <NEmpty v-else description="No runs linked to this batch." />
        </template>
      </NSpin>
    </NModal>

    <NModal
      v-model:show="batchRowDetailOpen"
      preset="card"
      :title="batchRowDetailTitle"
      style="width: min(640px, 92vw)"
      :mask-closable="true"
    >
      <pre class="detail-pre">{{ batchRowDetailBody }}</pre>
    </NModal>

    <NModal
      v-model:show="promptSettingsOpen"
      preset="card"
      title="Enrichment prompt settings"
      style="width: min(560px, 96vw)"
      :mask-closable="true"
      :segmented="{ content: true, footer: 'soft' }"
    >
      <NSpin :show="promptSettingsLoading">
        <NSpace vertical :size="12" class="prompt-settings-body">
          <p class="tab-hint">
            Per-project overrides merge with global defaults. Prefix and suffix wrap the resolved agent
            prompt (after <code v-text="'{{}}'" /> expansion), matching the worker. Optional
            <code>prompt_profiles</code> lets each worker pick a named overlay via
            <code>ENRICHMENT_SYSTEM_PROMPT_TYPE</code> in its env.
          </p>
          <NAlert v-if="promptSettingsError" type="error" :show-icon="true">
            {{ promptSettingsError }}
          </NAlert>
          <div>
            <div class="prompt-drawer-label">Global prefix (prepend)</div>
            <NInput
              v-model:value="promptSettingsPrefix"
              type="textarea"
              size="small"
              :autosize="{ minRows: 2, maxRows: 8 }"
              placeholder="Optional text before the resolved prompt"
            />
          </div>
          <div>
            <div class="prompt-drawer-label">Global suffix (append)</div>
            <NInput
              v-model:value="promptSettingsSuffix"
              type="textarea"
              size="small"
              :autosize="{ minRows: 2, maxRows: 8 }"
              placeholder="Optional text after the resolved prompt"
            />
          </div>
          <div>
            <div class="prompt-drawer-label"><code>companies_placeholder_config</code> (JSON)</div>
            <NInput
              v-model:value="promptSettingsConfigText"
              type="textarea"
              size="small"
              :autosize="{ minRows: 8, maxRows: 22 }"
              placeholder="{}"
              class="prompt-settings-json"
            />
          </div>
          <div>
            <div class="prompt-drawer-label"><code>prompt_profiles</code> (JSON)</div>
            <NInput
              v-model:value="promptSettingsProfilesText"
              type="textarea"
              size="small"
              :autosize="{ minRows: 4, maxRows: 14 }"
              placeholder='e.g. { "gpu": { "global_prompt_prefix": "..." } }'
              class="prompt-settings-json"
            />
          </div>
        </NSpace>
      </NSpin>
      <template #footer>
        <NSpace justify="end" size="small">
          <NButton size="small" @click="promptSettingsOpen = false">Close</NButton>
          <NButton
            type="primary"
            size="small"
            :loading="promptSettingsSaving"
            :disabled="promptSettingsLoading"
            @click="savePromptSettings"
          >
            Save
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal
      v-model:show="manageAgentsOpen"
      preset="card"
      title="Enrichment agents"
      style="width: min(900px, 96vw)"
      :mask-closable="true"
    >
      <div class="registry-toolbar">
        <NButton size="small" type="primary" @click="openCreateAgentModal">New agent</NButton>
      </div>
      <NAlert v-if="registryError" type="error" class="alert-block" :show-icon="true">
        {{ registryError }}
      </NAlert>
      <NSpin :show="registryLoading">
        <NDataTable
          :columns="registryColumns"
          :data="registryRows"
          :row-key="(r: EnrichmentAgentRegistryRow) => r.name"
          size="small"
          striped
          bordered
          :scroll-x="720"
          :max-height="360"
        />
      </NSpin>
    </NModal>

    <NModal
      v-model:show="agentModalOpen"
      preset="card"
      :title="agentModalMode === 'create' ? 'New agent' : `Edit · ${agentFormName}`"
      style="width: min(520px, 94vw)"
      :mask-closable="true"
      :segmented="{ content: true, footer: 'soft' }"
      @after-leave="resetAgentForm"
    >
      <NSpace vertical :size="14" class="agent-modal-form">
        <div class="agent-modal-field">
          <div class="agent-modal-label">Name</div>
          <NInput
            v-model:value="agentFormName"
            placeholder="Unique agent name (primary key)"
            size="small"
            :disabled="agentModalMode === 'edit'"
          />
        </div>
        <div class="agent-modal-field">
          <div class="agent-modal-label">Entity type</div>
          <NSelect v-model:value="agentFormEntityType" :options="entityTypeOptions" size="small" style="width: 100%" />
        </div>
        <div class="agent-modal-field">
          <div class="agent-modal-label">Operation label</div>
          <NInput v-model:value="agentFormOperation" placeholder="Optional label for this operation" size="small" clearable />
        </div>
        <div class="agent-modal-field">
          <div class="agent-modal-label">Prompt</div>
          <NInput
            v-model:value="agentFormPrompt"
            type="textarea"
            placeholder="Instructions for the enrichment agent"
            size="small"
            :autosize="{ minRows: 4, maxRows: 14 }"
          />
        </div>
        <div class="agent-modal-field agent-modal-field--inline">
          <div class="agent-modal-field-grow">
            <div class="agent-modal-label">Batch size</div>
            <NInputNumber
              v-model:value="agentFormBatchSize"
              :min="1"
              :step="1"
              :precision="0"
              size="small"
              placeholder="1"
              style="width: 100%"
            />
          </div>
          <div class="agent-modal-field-switch">
            <div class="agent-modal-label">Active</div>
            <NSwitch v-model:value="agentFormActive" size="small" />
          </div>
        </div>
      </NSpace>
      <template #footer>
        <NSpace justify="end" size="small">
          <NButton size="small" @click="agentModalOpen = false">Cancel</NButton>
          <NButton
            type="primary"
            size="small"
            :loading="savingAgent"
            :disabled="!agentFormName.trim()"
            @click="submitAgentModal"
          >
            {{ agentModalMode === 'create' ? 'Create' : 'Save' }}
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <NDrawer v-model:show="promptDrawerOpen" :width="560" placement="right" :trap-focus="false">
      <NDrawerContent :title="`Edit prompt · ${promptDrawerAgentName}`" closable>
        <div class="prompt-drawer-body">
          <div class="prompt-drawer-field">
            <div class="prompt-drawer-label">Prompt</div>
            <div ref="promptTextareaWrapRef" class="prompt-drawer-textarea-wrap">
              <textarea
                ref="promptTextareaRef"
                class="prompt-drawer-textarea"
                rows="14"
                :value="promptDrawerText"
                placeholder="Use {{field}} or {{agent:OtherAgent.result_key}}"
                @input="onPromptTextareaInput"
                @keydown="onPromptTextareaKeydown"
                @keyup="onPromptTextareaKeyup"
                @click="updatePromptAutocomplete"
                @scroll="updatePromptAutocompletePosition"
                @blur="onPromptTextareaBlur"
              />
              <div
                v-if="promptAutocompleteOpen && promptAutocompleteItems.length"
                ref="promptAcListRef"
                class="prompt-drawer-ac"
                role="listbox"
                :style="{
                  top: `${promptAutocompletePos.top}px`,
                  left: `${promptAutocompletePos.left}px`,
                }"
              >
                <button
                  v-for="(it, idx) in promptAutocompleteItems"
                  :key="`${it.insert}-${idx}`"
                  type="button"
                  class="prompt-drawer-ac__item"
                  :class="{ 'prompt-drawer-ac__item--active': idx === promptAutocompleteActive }"
                  role="option"
                  :aria-selected="idx === promptAutocompleteActive"
                  @mousedown.prevent="applyPromptAutocompleteChoice(idx)"
                >
                  <code class="prompt-drawer-ac__insert" v-text="'{{' + it.insert + '}}'" />
                  <span class="prompt-drawer-ac__label">{{ it.label }}</span>
                </button>
              </div>
            </div>
          </div>

          <div class="prompt-drawer-preview-toggle">
            <NSwitch v-model:value="promptDrawerPreviewOpen" size="small" />
            <span class="prompt-drawer-preview-toggle__text">Preview resolved prompt</span>
          </div>

          <div v-show="promptDrawerPreviewOpen" class="prompt-drawer-preview">
            <NEmpty v-if="rows.length === 0" description="No rows on this page to preview." size="small" />
            <template v-else>
              <NSelect
                v-if="promptDrawerBatchSize <= 1"
                v-model:value="promptDrawerPreviewRowIdx"
                :options="promptPreviewRowOptions"
                filterable
                size="small"
                class="prompt-drawer-preview__select"
              />
              <p v-else class="prompt-drawer-preview__hint">
                Batch size {{ promptDrawerBatchSize }}: preview uses the first
                {{ promptBatchPreviewRowCount }} row(s) on this page. CSV for
                <code>{{ PROMPT_TOKEN_COMPANIES }}</code> /
                <code>{{ PROMPT_TOKEN_CONTACTS }}</code> follows the same rules as the worker
                (agent entity type + tab). Cell values are from this table, not
                <code>companies_placeholder_config</code> — use Worker-aligned (server) for assembled rows.
              </p>
              <div class="prompt-drawer-preview-blocks" :title="promptDrawerPreviewPlainTitle || undefined">
                <template v-for="(block, bi) in promptPreviewBlocks" :key="bi">
                  <div v-if="block.heading" class="prompt-drawer-preview__heading">{{ block.heading }}</div>
                  <pre class="prompt-drawer-preview-pre"><template v-for="(seg, si) in block.segments" :key="si"><span v-if="seg.resolved" class="prompt-drawer-preview-ok">{{ seg.text }}</span><span v-else class="prompt-drawer-preview-bad">{{ seg.text }}</span></template></pre>
                </template>
              </div>
              <div v-if="activeTab === 'company'" class="prompt-drawer-worker-preview">
                <div class="prompt-drawer-worker-preview__row">
                  <span class="prompt-drawer-worker-preview__label">Worker-aligned (server)</span>
                  <NSpace size="small" align="center" wrap>
                    <NInput
                      v-model:value="serverPromptPreviewProfile"
                      size="tiny"
                      placeholder="Profile (ENV: ENRICHMENT_SYSTEM_PROMPT_TYPE)"
                      style="min-width: 200px; max-width: 280px"
                      clearable
                    />
                    <NButton
                      size="tiny"
                      :loading="serverPromptPreviewLoading"
                      :disabled="rows.length === 0"
                      @click="fetchServerPromptPreview"
                    >
                      Load
                    </NButton>
                  </NSpace>
                </div>
                <p class="prompt-drawer-worker-preview__hint">
                  Same pipeline as the worker (assembly + prefix/suffix + optional
                  <code>prompt_profiles</code> overlay) for the first
                  {{ Math.min(promptDrawerBatchSize, rows.length) }} company id(s) on this page.
                </p>
                <NAlert v-if="serverPromptPreviewError" type="error" size="small" :show-icon="true">
                  {{ serverPromptPreviewError }}
                </NAlert>
                <pre v-if="serverPromptPreviewText" class="prompt-drawer-preview-pre prompt-drawer-worker-preview__pre">{{
                  serverPromptPreviewText
                }}</pre>
              </div>
            </template>
          </div>
        </div>
        <template #footer>
          <div class="prompt-drawer-footer">
            <NSpace justify="end" size="small">
              <NButton size="small" :disabled="promptDrawerSaving" @click="promptDrawerOpen = false">
                Cancel
              </NButton>
              <NButton
                type="primary"
                size="small"
                :loading="promptDrawerSaving"
                :disabled="!promptDrawerAgentName.trim()"
                @click="savePromptDrawer"
              >
                Save
              </NButton>
            </NSpace>
          </div>
        </template>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<style scoped>
.enrichment-page {
  padding: 1rem 1.25rem 2rem;
}
.main-card {
  max-width: 1600px;
  margin: 0 auto;
}
.tab-hint {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
  opacity: 0.75;
}
.toolbar {
  margin: 0.5rem 0 1rem;
}
.toolbar-main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
}
.toolbar-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.registry-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.75rem;
}
.agent-modal-form {
  width: 100%;
}
.agent-modal-field {
  width: 100%;
}
.agent-modal-field--inline {
  display: flex;
  gap: 1rem;
  align-items: flex-end;
}
.agent-modal-field-grow {
  flex: 1;
  min-width: 0;
}
.agent-modal-field-switch {
  flex-shrink: 0;
  padding-bottom: 2px;
}
.agent-modal-label {
  font-size: 0.75rem;
  opacity: 0.75;
  margin-bottom: 0.35rem;
}
.muted {
  font-size: 0.875rem;
  opacity: 0.65;
}
.selection-hint {
  margin-left: 0.25rem;
}
.enrichment-live {
  font-weight: 600;
  color: var(--n-success-color, #63e2b7);
  margin-right: 0.35rem;
}
.alert-block {
  margin-bottom: 0.75rem;
}

.enrichment-page :deep(.enrichment-agent-cell) {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  column-gap: calc(var(--n-td-padding) + 6px);
  row-gap: calc(var(--n-td-padding) / 2 + 4px);
  min-height: 40px;
  padding: calc(var(--n-td-padding) + 2px) calc(var(--n-td-padding) + 4px);
  border-radius: calc(var(--n-border-radius) * 2 + 2px);
  box-sizing: border-box;
  text-align: left;
}
.enrichment-page :deep(.enrichment-agent-cell--clickable) {
  cursor: pointer;
}
.enrichment-page :deep(.enrichment-agent-cell__label) {
  font-size: var(--n-font-size);
  line-height: var(--n-line-height);
  font-weight: var(--n-th-font-weight);
  flex-shrink: 0;
}
.enrichment-page :deep(.enrichment-agent-cell__label--success) {
  color: var(--n-th-icon-color-active);
}
.enrichment-page :deep(.enrichment-agent-cell__label--error) {
  color: var(--n-td-text-color);
}
.enrichment-page :deep(.enrichment-agent-cell--planned) {
  background: color-mix(in srgb, var(--n-th-icon-color) 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--n-border-color) 45%, transparent);
}
.enrichment-page :deep(.enrichment-col-head__batch) {
  flex-shrink: 0;
  font-size: 10px;
  padding: 0 6px;
  line-height: 1.35;
}
.enrichment-page :deep(.enrichment-col-head__edit-prompt) {
  margin-left: auto;
  margin-right: 4px;
}
.enrichment-page :deep(.enrichment-agent-cell--queued) {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  column-gap: 8px;
  row-gap: 4px;
  background: color-mix(in srgb, rgb(251, 191, 36) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, rgb(245, 158, 11) 34%, transparent);
}
.enrichment-page :deep(.enrichment-agent-cell__status--queued) {
  color: rgba(253, 224, 71, 0.95);
}
.enrichment-page :deep(.enrichment-agent-cell__queue-tag) {
  flex-shrink: 0;
  max-width: min(100%, 11rem);
}
.enrichment-page :deep(.enrichment-agent-cell--running-batch) {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  column-gap: 8px;
  row-gap: 4px;
  background: color-mix(in srgb, rgb(167, 139, 250) 16%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, rgb(167, 139, 250) 36%, transparent);
}
.enrichment-page :deep(.enrichment-agent-cell--running-working) {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  column-gap: 8px;
  row-gap: 4px;
  background: color-mix(in srgb, rgb(96, 165, 250) 16%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, rgb(96, 165, 250) 38%, transparent);
}
.enrichment-page :deep(.enrichment-agent-cell__status--running-batch) {
  color: rgba(216, 201, 255, 0.96);
}
.enrichment-page :deep(.enrichment-agent-cell__status--running-working) {
  color: rgba(186, 220, 255, 0.95);
}
.enrichment-page :deep(.enrichment-agent-cell__phase-icon--batch) {
  color: rgba(196, 181, 253, 0.95);
  flex-shrink: 0;
}
.enrichment-page :deep(.enrichment-agent-cell__worker-tag) {
  flex-shrink: 0;
  max-width: min(100%, 10rem);
}
.enrichment-page :deep(.enrichment-agent-cell__batch-tag) {
  margin-right: auto;
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
    monospace;
  letter-spacing: 0.02em;
  padding: 0 0.35rem;
  border-radius: 4px;
  background: color-mix(in srgb, var(--n-th-icon-color) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--n-border-color) 45%, transparent);
  cursor: pointer;
  flex-shrink: 0;
  line-height: 1.45;
  user-select: none;
}
.enrichment-page :deep(.enrichment-agent-cell__main-row) {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.enrichment-page :deep(.enrichment-agent-cell--done) {
  background: color-mix(in srgb, var(--n-th-icon-color-active) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--n-loading-color) 28%, transparent);
}
.enrichment-page :deep(.enrichment-agent-cell--failed) {
  background: color-mix(in srgb, #e88080 20%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #e88080 55%, transparent);
}
.enrichment-page :deep(.enrichment-agent-cell__row) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: calc(var(--n-td-padding) + 4px);
}
.enrichment-page :deep(.enrichment-agent-cell__status) {
  font-size: 12px;
  font-weight: var(--n-th-font-weight);
  color: var(--n-td-text-color);
}
.enrichment-page :deep(.enrichment-agent-cell__status--muted) {
  font-size: 12px;
  color: var(--n-th-icon-color);
}

.detail-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.8rem;
  line-height: 1.45;
  max-height: 60vh;
  overflow: auto;
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  margin-bottom: 0.75rem;
  font-size: 0.75rem;
}

.batch-detail-header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  align-items: baseline;
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
}

.prompt-drawer-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.prompt-drawer-field {
  width: 100%;
}
.prompt-drawer-label {
  font-size: 0.75rem;
  opacity: 0.75;
  margin-bottom: 0.35rem;
}
.prompt-drawer-textarea-wrap {
  position: relative;
  z-index: 0;
}
.prompt-drawer-textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 280px;
  padding: 0.5rem 0.65rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  border-radius: var(--n-border-radius);
  border: 1px solid var(--n-border-color);
  background: var(--n-color-modal);
  color: var(--n-text-color);
  resize: vertical;
}
.prompt-drawer-textarea:focus {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--n-primary-color) 35%, transparent);
  border-color: var(--n-primary-color);
}
.prompt-drawer-ac {
  position: absolute;
  margin: 0;
  z-index: 20;
  min-width: min(100%, 200px);
  max-width: min(100%, 320px);
  width: max-content;
  max-height: 220px;
  overflow: auto;
  border-radius: var(--n-border-radius);
  border: 1px solid var(--n-border-color);
  background: var(--n-color-popover);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
}
.prompt-drawer-ac__item:first-child {
  border-top-left-radius: calc(var(--n-border-radius) - 1px);
  border-top-right-radius: calc(var(--n-border-radius) - 1px);
}
.prompt-drawer-ac__item:last-child {
  border-bottom-left-radius: calc(var(--n-border-radius) - 1px);
  border-bottom-right-radius: calc(var(--n-border-radius) - 1px);
}
.prompt-drawer-ac__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 0.4rem 0.65rem;
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: var(--n-text-color);
}
.prompt-drawer-ac__item:hover:not(.prompt-drawer-ac__item--active) {
  background: color-mix(in srgb, var(--n-primary-color) 10%, transparent);
}
.prompt-drawer-ac__item--active {
  background: color-mix(in srgb, var(--n-primary-color) 24%, transparent);
  box-shadow: inset 3px 0 0 var(--n-primary-color);
}
.prompt-drawer-ac__item--active .prompt-drawer-ac__insert {
  color: var(--n-primary-color);
  font-weight: 600;
}
.prompt-drawer-ac__insert {
  font-size: 0.75rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.prompt-drawer-ac__label {
  font-size: 0.7rem;
  opacity: 0.75;
}
.prompt-drawer-preview-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.prompt-drawer-preview-toggle__text {
  font-size: 0.8125rem;
}
.prompt-drawer-preview {
  padding-top: 0.25rem;
}
.prompt-drawer-preview__select {
  width: 100%;
  margin-bottom: 0.5rem;
}
.prompt-drawer-preview__hint {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  opacity: 0.7;
}
.prompt-drawer-preview-blocks {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.prompt-drawer-preview__heading {
  font-size: 0.75rem;
  font-weight: 600;
  opacity: 0.85;
  margin-bottom: 0.25rem;
}
.prompt-drawer-preview-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.75rem;
  line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  padding: 0.5rem 0.65rem;
  border-radius: var(--n-border-radius);
  border: 1px solid var(--n-border-color);
  background: color-mix(in srgb, var(--n-border-color) 18%, transparent);
  max-height: 240px;
  overflow: auto;
}
.prompt-drawer-preview-ok {
  color: var(--n-text-color);
}
.prompt-drawer-preview-bad {
  color: var(--n-error-color, #d03050);
  font-weight: 600;
}
.prompt-drawer-worker-preview {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--n-border-color);
}
.prompt-drawer-worker-preview__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}
.prompt-drawer-worker-preview__label {
  font-size: 0.75rem;
  font-weight: 600;
  opacity: 0.85;
}
.prompt-drawer-worker-preview__hint {
  margin: 0 0 0.5rem;
  font-size: 0.7rem;
  opacity: 0.65;
  line-height: 1.4;
}
.prompt-drawer-worker-preview__pre {
  max-height: 200px;
}
.prompt-settings-body {
  width: 100%;
}
.prompt-settings-json {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.75rem;
}
.prompt-drawer-footer {
  width: 100%;
  padding-top: 0.25rem;
}
</style>

<style>
.enrichment-col-head {
  justify-content: space-between;
  display: flex;
  align-items: center;
  padding-right: 12px;
}

.enrichment-col-head__left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.enrichment-col-head-confirm {
  max-width: 260px;
  font-size: 13px;
  line-height: 1.45;
}
.enrichment-col-head-confirm__line {
  margin: 0;
}
</style>
