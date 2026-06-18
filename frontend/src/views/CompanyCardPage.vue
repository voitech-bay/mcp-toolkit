<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import {
  NCard,
  NSpace,
  NTag,
  NAlert,
  NSpin,
  NButton,
  NCollapse,
  NCollapseItem,
  NInput,
  NText,
  NDivider,
  NDrawer,
  NDrawerContent,
  NDataTable,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { h } from "vue";
import { RouterLink } from "vue-router";

type Json = Record<string, unknown>;

interface Activity {
  thread_count: number;
  inbox_count: number;
  outbox_count: number;
  last_message_at: string | null;
  reply_status: string;
}
interface RosterRow extends Json {
  uuid: string;
  activity: Activity | null;
}
interface Thread {
  conversation_uuid: string;
  lead_uuid: string | null;
  message_count: number;
  inbox_count: number;
  last_message_at: string | null;
  last_message_text: string | null;
  reply_status: string;
  messages: Array<{ text: string | null; type: string | null; sent_at: string | null }>;
}
interface SummaryEntry {
  generated_at: string;
  message_watermark: number;
  model: string;
  data: {
    account_summary?: string;
    per_contact?: Array<{ name?: string; key_points?: string[]; stance?: string }>;
    suggested_next_step?: string;
  };
}

const route = useRoute();
const message = useMessage();

const loading = ref(false);
const loadError = ref("");
const card = ref<Json | null>(null);
const noteDraft = ref("");
const savingNote = ref(false);
const summarizing = ref(false);
const rawDrawerOpen = ref(false);
const rawDrawerTitle = ref("");
const rawDrawerJson = ref("");

const companyId = computed(() => String(route.params.id ?? ""));
const company = computed<Json>(() => (card.value?.company as Json) ?? {});
const latestResults = computed<Json[]>(() => (card.value?.latest_results as Json[]) ?? []);
const roster = computed<RosterRow[]>(() => (card.value?.contacts as RosterRow[]) ?? []);
const threads = computed<Thread[]>(() => (card.value?.conversations as Thread[]) ?? []);
const contextEntries = computed<Json[]>(() => (card.value?.context_entries as Json[]) ?? []);
const summary = computed<SummaryEntry | null>(() => (card.value?.account_summary as SummaryEntry) ?? null);
const summaryStale = computed(() => Boolean(card.value?.account_summary_stale));

const nameByLead = computed(() => {
  const m = new Map<string, string>();
  for (const r of roster.value) {
    const label =
      (typeof r.name === "string" && r.name) ||
      [r.first_name, r.last_name].filter((x) => typeof x === "string" && x).join(" ") ||
      r.uuid.slice(0, 8);
    m.set(r.uuid, label);
  }
  return m;
});

/** City, Country from hq_location jsonb or hq_raw_address fallback. */
const companyHq = computed<string | null>(() => {
  const loc = company.value.hq_location;
  if (loc && typeof loc === "object") {
    const o = loc as Json;
    const city = typeof o.city === "string" ? o.city : null;
    const country = typeof o.country === "string" ? o.country : null;
    const r = [city, country].filter(Boolean).join(", ");
    if (r) return r;
  }
  const raw = company.value.hq_raw_address;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
});

function fmtDate(s: unknown): string {
  if (typeof s !== "string" || !s) return "";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function statusType(s: string): "default" | "success" | "warning" {
  if (s === "got_response") return "success";
  if (s === "waiting_for_response") return "warning";
  return "default";
}

function scalarFields(result: unknown): Array<[string, string]> {
  if (!result || typeof result !== "object") return [];
  const skip = new Set(["full_json", "clean_full_json", "lead", "row_data", "workflow_context"]);
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(result as Json)) {
    if (skip.has(k) || v == null || v === "") continue;
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

const rosterColumns = computed<DataTableColumns<RosterRow>>(() => [
  {
    title: "Contact",
    key: "name",
    minWidth: 200,
    render: (row) =>
      h(
        RouterLink,
        { to: `/contact/${row.uuid}`, class: "card-link" },
        { default: () => nameByLead.value.get(row.uuid) ?? row.uuid.slice(0, 8) }
      ),
  },
  { title: "Position", key: "position", minWidth: 180, ellipsis: { tooltip: true } },
  {
    title: "Conversations",
    key: "threads",
    width: 120,
    render: (row) => (row.activity ? `${row.activity.thread_count} (${row.activity.inbox_count}↓ ${row.activity.outbox_count}↑)` : "—"),
  },
  {
    title: "Status",
    key: "status",
    width: 170,
    render: (row) =>
      row.activity
        ? h(NTag, { size: "small", type: statusType(row.activity.reply_status) }, { default: () => row.activity!.reply_status })
        : h(NText, { depth: 3 }, { default: () => "no outreach" }),
  },
  {
    title: "Last activity",
    key: "last",
    width: 170,
    render: (row) => (row.activity?.last_message_at ? fmtDate(row.activity.last_message_at) : "—"),
  },
]);

async function load() {
  if (!companyId.value) return;
  loading.value = true;
  loadError.value = "";
  try {
    const r = await fetch(`/api/cards/company?id=${encodeURIComponent(companyId.value)}`);
    const data = (await r.json()) as Json & { error?: string };
    if (!r.ok) throw new Error(data.error ?? "Failed to load");
    card.value = data;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "Failed to load";
    card.value = null;
  } finally {
    loading.value = false;
  }
}

async function regenerateSummary() {
  summarizing.value = true;
  try {
    const r = await fetch("/api/cards/company-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: companyId.value }),
    });
    const data = (await r.json()) as { error?: string };
    if (!r.ok) throw new Error(data.error ?? "Summary failed");
    message.success("Account summary refreshed.");
    await load();
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Summary failed");
  } finally {
    summarizing.value = false;
  }
}

async function addNote() {
  const text = noteDraft.value.trim();
  if (!text) return;
  savingNote.value = true;
  try {
    const r = await fetch("/api/company-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId.value, rootContext: text }),
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

onMounted(load);
watch(companyId, load);
</script>

<template>
  <NSpin :show="loading">
    <NAlert v-if="loadError" type="error" style="margin-bottom: 12px">{{ loadError }}</NAlert>

    <NSpace v-if="card" vertical size="medium" style="width: 100%">
      <!-- Header -->
      <NCard>
        <NSpace align="center" justify="space-between" wrap>
          <div>
            <h2 style="margin: 0">{{ company.name || company.domain }}</h2>
            <NSpace size="small" align="center" style="margin-top: 6px" wrap>
              <a
                v-if="company.domain"
                :href="String(company.website || `https://${company.domain}`)"
                target="_blank"
                rel="noopener"
                class="card-link"
              >{{ company.domain }} ↗</a>
              <NTag v-if="company.industry" size="small">{{ company.industry }}</NTag>
              <NTag v-if="company.employees_on_linkedin" size="small" type="info">
                {{ Number(company.employees_on_linkedin).toLocaleString() }} employees on LinkedIn
              </NTag>
              <NTag v-else-if="company.employees_range" size="small">{{ company.employees_range }} employees</NTag>
              <NText v-if="companyHq" depth="3" style="font-size: 0.85rem">{{ companyHq }}</NText>
            </NSpace>
          </div>
        </NSpace>
        <template v-if="company.about">
          <NDivider style="margin: 12px 0" />
          <NText depth="3" style="font-size: 0.85rem">{{ String(company.about).slice(0, 400) }}</NText>
        </template>
      </NCard>

      <!-- Account summary -->
      <NCard title="Account summary" size="small">
        <template #header-extra>
          <NSpace align="center" size="small">
            <NTag v-if="summaryStale" size="small" type="warning">stale — new messages since generated</NTag>
            <NButton size="small" type="primary" :loading="summarizing" @click="regenerateSummary">
              {{ summary ? "Regenerate" : "Generate" }}
            </NButton>
          </NSpace>
        </template>
        <template v-if="summary">
          <p style="margin-top: 0">{{ summary.data.account_summary }}</p>
          <div v-for="(pc, i) in summary.data.per_contact ?? []" :key="i" class="msg">
            <NSpace align="center" size="small">
              <strong>{{ pc.name }}</strong>
              <NTag size="tiny" :type="pc.stance === 'positive' ? 'success' : pc.stance === 'negative' ? 'error' : 'default'">{{ pc.stance }}</NTag>
            </NSpace>
            <ul style="margin: 4px 0 0; padding-left: 18px">
              <li v-for="(kp, j) in pc.key_points ?? []" :key="j">{{ kp }}</li>
            </ul>
          </div>
          <NAlert v-if="summary.data.suggested_next_step" type="info" style="margin-top: 8px">
            Next step: {{ summary.data.suggested_next_step }}
          </NAlert>
          <NText depth="3" style="font-size: 0.72rem">generated {{ fmtDate(summary.generated_at) }} · {{ summary.model }}</NText>
        </template>
        <NText v-else depth="3">no summary yet — Generate builds one from all conversations at this account</NText>
      </NCard>

      <!-- Contacts roster -->
      <NCard :title="`Contacts (${roster.length})`" size="small">
        <NDataTable :columns="rosterColumns" :data="roster" size="small" :max-height="420" striped />
      </NCard>

      <!-- Company research -->
      <NCard title="Company research (n8n)" size="small">
        <NText v-if="!latestResults.length" depth="3">no company research yet</NText>
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

      <!-- Account conversations rollup -->
      <NCard :title="`Account conversations (${threads.length})`" size="small">
        <NText v-if="!threads.length" depth="3">no conversations at this account yet</NText>
        <NCollapse v-else>
          <NCollapseItem v-for="t in threads" :key="t.conversation_uuid" :name="t.conversation_uuid">
            <template #header>
              <NSpace align="center" size="small">
                <strong>{{ nameByLead.get(t.lead_uuid ?? "") ?? "unknown" }}</strong>
                <NTag size="tiny" :type="statusType(t.reply_status)">{{ t.reply_status }}</NTag>
                <span>{{ t.message_count }} msgs · {{ fmtDate(t.last_message_at) }}</span>
              </NSpace>
            </template>
            <div
              v-for="(m, i) in t.messages"
              :key="i"
              class="msg"
              :class="{ inbox: (m.type || '').toLowerCase() === 'inbox' }"
            >
              <NText depth="3" style="font-size: 0.72rem">
                {{ (m.type || "").toLowerCase() === "inbox" ? nameByLead.get(t.lead_uuid ?? "") ?? "prospect" : "us" }} · {{ fmtDate(m.sent_at) }}
              </NText>
              <div>{{ m.text }}</div>
            </div>
          </NCollapseItem>
        </NCollapse>
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
              placeholder="add a context note for this account"
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
  grid-template-columns: 240px 1fr;
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
