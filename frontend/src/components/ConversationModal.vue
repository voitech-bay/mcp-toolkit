<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NModal, NSpin, NAlert, NButton, NCode, NTag, NSelect } from "naive-ui";

export interface CursorWorkflowOption {
  label: string;
  prompt: string;
}

const props = defineProps<{
  show: boolean;
  loading: boolean;
  error: string;
  contact?: Record<string, unknown> | null;
  messages: unknown[];
  cursorWorkflowOptions: CursorWorkflowOption[];
}>();

const emit = defineEmits<{
  "update:show": [value: boolean];
  openInCursor: [prompt: string];
}>();

const selectedWorkflowIndex = ref(0);
const optionsForSelect = computed(() =>
  props.cursorWorkflowOptions.map((o, i) => ({ label: o.label, value: i }))
);
const hasWorkflowOptions = computed(() => (props.cursorWorkflowOptions?.length ?? 0) > 0);

watch(
  () => props.cursorWorkflowOptions,
  (opts) => {
    if (opts?.length && selectedWorkflowIndex.value >= opts.length) {
      selectedWorkflowIndex.value = 0;
    }
  },
  { immediate: true }
);

const selectedPromptPreview = computed(() => {
  const opts = props.cursorWorkflowOptions ?? [];
  const idx = selectedWorkflowIndex.value;
  const option = opts[idx];
  return option?.prompt ?? "";
});

function onOpenInCursor() {
  if (selectedPromptPreview.value) emit("openInCursor", selectedPromptPreview.value);
}

function formatSentAt(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }
  if (typeof value === "number") return new Date(value).toLocaleString();
  return String(value);
}

function messageDirection(msg: unknown): "inbound" | "outbound" {
  if (msg != null && typeof msg === "object" && "type" in msg) {
    const d = String((msg as Record<string, unknown>).type).toLowerCase();
    if (d === "inbox") return "inbound";
    if (d === "outbox") return "outbound";
  }
  return "inbound";
}

function messageText(msg: unknown): string {
  if (msg == null) return "—";
  if (typeof msg === "object" && "text" in msg) return String((msg as Record<string, unknown>).text ?? "—");
  return String(msg);
}

function messageSender(msg: unknown): string {
  if (msg != null && typeof msg === "object" && "sender" in msg) {
    const s = (msg as Record<string, unknown>).sender;
    if (s != null && String(s).trim()) return String(s).trim();
  }
  return "";
}

const normalizedMessages = computed(() => {
  const list = Array.isArray(props.messages) ? props.messages : [];
  return list.map((m, i) => ({
    key: i,
    text: messageText(m),
    sentAt: formatSentAt((m as Record<string, unknown>)?.sent_at),
    sender: messageSender(m),
    direction: messageDirection(m),
  }));
});

const contactDisplayName = computed(() => {
  if (!props.contact || typeof props.contact !== "object") return null;
  const c = props.contact as Record<string, unknown>;
  if (typeof c.name === "string" && c.name.trim()) return c.name.trim();
  const first = typeof c.first_name === "string" ? c.first_name.trim() : "";
  const last = typeof c.last_name === "string" ? c.last_name.trim() : "";
  if (first || last) return [first, last].filter(Boolean).join(" ");
  return null;
});

const contactAvatarUrl = computed(() => {
  if (!props.contact || typeof props.contact !== "object") return null;
  const v = (props.contact as Record<string, unknown>).avatar_url;
  return typeof v === "string" && v.trim() ? v.trim() : null;
});

const contactCompany = computed(() => {
  if (!props.contact || typeof props.contact !== "object") return null;
  const v = (props.contact as Record<string, unknown>).company_name;
  return typeof v === "string" && v.trim() ? v.trim() : null;
});

const contactPosition = computed(() => {
  if (!props.contact || typeof props.contact !== "object") return null;
  const v = (props.contact as Record<string, unknown>).position;
  return typeof v === "string" && v.trim() ? v.trim() : null;
});

const CONTACT_PRIMARY_KEYS = ["name", "first_name", "last_name", "company_name", "position", "avatar_url"];
const contactOtherFields = computed(() => {
  if (!props.contact || typeof props.contact !== "object") return [];
  const c = props.contact as Record<string, unknown>;
  const primary = new Set(CONTACT_PRIMARY_KEYS);
  return Object.entries(c)
    .filter(([k, v]) => !primary.has(k) && v != null && v !== "")
    .map(([key, value]) => ({
      key: key.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()),
      value: typeof value === "object" ? JSON.stringify(value) : String(value),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
});
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="Conversation"
    :mask-closable="true"
    class="conversation-modal-fixed"
    @update:show="emit('update:show', $event)"
  >
    <div class="conversation-modal-body">
      <NSpin :show="loading" class="conversation-modal-spin">
        <NAlert v-if="error" type="error" class="conversation-modal-error">
          {{ error }}
        </NAlert>
        <div class="conversation-modal-grid">
        <div class="conversation-modal-messages">
          <p class="conversation-modal-label">Messages ({{ normalizedMessages.length }})</p>
          <div class="conversation-dialogue">
            <div
              v-for="msg in normalizedMessages"
              :key="msg.key"
              class="conversation-message"
              :class="msg.direction"
            >
              <div class="conversation-bubble">
                <div class="conversation-message-header">
                  <NTag
                    :type="msg.direction === 'outbound' ? 'success' : 'default'"
                    size="small"
                    round
                    class="conversation-message-tag"
                  >
                    {{ msg.direction === "outbound" ? "Outbox" : "Inbox" }}
                  </NTag>
                  <div v-if="msg.sender || msg.sentAt" class="conversation-message-meta">
                    <span v-if="msg.sender" class="conversation-message-sender">{{ msg.sender }}</span>
                    <span v-if="msg.sentAt" class="conversation-message-time">{{ msg.sentAt }}</span>
                  </div>
                </div>
                <div class="conversation-message-text">{{ msg.text }}</div>
              </div>
            </div>
            <div v-if="!loading && normalizedMessages.length === 0 && !error" class="conversation-empty">
              No messages in this conversation.
            </div>
          </div>
        </div>
        <aside class="conversation-modal-sidebar">
          <div class="conversation-modal-actions-block">
            <p class="conversation-modal-sidebar-label">Actions</p>
            <NSelect
              v-if="hasWorkflowOptions"
              v-model:value="selectedWorkflowIndex"
              :options="optionsForSelect"
              size="small"
              class="conversation-modal-workflow-select"
            />
            <div v-if="hasWorkflowOptions && selectedPromptPreview" class="conversation-modal-prompt-preview">
              <p class="conversation-modal-sidebar-label">Prompt preview</p>
              <div class="conversation-modal-prompt-preview-text">{{ selectedPromptPreview }}</div>
            </div>
            <NButton
              v-if="hasWorkflowOptions"
              type="primary"
              size="medium"
              block
              class="conversation-modal-open-cursor-btn"
              @click="onOpenInCursor"
            >
              Open in Cursor
            </NButton>
            <span v-if="hasWorkflowOptions" class="conversation-modal-actions-hint">
              Opens Cursor with the selected workflow prompt
            </span>
          </div>
          <div v-if="contact && !loading" class="conversation-meta-block">
            <p class="conversation-meta-aka">A.k.a. real social profile</p>
            <div class="conversation-meta-profile">
              <div class="conversation-meta-avatar-wrap">
                <img
                  v-if="contactAvatarUrl"
                  :src="contactAvatarUrl"
                  alt=""
                  class="conversation-meta-avatar"
                  @error="(e: Event) => ((e.target as HTMLImageElement).style.display = 'none')"
                />
                <div v-else class="conversation-meta-avatar-placeholder">
                  {{ (contactDisplayName || '?').charAt(0).toUpperCase() }}
                </div>
              </div>
              <h3 class="conversation-meta-name">{{ contactDisplayName || '—' }}</h3>
              <p v-if="contactCompany" class="conversation-meta-company">{{ contactCompany }}</p>
              <p v-if="contactPosition" class="conversation-meta-position">{{ contactPosition }}</p>
            </div>
            <div v-if="contactOtherFields.length > 0" class="conversation-meta-other">
              <dl class="conversation-meta-dl">
                <template v-for="f in contactOtherFields" :key="f.key">
                  <dt class="conversation-meta-dt">{{ f.key }}</dt>
                  <dd class="conversation-meta-dd">{{ f.value }}</dd>
                </template>
              </dl>
            </div>
            <details class="conversation-meta-details">
              <summary>All fields (JSON)</summary>
              <NCode
                :code="JSON.stringify(contact, null, 2)"
                language="json"
                word-wrap
                class="conversation-meta-json"
              />
            </details>
          </div>
          <div v-else-if="!loading" class="conversation-meta-block conversation-meta-block-minimal">
            <p class="conversation-modal-sidebar-label">Meta</p>
            <div class="conversation-meta-row">
              <span class="conversation-meta-key">Messages</span>
              <span class="conversation-meta-value">{{ normalizedMessages.length }}</span>
            </div>
          </div>
        </aside>
      </div>
      </NSpin>
    </div>
  </NModal>
</template>
<style>
.conversation-modal-fixed {
  max-width: 1400px;
}
</style>

<style scoped>
.conversation-modal-body {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.conversation-modal-spin {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
.conversation-modal-error {
  margin-bottom: 0.75rem;
}
.conversation-modal-grid {
  display: grid;
  grid-template-columns: 1fr 420px;
  gap: 1rem;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
@media (max-width: 560px) {
  .conversation-modal-grid {
    grid-template-columns: 1fr;
  }
}
.conversation-modal-messages {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.conversation-modal-label {
  font-size: 0.85rem;
  font-weight: 600;
  margin: 0 0 0.5rem 0;
  opacity: 0.9;
}
.conversation-dialogue {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.25rem 0;
}
.conversation-message {
  display: flex;
  width: 100%;
}
.conversation-message.inbound {
  justify-content: flex-start;
}
.conversation-message.outbound {
  justify-content: flex-end;
}
.conversation-bubble {
  max-width: 88%;
  padding: 0.5rem 0.75rem;
  border-radius: 12px;
  word-break: break-word;
  border: 1px solid var(--n-border-color);
}
.conversation-message-header {
  margin-bottom: 0.35rem;
}
.conversation-message-tag {
  margin-right: 0.35rem;
}
.conversation-message-meta {
  display: inline-flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.7rem;
  opacity: 0.9;
}
.conversation-message-sender {
  font-weight: 600;
}
.conversation-message-time {
  opacity: 0.85;
}
.conversation-message-text {
  font-size: 0.9rem;
  white-space: pre-wrap;
}
.conversation-empty {
  text-align: center;
  color: var(--n-text-color-3);
  font-size: 0.9rem;
  padding: 1rem;
}

.conversation-modal-sidebar {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.5rem 0;
  border-left: 1px solid var(--n-border-color);
  padding-left: 1rem;
}
@media (max-width: 560px) {
  .conversation-modal-sidebar {
    border-left: none;
    padding-left: 0;
    border-top: 1px solid var(--n-border-color);
    padding-top: 1rem;
  }
}
.conversation-modal-sidebar-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin: 0 0 0.5rem 0;
  opacity: 0.85;
}
.conversation-modal-workflow-select {
  width: 100%;
  margin-bottom: 0.5rem;
}
.conversation-modal-prompt-preview {
  margin-bottom: 0.5rem;
}
.conversation-modal-prompt-preview-text {
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--n-text-color-2);
  background: var(--n-color-modal);
  border: 1px solid var(--n-border-color);
  border-radius: 6px;
  padding: 0.5rem 0.6rem;
  max-height: 80px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.conversation-modal-open-cursor-btn {
  margin-bottom: 0.35rem;
}
.conversation-modal-actions-block :deep(.n-button) {
  margin-bottom: 0.35rem;
}
.conversation-modal-actions-hint {
  font-size: 0.7rem;
  opacity: 0.75;
  display: block;
}
.conversation-modal-meta-block {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.conversation-meta-aka {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--n-text-color-3);
  margin: 0 0 0.25rem 0;
}
.conversation-meta-profile {
  text-align: center;
  padding: 0.75rem;
  background: var(--n-color-modal);
  border: 1px solid var(--n-border-color);
  border-radius: 10px;
}
.conversation-meta-avatar-wrap {
  margin-bottom: 0.5rem;
}
.conversation-meta-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
  margin: 0 auto;
  background: var(--n-color-modal);
}
.conversation-meta-avatar-placeholder {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--n-primary-color);
  color: var(--n-primary-color-overlay);
  font-size: 1.5rem;
  font-weight: 600;
}
.conversation-meta-name {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 0.25rem 0;
  line-height: 1.3;
  word-break: break-word;
}
.conversation-meta-company {
  font-size: 0.85rem;
  color: var(--n-text-color-2);
  margin: 0 0 0.15rem 0;
  line-height: 1.3;
}
.conversation-meta-position {
  font-size: 0.8rem;
  color: var(--n-text-color-3);
  margin: 0;
  line-height: 1.3;
}
.conversation-meta-stats {
  font-size: 0.75rem;
  color: var(--n-text-color-3);
}
.conversation-meta-other {
  padding-top: 0.5rem;
}
.conversation-meta-other-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 0.35rem 0;
  opacity: 0.85;
}
.conversation-meta-dl {
  margin: 0;
  font-size: 0.78rem;
  display: grid;
  gap: 0.2rem 0.5rem;
  grid-template-columns: auto 1fr;
  align-items: baseline;
}
.conversation-meta-dt {
  margin: 0;
  color: var(--n-text-color-3);
  font-weight: 500;
}
.conversation-meta-dd {
  margin: 0;
  word-break: break-word;
}
.conversation-meta-details {
  font-size: 0.75rem;
  margin-top: 0.25rem;
}
.conversation-meta-details summary {
  cursor: pointer;
  opacity: 0.85;
}
.conversation-meta-json {
  max-height: 120px;
  overflow: auto;
  margin-top: 0.35rem;
  font-size: 0.68rem;
}
.conversation-meta-block-minimal .conversation-meta-row {
  margin-bottom: 0;
}
.conversation-meta-row {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.8rem;
  margin-bottom: 0.25rem;
}
.conversation-meta-key {
  opacity: 0.8;
}
.conversation-meta-value {
  font-weight: 500;
}
</style>
