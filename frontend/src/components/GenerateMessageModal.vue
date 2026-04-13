<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NModal,
  NSpace,
  NButton,
  NSelect,
  NInputNumber,
  NInput,
  NEmpty,
  NAlert,
  NSpin,
  NTooltip,
  NPopover,
  NDropdown,
  useMessage,
} from "naive-ui";
import "emoji-picker-element";

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
const PRESETS_STORAGE_KEY = "generate-message.presets.bundle.v1";
const PRESETS_SCHEMA = "generate-message-presets.v1";

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
const messageExamples = ref<string[]>([]);
const selectedHypothesisId = ref<string | null>(null);

const generationLoading = ref(false);
const generationError = ref("");
const generatedText = ref("");
const presetName = ref("");
const presetIcon = ref<string | null>(null);
const emojiPopoverShow = ref(false);
const selectedPresetName = ref<string | null>(null);
const defaultPresetName = ref<string | null>(null);
const importInputRef = ref<HTMLInputElement | null>(null);

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
  icon: string | null;
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
  selectedHypothesisId: string | null;
  additionalInstructions: string;
  messageExamples: string[];
};

const presets = ref<SavedPreset[]>([]);

type PresetBundle = {
  schema: string;
  exportedAt: string;
  defaultPresetName: string | null;
  presets: SavedPreset[];
};

function normalizePreset(p: SavedPreset): SavedPreset {
  const normalizedExamples = Array.isArray(p.messageExamples)
    ? p.messageExamples
    : typeof (p as { messageExamplesInput?: unknown }).messageExamplesInput === "string"
      ? String((p as { messageExamplesInput?: unknown }).messageExamplesInput)
          .split(/\r?\n+/)
          .map((v) => v.trim())
          .filter(Boolean)
      : [];
  return {
    ...p,
    icon: typeof p.icon === "string" && p.icon.trim() ? p.icon.trim() : null,
    selectedHypothesisId:
      typeof p.selectedHypothesisId === "string" && p.selectedHypothesisId.trim()
        ? p.selectedHypothesisId.trim()
        : null,
    messageExamples: normalizedExamples,
  };
}

function loadPresetsFromStorage() {
  try {
    const rawBundle = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!rawBundle) {
      presets.value = [];
      defaultPresetName.value = null;
      return;
    }
    const parsed = JSON.parse(rawBundle) as unknown;
    if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid bundle JSON.");
    const b = parsed as Partial<PresetBundle>;
    if (b.schema !== PRESETS_SCHEMA || !Array.isArray(b.presets)) throw new Error("Invalid preset schema.");
    presets.value = b.presets
      .filter((p): p is SavedPreset => typeof p === "object" && p !== null && "name" in p)
      .map((p) => normalizePreset({ ...p }));
    defaultPresetName.value = typeof b.defaultPresetName === "string" ? b.defaultPresetName : null;
  } catch {
    defaultPresetName.value = null;
    presets.value = [];
  }
}

function makePresetBundle(): PresetBundle {
  return {
    schema: PRESETS_SCHEMA,
    exportedAt: new Date().toISOString(),
    defaultPresetName: defaultPresetName.value,
    presets: presets.value.map((p) => normalizePreset({ ...p })),
  };
}

function savePresetsToStorage() {
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(makePresetBundle()));
}

function currentPresetPayload(name: string): SavedPreset {
  return {
    name,
    icon: presetIcon.value,
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
    selectedHypothesisId: selectedHypothesisId.value,
    additionalInstructions: additionalInstructions.value,
    messageExamples: messageExamples.value.map((v) => v.trim()).filter(Boolean),
  };
}

function savePreset() {
  deriveLegacyValuesFromStyle();
  const fallbackName = selectedPresetName.value?.trim() ?? "";
  const name = (presetName.value.trim() || fallbackName).trim();
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
  presetName.value = name;
  message.success("Preset saved.");
}

function loadPresetByName(name: string | null) {
  if (!name) return;
  const p = presets.value.find((x) => x.name === name);
  if (!p) return;
  selectedModel.value = p.model;
  presetIcon.value = p.icon ?? null;
  presetName.value = p.name;
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
  selectedHypothesisId.value = p.selectedHypothesisId ?? null;
  additionalInstructions.value = p.additionalInstructions;
  messageExamples.value = Array.isArray(p.messageExamples) ? p.messageExamples : [];
}

function selectPreset(name: string | null) {
  if (!name) {
    selectedPresetName.value = null;
    presetName.value = "";
    presetIcon.value = null;
    editingExampleIndex.value = null;
    return;
  }
  selectedPresetName.value = name;
  editingExampleIndex.value = null;
  loadPresetByName(name);
}

function deletePresetByName(name: string | null) {
  if (!name) return;
  presets.value = presets.value.filter((p) => p.name !== name);
  if (defaultPresetName.value === name) defaultPresetName.value = null;
  savePresetsToStorage();
  if (selectedPresetName.value === name) selectedPresetName.value = null;
}

function setDefaultPreset(name: string | null) {
  defaultPresetName.value = name;
  savePresetsToStorage();
  if (name) message.success(`Default preset set: ${name}`);
}

function toggleDefaultPreset(name: string) {
  if (defaultPresetName.value === name) {
    setDefaultPreset(null);
  } else {
    setDefaultPreset(name);
  }
}

function handlePresetRowAction(key: string, name: string) {
  if (key === "delete") {
    deletePresetByName(name);
  }
}

function handleEmojiPick(ev: Event) {
  const e = ev as CustomEvent<{ unicode?: string }>;
  const picked = e.detail?.unicode;
  if (picked && picked.trim()) {
    presetIcon.value = picked.trim();
  }
  emojiPopoverShow.value = false;
}

type ModelSelectOption = { value: string; label: string };
type GroupedModelOption = { type: "group"; key: string; label: string; children: ModelSelectOption[] };

function getProviderName(modelId: string): string {
  const head = modelId.split("/")[0]?.trim() || "";
  if (!head) return "Other";
  const normalized = head.replace(/[-_]/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

const groupedModelOptions = computed<GroupedModelOption[]>(() => {
  const groups = new Map<string, ModelSelectOption[]>();
  for (const m of rawModels.value) {
    const provider = getProviderName(m.id);
    const item = {
      value: m.id,
      label: `${m.name}` + (m.contextLength ? ` (${m.contextLength.toLocaleString()} ctx)` : ""),
    };
    if (!groups.has(provider)) groups.set(provider, []);
    groups.get(provider)?.push(item);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, children]) => ({
      type: "group" as const,
      key: provider,
      label: provider,
      children: children.sort((a, b) => a.label.localeCompare(b.label)),
    }));
});

const firstModelValue = computed(() => groupedModelOptions.value[0]?.children?.[0]?.value ?? null);

const presetSidebarItems = computed(() =>
  presets.value.map((p) => ({
    name: p.name,
    icon: p.icon ?? "📁",
    isDefault: defaultPresetName.value === p.name,
  }))
);

const editingExampleIndex = ref<number | null>(null);

function truncateExamplePreview(text: string, max = 120): string {
  const t = text.trim();
  if (!t) return "(empty)";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function addExample() {
  messageExamples.value.push("");
  editingExampleIndex.value = messageExamples.value.length - 1;
}

function startEditExample(index: number) {
  editingExampleIndex.value = index;
}

function doneEditExample() {
  const idx = editingExampleIndex.value;
  if (idx === null) return;
  const raw = messageExamples.value[idx] ?? "";
  const t = raw.trim();
  if (!t) {
    messageExamples.value.splice(idx, 1);
  } else {
    messageExamples.value[idx] = t;
  }
  editingExampleIndex.value = null;
}

function removeExample(index: number) {
  messageExamples.value.splice(index, 1);
  if (editingExampleIndex.value === index) editingExampleIndex.value = null;
  else if (editingExampleIndex.value !== null && editingExampleIndex.value > index) {
    editingExampleIndex.value--;
  }
}

const mentionBlockSelectOptions = computed(() =>
  mentionBlockOptions.map((o) => ({ label: o.label, value: o.value }))
);

function exportPresetsToJson() {
  if (presets.value.length === 0) {
    message.warning("No presets to export.");
    return;
  }
  const blob = new Blob([JSON.stringify(makePresetBundle(), null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `generate-message-presets-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  message.success("Presets exported.");
}

function openImportDialog() {
  importInputRef.value?.click();
}

async function handleImportFile(e: Event) {
  const input = e.target as HTMLInputElement | null;
  const file = input?.files?.[0] ?? null;
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid JSON");
    const b = parsed as Partial<PresetBundle>;
    if (b.schema !== PRESETS_SCHEMA || !Array.isArray(b.presets)) {
      throw new Error("Unsupported preset schema.");
    }
    const imported = b.presets
      .filter((p): p is SavedPreset => typeof p === "object" && p !== null && "name" in p)
      .map((p) => normalizePreset({ ...p }));
    if (imported.length === 0) throw new Error("No valid presets found.");
    const map = new Map<string, SavedPreset>();
    for (const p of presets.value) map.set(p.name.toLowerCase(), p);
    for (const p of imported) map.set(p.name.toLowerCase(), p);
    presets.value = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (typeof b.defaultPresetName === "string" && b.defaultPresetName.trim()) {
      defaultPresetName.value = b.defaultPresetName.trim();
    }
    savePresetsToStorage();
    message.success(`Imported ${imported.length} preset(s).`);
  } catch (err) {
    message.error(err instanceof Error ? err.message : "Failed to import presets.");
  } finally {
    if (input) input.value = "";
  }
}

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
    if (!selectedModel.value && firstModelValue.value) {
      selectedModel.value = firstModelValue.value;
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
    messageExamples.value = [];
    editingExampleIndex.value = null;
    selectedHypothesisId.value = null;
    presetName.value = "";
    presetIcon.value = null;
    selectedPresetName.value = null;
    loadPresetsFromStorage();
    applyPreset(props.preset);
    if (defaultPresetName.value) {
      loadPresetByName(defaultPresetName.value);
      selectedPresetName.value = defaultPresetName.value;
    }
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
        messageExamples: messageExamples.value.map((v) => v.trim()).filter(Boolean),
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
    style="width: 1480px"
    @update:show="emit('update:show', $event)"
  >
    <NSpin :show="modelsLoading">
      <NAlert v-if="modelsError" type="error" style="margin-bottom: 12px">
        {{ modelsError }}
      </NAlert>
      <div class="gm-layout">
        <aside class="gm-sidebar">
          <div class="gm-sidebar-title">Presets</div>
          <div class="gm-sidebar-list">
            <div
              role="button"
              tabindex="0"
              class="gm-preset-item"
              :class="{ 'gm-preset-item--active': !selectedPresetName }"
              @click="selectPreset(null)"
              @keydown.enter.prevent="selectPreset(null)"
              @keydown.space.prevent="selectPreset(null)"
            >
              <span class="gm-preset-item-icon">🛠</span>
              <span>Custom</span>
            </div>
            <div
              v-for="item in presetSidebarItems"
              :key="item.name"
              role="button"
              tabindex="0"
              class="gm-preset-item"
              :class="{ 'gm-preset-item--active': selectedPresetName === item.name }"
              @click="selectPreset(item.name)"
              @keydown.enter.prevent="selectPreset(item.name)"
              @keydown.space.prevent="selectPreset(item.name)"
            >
              <span class="gm-preset-item-icon">{{ item.icon }}</span>
              <span class="gm-preset-item-name">{{ item.name }}</span>
              <button
                type="button"
                class="gm-preset-item-default-toggle"
                :class="{ 'gm-preset-item-default-toggle--active': item.isDefault }"
                @click.stop="toggleDefaultPreset(item.name)"
                :title="item.isDefault ? 'Unset default preset' : 'Set as default preset'"
              >
                {{ item.isDefault ? "★" : "☆" }}
              </button>
              <NDropdown
                trigger="click"
                :options="[{ label: 'Delete preset', key: 'delete' }]"
                @select="(key) => handlePresetRowAction(String(key), item.name)"
              >
                <button
                  type="button"
                  class="gm-preset-item-menu"
                  aria-label="Preset actions"
                  @click.stop
                >
                  ⋯
                </button>
              </NDropdown>
            </div>
          </div>
          <div class="gm-sidebar-bottom">
            <div class="gm-sidebar-editor">
              <NInput v-model:value="presetName" placeholder="Preset name">
                <template #prefix>
                  <NPopover v-model:show="emojiPopoverShow" trigger="click" placement="bottom-start">
                    <template #trigger>
                      <button type="button" class="gm-emoji-btn" :title="presetIcon ? 'Change emoji' : 'Pick emoji'">
                        {{ presetIcon ?? "🙂" }}
                      </button>
                    </template>
                    <div class="gm-emoji-picker-wrap">
                      <emoji-picker @emoji-click="handleEmojiPick"></emoji-picker>
                      <NButton size="tiny" style="margin-top: 6px; width: 100%" @click="presetIcon = null">
                        Clear emoji
                      </NButton>
                    </div>
                  </NPopover>
                </template>
              </NInput>
              <div class="gm-sidebar-editor-actions">
                <NButton type="primary" @click="savePreset">Save</NButton>
              </div>
            </div>
            <div class="gm-sidebar-actions">
              <NButton size="small" @click="openImportDialog">📥 Import JSON</NButton>
              <NButton size="small" @click="exportPresetsToJson">📤 Export JSON</NButton>
            </div>
          </div>
        </aside>
        <div class="gm-main">
          <div class="gm-sections">
            <div class="gm-section gm-section--tight">
              <div class="gm-section-title gm-section-title--sm">Model</div>
              <NSelect
                v-model:value="selectedModel"
                class="gm-model-select"
                size="small"
                :options="groupedModelOptions"
                filterable
                placeholder="Select…"
              />
            </div>

            <div class="gm-section">
              <div class="gm-section-title">2) Writing style</div>
              <div class="gm-section-subtitle">Set tone and persuasion strategy.</div>
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
            </div>

            <div class="gm-section gm-section--tight">
              <div class="gm-section-title gm-section-title--sm">3) Structure</div>
              <div class="gm-structure-nums">
                <div class="gm-num-cell">
                  <span class="gm-num-label">Temp</span>
                  <NInputNumber
                    v-model:value="temperature"
                    size="small"
                    :min="0"
                    :max="2"
                    :step="0.1"
                    class="gm-num-input"
                  />
                </div>
                <div class="gm-num-cell">
                  <span class="gm-num-label">Sentences</span>
                  <NInputNumber
                    v-model:value="sentences"
                    size="small"
                    :min="1"
                    :max="12"
                    class="gm-num-input"
                  />
                </div>
                <div class="gm-num-cell">
                  <span class="gm-num-label">Paragraphs</span>
                  <NInputNumber
                    v-model:value="paragraphs"
                    size="small"
                    :min="1"
                    :max="6"
                    class="gm-num-input"
                  />
                </div>
              </div>
            </div>

            <div class="gm-section gm-section--tight">
              <div class="gm-section-title gm-section-title--sm">4) Context & hypothesis</div>
              <div class="gm-context-hyp-row">
                <NSelect
                  v-model:value="mentionBlocks"
                  size="small"
                  multiple
                  filterable
                  :options="mentionBlockSelectOptions"
                  placeholder="Context blocks"
                  max-tag-count="responsive"
                  class="gm-context-select"
                />
                <NSelect
                  v-model:value="selectedHypothesisId"
                  size="small"
                  clearable
                  filterable
                  :options="hypothesisOptions"
                  placeholder="Hypothesis"
                  class="gm-hypothesis-select"
                />
              </div>
            </div>

            <div class="gm-section">
              <div class="gm-section-title">5) Additional instructions</div>
              <div class="gm-section-subtitle">Optional custom constraints appended to prompt.</div>
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
          </div>
          <input
            ref="importInputRef"
            type="file"
            accept="application/json,.json"
            style="display: none"
            @change="handleImportFile"
          />
        </div>
        <aside class="gm-examples-sidebar">
          <div class="gm-sidebar-title">Message examples</div>
          <div class="gm-section-subtitle">
            Highest impact control. Keep best examples here so model matches your style.
          </div>
          <div class="gm-label-with-help">
            <span>Examples list</span>
            <NTooltip trigger="hover">
              <template #trigger><span class="gm-help">?</span></template>
              Backend adds mandatory rule when examples exist. One list item = one sample message.
            </NTooltip>
          </div>
          <div class="gm-examples-list">
            <div
              v-for="(ex, i) in messageExamples"
              :key="`ex-${i}`"
              class="gm-example-row"
            >
              <template v-if="editingExampleIndex === i">
                <NInput
                  v-model:value="messageExamples[i]"
                  type="textarea"
                  :rows="5"
                  placeholder="Example message text"
                  class="gm-example-row__textarea"
                />
                <NButton size="small" type="primary" @click="doneEditExample">Done</NButton>
              </template>
              <template v-else>
                <div class="gm-example-row__preview">{{ truncateExamplePreview(ex) }}</div>
                <div class="gm-example-row__actions">
                  <NButton size="tiny" quaternary @click="startEditExample(i)">Edit</NButton>
                  <NButton size="tiny" quaternary type="error" @click="removeExample(i)">Remove</NButton>
                </div>
              </template>
            </div>
            <NEmpty v-if="messageExamples.length === 0" description="No examples yet" style="padding: 12px 0" />
          </div>
          <NButton size="small" dashed block @click="addExample">Add example</NButton>
          <div class="gm-example">Edit each item in textarea; Done saves. Empty text removes item.</div>
        </aside>
      </div>
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

.gm-layout {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr) 420px;
  gap: 12px;
  min-height: 620px;
}

.gm-sidebar {
  border: 1px solid rgba(128, 128, 128, 0.18);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.gm-sidebar-title {
  font-size: 13px;
  font-weight: 600;
}

.gm-sidebar-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  padding-right: 2px;
}

.gm-preset-item {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid rgba(128, 128, 128, 0.22);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  padding: 8px;
  text-align: left;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.gm-preset-item--active {
  border-color: rgba(99, 143, 242, 0.75);
  background: rgba(99, 143, 242, 0.12);
}

.gm-preset-item-icon {
  font-size: 14px;
}

.gm-preset-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.gm-preset-item-default {
  font-size: 10px;
  opacity: 0.75;
}

.gm-preset-item-default-toggle {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  opacity: 0.55;
  line-height: 1;
  padding: 0;
}

.gm-preset-item-default-toggle--active {
  opacity: 1;
}

.gm-preset-item-menu {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 16px;
  opacity: 0.6;
  line-height: 1;
  padding: 0;
}

.gm-preset-item-menu:hover {
  opacity: 1;
}

.gm-sidebar-bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gm-sidebar-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.gm-sidebar-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid rgba(128, 128, 128, 0.18);
}

.gm-sidebar-editor-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.gm-emoji-btn {
  width: 24px;
  height: 24px;
  border: 1px solid rgba(128, 128, 128, 0.35);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}

.gm-emoji-picker-wrap {
  width: 380px;
}

.gm-main {
  min-width: 0;
}

.gm-sections {
  display: grid;
  gap: 10px;
}

.gm-examples-sidebar {
  border: 1px solid rgba(128, 128, 128, 0.18);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.gm-examples-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(52vh, 520px);
  overflow-y: auto;
  padding-right: 2px;
}

.gm-example-row {
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gm-example-row__preview {
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  opacity: 0.88;
}

.gm-example-row__actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.gm-example-row__textarea {
  width: 100%;
}

.gm-section {
  border: 1px solid rgba(128, 128, 128, 0.18);
  border-radius: 10px;
  padding: 10px;
}

.gm-section--tight {
  padding: 8px 10px;
}

.gm-section-title--sm {
  font-size: 12px;
  margin-bottom: 6px;
}

.gm-model-select {
  width: 100%;
}

.gm-structure-nums {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  align-items: end;
}

.gm-num-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.gm-num-label {
  font-size: 11px;
  opacity: 0.65;
}

.gm-num-input {
  width: 100%;
}

.gm-context-hyp-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  align-items: start;
}

.gm-context-select,
.gm-hypothesis-select {
  min-width: 0;
}

.gm-section-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 2px;
}

.gm-section-subtitle {
  font-size: 12px;
  opacity: 0.7;
  margin-bottom: 8px;
}

.gm-picked-summary {
  font-size: 12px;
  line-height: 1.4;
  opacity: 0.75;
  margin-bottom: 8px;
}

.gm-label-with-help {
  margin-bottom: 6px;
  font-size: 12px;
  opacity: 0.8;
  display: flex;
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

.gm-example {
  margin-top: 6px;
  font-size: 11px;
  opacity: 0.65;
}
</style>
