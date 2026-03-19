<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { useDebounceFn } from "@vueuse/core";
import {
  NModal, NForm, NFormItem, NSelect, NInput,
  NDivider, NSpace, NButton, useMessage,
} from "naive-ui";

// ── Props & emits ─────────────────────────────────────────────────────────────

const props = defineProps<{
  show: boolean;
  /** UUID of the contact to patch */
  contactId: string | null;
  /** Display name shown in the modal header */
  contactName?: string | null;
  /** Pre-fill the search box with this value on open */
  initialSearch?: string | null;
}>();

const emit = defineEmits<{
  (e: "update:show", v: boolean): void;
  /** Fired after a successful attach; parent should update its local state */
  (e: "attached", payload: { contactId: string; companyId: string; companyName: string }): void;
}>();

// ── Internal state ────────────────────────────────────────────────────────────

const message = useMessage();

type CompanyOption = { id: string; name: string; domain: string | null };

const companySelectRef = ref<{ focus: () => void } | null>(null);
const companySearch = ref("");
const companyOptions = ref<CompanyOption[]>([]);
const companySearchLoading = ref(false);
const selectedCompanyId = ref<string | null>(null);
const selectedCompanyName = ref<string | null>(null);

const showCreateForm = ref(false);
const newCompanyName = ref("");
const newCompanyDomain = ref("");
const creatingCompany = ref(false);
const attachingCompany = ref(false);

// ── Derived ───────────────────────────────────────────────────────────────────

const companySelectOptions = computed(() =>
  companyOptions.value.map((c) => ({
    label: c.domain ? `${c.name} (${c.domain})` : c.name,
    value: c.id,
  }))
);

// ── Company search ────────────────────────────────────────────────────────────

const debouncedSearch = useDebounceFn(async () => {
  const q = companySearch.value.trim();
  companySearchLoading.value = true;
  try {
    const params = new URLSearchParams({ limit: "20" });
    if (q) params.set("search", q);
    const r = await fetch(`/api/companies?${params.toString()}`);
    const j = await r.json();
    companyOptions.value = (j.data ?? []) as CompanyOption[];
  } catch {
    companyOptions.value = [];
  } finally {
    companySearchLoading.value = false;
  }
}, 250);

watch(companySearch, () => debouncedSearch());

// ── Reset when opened ─────────────────────────────────────────────────────────

watch(() => props.show, (open) => {
  if (!open) return;
  selectedCompanyId.value = null;
  selectedCompanyName.value = null;
  showCreateForm.value = false;
  newCompanyName.value = "";
  newCompanyDomain.value = "";
  companySearch.value = props.initialSearch?.trim() ?? "";
  void debouncedSearch();
  nextTick(() => setTimeout(() => companySelectRef.value?.focus(), 80));
});

// ── Select handler ────────────────────────────────────────────────────────────

function onCompanySelect(id: string) {
  selectedCompanyId.value = id;
  const found = companyOptions.value.find((c) => c.id === id);
  selectedCompanyName.value = found?.name ?? null;
}

// ── Attach ────────────────────────────────────────────────────────────────────

async function doAttach() {
  const contactId = props.contactId;
  if (!contactId || !selectedCompanyId.value) return;
  attachingCompany.value = true;
  try {
    const r = await fetch(`/api/contacts/${encodeURIComponent(contactId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: selectedCompanyId.value,
        companyName: selectedCompanyName.value,
      }),
    });
    const j = await r.json();
    if (!r.ok) { message.error(j.error ?? "Failed to attach company"); return; }
    message.success("Company attached!");
    emit("attached", {
      contactId,
      companyId: selectedCompanyId.value,
      companyName: selectedCompanyName.value ?? "",
    });
    emit("update:show", false);
  } finally {
    attachingCompany.value = false;
  }
}

// ── Create & attach ───────────────────────────────────────────────────────────

async function createAndAttach() {
  if (!newCompanyName.value.trim() || !props.contactId) return;
  creatingCompany.value = true;
  try {
    const r = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newCompanyName.value.trim(),
        domain: newCompanyDomain.value.trim() || null,
      }),
    });
    const j = await r.json();
    if (!r.ok) { message.error(j.error ?? "Failed to create company"); return; }
    selectedCompanyId.value = j.id;
    selectedCompanyName.value = newCompanyName.value.trim();
    await doAttach();
  } finally {
    creatingCompany.value = false;
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    style="width: 480px"
    title="Attach company to contact"
    @update:show="emit('update:show', $event)"
  >
    <div v-if="contactName" style="margin-bottom: 8px; opacity: 0.7; font-size: 0.9rem">
      {{ contactName }}
    </div>

    <!-- Search existing -->
    <NForm v-if="!showCreateForm">
      <NFormItem label="Search and select company">
        <NSelect
          ref="companySelectRef"
          v-model:value="selectedCompanyId"
          :options="companySelectOptions"
          :loading="companySearchLoading"
          filterable
          remote
          clearable
          :default-value="null"
          placeholder="Type to search companies…"
          style="width: 100%"
          @search="(q: string) => { companySearch = q; }"
          @update:value="onCompanySelect"
        />
      </NFormItem>
    </NForm>

    <!-- Create new sub-form -->
    <div v-if="showCreateForm">
      <NDivider style="margin: 8px 0 16px" />
      <NForm>
        <NFormItem label="Company name" required>
          <NInput v-model:value="newCompanyName" placeholder="Acme Corp" />
        </NFormItem>
        <NFormItem label="Domain (optional)">
          <NInput v-model:value="newCompanyDomain" placeholder="acme.com" />
        </NFormItem>
      </NForm>
    </div>

    <NDivider style="margin: 8px 0 12px" />

    <NSpace justify="space-between" align="center">
      <NButton size="small" quaternary @click="showCreateForm = !showCreateForm">
        {{ showCreateForm ? "← Back to search" : "+ Create new company" }}
      </NButton>
      <NSpace>
        <NButton @click="emit('update:show', false)">Cancel</NButton>
        <NButton
          v-if="!showCreateForm"
          type="primary"
          :disabled="!selectedCompanyId || attachingCompany"
          :loading="attachingCompany"
          @click="doAttach"
        >Attach</NButton>
        <NButton
          v-else
          type="primary"
          :disabled="!newCompanyName.trim() || creatingCompany"
          :loading="creatingCompany"
          @click="createAndAttach"
        >Create & attach</NButton>
      </NSpace>
    </NSpace>
  </NModal>
</template>
