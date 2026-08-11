<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { NAlert, NAvatar, NButton, NCard, NCheckbox, NCollapse, NCollapseItem, NDataTable, NDrawer, NDrawerContent, NEmpty, NFormItem, NInput, NInputNumber, NModal, NPagination, NSelect, NSpace, NSpin, NTabPane, NTabs, NTag, NText, useDialog, useMessage, type DataTableColumns } from "naive-ui";
import { useProjectStore } from "../stores/project";
import VelvetechLinkedInDraftsPanel from "../components/VelvetechLinkedInDraftsPanel.vue";
import { isVelvetechProjectId, isWelloreProjectId } from "../project-ids";
import { useWorkflowLaunch, type LaunchableWorkflow } from "../composables/useWorkflowLaunch";
import { htmlToPlaintext } from "../utils/htmlPlaintext";

type Json = Record<string, any>;
interface EmailRow extends Json { id:string; contact_id?:string; contact_name:string; company_name:string; recipient_email?:string; campaign_id?:string; batch_name:string; persona:string; channel:string; sequence_step:number; step_number?:number; current_subject:string; status:string; open_comment_count:number; updated_at:string; sent_at:string|null }
interface ContactGroup {
  contactId: string;
  contactName: string;
  companyName: string;
  recipientEmail: string;
  channelMix: string;
  stepCount: number;
  openCommentCount: number;
  worstStatus: string;
  updatedAt: string | null;
  emails: EmailRow[];
  openEmailId: string;
}
interface ResearchCitation { title: string; url: string; supports: string }
interface Annotation { id:string; text:string; start:number; end:number; purpose:string; research_point_ids:string[]; instruction_ids:string[]; explanation:string; classification:"verified"|"product_truth"|"instruction"|"inference"; confidence:string; warnings:string[] }
interface PickerContact extends Json { uuid:string; name?:string; first_name?:string; last_name?:string; company_name?:string; position?:string; work_email?:string; avatar_url?:string }
interface StyleSource extends Json { id:string; name:string; technique_summary:string; prompt_block:string; tags?:string[] }
interface InstructionDoc { id:string; kind:string; title:string; version:number|string; priority?:number; content_markdown?:string|null }

const store = useProjectStore(); const toast = useMessage(); const dialog = useDialog();
const route = useRoute();
const { launching: launchingN8n, workflows, loadWorkflows, launch } = useWorkflowLaunch();
const studioTab = ref<"email" | "linkedin">("email");
const isVelvetech = computed(() => isVelvetechProjectId(store.selectedProjectId));
const isWellore = computed(() => isWelloreProjectId(store.selectedProjectId));
const stylePlaceholder = computed(() =>
  isWellore.value ? "Default Wellore style" : isVelvetech.value ? "Default Velvetech style" : "Default project style"
);
const rows = ref<EmailRow[]>([]), total = ref(0), page = ref(1), pageSize = ref(25), loading = ref(false), error = ref("");
const search = ref(""), statusFilter = ref<string|null>(null), campaignFilter = ref(""), batchFilter = ref(""), personaFilter = ref(""), reviewerFilter = ref(""), modelFilter = ref(""), qualityFilter = ref<string|null>(null), dateFrom = ref(""), dateTo = ref(""), openOnly = ref(false), savedView = ref("all"), channelFilter = ref("all");
const detailOpen = ref(false), detailLoading = ref(false), detail = ref<Json|null>(null), selectedId = ref("");
const subject = ref(""), emailBody = ref(""), dirty = ref(false), selectedResearch = ref<string[]>([]), selectedText = ref({ quote:"", start:0, end:0 });
const commentDraft = ref(""), regenerationPrompt = ref(""), actionLoading = ref(""), generating = ref(""), candidate = ref<Json|null>(null), compareOpen = ref(false), createOpen = ref(false);
const replyDrafts = ref<Record<string,string>>({});
const pickerSearch = ref(""), pickerContacts = ref<PickerContact[]>([]), pickerTotal = ref(0), pickerPage = ref(1), pickerPageSize = ref(20), pickerLoading = ref(false), selectedPickerContact = ref<PickerContact|null>(null);
const emailOptions = ref({ campaignId:"", batchName:"", persona:"", sequenceStep:1 });
const bodyInput = ref<InstanceType<typeof NInput>|null>(null);
const styleSources = ref<StyleSource[]>([]);
const styleSourceId = ref<string | null>(null);
const instructionOpen = ref(false);
const selectedInstruction = ref<InstructionDoc | null>(null);
const sequenceEmails = ref<EmailRow[]>([]);
const sequenceContactId = ref<string | null>(null);
const drawerChannel = ref<"email" | "linkedin">("email");

const humanize = (value:string) => value.replace(/_/g, " ");
// Multi-touch sequences store LinkedIn DMs in the same table as emails, so they share
// this review workspace (research panel, line comments, versions). Default list filter is
// all channels; API accepts comma-separated values (see parseEmailStudioChannelFilter).
const channelOptions = [
  { label: "All channels", value: "all" },
  { label: "Email only", value: "email" },
  { label: "LinkedIn only", value: "linkedin" },
];
function isLinkedInChannel(channel: string): boolean {
  const ch = String(channel || "").toLowerCase();
  return ch === "linkedin_dm" || ch === "linkedin_inmail" || ch.startsWith("linkedin");
}
function apiChannelParam(filter: string): string {
  if (filter === "linkedin") return "linkedin_dm,linkedin_inmail";
  return filter || "all";
}
function channelMixLabel(emails: EmailRow[]): string {
  const hasEmail = emails.some((e) => !isLinkedInChannel(String(e.channel || "email")));
  const hasLinkedIn = emails.some((e) => isLinkedInChannel(String(e.channel || "")));
  const parts: string[] = [];
  if (hasEmail) parts.push("Email");
  if (hasLinkedIn) parts.push("LinkedIn");
  return parts.join(" · ") || "Email";
}
function isHttpUrl(value: unknown): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}
function researchPointSource(p: Json): string {
  const url = String(p.url || "").trim();
  if (isHttpUrl(url)) return url;
  const source = String(p.source || "").trim();
  if (isHttpUrl(source)) return source;
  const label = String(p.source_label || "").trim();
  return source || label;
}
function openRouterErrorMessage(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/Key limit exceeded|403/i.test(msg)) {
    return "OpenRouter credits exhausted — top up or rotate the API key.";
  }
  return null;
}
const statusOptions = ["research_ready","ai_draft_made","needs_review","comments_made","regenerated","final_check","approved","sent","research_missing","generation_failed","changes_requested","rejected","sending_failed"].map((value) => ({ label:humanize(value), value }));
const savedViews = [{label:"All emails",value:"all"},{label:"Needs review",value:"needs_review"},{label:"Comments waiting",value:"comments_made"},{label:"Final checks",value:"final_check"},{label:"Approved, not sent",value:"approved"},{label:"Sent",value:"sent"},{label:"Failed or blocked",value:"failed"}];
const statusType = (s:string) => s === "sent" ? "success" : s === "approved" ? "info" : ["generation_failed","sending_failed","rejected"].includes(s) ? "error" : ["comments_made","changes_requested","final_check"].includes(s) ? "warning" : "default";
const currentVersion = computed(() => detail.value?.currentVersion ?? null); const comments = computed<Json[]>(() => detail.value?.comments ?? []); const openComments = computed(() => comments.value.filter((c) => c.status === "open"));
const annotations = computed<Annotation[]>(() => (currentVersion.value?.annotations ?? []).slice().sort((a:Annotation,b:Annotation) => a.start-b.start));
const researchPoints = computed<Json[]>(() => detail.value?.researchPoints ?? []);
const rawN8nResearch = computed<Json[]>(() => detail.value?.rawN8nResearch ?? []);
const povResearch = computed<Json|null>(() => rawN8nResearch.value.find((r) => r.workflow_name === "velvetech-pov")?.result ?? null);
const canApprove = computed(() => detail.value?.data?.status === "final_check" && openComments.value.length === 0);
const lastGenerationFailure = computed(() => {
  if (detail.value?.data?.status !== "generation_failed") return null;
  const events = (detail.value?.statusEvents ?? []) as Json[];
  return events.find((e) => e.to_status === "generation_failed") ?? null;
});
const lastGenerationFailureReason = computed(() => {
  const reason = String(lastGenerationFailure.value?.reason || "Unknown error");
  return openRouterErrorMessage(reason) ?? reason;
});
const canStartEmail = computed(() => !!selectedPickerContact.value && !pickerLoading.value && !actionLoading.value);
const emailResearchWorkflow = computed<LaunchableWorkflow | undefined>(() =>
  workflows.value.find((w) => w.adapter === "velvetech_research")
  ?? workflows.value.find((w) => w.adapter === "feasible_list")
  ?? workflows.value.find((w) => /research/i.test(`${w.key} ${w.label}`) && w.adapter !== "velvetech_reply")
);
const styleSourceOptions = computed(() => styleSources.value.map((source) => ({
  label: source.name,
  value: source.id,
})));
const selectedStyleSource = computed(() => styleSources.value.find((source) => source.id === styleSourceId.value) ?? null);

const DONE_STATUSES = new Set(["approved", "sent", "rejected"]);
const STATUS_SEVERITY: Record<string, number> = {
  generation_failed: 100, sending_failed: 95, rejected: 90, research_missing: 85, changes_requested: 80,
  comments_made: 70, final_check: 60, needs_review: 55, regenerated: 50, ai_draft_made: 40,
  research_ready: 30, approved: 20, sent: 10,
};

function stepOf(row: EmailRow): number {
  return Number(row.sequence_step ?? row.step_number ?? 0) || 0;
}
function sortEmailsByStep(emails: EmailRow[]): EmailRow[] {
  return [...emails].sort((a, b) => stepOf(a) - stepOf(b) || String(a.id).localeCompare(String(b.id)));
}
function worstStatus(emails: EmailRow[]): string {
  return emails.slice().sort((a, b) => (STATUS_SEVERITY[b.status] ?? 0) - (STATUS_SEVERITY[a.status] ?? 0))[0]?.status || "research_missing";
}
function pickOpenStep(emails: EmailRow[]): EmailRow {
  const sorted = sortEmailsByStep(emails);
  return sorted.find((e) => !DONE_STATUSES.has(e.status)) ?? sorted[0];
}
function contactGroupKey(row: EmailRow): string {
  return String(row.contact_id || row.id);
}
const contactGroups = computed<ContactGroup[]>(() => {
  const map = new Map<string, EmailRow[]>();
  for (const row of rows.value) {
    const key = contactGroupKey(row);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.entries()].map(([contactId, emails]) => {
    const sorted = sortEmailsByStep(emails);
    const open = pickOpenStep(sorted);
    return {
      contactId,
      contactName: open.contact_name || "Unknown",
      companyName: open.company_name || "",
      recipientEmail: String(open.recipient_email || ""),
      channelMix: channelMixLabel(sorted),
      stepCount: sorted.length,
      openCommentCount: sorted.reduce((sum, e) => sum + Number(e.open_comment_count || 0), 0),
      worstStatus: worstStatus(sorted),
      updatedAt: sorted.map((e) => e.updated_at).filter(Boolean).sort().slice(-1)[0] ?? null,
      emails: sorted,
      openEmailId: open.id,
    };
  });
});
const sequenceSorted = computed(() => sortEmailsByStep(sequenceEmails.value));
const sequenceForChannel = computed(() => sequenceSorted.value.filter((e) => {
  const linkedIn = isLinkedInChannel(String(e.channel || "email"));
  return drawerChannel.value === "linkedin" ? linkedIn : !linkedIn;
}));
const selectedSequenceIndex = computed(() => sequenceForChannel.value.findIndex((e) => e.id === selectedId.value));
const researchStructured = computed<Json | null>(() => {
  const snap = detail.value?.research;
  if (!snap || typeof snap !== "object") return null;
  const structured = snap.structured_research;
  return (structured && typeof structured === "object" ? structured : snap) as Json;
});
const researchCitations = computed<ResearchCitation[]>(() => {
  const snap = detail.value?.research;
  if (!snap) return [];
  const structured = researchStructured.value;
  let raw: Json[] = Array.isArray(snap.citations) ? snap.citations
    : Array.isArray(structured?.citations) ? structured!.citations
    : [];
  if (!raw.length && structured && Array.isArray(structured.verified_signals)) {
    raw = (structured.verified_signals as Json[])
      .map((s) => {
        if (typeof s !== "object" || !s) return null;
        const source = String(s.source || s.url || "").trim();
        if (!source) return null;
        return {
          title: String(s.title || s.statement || source).trim(),
          url: isHttpUrl(source) ? source : String(s.url || "").trim(),
          source,
          supports: String(s.statement || s.supports || "").trim(),
        };
      })
      .filter((c): c is Json => Boolean(c));
  }
  return (raw as Json[]).map((c) => {
    const source = String(c.source || "").trim();
    const title = String(c.title || c.statement || source || "Source").trim();
    const url = String(c.url || (isHttpUrl(source) ? source : "") || "").trim();
    const supports = String(c.supports || c.statement || (!isHttpUrl(source) ? source : "") || "").trim();
    if (!title && !url && !supports) return null;
    return { title: title || url || "Citation", url, supports: supports === title ? "" : supports };
  }).filter((c): c is ResearchCitation => Boolean(c));
});
const researchVerifiedList = computed<string[]>(() => {
  const structured = researchStructured.value;
  const raw = Array.isArray(structured?.verified_signals) ? structured!.verified_signals : [];
  return (raw as Json[]).map((x) => typeof x === "string" ? x : String(x.statement || "")).map((s) => s.trim()).filter(Boolean);
});
const researchInferredList = computed<string[]>(() => {
  const structured = researchStructured.value;
  const raw = Array.isArray(structured?.inferred_priorities) ? structured!.inferred_priorities : [];
  return (raw as Json[]).map((x) => typeof x === "string" ? x : String(x.statement || "")).map((s) => s.trim()).filter(Boolean);
});
const researchGaps = computed<string[]>(() => {
  const snap = detail.value?.research;
  const structured = researchStructured.value;
  const raw = Array.isArray(snap?.gaps) ? snap.gaps
    : Array.isArray(structured?.gaps) ? structured!.gaps
    : [];
  return (raw as unknown[]).map((x) => String(x).trim()).filter(Boolean);
});
const N8N_SUMMARY_KEYS = [
  "fit_score", "vertical", "pressure_points", "velvetech_angle", "discovery_questions",
  "pov_summary", "pov_hook", "pov_wellore_angle", "brief_markdown", "company_name", "domain",
];
function summarizeN8nResult(result: unknown): Array<{ key: string; value: string }> {
  if (!result || typeof result !== "object") return [{ key: "result", value: String(result ?? "") }];
  const obj = result as Json;
  const out: Array<{ key: string; value: string }> = [];
  for (const key of N8N_SUMMARY_KEYS) {
    if (obj[key] == null || obj[key] === "") continue;
    const v = obj[key];
    out.push({
      key: humanize(key),
      value: Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("; ")
        : typeof v === "object" ? JSON.stringify(v) : String(v),
    });
  }
  if (!out.length) {
    for (const [key, v] of Object.entries(obj).slice(0, 8)) {
      if (v == null || typeof v === "object") continue;
      out.push({ key: humanize(key), value: String(v) });
    }
  }
  return out;
}

function contactLabel(c: PickerContact): string {
  return (typeof c.name === "string" && c.name.trim())
    || [c.first_name, c.last_name].filter((x) => typeof x === "string" && x).join(" ")
    || "Unknown";
}

function fmt(v:string|null) { return v ? new Date(v).toLocaleString() : "—"; }
function qs() {
  const q = new URLSearchParams({ projectId:String(store.selectedProjectId), page:String(page.value), pageSize:String(pageSize.value) });
  if(search.value.trim())q.set("search",search.value.trim());
  const status = savedView.value !== "all" ? savedView.value : statusFilter.value;
  if(status)q.set("status",status);
  if(campaignFilter.value)q.set("campaign",campaignFilter.value);
  if(batchFilter.value)q.set("batch",batchFilter.value);
  if(personaFilter.value)q.set("persona",personaFilter.value);
  if(reviewerFilter.value)q.set("reviewer",reviewerFilter.value);
  if(modelFilter.value)q.set("model",modelFilter.value);
  if(qualityFilter.value)q.set("researchQuality",qualityFilter.value);
  if(channelFilter.value)q.set("channel", apiChannelParam(channelFilter.value));
  if(dateFrom.value)q.set("dateFrom",dateFrom.value);
  if(dateTo.value)q.set("dateTo",dateTo.value);
  if(openOnly.value)q.set("hasOpenComments","true");
  return q;
}
async function load() { if(!store.selectedProjectId)return; loading.value=true; error.value=""; try { const r=await fetch(`/api/email-studio/emails?${qs()}`); const j=await r.json(); if(!r.ok)throw new Error(j.error); rows.value=j.data??[]; total.value=j.total??0; } catch(e){error.value=e instanceof Error?e.message:"Could not load emails"} finally{loading.value=false} }
async function loadStyleSources() {
  if (!store.selectedProjectId) return;
  try {
    const r = await fetch(`/api/sequence-studio/style-sources?projectId=${store.selectedProjectId}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Could not load styles");
    styleSources.value = j.data ?? [];
    if (styleSourceId.value && !styleSources.value.some((source) => source.id === styleSourceId.value)) styleSourceId.value = null;
  } catch {
    styleSources.value = [];
    styleSourceId.value = null;
  }
}
async function openQueryEmail() {
  const emailId = typeof route.query.emailId === "string" ? route.query.emailId : "";
  const projectId = typeof route.query.projectId === "string" ? route.query.projectId : "";
  if (projectId && projectId !== store.selectedProjectId) store.selectProject(projectId);
  if (emailId) await openEmail(emailId);
}
let timer:number|undefined; watch([search,statusFilter,campaignFilter,batchFilter,personaFilter,reviewerFilter,modelFilter,qualityFilter,channelFilter,dateFrom,dateTo,openOnly,savedView],()=>{page.value=1; window.clearTimeout(timer); timer=window.setTimeout(load,250)}); watch(()=>store.selectedProjectId,()=>{void load();void loadWorkflows();void loadStyleSources()}); watch([page,pageSize],load); watch(()=>route.query.emailId,()=>{void openQueryEmail()}); onMounted(()=>{void load();void loadWorkflows();void loadStyleSources();void openQueryEmail()});

function shouldIgnoreRowClick(event: MouseEvent): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest("a, button, input, textarea, select, [role='button']"));
}

const emailRowProps = (row: ContactGroup) => ({
  class: "clickable-email-row",
  onClick: (event: MouseEvent) => {
    if (shouldIgnoreRowClick(event)) return;
    void openContactGroup(row);
  },
});

const columns:DataTableColumns<ContactGroup> = [
  {title:"Contact",key:"contactName",render:r=>h("div",[h("a",{class:"email-studio-link",href:"#",onClick:(e:MouseEvent)=>{e.preventDefault();void openContactGroup(r)}},r.contactName||"Unknown"),h("div",{class:"muted"},r.recipientEmail||"")])},
  {title:"Company",key:"companyName"},
  {title:"Channels",key:"channelMix",width:160,render:r=>h("div",[h("div",r.channelMix),h("div",{class:"muted"},`${r.stepCount} step${r.stepCount===1?"":"s"}`)])},
  {title:"Status",key:"worstStatus",render:r=>h(NTag,{size:"small",type:statusType(r.worstStatus) as any},{default:()=>humanize(r.worstStatus)})},
  {title:"Comments",key:"openCommentCount",width:90},
  {title:"Updated",key:"updatedAt",render:r=>fmt(r.updatedAt)},
  {title:"",key:"actions",width:100,render:r=>h(NButton,{size:"small",type:"primary",secondary:true,onClick:()=>openContactGroup(r)},{default:()=>"Open"})},
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

async function loadSequenceForContact(contactId: string, seed?: EmailRow | null) {
  if (!store.selectedProjectId || !contactId) {
    sequenceContactId.value = contactId || null;
    sequenceEmails.value = seed ? [seed] : [];
    return;
  }
  sequenceContactId.value = contactId;
  try {
    const q = new URLSearchParams({
      projectId: String(store.selectedProjectId),
      contactId,
      page: "1",
      pageSize: "50",
      // Always load the full multichannel sequence for the drawer workspace.
      channel: "all",
    });
    const r = await fetch(`/api/email-studio/emails?${q}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Could not load sequence");
    let emails = sortEmailsByStep((j.data ?? []) as EmailRow[]);
    if (seed && (seed.campaign_id || seed.batch_name)) {
      const filtered = emails.filter((e) =>
        (!seed.campaign_id || e.campaign_id === seed.campaign_id)
        && (!seed.batch_name || e.batch_name === seed.batch_name)
      );
      if (filtered.length) emails = filtered;
    }
    if (!emails.length && seed) emails = [seed];
    sequenceEmails.value = emails;
  } catch {
    sequenceEmails.value = seed ? [seed] : [];
  }
}

async function openContactGroup(group: ContactGroup) {
  await loadSequenceForContact(group.contactId, group.emails[0] ?? null);
  const target = pickOpenStep(sequenceEmails.value.length ? sequenceEmails.value : group.emails);
  if (target) await openEmail(target.id, { skipSequenceReload: true });
}

async function openEmail(id:string, opts?: { skipSequenceReload?: boolean }) {
  selectedId.value=id;
  detailOpen.value=true;
  detailLoading.value=true;
  candidate.value=null;
  try {
    const r=await fetch(`/api/email-studio/emails/${id}?projectId=${store.selectedProjectId}`);
    const j=await r.json();
    if(!r.ok)throw new Error(j.error);
    detail.value=j;
    subject.value=j.currentVersion?.subject??"";
    emailBody.value=htmlToPlaintext(j.currentVersion?.body??"");
    selectedResearch.value=(j.researchPoints??[]).map((x:Json)=>x.id);
    dirty.value=false;
    drawerChannel.value = isLinkedInChannel(String(j.data?.channel || "email")) ? "linkedin" : "email";
    const contactId = String(j.data?.contact_id || "");
    if (!opts?.skipSequenceReload && contactId && contactId !== sequenceContactId.value) {
      await loadSequenceForContact(contactId, j.data as EmailRow);
    } else if (!opts?.skipSequenceReload && contactId && !sequenceEmails.value.some((e) => e.id === id)) {
      await loadSequenceForContact(contactId, j.data as EmailRow);
    } else if (!sequenceEmails.value.length && j.data) {
      sequenceEmails.value = [j.data as EmailRow];
      sequenceContactId.value = contactId || null;
    }
    if(j.data.status==="ai_draft_made") await setStatus("needs_review",false);
  } catch(e){
    toast.error(e instanceof Error?e.message:"Could not open email");
  } finally{
    detailLoading.value=false;
  }
}
async function refreshDetail(){if(selectedId.value)await openEmail(selectedId.value, { skipSequenceReload: true })}
async function request(path:string, options:RequestInit={}) { actionLoading.value=path; try { const r=await fetch(path,{...options,headers:{"Content-Type":"application/json",...(options.headers??{})}}); const j=await r.json(); if(!r.ok)throw new Error(j.error??"Action failed"); return j; } finally{actionLoading.value=""} }
async function setStatus(status:string, notify=true){try{await request(`/api/email-studio/emails/${selectedId.value}/status`,{method:"PATCH",body:JSON.stringify({projectId:store.selectedProjectId,status})});if(notify)toast.success(`Moved to ${humanize(status)}`);await refreshDetail();await load()}catch(e){if(notify)toast.error(e instanceof Error?e.message:"Status update failed")}}
async function saveEdits(){try{await request(`/api/email-studio/emails/${selectedId.value}/human-version`,{method:"POST",body:JSON.stringify({projectId:store.selectedProjectId,subject:subject.value,body:emailBody.value})});dirty.value=false;toast.success("New version saved");await refreshDetail();await load()}catch(e){toast.error(e instanceof Error?e.message:"Save failed")}}
function openInstruction(i: InstructionDoc) { selectedInstruction.value = i; instructionOpen.value = true; }
function captureSelection(){const el=(bodyInput.value as any)?.textareaElRef as HTMLTextAreaElement|undefined;if(!el)return;const start=el.selectionStart,end=el.selectionEnd;selectedText.value={start,end,quote:emailBody.value.slice(start,end)};}
async function addComment(){if(!selectedText.value.quote||!commentDraft.value.trim())return;const {start,end,quote}=selectedText.value;try{await request(`/api/email-studio/emails/${selectedId.value}/comments`,{method:"POST",body:JSON.stringify({projectId:store.selectedProjectId,selectedQuote:quote,startOffset:start,endOffset:end,contextBefore:emailBody.value.slice(Math.max(0,start-30),start),contextAfter:emailBody.value.slice(end,end+30),body:commentDraft.value})});commentDraft.value="";toast.success("Comment added");await refreshDetail();await load()}catch(e){toast.error(e instanceof Error?e.message:"Comment failed")}}
async function toggleComment(c:Json){try{await request(`/api/email-studio/comments/${c.id}`,{method:"PATCH",body:JSON.stringify({projectId:store.selectedProjectId,status:c.status==="open"?"resolved":"open"})});await refreshDetail()}catch(e){toast.error(e instanceof Error?e.message:"Comment update failed")}}
async function reply(c:Json){const text=replyDrafts.value[c.id]?.trim();if(!text)return;try{await request(`/api/email-studio/comments/${c.id}/replies`,{method:"POST",body:JSON.stringify({projectId:store.selectedProjectId,body:text})});replyDrafts.value[c.id]="";await refreshDetail()}catch(e){toast.error(e instanceof Error?e.message:"Reply failed")}}
function paragraphSelection(){const start=emailBody.value.lastIndexOf("\n",Math.max(0,selectedText.value.start-1))+1;const next=emailBody.value.indexOf("\n",selectedText.value.end);const end=next<0?emailBody.value.length:next;return {start,end,quote:emailBody.value.slice(start,end)}}
async function generate(initial=false,scope="full"){
  const path=initial?"generate":"regenerate";
  generating.value = initial ? "initial" : scope;
  const loadingToast = toast.loading(initial ? "Researching and drafting the email… this can take up to a minute." : "Regenerating… this can take up to a minute.", { duration: 0 });
  try{
    const selection=scope==="selection"?selectedText.value:scope==="paragraph"?paragraphSelection():null;
    const j=await request(`/api/email-studio/emails/${selectedId.value}/${path}`,{method:"POST",body:JSON.stringify({projectId:store.selectedProjectId,prompt:regenerationPrompt.value||undefined,scope,selection,includedResearchPointIds:selectedResearch.value,styleSourceId:styleSourceId.value||undefined})});
    loadingToast.destroy();
    if(initial){toast.success("AI draft created");await refreshDetail()}else{candidate.value=j.version;compareOpen.value=true;toast.success("Regeneration candidate ready")}
  }catch(e){
    loadingToast.destroy();
    toast.error(openRouterErrorMessage(e) ?? (e instanceof Error?e.message:"Generation failed"), { duration: 12000 });
    await refreshDetail();
  } finally {
    generating.value = "";
  }
}
async function adopt(){if(!candidate.value)return;try{await request(`/api/email-studio/emails/${selectedId.value}/versions/${candidate.value.id}/adopt`,{method:"POST",body:JSON.stringify({projectId:store.selectedProjectId})});compareOpen.value=false;candidate.value=null;toast.success("New version adopted");await refreshDetail();await load()}catch(e){toast.error(e instanceof Error?e.message:"Could not adopt version")}}
async function approve(){dialog.warning({title:"Approve this email?",content:"Approval locks the current version. Only Smartlead can mark it sent.",positiveText:"Approve",negativeText:"Cancel",onPositiveClick:async()=>{try{await request(`/api/email-studio/emails/${selectedId.value}/approve`,{method:"POST",body:JSON.stringify({projectId:store.selectedProjectId})});toast.success("Email approved");await refreshDetail();await load()}catch(e){toast.error(e instanceof Error?e.message:"Approval failed")}}})}

const canSyncSmartlead = computed(() => {
  const d = detail.value?.data;
  if (!d) return false;
  return Boolean(d.smartlead_campaign_id || d.campaign_id) && Boolean(d.smartlead_lead_id || d.recipient_email || d.contact_id);
});
async function syncFromSmartlead() {
  const d = detail.value?.data;
  if (!d) return;
  try {
    const j = await request("/api/email-studio/smartlead/reconcile", {
      method: "POST",
      body: JSON.stringify({
        projectId: store.selectedProjectId,
        campaignId: d.smartlead_campaign_id || d.campaign_id,
        leadId: d.smartlead_lead_id || undefined,
        recipientEmail: d.recipient_email || undefined,
        contactId: d.contact_id || undefined,
        batchName: d.batch_name || undefined,
      }),
    });
    const data = j.data ?? {};
    toast.success(`Smartlead sync: ${data.upserted ?? 0} updated, ${data.sentInSmartlead ?? 0} sent in Smartlead`);
    await refreshDetail();
    await load();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Smartlead sync failed");
  }
}

async function launchEmailResearch(rowLike: Json) {
  const workflow = emailResearchWorkflow.value;
  const contactId = String(rowLike.contact_id ?? "").trim();
  if (!workflow) {
    toast.error("No n8n research workflow is available for this project");
    return;
  }
  if (!workflow.configured) {
    toast.error(`${workflow.label} webhook is not configured`);
    return;
  }
  if (!contactId) {
    toast.error("This Email Studio record is missing a contact UUID");
    return;
  }
  const launchId = await launch(workflow.key, [contactId], {
    successMessage: `Launched n8n research for ${String(rowLike.contact_name ?? "this contact")}. Results will appear in a few minutes.`,
  });
  if (launchId) await load();
}

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
const annotatedSegments=computed(()=>{
  const body = emailBody.value;
  const out:Json[]=[];
  let at=0;
  for(const a of annotations.value){
    const slice = body.slice(a.start, a.end);
    // Skip misaligned annotations after HTML→plaintext (offsets were against stored HTML).
    if (a.start < at || a.end > body.length || (a.text && slice !== a.text && htmlToPlaintext(a.text) !== slice)) continue;
    if(a.start>at)out.push({text:body.slice(at,a.start)});
    out.push({text:slice || a.text, annotation:a});
    at=a.end;
  }
  if(at<body.length)out.push({text:body.slice(at)});
  if (!out.length && body) out.push({ text: body });
  return out;
});
function previousRow(){
  const i = selectedSequenceIndex.value;
  if (i > 0) void openEmail(sequenceForChannel.value[i - 1].id, { skipSequenceReload: true });
}
function nextRow(){
  const i = selectedSequenceIndex.value;
  if (i >= 0 && i < sequenceForChannel.value.length - 1) void openEmail(sequenceForChannel.value[i + 1].id, { skipSequenceReload: true });
}
function stepLabel(row: EmailRow): string {
  const linkedIn = isLinkedInChannel(String(row.channel || "email"));
  const peers = sequenceSorted.value.filter((e) => isLinkedInChannel(String(e.channel || "email")) === linkedIn);
  const idx = peers.findIndex((e) => e.id === row.id);
  const n = idx >= 0 ? idx + 1 : stepOf(row) || 1;
  return linkedIn ? `LinkedIn ${n}` : `Email ${n}`;
}
function setDrawerChannel(channel: "email" | "linkedin") {
  drawerChannel.value = channel;
  const list = sequenceSorted.value.filter((e) => {
    const linkedIn = isLinkedInChannel(String(e.channel || "email"));
    return channel === "linkedin" ? linkedIn : !linkedIn;
  });
  if (list.length && !list.some((e) => e.id === selectedId.value)) {
    void openEmail(list[0].id, { skipSequenceReload: true });
  }
}
const hasDrawerEmailSteps = computed(() => sequenceSorted.value.some((e) => !isLinkedInChannel(String(e.channel || "email"))));
const hasDrawerLinkedInSteps = computed(() => sequenceSorted.value.some((e) => isLinkedInChannel(String(e.channel || ""))));
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
        <NCard size="small"><div class="filters"><NSelect v-model:value="savedView" :options="savedViews"/><NInput v-model:value="search" clearable placeholder="Search contact, company, subject or email…"/><NSelect v-model:value="statusFilter" clearable :options="statusOptions" placeholder="Status"/><NInput v-model:value="campaignFilter" clearable placeholder="Campaign"/><NInput v-model:value="batchFilter" clearable placeholder="Batch"/><NInput v-model:value="personaFilter" clearable placeholder="Persona"/><NInput v-model:value="reviewerFilter" clearable placeholder="Reviewer"/><NInput v-model:value="modelFilter" clearable placeholder="Model"/><NSelect v-model:value="channelFilter" :options="channelOptions" placeholder="Channel"/><NSelect v-model:value="qualityFilter" clearable :options="['verified','partial','missing','unknown'].map(value=>({label:humanize(value),value}))" placeholder="Research quality"/><NInput v-model:value="dateFrom" placeholder="Updated from (YYYY-MM-DD)"/><NInput v-model:value="dateTo" placeholder="Updated to (YYYY-MM-DD)"/><NCheckbox v-model:checked="openOnly">Open comments</NCheckbox></div></NCard>
        <NAlert v-if="error" type="error" style="margin-top:12px">{{error}}</NAlert><NDataTable :columns="columns" :data="contactGroups" :loading="loading" :row-key="r=>r.contactId" :row-props="emailRowProps" style="margin-top:12px"/><NPagination v-model:page="page" v-model:page-size="pageSize" :item-count="total" show-size-picker :page-sizes="[25,50,100]" style="margin-top:12px"/>
      </NTabPane>

      <NTabPane name="linkedin" tab="LinkedIn">
        <NAlert v-if="isVelvetech" type="info" :show-icon="false" style="margin:16px 0">
          Review Velvetech LinkedIn reply drafts from n8n. Edit when flagged <strong>needs_human</strong>, then approve to send via GetSales.
        </NAlert>
        <VelvetechLinkedInDraftsPanel v-if="isVelvetech" :project-id="store.selectedProjectId" />
        <NEmpty v-else description="LinkedIn draft review is available for the Velvetech project only." />
      </NTabPane>
    </NTabs>

    <NDrawer v-model:show="detailOpen" width="96vw"><NDrawerContent :title="detail?.data?.contact_name || 'Email'" closable><NSpin :show="detailLoading"><template v-if="detail">
      <NSpace justify="space-between" align="center"><NSpace><NButton size="small" :disabled="selectedSequenceIndex<=0" @click="previousRow">Previous</NButton><NButton size="small" :disabled="selectedSequenceIndex<0||selectedSequenceIndex>=sequenceForChannel.length-1" @click="nextRow">Next</NButton><div class="status-cell"><NTag :type="statusType(detail.data.status) as any">{{humanize(detail.data.status)}}</NTag><NButton v-if="detail.data.status==='research_missing'" size="tiny" secondary type="primary" :loading="launchingN8n" :disabled="!emailResearchWorkflow?.configured" @click="launchEmailResearch(detail.data)">Launch n8n</NButton></div><NText depth="3">{{detail.data.company_name}} · {{detail.data.batch_name}} · {{detail.data.persona}}</NText></NSpace><NSpace><NButton v-if="canSyncSmartlead" secondary :loading="actionLoading==='/api/email-studio/smartlead/reconcile'" @click="syncFromSmartlead">Sync from Smartlead</NButton><NButton @click="copy">Copy</NButton><NButton v-if="['needs_review','regenerated'].includes(detail.data.status)" type="warning" secondary @click="setStatus('final_check')">Ready for final check</NButton><NButton v-if="canApprove" type="success" @click="approve">Approve</NButton><NButton type="error" secondary @click="setStatus('rejected')">Reject</NButton></NSpace></NSpace>
      <div v-if="hasDrawerEmailSteps || hasDrawerLinkedInSteps" class="drawer-channel-toggle">
        <button
          v-if="hasDrawerEmailSteps"
          type="button"
          class="sequence-step"
          :class="{ active: drawerChannel === 'email' }"
          @click="setDrawerChannel('email')"
        >Email</button>
        <button
          v-if="hasDrawerLinkedInSteps"
          type="button"
          class="sequence-step"
          :class="{ active: drawerChannel === 'linkedin' }"
          @click="setDrawerChannel('linkedin')"
        >LinkedIn</button>
      </div>
      <div v-if="sequenceForChannel.length" class="sequence-strip">
        <button
          v-for="step in sequenceForChannel"
          :key="step.id"
          type="button"
          class="sequence-step"
          :class="{ active: step.id === selectedId }"
          @click="openEmail(step.id, { skipSequenceReload: true })"
        >{{ stepLabel(step) }}</button>
      </div>
      <div class="workspace">
        <section class="panel research"><h3>Research & instructions</h3>
          <template v-if="researchPoints.length"><div v-for="p in researchPoints" :key="p.id" class="research-point"><NCheckbox :checked="selectedResearch.includes(p.id)" @update:checked="v=>selectedResearch=v?[...selectedResearch,p.id]:selectedResearch.filter(x=>x!==p.id)">{{p.statement}}</NCheckbox><NTag size="tiny" :type="p.kind==='verified'?'info':'warning'">{{p.kind}}</NTag><div v-if="researchPointSource(p)" class="research-source"><a v-if="isHttpUrl(researchPointSource(p))" :href="researchPointSource(p)" target="_blank" rel="noopener noreferrer">Open source</a><span v-else>{{ researchPointSource(p) }}</span></div></div></template>
          <template v-else-if="povResearch">
            <NAlert type="info" :show-icon="false" style="margin-bottom:10px">From the n8n research pipeline — not yet used to draft this email. Click "Research and create AI draft" to generate a draft grounded in this.</NAlert>
            <NSpace style="margin-bottom:8px"><NTag v-if="povResearch.fit_score!=null" type="success">Fit score {{povResearch.fit_score}}</NTag><NTag v-if="povResearch.vertical">{{povResearch.vertical}}</NTag></NSpace>
            <div v-if="povResearch.pressure_points?.length"><h4>Pressure points</h4><ul><li v-for="(pt,i) in povResearch.pressure_points" :key="i">{{pt}}</li></ul></div>
            <div v-if="povResearch.velvetech_angle"><h4>Velvetech angle</h4><p>{{povResearch.velvetech_angle}}</p></div>
            <div v-if="povResearch.discovery_questions?.length"><h4>Discovery questions</h4><ul><li v-for="(q,i) in povResearch.discovery_questions" :key="i">{{q}}</li></ul></div>
            <details v-if="povResearch.brief_markdown"><summary>Full research brief</summary><pre style="white-space:pre-wrap">{{povResearch.brief_markdown}}</pre></details>
          </template>
          <NEmpty v-else description="No structured research attached"/>
          <h4>Active instructions</h4>
          <button
            v-for="i in detail.instructions"
            :key="i.id"
            type="button"
            class="instruction instruction-btn"
            @click="openInstruction(i)"
          >
            <NTag size="small" type="info">{{ i.kind }}</NTag>
            <span>{{ i.title }} v{{ i.version }}</span>
          </button>
          <NEmpty v-if="!detail.instructions?.length" description="No active instructions" size="small" />
          <div v-if="detail.research" class="research-readable">
            <div v-if="researchCitations.length" class="research-block">
              <h4>Citations</h4>
              <ul class="citation-list">
                <li v-for="(c, i) in researchCitations" :key="i">
                  <a v-if="c.url" :href="c.url" target="_blank" rel="noopener noreferrer">{{ c.title }}</a>
                  <strong v-else>{{ c.title }}</strong>
                  <span v-if="c.supports" class="citation-supports">{{ c.supports }}</span>
                </li>
              </ul>
            </div>
            <div v-if="!researchPoints.length && researchVerifiedList.length" class="research-block">
              <h4>Verified</h4>
              <ul><li v-for="(item, i) in researchVerifiedList" :key="`v-${i}`">{{ item }}</li></ul>
            </div>
            <div v-if="!researchPoints.length && researchInferredList.length" class="research-block">
              <h4>Inferred</h4>
              <ul><li v-for="(item, i) in researchInferredList" :key="`i-${i}`">{{ item }}</li></ul>
            </div>
            <div v-if="researchGaps.length" class="research-block">
              <h4>Gaps</h4>
              <ul><li v-for="(item, i) in researchGaps" :key="`g-${i}`">{{ item }}</li></ul>
            </div>
            <details class="raw-json-details"><summary>Show raw JSON</summary><pre>{{ JSON.stringify(detail.research, null, 2) }}</pre></details>
          </div>
          <div v-else-if="rawN8nResearch.length" class="research-readable">
            <h4>n8n research runs</h4>
            <div v-for="run in rawN8nResearch" :key="run.id || run.workflow_name + run.created_at" class="n8n-run-card">
              <div class="n8n-run-head">
                <strong>{{ run.workflow_name || 'workflow' }}</strong>
                <NText depth="3">{{ fmt(run.created_at) }}</NText>
              </div>
              <dl class="n8n-summary">
                <template v-for="(row, ri) in summarizeN8nResult(run.result)" :key="ri">
                  <dt>{{ row.key }}</dt>
                  <dd>{{ row.value }}</dd>
                </template>
              </dl>
              <details class="raw-json-details"><summary>Show raw JSON</summary><pre>{{ JSON.stringify(run, null, 2) }}</pre></details>
            </div>
          </div>
        </section>
        <section class="panel editor"><h3>Email</h3>
          <NAlert v-if="lastGenerationFailure" type="error" style="margin-bottom:12px" :show-icon="false">
            <strong>Last attempt failed:</strong> {{lastGenerationFailureReason}}
          </NAlert>
          <template v-if="currentVersion"><NFormItem label="Subject"><NInput v-model:value="subject" @update:value="dirty=true"/></NFormItem><NFormItem label="Body"><NInput ref="bodyInput" v-model:value="emailBody" type="textarea" :autosize="{minRows:12,maxRows:24}" @select="captureSelection" @mouseup="captureSelection" @keyup="captureSelection" @update:value="dirty=true"/></NFormItem><NFormItem label="Style technique"><NSelect v-model:value="styleSourceId" clearable :options="styleSourceOptions" :placeholder="stylePlaceholder"/></NFormItem><NAlert v-if="selectedStyleSource" type="info" :show-icon="false" style="margin-bottom:10px">{{selectedStyleSource.technique_summary}}</NAlert><NSpace><NButton type="primary" :disabled="!dirty||!!generating" @click="saveEdits">Save as new version</NButton><NButton :loading="generating==='full'" :disabled="!!generating" @click="generate(false,'full')">Regenerate all</NButton><NButton :loading="generating==='paragraph'" :disabled="!!generating||!selectedText.quote" @click="generate(false,'paragraph')">Regenerate paragraph</NButton><NButton :loading="generating==='selection'" :disabled="!!generating||!selectedText.quote" @click="generate(false,'selection')">Regenerate selection</NButton></NSpace><NInput v-model:value="regenerationPrompt" type="textarea" placeholder="Optional regeneration direction…" :autosize="{minRows:2,maxRows:4}" style="margin-top:10px"/><h4>Annotated preview</h4><div class="annotated"><template v-for="(s,i) in annotatedSegments" :key="i"><span v-if="s.annotation" class="annotated-span" :style="{borderBottomColor:annotationColor(s.annotation),backgroundColor:annotationColor(s.annotation)+'22'}" :title="`${s.annotation.purpose}\n${s.annotation.explanation}\nResearch: ${s.annotation.research_point_ids.join(', ')||'none'}\nRules: ${s.annotation.instruction_ids.join(', ')||'none'}\nConfidence: ${s.annotation.confidence}`">{{s.text}}</span><span v-else>{{s.text}}</span></template></div><div v-if="currentVersion.validation_results?.length"><NAlert v-for="v in currentVersion.validation_results" :key="v.code+v.message" :type="v.severity==='error'?'error':'warning'" :show-icon="false" style="margin-top:6px">{{v.message}}</NAlert></div></template>
          <template v-else>
            <NEmpty :description="generating==='initial' ? 'Researching and drafting… this can take up to a minute.' : 'No draft yet'"/>
            <NFormItem label="Style technique" style="margin-top:12px"><NSelect v-model:value="styleSourceId" clearable :options="styleSourceOptions" :placeholder="stylePlaceholder"/></NFormItem>
            <NAlert v-if="selectedStyleSource" type="info" :show-icon="false" style="margin-bottom:10px">{{selectedStyleSource.technique_summary}}</NAlert>
            <NButton type="primary" style="margin-top:12px" :loading="generating==='initial'" :disabled="!!generating" @click="generate(true)">{{lastGenerationFailure ? "Try again" : "Research and create AI draft"}}</NButton>
          </template>
        </section>
        <section class="panel comments"><h3>Comments</h3><NAlert v-if="selectedText.quote" type="info" :show-icon="false"><strong>Selected:</strong> “{{selectedText.quote}}”</NAlert><NInput v-model:value="commentDraft" type="textarea" placeholder="Comment on the selected text…" :disabled="!selectedText.quote" style="margin-top:8px"/><NButton type="primary" secondary :disabled="!selectedText.quote||!commentDraft.trim()" style="margin-top:8px" @click="addComment">Add comment</NButton><div v-for="c in comments" :key="c.id" class="comment" :class="{resolved:c.status==='resolved'}"><NTag size="tiny" :type="c.status==='open'?'warning':'success'">{{c.status}}</NTag><blockquote>“{{c.selected_quote}}”</blockquote><p>{{c.body}}</p><NText v-if="c.mapped_version_id&&c.mapped_start_offset==null" type="error">Not mapped to current version</NText><div v-for="r in c.outreach_email_comment_replies" :key="r.id" class="reply">{{r.body}}</div><NInput v-model:value="replyDrafts[c.id]" size="small" placeholder="Reply…" style="margin:7px 0"/><NSpace><NButton text type="primary" size="tiny" @click="reply(c)">Reply</NButton><NButton text type="primary" size="tiny" @click="toggleComment(c)">{{c.status==='open'?'Resolve':'Reopen'}}</NButton></NSpace></div><NEmpty v-if="!comments.length" description="No comments"/><h4>Versions</h4><div v-for="v in detail.versions" :key="v.id" class="version"><NTag size="tiny" :type="v.state==='current'?'success':'default'">v{{v.version_number}} · {{v.state}}</NTag> {{v.author_type}} · {{fmt(v.created_at)}}</div></section>
      </div></template></NSpin></NDrawerContent></NDrawer>

    <NModal v-model:show="compareOpen" preset="card" title="Review regenerated candidate" style="width:min(1200px,95vw)"><div class="compare"><div><h3>Current version</h3><strong>{{currentVersion?.subject}}</strong><pre>{{ htmlToPlaintext(currentVersion?.body) }}</pre></div><div><h3>Candidate v{{candidate?.version_number}}</h3><strong>{{candidate?.subject}}</strong><pre>{{ htmlToPlaintext(candidate?.body) }}</pre></div></div><template #footer><NSpace justify="end"><NButton @click="compareOpen=false">Keep current</NButton><NButton type="primary" @click="adopt">Adopt candidate</NButton></NSpace></template></NModal>

    <NModal v-model:show="instructionOpen" preset="card" :title="selectedInstruction?.title || 'Instruction'" style="width:min(720px,94vw)">
      <NSpace v-if="selectedInstruction" style="margin-bottom:12px">
        <NTag size="small" type="info">{{ selectedInstruction.kind }}</NTag>
        <NText depth="3">v{{ selectedInstruction.version }}</NText>
      </NSpace>
      <pre class="instruction-body">{{ selectedInstruction?.content_markdown || "No content for this instruction." }}</pre>
      <template #footer>
        <NSpace justify="end"><NButton @click="instructionOpen=false">Close</NButton></NSpace>
      </template>
    </NModal>

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

<style scoped>.email-studio-link{color:#2080f0;text-decoration:none;font-weight:600}.email-studio-link:hover{text-decoration:underline}.status-cell{display:flex;flex-direction:column;align-items:flex-start;gap:6px}:deep(.clickable-email-row){cursor:pointer}:deep(.clickable-email-row:hover td){background:rgba(32,128,240,.06)}.studio{max-width:1760px;margin:auto}.studio h1{margin:0}.filters{display:grid;grid-template-columns:180px minmax(260px,1fr) 170px 150px 140px auto;gap:10px;align-items:center}.drawer-channel-toggle{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.sequence-strip{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.sequence-step{border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;border-radius:8px;padding:6px 12px;cursor:pointer;font-weight:600}.sequence-step.active,.sequence-step:hover{border-color:#2080f0;background:rgba(32,128,240,.1)}.workspace{display:grid;grid-template-columns:minmax(260px,1fr) minmax(430px,1.7fr) minmax(270px,1fr);gap:12px;margin-top:14px;height:calc(100vh - 240px)}.panel{border:1px solid rgba(128,128,128,.25);border-radius:10px;padding:14px;overflow:auto}.panel h3{margin-top:0}.research-point{padding:9px 0;border-bottom:1px solid rgba(128,128,128,.16)}.research-source{margin-top:4px;margin-left:24px;font-size:.85em;opacity:.8}.research-source a{color:#2080f0;text-decoration:none;font-weight:600}.research-source a:hover{text-decoration:underline}.research-readable{margin-top:14px}.research-block{margin:12px 0}.research-block h4{margin:0 0 6px}.citation-list{list-style:none;padding:0;margin:0}.citation-list li{padding:8px 0;border-bottom:1px solid rgba(128,128,128,.12)}.citation-list a{font-weight:600}.citation-supports{display:block;margin-top:4px;opacity:.75;font-size:.9em}.n8n-run-card{border:1px solid rgba(128,128,128,.22);border-radius:8px;padding:10px;margin:10px 0}.n8n-run-head{display:flex;justify-content:space-between;gap:10px;margin-bottom:8px}.n8n-summary{display:grid;grid-template-columns:110px 1fr;gap:4px 10px;margin:0}.n8n-summary dt{opacity:.65;font-size:.85em}.n8n-summary dd{margin:0;word-break:break-word}.raw-json-details{margin-top:8px}.instruction{margin:7px 0}.instruction-btn{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:1px solid transparent;border-radius:8px;padding:8px 10px;background:transparent;color:inherit;cursor:pointer}.instruction-btn:hover{border-color:rgba(32,128,240,.35);background:rgba(32,128,240,.08)}.instruction-body{white-space:pre-wrap;word-break:break-word;margin:0;padding:12px;border-radius:8px;background:rgba(128,128,128,.08);max-height:60vh;overflow:auto}.annotated{white-space:pre-wrap;line-height:1.75;padding:14px;background:rgba(128,128,128,.08);border-radius:8px}.annotated-span{border-bottom:3px solid;cursor:help}.comment{border:1px solid rgba(128,128,128,.25);border-radius:8px;padding:10px;margin:10px 0}.comment.resolved{opacity:.6}.comment blockquote{margin:7px 0;padding-left:8px;border-left:3px solid #f0a020}.reply{margin:5px 0 5px 12px;padding:6px;background:rgba(128,128,128,.1);border-radius:5px}.version{margin:7px 0}.compare{display:grid;grid-template-columns:1fr 1fr;gap:16px}.compare>div{border:1px solid rgba(128,128,128,.25);padding:14px;border-radius:8px}.compare pre,details pre{white-space:pre-wrap;word-break:break-word}.create-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.muted{opacity:.55;font-size:.8em}:deep(.picker-row-selected td){background:rgba(32,128,240,.12)!important}@media(max-width:1100px){.workspace{grid-template-columns:1fr;height:auto}.filters{grid-template-columns:1fr 1fr}.compare{grid-template-columns:1fr}}@media(max-width:680px){.filters,.create-grid{grid-template-columns:1fr}}</style>
