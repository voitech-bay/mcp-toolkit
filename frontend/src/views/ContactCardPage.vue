<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  NCard,
  NSpace,
  NTag,
  NAlert,
  NSpin,
  NButton,
  NAvatar,
  NCollapse,
  NCollapseItem,
  NInput,
  NText,
  NDivider,
  NDrawer,
  NDrawerContent,
  NSelect,
  useMessage,
} from "naive-ui";
import FeasibleComposer from "../components/FeasibleComposer.vue";

type Json = Record<string, unknown>;

interface ExperienceEntry {
  company_name: string | null;
  position: string | null;
  employment_type: string | null;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
}

interface Thread {
  conversation_uuid: string;
  message_count: number;
  inbox_count: number;
  outbox_count: number;
  last_message_at: string | null;
  last_message_text: string | null;
  reply_status: string;
  messages: Array<{ text: string | null; type: string | null; sent_at: string | null; subject: string | null; linkedin_type?: string | null; sender_profile_uuid?: string | null; sender_display_name?: string | null; channel_label?: string }>;
}

const CATEGORY_OPTIONS = [
  { label: "Founder / CEO", value: "Founder/CEO" },
  { label: "Business Leader", value: "Business Leader" },
  { label: "Technical Leader", value: "Technical Leader" },
  { label: "Engineer", value: "Engineer" },
  { label: "Sales", value: "Sales" },
  { label: "Other", value: "Other" },
];
const PRIORITY_OPTIONS = [
  { label: "Top", value: "Top" },
  { label: "High", value: "High" },
  { label: "Medium", value: "Medium" },
  { label: "Low", value: "Low" },
];

const route = useRoute();
const router = useRouter();
const message = useMessage();

const loading = ref(false);
const loadError = ref("");
const card = ref<Json | null>(null);
const noteDraft = ref("");
const savingNote = ref(false);
const runningResearch = ref(false);
const rawDrawerOpen = ref(false);
const rawDrawerTitle = ref("");
const rawDrawerJson = ref("");
const savingMeta = ref(false);

const contactUuid = computed(() => String(route.params.uuid ?? ""));
const contact = computed<Json>(() => (card.value?.contact as Json) ?? {});
const company = computed<Json | null>(() => (card.value?.company as Json) ?? null);
const latestResults = computed<Json[]>(() => (card.value?.latest_results as Json[]) ?? []);
const executions = computed<Json[]>(() => (card.value?.executions as Json[]) ?? []);
const threads = computed<Thread[]>(() => (card.value?.conversations as Thread[]) ?? []);
const contextEntries = computed<Json[]>(() => (card.value?.context_entries as Json[]) ?? []);
const generatedMessages = computed<Json[]>(() => (card.value?.generated_messages as Json[]) ?? []);

const leadCategory = ref<string | null>(null);
const priority = ref<string | null>(null);

const displayName = computed(() => {
  const c = contact.value;
  return (
    (typeof c.name === "string" && c.name) ||
    [c.first_name, c.last_name].filter((x) => typeof x === "string" && x).join(" ") ||
    contactUuid.value.slice(0, 8)
  );
});

/** Parse experience JSON string from Contacts.experience */
const parsedExperience = computed<ExperienceEntry[]>(() => {
  const raw = contact.value.experience;
  if (!raw || typeof raw !== "string") return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr as ExperienceEntry[];
  } catch {
    return [];
  }
});

/** Latest experience entry at the current target company. */
const targetExperience = computed<ExperienceEntry | null>(() => {
  if (!parsedExperience.value.length) return null;
  const companyName = (company.value?.name as string | null) ?? (contact.value.company_name as string | null) ?? "";
  if (!companyName) return parsedExperience.value[0] ?? null;
  const match = parsedExperience.value.find(
    (e) => e.company_name && companyName.toLowerCase().includes(e.company_name.toLowerCase())
  ) ?? parsedExperience.value[0];
  return match ?? null;
});

/** Connection status derived from messages: any linkedin_type='message' = accepted. */
const connectionStatus = computed<"accepted" | "sent" | "none">(() => {
  const allMsgs = threads.value.flatMap((t) => t.messages);
  const hasMsg = allMsgs.some((m) => (m.linkedin_type ?? "") === "message");
  if (hasMsg) return "accepted";
  const hasSentConn = allMsgs.some((m) => (m.linkedin_type ?? "") === "connection_note");
  return hasSentConn ? "sent" : "none";
});

/** Aggregate reply status across all threads. */
const overallReplyStatus = computed<string>(() => {
  const statuses = threads.value.map((t) => t.reply_status);
  if (statuses.includes("got_response")) return "got_response";
  if (statuses.includes("waiting_for_response")) return "waiting_for_response";
  return "no_response";
});

function fmtDate(s: unknown): string {
  if (typeof s !== "string" || !s) return "";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function fmtYear(s: string | null): string {
  if (!s) return "";
  try {
    return new Date(s).getFullYear().toString();
  } catch {
    return "";
  }
}

function replyStatusType(s: string): "default" | "success" | "warning" {
  if (s === "got_response") return "success";
  if (s === "waiting_for_response") return "warning";
  return "default";
}

function connTagType(s: string): "error" | "success" | "warning" {
  if (s === "accepted") return "success";
  if (s === "sent") return "warning";
  return "error";
}

function scalarFields(result: unknown): Array<[string, string]> {
  if (!result || typeof result !== "object") return [];
  const skip = new Set(["full_json", "clean_full_json", "lead", "row_data", "workflow_context", "experience", "posts"]);
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(result as Json)) {
    if (skip.has(k)) continue;
    if (v == null || v === "") continue;
    if (typeof v === "string" && v.length <= 600) out.push([k, v]);
    else if (typeof v === "number" || typeof v === "boolean") out.push([k, String(v)]);
    else if (Array.isArray(v) && v.every((x) => typeof x === "string") && v.length <= 12) out.push([k, v.join(" | ")]);
  }
  return out;
}

function openRaw(title: string, obj: unknown) {
  rawDrawerTitle.value = title;
  rawDrawerJson.value = JSON.stringify(obj, null, 2);
  rawDrawerOpen.value = true;
}

async function load() {
  if (!contactUuid.value) return;
  loading.value = true;
  loadError.value = "";
  try {
    const r = await fetch(`/api/cards/contact?uuid=${encodeURIComponent(contactUuid.value)}`);
    const data = (await r.json()) as Json & { error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed to load");
    card.value = data;
    leadCategory.value = (data.contact as Json)?.lead_category as string | null ?? null;
    priority.value = (data.contact as Json)?.priority as string | null ?? null;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "Failed to load";
    card.value = null;
  } finally {
    loading.value = false;
  }
}

async function saveMeta() {
  savingMeta.value = true;
  try {
    const r = await fetch(`/api/contacts/meta?uuid=${encodeURIComponent(contactUuid.value)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_category: leadCategory.value, priority: priority.value }),
    });
    const data = (await r.json()) as { error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed");
    message.success("Saved.");
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to save");
  } finally {
    savingMeta.value = false;
  }
}

async function addNote() {
  const text = noteDraft.value.trim();
  if (!text) return;
  savingNote.value = true;
  try {
    const r = await fetch("/api/contact-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: contactUuid.value, rootContext: text }),
    });
    const data = (await r.json()) as { error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed");
    noteDraft.value = "";
    message.success("Context saved.");
    await load();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Failed to save context");
  } finally {
    savingNote.value = false;
  }
}

async function runResearch() {
  runningResearch.value = true;
  try {
    const r = await fetch("/api/inmail-review/run-new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadUuid: contactUuid.value }),
    });
    const data = (await r.json()) as { error?: string };
    if (!r.ok) throw new Error(data.error ?? "Run failed");
    message.success("Research run started. Results land here in a few minutes — refresh to see them.");
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Run failed");
  } finally {
    runningResearch.value = false;
  }
}

onMounted(load);
watch(contactUuid, load);
</script>

<template>
  <NSpin :show="loading">
    <NAlert v-if="loadError" type="error" style="margin-bottom: 12px">{{ loadError }}</NAlert>

    <NSpace v-if="card" vertical size="medium" style="width: 100%">
      <!-- Header -->
      <NCard>
        <NSpace align="center" justify="space-between" wrap>
          <NSpace align="center" size="large">
            <NAvatar round :size="56" :src="(contact.avatar_url as string) || undefined">
              {{ displayName.charAt(0).toUpperCase() }}
            </NAvatar>
            <div>
              <h2 style="margin: 0">{{ displayName }}</h2>
              <div style="margin-top: 2px">
                <NText depth="2" style="font-size:0.95rem;font-weight:500">{{ contact.position || "—" }}</NText>
              </div>
              <div v-if="contact.headline && contact.headline !== contact.position" style="margin-top: 2px">
                <NText depth="3" style="font-size:0.85rem">{{ contact.headline }}</NText>
              </div>
              <div style="margin-top: 6px">
                <router-link
                  v-if="company"
                  :to="`/company/${company.id}`"
                  class="card-link"
                >{{ company.name || company.domain }}</router-link>
                <NText v-else-if="contact.company_name" depth="3">{{ contact.company_name }} (unlinked)</NText>
                <a
                  v-if="contact.linkedin_url || contact.linkedin"
                  :href="String(contact.linkedin_url || contact.linkedin).startsWith('http') ? String(contact.linkedin_url || contact.linkedin) : `https://www.linkedin.com/in/${contact.linkedin_url || contact.linkedin}`"
                  target="_blank"
                  rel="noopener"
                  class="card-link"
                  style="margin-left: 12px"
                >LinkedIn ↗</a>
              </div>
            </div>
          </NSpace>
          <NSpace>
            <NButton size="small" :loading="runningResearch" @click="runResearch">Run research + InMail</NButton>
            <NButton size="small" @click="router.push('/inmail-review')">InMail review</NButton>
          </NSpace>
        </NSpace>
        <NDivider style="margin: 12px 0" />
        <!-- Status badges row -->
        <NSpace size="small" wrap>
          <NTag size="small" bordered :type="connTagType(connectionStatus)">{{ connectionStatus === 'accepted' ? 'Connected' : connectionStatus === 'sent' ? 'Connection Sent' : 'Not Connected' }}</NTag>
          <NTag size="small" :type="replyStatusType(overallReplyStatus)">{{ overallReplyStatus.replace(/_/g, ' ') }}</NTag>
          <NTag v-if="contact.email_status" size="small">email: {{ contact.email_status }}</NTag>
          <NTag v-if="contact.work_email" size="small" type="info">{{ contact.work_email }}</NTag>
          <NText depth="3" style="font-size: 0.8rem">synced {{ fmtDate(contact.updated_at) }}</NText>
        </NSpace>
        <NDivider style="margin: 12px 0" />
        <!-- Editable: Category + Priority -->
        <NSpace size="small" align="center" wrap>
          <NSelect
            v-model:value="leadCategory"
            :options="CATEGORY_OPTIONS"
            placeholder="Category"
            clearable
            size="small"
            style="width: 180px"
          />
          <NSelect
            v-model:value="priority"
            :options="PRIORITY_OPTIONS"
            placeholder="Priority"
            clearable
            size="small"
            style="width: 130px"
          />
          <NButton size="small" type="primary" :loading="savingMeta" @click="saveMeta">Save</NButton>
        </NSpace>
      </NCard>

      <!-- Profile snapshot (experience at target company) -->
      <NCard v-if="targetExperience" title="Profile" size="small">
        <div style="font-weight:600;margin-bottom:4px">{{ targetExperience.position }}</div>
        <NText depth="3" style="font-size:0.82rem">
          {{ targetExperience.company_name }}
          <template v-if="targetExperience.start_date"> · {{ fmtYear(targetExperience.start_date) }}–{{ targetExperience.end_date ? fmtYear(targetExperience.end_date) : 'present' }}</template>
        </NText>
        <div v-if="targetExperience.description" style="margin-top:8px;font-size:0.85rem;white-space:pre-wrap">{{ targetExperience.description }}</div>
      </NCard>

      <!-- Feasible message agent -->
      <NCard title="Feasible outreach agent" size="small" data-testid="feasible-outreach-agent">
        <FeasibleComposer
          :lead-uuid="contactUuid"
          :contact-name="displayName"
          :connected="connectionStatus === 'accepted'"
          :email="typeof contact.work_email === 'string' ? contact.work_email : undefined"
        />
      </NCard>

      <!-- Research -->
      <NCard title="Research (n8n)" size="small">
        <template #header-extra>
          <NText depth="3" style="font-size: 0.8rem">{{ executions.length }} executions total</NText>
        </template>
        <NText v-if="!latestResults.length" depth="3">no research yet — use Run research + InMail above</NText>
        <NCollapse v-else>
          <NCollapseItem
            v-for="r in latestResults"
            :key="String(r.id)"
            :title="`${r.workflow_name || 'result'} — ${fmtDate(r.created_at)}`"
            :name="String(r.id)"
          >
            <template #header-extra>
              <NButton size="tiny" quaternary @click.stop="openRaw(String(r.workflow_name || 'result'), r.result)">raw JSON</NButton>
            </template>
            <div class="kv-grid">
              <template v-for="[k, v] in scalarFields(r.result)" :key="k">
                <div class="kv-key">{{ k }}</div>
                <div class="kv-val">{{ v }}</div>
              </template>
            </div>
          </NCollapseItem>
        </NCollapse>
      </NCard>

      <!-- Conversations -->
      <NCard :title="`Conversations (${threads.length})`" size="small">
        <NText v-if="!threads.length" depth="3">no conversations yet</NText>
        <NCollapse v-else>
          <NCollapseItem
            v-for="t in threads"
            :key="t.conversation_uuid"
            :name="t.conversation_uuid"
          >
            <template #header>
              <NSpace align="center" size="small">
                <NTag size="tiny" :type="replyStatusType(t.reply_status)">{{ t.reply_status }}</NTag>
                <span>{{ t.message_count }} msgs · {{ fmtDate(t.last_message_at) }}</span>
                <NText depth="3" style="font-size: 0.8rem">{{ (t.last_message_text || "").slice(0, 70) }}</NText>
              </NSpace>
            </template>
            <div v-for="(m, i) in t.messages" :key="i" class="msg" :class="{ inbox: (m.type || '').toLowerCase() === 'inbox' }">
              <NText depth="3" style="font-size: 0.72rem">{{ (m.type || '').toLowerCase() === 'inbox' ? displayName : (m.sender_display_name || 'Unknown sender') }} · {{ m.channel_label || 'LinkedIn' }} · {{ fmtDate(m.sent_at) }}</NText>
              <div v-if="m.subject" class="msg-subject"><strong>Subject:</strong> {{ m.subject }}</div>
              <div>{{ m.text }}</div>
            </div>
          </NCollapseItem>
        </NCollapse>
      </NCard>

      <!-- Generated messages -->
      <NCard v-if="generatedMessages.length" :title="`Generated messages (${generatedMessages.length})`" size="small">
        <div v-for="g in generatedMessages" :key="String(g.id)" class="msg">
          <NText depth="3" style="font-size: 0.72rem">{{ fmtDate(g.created_at) }}</NText>
          <div style="white-space: pre-wrap">{{ g.content }}</div>
        </div>
      </NCard>

      <!-- Context notes -->
      <NCard :title="`Context notes (${contextEntries.length})`" size="small">
        <NSpace vertical size="small">
          <div v-for="e in contextEntries" :key="String(e.id)" class="msg">
            <NText depth="3" style="font-size: 0.72rem">{{ fmtDate(e.created_at) }}</NText>
            <div style="white-space: pre-wrap">{{ e.rootContext }}</div>
          </div>
          <NSpace align="center" style="width: 100%">
            <NInput
              v-model:value="noteDraft"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 4 }"
              placeholder="add a context note for this contact"
              style="flex: 1; min-width: 320px"
            />
            <NButton size="small" type="primary" :loading="savingNote" :disabled="!noteDraft.trim()" @click="addNote">Add</NButton>
          </NSpace>
        </NSpace>
      </NCard>
    </NSpace>

    <NDrawer v-model:show="rawDrawerOpen" :width="560" placement="right">
      <NDrawerContent :title="rawDrawerTitle" closable>
        <pre class="json-pre">{{ rawDrawerJson }}</pre>
      </NDrawerContent>
    </NDrawer>
  </NSpin>
</template>

<style scoped>
.card-link {
  color: #2080f0;
  text-decoration: none;
}
.card-link:hover {
  text-decoration: underline;
}
.kv-grid {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 4px 12px;
  font-size: 0.85rem;
}
.kv-key {
  opacity: 0.65;
  word-break: break-word;
}
.kv-val {
  white-space: pre-wrap;
  word-break: break-word;
}
.msg {
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(128, 128, 128, 0.07);
  margin-bottom: 6px;
  font-size: 0.85rem;
}
.msg.inbox {
  background: rgba(32, 128, 240, 0.09);
}
.json-pre {
  margin: 0;
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 80vh;
  overflow: auto;
}
</style>
