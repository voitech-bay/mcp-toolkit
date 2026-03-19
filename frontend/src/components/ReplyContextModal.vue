<script setup lang="ts">
import { ref, computed, watch, h } from "vue";
import {
  NModal, NRadio, NRadioGroup, NSelect, NTreeSelect, NButton, NSpace,
  NSpin, NTooltip, NTag, useMessage,
} from "naive-ui";
import type { TreeSelectOption } from "naive-ui";
import { useDebounceFn } from "@vueuse/core";
import { mergeConversationsForBuildContext } from "../lib/conversationBuildContext";

const props = defineProps<{
  show: boolean;
  projectId: string | null;
  contact: Record<string, unknown> | null;
  contactCompanyId: string | null;
  contactCompanyName: string | null;
  hypotheses: Array<{ id: string; name: string }>;
  companyProjectCompanyId?: string | null;
  relatedContacts: Array<{
    uuid: string;
    first_name: string | null;
    last_name: string | null;
    name: string | null;
    position: string | null;
    company_id: string | null;
    conversations: Array<{ conversationUuid: string; messageCount: number; lastMessageAt: string | null }>;
  }>;
}>();

const emit = defineEmits<{
  (e: "update:show", v: boolean): void;
  (e: "built", contextText: string): void;
}>();

const message = useMessage();

type ReplyMode = "company" | "hypothesis" | "custom";
const mode = ref<ReplyMode>("company");

const allHypotheses = ref<Array<{ id: string; name: string }>>([]);
const hypothesisSelectLoading = ref(false);
const selectedHypothesisId = ref<string | null>(null);

const canUseHypothesisContext = computed(() => props.hypotheses.length > 0);

// Custom mode: allow picking which company to build context for
const customCompanyId = ref<string | null>(props.contactCompanyId);
const customCompanyProjectCompanyId = ref<string | null>(props.companyProjectCompanyId ?? null);
const customRelatedContacts = ref(props.relatedContacts);
const customHypotheses = ref(props.hypotheses);
const customCanUseHypothesisContext = computed(() => customHypotheses.value.length > 0);

// Used to fully remount NTreeSelect when the custom company changes
const customTreeKey = ref(0);

// Company picker (project companies list)
const customCompanySearch = ref("");
const customCompanyOptions = ref<Array<{ label: string; value: string }>>([]);
const customCompanyLoading = ref(false);

const debouncedSearchCustomCompanies = useDebounceFn(async () => {
  if (!props.projectId) return;
  const q = customCompanySearch.value.trim();
  customCompanyLoading.value = true;
  try {
    const params = new URLSearchParams({ projectId: props.projectId, limit: "20" });
    if (q) params.set("search", q);
    const r = await fetch(`/api/project-companies?${params.toString()}`);
    const j = await r.json();
    const rows = (j.data ?? []) as Array<{
      project_company_id: string;
      company_id: string;
      name: string | null;
      domain: string | null;
    }>;
    customCompanyOptions.value = rows.map((c) => ({
      value: c.company_id,
      label: c.name ? `${c.name}${c.domain ? ` (${c.domain})` : ""}` : c.domain ?? c.company_id,
    }));
  } catch {
    customCompanyOptions.value = [];
  } finally {
    customCompanyLoading.value = false;
  }
}, 250);

watch(customCompanySearch, () => debouncedSearchCustomCompanies());

const projectsById = ref<Record<string, string>>({});
const projectsLoading = ref(false);

watch(() => props.show, (open) => {
  if (!open) return;
  mode.value = "company";
  selectedHypothesisId.value = null;
  customCheckedKeys.value = [];
  payloadByKey.clear();
  customCompanyId.value = props.contactCompanyId;
  customCompanyProjectCompanyId.value = props.companyProjectCompanyId ?? null;
  customRelatedContacts.value = props.relatedContacts;
  customHypotheses.value = props.hypotheses;
  customTreeKey.value++;
  initTreeRoots();
  if (props.hypotheses.length === 1) selectedHypothesisId.value = props.hypotheses[0].id;
  if (props.projectId) void loadAllHypotheses();
  void loadProjects();
});

watch(canUseHypothesisContext, (ok) => {
  if (!ok && mode.value === "hypothesis") mode.value = "company";
});

watch(mode, (m) => {
  if (m !== "custom") return;
  if (!props.projectId) return;
  if (customCompanyOptions.value.length > 0) return;
  customCompanySearch.value = "";
  void debouncedSearchCustomCompanies();
});

async function loadProjects() {
  if (projectsLoading.value) return;
  projectsLoading.value = true;
  try {
    const r = await fetch("/api/projects");
    const j = await r.json();
    const rows = (j.data ?? []) as Array<{ id: string; name: string | null }>;
    const map: Record<string, string> = {};
    for (const p of rows) {
      if (p?.id && p?.name) map[p.id] = p.name;
    }
    projectsById.value = map;
  } catch {
    projectsById.value = {};
  } finally {
    projectsLoading.value = false;
  }
}

async function loadAllHypotheses() {
  if (!props.projectId) return;
  hypothesisSelectLoading.value = true;
  try {
    const r = await fetch(`/api/hypotheses?projectId=${encodeURIComponent(props.projectId)}`);
    const j = await r.json();
    allHypotheses.value = (j.data ?? []) as Array<{ id: string; name: string }>;
    if (allHypotheses.value.length === 1) selectedHypothesisId.value = allHypotheses.value[0].id;
  } catch { allHypotheses.value = []; }
  finally { hypothesisSelectLoading.value = false; }
}

const hypothesisSelectOptions = computed(() =>
  allHypotheses.value.map((h) => ({ label: h.name, value: h.id }))
);

// ── Build payload types ───────────────────────────────────────────────────────

interface BuildHypothesis { type: "hypothesis"; nodeId: string; entityId: string; name: string; description: string | null }
interface BuildCompany { type: "company"; nodeId: string; entityId: string | null; projectCompanyId: string; parentHypothesisNodeId: string | null; name: string | null; domain: string | null }
interface BuildContact { type: "contact"; nodeId: string; entityId: string | null; parentCompanyNodeId: string | null; firstName: string | null; lastName: string | null; position: string | null }
interface BuildConversation { type: "conversation"; nodeId: string; entityId: string; parentContactNodeId: string; messageCount: number; latestMessageText: string | null; latestMessageDate: string | null }
type BuildPayload = BuildHypothesis | BuildCompany | BuildContact | BuildConversation;

const payloadByKey = new Map<string, BuildPayload>();

// ── Tree state ────────────────────────────────────────────────────────────────

const customTreeOptions = ref<TreeSelectOption[]>([]);
const customCheckedKeys = ref<Array<string | number>>([]);

function initTreeRoots() {
  customTreeOptions.value = [
    ...(customCanUseHypothesisContext.value ? [{ key: "root-hyp", label: "Hypotheses", isLeaf: false }] : []),
    ...(customCompanyId.value && customCompanyProjectCompanyId.value
      ? [{ key: "root-company", label: "Company contacts & conversations", isLeaf: false }]
      : []),
    ...(customRelatedContacts.value.length > 0 ? [{ key: "root-related", label: "Related contacts", isLeaf: false }] : []),
  ];
}

async function onCustomCompanySelected(companyId: string | null) {
  // Reset selection/payload because the tree structure depends on the chosen company.
  customCheckedKeys.value = [];
  payloadByKey.clear();

  if (!props.projectId || !companyId) {
    customCompanyId.value = null;
    customCompanyProjectCompanyId.value = null;
    customHypotheses.value = [];
    customRelatedContacts.value = [];
    initTreeRoots();
    customTreeKey.value++;
    return;
  }

  try {
    const hypR = await fetch(
      `/api/companies/${encodeURIComponent(companyId)}/hypotheses?projectId=${encodeURIComponent(props.projectId)}`
    );
    const hypJ = await hypR.json();
    if (hypR.ok) {
      customHypotheses.value = (hypJ.data ?? []) as Array<{ id: string; name: string }>;
      customCompanyProjectCompanyId.value = hypJ.projectCompanyId ?? null;
    } else {
      customHypotheses.value = [];
      customCompanyProjectCompanyId.value = null;
    }
  } catch {
    customHypotheses.value = [];
    customCompanyProjectCompanyId.value = null;
  }

  try {
    const relR = await fetch(
      `/api/contacts/by-company?companyId=${encodeURIComponent(companyId)}&projectId=${encodeURIComponent(props.projectId)}`
    );
    const relJ = await relR.json();
    if (relR.ok) customRelatedContacts.value = (relJ.data ?? []) as typeof props.relatedContacts;
    else customRelatedContacts.value = [];
  } catch {
    customRelatedContacts.value = [];
  }

  initTreeRoots();
  customTreeKey.value++;
}

function findOption(key: string, opts: TreeSelectOption[]): TreeSelectOption | null {
  for (const o of opts) {
    if (String(o.key) === key) return o;
    if (o.children) {
      const found = findOption(key, o.children);
      if (found) return found;
    }
  }
  return null;
}

function setChildren(parentKey: string, children: TreeSelectOption[]) {
  const opt = findOption(parentKey, customTreeOptions.value);
  if (opt) {
    opt.children = children;
    customTreeOptions.value = [...customTreeOptions.value];
  }
}

function store(opts: TreeSelectOption[]) {
  for (const o of opts) {
    const b = (o as TreeSelectOption & { _build?: BuildPayload })._build;
    if (b && o.key != null) payloadByKey.set(String(o.key), b);
  }
}

function messageTime(m: Record<string, unknown>): number {
  const s = (m.sent_at ?? m.created_at) as string | undefined;
  return s ? new Date(s).getTime() : 0;
}

function messageSenderName(m: Record<string, unknown>): string {
  const candidates = [m.sender, m.sender_name, m.from_name, m.fromName];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

/** Group rows by `linkedin_conversation_uuid` (one tree node per conversation). */
function groupMessages(messages: Array<Record<string, unknown>>): Array<{
  convId: string;
  count: number;
  latestText: string | null;
  latestDate: string | null;
  latestSender: string | null;
  tooltipText: string;
  projectLabel: string | null;
}> {
  const byConv = new Map<string, Array<Record<string, unknown>>>();
  for (const m of messages) {
    const raw = m.linkedin_conversation_uuid;
    const cid = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    if (!cid) continue;
    if (!byConv.has(cid)) byConv.set(cid, []);
    byConv.get(cid)!.push(m);
  }
  const rows = Array.from(byConv.entries()).map(([convId, msgs]) => {
    const chron = [...msgs].sort((a, b) => messageTime(a) - messageTime(b));
    const latest = chron[chron.length - 1];
    const latestText = (latest?.text as string) ?? null;
    const latestRaw = (latest?.sent_at ?? latest?.created_at) as string | undefined;
    const latestDate = latestRaw ?? null;
    const latestSenderRaw = latest ? messageSenderName(latest) : "";
    const latestSender = latestSenderRaw || null;
    const projectIds = new Set<string>();
    for (const m of msgs) {
      const pid = m.project_id;
      if (typeof pid === "string" && pid.trim()) projectIds.add(pid.trim());
    }
    const projectNames = Array.from(projectIds).map((id) => projectsById.value[id] ?? id);
    const projectLabel =
      projectNames.length === 0
        ? null
        : projectNames.length === 1
          ? projectNames[0]
          : `${projectNames[0]} +${projectNames.length - 1}`;
    const parts = chron.map((m) => {
      const t = String(m.text ?? "—").trim() || "—";
      const whenRaw = (m.sent_at ?? m.created_at) as string | undefined;
      const when = whenRaw ? new Date(whenRaw).toLocaleString() : "";
      const dir = String(m.type ?? m.linkedin_type ?? "").toLowerCase();
      const tag = dir.includes("out") ? "Out" : dir.includes("in") ? "In" : "";
      const sender = messageSenderName(m);
      const head = [tag, sender || null, when].filter(Boolean).join(" · ");
      return head ? `${head}\n${t}` : t;
    });
    const tooltipText = parts.join("\n\n────────\n\n");
    return { convId, count: msgs.length, latestText, latestDate, latestSender, tooltipText, projectLabel };
  });
  rows.sort((a, b) => {
    const ta = a.latestDate ? new Date(a.latestDate).getTime() : 0;
    const tb = b.latestDate ? new Date(b.latestDate).getTime() : 0;
    return tb - ta;
  });
  return rows;
}

type ConvGroupRow = ReturnType<typeof groupMessages>[number];

function convOpts(groups: ConvGroupRow[], parentContactKey: string): TreeSelectOption[] {
  return groups.map((g) => {
    const n = g.count;
    const msgWord = n === 1 ? "message" : "messages";
    const senderSuffix = g.latestSender ? ` · ${g.latestSender}` : "";
    return {
      key: `conv-${g.convId}-${parentContactKey}`,
      label: `Conversation (${n} ${msgWord})${senderSuffix}`,
      isLeaf: true,
      _conversationTooltip: g.tooltipText,
      _projectLabel: g.projectLabel,
      _build: {
        type: "conversation" as const,
        nodeId: `conv-${g.convId}`,
        entityId: g.convId,
        parentContactNodeId: parentContactKey,
        messageCount: g.count,
        latestMessageText: g.latestText,
        latestMessageDate: g.latestDate,
      },
    };
  });
}

function renderTreeLabel(info: { option: TreeSelectOption; checked: boolean; selected: boolean }) {
  const opt = info.option as TreeSelectOption & { _conversationTooltip?: string; _projectLabel?: string | null };
  const label = String(opt.label ?? "");
  if (opt._conversationTooltip) {
    const tagVNode = opt._projectLabel
      ? h(
        NTag,
        { size: "small", bordered: false, type: "info", style: "margin-left:8px;transform:translateY(-1px)" },
        { default: () => opt._projectLabel }
      )
      : null;
    return h(
      NTooltip,
      {
        placement: "right-start",
        showArrow: true,
        style: { maxWidth: "min(480px, 90vw)" },
        scrollable: true,
      },
      {
        trigger: () =>
          h("span", { style: { display: "inline-flex", alignItems: "center", gap: "0px" } }, [
            h(
              "span",
              {
                style: { cursor: "help", borderBottom: "1px dotted var(--n-text-color-3, #999)" },
              },
              label
            ),
            ...(tagVNode ? [tagVNode] : []),
          ]),
        default: () =>
          h(
            "div",
            {
              style: {
                maxHeight: "360px",
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                fontSize: "12px",
                lineHeight: "1.45",
                textAlign: "left",
              },
            },
            opt._conversationTooltip
          ),
      }
    );
  }
  return label;
}

// on-load: naive-ui calls this when a non-leaf node is expanded and has no children yet.
// We fetch data, build children options, and set them on the parent.
async function handleLoad(option: TreeSelectOption): Promise<void> {
  const key = String(option.key ?? "");

  if (key === "root-hyp") {
    if (!props.projectId) { option.children = []; return; }
    const r = await fetch(`/api/hypotheses?projectId=${encodeURIComponent(props.projectId)}`);
    const j = await r.json();
    const list = (j.data ?? []) as Array<{ id: string; name: string; description?: string | null }>;
    const children: TreeSelectOption[] = list.map((h) => ({
      key: `hyp-${h.id}`,
      label: h.name,
      isLeaf: false,
      _build: { type: "hypothesis" as const, nodeId: `hyp-${h.id}`, entityId: h.id, name: h.name, description: h.description ?? null },
    }));
    store(children);
    setChildren(key, children);
    return;
  }

  if (key.startsWith("hyp-")) {
    const hypId = key.slice(4);
    const r = await fetch(`/api/hypotheses/${encodeURIComponent(hypId)}/targets`);
    const j = await r.json();
    const targets = (j.data ?? []) as Array<{ project_company_id: string; company_id: string | null; name: string | null; domain: string | null }>;
    const children: TreeSelectOption[] = targets.filter((t) => t.company_id).map((t) => ({
      key: `co-${t.project_company_id}`,
      label: t.name ?? t.domain ?? "Company",
      isLeaf: false,
      _build: {
        type: "company" as const,
        nodeId: `co-${t.project_company_id}`,
        entityId: t.company_id,
        projectCompanyId: t.project_company_id,
        parentHypothesisNodeId: key,
        name: t.name,
        domain: t.domain,
      },
    }));
    store(children);
    setChildren(key, children);
    return;
  }

  if (key.startsWith("co-")) {
    const companyId = (option as TreeSelectOption & { _build?: BuildCompany })._build?.entityId ?? null;
    if (!companyId || !props.projectId) { setChildren(key, []); return; }
    const r = await fetch(`/api/contacts/by-company?companyId=${encodeURIComponent(companyId)}&projectId=${encodeURIComponent(props.projectId)}`);
    const j = await r.json();
    const contacts = (j.data ?? []) as Array<{ uuid: string; first_name: string | null; last_name: string | null; position: string | null }>;
    const children: TreeSelectOption[] = contacts.map((c) => ({
      key: `ct-${c.uuid}`,
      label: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Contact",
      isLeaf: false,
      _build: { type: "contact" as const, nodeId: `ct-${c.uuid}`, entityId: c.uuid, parentCompanyNodeId: key, firstName: c.first_name, lastName: c.last_name, position: c.position },
    }));
    store(children);
    setChildren(key, children);
    return;
  }

  // Contact under hypothesis/company tree — load conversations
  if (key.startsWith("ct-") && !key.startsWith("ct-related-") && !key.startsWith("ct-co-")) {
    const contactUuid = key.slice(3);
    const r = await fetch(`/api/conversation?leadUuid=${encodeURIComponent(contactUuid)}&limit=500`);
    const j = await r.json();
    const groups = groupMessages((j.messages ?? []) as Array<Record<string, unknown>>);
    const children = convOpts(groups, key);
    store(children);
    setChildren(key, children);
    return;
  }

  if (key === "root-related") {
    const children: TreeSelectOption[] = customRelatedContacts.value.map((c) => ({
      key: `ct-related-${c.uuid}`,
      label: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Contact",
      isLeaf: true,
      _build: { type: "contact" as const, nodeId: `ct-related-${c.uuid}`, entityId: c.uuid, parentCompanyNodeId: null, firstName: c.first_name, lastName: c.last_name, position: c.position },
    }));
    store(children);
    setChildren(key, children);
    return;
  }

  if (key === "root-company") {
    const companyId = customCompanyId.value;
    const pcId = customCompanyProjectCompanyId.value;
    if (!companyId || !props.projectId || !pcId) { setChildren(key, []); return; }
    const [companyRes, contactsRes] = await Promise.all([
      fetch(`/api/companies/by-ids?ids=${encodeURIComponent(companyId)}`),
      fetch(`/api/contacts/by-company?companyId=${encodeURIComponent(companyId)}&projectId=${encodeURIComponent(props.projectId)}`),
    ]);
    const companyData = (await companyRes.json()).data as Array<{ id: string; name: string | null; domain: string | null }> | undefined;
    const companyInfo = companyData?.[0];
    payloadByKey.set(`co-${companyId}`, {
      type: "company", nodeId: `co-${companyId}`, entityId: companyId, projectCompanyId: pcId,
      parentHypothesisNodeId: null, name: companyInfo?.name ?? null, domain: companyInfo?.domain ?? null,
    });
    const j = await contactsRes.json();
    const contacts = (j.data ?? []) as Array<{ uuid: string; first_name: string | null; last_name: string | null; position: string | null }>;
    const children: TreeSelectOption[] = contacts.map((c) => ({
      key: `ct-co-${c.uuid}`,
      label: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Contact",
      isLeaf: false,
      _build: { type: "contact" as const, nodeId: `ct-co-${c.uuid}`, entityId: c.uuid, parentCompanyNodeId: `co-${companyId}`, firstName: c.first_name, lastName: c.last_name, position: c.position },
    }));
    store(children);
    setChildren(key, children);
    return;
  }

  if (key.startsWith("ct-co-")) {
    const contactUuid = key.slice(6);
    const r = await fetch(`/api/conversation?leadUuid=${encodeURIComponent(contactUuid)}&limit=500`);
    const j = await r.json();
    const groups = groupMessages((j.messages ?? []) as Array<Record<string, unknown>>);
    const children = convOpts(groups, key);
    store(children);
    setChildren(key, children);
    return;
  }

  setChildren(key, []);
}

// ── Open in Cursor / copy context ───────────────────────────────────────────

const buildLoading = ref(false);

function collectCheckedPayloads(): BuildPayload[] {
  const checkedSet = new Set(customCheckedKeys.value.map(String));
  const payloads: BuildPayload[] = [];
  const seen = new Set<string>();
  for (const [k, b] of payloadByKey.entries()) {
    if (!checkedSet.has(k)) continue;
    if (seen.has(b.nodeId)) continue;
    seen.add(b.nodeId);
    payloads.push(b);
    if (b.type === "contact" && b.parentCompanyNodeId) {
      const parent = payloadByKey.get(b.parentCompanyNodeId);
      if (parent && parent.type === "company" && !seen.has(parent.nodeId)) {
        payloads.push(parent);
        seen.add(parent.nodeId);
      }
    }
  }
  return payloads;
}

function conversationPayloadsForMerge(conversations: BuildConversation[]) {
  return conversations.map((c) => ({
    nodeId: c.nodeId,
    entityId: c.entityId,
    parentContactNodeId: c.parentContactNodeId,
    messageCount: c.messageCount,
    latestMessageText: c.latestMessageText,
    latestMessageDate: c.latestMessageDate,
  }));
}

async function withMergedConversations(
  hypotheses: BuildHypothesis[],
  companies: BuildCompany[],
  contacts: BuildContact[],
  conversations: BuildConversation[]
): Promise<{
  hypotheses: BuildHypothesis[];
  companies: BuildCompany[];
  contacts: BuildContact[];
  conversations: BuildConversation[];
}> {
  const merged = await mergeConversationsForBuildContext(
    contacts,
    conversationPayloadsForMerge(conversations)
  );
  const conversationsOut: BuildConversation[] = merged.map((c) => ({
    type: "conversation",
    nodeId: c.nodeId,
    entityId: c.entityId,
    parentContactNodeId: c.parentContactNodeId,
    messageCount: c.messageCount,
    latestMessageText: c.latestMessageText,
    latestMessageDate: c.latestMessageDate,
  }));
  return { hypotheses, companies, contacts, conversations: conversationsOut };
}

async function buildSelectedNodes(): Promise<{
  hypotheses: BuildHypothesis[];
  companies: BuildCompany[];
  contacts: BuildContact[];
  conversations: BuildConversation[];
}> {
  const hypotheses: BuildHypothesis[] = [];
  const companies: BuildCompany[] = [];
  const contacts: BuildContact[] = [];
  const conversations: BuildConversation[] = [];

  const projectId = props.projectId;
  const companyId = props.contactCompanyId;
  const projectCompanyId = props.companyProjectCompanyId;

  if (mode.value === "company" && companyId && projectId && projectCompanyId) {
    companies.push({ type: "company", nodeId: `co-${companyId}`, entityId: companyId, projectCompanyId, parentHypothesisNodeId: null, name: props.contactCompanyName, domain: null });
    const r = await fetch(`/api/contacts/by-company?companyId=${encodeURIComponent(companyId)}&projectId=${encodeURIComponent(projectId)}`);
    const j = await r.json();
    for (const c of (j.data ?? []) as Array<{ uuid: string; first_name: string | null; last_name: string | null; position: string | null }>) {
      contacts.push({ type: "contact", nodeId: `ct-${c.uuid}`, entityId: c.uuid, parentCompanyNodeId: `co-${companyId}`, firstName: c.first_name, lastName: c.last_name, position: c.position });
    }
    return withMergedConversations(hypotheses, companies, contacts, conversations);
  }

  if (mode.value === "hypothesis" && selectedHypothesisId.value && companyId && projectId && projectCompanyId) {
    const hyp = allHypotheses.value.find((h) => h.id === selectedHypothesisId.value);
    if (hyp) {
      hypotheses.push({ type: "hypothesis", nodeId: `hyp-${hyp.id}`, entityId: hyp.id, name: hyp.name, description: null });
      companies.push({ type: "company", nodeId: `co-${companyId}`, entityId: companyId, projectCompanyId, parentHypothesisNodeId: `hyp-${hyp.id}`, name: null, domain: null });
      const r = await fetch(`/api/contacts/by-company?companyId=${encodeURIComponent(companyId)}&projectId=${encodeURIComponent(projectId)}`);
      const j = await r.json();
      for (const c of (j.data ?? []) as Array<{ uuid: string; first_name: string | null; last_name: string | null; position: string | null }>) {
        contacts.push({ type: "contact", nodeId: `ct-${c.uuid}`, entityId: c.uuid, parentCompanyNodeId: `co-${companyId}`, firstName: c.first_name, lastName: c.last_name, position: c.position });
      }
    }
    return withMergedConversations(hypotheses, companies, contacts, conversations);
  }

  if (mode.value === "custom") {
    for (const p of collectCheckedPayloads()) {
      if (p.type === "hypothesis") hypotheses.push(p);
      else if (p.type === "company") companies.push(p);
      else if (p.type === "contact") contacts.push(p);
      else if (p.type === "conversation") conversations.push(p);
    }
  }
  return withMergedConversations(hypotheses, companies, contacts, conversations);
}

/** Short deeplink: context is built via API first; MCP loads full prompt by snapshot UUID. */
function buildSnapshotCursorInstruction(snapshotId: string): string {
  const argsJson = JSON.stringify({ snapshotId });
  return [
    "Use the MCP toolkit tool get_reply_context_snapshot with these exact arguments (parse the following line as JSON):",
    argsJson,
    "",
    "Use the returned text as your full reply-agent instructions. Then produce exactly 3 LinkedIn reply variants.",
    "Output only the variants (no preamble).",
  ].join("\n");
}

/** Build context on the server first, then open Cursor with a short prompt that references only the snapshot id. */
async function openInCursor() {
  const projectId = props.projectId;
  if (!projectId) { message.warning("No project selected."); return; }
  const nodes = await buildSelectedNodes();
  const total = nodes.hypotheses.length + nodes.companies.length + nodes.contacts.length + nodes.conversations.length;
  if (total === 0) { message.warning("Select at least one context option."); return; }

  buildLoading.value = true;
  try {
    const res = await fetch("/api/build-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, selectedNodes: nodes }),
    });
    const json = (await res.json()) as { data?: { id: string }; error?: string };
    if (!res.ok || json.error || !json.data?.id) {
      message.error(json.error ?? "Could not build context for Cursor.");
      return;
    }

    const instruction = buildSnapshotCursorInstruction(json.data.id);
    const url = `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(instruction)}`;
    window.location.href = url;
    message.success("Context saved — opening Cursor…");
    emit("update:show", false);
  } catch {
    message.error("Network error.");
  } finally {
    buildLoading.value = false;
  }
}

/** Fallback: build on server and copy full prompt via parent handler. */
async function copyContextToClipboard() {
  const projectId = props.projectId;
  if (!projectId) { message.warning("No project selected."); return; }
  const nodes = await buildSelectedNodes();
  const total = nodes.hypotheses.length + nodes.companies.length + nodes.contacts.length + nodes.conversations.length;
  if (total === 0) { message.warning("Select at least one context option."); return; }
  buildLoading.value = true;
  try {
    const res = await fetch("/api/build-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, selectedNodes: nodes }),
    });
    const json = (await res.json()) as { data?: { context_text: string }; error?: string };
    if (!res.ok || json.error) { message.error(json.error ?? "Failed to build context."); return; }
    emit("built", json.data?.context_text ?? "");
    emit("update:show", false);
  } catch { message.error("Network error."); }
  finally { buildLoading.value = false; }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="Start reply — context"
    style="width: 560px"
    @update:show="emit('update:show', $event)"
  >
    <NRadioGroup v-model:value="mode" name="reply-mode">
      <NSpace vertical>
        <NRadio value="company">Include company context</NRadio>
        <NRadio v-if="canUseHypothesisContext" value="hypothesis">Include hypothesis + company context</NRadio>
        <NRadio value="custom">Custom</NRadio>
      </NSpace>
    </NRadioGroup>

    <div v-if="mode === 'hypothesis'" style="margin-top: 12px; margin-left: 22px">
      <NSpin :show="hypothesisSelectLoading">
        <NSelect
          v-model:value="selectedHypothesisId"
          :options="hypothesisSelectOptions"
          placeholder="Select hypothesis…"
          style="width: 100%; max-width: 280px"
          clearable
        />
      </NSpin>
    </div>

    <div v-if="mode === 'custom'" style="margin-top: 16px">
      <div style="display:flex; gap: 12px; align-items:center; margin-bottom: 10px">
        <span style="font-size: 13px; opacity: 0.9; white-space: nowrap">Company</span>
        <NSelect
          v-model:value="customCompanyId"
          :options="customCompanyOptions"
          :loading="customCompanyLoading"
          filterable
          remote
          clearable
          placeholder="Pick a company…"
          style="width: 100%"
          :disabled="!props.projectId"
          @search="(q: string) => { customCompanySearch = q; }"
          @update:value="onCustomCompanySelected"
        />
      </div>
      <div style="margin-bottom: 8px; font-size: 13px; opacity: 0.9">
        Select nodes to include (expand to load children):
      </div>
      <NTreeSelect
        :key="customTreeKey"
        v-model:value="customCheckedKeys"
        :options="customTreeOptions"
        :on-load="handleLoad"
        :render-label="renderTreeLabel"
        checkable
        cascade
        check-strategy="all"
        placeholder="Expand and check…"
        style="width: 100%"
        multiple
      />
    </div>

    <NSpace justify="end" style="margin-top: 20px" wrap>
      <NButton @click="emit('update:show', false)">Cancel</NButton>
      <NButton quaternary :loading="buildLoading" @click="copyContextToClipboard">
        Copy context
      </NButton>
      <NButton type="primary" :loading="buildLoading" @click="openInCursor">
        Open in Cursor
      </NButton>
    </NSpace>
  </NModal>
</template>
