<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import {
  NCard, NAlert, NEmpty, NSpin, NAvatar, NTag, NButton, NSelect,
  NModal, NSpace, NTooltip, NInput, NPopconfirm, useMessage,
} from "naive-ui";
import {
  MessageCircleIcon, UserIcon, BuildingIcon, LightbulbIcon,
  PlusIcon, UsersIcon, SearchIcon, LinkIcon, XIcon,
} from "lucide-vue-next";
import { useDebounceFn } from "@vueuse/core";
import { useProjectStore } from "../stores/project";
import AttachCompanyModal from "../components/AttachCompanyModal.vue";
import ReplyContextModal from "../components/ReplyContextModal.vue";

// ── Types ─────────────────────────────────────────────────────────────────────

type ConversationReplyTag = "no_response" | "waiting_for_response" | "got_response";

interface ConversationListItem {
  conversationUuid: string;
  leadUuid: string | null;
  senderProfileUuid: string | null;
  senderDisplayName: string;
  receiverDisplayName: string;
  receiverTitle: string | null;
  receiverCompanyName: string | null;
  receiverAvatarUrl: string | null;
  receiverCompanyId: string | null;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  inboxCount: number;
  outboxCount: number;
  lastMessageIsOutbox: boolean;
  hypothesisCount: number;
  /** Set by API; when missing, card falls back to inbox/outbox rules below. */
  replyTag?: ConversationReplyTag;
}

interface DialogueMessage {
  key: number;
  text: string;
  sentAt: string;
  sender: string;
  direction: "inbound" | "outbound";
}

interface ContactWithConversations {
  uuid: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  position: string | null;
  avatar_url: string | null;
  company_id: string | null;
  conversations: Array<{ conversationUuid: string; messageCount: number; lastMessageAt: string | null }>;
}

interface HypothesisItem {
  id: string;
  name: string;
}

// ── Store & utils ─────────────────────────────────────────────────────────────

const projectStore = useProjectStore();
const message = useMessage();

function contactDisplayName(c: { first_name?: string | null; last_name?: string | null; name?: string | null } | null): string {
  if (!c) return "—";
  if (c.name?.trim()) return c.name.trim();
  return [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "—";
}

function formatDate(val: string | null | undefined): string {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return d.toLocaleString();
}

function formatDateShort(val: string | null | undefined): string {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  // Same year: "Mar 18, 14:32"
  const dateStr = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${dateStr}, ${time}`;
}

function truncate(s: string | null | undefined, n = 80): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

const REPLY_TAGS = new Set<ConversationReplyTag>(["no_response", "waiting_for_response", "got_response"]);

/**
 * Status for the list card: prefer API `replyTag`, else original inbox/outbox / last-message rules.
 */
function replyTagForCard(item: ConversationListItem): ConversationReplyTag {
  if (item.replyTag && REPLY_TAGS.has(item.replyTag)) return item.replyTag;
  if (item.outboxCount > 0 && item.inboxCount === 0) return "no_response";
  if (item.inboxCount > 0 && item.lastMessageIsOutbox) return "waiting_for_response";
  if (item.inboxCount > 0 && !item.lastMessageIsOutbox) return "got_response";
  if (item.inboxCount > 0) return "got_response";
  return "no_response";
}

function replyStatusBadge(item: ConversationListItem): { type: "error" | "warning" | "success"; label: string } {
  const t = replyTagForCard(item);
  if (t === "no_response") return { type: "error", label: "No response" };
  if (t === "waiting_for_response") return { type: "warning", label: "Waiting for response" };
  return { type: "success", label: "Got response" };
}

// ── Resizable panels ──────────────────────────────────────────────────────────

const LS_KEY = "conversations-panel-left-width";
const DEFAULT_LEFT = 360;
const leftWidth = ref<number>(parseInt(localStorage.getItem(LS_KEY) ?? "") || DEFAULT_LEFT);
const isDragging = ref(false);
const containerRef = ref<HTMLElement | null>(null);

function onDividerMouseDown(e: MouseEvent) {
  e.preventDefault();
  isDragging.value = true;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value || !containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  const newW = Math.max(200, Math.min(e.clientX - rect.left, rect.width - 320));
  leftWidth.value = newW;
}

function onMouseUp() {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  if (isDragging.value) {
    isDragging.value = false;
    localStorage.setItem(LS_KEY, String(leftWidth.value));
  }
}

onMounted(() => {
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
});

onBeforeUnmount(() => {
  window.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("mouseup", onMouseUp);
});

// ── Left panel: conversation list + search + lazy load ────────────────────────

const PAGE_SIZE = 50;

const allConvList = ref<ConversationListItem[]>([]);   // accumulated pages (server-filtered)
const totalConvCount = ref(0);
const convListLoading = ref(false);
const convListLoadingMore = ref(false);
const convListError = ref("");
const selectedConvUuid = ref<string | null>(null);
const hasMore = ref(true);
const currentOffset = ref(0);

// Search + tag filters (applied on server)
const searchInput = ref("");
const searchQuery = ref("");
const debouncedSearchQuery = useDebounceFn(() => {
  searchQuery.value = searchInput.value.trim();
  resetAndFetch();
}, 250);
watch(searchInput, () => debouncedSearchQuery());

/** Empty string = all statuses (NSelect option typing). */
const replyTagFilter = ref("");

const replyTagSelectOptions: Array<{ label: string; value: ConversationReplyTag | "" }> = [
  { label: "All statuses", value: "" },
  { label: "No response", value: "no_response" },
  { label: "Waiting for response", value: "waiting_for_response" },
  { label: "Got response", value: "got_response" },
];

watch(replyTagFilter, () => {
  resetAndFetch();
});

async function fetchConversationsPage(offset: number, append: boolean) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) {
    allConvList.value = [];
    totalConvCount.value = 0;
    return;
  }
  if (append) convListLoadingMore.value = true;
  else convListLoading.value = true;
  convListError.value = "";
  try {
    const sp = new URLSearchParams({
      projectId,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (searchQuery.value) sp.set("search", searchQuery.value);
    const tag = replyTagFilter.value.trim();
    if (tag === "no_response" || tag === "waiting_for_response" || tag === "got_response") {
      sp.set("replyTag", tag);
    }

    const r = await fetch(`/api/conversations?${sp.toString()}`);
    const j = await r.json() as {
      data?: ConversationListItem[];
      total?: number;
      error?: string;
    };
    if (j.error) {
      convListError.value = j.error;
      if (!append) {
        allConvList.value = [];
        totalConvCount.value = 0;
      }
    } else {
      const page = j.data ?? [];
      const total = typeof j.total === "number" ? j.total : page.length;
      totalConvCount.value = total;
      if (append) allConvList.value = [...allConvList.value, ...page];
      else allConvList.value = page;
      const loaded = append ? offset + page.length : page.length;
      hasMore.value = loaded < total && page.length === PAGE_SIZE;
      currentOffset.value = loaded;
    }
  } catch (e) {
    convListError.value = e instanceof Error ? e.message : "Failed to load conversations";
    if (!append) {
      allConvList.value = [];
      totalConvCount.value = 0;
    }
  } finally {
    convListLoading.value = false;
    convListLoadingMore.value = false;
  }
}

function resetAndFetch() {
  hasMore.value = true;
  currentOffset.value = 0;
  allConvList.value = [];
  totalConvCount.value = 0;
  void fetchConversationsPage(0, false);
}

watch(() => projectStore.selectedProjectId, () => {
  selectedConvUuid.value = null;
  searchInput.value = "";
  searchQuery.value = "";
  replyTagFilter.value = "";
  resetAndFetch();
}, { immediate: true });

// Infinite scroll sentinel
const listSentinelRef = ref<HTMLElement | null>(null);
let sentinelObserver: IntersectionObserver | null = null;

function setupSentinel() {
  if (sentinelObserver) sentinelObserver.disconnect();
  if (!listSentinelRef.value) return;
  sentinelObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && hasMore.value && !convListLoading.value && !convListLoadingMore.value) {
      void fetchConversationsPage(currentOffset.value, true);
    }
  }, { threshold: 0.1 });
  sentinelObserver.observe(listSentinelRef.value);
}

watch(listSentinelRef, (el) => {
  if (el) setupSentinel();
});

onBeforeUnmount(() => {
  sentinelObserver?.disconnect();
});

const selectedConvItem = computed(() =>
  allConvList.value.find((c) => c.conversationUuid === selectedConvUuid.value) ?? null
);

const listFiltersActive = computed(
  () => Boolean(searchQuery.value.trim()) || Boolean(replyTagFilter.value.trim())
);

function selectConversation(item: ConversationListItem) {
  selectedConvUuid.value = item.conversationUuid;
}

// ── Right panel: dialogue ─────────────────────────────────────────────────────

const dialogueMessages = ref<DialogueMessage[]>([]);
const dialogueContact = ref<Record<string, unknown> | null>(null);
const dialogueLoading = ref(false);
const dialogueError = ref("");

function messageDirection(msg: Record<string, unknown>): "inbound" | "outbound" {
  const t = String(msg["type"] ?? msg["linkedin_type"] ?? "").toLowerCase();
  if (t === "outbox") return "outbound";
  return "inbound";
}

async function fetchDialogue(convUuid: string) {
  dialogueLoading.value = true;
  dialogueError.value = "";
  dialogueMessages.value = [];
  dialogueContact.value = null;
  try {
    const r = await fetch(`/api/conversation?conversationUuid=${encodeURIComponent(convUuid)}`);
    const j = await r.json();
    if (j.error) dialogueError.value = j.error;
    dialogueContact.value = j.contact ?? null;
    const msgs = (j.messages ?? []) as Array<Record<string, unknown>>;
    dialogueMessages.value = msgs.map((m, i) => ({
      key: i,
      text: String(m["text"] ?? "—"),
      sentAt: formatDate(m["sent_at"] as string | null),
      sender: String(m["sender"] ?? ""),
      direction: messageDirection(m),
    }));
  } catch (e) {
    dialogueError.value = e instanceof Error ? e.message : "Failed to load messages";
  } finally {
    dialogueLoading.value = false;
  }
}

watch(selectedConvUuid, (uuid) => {
  if (uuid) void fetchDialogue(uuid);
  else { dialogueMessages.value = []; dialogueContact.value = null; dialogueError.value = ""; }
});

// Derived contact info
const contactName = computed(() => {
  const c = dialogueContact.value;
  if (!c) return null;
  if (typeof c.name === "string" && c.name.trim()) return c.name.trim();
  const f = typeof c.first_name === "string" ? c.first_name.trim() : "";
  const l = typeof c.last_name === "string" ? c.last_name.trim() : "";
  return [f, l].filter(Boolean).join(" ") || null;
});
const contactAvatar = computed(() => {
  const v = dialogueContact.value?.avatar_url;
  return typeof v === "string" && v.trim() ? v.trim() : null;
});
const contactPosition = computed(() => {
  const v = dialogueContact.value?.position;
  return typeof v === "string" && v.trim() ? v.trim() : null;
});
const contactCompanyName = computed(() => {
  const v = dialogueContact.value?.company_name;
  return typeof v === "string" && v.trim() ? v.trim() : null;
});
const contactCompanyId = computed(() => {
  const v = dialogueContact.value?.company_id;
  return typeof v === "string" && v.trim() ? v.trim() : null;
});

// ── Hypothesis section ────────────────────────────────────────────────────────

const hypotheses = ref<HypothesisItem[]>([]);
const hypothesesLoading = ref(false);
const hypothesesError = ref("");
const companyProjectCompanyId = ref<string | null>(null);

async function fetchCompanyHypotheses(companyId: string) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) return;
  hypothesesLoading.value = true;
  hypothesesError.value = "";
  try {
    const r = await fetch(`/api/companies/${encodeURIComponent(companyId)}/hypotheses?projectId=${encodeURIComponent(projectId)}`);
    const j = await r.json();
    if (j.error) { hypothesesError.value = j.error; hypotheses.value = []; }
    else {
      hypotheses.value = (j.data ?? []) as HypothesisItem[];
      companyProjectCompanyId.value = j.projectCompanyId ?? null;
    }
  } catch (e) {
    hypothesesError.value = e instanceof Error ? e.message : "Failed";
    hypotheses.value = [];
  } finally {
    hypothesesLoading.value = false;
  }
}

watch(contactCompanyId, (id) => {
  hypotheses.value = [];
  companyProjectCompanyId.value = null;
  if (id) void fetchCompanyHypotheses(id);
});

// Add to hypothesis modal
const addHypModalOpen = ref(false);
const allHypotheses = ref<HypothesisItem[]>([]);
const allHypLoading = ref(false);
const selectedHypId = ref<string | null>(null);
const addingToHyp = ref(false);

async function openAddHypModal() {
  addHypModalOpen.value = true;
  selectedHypId.value = null;
  const projectId = projectStore.selectedProjectId;
  if (!projectId) return;
  allHypLoading.value = true;
  try {
    const r = await fetch(`/api/hypotheses?projectId=${encodeURIComponent(projectId)}`);
    const j = await r.json();
    allHypotheses.value = (j.data ?? []) as HypothesisItem[];
  } catch {
    allHypotheses.value = [];
  } finally {
    allHypLoading.value = false;
  }
}

async function confirmAddToHypothesis() {
  if (!selectedHypId.value) return;
  const projectId = projectStore.selectedProjectId;
  const compId = contactCompanyId.value;
  if (!projectId || !compId) return;

  addingToHyp.value = true;
  try {
    let pcId = companyProjectCompanyId.value;

    // If company is not in project yet, add it first
    if (!pcId) {
      const addR = await fetch("/api/project-companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, companyIds: [compId] }),
      });
      if (!addR.ok) { message.error("Failed to add company to project"); return; }
      // Fetch the new project_company_id
      const pcR = await fetch(`/api/project-companies?projectId=${encodeURIComponent(projectId)}&companyId=${encodeURIComponent(compId)}&limit=1`);
      const pcJ = await pcR.json();
      pcId = (pcJ.data as Array<{ project_company_id: string }>)?.[0]?.project_company_id ?? null;
    }

    if (!pcId) { message.error("Could not resolve project company"); return; }

    const r = await fetch(`/api/hypotheses/${encodeURIComponent(selectedHypId.value)}/targets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectCompanyIds: [pcId] }),
    });
    if (!r.ok) { message.error("Failed to add to hypothesis"); return; }
    message.success("Company added to hypothesis");
    addHypModalOpen.value = false;
    // Refresh hypothesis list
    if (compId) void fetchCompanyHypotheses(compId);
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Error");
  } finally {
    addingToHyp.value = false;
  }
}

const hypSelectOptions = computed(() =>
  allHypotheses.value.map((h) => ({ label: h.name, value: h.id }))
);

const removingHypothesisId = ref<string | null>(null);

async function removeCompanyFromHypothesis(h: HypothesisItem) {
  const pcId = companyProjectCompanyId.value;
  const compId = contactCompanyId.value;
  if (!pcId) {
    message.error("Could not resolve project company for this contact.");
    return;
  }
  removingHypothesisId.value = h.id;
  try {
    const r = await fetch(`/api/hypotheses/${encodeURIComponent(h.id)}/targets`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectCompanyIds: [pcId] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      message.error(typeof j.error === "string" ? j.error : "Failed to remove from hypothesis");
      return;
    }
    message.success(`Removed from “${h.name}”`);
    if (compId) void fetchCompanyHypotheses(compId);
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Error");
  } finally {
    removingHypothesisId.value = null;
  }
}

// ── Attach company (receiver) ─────────────────────────────────────────────────

const attachCompanyOpen = ref(false);

const dialogueContactId = computed(() => {
  const c = dialogueContact.value;
  if (!c) return null;
  const v = c.uuid ?? c.id;
  return typeof v === "string" && v.trim() ? v.trim() : null;
});

function onReceiverCompanyAttached(payload: { companyId: string; companyName: string }) {
  if (!dialogueContact.value) return;
  dialogueContact.value = {
    ...dialogueContact.value,
    company_id: payload.companyId,
    company_name: payload.companyName,
  };
  // Trigger hypothesis fetch for the newly attached company
  void fetchCompanyHypotheses(payload.companyId);
}

// ── Cursor / Start reply ──────────────────────────────────────────────────────

const replyContextOpen = ref(false);

/** Optional: ReplyContextModal "Copy context" still uses /api/build-context + clipboard. */
function onReplyContextBuilt(contextText: string) {
  navigator.clipboard.writeText(contextText).then(() => {
    message.success("Context copied to clipboard");
  });
}

// ── Related contacts section ───────────────────────────────────────────────────

const relatedContacts = ref<ContactWithConversations[]>([]);
const relatedLoading = ref(false);
const relatedError = ref("");

async function fetchRelatedContacts(companyId: string) {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) return;
  relatedLoading.value = true;
  relatedError.value = "";
  try {
    const r = await fetch(`/api/contacts/by-company?companyId=${encodeURIComponent(companyId)}&projectId=${encodeURIComponent(projectId)}`);
    const j = await r.json();
    if (j.error) { relatedError.value = j.error; relatedContacts.value = []; }
    else relatedContacts.value = (j.data ?? []) as ContactWithConversations[];
  } catch (e) {
    relatedError.value = e instanceof Error ? e.message : "Failed";
    relatedContacts.value = [];
  } finally {
    relatedLoading.value = false;
  }
}

watch(contactCompanyId, (id) => {
  relatedContacts.value = [];
  if (id) void fetchRelatedContacts(id);
});

function switchToContactConversation(contact: ContactWithConversations) {
  if (contact.conversations.length === 0) return;
  const convUuid = contact.conversations[0].conversationUuid;
  // Find in list or set directly
  const found = allConvList.value.find((c) => c.conversationUuid === convUuid);
  if (found) {
    selectedConvUuid.value = convUuid;
  } else {
    // Not in list but we can still load it
    selectedConvUuid.value = convUuid;
  }
}

// Filter out current contact from related contacts
const filteredRelatedContacts = computed(() => {
  const leadUuid = selectedConvItem.value?.leadUuid;
  if (!leadUuid) return relatedContacts.value;
  return relatedContacts.value.filter((c) => c.uuid !== leadUuid);
});
</script>

<template>
  <NCard>
    <div class="convpage" :class="{ 'convpage--dragging': isDragging }" ref="containerRef">
      <!-- Left panel: conversation list -->
      <div class="convpage__left" :style="{ width: leftWidth + 'px', minWidth: leftWidth + 'px' }">
        <div class="convpage__left-header">
          <MessageCircleIcon :size="16" />
          <span>Conversations</span>
          <NButton size="tiny" quaternary @click="resetAndFetch" style="margin-left:auto">Refresh</NButton>
        </div>

        <!-- Search + status filter (server-side) -->
        <div class="convpage__search">
          <NInput
            v-model:value="searchInput"
            size="small"
            placeholder="Search by name, company, message…"
            clearable
          >
            <template #prefix><SearchIcon :size="14" style="opacity:0.5" /></template>
          </NInput>
          <NSelect
            v-model:value="replyTagFilter"
            :options="replyTagSelectOptions"
            size="small"
            placeholder="Status"
            class="convpage__tag-filter"
          />
        </div>

        <NSpin :show="convListLoading" class="convpage__spin">
          <NAlert v-if="convListError" type="error" class="convpage__alert">{{ convListError }}</NAlert>
          <NEmpty
            v-else-if="!convListLoading && allConvList.length === 0"
            :description="listFiltersActive ? 'No results for your filters' : 'No conversations found'"
            class="convpage__empty"
          />
          <div v-else class="convpage__list">
            <div
              v-for="item in allConvList"
              :key="item.conversationUuid"
              class="convpage__item"
              :class="{ 'convpage__item--active': item.conversationUuid === selectedConvUuid }"
              @click="selectConversation(item)"
            >
              <!-- Row 1: receiver name + timestamp -->
              <div class="convpage__item-header">
                <div class="convpage__receiver-wrap">
                  <span class="convpage__receiver">{{ item.receiverDisplayName }}</span>
                  <div class="convpage__receiver-sub">
                    {{
                      [item.receiverCompanyName, item.receiverTitle]
                        .filter((x) => typeof x === "string" && x.trim())
                        .join(" · ")
                    }}
                  </div>
                </div>
                <span class="convpage__time">{{ formatDateShort(item.lastMessageAt) }}</span>
              </div>

              <!-- Row 2: last message preview -->
              <div class="convpage__item-preview">{{ truncate(item.lastMessageText) }}</div>

              <!-- Row 3: tags -->
              <div class="convpage__item-tags">
                <!-- Sender -->
                <NTag type="info" size="small" :bordered="false">
                  {{ item.senderDisplayName }}
                </NTag>

                <!-- Response status (API replyTag + legacy fallback from counts) -->
                <template v-for="b in [replyStatusBadge(item)]" :key="`${item.conversationUuid}-status`">
                  <NTag size="small" :bordered="false" :type="b.type">{{ b.label }}</NTag>
                </template>

                <!-- Hypothesis count -->
                <NTag v-if="item.hypothesisCount > 0" size="small" :bordered="false" type="info">
                  In {{ item.hypothesisCount }} hypothesis{{ item.hypothesisCount !== 1 ? "es" : "" }}
                </NTag>

                <!-- Message count -->
                <NTag size="small" :bordered="false" style="--n-color:transparent;--n-text-color:rgba(255,255,255,0.28);--n-font-size:10px;">
                  {{ item.messageCount }} msg{{ item.messageCount !== 1 ? "s" : "" }} · {{ item.inboxCount }}↓ {{ item.outboxCount }}↑
                </NTag>
              </div>
            </div>

            <!-- Infinite scroll sentinel -->
            <div v-if="hasMore" ref="listSentinelRef" class="convpage__sentinel">
              <NSpin v-if="convListLoadingMore" :size="16" />
              <span v-else-if="!hasMore" class="convpage__sentinel-end">All loaded</span>
            </div>
          </div>
        </NSpin>
      </div>

      <!-- Drag divider -->
      <div class="convpage__divider" :class="{ 'convpage__divider--dragging': isDragging }" @mousedown="onDividerMouseDown" />

      <!-- Right panel: dialogue -->
      <div class="convpage__right">
        <div v-if="!selectedConvUuid" class="convpage__empty-right">
          <MessageCircleIcon :size="40" style="opacity:0.3" />
          <p>Select a conversation to view</p>
        </div>

        <template v-else>
          <div class="convpage__dialogue-layout">
            <!-- Message thread -->
            <div class="convpage__messages-col">
              <NSpin :show="dialogueLoading">
                <NAlert v-if="dialogueError" type="error" style="margin-bottom:12px">{{ dialogueError }}</NAlert>
                <div class="convpage__thread">
                  <div v-for="msg in dialogueMessages" :key="msg.key" class="convpage__msg"
                    :class="msg.direction === 'outbound' ? 'convpage__msg--out' : 'convpage__msg--in'">
                    <div class="convpage__bubble">
                      <div class="convpage__msg-meta">
                        <span v-if="msg.sender" class="convpage__msg-sender">{{ msg.sender }}</span>
                        <span class="convpage__msg-time">{{ msg.sentAt }}</span>
                      </div>
                      <div class="convpage__msg-text">{{ msg.text }}</div>
                    </div>
                  </div>
                  <NEmpty v-if="!dialogueLoading && dialogueMessages.length === 0 && !dialogueError"
                    description="No messages" />
                </div>
              </NSpin>
            </div>

            <!-- Sidebar: receiver info + hypotheses + related contacts -->
            <div class="convpage__sidebar">

              <!-- Receiver info -->
              <NCard class="convpage__info-card" size="small">
                <NSpin :show="dialogueLoading">
                  <div v-if="dialogueContact" class="convpage__receiver-info">
                    <div class="convpage__avatar-row">
                      <NAvatar v-if="contactAvatar" :src="contactAvatar" round :size="52" class="convpage__avatar" />
                      <div v-else class="convpage__avatar-placeholder">
                        <UserIcon :size="24" />
                      </div>
                      <div class="convpage__receiver-meta">
                        <h3 class="convpage__receiver-name">{{ contactName || "—" }}</h3>
                        <p v-if="contactPosition" class="convpage__receiver-pos">{{ contactPosition }}</p>
                        <NTag v-if="contactCompanyName || contactCompanyId" type="error" size="small">
                          <BuildingIcon :size="12" style="margin-right:4px;vertical-align:middle" />{{
                          contactCompanyName || contactCompanyId }}
                        </NTag>
                        <NButton
                          v-if="!contactCompanyId && dialogueContactId"
                          class="convpage__attach-button"
                          size="tiny"
                          @click="attachCompanyOpen = true"
                          type="success"
                        >
                          <template #icon><BuildingIcon :size="12" /></template>
                          Attach company from DB
                        </NButton>
                      </div>
                    </div>
                  </div>
                  <div v-else-if="!dialogueLoading" class="convpage__no-contact">
                    <UserIcon :size="20" style="opacity:0.4" />
                    <span style="opacity:0.5">No contact info</span>
                  </div>
                </NSpin>
              </NCard>

              <!-- Hypothesis section -->
              <NCard v-if="contactCompanyId" class="convpage__info-card" size="small">
                <div class="convpage__section-header">
                  <LightbulbIcon :size="14" />
                  <span>Hypotheses</span>
                </div>
                <NSpin :show="hypothesesLoading">
                  <NAlert v-if="hypothesesError" type="error" size="small">{{ hypothesesError }}</NAlert>
                  <div v-else-if="hypotheses.length > 0" class="convpage__hyp-list">
                    <div
                      v-for="h in hypotheses"
                      :key="h.id"
                      class="convpage__hyp-row"
                    >
                      <NTag size="small" type="info" :bordered="false">{{ h.name }}</NTag>
                      <NPopconfirm
                        v-if="companyProjectCompanyId"
                        @positive-click="removeCompanyFromHypothesis(h)"
                      >
                        <template #trigger>
                          <NButton
                            size="tiny"
                            quaternary
                            circle
                            :loading="removingHypothesisId === h.id"
                            :disabled="removingHypothesisId !== null && removingHypothesisId !== h.id"
                            aria-label="Remove from hypothesis"
                          >
                            <template #icon>
                              <XIcon :size="14" />
                            </template>
                          </NButton>
                        </template>
                        Remove this company from “{{ h.name }}”? It stays in the project.
                      </NPopconfirm>
                    </div>
                  </div>
                  <div v-else-if="!hypothesesLoading" class="convpage__hyp-empty">
                    <span>Not in any hypothesis</span>
                    <NButton size="tiny" type="primary" style="margin-top:6px" @click="openAddHypModal">
                      <template #icon>
                        <PlusIcon :size="12" />
                      </template>
                      Add to hypothesis
                    </NButton>
                  </div>
                  <NButton v-if="hypotheses.length > 0" size="tiny" quaternary style="margin-top:6px"
                    @click="openAddHypModal">
                    <template #icon>
                      <PlusIcon :size="12" />
                    </template>
                    Add to more
                  </NButton>
                </NSpin>
              </NCard>

              <!-- Related contacts -->
              <NCard v-if="contactCompanyId" class="convpage__info-card" size="small">
                <div class="convpage__section-header">
                  <UsersIcon :size="14" />
                  <span>Related contacts</span>
                </div>
                <NSpin :show="relatedLoading">
                  <NAlert v-if="relatedError" type="error" size="small">{{ relatedError }}</NAlert>
                  <NEmpty v-else-if="!relatedLoading && filteredRelatedContacts.length === 0"
                    description="No other contacts at this company" :style="{ fontSize: '12px' }" />
                  <div v-else class="convpage__related-list">
                    <div v-for="c in filteredRelatedContacts" :key="c.uuid" class="convpage__related-item">
                      <div class="convpage__related-info">
                        <span class="convpage__related-name">{{ contactDisplayName(c) }}</span>
                        <span v-if="c.position" class="convpage__related-pos">{{ c.position }}</span>
                      </div>
                      <NTooltip v-if="c.conversations.length > 0" placement="left">
                        <template #trigger>
                          <NButton size="tiny" type="primary" quaternary @click="switchToContactConversation(c)">
                            {{ c.conversations.length }} convo{{ c.conversations.length !== 1 ? "s" : "" }}
                          </NButton>
                        </template>
                        <span>{{ c.conversations.length }} conversation{{ c.conversations.length !== 1 ? "s" : "" }} —
                          click to open
                          most recent</span>
                      </NTooltip>
                      <span v-else class="convpage__related-noconv">No convos</span>
                    </div>
                  </div>
                </NSpin>
              </NCard>

              <!-- Cursor block: deeplink / start reply -->
              <NCard class="convpage__info-card" size="small">
                <div class="convpage__section-header">
                  <LinkIcon :size="14" />
                  <span>Cursor</span>
                </div>
                <NButton size="small" type="primary" quaternary block @click="replyContextOpen = true">
                  Start reply conversation
                </NButton>
              </NCard>

            </div>
          </div>
        </template>
      </div>
    </div>
  </NCard>

  <ReplyContextModal
    v-model:show="replyContextOpen"
    :project-id="projectStore.selectedProjectId"
    :contact="dialogueContact"
    :contact-company-id="contactCompanyId"
    :company-project-company-id="companyProjectCompanyId"
    :contact-company-name="contactCompanyName"
    :hypotheses="hypotheses"
    :related-contacts="filteredRelatedContacts"
    @built="onReplyContextBuilt"
  />

  <AttachCompanyModal
    v-model:show="attachCompanyOpen"
    :contact-id="dialogueContactId"
    :contact-name="contactName"
    :initial-search="contactCompanyName ?? ''"
    @attached="onReceiverCompanyAttached"
  />

  <!-- Add to hypothesis modal -->
  <NModal v-model:show="addHypModalOpen" preset="card" title="Add company to hypothesis" style="width:420px"
    :mask-closable="true">
    <NSpin :show="allHypLoading">
      <NEmpty v-if="!allHypLoading && allHypotheses.length === 0"
        description="No hypotheses in this project. Create one first." />
      <NSelect v-else v-model:value="selectedHypId" :options="hypSelectOptions" placeholder="Select hypothesis…"
        style="margin-bottom:16px" />
    </NSpin>
    <NSpace justify="end">
      <NButton @click="addHypModalOpen = false">Cancel</NButton>
      <NButton type="primary" :disabled="!selectedHypId || addingToHyp" :loading="addingToHyp"
        @click="confirmAddToHypothesis">Add</NButton>
    </NSpace>
  </NModal>
</template>

<style scoped>
.convpage {
  display: flex;
  height: calc(100vh - 110px);
  overflow: hidden;
  gap: 0;
}

.convpage--dragging {
  user-select: none;
}

/* Left panel */
.convpage__left {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
  border-right: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.2));
}

.convpage__left-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  font-weight: 600;
  font-size: 13px;
  border-bottom: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.2));
  flex-shrink: 0;
}

.convpage__spin {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.convpage__spin :deep(.n-spin-container) {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.convpage__spin :deep(.n-spin-content) {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.convpage__search {
  padding: 8px 10px;
  border-bottom: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.2));
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.convpage__tag-filter {
  width: 100%;
}

.convpage__alert {
  margin: 12px;
}

.convpage__sentinel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 0;
  min-height: 40px;
}

.convpage__sentinel-end {
  font-size: 11px;
  opacity: 0.3;
}

.convpage__empty {
  padding: 40px 16px;
}

.convpage__list {
  flex: 1;
  overflow-y: auto;
}

.convpage__item {
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.1));
  transition: background 0.15s;
}

.convpage__item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.convpage__item--active {
  background: rgba(99, 143, 242, 0.13);
  border-left: 3px solid #638ff2;
}

.convpage__item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 3px;
}

.convpage__receiver {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.convpage__receiver-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.convpage__receiver-sub {
  font-size: 11px;
  opacity: 0.55;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.convpage__time {
  font-size: 11px;
  opacity: 0.45;
  flex-shrink: 0;
  white-space: nowrap;
}

.convpage__item-preview {
  font-size: 12px;
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 5px;
  line-height: 1.4;
}

.convpage__item-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

/* Divider */
.convpage__divider {
  width: 5px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
  position: relative;
  z-index: 1;
}

.convpage__divider:hover,
.convpage__divider--dragging {
  background: rgba(99, 143, 242, 0.3);
}

/* Right panel */
.convpage__right {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.convpage__empty-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  opacity: 0.5;
  font-size: 14px;
}

.convpage__dialogue-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
  gap: 0;
}

.convpage__attach-button {
  margin-top: 8px;
}

/* Messages column */
.convpage__messages-col {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.convpage__messages-col :deep(.n-spin-container) {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.convpage__messages-col :deep(.n-spin-content) {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.convpage__thread {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.convpage__msg {
  display: flex;
}

.convpage__msg--in {
  justify-content: flex-start;
}

.convpage__msg--out {
  justify-content: flex-end;
}

.convpage__bubble {
  max-width: 72%;
  background: rgba(255, 255, 255, 0.07);
  border-radius: 12px;
  padding: 8px 12px;
}

.convpage__msg--out .convpage__bubble {
  background: rgba(99, 143, 242, 0.2);
  border-bottom-right-radius: 4px;
}

.convpage__msg--in .convpage__bubble {
  border-bottom-left-radius: 4px;
}

.convpage__msg-meta {
  display: flex;
  gap: 8px;
  margin-bottom: 3px;
  align-items: center;
}

.convpage__msg-sender {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.7;
}

.convpage__msg-time {
  font-size: 10px;
  opacity: 0.45;
}

.convpage__msg-text {
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}

/* Sidebar */
.convpage__sidebar {
  width: 280px;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 12px;
  border-left: 1px solid var(--n-border-color, rgba(128, 128, 128, 0.2));
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.convpage__info-card {
  flex-shrink: 0;
}

.convpage__section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
  opacity: 0.8;
}

/* Receiver info */
.convpage__avatar-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.convpage__avatar {
  flex-shrink: 0;
}

.convpage__avatar-placeholder {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.convpage__receiver-meta {
  min-width: 0;
}

.convpage__receiver-name {
  margin: 0 0 2px;
  font-size: 14px;
  font-weight: 600;
}

.convpage__receiver-pos {
  margin: 0 0 2px;
  font-size: 12px;
  opacity: 0.65;
}

.convpage__receiver-company {
  margin: 0;
  font-size: 12px;
  opacity: 0.6;
}

.convpage__no-contact {
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0.5;
  font-size: 13px;
}

/* Hypotheses */
.convpage__hyp-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.convpage__hyp-row {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: nowrap;
}

.convpage__hyp-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  font-size: 12px;
  opacity: 0.65;
}

/* Related contacts */
.convpage__related-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.convpage__related-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.convpage__related-info {
  min-width: 0;
  flex: 1;
}

.convpage__related-name {
  display: block;
  font-size: 12.5px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.convpage__related-pos {
  display: block;
  font-size: 11px;
  opacity: 0.55;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.convpage__related-noconv {
  font-size: 11px;
  opacity: 0.4;
  flex-shrink: 0;
}
</style>
