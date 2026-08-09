<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  NAlert,
  NButton,
  NCard,
  NInput,
  NSelect,
  NSpace,
  NSpin,
  NTag,
  useMessage,
} from "naive-ui";
import { BotIcon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";

const WELLORE_PROJECT_ID = "0038d0db-aab2-40f1-9f6e-38d38e157f8f";
const GTM_BASE = "https://wellore-gtm-production.up.railway.app";

type ChatRole = "user" | "assistant" | "system";
type ChatMsg = { role: ChatRole; content: string; at: string; model?: string | null; error?: boolean };

type Preset = { id: string; label: string; prompt: string };
type ModelOpt = { label: string; value: string };

const store = useProjectStore();
const message = useMessage();

const healthLoading = ref(false);
const healthOk = ref<boolean | null>(null);
const healthError = ref("");
const hermesConfigured = ref(false);

const models = ref<ModelOpt[]>([{ label: "Auto (policy)", value: "auto" }]);
const selectedModel = ref("auto");

const presets = ref<Preset[]>([]);
const selectedPreset = ref<string | null>(null);

const company = ref("");
const slug = ref("");
const contactId = ref("");
const contactName = ref("");

const draft = ref("");
const sending = ref(false);
const messages = ref<ChatMsg[]>([]);
const sessionId = ref(`wellore-${Date.now().toString(36)}`);

const isWellore = computed(() => store.selectedProjectId === WELLORE_PROJECT_ID);

function applyPreset(): void {
  const p = presets.value.find((x) => x.id === selectedPreset.value);
  if (!p) return;
  draft.value = p.prompt
    .split("{{company}}").join(company.value.trim() || "<company name>")
    .split("{{slug}}").join(slug.value.trim() || "<slug-or-domain>")
    .split("{{contactId}}").join(contactId.value.trim() || "<contact-uuid>")
    .split("{{contactName}}").join(contactName.value.trim() || "<contact name>");
}

async function refreshHealth(): Promise<void> {
  healthLoading.value = true;
  healthError.value = "";
  try {
    const r = await fetch("/api/hermes/health");
    const j = (await r.json()) as {
      ok?: boolean;
      configured?: boolean;
      error?: string;
    };
    hermesConfigured.value = Boolean(j.configured);
    healthOk.value = Boolean(j.ok);
    if (!j.ok) healthError.value = j.error || `Hermes unhealthy (${r.status})`;
  } catch (e) {
    healthOk.value = false;
    healthError.value = e instanceof Error ? e.message : String(e);
  } finally {
    healthLoading.value = false;
  }
}

async function loadModels(): Promise<void> {
  try {
    const r = await fetch("/api/hermes/models");
    const j = (await r.json()) as { data?: Array<{ id: string; label: string }> };
    const rows = Array.isArray(j.data) ? j.data : [];
    models.value = rows.map((m) => ({ label: m.label || m.id, value: m.id }));
    if (!models.value.some((m) => m.value === selectedModel.value)) selectedModel.value = "auto";
  } catch {
    /* keep defaults */
  }
}

async function loadPresets(): Promise<void> {
  try {
    const r = await fetch("/api/hermes/presets");
    const j = (await r.json()) as { presets?: Preset[] };
    presets.value = Array.isArray(j.presets) ? j.presets : [];
  } catch {
    presets.value = [];
  }
}

async function send(): Promise<void> {
  const text = draft.value.trim();
  if (!text || sending.value) return;
  if (!isWellore.value) {
    message.error("Select the Wellore project to use Hermes v1.");
    return;
  }
  messages.value.push({ role: "user", content: text, at: new Date().toISOString() });
  draft.value = "";
  sending.value = true;
  try {
    const history: Array<{ role: string; content: string }> = [
      {
        role: "system",
        content:
          "You are the Wellore GTM Hermes agent inside Voitech. Prefer wellore-* skills. Use tools for research (never invent dossier facts). Write emails only with locked Wellore voice rules. Upsert to Supabase wellore.* for GTM visibility. Scope: Wellore project 0038d0db-aab2-40f1-9f6e-38d38e157f8f.",
      },
      ...messages.value
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content })),
    ];
    const r = await fetch("/api/hermes/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: WELLORE_PROJECT_ID,
        model: selectedModel.value,
        sessionId: sessionId.value,
        sessionKey: "wellore-operator",
        messages: history,
      }),
    });
    const j = (await r.json()) as { content?: string; model?: string; error?: string };
    if (!r.ok) {
      messages.value.push({
        role: "assistant",
        content: j.error || `Request failed (${r.status})`,
        at: new Date().toISOString(),
        error: true,
      });
      return;
    }
    messages.value.push({
      role: "assistant",
      content: j.content || "(empty response)",
      at: new Date().toISOString(),
      model: j.model,
    });
  } catch (e) {
    messages.value.push({
      role: "assistant",
      content: e instanceof Error ? e.message : String(e),
      at: new Date().toISOString(),
      error: true,
    });
  } finally {
    sending.value = false;
  }
}

function clearChat(): void {
  messages.value = [];
  sessionId.value = `wellore-${Date.now().toString(36)}`;
}

function openGtm(): void {
  const s = slug.value.trim();
  window.open(s ? `${GTM_BASE}/research.html` : GTM_BASE, "_blank");
}

onMounted(async () => {
  await Promise.all([refreshHealth(), loadModels(), loadPresets()]);
});
</script>

<template>
  <div class="hermes-page">
    <div class="head">
      <div>
        <h1><BotIcon :size="22" style="vertical-align: -4px; margin-right: 8px" />Hermes Agent</h1>
        <p class="sub">
          Wellore research + email via Hermes tools. Results land in Supabase / GTM and Email Studio.
        </p>
      </div>
      <NSpace>
        <NTag :type="healthOk ? 'success' : healthOk === false ? 'error' : 'default'" size="small">
          {{ healthLoading ? "checking…" : healthOk ? "Hermes up" : hermesConfigured ? "Hermes down" : "not configured" }}
        </NTag>
        <NButton size="small" quaternary @click="refreshHealth">Refresh</NButton>
        <NButton size="small" quaternary @click="openGtm">Open GTM</NButton>
        <NButton size="small" quaternary @click="$router.push('/email-studio')">Email Studio</NButton>
      </NSpace>
    </div>

    <NAlert v-if="!isWellore" type="warning" style="margin-bottom: 12px" :bordered="false">
      Select the <strong>Wellore</strong> project in the header. Hermes v1 is scoped to that project only.
    </NAlert>
    <NAlert v-if="healthError" type="error" style="margin-bottom: 12px" :bordered="false">
      {{ healthError }}
    </NAlert>

    <div class="layout">
      <NCard size="small" class="side" title="Task setup">
        <NSpace vertical :size="10">
          <div>
            <div class="lbl">Preset</div>
            <NSelect
              v-model:value="selectedPreset"
              :options="presets.map((p) => ({ label: p.label, value: p.id }))"
              placeholder="Choose a preset"
              clearable
              @update:value="applyPreset"
            />
          </div>
          <div>
            <div class="lbl">Company</div>
            <NInput v-model:value="company" placeholder="Nitro Games" @blur="applyPreset" />
          </div>
          <div>
            <div class="lbl">Slug / domain</div>
            <NInput v-model:value="slug" placeholder="nitro-games or nitrogames.com" @blur="applyPreset" />
          </div>
          <div>
            <div class="lbl">Contact UUID</div>
            <NInput v-model:value="contactId" placeholder="for email preset" @blur="applyPreset" />
          </div>
          <div>
            <div class="lbl">Contact name</div>
            <NInput v-model:value="contactName" placeholder="Samuli Snellman" @blur="applyPreset" />
          </div>
          <div>
            <div class="lbl">Model</div>
            <NSelect v-model:value="selectedModel" :options="models" />
          </div>
          <NButton block @click="applyPreset" :disabled="!selectedPreset">Fill prompt from preset</NButton>
          <NButton block quaternary @click="clearChat">Clear chat</NButton>
        </NSpace>
      </NCard>

      <NCard size="small" class="main" title="Chat">
        <div class="transcript">
          <div v-if="messages.length === 0" class="empty">
            Pick a preset or type a prompt. Hermes will call tools (Prospeo, Coresignal, Parallel, HTTP, Supabase) itself — not n8n.
          </div>
          <div v-for="(m, i) in messages" :key="i" class="bubble" :class="[m.role, { err: m.error }]">
            <div class="meta">
              <span>{{ m.role }}</span>
              <span v-if="m.model">· {{ m.model }}</span>
            </div>
            <pre>{{ m.content }}</pre>
          </div>
          <div v-if="sending" class="bubble assistant">
            <NSpin size="small" /> Running on Hermes (may take a few minutes for full research)…
          </div>
        </div>
        <div class="composer">
          <NInput
            v-model:value="draft"
            type="textarea"
            :rows="5"
            placeholder="Research Nitro Games and upsert the dossier…"
            :disabled="sending || !isWellore"
          />
          <NButton type="primary" :loading="sending" :disabled="!draft.trim() || !isWellore" @click="send">
            Send to Hermes
          </NButton>
        </div>
      </NCard>
    </div>
  </div>
</template>

<style scoped>
.hermes-page {
  max-width: 1400px;
  margin: 0 auto;
  color: #f8fafc;
  padding: 8px 4px 32px;
}
.head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 16px;
}
h1 {
  margin: 0 0 4px;
  font-size: 1.35rem;
  font-weight: 650;
}
.sub {
  margin: 0;
  opacity: 0.72;
  font-size: 0.92rem;
}
.layout {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 14px;
}
@media (max-width: 960px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
.lbl {
  font-size: 12px;
  opacity: 0.7;
  margin-bottom: 4px;
}
.transcript {
  min-height: 420px;
  max-height: 62vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
  padding: 4px;
}
.empty {
  opacity: 0.55;
  padding: 24px 8px;
  line-height: 1.45;
}
.bubble {
  border-radius: 10px;
  padding: 10px 12px;
  background: rgba(148, 163, 184, 0.1);
}
.bubble.user {
  background: rgba(59, 130, 246, 0.18);
  align-self: flex-end;
  max-width: 92%;
}
.bubble.assistant {
  background: rgba(16, 185, 129, 0.12);
  max-width: 96%;
}
.bubble.err {
  background: rgba(239, 68, 68, 0.18);
}
.meta {
  font-size: 11px;
  opacity: 0.6;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.bubble pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 0.95rem;
  line-height: 1.45;
}
.composer {
  display: grid;
  gap: 10px;
}
</style>
