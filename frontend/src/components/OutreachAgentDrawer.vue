<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NDrawer, NDrawerContent, NSelect, NInput, NButton, NSpace, NAlert, NSteps, NStep, NCard, NTag, NCollapse, NCollapseItem, NDivider, useMessage } from "naive-ui";
import { useProjectStore } from "../stores/project";

type Json = Record<string, unknown>;
interface Variant { subject: string | null; body: string; rationale: string; warnings: string[] }
interface Pov { verified_signals: string[]; conversation_state: string; likely_business_priority: string; feasible_angle: string; supporting_product_facts: string[]; evidence_references: string[]; avoid: string[]; message_strategy: string; cta: string }
const props = defineProps<{ show: boolean; contactId: string; contactName?: string }>();
const emit = defineEmits<{ "update:show": [value: boolean] }>();
const store = useProjectStore(); const toast = useMessage();
const channel = ref<"inmail" | "message" | null>(null); const prompt = ref(""); const loading = ref(false); const stage = ref(0); const error = ref(""); const warnings = ref<string[]>([]); const runId = ref(""); const pov = ref<Pov | null>(null); const variants = ref<Variant[]>([]); const research = ref<Json | null>(null); const history = ref<Json[]>([]); const refreshResearch = ref(false); const savingPov = ref(false); const regenerating = ref<number | null>(null);
const canRun = computed(() => Boolean(store.selectedProjectId && channel.value && prompt.value.trim() && !loading.value));
const channelOptions = [{ label: "LinkedIn InMail", value: "inmail" }, { label: "LinkedIn Message", value: "message" }];
function lines(v: string[]) { return v.join("\n"); } function setLines(key: keyof Pov, v: string) { if (pov.value) (pov.value[key] as string[]) = v.split("\n").map((x) => x.trim()).filter(Boolean); }

async function loadHistory() { if (!store.selectedProjectId || !props.contactId) return; const r = await fetch(`/api/outreach-agent/runs?projectId=${store.selectedProjectId}&contactId=${props.contactId}`); const j = await r.json(); history.value = r.ok ? (j.data ?? []) : []; }
watch(() => props.show, (v) => { if (v) loadHistory(); });

async function run() {
  if (!canRun.value) return; loading.value = true; error.value = ""; warnings.value = []; pov.value = null; variants.value = []; research.value = null; stage.value = 1;
  try {
    const r = await fetch("/api/outreach-agent/runs", { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ projectId: store.selectedProjectId, contactId: props.contactId, channel: channel.value, userPrompt: prompt.value, forceResearchRefresh: refreshResearch.value }) });
    if (!r.ok || !r.body) throw new Error((await r.json()).error ?? "Generation failed"); const reader = r.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
    while (true) { const part = await reader.read(); if (part.done) break; buffer += decoder.decode(part.value, { stream: true }); const events = buffer.split("\n\n"); buffer = events.pop() ?? ""; for (const event of events) { const type = event.match(/^event: (.+)$/m)?.[1]; const raw = event.match(/^data: (.+)$/m)?.[1]; if (!raw) continue; const data = JSON.parse(raw); if (type === "error") throw new Error(data.error); if (type !== "stage") continue; if (data.runId) runId.value = data.runId; if (data.stage === "research") stage.value = 2; if (data.stage === "pov") stage.value = 3; if (data.stage === "variants") stage.value = 4; if (data.stage === "completion") { stage.value = 5; runId.value = String(data.run?.id ?? runId.value); pov.value = data.pov; variants.value = data.variants ?? []; research.value = data.research; warnings.value = data.warnings ?? []; } } }
    await loadHistory();
  } catch (e) { error.value = e instanceof Error ? e.message : "Generation failed"; } finally { loading.value = false; }
}
async function savePovAndRegenerate(index?: number) {
  if (!runId.value || !pov.value) return; savingPov.value = true; regenerating.value = index ?? 0; error.value = "";
  try { const p = await fetch(`/api/outreach-agent/runs/${runId.value}/pov`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: store.selectedProjectId, pov: pov.value }) }); const pj = await p.json(); if (!p.ok) throw new Error(typeof pj.error === "string" ? pj.error : "Could not save POV"); const r = await fetch(`/api/outreach-agent/runs/${runId.value}/variants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: store.selectedProjectId, ...(index ? { variantIndex: index } : {}) }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Regeneration failed"); if (index) variants.value[index - 1] = j.data[0]; else variants.value = j.data; toast.success(index ? `Variant ${index} regenerated` : "Variants regenerated"); }
  catch (e) { error.value = e instanceof Error ? e.message : "Regeneration failed"; } finally { savingPov.value = false; regenerating.value = null; }
}
async function copy(text: string) { await navigator.clipboard.writeText(text); toast.success("Copied"); }
async function openRun(id: string) { const r = await fetch(`/api/outreach-agent/runs/${id}?projectId=${store.selectedProjectId}`); const j = await r.json(); if (!r.ok) return; runId.value = id; const d = j.data as Json; channel.value = d.channel as "inmail" | "message"; prompt.value = String(d.user_prompt ?? ""); pov.value = (d.edited_pov ?? d.original_pov) as Pov; research.value = d.outreach_research_snapshots as Json; warnings.value = (d.warnings as string[]) ?? []; variants.value = ((j.drafts ?? []) as Json[]).map((x) => ({ subject: (x.subject as string | null) ?? null, body: String(x.content ?? ""), rationale: String((x.generation_context as Json)?.rationale ?? ""), warnings: ((x.generation_context as Json)?.warnings as string[]) ?? [] })); stage.value = 5; }
</script>

<template>
  <NDrawer :show="show" width="min(920px, 96vw)" @update:show="emit('update:show', $event)">
    <NDrawerContent :title="`Create outreach${contactName ? ` — ${contactName}` : ''}`" closable>
      <NAlert type="info" :show-icon="false" style="margin-bottom:14px">Draft only. This agent never triggers n8n, writes to GetSales, or sends a message.</NAlert>
      <NSpace vertical size="large">
        <div><div class="label">Channel *</div><NSelect v-model:value="channel" :options="channelOptions" placeholder="Choose InMail or Message" /></div>
        <div><div class="label">What should the agent focus on? *</div><NInput v-model:value="prompt" type="textarea" :autosize="{ minRows: 3, maxRows: 7 }" placeholder="For example: focus on their managed detection service and propose a low-friction conversation…" /></div>
        <NSpace align="center"><NButton type="primary" :disabled="!canRun" :loading="loading" @click="run">Research and create 3 drafts</NButton><NButton secondary :type="refreshResearch ? 'warning' : 'default'" @click="refreshResearch = !refreshResearch">{{ refreshResearch ? 'Fresh research required' : 'Use research under 30 days' }}</NButton><NTag size="small">Guidelines: default</NTag></NSpace>
        <NSteps v-if="loading || stage" :current="stage" size="small"><NStep title="Context"/><NStep title="Research"/><NStep title="POV"/><NStep title="Drafts"/><NStep title="Ready"/></NSteps>
        <NAlert v-if="error" type="error">{{ error }}</NAlert><NAlert v-for="w in warnings" :key="w" type="warning" :show-icon="false">{{ w }}</NAlert>
        <NCard v-if="pov" title="Editable outreach POV" size="small">
          <NSpace vertical>
            <div><div class="label">Verified signals (one per line)</div><NInput type="textarea" :value="lines(pov.verified_signals)" @update:value="setLines('verified_signals', $event)" /></div>
            <div><div class="label">Conversation state</div><NInput v-model:value="pov.conversation_state" type="textarea" /></div>
            <div><div class="label">Likely business priority</div><NInput v-model:value="pov.likely_business_priority" type="textarea" /></div>
            <div><div class="label">Selected Feasible angle</div><NInput v-model:value="pov.feasible_angle" type="textarea" /></div>
            <div><div class="label">Supporting product facts (one per line)</div><NInput type="textarea" :value="lines(pov.supporting_product_facts)" @update:value="setLines('supporting_product_facts', $event)" /></div>
            <div><div class="label">Evidence references (one per line)</div><NInput type="textarea" :value="lines(pov.evidence_references)" @update:value="setLines('evidence_references', $event)" /></div>
            <div><div class="label">Claims and approaches to avoid</div><NInput type="textarea" :value="lines(pov.avoid)" @update:value="setLines('avoid', $event)" /></div>
            <div><div class="label">Message strategy</div><NInput v-model:value="pov.message_strategy" type="textarea" /></div>
            <div><div class="label">CTA</div><NInput v-model:value="pov.cta" /></div>
            <NButton type="primary" secondary :loading="savingPov && regenerating === 0" @click="savePovAndRegenerate()">Save POV and regenerate all</NButton>
          </NSpace>
        </NCard>
        <div v-if="variants.length"><h3>Message variants</h3><div class="variant-grid"><NCard v-for="(v, i) in variants" :key="i" :title="`Variant ${i + 1}`" size="small"><template #header-extra><NTag v-if="v.warnings.length" type="warning" size="small">{{ v.warnings.length }} warning(s)</NTag></template><div v-if="v.subject"><div class="label">Subject</div><div class="subject">{{ v.subject }}</div><NDivider/></div><div class="body">{{ v.body }}</div><NAlert v-for="w in v.warnings" :key="w" type="warning" :show-icon="false" style="margin-top:8px">{{ w }}</NAlert><NDivider/><NSpace><NButton size="small" @click="copy(`${v.subject ? `${v.subject}\n\n` : ''}${v.body}`)">Copy</NButton><NButton size="small" secondary :loading="regenerating === i + 1" @click="savePovAndRegenerate(i + 1)">Regenerate</NButton></NSpace></NCard></div></div>
        <NCollapse v-if="research"><NCollapseItem title="Research evidence and citations" name="research"><pre>{{ JSON.stringify(research, null, 2) }}</pre></NCollapseItem></NCollapse>
        <NCollapse><NCollapseItem :title="`Prior runs (${history.length})`" name="history"><NSpace vertical><NButton v-for="h in history" :key="String(h.id)" text @click="openRun(String(h.id))">{{ new Date(String(h.created_at)).toLocaleString() }} · {{ h.channel }} · {{ h.status }}</NButton></NSpace></NCollapseItem></NCollapse>
      </NSpace>
    </NDrawerContent>
  </NDrawer>
</template>
<style scoped>.label{font-size:.78rem;opacity:.72;margin-bottom:5px}.variant-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}.body{white-space:pre-wrap;line-height:1.5}.subject{font-weight:600}pre{white-space:pre-wrap;word-break:break-word;font-size:.75rem;max-height:420px;overflow:auto}</style>
