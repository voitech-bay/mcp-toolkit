<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { Handle, Position } from "@vue-flow/core";
import type { NodeProps } from "@vue-flow/core";
import { NButton, NCheckbox, NDropdown, NSpin, NTag } from "naive-ui";
import type { DropdownOption } from "naive-ui";
import { MoreHorizontalIcon } from "lucide-vue-next";
import {
  CONTEXT_BUILDER_KEY,
  type ContactNodeData,
} from "../../composables/useContextBuilder";

const props = defineProps<NodeProps<ContactNodeData>>();
const ctx = inject(CONTEXT_BUILDER_KEY)!;

const displayName = [props.data.firstName, props.data.lastName]
  .filter(Boolean)
  .join(" ") || "—";

const checked = computed({
  get: () => ctx.isSelected(props.id),
  set: (v: boolean) => ctx.setSelected(props.id, v),
});

const hasCtx = computed(() => ctx.hasContactContext(props.data.entityId));

const loadingConversations = ref(false);

async function addConversations() {
  const entityId = props.data.entityId;
  if (!entityId) return;
  loadingConversations.value = true;
  try {
    const groups = await ctx.fetchConversationsForContact(entityId);
    for (const group of groups) {
      ctx.addConversation(group, props.id);
    }
  } finally {
    loadingConversations.value = false;
  }
}

const dropdownOptions: DropdownOption[] = [
  { key: "add-conversations", label: "Add conversations" },
  { key: "divider", type: "divider" },
  { key: "remove", label: "Remove" },
];

function onSelect(key: string | number) {
  if (key === "add-conversations") void addConversations();
  else if (key === "remove") ctx.removeNode(props.id);
}
</script>

<template>
  <!-- Receives from company or center; source for conversation children -->
  <Handle type="target" :position="Position.Bottom" id="tgt" />
  <Handle type="source" :position="Position.Top" id="src" />

  <div class="ct-node nopan" :class="{ 'ct-node--has-ctx': hasCtx }">
    <div class="ct-node__header">
      <div class="ct-node__left">
        <NCheckbox v-model:checked="checked" size="small" />
        <span class="ct-node__badge">Contact</span>
        <NTag v-if="hasCtx" size="tiny" type="success" :bordered="false">CTX</NTag>
        <NSpin v-if="loadingConversations" size="small" />
      </div>
      <NDropdown
        trigger="click"
        :options="dropdownOptions"
        @select="onSelect"
        placement="bottom-end"
      >
        <NButton quaternary size="tiny" class="ct-node__menu">
          <MoreHorizontalIcon :size="14" />
        </NButton>
      </NDropdown>
    </div>
    <div class="ct-node__name">{{ displayName }}</div>
    <div v-if="data.position" class="ct-node__position">{{ data.position }}</div>
  </div>
</template>

<style scoped>
.ct-node {
  min-width: 190px;
  max-width: 240px;
  background: rgba(16, 20, 28, 0.96);
  border: 1.5px solid rgba(96, 165, 250, 0.28);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 0 12px rgba(96, 165, 250, 0.06), 0 3px 10px rgba(0, 0, 0, 0.45);
  cursor: default;
  user-select: none;
}

.ct-node--has-ctx {
  border-color: rgba(34, 197, 94, 0.45);
  box-shadow: 0 0 14px rgba(34, 197, 94, 0.08), 0 3px 10px rgba(0, 0, 0, 0.45);
}

.ct-node__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
}

.ct-node__left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ct-node__badge {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(96, 165, 250, 0.6);
}

.ct-node__menu {
  opacity: 0;
  transition: opacity 0.15s;
}

.ct-node:hover .ct-node__menu {
  opacity: 1;
}

.ct-node__name {
  font-size: 0.87rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ct-node__position {
  font-size: 0.74rem;
  color: rgba(96, 165, 250, 0.5);
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
