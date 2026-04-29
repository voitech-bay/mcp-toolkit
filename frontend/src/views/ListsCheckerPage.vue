<script setup lang="ts">
import { ref, computed } from "vue";
import { NCard, NInput, NButton, NAlert, NTag, useMessage } from "naive-ui";
import { useProjectStore } from "../stores/project";

type ListSyncCheckResult = {
  projectId: string;
  listUuid: string;
  dbCount: number;
  getsalesCount: number;
  getsalesFetchedUuids: number;
  missingCount: number;
  missingUuids: string[];
  countsMatch: boolean;
};

const message = useMessage();
const projectStore = useProjectStore();
const selectedProjectId = computed(() => projectStore.selectedProjectId);

const listSyncListUuid = ref("");
const listSyncLoading = ref(false);
const listSyncResyncLoading = ref(false);
const listSyncError = ref("");
const listSyncResult = ref<ListSyncCheckResult | null>(null);

async function runListSyncCheck() {
  if (!selectedProjectId.value) return;
  const listUuid = listSyncListUuid.value.trim();
  if (!listUuid) {
    listSyncError.value = "Enter list UUID.";
    listSyncResult.value = null;
    return;
  }
  listSyncLoading.value = true;
  listSyncError.value = "";
  listSyncResult.value = null;
  try {
    const q = new URLSearchParams({
      projectId: selectedProjectId.value,
      listUuid,
    });
    const r = await fetch(`/api/contacts/list-sync-check?${q.toString()}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "List sync check failed");
    listSyncResult.value = data as ListSyncCheckResult;
  } catch (e) {
    listSyncError.value = e instanceof Error ? e.message : "List sync check failed";
  } finally {
    listSyncLoading.value = false;
  }
}

async function resyncMissingListContacts() {
  if (!selectedProjectId.value) return;
  const listUuid = listSyncListUuid.value.trim();
  if (!listUuid) return;
  listSyncResyncLoading.value = true;
  listSyncError.value = "";
  try {
    const r = await fetch("/api/contacts/list-sync-resync-missing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: selectedProjectId.value,
        listUuid,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "List contacts re-sync failed");
    const upserted = Number(data.upserted ?? 0);
    const errCount = Array.isArray(data.errors) ? data.errors.length : 0;
    if (errCount > 0) {
      message.warning(`Re-sync partial: ${upserted} upserted, ${errCount} error(s).`);
    } else {
      message.success(`Re-sync complete: ${upserted} contact(s) upserted.`);
    }
    await runListSyncCheck();
  } catch (e) {
    listSyncError.value = e instanceof Error ? e.message : "List contacts re-sync failed";
  } finally {
    listSyncResyncLoading.value = false;
  }
}
</script>

<template>
  <NCard>
    <template #header>
      <span>Lists checker</span>
    </template>
    <div class="row">
      <span class="label">List UUID</span>
      <NInput
        v-model:value="listSyncListUuid"
        placeholder="Enter GetSales list_uuid"
        clearable
        :disabled="listSyncLoading || listSyncResyncLoading"
        style="max-width: 420px"
      />
      <NButton
        type="primary"
        :loading="listSyncLoading"
        :disabled="!selectedProjectId || !listSyncListUuid.trim() || listSyncResyncLoading"
        @click="runListSyncCheck"
      >
        Check
      </NButton>
      <NButton
        secondary
        type="warning"
        :loading="listSyncResyncLoading"
        :disabled="!listSyncResult || listSyncResult.missingCount === 0 || listSyncLoading"
        @click="resyncMissingListContacts"
      >
        Re-sync missing contacts
      </NButton>
    </div>
    <NAlert v-if="!selectedProjectId" type="info" style="margin-top: 0.75rem">
      Select project first.
    </NAlert>
    <NAlert v-if="listSyncError" type="error" style="margin-top: 0.75rem">
      {{ listSyncError }}
    </NAlert>
    <div v-if="listSyncResult" style="margin-top: 0.75rem">
      <div class="chips">
        <NTag size="small" type="info">DB: {{ listSyncResult.dbCount }}</NTag>
        <NTag size="small" type="info">GetSales total: {{ listSyncResult.getsalesCount }}</NTag>
        <NTag size="small" type="warning">Missing: {{ listSyncResult.missingCount }}</NTag>
      </div>
      <p v-if="!listSyncResult.countsMatch" class="hint">
        Count mismatch found. Use re-sync to import missing contacts for this list.
      </p>
      <p v-else class="hint">Counts match.</p>
    </div>
  </NCard>
</template>

<style scoped>
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.label {
  min-width: 80px;
  font-size: 0.875rem;
  opacity: 0.8;
}
.chips {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.hint {
  margin: 0.45rem 0 0;
  opacity: 0.7;
  font-size: 0.85rem;
}
</style>
