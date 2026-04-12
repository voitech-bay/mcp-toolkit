<script setup lang="ts">
import { ref, computed, watch, h } from "vue";
import {
  NCard,
  NSelect,
  NSpace,
  NDataTable,
  NEmpty,
  NSpin,
  NAlert,
  NStatistic,
  NTag,
  NText,
} from "naive-ui";
import type { DataTableColumns, SelectOption } from "naive-ui";
import { Link2Icon } from "lucide-vue-next";
import { useProjectStore } from "../stores/project";

interface HypothesisOption {
  id: string;
  name: string;
  getsales_tag_uuid: string | null;
  getsales_tag_name: string | null;
}

interface TagContactRow {
  contact_uuid: string;
  name: string | null;
  company_name: string | null;
  work_email: string | null;
  linkedin: string | null;
  company_uuid: string | null;
  inbox_count: number;
  outbox_count: number;
  flow_names: string;
}

const projectStore = useProjectStore();

const hypothesesLoading = ref(false);
const hypothesesError = ref("");
const allHypotheses = ref<HypothesisOption[]>([]);

const selectedHypothesisId = ref<string | null>(null);

const contactsLoading = ref(false);
const contactsError = ref("");
const contacts = ref<TagContactRow[]>([]);
const resolvedTagName = ref<string | null>(null);
/** Invalidates in-flight tag-contacts responses when selection or project changes. */
let tagContactsFetchGen = 0;

const hypothesesWithTags = computed(() =>
  allHypotheses.value.filter((h) => h.getsales_tag_uuid != null && h.getsales_tag_uuid !== "")
);

const selectOptions = computed<SelectOption[]>(() =>
  hypothesesWithTags.value.map((h) => ({
    value: h.id,
    label: `${h.name} — ${h.getsales_tag_name ?? "tag"}`,
  }))
);

const totalContacts = computed(() => contacts.value.length);

const columns: DataTableColumns<TagContactRow> = [
  {
    key: "name",
    title: "Contact",
    ellipsis: { tooltip: true },
    width: 200,
    render: (row) => row.name ?? "—",
  },
  {
    key: "company_name",
    title: "Company",
    ellipsis: { tooltip: true },
    width: 200,
    render: (row) => row.company_name ?? "—",
  },
  {
    key: "work_email",
    title: "Work email",
    ellipsis: { tooltip: true },
    width: 220,
    render: (row) => row.work_email ?? "—",
  },
  {
    key: "linkedin",
    title: "LinkedIn",
    ellipsis: { tooltip: true },
    width: 200,
    render: (row) =>
      row.linkedin
        ? h(
            "a",
            {
              href: row.linkedin.startsWith("http") ? row.linkedin : `https://${row.linkedin}`,
              target: "_blank",
              rel: "noopener noreferrer",
              style: "color: var(--n-primary-color);",
            },
            row.linkedin
          )
        : "—",
  },
  {
    key: "inbox_count",
    title: "Inbox",
    width: 88,
    align: "right",
    render: (row) => row.inbox_count ?? 0,
  },
  {
    key: "outbox_count",
    title: "Outbox",
    width: 88,
    align: "right",
    render: (row) => row.outbox_count ?? 0,
  },
  {
    key: "flow_names",
    title: "Flows",
    ellipsis: { tooltip: true },
    minWidth: 220,
    render: (row) => (row.flow_names?.trim() ? row.flow_names : "—"),
  },
  {
    key: "contact_uuid",
    title: "Contact UUID",
    ellipsis: { tooltip: true },
    width: 280,
    render: (row) => row.contact_uuid,
  },
];

async function fetchHypotheses() {
  const projectId = projectStore.selectedProjectId;
  if (!projectId) {
    allHypotheses.value = [];
    return;
  }
  hypothesesLoading.value = true;
  hypothesesError.value = "";
  try {
    const r = await fetch(`/api/hypotheses?projectId=${encodeURIComponent(projectId)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Failed to load hypotheses");
    const rows = (j.data ?? []) as HypothesisOption[];
    allHypotheses.value = rows;
    if (
      selectedHypothesisId.value &&
      !hypothesesWithTags.value.some((h) => h.id === selectedHypothesisId.value)
    ) {
      selectedHypothesisId.value = null;
      contacts.value = [];
      resolvedTagName.value = null;
    }
  } catch (e) {
    hypothesesError.value = e instanceof Error ? e.message : "Failed";
    allHypotheses.value = [];
  } finally {
    hypothesesLoading.value = false;
  }
}

async function fetchContacts(hypothesisId: string) {
  const gen = ++tagContactsFetchGen;
  contactsLoading.value = true;
  contactsError.value = "";
  contacts.value = [];
  resolvedTagName.value = null;
  try {
    const r = await fetch(`/api/hypotheses/${encodeURIComponent(hypothesisId)}/tag-contacts`);
    const j = (await r.json()) as {
      data?: TagContactRow[];
      tagName?: string | null;
      error?: string;
    };
    if (gen !== tagContactsFetchGen) return;
    if (!r.ok) throw new Error(j.error ?? "Request failed");
    contacts.value = j.data ?? [];
    resolvedTagName.value = j.tagName ?? null;
  } catch (e) {
    if (gen !== tagContactsFetchGen) return;
    contactsError.value = e instanceof Error ? e.message : "Failed";
  } finally {
    if (gen === tagContactsFetchGen) {
      contactsLoading.value = false;
    }
  }
}

watch(
  () => projectStore.selectedProjectId,
  () => {
    tagContactsFetchGen += 1;
    selectedHypothesisId.value = null;
    contacts.value = [];
    resolvedTagName.value = null;
    contactsLoading.value = false;
    void fetchHypotheses();
  },
  { immediate: true }
);

watch(selectedHypothesisId, (id) => {
  if (!id) {
    tagContactsFetchGen += 1;
    contacts.value = [];
    resolvedTagName.value = null;
    contactsError.value = "";
    contactsLoading.value = false;
    return;
  }
  void fetchContacts(id);
});

const selectedHypothesis = computed(() =>
  hypothesesWithTags.value.find((h) => h.id === selectedHypothesisId.value) ?? null
);
</script>

<template>
  <div class="hypothesis-tag-contacts-page">
    <NCard>
      <template #header>
        <div class="page-header">
          <Link2Icon :size="18" class="page-header__icon" />
          <span>Hypothesis → contacts (by tag)</span>
        </div>
      </template>

      <p class="page-lead">
        Choose a hypothesis linked to a GetSales tag. We match contacts whose
        <strong>company</strong> or <strong>contact</strong> tags include that tag (by UUID or name).
        Inbox and outbox are LinkedIn message counts by direction; flows list distinct campaign names from
        FlowLeads for that contact.
      </p>

      <NSpin :show="hypothesesLoading">
        <NAlert v-if="hypothesesError" type="error" style="margin-bottom: 12px" :title="hypothesesError" />
        <NSpace v-else vertical size="large">
          <div class="toolbar-row">
            <div class="toolbar-field">
              <div class="field-label">Hypothesis (with tag)</div>
              <NSelect
                v-model:value="selectedHypothesisId"
                :options="selectOptions"
                :disabled="hypothesesWithTags.length === 0"
                placeholder="Select hypothesis…"
                filterable
                clearable
                style="min-width: min(100%, 420px); max-width: 560px"
              />
            </div>
            <div v-if="selectedHypothesisId" class="stats">
              <NStatistic label="Contacts matched" :value="totalContacts" />
              <div v-if="resolvedTagName || selectedHypothesis?.getsales_tag_name" class="tag-line">
                <NText depth="3" style="font-size: 12px">Tag</NText>
                <NTag size="small" type="info" :bordered="false">
                  {{ resolvedTagName ?? selectedHypothesis?.getsales_tag_name ?? "—" }}
                </NTag>
              </div>
            </div>
          </div>

          <NEmpty
            v-if="!hypothesesLoading && hypothesesWithTags.length === 0"
            description="No hypotheses with a linked GetSales tag. Link tags on GetSales tags page or Hypotheses."
          />

          <NSpin v-else :show="contactsLoading">
            <NAlert v-if="contactsError" type="error" :title="contactsError" />
            <template v-else-if="selectedHypothesisId">
              <NEmpty
                v-if="!contactsLoading && contacts.length === 0"
                description="No contacts match this tag on company/contact tag fields."
              />
              <NDataTable
                v-else-if="contacts.length > 0"
                :columns="columns"
                :data="contacts"
                :bordered="true"
                size="small"
                :scroll-x="1500"
                :row-key="(row: TagContactRow) => row.contact_uuid"
              />
            </template>
          </NSpin>
        </NSpace>
      </NSpin>
    </NCard>
  </div>
</template>

<style scoped lang="less">
.hypothesis-tag-contacts-page {
  padding: 1rem 1.25rem 2rem;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.page-header__icon {
  opacity: 0.85;
  flex-shrink: 0;
}

.page-lead {
  margin: 0 0 1rem;
  font-size: 13px;
  line-height: 1.55;
  color: var(--n-text-color-3);
  max-width: 46rem;
}

.toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1.25rem 2rem;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
  opacity: 0.75;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem 1.5rem;
}

.tag-line {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
