<script setup lang="ts">
/**
 * Message log — project-wide history of message-generation attempts and the edited
 * version actually sent to GetSales, grouped by contact. Read-only.
 * (Generation + send happen on the contact card via the Feasible message agent.)
 */
import { ref, computed, onMounted, watch } from "vue";
import {
  NCard, NInput, NButton, NEmpty, NSpace, NTag, NCollapse, NCollapseItem, NAvatar, NAlert, NText,
} from "naive-ui";
import { RouterLink } from "vue-router";
import { MailIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";

interface SentInfo { text: string; subject: string; sent_at: string; sender_profile_uuid: string; channel: string; }
interface LogItem {
  id: string;
  contact_id: string;
  contact_name: string;
  contact_avatar_url: string | null;
  position: string;
  company_name: string;
  content: string;
  generation_context: Record<string, unknown> | null;
  created_at: string;
  sent: SentInfo | null;
}
interface Group {
  contact_id: string;
  contact_name: string;
  contact_avatar_url: string | null;
  position: string;
  company_name: string;
  attempts: LogItem[];
  sentCount: number;
}

const projectStore = useProjectStore();
const items = ref<LogItem[]>([]);
const loading = ref(false);
const error = ref("");
const search = ref("");

const groups = computed<Group[]>(() => {
  const byContact = new Map<string, Group>();
  for (const it of items.value) {
    let g = byContact.get(it.contact_id);
    if (!g) {
      g = {
        contact_id: it.contact_id,
        contact_name: it.contact_name,
        contact_avatar_url: it.contact_avatar_url,
        position: it.position,
        company_name: it.company_name,
        attempts: [],
        sentCount: 0,
      };
      byContact.set(it.contact_id, g);
    }
    g.attempts.push(it);
    if (it.sent) g.sentCount += 1;
  }
  return [...byContact.values()];
});

function fmt(s: string): string {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString();
}
function modelOf(ctx: Record<string, unknown> | null): string {
  if (!ctx) return "";
  return (
    (typeof ctx.model === "string" && ctx.model) ||
    (typeof ctx.normalization_model === "string" && ctx.normalization_model) ||
    (typeof ctx.normalizationModel === "string" && ctx.normalizationModel) ||
    ""
  );
}
function avatarFallback(name: string): string {
  return (name?.trim()?.charAt(0) ?? "?").toUpperCase();
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const params = new URLSearchParams();
    if (projectStore.selectedProjectId) params.set("projectId", projectStore.selectedProjectId);
    if (search.value.trim()) params.set("search", search.value.trim());
    const r = await fetch(`/api/message-log?${params.toString()}`);
    const j = (await r.json()) as { items?: LogItem[]; error?: string };
    if (!r.ok) throw new Error(j.error ?? "Failed to load");
    items.value = j.items ?? [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load";
    items.value = [];
  } finally {
    loading.value = false;
  }
}

watch(() => projectStore.selectedProjectId, load);
onMounted(load);
</script>

<template>
  <NCard>
    <template #header>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px">
          <MailIcon :size="16" />
          <span>Message log</span>
          <NTag size="small" :bordered="false" type="info">{{ groups.length }} contacts · {{ items.length }} attempts</NTag>
          <span v-if="loading" style="opacity:.6;font-size:.82rem">Loading…</span>
        </div>
        <NSpace size="small" align="center">
          <NInput v-model:value="search" placeholder="Search message text…" clearable size="small" style="width: 240px" @keyup.enter="load" />
          <NButton size="small" type="primary" :loading="loading" @click="load">Search</NButton>
        </NSpace>
      </div>
    </template>

    <NAlert v-if="error" type="error" :show-icon="false" style="margin-bottom:8px">{{ error }}</NAlert>
    <NEmpty v-else-if="!loading && groups.length === 0" description="No generated messages yet. Generate from a contact card." />

    <NCollapse v-else accordion>
      <NCollapseItem v-for="g in groups" :key="g.contact_id" :name="g.contact_id">
        <template #header>
          <NSpace align="center" :size="8" :wrap="false">
            <NAvatar round :size="26" :src="g.contact_avatar_url || undefined">{{ avatarFallback(g.contact_name) }}</NAvatar>
            <RouterLink :to="`/contact/${g.contact_id}`" style="color:#2080f0;text-decoration:none;font-weight:600" @click.stop>
              {{ g.contact_name }}
            </RouterLink>
            <NText depth="3" style="font-size:.82rem">{{ g.position }}<template v-if="g.company_name"> @ {{ g.company_name }}</template></NText>
            <NTag size="tiny" :bordered="false">{{ g.attempts.length }} attempt{{ g.attempts.length === 1 ? '' : 's' }}</NTag>
            <NTag v-if="g.sentCount" size="tiny" :bordered="false" type="success">{{ g.sentCount }} sent</NTag>
          </NSpace>
        </template>

        <div class="attempts">
          <div v-for="a in g.attempts" :key="a.id" class="attempt">
            <div class="attempt-meta">
              <NText depth="3" style="font-size:.78rem">{{ fmt(a.created_at) }}</NText>
              <NTag v-if="modelOf(a.generation_context)" size="tiny" :bordered="false">{{ modelOf(a.generation_context) }}</NTag>
              <NTag v-if="a.sent" size="tiny" :bordered="false" type="success">sent {{ fmt(a.sent.sent_at) }}</NTag>
            </div>
            <div class="attempt-body">{{ a.content }}</div>
            <div v-if="a.sent && a.sent.text && a.sent.text !== a.content" class="attempt-sent">
              <NText depth="3" style="font-size:.74rem">Edited / sent version:</NText>
              <div class="attempt-body sent">{{ a.sent.text }}</div>
            </div>
          </div>
        </div>
      </NCollapseItem>
    </NCollapse>
  </NCard>
</template>

<style scoped>
.attempts { display: flex; flex-direction: column; gap: 10px; }
.attempt { border-left: 2px solid var(--n-border-color, rgba(128,128,128,.25)); padding-left: 10px; }
.attempt-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.attempt-body { white-space: pre-wrap; font-size: 0.84rem; line-height: 1.45; }
.attempt-sent { margin-top: 6px; }
.attempt-body.sent { background: rgba(46,160,67,.08); padding: 6px 8px; border-radius: 4px; }
</style>
