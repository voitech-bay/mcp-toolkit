<script setup lang="ts">
import { computed, inject } from "vue";
import { Handle, Position } from "@vue-flow/core";
import type { NodeProps } from "@vue-flow/core";
import { NButton, NCheckbox, NDropdown } from "naive-ui";
import type { DropdownOption } from "naive-ui";
import { MoreHorizontalIcon } from "lucide-vue-next";
import {
  CONTEXT_BUILDER_KEY,
  type ConversationNodeData,
} from "../../composables/useContextBuilder";

const props = defineProps<NodeProps<ConversationNodeData>>();
const ctx = inject(CONTEXT_BUILDER_KEY)!;

const checked = computed({
  get: () => ctx.isSelected(props.id),
  set: (v: boolean) => ctx.setSelected(props.id, v),
});

const snippet = computed(() => {
  console.log(props.data)
  const text = props.data.latestMessageText;
  if (!text) return null;
  return text.length > 120 ? text.slice(0, 120) + "…" : text;
});

const dateLabel = computed(() => {
  const d = props.data.latestMessageDate;
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return null;
  }
});

const dropdownOptions: DropdownOption[] = [
  { key: "remove", label: "Remove" },
];

function onSelect(key: string | number) {
  if (key === "remove") ctx.removeNode(props.id);
}
</script>

<template>
  <!-- Leaf node: only a target handle, no source -->
  <Handle type="target" :position="Position.Bottom" id="tgt" />

  <div class="conv-node nopan">
    <div class="conv-node__header">
      <div class="conv-node__left">
        <NCheckbox v-model:checked="checked" size="small" />
        <span class="conv-node__badge">Conversation</span>
      </div>
      <NDropdown
        trigger="click"
        :options="dropdownOptions"
        @select="onSelect"
        placement="bottom-end"
      >
        <NButton quaternary size="tiny" class="conv-node__menu">
          <MoreHorizontalIcon :size="14" />
        </NButton>
      </NDropdown>
    </div>

    <div class="conv-node__text-label">Latest message</div>
    <div v-if="snippet" class="conv-node__snippet">{{ snippet }}</div>
    <div v-else class="conv-node__snippet conv-node__snippet--empty">No message text</div>

    <div class="conv-node__meta">
      <span class="conv-node__count">{{ data.messageCount }} msg{{ data.messageCount !== 1 ? "s" : "" }}</span>
      <span v-if="dateLabel" class="conv-node__date">{{ dateLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.conv-node {
  min-width: 200px;
  max-width: 260px;
  background: rgba(16, 14, 28, 0.96);
  border: 1.5px solid rgba(167, 139, 250, 0.28);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 0 12px rgba(167, 139, 250, 0.07), 0 3px 10px rgba(0, 0, 0, 0.45);
  cursor: default;
  user-select: none;
}

.conv-node__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
}

.conv-node__left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.conv-node__badge {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(167, 139, 250, 0.65);
}

.conv-node__menu {
  opacity: 0;
  transition: opacity 0.15s;
}

.conv-node:hover .conv-node__menu {
  opacity: 1;
}

.conv-node__text-label {
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(167, 139, 250, 0.4);
  margin-bottom: 3px;
}

.conv-node__snippet {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.82);
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  margin-bottom: 6px;
}

.conv-node__snippet--empty {
  color: rgba(167, 139, 250, 0.35);
  font-style: italic;
}

.conv-node__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.conv-node__count {
  font-size: 0.72rem;
  font-weight: 600;
  color: rgba(167, 139, 250, 0.55);
}

.conv-node__date {
  font-size: 0.7rem;
  color: rgba(167, 139, 250, 0.4);
}
</style>
