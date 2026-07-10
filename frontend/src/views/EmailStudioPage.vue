<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from "vue";
import { NAlert, NAvatar, NButton, NCard, NCheckbox, NCollapse, NCollapseItem, NDataTable, NDrawer, NDrawerContent, NEmpty, NFormItem, NInput, NInputNumber, NModal, NPagination, NSelect, NSpace, NSpin, NTabPane, NTabs, NTag, NText, useDialog, useMessage, type DataTableColumns } from "naive-ui";
import { useProjectStore } from "../stores/project";
import VelvetechLinkedInDraftsPanel from "../components/VelvetechLinkedInDraftsPanel.vue";
import { isVelvetechProjectId } from "../project-ids";

type Json = Record<string, any>;
interface EmailRow extends Json { id:string; contact_name:string; company_name:string; batch_name:string; persona:string; sequence_step:number; current_subject:string; status:string; open_comment_count:number; updated_at:string; sent_at:string|null }
interface Annotation { id:string; text:string; start:number; end:number; purpose:string; research_point_ids:string[]; instruction_ids:string[]; explanation:string; classification:"verified"|"product_truth"|"instruction"|"inference"; confidence:string; warnings:string[] }
interface PickerContact extends Json { uuid:string; name?:string; first_name?:string; last_name?:string; company_name?:string; position?:string; work_email?:string; avatar_url?:string }

const store = useProjectStore(); const toast = useMessage(); const dialog = useDialog();
const studioTab = ref<"email" | "linkedin">("email");
const isVelvetech = computed(() => isVelvetechProjectId(store.selectedProjectId));
const rows = ref<EmailRow[]>([]), total = ref(0), page = ref(1), pageSize = ref(25), loading = ref(false), error = ref("");
const search = ref(""), statusFilter = ref<string|null>(null), campaignFilter = ref(""), batchFilter = ref(""), personaFilter = ref(""), reviewerFilter = ref(""), modelFilter = ref(""), qualityFilter = ref<string|null>(null), dateFrom = ref(""), dateTo = ref(""), openOnly = ref(false), savedView = ref("all");
const detailOpen = ref(false), detailLoading = ref(false), detail = ref<Json|null>(null), selectedId = ref("");
const subject = ref(""), emailBody = ref(""), dirty = ref(false), selectedResearch = ref<string[]>([]), selectedText = ref({ quote:"", start:0, end:0 });
const commentDraft = ref(""), regenerationPrompt = ref(""), actionLoading = ref(""), candidate = ref<Json|null>(null), compareOpen = ref(false), createOpen = ref(false);
const replyDrafts = ref<Record<string,string>>({});
const pickerSearch = ref(""), pickerContacts = ref<PickerContact[]>([]), pickerTotal = ref(0), pickerPage = ref(1), pickerPageSize = ref(20), pickerLoading = ref(false), selectedPickerContact = ref<PickerContact|null>(null);
const emailOptions = ref({ campaignId:"", batchName:"", persona:"", sequenceStep:1 });
const bodyInput = ref<InstanceType<typeof NInput>|null>(null);

const humanize = (value:string) => value.replace(/_/g, " ");
const statusOptions = ["research_ready","ai_draft_made","needs_review","comments_made","regenerated","final_check","approved","sent","research_missing","generation_failed","changes_requested","rejected","sending_failed"].map((value) => ({ label:humanize(value), value }));
const savedViews = [{label:"All emails",value:"all"},{label:"Needs review",value:"needs_review"},{label:"Comments waiting",value:"comments_made"},{label:"Final checks",value:"final_check"},{label:"Approved, not sent",value:"approved"},{label:"Sent",value:"sent"},{label:"Failed or blocked",value:"failed"}];
const statusType = (s:string) => s === "sent" ? "success" : s === "approved" ? "info" : ["generation_failed","sending_failed","rejected"].includes(s) ? "error" : ["comments_made","changes_requested","final_check"].includes(s) ? "warning" : "default";
const currentVersion = computed(() => detail.value?.currentVersion ?? null); const comments = computed<Json[]>(() => detail.value?.comments ?? []); const openComments = computed(() => comments.value.filter((c) => c.status === "open"));
const annotations = computed<Annotation[]>(() => (currentVersion.value?.annotations ?? []).slice().sort((a:Annotation,b:Annotation) => a.start-b.start));
const researchPoints = computed<Json[]>(() => detail.value?.researchPoints ?? []);
const canApprove = computed(() => detail.value?.data?.status === "final_check" && openComments.value.length === 0);
const canStartEmail = computed(() => !!selectedPickerContact.value && !pickerLoading.value && !actionLoading.value);

function contactLabel(c: PickerContact): string {
  return (typeof c.name === "string" && c.name.trim())
    || [c.first_name, c.last_name].filter((x) => typeof x === "string" && x).join(" ")
    || "Unknown";
}

function fmt(v:string|null) { return v ? new Date(v).toLocaleString() : "—"; }
function qs() { const q = new URLSearchParams({ projectId:String(store.selectedProjectId), page:String(page.value), pageSize:String(pageSize.value) }); if(search.value.trim())q.set("search",search.value.trim()); const status = savedView.value !== "all" ? savedView.value : statusFilter.value; if(status)q.set("status",status); if(campaignFilter.value)q.set("campaign",campaignFilter.value); if(batchFilter.value)q.set("batch",batchFilter.value); if(personaFilter.value)q.set("persona",personaFilter.value); if(reviewerFilter.value)q.set("reviewer",reviewerFilter.value); if(modelFilter.value)q.set("model",modelFilter.value); if(qualityFilter.value)q.set("researchQuality",qualityFilter.value); if(dateFrom.value)q.set("dateFrom",dateFrom.value); if(dateTo.value)q.set("dateTo",dateTo.value); if(openOnly.value)q.set("hasOpenComments","true"); return q; }
async function load() { if(!store.selectedProjectId)return; loading.value=true; error.value=""; try { const r=await fetch(`/api/email-studio/emails?${qs()}`); const j=await r.json(); if(!r.ok)throw new Error(j.error); rows.value=j.data??[]; total.value=j.total??0; } catch(e){error.value=e instanceof Error?e.message:"Could not load emails"} finally{loading.value=false} }
let timer:number|undefined; watch([search,statusFilter,campaignFilter,batchFilter,personaFilter,reviewerFilter,modelFilter,qualityFilter,dateFrom,dateTo,openOnly,savedView],()=>{page.value=1; window.clearTimeout(timer); timer=window.setTimeout(load,250)}); watch(()=>store.selectedProjectId,load); watch([page,pageSize],load); onMounted(load);

function shouldIgnoreRowClick(event: MouseEvent): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest("a, button, input, textarea, select, [role='button']"));
}

const emailRowProps = (row: EmailRow) => ({
  class: "clickable-email-row",
  onClick: (event: MouseEvent) => {
    if (shouldIgnoreRowClick(event)) return;
    void openEmail(row.id);
  },
});

const columns:DataTableColumns<EmailRow> = [
  {title:"Contact",key:"contact_name",render:r=>h("div",[h("a",{class:"email-studio-link",href:"#",onClick:(e:MouseEvent)=>{e.preventDefault();void openEmail(r.id)}},r.contact_name||"Unknown"),h("div",{class:"muted"},r.recipient_email||"")])},
  {title:"Company",key:"company_name"},{title:"Batch",key:"batch_name"},{title:"Persona",key:"persona"},{title:"Step",key:"sequence_step",width:65},
  {title:"Subject",key:"current_subject",ellipsis:{tooltip:true}},{title:"Status",key:"status",render:r=>h(NTag,{size:"small",type:statusType(r.status) as any},{default:()=>humanize(r.status)})},
  {title:"Comments",key:"open_comment_count",width:90},{title:"Updated",key:"updated_at",render:r=>fmt(r.updated_at)},
  {title:"",key:"actions",width:90,render:r=>h(NButton,{size:"small",type:"primary",secondary:true,onClick:()=>openEmail(r.id)},{default:()=>"Review"})},
];

const pickerColumns: DataTableColumns<PickerContact> = [
  {
    key: "avatar",
    title: "",
    width: 44,
    render: (row) => h(NAvatar, { round: true, size: 32, src: (row.avatar_url as string) || undefined }, { default: () => contactLabel(row).charAt(0).toUpperCase() }),
  },
  {
    key: "name",
    title: "Contact",
    render: (row) => h("div", [h("strong", contactLabel(row)), h("div", { class: "muted" }, row.work_email || "No email")]),
  },
  { key: "company_name", title: "Company", ellipsis: { tooltip: true }, render: (row) => row.company_name || "—" },
  { key: "position", title: "Role", ellipsis: { tooltip: true }, render: (row) => row.position || "—" },
];

async function loadPickerContacts() {
  if (!store.selectedProjectId || !createOpen.value) return;
  pickerLoading.value = true;
  try {
    const q = new URLSearchParams({
      table: "contacts",
      filters: encodeURIComponent(JSON.stringify({ project_id: store.selectedProjectId })),
      limit: String(pickerPageSize.value),
      offset: String((pickerPage.value - 1) * pickerPageSize.value),
      sortBy: "first_name",
      sortDirection: "asc",
    });
    if (pickerSearch.value.trim()) q.set("search", pickerSearch.value.trim());
    const r = await fetch(`/api/supabase-table-query?${q}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Could not load contacts");
    pickerContacts.value = (j.data ?? []) as PickerContact[];
    pickerTotal.value = j.total ?? 0;
  } catch (e) {
    pickerContacts.value = [];
    pickerTotal.value = 0;
    toast.error(e instanceof Error ? e.message : "Could not load contacts");
  } finally {
    pickerLoading.value = false;
  }
}

function resetCreateForm() {
  pickerSearch.value = "";
  pickerContacts.value = [];
  pickerTotal.value = 0;
  pickerPage.value = 1;
  selectedPickerContact.value = null;
  emailOptions.value = { campaignId: "", batchName: "", persona: "", sequenceStep: 1 };
}

function openCreateModal() {
  resetCreateForm();
  createOpen.value = true;
  void loadPickerContacts();
}

function selectPickerContact(row: PickerContact) {
  selectedPickerContact.value = row;
}

const pickerRowProps = (row: PickerContact) => ({
  style: "cursor: pointer",
  onClick: () => selectPickerContact(row),
});

let pickerTimer: number | undefined;
watch([pickerSearch, pickerPage, pickerPageSize], () => {
  if (!createOpen.value) return;
  window.clearTimeout(pickerTimer);
  pickerTimer = window.setTimeout(() => { void loadPickerContacts(); }, 250);
});
watch(pickerSearch, () => { pickerPage.value = 1; });
watch(createOpen, (open) => { if (!open) resetCreateForm(); });

async function openEmail(id:string) { selectedId.value=id; detailOpen.value=true; detailLoading.value=true; candidate.value=null; try { const r=await fetch(`/api/email-studio/emails/${id}?projectId=${store.selectedProjectId}`); const j=await r.json(); if(!r.ok)throw new Error(j.error); detail.value=j; subject.value=j.currentVersion?.subject??""; emailBody.value=j.currentVersion?.body??""; selectedResearch.value=(j.researchPoints??[]).map((x:Json)=>x.id); dirty.value=false; if(j.data.status==="ai_draft_made") await setStatus("needs_review",false); } catch(e){toast.error(e instanceof Error?e.message:"Could not open email")} finally{detailLoading.value=false} }
async function refreshDetail(){if(selectedId.value)await openEmail(selectedId.value)}
async function request(path:string, options:RequestInit={}) { actionLoading.value=path; try { const r=await fetch(path,{...options,headers:{"Content-Type":"application/json",...(options.headers??{})}}); const j=await r.json(); if(!r.ok)throw new Error(j.error??"Action failed"); return j; } finally{actionLoading.value=""} }
async function setStatus(status:string, notify=true){try{await request(`/api/email-studio/emails/${selectedId.value}/status`,{method:"PATCH",body:JSON.stringify({projectId:store.selectedProjectId,status})});if(notify)toast.success(`Moved to ${humanize(status)}`);await refreshDetail();await load()}catch(e){if(notify)toast.error(e instanceof Error?e.message:"Status update failed")}}
async function saveEdits(){try{await request(`/api/email-studio/emails/${selectedId.value}/human-version`,{method:"POST",body:JSON.stringify({projectId:store.selectedProjectId,subject:subject.value,body:emailBody.value})});dirty.value=false;toast.success("New version saved");await refreshDetail();await load()}catch(e){toast.error(e instanceof Error?e.message:"Save failed")}}
function captureSelection(){const el=(bodyInput.value as any)?.textareaElRef as HTMLTextAreaElement|undefined;if(!el)return;const start=el.selectionStart,end=el.selectionEnd;selectedText.value={start,end,quote:emailBody.value.slice(start,end)};}
async function addComment(){if(!selectedText.value.quote||!commentDraft.value.trim())return;const {start,end,quote}=selectedText.value;try{await request(`/api/email-studio/emails/${selectedId.value}/comments`,{method:"POST",body:JSON.stringify({projectId:store.selectedProjectId,selectedQuote:quote,startOffset:start,endOffset:end,contextBefore:emailBody.value.slice(Math.max(0,start-30),start),contextAfter:emailBody.value.slice(end,end+30),body:commentDraft.value})});commentDraft.value="";toast.success("Comment added");await refreshDetail();await load()}catch(e){toast.error(e instanceof Error?e.message:"Comment failed")}}
async function toggleComment(c:Json){try{await request(`/api/email-studio/comments/${c.id}`,{method:"PATCH",body:JSON.stringify({projectId:store.selectedProjectId,status:c.status==="open"?"resolved":"open"})});await refreshDetail()}catch(e){toast.error(e instanceof Error?e.message:"Comment update failed")}}
async function reply(c:Json){const text=replyDrafts.value[c.id]?.trim();if(!text)return;try{await request(`/api/email-studio/comments/${c.id}/replies`,{method:"POST",body:JSON.stringify({projectId:store.selectedProjectId,body:text})});replyDrafts.value[c.id]="";await refreshDetail()}catch(e){toast.error(e instanceof Error?e.message:"Reply failed")}}
function paragraphSelection(){const start=emailBody.value.lastIndexOf("\n",Math.max(0,selectedText.value.start-1))+1;const next=emailBody.value.indexOf("\n",selectedText.value.end);const end=next<0?emailBody.value.length:next;return {start,end,quote:emailBody.value.slice(start,end)}}
async function generate(initial=false,scope="full"){try{const path=initial?"generate":"regenerate";const selection=scope==="selection"?selectedText.value:scope==="paragraph"?paragraphSelection():null;const j=await request(`/api/email-studio/emails/${selectedId.value}/${path}`,{method:"POST",body:JSON.stringify({projectId:store.selectedProjectId,prompt:regenerationPrompt.value||undefined,scope,selection,includedResearchPointIds:selectedResearch.value})});if(initial){toast.success("AI draft created");await refreshDetail()}else{candidate.value=j.version;compareOpen.value=true;toast.success("Regeneration candidate ready")}}catch(e){toast.error(e instanceof Error?e.message:"Generation failed")}}
async function adopt(){if(!candidate.value)return;try{await request(`/api/email-studio/emails/${selectedId.value}/versions/${candidate.value.id}/adopt`,{method:"POST",body:JSON.stringify({projectId:store.selectedProjectId})});compareOpen.value=false;candidate.value=null;toast.success("New version adopted");await refreshDetail();await load()}catch(e){toast.error(e instanceof Error?e.message:"Could not adopt version")}}
async function approve(){dialog.warning({title:"Approve this email?",content:"Approval locks the current version. Only Smartlead can mark it sent.",positiveText:"Approve",negativeText:"Cancel",onPositiveClick:async()=>{try{await request(`/api/email-studio/emails/${selectedId.value}/approve`,{method:"POST",body:JSON.stringify({projectId:store.selectedProjectId})});toast.success("Email approved");await refreshDetail();await load()}catch(e){toast.error(e instanceof Error?e.message:"Approval failed")}}})}

async function startEmailForContact() {
  const contact = selectedPickerContact.value;
  if (!contact?.uuid) return;
  try {
    const payload: Record<string, unknown> = {
      projectId: store.selectedProjectId,
      contactId: contact.uuid,
      contactName: contactLabel(contact),
      companyName: contact.company_name ?? "",
      recipientEmail: contact.work_email ?? "",
      campaignId: emailOptions.value.campaignId,
      batchName: emailOptions.value.batchName,
      persona: emailOptions.value.persona,
      sequenceStep: emailOptions.value.sequenceStep,
    };
    const r = await fetch("/api/email-studio/emails", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Could not start email");
    createOpen.value = false;
    resetCreateForm();
    await load();
    await openEmail(j.data.id);
    toast.success(`Email started for ${contactLabel(contact)}`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not start email");
  }
}

async function copy(){await navigator.clipboard.writeText(`${subject.value}\n\n${emailBody.value}`);toast.success("Copied")}
function annotationColor(a:Annotation){return a.warnings?.length?"#d03050":a.classification==="verified"?"#2080f0":a.classification==="product_truth"?"#18a058":a.classification==="instruction"?"#8a2be2":"#f0a020"}
const annotatedSegments=computed(()=>{const out:Json[]=[];let at=0;for(const a of annotations.value){if(a.start>at)out.push({text:emailBody.value.slice(at,a.start)});out.push({text:emailBody.value.slice(a.start,a.end),annotation:a});at=a.end}if(at<emailBody.value.length)out.push({text:emailBody.value.slice(at)});return out});
function previousRow(){const i=rows.value.findIndex(x=>x.id===selectedId.value);if(i>0)openEmail(rows.value[i-1].id)} function nextRow(){const i=rows.value.findIndex(x=>x.id===selectedId.value);if(i>=0&&i<rows.value.length-1)openEmail(rows.value[i+1].id)}
</script>

<template>
  <div class="studio">
    <NSpace justify="space-between" align="center">
      <div>
        <h1>Email Studio</h1>
        <NText depth="3">Email and LinkedIn draft review — draft, approve, and send outreach.</NText>
      </div>
      <NButton v-if="studioTab === 'email'" type="primary" @click="openCreateModal">Write email</NButton>
    </NSpace>

    <NTabs v-model:value="studioTab" type="line" animated style="margin-top: 16px">
      <NTabPane name="email" tab="Email">
        <NAlert type="info" :show-icon="false" style="margin:16px 0">Draft and approval workspace only. Email Studio never sends or schedules email; only verified Smartlead events mark records as sent.</NAlert>
        <NCard size="small"><div class="filters"><NSelect v-model:value="savedView" :options="savedViews"/><NInput v-model:value="search" clearable placeholder="Search contact, company, subject or email…"/><NSelect v-model:value="statusFilter" clearable :options="statusOptions" placeholder="Status"/><NInput v-model:value="campaignFilter" clearable placeholder="Campaign"/><NInput v-model:value="batchFilter" clearable placeholder="Batch"/><NInput v-model:value="personaFilter" clearable placeholder="Persona"/><NInput v-model:value="reviewerFilter" clearable placeholder="Reviewer"/><NInput v-model:value="modelFilter" clearable placeholder="Model"/><NSelect v-model:value="qualityFilter" clearable :options="['verified','partial','missing','unknown'].map(value=>({label:humanize(value),value}))" placeholder="Research quality"/><NInput v-model:value="dateFrom" placeholder="Updated from (YYYY-MM-DD)"/><NInput v-model:value="dateTo" placeholder="Updated to (YYYY-MM-DD)"/><NCheckbox v-model:checked="openOnly">Open comments</NCheckbox></div></NCard>
        <NAlert v-if="error" type="error" style="margin-top:12px">{{error}}</NAlert><NDataTable :columns="columns" :data="rows" :loading="loading" :row-key="r=>r.id" :row-props="emailRowProps" style="margin-top:12px"/><NPagination v-model:page="page" v-model:page-size="pageSize" :item-count="total" show-size-picker :page-sizes="[25,50,100]" style="margin-top:12px"/>
      </NTabPane>

      <NTabPane name="linkedin" tab="LinkedIn">
        <NAlert v-if="isVelvetech" type="info" :show-icon="false" style="margin:16px 0">
          Review Velvetech LinkedIn reply drafts from n8n. Edit when flagged <strong>needs_human</strong>, then approve to send via GetSales.
        </NAlert>
        <VelvetechLinkedInDraftsPanel v-if="isVelvetech" :project-id="store.selectedProjectId" />
        <NEmpty v-else description="LinkedIn draft review is available for the Velvetech project only." />
      </NTabPane>
    </NTabs>

    <NDrawer v-model:show="detailOpen" width="96vw"><NDrawerContent :title="`${detail?.data?.contact_name||'Email'} · step ${detail?.data?.sequence_step||''}`" closable><NSpin :show="detailLoading"><template v-if="detail">
      <NSpace justify="space-between" align="center"><NSpace><NButton size="small" @click="previousRow">Previous</NButton><NButton size="small" @click="nextRow">Next</NButton><NTag :type="statusType(detail.data.status) as any">{{humanize(detail.data.status)}}</NTag><NText depth="3">{{detail.data.company_name}} · {{detail.data.batch_name}} · {{detail.data.persona}}</NText></NSpace><NSpace><NButton @click="copy">Copy</NButton><NButton v-if="['needs_review','regenerated'].includes(detail.data.status)" type="warning" secondary @click="setStatus('final_check')">Ready for final check</NButton><NButton v-if="canApprove" type="success" @click="approve">Approve</NButton><NButton type="error" secondary @click="setStatus('rejected')">Reject</NButton></NSpace></NSpace>
      <div class="workspace">
        <section class="panel research"><h3>Research & instructions</h3><template v-if="researchPoints.length"><div v-for="p in researchPoints" :key="p.id" class="research-point"><NCheckbox :checked="selectedResearch.includes(p.id)" @update:checked="v=>selectedResearch=v?[...selectedResearch,p.id]:selectedResearch.filter(x=>x!==p.id)">{{p.statement}}</NCheckbox><NTag size="tiny" :type="p.kind==='verified'?'info':'warning'">{{p.kind}}</NTag></div></template><NEmpty v-else description="No structured research attached"/><h4>Active instructions</h4><div v-for="i in detail.instructions" :key="i.id" class="instruction"><NTag size="small" type="info">{{i.kind}}</NTag> {{i.title}} v{{i.version}}</div><details v-if="detail.research"><summary>Citations and raw research</summary><pre>{{JSON.stringify(detail.research,null,2)}}</pre></details></section>
        <section class="panel editor"><h3>Email</h3><template v-if="currentVersion"><NFormItem label="Subject"><NInput v-model:value="subject" @update:value="dirty=true"/></NFormItem><NFormItem label="Body"><NInput ref="bodyInput" v-model:value="emailBody" type="textarea" :autosize="{minRows:12,maxRows:24}" @select="captureSelection" @mouseup="captureSelection" @keyup="captureSelection" @update:value="dirty=true"/></NFormItem><NSpace><NButton type="primary" :disabled="!dirty" @click="saveEdits">Save as new version</NButton><NButton @click="generate(false,'full')">Regenerate all</NButton><NButton :disabled="!selectedText.quote" @click="generate(false,'paragraph')">Regenerate paragraph</NButton><NButton :disabled="!selectedText.quote" @click="generate(false,'selection')">Regenerate selection</NButton></NSpace><NInput v-model:value="regenerationPrompt" type="textarea" placeholder="Optional regeneration direction…" :autosize="{minRows:2,maxRows:4}" style="margin-top:10px"/><h4>Annotated preview</h4><div class="annotated"><template v-for="(s,i) in annotatedSegments" :key="i"><span v-if="s.annotation" class="annotated-span" :style="{borderBottomColor:annotationColor(s.annotation),backgroundColor:annotationColor(s.annotation)+'22'}" :title="`${s.annotation.purpose}\n${s.annotation.explanation}\nResearch: ${s.annotation.research_point_ids.join(', ')||'none'}\nRules: ${s.annotation.instruction_ids.join(', ')||'none'}\nConfidence: ${s.annotation.confidence}`">{{s.text}}</span><span v-else>{{s.text}}</span></template></div><div v-if="currentVersion.validation_results?.length"><NAlert v-for="v in currentVersion.validation_results" :key="v.code+v.message" :type="v.severity==='error'?'error':'warning'" :show-icon="false" style="margin-top:6px">{{v.message}}</NAlert></div></template><template v-else><NEmpty description="No draft yet"/><NButton type="primary" style="margin-top:12px" @click="generate(true)">Research and create AI draft</NButton></template></section>
        <section class="panel comments"><h3>Comments</h3><NAlert v-if="selectedText.quote" type="info" :show-icon="false"><strong>Selected:</strong> “{{selectedText.quote}}”</NAlert><NInput v-model:value="commentDraft" type="textarea" placeholder="Comment on the selected text…" :disabled="!selectedText.quote" style="margin-top:8px"/><NButton type="primary" secondary :disabled="!selectedText.quote||!commentDraft.trim()" style="margin-top:8px" @click="addComment">Add comment</NButton><div v-for="c in comments" :key="c.id" class="comment" :class="{resolved:c.status==='resolved'}"><NTag size="tiny" :type="c.status==='open'?'warning':'success'">{{c.status}}</NTag><blockquote>“{{c.selected_quote}}”</blockquote><p>{{c.body}}</p><NText v-if="c.mapped_version_id&&c.mapped_start_offset==null" type="error">Not mapped to current version</NText><div v-for="r in c.outreach_email_comment_replies" :key="r.id" class="reply">{{r.body}}</div><NInput v-model:value="replyDrafts[c.id]" size="small" placeholder="Reply…" style="margin:7px 0"/><NSpace><NButton text type="primary" size="tiny" @click="reply(c)">Reply</NButton><NButton text type="primary" size="tiny" @click="toggleComment(c)">{{c.status==='open'?'Resolve':'Reopen'}}</NButton></NSpace></div><NEmpty v-if="!comments.length" description="No comments"/><h4>Versions</h4><div v-for="v in detail.versions" :key="v.id" class="version"><NTag size="tiny" :type="v.state==='current'?'success':'default'">v{{v.version_number}} · {{v.state}}</NTag> {{v.author_type}} · {{fmt(v.created_at)}}</div></section>
      </div></template></NSpin></NDrawerContent></NDrawer>

    <NModal v-model:show="compareOpen" preset="card" title="Review regenerated candidate" style="width:min(1200px,95vw)"><div class="compare"><div><h3>Current version</h3><strong>{{currentVersion?.subject}}</strong><pre>{{currentVersion?.body}}</pre></div><div><h3>Candidate v{{candidate?.version_number}}</h3><strong>{{candidate?.subject}}</strong><pre>{{candidate?.body}}</pre></div></div><template #footer><NSpace justify="end"><NButton @click="compareOpen=false">Keep current</NButton><NButton type="primary" @click="adopt">Adopt candidate</NButton></NSpace></template></NModal>

    <NModal v-model:show="createOpen" preset="card" title="Write email for contact" style="width:min(860px,96vw)">
      <NText depth="3">Pick someone from your project contacts. You’ll land straight in the email workspace to research and draft.</NText>
      <NInput v-model:value="pickerSearch" clearable placeholder="Search name, company, role, or email…" style="margin:14px 0 10px" />
      <NDataTable
        :columns="pickerColumns"
        :data="pickerContacts"
        :loading="pickerLoading"
        :row-key="(row) => row.uuid"
        :row-props="pickerRowProps"
        :row-class-name="(row) => (selectedPickerContact?.uuid === row.uuid ? 'picker-row-selected' : '')"
        size="small"
        :max-height="360"
        :scroll-x="720"
      />
      <NPagination
        v-model:page="pickerPage"
        v-model:page-size="pickerPageSize"
        :item-count="pickerTotal"
        :page-sizes="[20, 50, 100]"
        show-size-picker
        size="small"
        style="margin-top:10px"
      />
      <NAlert v-if="selectedPickerContact" type="success" :show-icon="false" style="margin-top:12px">
        Selected: <strong>{{ contactLabel(selectedPickerContact) }}</strong>
        <span v-if="selectedPickerContact.company_name"> · {{ selectedPickerContact.company_name }}</span>
        <span v-if="selectedPickerContact.work_email"> · {{ selectedPickerContact.work_email }}</span>
      </NAlert>
      <NCollapse style="margin-top:12px">
        <NCollapseItem title="Optional email settings" name="options">
          <div class="create-grid">
            <NFormItem label="Campaign ID"><NInput v-model:value="emailOptions.campaignId" /></NFormItem>
            <NFormItem label="Batch"><NInput v-model:value="emailOptions.batchName" /></NFormItem>
            <NFormItem label="Persona"><NInput v-model:value="emailOptions.persona" /></NFormItem>
            <NFormItem label="Sequence step"><NInputNumber v-model:value="emailOptions.sequenceStep" :min="1" /></NFormItem>
          </div>
        </NCollapseItem>
      </NCollapse>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="createOpen=false">Cancel</NButton>
          <NButton type="primary" :disabled="!canStartEmail" :loading="!!actionLoading" @click="startEmailForContact">Start email</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>.email-studio-link{color:#2080f0;text-decoration:none;font-weight:600}.email-studio-link:hover{text-decoration:underline}:deep(.clickable-email-row){cursor:pointer}:deep(.clickable-email-row:hover td){background:rgba(32,128,240,.06)}.studio{max-width:1760px;margin:auto}.studio h1{margin:0}.filters{display:grid;grid-template-columns:180px minmax(260px,1fr) 170px 150px 140px auto;gap:10px;align-items:center}.workspace{display:grid;grid-template-columns:minmax(260px,1fr) minmax(430px,1.7fr) minmax(270px,1fr);gap:12px;margin-top:14px;height:calc(100vh - 180px)}.panel{border:1px solid rgba(128,128,128,.25);border-radius:10px;padding:14px;overflow:auto}.panel h3{margin-top:0}.research-point{padding:9px 0;border-bottom:1px solid rgba(128,128,128,.16)}.instruction{margin:7px 0}.annotated{white-space:pre-wrap;line-height:1.75;padding:14px;background:rgba(128,128,128,.08);border-radius:8px}.annotated-span{border-bottom:3px solid;cursor:help}.comment{border:1px solid rgba(128,128,128,.25);border-radius:8px;padding:10px;margin:10px 0}.comment.resolved{opacity:.6}.comment blockquote{margin:7px 0;padding-left:8px;border-left:3px solid #f0a020}.reply{margin:5px 0 5px 12px;padding:6px;background:rgba(128,128,128,.1);border-radius:5px}.version{margin:7px 0}.compare{display:grid;grid-template-columns:1fr 1fr;gap:16px}.compare>div{border:1px solid rgba(128,128,128,.25);padding:14px;border-radius:8px}.compare pre,details pre{white-space:pre-wrap;word-break:break-word}.create-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.muted{opacity:.55;font-size:.8em}:deep(.picker-row-selected td){background:rgba(32,128,240,.12)!important}@media(max-width:1100px){.workspace{grid-template-columns:1fr;height:auto}.filters{grid-template-columns:1fr 1fr}.compare{grid-template-columns:1fr}}@media(max-width:680px){.filters,.create-grid{grid-template-columns:1fr}}</style>
