<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NModal,
  NSpace,
  NButton,
  NSelect,
  NInputNumber,
  NCheckboxGroup,
  NCheckbox,
  NInput,
  NAlert,
  NSpin,
  NTooltip,
  useMessage,
} from "naive-ui";

type ModePreset = "simple" | "complex";
type Tone = "professional" | "friendly" | "confident" | "consultative" | "direct";
type Goal = "book_call" | "ask_question" | "reengage" | "follow_up" | "close_loop";
type CtaStyle = "soft" | "medium" | "hard" | "no_cta";
type PersonalizationDepth = "low" | "medium" | "high";
type ReadingLevel = "simple" | "expert";
type Formality = "casual" | "formal";
type EmojiPolicy = "none" | "light" | "allowed";
type ReadingLevelPreset = "eighth_grade" | "high_school" | "college" | "professional";
type TonePreset = "casual" | "neutral" | "formal";
type LengthPreset = "extra_short" | "short" | "medium" | "long" | "extra_long";
type MethodologyPreset = "pas" | "aida" | "bab" | "jtbd";
type FocusPreset = "pain" | "neutral" | "benefits";
type CtaType =
  | "initiate_conversation"
  | "schedule_meeting"
  | "request_introduction"
  | "ask_for_feedback"
  | "find_time_to_connect"
  | "politely_disengage"
  | "smart_cta"
  | "custom";
type MentionBlock =
  | "contact_experience"
  | "contact_posts"
  | "contact_headline"
  | "company_about"
  | "company_industry"
  | "conversation_recap";

const props = defineProps<{
  show: boolean;
  projectId: string | null;
  conversationUuid: string | null;
  contactId: string | null;
  preset: ModePreset;
  hypotheses: Array<{ id: string; name: string }>;
}>();

const emit = defineEmits<{
  (e: "update:show", v: boolean): void;
  (e: "generated", payload: { id: string; content: string; created_at: string }): void;
}>();

const message = useMessage();
const PRESETS_STORAGE_KEY = "generate-message.presets";

const modelsLoading = ref(false);
const modelsError = ref("");
const rawModels = ref<
  Array<{
    id: string;
    name: string;
    contextLength: number | null;
    pricingPrompt: string | null;
    pricingCompletion: string | null;
  }>
>([]);
const selectedModel = ref<string | null>(null);
const tone = ref<Tone>("professional");
const goal = ref<Goal>("follow_up");
const ctaStyle = ref<CtaStyle>("soft");
const personalizationDepth = ref<PersonalizationDepth>("medium");
const readingLevel = ref<ReadingLevel>("simple");
const formality = ref<Formality>("casual");
const emojiPolicy = ref<EmojiPolicy>("none");
const questionCountMax = ref<0 | 1 | 2>(1);
const readingLevelPreset = ref<ReadingLevelPreset>("high_school");
const tonePreset = ref<TonePreset>("casual");
const lengthPreset = ref<LengthPreset>("medium");
const methodology = ref<MethodologyPreset>("pas");
const focus = ref<FocusPreset>("pain");
const ctaType = ref<CtaType>("initiate_conversation");
const temperature = ref<number>(0.7);
const sentences = ref<number>(3);
const paragraphs = ref<number>(1);
const mentionBlocks = ref<MentionBlock[]>([
  "conversation_recap",
  "contact_experience",
  "company_about",
]);
const additionalInstructions = ref("");
const selectedHypothesisId = ref<string | null>(null);

const generationLoading = ref(false);
const generationError = ref("");
const generatedText = ref("");
const presetName = ref("");
const selectedPresetName = ref<string | null>(null);

const mentionBlockOptions: Array<{ label: string; value: MentionBlock; hint: string }> = [
  {
    label: "Conversation recap",
    value: "conversation_recap",
    hint: "Includes recent message history so reply matches thread context.",
  },
  {
    label: "Contact experience",
    value: "contact_experience",
    hint: "Injects profile experience/background into prompt for personalization.",
  },
  {
    label: "Contact latest posts",
    value: "contact_posts",
    hint: "Injects latest post topics/opinions for relevant references.",
  },
  {
    label: "Contact headline",
    value: "contact_headline",
    hint: "Injects LinkedIn headline/title phrasing as context.",
  },
  {
    label: "Company about",
    value: "company_about",
    hint: "Injects company description for business-context mentions.",
  },
  {
    label: "Company industry",
    value: "company_industry",
    hint: "Injects company industry to anchor domain-specific language.",
  },
];
const emojiPolicyOptions: Array<{ label: string; value: EmojiPolicy }> = [
  { label: "None", value: "none" },
  { label: "Light", value: "light" },
  { label: "Allowed", value: "allowed" },
];
const questionCountOptions: Array<{ label: string; value: 0 | 1 | 2 }> = [
  { label: "0", value: 0 },
  { label: "1", value: 1 },
  { label: "2", value: 2 },
];
const readingLevelPresetOptions: Array<{ label: string; value: ReadingLevelPreset }> = [
  { label: "8th Grade", value: "eighth_grade" },
  { label: "High School", value: "high_school" },
  { label: "College", value: "college" },
  { label: "Professional", value: "professional" },
];
const tonePresetOptions: Array<{ label: string; value: TonePreset }> = [
  { label: "Casual", value: "casual" },
  { label: "Neutral", value: "neutral" },
  { label: "Formal", value: "formal" },
];
const lengthPresetOptions: Array<{ label: string; value: LengthPreset }> = [
  { label: "Extra Short (30-50 words)", value: "extra_short" },
  { label: "Short (50-70 words)", value: "short" },
  { label: "Medium (70-100 words)", value: "medium" },
  { label: "Long (100-150 words)", value: "long" },
  { label: "Extra Long (150-200 words)", value: "extra_long" },
];
const methodologyOptions: Array<{ label: string; value: MethodologyPreset }> = [
  { label: "PAS (Problem-Agitate-Solution)", value: "pas" },
  { label: "AIDA (Attention-Interest-Desire-Action)", value: "aida" },
  { label: "BAB (Before-After-Bridge)", value: "bab" },
  { label: "JTBD (Jobs-to-be-Done)", value: "jtbd" },
];
const focusOptions: Array<{ label: string; value: FocusPreset }> = [
  { label: "Pain", value: "pain" },
  { label: "Neutral", value: "neutral" },
  { label: "Benefits", value: "benefits" },
];
const ctaTypeOptions: Array<{ label: string; value: CtaType }> = [
  { label: "Initiate Conversation", value: "initiate_conversation" },
  { label: "Schedule Meeting", value: "schedule_meeting" },
  { label: "Request Introduction", value: "request_introduction" },
  { label: "Ask for Feedback", value: "ask_for_feedback" },
  { label: "Find Time to Connect", value: "find_time_to_connect" },
  { label: "Politely Disengage", value: "politely_disengage" },
  { label: "Smart CTA", value: "smart_cta" },
  { label: "Custom", value: "custom" },
];
const methodologyHints: Record<MethodologyPreset, string> = {
  pas: "Problem-Agitate-Solution: pain-first short outreach structure.",
  aida: "Attention-Interest-Desire-Action: classic persuasion sequence.",
  bab: "Before-After-Bridge: current state -> desired state -> path.",
  jtbd: "Jobs-to-be-Done: center on recipient job and desired progress.",
};

const hypothesisOptions = computed(() =>
  props.hypotheses.map((h) => ({ label: h.name, value: h.id }))
);

type SavedPreset = {
  name: string;
  model: string | null;
  tone: Tone;
  goal: Goal;
  ctaStyle: CtaStyle;
  personalizationDepth: PersonalizationDepth;
  readingLevel: ReadingLevel;
  formality: Formality;
  emojiPolicy: EmojiPolicy;
  questionCountMax: 0 | 1 | 2;
  readingLevelPreset: ReadingLevelPreset;
  tonePreset: TonePreset;
  lengthPreset: LengthPreset;
  methodology: MethodologyPreset;
  focus: FocusPreset;
  ctaType: CtaType;
  temperature: number;
  sentences: number;
  paragraphs: number;
  mentionBlocks: MentionBlock[];
  additionalInstructions: string;
};

const presets = ref<SavedPreset[]>([]);

function loadPresetsFromStorage() {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) {
      presets.value = [];
      return;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      presets.value = [];
      return;
    }
    presets.value = parsed
      .filter((p): p is SavedPreset => typeof p === "object" && p !== null && "name" in p)
      .map((p) => ({ ...p }));
  } catch {
    presets.value = [];
  }
}

function savePresetsToStorage() {
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets.value));
}

function currentPresetPayload(name: string): SavedPreset {
  return {
    name,
    model: selectedModel.value,
    tone: tone.value,
    goal: goal.value,
    ctaStyle: ctaStyle.value,
    personalizationDepth: personalizationDepth.value,
    readingLevel: readingLevel.value,
    formality: formality.value,
    emojiPolicy: emojiPolicy.value,
    questionCountMax: questionCountMax.value,
    readingLevelPreset: readingLevelPreset.value,
    tonePreset: tonePreset.value,
    lengthPreset: lengthPreset.value,
    methodology: methodology.value,
    focus: focus.value,
    ctaType: ctaType.value,
    temperature: temperature.value,
    sentences: sentences.value,
    paragraphs: paragraphs.value,
    mentionBlocks: [...mentionBlocks.value],
    additionalInstructions: additionalInstructions.value,
  };
}

function savePreset() {
  deriveLegacyValuesFromStyle();
  const name = presetName.value.trim();
  if (!name) {
    message.warning("Preset name required.");
    return;
  }
  const payload = currentPresetPayload(name);
  const idx = presets.value.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
  if (idx >= 0) presets.value[idx] = payload;
  else presets.value.push(payload);
  presets.value = [...presets.value].sort((a, b) => a.name.localeCompare(b.name));
  savePresetsToStorage();
  selectedPresetName.value = name;
  message.success("Preset saved.");
}

function loadPresetByName(name: string | null) {
  if (!name) return;
  const p = presets.value.find((x) => x.name === name);
  if (!p) return;
  selectedModel.value = p.model;
  tone.value = p.tone;
  goal.value = p.goal;
  ctaStyle.value = p.ctaStyle;
  personalizationDepth.value = p.personalizationDepth;
  readingLevel.value = p.readingLevel;
  formality.value = p.formality;
  emojiPolicy.value = p.emojiPolicy;
  questionCountMax.value = p.questionCountMax;
  readingLevelPreset.value = p.readingLevelPreset ?? "high_school";
  tonePreset.value = p.tonePreset ?? "casual";
  lengthPreset.value = p.lengthPreset ?? "medium";
  methodology.value = p.methodology ?? "pas";
  focus.value = p.focus ?? "pain";
  ctaType.value = p.ctaType ?? "initiate_conversation";
  temperature.value = p.temperature;
  sentences.value = p.sentences;
  paragraphs.value = p.paragraphs;
  mentionBlocks.value = [...p.mentionBlocks];
  additionalInstructions.value = p.additionalInstructions;
  message.success("Preset loaded.");
}

function deletePresetByName(name: string | null) {
  if (!name) return;
  presets.value = presets.value.filter((p) => p.name !== name);
  savePresetsToStorage();
  if (selectedPresetName.value === name) selectedPresetName.value = null;
}

const selectedModelMeta = computed(
  () => rawModels.value.find((m) => m.id === selectedModel.value) ?? null
);

const modelOptions = computed(() => {
  return rawModels.value.map((m) => ({
    value: m.id,
    label: `${m.name}` + (m.contextLength ? ` (${m.contextLength.toLocaleString()} ctx)` : ""),
  }));
});

const presetOptions = computed(() => presets.value.map((p) => ({ label: p.name, value: p.name })));

async function loadModels() {
  if (!props.show) return;
  modelsLoading.value = true;
  modelsError.value = "";
  try {
    const r = await fetch("/api/openrouter/models");
    const j = (await r.json()) as {
      data?: Array<{
        id: string;
        name: string;
        contextLength?: number | null;
        pricingPrompt?: string | null;
        pricingCompletion?: string | null;
      }>;
      error?: string;
    };
    if (!r.ok || j.error) {
      modelsError.value = j.error ?? "Failed to load models.";
      rawModels.value = [];
      selectedModel.value = null;
      return;
    }
    rawModels.value = (j.data ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      contextLength: m.contextLength ?? null,
      pricingPrompt: m.pricingPrompt ?? null,
      pricingCompletion: m.pricingCompletion ?? null,
    }));
    if (!selectedModel.value && modelOptions.value.length > 0) {
      selectedModel.value = modelOptions.value[0].value;
    }
  } catch (e) {
    modelsError.value = e instanceof Error ? e.message : "Failed to load models.";
    rawModels.value = [];
  } finally {
    modelsLoading.value = false;
  }
}

function applyPreset(preset: ModePreset) {
  if (preset === "simple") {
    tonePreset.value = "casual";
    readingLevelPreset.value = "high_school";
    lengthPreset.value = "medium";
    methodology.value = "pas";
    focus.value = "pain";
    ctaType.value = "initiate_conversation";
    tone.value = "friendly";
    goal.value = "follow_up";
    ctaStyle.value = "soft";
    personalizationDepth.value = "medium";
    readingLevel.value = "simple";
    formality.value = "casual";
    emojiPolicy.value = "none";
    questionCountMax.value = 1;
    sentences.value = 3;
    paragraphs.value = 1;
    mentionBlocks.value = ["conversation_recap", "contact_experience", "company_about"];
    temperature.value = 0.7;
  } else {
    tonePreset.value = "formal";
    readingLevelPreset.value = "professional";
    lengthPreset.value = "long";
    methodology.value = "aida";
    focus.value = "benefits";
    ctaType.value = "schedule_meeting";
    tone.value = "professional";
    goal.value = "book_call";
    ctaStyle.value = "medium";
    personalizationDepth.value = "high";
    readingLevel.value = "expert";
    formality.value = "formal";
    emojiPolicy.value = "light";
    questionCountMax.value = 1;
    sentences.value = 4;
    paragraphs.value = 2;
    mentionBlocks.value = ["conversation_recap", "contact_experience", "contact_posts", "company_about"];
    temperature.value = 0.6;
  }
}

function deriveLegacyValuesFromStyle() {
  if (tonePreset.value === "formal") {
    tone.value = "professional";
    formality.value = "formal";
  } else if (tonePreset.value === "neutral") {
    tone.value = "consultative";
    formality.value = "casual";
  } else {
    tone.value = "friendly";
    formality.value = "casual";
  }

  readingLevel.value = readingLevelPreset.value === "professional" ? "expert" : "simple";

  if (lengthPreset.value === "extra_short") {
    sentences.value = 2;
    paragraphs.value = 1;
  } else if (lengthPreset.value === "short") {
    sentences.value = 3;
    paragraphs.value = 1;
  } else if (lengthPreset.value === "medium") {
    sentences.value = 5;
    paragraphs.value = 2;
  } else if (lengthPreset.value === "long") {
    sentences.value = 7;
    paragraphs.value = 3;
  } else {
    sentences.value = 9;
    paragraphs.value = 4;
  }

  if (focus.value === "pain") personalizationDepth.value = "high";
  else if (focus.value === "benefits") personalizationDepth.value = "high";
  else personalizationDepth.value = "medium";

  if (ctaType.value === "schedule_meeting") {
    goal.value = "book_call";
    ctaStyle.value = "hard";
  } else if (ctaType.value === "politely_disengage") {
    goal.value = "close_loop";
    ctaStyle.value = "no_cta";
  } else if (ctaType.value === "request_introduction") {
    goal.value = "ask_question";
    ctaStyle.value = "medium";
  } else {
    goal.value = "follow_up";
    ctaStyle.value = "soft";
  }
}

watch(
  () => props.show,
  (open) => {
    if (!open) return;
    generatedText.value = "";
    generationError.value = "";
    additionalInstructions.value = "";
    selectedHypothesisId.value = null;
    presetName.value = "";
    selectedPresetName.value = null;
    loadPresetsFromStorage();
    applyPreset(props.preset);
    void loadModels();
  }
);

watch(
  () => props.preset,
  () => {
    if (!props.show) return;
    applyPreset(props.preset);
  }
);

const canGenerate = computed(
  () =>
    Boolean(props.projectId) &&
    Boolean(props.conversationUuid) &&
    Boolean(props.contactId) &&
    Boolean(selectedModel.value) &&
    !generationLoading.value
);

async function generateMessage() {
  if (!canGenerate.value || !props.projectId || !props.conversationUuid || !selectedModel.value) return;
  deriveLegacyValuesFromStyle();
  generationLoading.value = true;
  generationError.value = "";
  generatedText.value = "";
  try {
    const r = await fetch("/api/generated-messages/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: props.projectId,
        conversationUuid: props.conversationUuid,
        model: selectedModel.value,
        tone: tone.value,
        goal: goal.value,
        ctaStyle: ctaStyle.value,
        personalizationDepth: personalizationDepth.value,
        readingLevel: readingLevel.value,
        formality: formality.value,
        emojiPolicy: emojiPolicy.value,
        questionCountMax: questionCountMax.value,
        readingLevelPreset: readingLevelPreset.value,
        tonePreset: tonePreset.value,
        lengthPreset: lengthPreset.value,
        methodology: methodology.value,
        focus: focus.value,
        ctaType: ctaType.value,
        format: { sentences: sentences.value, paragraphs: paragraphs.value },
        mentionBlocks: mentionBlocks.value,
        additionalInstructions: additionalInstructions.value,
        hypothesisId: selectedHypothesisId.value,
        temperature: temperature.value,
      }),
    });
    const j = (await r.json()) as {
      data?: {
        content?: string;
        generatedMessage?: { id?: string; content?: string; created_at?: string };
      };
      error?: string;
    };
    if (!r.ok || j.error) {
      generationError.value = j.error ?? "Generation failed.";
      return;
    }
    generatedText.value = j.data?.content?.trim() ?? "";
    if (!generatedText.value) generationError.value = "Generation returned empty content.";
    if (generatedText.value) {
      const row = j.data?.generatedMessage;
      if (row?.id && row.created_at) {
        emit("generated", {
          id: row.id,
          content: typeof row.content === "string" && row.content.trim() ? row.content : generatedText.value,
          created_at: row.created_at,
        });
      }
      emit("update:show", false);
      message.success("Generated and saved to pending.");
    }
  } catch (e) {
    generationError.value = e instanceof Error ? e.message : "Generation failed.";
  } finally {
    generationLoading.value = false;
  }
}

async function copyGeneratedMessage() {
  if (!generatedText.value) return;
  try {
    await navigator.clipboard.writeText(generatedText.value);
    message.success("Generated message copied.");
  } catch {
    message.error("Failed to copy generated message.");
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="Generate message"
    style="width: 680px"
    @update:show="emit('update:show', $event)"
  >
    <NSpin :show="modelsLoading">
      <NAlert v-if="modelsError" type="error" style="margin-bottom: 12px">
        {{ modelsError }}
      </NAlert>
      <NSpace vertical :size="12">
        <div>
          <div style="margin-bottom: 6px; font-size: 12px; opacity: 0.8">Model</div>
          <NSelect v-model:value="selectedModel" :options="modelOptions" filterable placeholder="Select model" />
          <NAlert v-if="selectedModelMeta" type="info" style="margin-top: 8px">
            <div><strong>Context:</strong> {{ selectedModelMeta.contextLength ?? "—" }}</div>
            <div><strong>Prompt price:</strong> {{ selectedModelMeta.pricingPrompt ?? "—" }}</div>
            <div><strong>Completion price:</strong> {{ selectedModelMeta.pricingCompletion ?? "—" }}</div>
          </NAlert>
        </div>

        <div>
          <div style="margin-bottom: 6px; font-size: 12px; opacity: 0.8">Presets</div>
          <div class="gm-grid2">
            <NSelect
              v-model:value="selectedPresetName"
              :options="presetOptions"
              clearable
              placeholder="Load preset"
              @update:value="loadPresetByName"
            />
            <NButton :disabled="!selectedPresetName" @click="deletePresetByName(selectedPresetName)">
              Delete preset
            </NButton>
          </div>
          <div class="gm-grid2" style="margin-top: 8px">
            <NInput v-model:value="presetName" placeholder="Preset name" />
            <NButton type="primary" @click="savePreset">Save preset</NButton>
          </div>
        </div>

        <div class="gm-grid2">
          <div>
            <div style="margin-bottom: 6px; font-size: 12px; opacity: 0.8">Reading level</div>
            <NSelect v-model:value="readingLevelPreset" :options="readingLevelPresetOptions" />
          </div>
          <div>
            <div style="margin-bottom: 6px; font-size: 12px; opacity: 0.8">Tone</div>
            <NSelect v-model:value="tonePreset" :options="tonePresetOptions" />
          </div>
          <div>
            <div style="margin-bottom: 6px; font-size: 12px; opacity: 0.8">Length</div>
            <NSelect v-model:value="lengthPreset" :options="lengthPresetOptions" />
          </div>
          <div>
            <div class="gm-label-with-help">
              <span>Methodology</span>
              <NTooltip trigger="hover">
                <template #trigger><span class="gm-help">?</span></template>
                {{ methodologyHints[methodology] }}
              </NTooltip>
            </div>
            <NSelect v-model:value="methodology" :options="methodologyOptions" />
          </div>
          <div>
            <div class="gm-label-with-help">
              <span>Focus</span>
              <NTooltip trigger="hover">
                <template #trigger><span class="gm-help">?</span></template>
                Controls opening angle in prompt: pain-first, balanced, or benefits-first.
              </NTooltip>
            </div>
            <NSelect v-model:value="focus" :options="focusOptions" />
          </div>
          <div>
            <div class="gm-label-with-help">
              <span>Call to action</span>
              <NTooltip trigger="hover">
                <template #trigger><span class="gm-help">?</span></template>
                Injects target CTA behavior into prompt (meeting ask, feedback ask, intro request, etc).
              </NTooltip>
            </div>
            <NSelect v-model:value="ctaType" :options="ctaTypeOptions" />
          </div>
          <div>
            <div style="margin-bottom: 6px; font-size: 12px; opacity: 0.8">Emoji policy</div>
            <NSelect v-model:value="emojiPolicy" :options="emojiPolicyOptions" />
          </div>
          <div>
            <div class="gm-label-with-help">
              <span>Question count max</span>
              <NTooltip trigger="hover">
                <template #trigger><span class="gm-help">?</span></template>
                Hard cap passed to prompt to limit number of questions in output.
              </NTooltip>
            </div>
            <NSelect v-model:value="questionCountMax" :options="questionCountOptions" />
          </div>
        </div>

        <div>
          <div style="margin-bottom: 6px; font-size: 12px; opacity: 0.8">
            Temperature (creativity)
          </div>
          <NInputNumber v-model:value="temperature" :min="0" :max="2" :step="0.1" style="width: 100%" />
        </div>

        <div class="gm-grid2">
          <div>
            <div class="gm-label-with-help">
              <span>Sentences</span>
              <NTooltip trigger="hover">
                <template #trigger><span class="gm-help">?</span></template>
                Added to prompt as target sentence count.
              </NTooltip>
            </div>
            <NInputNumber v-model:value="sentences" :min="1" :max="12" style="width: 100%" />
          </div>
          <div>
            <div class="gm-label-with-help">
              <span>Paragraphs</span>
              <NTooltip trigger="hover">
                <template #trigger><span class="gm-help">?</span></template>
                Added to prompt as exact paragraph count target.
              </NTooltip>
            </div>
            <NInputNumber v-model:value="paragraphs" :min="1" :max="6" style="width: 100%" />
          </div>
        </div>

        <div>
          <div class="gm-label-with-help">
            <span>Blocks to mention</span>
            <NTooltip trigger="hover">
              <template #trigger><span class="gm-help">?</span></template>
              These switches control which contact/company/conversation data points get injected into prompt context.
            </NTooltip>
          </div>
          <NCheckboxGroup v-model:value="mentionBlocks">
            <NSpace>
              <NCheckbox v-for="opt in mentionBlockOptions" :key="opt.value" :value="opt.value">
                <span class="gm-check-label">
                  {{ opt.label }}
                  <NTooltip trigger="hover">
                    <template #trigger><span class="gm-help gm-help--small">?</span></template>
                    {{ opt.hint }}
                  </NTooltip>
                </span>
              </NCheckbox>
            </NSpace>
          </NCheckboxGroup>
        </div>

        <div>
          <div style="margin-bottom: 6px; font-size: 12px; opacity: 0.8">Hypothesis (optional)</div>
          <NSelect
            v-model:value="selectedHypothesisId"
            clearable
            :options="hypothesisOptions"
            placeholder="Select hypothesis (optional)"
          />
        </div>

        <div>
          <div class="gm-label-with-help">
            <span>Additional instructions (optional)</span>
            <NTooltip trigger="hover">
              <template #trigger><span class="gm-help">?</span></template>
              Appended directly to prompt. Use for hard constraints, banned phrases, or custom CTA wording.
            </NTooltip>
          </div>
          <NInput
            v-model:value="additionalInstructions"
            type="textarea"
            :rows="2"
            placeholder="Example: keep ask very soft, no hard CTA"
          />
        </div>
      </NSpace>
    </NSpin>

    <NAlert v-if="generationError" type="error" style="margin-top: 12px">
      {{ generationError }}
    </NAlert>

    <div v-if="generatedText" style="margin-top: 12px">
      <div style="margin-bottom: 6px; font-size: 12px; opacity: 0.8">Generated message</div>
      <NInput v-model:value="generatedText" type="textarea" :rows="6" />
    </div>

    <NSpace justify="end" style="margin-top: 16px">
      <NButton @click="emit('update:show', false)">Close</NButton>
      <NButton :disabled="!generatedText" @click="copyGeneratedMessage">Copy</NButton>
      <NButton type="primary" :disabled="!canGenerate" :loading="generationLoading" @click="generateMessage">
        Generate
      </NButton>
    </NSpace>
  </NModal>
</template>

<style scoped>
.gm-grid2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.gm-label-with-help {
  margin-bottom: 6px;
  font-size: 12px;
  opacity: 0.8;
  display: flex;
  align-items: center;
  gap: 6px;
}

.gm-check-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.gm-help {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.28);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  line-height: 1;
  cursor: help;
  user-select: none;
  opacity: 0.8;
}

.gm-help--small {
  width: 14px;
  height: 14px;
  font-size: 10px;
}
</style>
