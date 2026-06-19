<script setup lang="ts">
/**
 * Feasible message agent composer. Generate variants (gemma cheap / Opus premium),
 * edit, retry, then send to the prospect in GetSales via /api/feasible/send.
 * Sender persona is auto-matched per lead and shown; user can change it.
 * Self-contained: give it a leadUuid. Used on the contact card and the MSSP table.
 */
import { ref, computed } from "vue";
import {
  NSpace,
  NSelect,
  NButton,
  NInput,
  NTag,
  NText,
  NAlert,
  NCard,
  NModal,
  useMessage,
} from "naive-ui";
import type { SelectOption } from "naive-ui";

const props = defineProps<{ leadUuid: string; contactName?: string; connected?: boolean; email?: string }>();
const message = useMessage();

interface Sender {
  sender_profile_uuid: string;
  persona: string;
  signature: string;
}
interface Variant {
  subject?: string;
  text?: string;
  model?: string;
  tier?: string;
  violations?: string[];
  error?: string;
}

const CHANNELS = [
  { label: "Send message", value: "linkedin" },
  { label: "Send InMail", value: "inmail" },
  { label: "Send email", value: "email" },
] as const;
const ANGLES: SelectOption[] = [
  { label: "Auto (model picks)", value: "" },
  { label: "1 - Productize ($)", value: "productize" },
  { label: "4 - Scale ($)", value: "scale" },
  { label: "2 - Win rate", value: "win_rate" },
  { label: "3 - Margin", value: "margin" },
  { label: "Practitioner (technical)", value: "practitioner" },
];

const channel = ref(props.connected ? "linkedin" : "inmail");
const angle = ref("");
const prompts = ref<Record<string, string>>({ linkedin: "", inmail: "", email: "" });
const generating = ref(false);
const genTier = ref<"cheap" | "premium">("cheap");

const variants = ref<Variant[]>([]);
const senders = ref<Sender[]>([]);
const senderUuid = ref<string>("");
const senderSource = ref<string>("");
const revenueLine = ref<string | null>(null);
const employees = ref<number | null>(null);

// selection / send
const selectedIdx = ref<number | null>(null);
const editText = ref("");
const editSubject = ref("");
const confirmOpen = ref(false);
const sending = ref(false);

const senderOptions = computed<SelectOption[]>(() =>
  senders.value.map((s) => ({ label: `${s.persona} (signs "${s.signature}")`, value: s.sender_profile_uuid }))
);
const needsSubject = computed(() => channel.value === "inmail" || channel.value === "email");
const userPrompt = computed({
  get: () => prompts.value[channel.value] ?? "",
  set: (value: string) => { prompts.value[channel.value] = value; },
});
function channelDisabled(value: string) {
  return (value === "linkedin" && !props.connected) || (value === "email" && !props.email);
}
const channelHint = computed(() => {
  if (channel.value === "linkedin") return props.connected ? "Connected LinkedIn message" : "Unavailable until the connection is accepted";
  if (channel.value === "email") return props.email ? `Email to ${props.email}` : "Unavailable because no work email is stored";
  return "LinkedIn InMail does not require a connection";
});

async function generate(tier: "cheap" | "premium") {
  if (channel.value === "linkedin" && !props.connected) {
    message.warning("Send message is available only for accepted LinkedIn connections.");
    return;
  }
  if (channel.value === "email" && !props.email) {
    message.warning("This contact has no work email.");
    return;
  }
  generating.value = true;
  genTier.value = tier;
  try {
    const r = await fetch("/api/feasible/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadUuid: props.leadUuid,
        channel: channel.value,
        angle: angle.value || undefined,
        tier,
        variants: 2,
        instructions: userPrompt.value || undefined,
        senderProfileUuid: senderUuid.value || undefined,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Generation failed");
    variants.value = data.variants ?? [];
    senders.value = data.senders ?? [];
    senderUuid.value = data.sender_profile_uuid ?? senderUuid.value;
    senderSource.value = data.sender_source ?? "";
    revenueLine.value = data.revenue_line ?? null;
    employees.value = data.employees ?? null;
    selectedIdx.value = null;
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Generation failed");
  } finally {
    generating.value = false;
  }
}

function selectVariant(i: number) {
  const v = variants.value[i];
  if (!v || v.error) return;
  selectedIdx.value = i;
  editText.value = v.text ?? "";
  editSubject.value = v.subject ?? "";
}

function changeSender(value: string) {
  if (value === senderUuid.value) return;
  senderUuid.value = value;
  senderSource.value = "explicit";
  variants.value = [];
  selectedIdx.value = null;
  editText.value = "";
  editSubject.value = "";
  message.info("Sender changed. Generate again so the signature matches.");
}

function changeChannel(value: string) {
  if (value === channel.value) return;
  channel.value = value;
  variants.value = [];
  selectedIdx.value = null;
  editText.value = "";
  editSubject.value = "";
}

function openConfirm() {
  if (selectedIdx.value === null || !editText.value.trim()) {
    message.warning("Pick a variant first.");
    return;
  }
  if (!senderUuid.value) {
    message.warning("Choose a sender persona.");
    return;
  }
  confirmOpen.value = true;
}

async function doSend() {
  sending.value = true;
  try {
    const r = await fetch("/api/feasible/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadUuid: props.leadUuid,
        senderProfileUuid: senderUuid.value,
        channel: channel.value,
        text: editText.value,
        subject: needsSubject.value ? editSubject.value : undefined,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Send failed");
    message.success("Sent to the prospect in GetSales.");
    confirmOpen.value = false;
    variants.value = [];
    selectedIdx.value = null;
  } catch (e) {
    message.error(e instanceof Error ? e.message : "Send failed");
  } finally {
    sending.value = false;
  }
}

const currentSenderSig = computed(() => senders.value.find((s) => s.sender_profile_uuid === senderUuid.value)?.signature ?? "");
const currentSenderPersona = computed(() => senders.value.find((s) => s.sender_profile_uuid === senderUuid.value)?.persona ?? "");
</script>

<template>
  <div class="fc">
    <div class="fc-channels" role="group" aria-label="Outreach channel">
      <NButton
        v-for="option in CHANNELS"
        :key="option.value"
        :data-testid="`feasible-channel-${option.value}`"
        :type="channel === option.value ? 'primary' : 'default'"
        :secondary="channel !== option.value"
        :disabled="channelDisabled(option.value)"
        size="small"
        @click="changeChannel(option.value)"
      >
        {{ option.label }}
      </NButton>
    </div>

    <NSpace align="center" wrap size="small">
      <NSelect v-model:value="angle" :options="ANGLES" style="width: 190px" size="small" />
      <NButton type="primary" size="small" :loading="generating && genTier === 'cheap'" @click="generate('cheap')">Generate</NButton>
      <NButton size="small" :loading="generating && genTier === 'premium'" @click="generate('premium')">Try Opus</NButton>
    </NSpace>

    <NInput
      v-model:value="userPrompt"
      type="textarea"
      :autosize="{ minRows: 1, maxRows: 3 }"
      placeholder="Your instructions for this message. These are applied on top of Feasible's messaging rules and contact context."
      size="small"
      style="margin-top: 8px"
    />
    <NText depth="3" style="display:block;margin-top:4px;font-size:0.75rem">{{ channelHint }}</NText>

    <NSpace v-if="senders.length" align="center" size="small" style="margin-top: 8px">
      <NText depth="3" style="font-size: 0.8rem">sender:</NText>
      <NSelect :value="senderUuid" :options="senderOptions" size="small" style="width: 260px" @update:value="changeSender" />
      <NTag v-if="senderSource" size="tiny" :type="senderSource === 'thread' ? 'success' : 'default'">
        {{ senderSource === "thread" ? "matched to thread" : senderSource }}
      </NTag>
      <NTag v-if="revenueLine" size="tiny" type="info">{{ employees }} emp · $ line</NTag>
    </NSpace>

    <NSpace vertical size="small" style="margin-top: 10px">
      <NCard
        v-for="(v, i) in variants"
        :key="i"
        size="small"
        :class="{ 'fc-selected': selectedIdx === i }"
        embedded
      >
        <template v-if="v.error">
          <NAlert type="error" :show-icon="false">{{ v.error }}</NAlert>
        </template>
        <template v-else>
          <NSpace align="center" justify="space-between" style="margin-bottom: 4px">
            <NSpace size="small" align="center">
              <NTag size="tiny">{{ v.model }}</NTag>
              <NTag v-for="vio in v.violations ?? []" :key="vio" size="tiny" type="error">{{ vio }}</NTag>
              <NText v-if="!(v.violations ?? []).length" depth="3" style="font-size: 0.75rem">clean</NText>
            </NSpace>
            <NButton size="tiny" :type="selectedIdx === i ? 'primary' : 'default'" @click="selectVariant(i)">
              {{ selectedIdx === i ? "selected" : "Use this" }}
            </NButton>
          </NSpace>
          <div v-if="v.subject" class="fc-subject"><strong>Subject:</strong> {{ v.subject }}</div>
          <div class="fc-body">{{ v.text }}</div>
        </template>
      </NCard>
    </NSpace>

    <!-- edit + send -->
    <div v-if="selectedIdx !== null" class="fc-edit">
      <NInput
        v-if="needsSubject"
        v-model:value="editSubject"
        placeholder="subject"
        size="small"
        style="margin-bottom: 6px"
      />
      <NInput v-model:value="editText" type="textarea" :autosize="{ minRows: 3, maxRows: 12 }" />
      <NSpace align="center" style="margin-top: 6px">
        <NButton type="primary" size="small" @click="openConfirm">Send to prospect</NButton>
        <NText depth="3" style="font-size: 0.75rem">signs as "{{ currentSenderSig }}"</NText>
      </NSpace>
    </div>

    <NModal
      v-model:show="confirmOpen"
      preset="dialog"
      title="Send this message in GetSales?"
      positive-text="Send"
      negative-text="Cancel"
      :loading="sending"
      @positive-click="doSend"
    >
      <NText depth="3" style="font-size: 0.8rem">
        To {{ props.contactName || props.leadUuid.slice(0, 8) }} · from {{ currentSenderPersona }} · {{ channel }}
      </NText>
      <div v-if="needsSubject && editSubject" style="margin-top: 8px"><strong>Subject:</strong> {{ editSubject }}</div>
      <pre class="fc-confirm">{{ editText }}</pre>
    </NModal>
  </div>
</template>

<style scoped>
.fc-channels {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.fc-selected {
  outline: 2px solid #2080f0;
}
.fc-subject {
  font-size: 0.85rem;
  margin-bottom: 4px;
}
.fc-body {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.875rem;
}
.fc-edit {
  margin-top: 10px;
}
.fc-confirm {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.85rem;
  background: rgba(128, 128, 128, 0.08);
  padding: 8px;
  border-radius: 6px;
  margin: 8px 0 0;
  max-height: 40vh;
  overflow: auto;
}
</style>
