<script setup lang="ts">
import { computed, h, ref } from "vue";
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NInput,
  NSpace,
  NTag,
  NText,
  useMessage,
} from "naive-ui";
import type { DataTableColumns } from "naive-ui";
import { RocketIcon, UploadIcon } from "lucide-vue-next";

type PreviewRow = {
  rowNumber: number;
  first_name: string;
  last_name: string;
  title: string;
  company_name: string;
  company_domain: string;
  email: string;
  linkedin_url: string;
  errors: string[];
};

type PreviewResponse = {
  rows: PreviewRow[];
  rowCount: number;
  validCount: number;
  errorCount: number;
  requiredColumns: string[];
  error?: string;
};

const message = useMessage();
const fileName = ref("");
const csvText = ref("");
const preview = ref<PreviewResponse | null>(null);
const loadingPreview = ref(false);
const launching = ref(false);
const launchId = ref("");
const launchError = ref("");

const sampleCsv = `first_name,last_name,title,company_name,company_domain,email,linkedin_url
Maria,Chen,CFO,Example Manufacturing,example.com,maria.chen@example.com,https://www.linkedin.com/in/mariachen`;

const canPreview = computed(() => csvText.value.trim().length > 0);
const canLaunch = computed(() => Boolean(preview.value && preview.value.validCount > 0 && preview.value.errorCount === 0 && !launching.value));

const columns: DataTableColumns<PreviewRow> = [
  { title: "Row", key: "rowNumber", width: 64 },
  {
    title: "Person",
    key: "person",
    render: (row) => h("span", {}, [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email || row.linkedin_url || "—"),
  },
  { title: "Title", key: "title", ellipsis: { tooltip: true } },
  { title: "Company", key: "company_name", ellipsis: { tooltip: true } },
  { title: "Domain", key: "company_domain", ellipsis: { tooltip: true } },
  {
    title: "Status",
    key: "errors",
    render: (row) =>
      row.errors.length === 0
        ? h(NTag, { type: "success", size: "small" }, { default: () => "Ready" })
        : h(NTag, { type: "error", size: "small" }, { default: () => row.errors.join("; ") }),
  },
];

async function readFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  fileName.value = file.name;
  csvText.value = await file.text();
  preview.value = null;
  launchId.value = "";
  launchError.value = "";
  await previewCsv();
}

async function previewCsv() {
  if (!canPreview.value) return;
  loadingPreview.value = true;
  launchId.value = "";
  launchError.value = "";
  try {
    const r = await fetch("/api/velvetech/research-csv/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvText: csvText.value }),
    });
    const j = (await r.json()) as PreviewResponse;
    preview.value = j;
    if (!r.ok) launchError.value = j.error ?? "Preview failed";
  } catch {
    launchError.value = "Preview failed";
  } finally {
    loadingPreview.value = false;
  }
}

async function launchResearch() {
  if (!canLaunch.value) return;
  launching.value = true;
  launchError.value = "";
  launchId.value = "";
  try {
    const r = await fetch("/api/velvetech/research-csv/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvText: csvText.value, filename: fileName.value || "pasted.csv" }),
    });
    const j = (await r.json()) as { launchId?: string; requestedCount?: number; error?: string } & PreviewResponse;
    if (!r.ok) {
      preview.value = j.rows ? j : preview.value;
      launchError.value = j.error ?? "Launch failed";
      return;
    }
    launchId.value = j.launchId ?? "";
    message.success(`Research launched for ${j.requestedCount ?? preview.value?.validCount ?? 0} contacts`);
  } catch {
    launchError.value = "Launch failed";
  } finally {
    launching.value = false;
  }
}

function useSample() {
  fileName.value = "sample.csv";
  csvText.value = sampleCsv;
  preview.value = null;
  launchId.value = "";
  launchError.value = "";
}
</script>

<template>
  <NSpace vertical size="large" class="page">
    <NCard>
      <NSpace vertical size="medium">
        <div class="top-row">
          <div>
            <h1>Velvetech research launch</h1>
            <NText depth="3">Upload a CSV, preview the rows, then start the n8n research workflow.</NText>
          </div>
          <label class="file-button">
            <UploadIcon :size="16" />
            <span>{{ fileName || "Choose CSV" }}</span>
            <input type="file" accept=".csv,text/csv" @change="readFile" />
          </label>
        </div>

        <NAlert type="info" :show-icon="false">
          CSV columns: first_name, last_name, title, company_name, company_domain, email, linkedin_url.
          company_domain can be replaced by a work email domain.
        </NAlert>

        <NInput
          v-model:value="csvText"
          type="textarea"
          :autosize="{ minRows: 6, maxRows: 12 }"
          placeholder="Paste CSV here, or choose a file"
        />

        <NSpace justify="space-between" align="center">
          <NButton quaternary @click="useSample">Insert sample</NButton>
          <NSpace>
            <NButton :disabled="!canPreview" :loading="loadingPreview" @click="previewCsv">Preview</NButton>
            <NButton type="primary" :disabled="!canLaunch" :loading="launching" @click="launchResearch">
              <template #icon><RocketIcon :size="16" /></template>
              Launch research
            </NButton>
          </NSpace>
        </NSpace>
      </NSpace>
    </NCard>

    <NAlert v-if="launchError" type="error" :show-icon="false">{{ launchError }}</NAlert>
    <NAlert v-if="launchId" type="success" :show-icon="false">
      Research launched. Launch id: {{ launchId }}
    </NAlert>

    <NCard v-if="preview">
      <NSpace vertical size="medium">
        <NSpace align="center">
          <NTag type="info">{{ preview.rowCount }} rows</NTag>
          <NTag type="success">{{ preview.validCount }} ready</NTag>
          <NTag v-if="preview.errorCount" type="error">{{ preview.errorCount }} need fixes</NTag>
        </NSpace>
        <NDataTable
          :columns="columns"
          :data="preview.rows"
          :pagination="{ pageSize: 25 }"
          :bordered="false"
          size="small"
        />
      </NSpace>
    </NCard>
  </NSpace>
</template>

<style scoped lang="less">
.page {
  padding: 1rem 0 2rem;
}

.top-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

h1 {
  margin: 0 0 0.25rem;
  font-size: 22px;
  line-height: 1.2;
}

.file-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.file-button input {
  display: none;
}

@media (max-width: 720px) {
  .top-row {
    flex-direction: column;
  }
}
</style>
