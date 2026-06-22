<script setup lang="ts">
import { computed } from "vue";
import { NCard, NSpace, NTag, NCheckbox, NButton, NText } from "naive-ui";

export interface LeadItem {
  result_id: string;
  contact_id: string | null;
  company_id: string | null;
  lead_uuid: string;
  workflow: string;
  created_at: string;
  contact_eligibility: string;
  ad_spend_potential: string;
  company_type_tag: string;
  ai_self_sufficiency_risk: string;
  role: string;
  channel_affinity: string;
  paid_media_responsibility: string;
  company_name: string;
  name: string;
  position: string;
  linkedin_url: string | null;
  dq_reason: string;
  wrong_person_reason: string;
  proof: string;
  pov: string;
  view: "best_fit" | "review" | "disqualified";
  decision_status: string;
  decision_reason: string | null;
}

const props = defineProps<{ lead: LeadItem; selected: boolean }>();
const emit = defineEmits<{
  (e: "toggle-select", resultId: string, checked: boolean): void;
  (e: "decide", resultId: string, status: "approved" | "refused" | "pending"): void;
}>();

const decisionType = computed<"success" | "error" | "default">(() => {
  if (props.lead.decision_status === "approved") return "success";
  if (props.lead.decision_status === "refused") return "error";
  return "default";
});

const fields = computed(() =>
  [
    { label: "Eligibility", value: props.lead.contact_eligibility },
    { label: "Ad spend", value: props.lead.ad_spend_potential },
    { label: "Company type", value: props.lead.company_type_tag },
    { label: "AI self-suff. risk", value: props.lead.ai_self_sufficiency_risk },
    { label: "Role", value: props.lead.role },
    { label: "Channels", value: props.lead.channel_affinity },
    { label: "Paid media", value: props.lead.paid_media_responsibility },
  ].filter((f) => f.value)
);

const disqualReason = computed(
  () => props.lead.dq_reason || props.lead.wrong_person_reason || ""
);

function decisionStatusLabel(status: string): string {
  if (status === "approved") return "Approved";
  if (status === "refused") return "Refused";
  return "Pending";
}
</script>

<template>
  <NCard size="small" :bordered="true" class="lead-card">
    <template #header>
      <NSpace align="center" :wrap="false" :size="8">
        <NCheckbox
          :checked="selected"
          @update:checked="(c: boolean) => emit('toggle-select', lead.result_id, c)"
        />
        <div class="lead-title">
          <div class="lead-name">{{ lead.name || "(no name)" }}</div>
          <NText depth="3" class="lead-sub">{{ lead.position }}<template v-if="lead.company_name"> @ {{ lead.company_name }}</template></NText>
        </div>
      </NSpace>
    </template>
    <template #header-extra>
      <NTag
        size="small"
        :type="decisionType !== 'default' ? decisionType : undefined"
      >
        {{ decisionStatusLabel(lead.decision_status) }}
      </NTag>
    </template>

    <NSpace vertical :size="8">
      <div class="lead-fields">
        <div v-for="f in fields" :key="f.label" class="lead-field">
          <span class="lead-field-label">{{ f.label }}</span>
          <span class="lead-field-value">{{ f.value }}</span>
        </div>
      </div>

      <NText v-if="lead.proof" depth="3" class="lead-proof">{{ lead.proof }}</NText>
      <NText v-if="lead.pov" depth="2" class="lead-pov">{{ lead.pov }}</NText>

      <NTag v-if="disqualReason" size="small" type="warning" :bordered="false">
        {{ disqualReason }}
      </NTag>

      <NSpace :size="8" align="center">
        <a v-if="lead.linkedin_url" :href="lead.linkedin_url" target="_blank" rel="noopener">LinkedIn</a>
        <NButton
          size="tiny"
          type="success"
          :secondary="lead.decision_status !== 'approved'"
          @click="emit('decide', lead.result_id, 'approved')"
        >
          Approve
        </NButton>
        <NButton
          size="tiny"
          type="error"
          :secondary="lead.decision_status !== 'refused'"
          @click="emit('decide', lead.result_id, 'refused')"
        >
          Refuse
        </NButton>
        <NButton
          v-if="lead.decision_status !== 'pending'"
          size="tiny"
          quaternary
          @click="emit('decide', lead.result_id, 'pending')"
        >
          Reset
        </NButton>
      </NSpace>
    </NSpace>
  </NCard>
</template>

<style scoped>
.lead-card {
  height: 100%;
}
.lead-title {
  min-width: 0;
}
.lead-name {
  font-weight: 600;
  font-size: 0.9rem;
}
.lead-sub {
  font-size: 0.8rem;
}
.lead-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 12px;
}
.lead-field {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.78rem;
}
.lead-field-label {
  opacity: 0.6;
}
.lead-field-value {
  font-weight: 500;
  text-align: right;
}
.lead-proof {
  font-size: 0.78rem;
  font-style: italic;
}
.lead-pov {
  font-size: 0.82rem;
  white-space: pre-wrap;
}
</style>
