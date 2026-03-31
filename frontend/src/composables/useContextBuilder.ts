import { ref, computed } from "vue";
import type { InjectionKey } from "vue";
import type { Node, Edge } from "@vue-flow/core";
import { useProjectStore } from "../stores/project";
import {
  fetchConversationGroupsForLead,
  type ConversationGroup,
} from "../lib/conversationBuildContext";

// ── Node data shapes ──────────────────────────────────────────────────────────

export interface CenterNodeData {
  nodeType: "center";
  /** Total nodes excluding the center node */
  sourceCount: number;
  hypothesisCount: number;
  companyCount: number;
  contactCount: number;
  conversationCount: number;
  /** Nodes (companies/contacts) that have at least one saved custom context */
  customContextCount: number;
}

export interface HypothesisNodeData {
  nodeType: "hypothesis";
  entityId: string;
  name: string;
  description: string | null;
}

export interface CompanyNodeData {
  nodeType: "company";
  entityId: string;
  projectCompanyId: string;
  parentHypothesisNodeId: string | null;
  name: string | null;
  domain: string | null;
}

export interface ContactNodeData {
  nodeType: "contact";
  entityId: string | null; // contact uuid (Contacts.uuid) for context lookup
  parentCompanyNodeId: string | null;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
}

export interface ConversationNodeData {
  nodeType: "conversation";
  entityId: string; // linkedin_conversation_uuid
  parentContactNodeId: string;
  messageCount: number;
  latestMessageText: string | null;
  latestMessageDate: string | null;
}

export type ContextNodeData =
  | CenterNodeData
  | HypothesisNodeData
  | CompanyNodeData
  | ContactNodeData
  | ConversationNodeData;

// ── Internal graph state types ────────────────────────────────────────────────

export interface GraphHypothesis {
  nodeId: string;
  entityId: string;
  name: string;
  description: string | null;
}

export interface GraphCompany {
  nodeId: string;
  entityId: string;
  projectCompanyId: string;
  parentHypothesisNodeId: string | null;
  name: string | null;
  domain: string | null;
}

export interface GraphContact {
  nodeId: string;
  entityId: string | null; // contact uuid for context API
  parentCompanyNodeId: string | null;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
}

export interface GraphConversation {
  nodeId: string;
  entityId: string; // linkedin_conversation_uuid
  parentContactNodeId: string;
  messageCount: number;
  latestMessageText: string | null;
  latestMessageDate: string | null;
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface HypothesisListItem {
  id: string;
  name: string;
  description: string | null;
  target_persona: string | null;
  target_count: number;
}

export interface ProjectCompanyListItem {
  project_company_id: string;
  company_id: string;
  name: string | null;
  domain: string | null;
  /** Tag values from companies.tags */
  tags?: string[];
  contacts_preview: Array<{
    first_name: string | null;
    last_name: string | null;
    position: string | null;
  }>;
}

export interface ContactListItem {
  id?: string;
  uuid?: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  company_id?: string;
  project_id?: string | null;
}

export type { ConversationGroup };

export interface HypothesisTargetRow {
  id: string;
  project_company_id: string;
  score: number | null;
  company_id: string | null;
  name: string | null;
  domain: string | null;
  linkedin: string | null;
  status: string | null;
}

// ── Layout constants ──────────────────────────────────────────────────────────

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;
const GAP_X = 48;
const GAP_Y = 100;
const CENTER_ID = "center";

// ── ID counter (module-scoped, resets on HMR which is fine) ──────────────────

let _idCounter = 1;
function nextId(prefix: string): string {
  return `${prefix}-${_idCounter++}`;
}

// ── Composable ────────────────────────────────────────────────────────────────

export function useContextBuilder() {
  const projectStore = useProjectStore();

  // Reactive graph state
  const hypotheses = ref<GraphHypothesis[]>([]);
  const companies = ref<GraphCompany[]>([]);
  const contacts = ref<GraphContact[]>([]);
  const conversations = ref<GraphConversation[]>([]);

  // Selection state (store as array for easy serialization / Vue reactivity)
  const selectedNodeIds = ref<string[]>([]);

  const selectedNodeIdSet = computed(() => new Set(selectedNodeIds.value));

  function isSelected(nodeId: string): boolean {
    return selectedNodeIdSet.value.has(nodeId);
  }

  function setSelected(nodeId: string, selected: boolean): void {
    const set = new Set(selectedNodeIds.value);
    if (selected) set.add(nodeId);
    else set.delete(nodeId);
    selectedNodeIds.value = Array.from(set);
  }

  function toggleSelected(nodeId: string): void {
    setSelected(nodeId, !isSelected(nodeId));
  }

  function clearSelection(): void {
    selectedNodeIds.value = [];
  }

  function selectAllNodes(): void {
    selectedNodeIds.value = [
      ...hypotheses.value.map((h) => h.nodeId),
      ...companies.value.map((c) => c.nodeId),
      ...contacts.value.map((c) => c.nodeId),
      ...conversations.value.map((cv) => cv.nodeId),
    ];
  }

  // ── Context presence cache (CompaniesContext / ContactsContext) ─────────────

  type ContextStatus = "unknown" | "loading" | "has" | "none" | "error";

  const companyContextByCompanyId = ref<Record<string, ContextStatus>>({});
  const contactContextByContactId = ref<Record<string, ContextStatus>>({});

  function hasCompanyContext(companyId: string | null | undefined): boolean {
    const id = (companyId ?? "").trim();
    if (!id) return false;
    return companyContextByCompanyId.value[id] === "has";
  }

  function hasContactContext(contactId: string | null | undefined): boolean {
    const id = (contactId ?? "").trim();
    if (!id) return false;
    return contactContextByContactId.value[id] === "has";
  }

  async function checkCompanyContext(companyId: string | null | undefined): Promise<void> {
    const id = (companyId ?? "").trim();
    if (!id) return;
    const existing = companyContextByCompanyId.value[id];
    if (existing && existing !== "unknown" && existing !== "error") return;
    companyContextByCompanyId.value = { ...companyContextByCompanyId.value, [id]: "loading" };
    try {
      const r = await fetch(`/api/company-context?company_id=${encodeURIComponent(id)}`);
      const j = (await r.json()) as { data?: Array<{ rootContext?: string | null }> | null; error?: string };
      if (!r.ok) throw new Error(j.error ?? "Failed to load company context");
      const rows = j.data ?? [];
      const has = rows.some((row) => (row.rootContext ?? "").trim().length > 0);
      companyContextByCompanyId.value = { ...companyContextByCompanyId.value, [id]: has ? "has" : "none" };
    } catch {
      companyContextByCompanyId.value = { ...companyContextByCompanyId.value, [id]: "error" };
    }
  }

  async function checkContactContext(contactId: string | null | undefined): Promise<void> {
    const id = (contactId ?? "").trim();
    if (!id) return;
    const existing = contactContextByContactId.value[id];
    if (existing && existing !== "unknown" && existing !== "error") return;
    contactContextByContactId.value = { ...contactContextByContactId.value, [id]: "loading" };
    try {
      const r = await fetch(`/api/contact-context?contact_id=${encodeURIComponent(id)}`);
      const j = (await r.json()) as { data?: Array<{ rootContext?: string | null }> | null; error?: string };
      if (!r.ok) throw new Error(j.error ?? "Failed to load contact context");
      const rows = j.data ?? [];
      const has = rows.some((row) => (row.rootContext ?? "").trim().length > 0);
      contactContextByContactId.value = { ...contactContextByContactId.value, [id]: has ? "has" : "none" };
    } catch {
      contactContextByContactId.value = { ...contactContextByContactId.value, [id]: "error" };
    }
  }

  // ── API helpers ─────────────────────────────────────────────────────────────

  async function fetchHypothesesList(): Promise<HypothesisListItem[]> {
    const projectId = projectStore.selectedProjectId;
    if (!projectId) return [];
    const r = await fetch(`/api/hypotheses?projectId=${encodeURIComponent(projectId)}`);
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: HypothesisListItem[] };
    return j.data ?? [];
  }

  async function fetchProjectCompaniesList(): Promise<ProjectCompanyListItem[]> {
    const projectId = projectStore.selectedProjectId;
    if (!projectId) return [];
    const r = await fetch(
      `/api/project-companies?projectId=${encodeURIComponent(projectId)}&limit=100`
    );
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: ProjectCompanyListItem[] };
    return j.data ?? [];
  }

  async function fetchContactsForCompany(companyId: string): Promise<ContactListItem[]> {
    const filters = JSON.stringify({ company_id: companyId });
    const r = await fetch(
      `/api/supabase-table-query?table=contacts&filters=${encodeURIComponent(filters)}&limit=100`
    );
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: ContactListItem[] };
    return j.data ?? [];
  }

  async function fetchProjectContactsList(options?: { search?: string; limit?: number }): Promise<ContactListItem[]> {
    const projectId = projectStore.selectedProjectId;
    if (!projectId) return [];
    const filters = JSON.stringify({ project_id: projectId });
    const limit = Math.min(Math.max(options?.limit ?? 100, 1), 100);
    const search = options?.search?.trim() ?? "";
    const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
    const r = await fetch(
      `/api/supabase-table-query?table=contacts&filters=${encodeURIComponent(filters)}&limit=${limit}${searchParam}`
    );
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: ContactListItem[] };
    return j.data ?? [];
  }

  async function fetchHypothesisTargets(hypothesisId: string): Promise<HypothesisTargetRow[]> {
    const r = await fetch(`/api/hypotheses/${encodeURIComponent(hypothesisId)}/targets`);
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: HypothesisTargetRow[] };
    return j.data ?? [];
  }

  async function fetchConversationsForContact(contactUuid: string): Promise<ConversationGroup[]> {
    return fetchConversationGroupsForLead(contactUuid);
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  /** Add a hypothesis to the graph. No-op if it's already present. */
  function addHypothesis(item: Pick<HypothesisListItem, "id" | "name" | "description">): string {
    const existing = hypotheses.value.find((h) => h.entityId === item.id);
    if (existing) return existing.nodeId;
    const nodeId = nextId("hyp");
    hypotheses.value = [
      ...hypotheses.value,
      { nodeId, entityId: item.id, name: item.name, description: item.description },
    ];
    setSelected(nodeId, true);
    return nodeId;
  }

  /**
   * Add a company to the graph.
   * `parentHypothesisNodeId` is the graph node ID of the parent hypothesis, or null for a direct
   * company (left zone). No-op if the same project_company_id is already under the same parent.
   */
  function addCompany(
    item: Pick<ProjectCompanyListItem, "project_company_id" | "company_id" | "name" | "domain">,
    parentHypothesisNodeId: string | null
  ): string {
    const existing = companies.value.find(
      (c) =>
        c.projectCompanyId === item.project_company_id &&
        c.parentHypothesisNodeId === parentHypothesisNodeId
    );
    if (existing) return existing.nodeId;
    const nodeId = nextId("co");
    companies.value = [
      ...companies.value,
      {
        nodeId,
        entityId: item.company_id,
        projectCompanyId: item.project_company_id,
        parentHypothesisNodeId,
        name: item.name,
        domain: item.domain,
      },
    ];
    void checkCompanyContext(item.company_id);
    setSelected(nodeId, true);
    return nodeId;
  }

  /**
   * Add a contact to the graph.
   * `parentCompanyNodeId` is the graph node ID of the parent company, or null for a direct contact
   * (right zone). Contacts are always added as new nodes (no dedup — same person can appear
   * under multiple companies or as a direct contact). Pass id or uuid in item for context lookup.
   */
  function addContact(
    item: Pick<ContactListItem, "first_name" | "last_name" | "position" | "id" | "uuid">,
    parentCompanyNodeId: string | null
  ): string {
    const nodeId = nextId("ct");
    const entityId = (item.id ?? item.uuid) ?? null;
    contacts.value = [
      ...contacts.value,
      {
        nodeId,
        entityId,
        parentCompanyNodeId,
        firstName: item.first_name,
        lastName: item.last_name,
        position: item.position,
      },
    ];
    if (entityId) void checkContactContext(entityId);
    setSelected(nodeId, true);
    return nodeId;
  }

  /**
   * Add a conversation to the graph under a given contact node.
   * Dedupes by `linkedin_conversation_uuid` + `parentContactNodeId`.
   */
  function addConversation(group: ConversationGroup, parentContactNodeId: string): string {
    const existing = conversations.value.find(
      (cv) =>
        cv.entityId === group.linkedin_conversation_uuid &&
        cv.parentContactNodeId === parentContactNodeId
    );
    if (existing) return existing.nodeId;
    const nodeId = nextId("conv");
    conversations.value = [
      ...conversations.value,
      {
        nodeId,
        entityId: group.linkedin_conversation_uuid,
        parentContactNodeId,
        messageCount: group.messageCount,
        latestMessageText: group.latestMessageText,
        latestMessageDate: group.latestMessageDate,
      },
    ];
    setSelected(nodeId, true);
    return nodeId;
  }

  /**
   * Fully expand a hypothesis: add it to the graph, then fetch and add all its
   * target companies, each company's contacts, and (optionally) each contact's conversations.
   */
  async function expandHypothesis(
    item: Pick<HypothesisListItem, "id" | "name" | "description">,
    options: { withConversations: boolean } = { withConversations: true }
  ): Promise<void> {
    const hypNodeId = addHypothesis(item);
    const targets = await fetchHypothesisTargets(item.id);

    for (const target of targets) {
      if (!target.company_id) continue;
      const coNodeId = addCompany(
        {
          project_company_id: target.project_company_id,
          company_id: target.company_id,
          name: target.name,
          domain: target.domain,
        },
        hypNodeId
      );

      const contactsList = await fetchContactsForCompany(target.company_id);
      for (const contact of contactsList) {
        const ctNodeId = addContact(contact, coNodeId);
        if (options.withConversations) {
          const contactUuid = (contact.id ?? contact.uuid) ?? null;
          if (contactUuid) {
            const convGroups = await fetchConversationsForContact(contactUuid);
            for (const group of convGroups) {
              addConversation(group, ctNodeId);
            }
          }
        }
      }
    }
  }

  /**
   * Remove a node by its graph node ID. Cascades:
   * - Removing a hypothesis removes its companies, their contacts, and conversations.
   * - Removing a company removes its contacts and their conversations.
   * - Removing a contact removes its conversations.
   */
  function removeNode(nodeId: string): void {
    const hypIdx = hypotheses.value.findIndex((h) => h.nodeId === nodeId);
    if (hypIdx !== -1) {
      const childCompanyIds = companies.value
        .filter((c) => c.parentHypothesisNodeId === nodeId)
        .map((c) => c.nodeId);
      const childContactIds = contacts.value
        .filter((ct) => ct.parentCompanyNodeId !== null && childCompanyIds.includes(ct.parentCompanyNodeId))
        .map((ct) => ct.nodeId);
      selectedNodeIds.value = selectedNodeIds.value.filter(
        (id) => id !== nodeId && !childCompanyIds.includes(id)
      );
      conversations.value = conversations.value.filter(
        (cv) => !childContactIds.includes(cv.parentContactNodeId)
      );
      contacts.value = contacts.value.filter(
        (ct) => ct.parentCompanyNodeId === null || !childCompanyIds.includes(ct.parentCompanyNodeId)
      );
      companies.value = companies.value.filter((c) => c.parentHypothesisNodeId !== nodeId);
      hypotheses.value = hypotheses.value.filter((h) => h.nodeId !== nodeId);
      return;
    }

    const coIdx = companies.value.findIndex((c) => c.nodeId === nodeId);
    if (coIdx !== -1) {
      const childContactIds = contacts.value
        .filter((ct) => ct.parentCompanyNodeId === nodeId)
        .map((ct) => ct.nodeId);
      selectedNodeIds.value = selectedNodeIds.value.filter((id) => id !== nodeId);
      conversations.value = conversations.value.filter(
        (cv) => !childContactIds.includes(cv.parentContactNodeId)
      );
      contacts.value = contacts.value.filter((ct) => ct.parentCompanyNodeId !== nodeId);
      companies.value = companies.value.filter((c) => c.nodeId !== nodeId);
      return;
    }

    const ctIdx = contacts.value.findIndex((ct) => ct.nodeId === nodeId);
    if (ctIdx !== -1) {
      selectedNodeIds.value = selectedNodeIds.value.filter((id) => id !== nodeId);
      conversations.value = conversations.value.filter((cv) => cv.parentContactNodeId !== nodeId);
      contacts.value = contacts.value.filter((ct) => ct.nodeId !== nodeId);
      return;
    }

    // Conversation node (leaf — no children)
    selectedNodeIds.value = selectedNodeIds.value.filter((id) => id !== nodeId);
    conversations.value = conversations.value.filter((cv) => cv.nodeId !== nodeId);
  }

  /** Remove all nodes from the graph. */
  function clearGraph(): void {
    hypotheses.value = [];
    companies.value = [];
    contacts.value = [];
    conversations.value = [];
    clearSelection();
    companyContextByCompanyId.value = {};
    contactContextByContactId.value = {};
  }

  // ── Layout engine ───────────────────────────────────────────────────────────

  const MAX_COLUMNS = 20;

  function gridWidth(count: number, maxCols: number): number {
    const cols = Math.min(Math.max(count, 1), maxCols);
    return cols * NODE_WIDTH + (cols - 1) * GAP_X;
  }

  function gridStartX(count: number, maxCols: number): number {
    const cols = Math.min(Math.max(count, 1), maxCols);
    const totalWidth = cols * NODE_WIDTH + (cols - 1) * GAP_X;
    return -totalWidth / 2;
  }

  function positionInGrid(
    index: number,
    baseX: number,
    baseY: number,
    maxCols: number,
    direction: "up" | "down" = "up"
  ): { x: number; y: number } {
    const col = index % maxCols;
    const row = Math.floor(index / maxCols);
    const x = baseX + col * (NODE_WIDTH + GAP_X);
    const deltaY = row * (NODE_HEIGHT + GAP_Y);
    const y = direction === "up" ? baseY - deltaY : baseY + deltaY;
    return { x, y };
  }

  /**
   * Compute Vue Flow nodes and edges from the current reactive graph state.
   *
   * Zones:
   *  - Top:   hypotheses grid above the center (max 20 columns per row)
   *  - Above: companies placed above their hypothesis (max 20 columns per row)
   *  - Above: contacts placed above their company (max 20 columns per row)
   *  - Left:  direct companies (no hypothesis parent) at X=-800, stacked vertically
   *  - Right: direct contacts (no company parent) at X=800, stacked vertically
   */
  function recalculateLayout(): {
    nodes: Node<ContextNodeData>[];
    edges: Edge[];
  } {
    const nodes: Node<ContextNodeData>[] = [];
    const edges: Edge[] = [];

    const directCompanies = companies.value.filter((c) => c.parentHypothesisNodeId === null);
    const directContacts = contacts.value.filter((ct) => ct.parentCompanyNodeId === null);

    // ── Center node ────────────────────────────────────────────────────────

    const hypothesisCount = hypotheses.value.length;
    const companyCount = companies.value.length;
    const contactCount = contacts.value.length;
    const conversationCount = conversations.value.length;
    const sourceCount = hypothesisCount + companyCount + contactCount + conversationCount;

    const customContextCount =
      companies.value.filter((c) => hasCompanyContext(c.entityId)).length +
      contacts.value.filter((c) => hasContactContext(c.entityId)).length;

    nodes.push({
      id: CENTER_ID,
      type: "center",
      position: { x: 0, y: 0 },
      data: {
        nodeType: "center",
        sourceCount,
        hypothesisCount,
        companyCount,
        contactCount,
        conversationCount,
        customContextCount,
      },
      draggable: false,
    });

    // ── Top zone: hypotheses grid ─────────────────────────────────────────

    const HYPO_BASE_Y = -260;
    const hypBaseX = gridStartX(hypotheses.value.length, MAX_COLUMNS);

    for (let i = 0; i < hypotheses.value.length; i++) {
      const hyp = hypotheses.value[i];
      const hypPos = positionInGrid(i, hypBaseX, HYPO_BASE_Y, MAX_COLUMNS, "up");

      nodes.push({
        id: hyp.nodeId,
        type: "hypothesis",
        position: hypPos,
        data: {
          nodeType: "hypothesis",
          entityId: hyp.entityId,
          name: hyp.name,
          description: hyp.description,
        },
      });

      edges.push({
        id: `e-${CENTER_ID}-${hyp.nodeId}`,
        source: CENTER_ID,
        target: hyp.nodeId,
        type: "smoothstep",
      });

      // Companies ABOVE this hypothesis (max 20 columns per row)
      const childCompanies = companies.value.filter((c) => c.parentHypothesisNodeId === hyp.nodeId);
      if (childCompanies.length > 0) {
        const coBaseX = hypPos.x - (Math.min(childCompanies.length, MAX_COLUMNS) * NODE_WIDTH + (Math.min(childCompanies.length, MAX_COLUMNS) - 1) * GAP_X) / 2;
        const coBaseY = hypPos.y - (NODE_HEIGHT + GAP_Y);
        for (let ci = 0; ci < childCompanies.length; ci++) {
          const co = childCompanies[ci];
          const coPos = positionInGrid(ci, coBaseX, coBaseY, MAX_COLUMNS, "up");

          nodes.push({
            id: co.nodeId,
            type: "company",
            position: coPos,
            data: {
              nodeType: "company",
              entityId: co.entityId,
              projectCompanyId: co.projectCompanyId,
              parentHypothesisNodeId: co.parentHypothesisNodeId,
              name: co.name,
              domain: co.domain,
            },
          });

          edges.push({
            id: `e-${hyp.nodeId}-${co.nodeId}`,
            source: hyp.nodeId,
            target: co.nodeId,
            type: "smoothstep",
          });

          // Contacts ABOVE this company (max 20 columns per row)
          const childContacts = contacts.value.filter((ct) => ct.parentCompanyNodeId === co.nodeId);
          if (childContacts.length > 0) {
            const ctBaseX = coPos.x - (Math.min(childContacts.length, MAX_COLUMNS) * NODE_WIDTH + (Math.min(childContacts.length, MAX_COLUMNS) - 1) * GAP_X) / 2;
            const ctBaseY = coPos.y - (NODE_HEIGHT + GAP_Y);
            for (let ti = 0; ti < childContacts.length; ti++) {
              const ct = childContacts[ti];
              const ctPos = positionInGrid(ti, ctBaseX, ctBaseY, MAX_COLUMNS, "up");

              nodes.push({
                id: ct.nodeId,
                type: "contact",
                position: ctPos,
                data: {
                  nodeType: "contact",
                  entityId: ct.entityId,
                  parentCompanyNodeId: ct.parentCompanyNodeId,
                  firstName: ct.firstName,
                  lastName: ct.lastName,
                  position: ct.position,
                },
              });

              edges.push({
                id: `e-${co.nodeId}-${ct.nodeId}`,
                source: co.nodeId,
                target: ct.nodeId,
                type: "smoothstep",
              });

              // Conversations ABOVE this contact
              const childConvs = conversations.value.filter(
                (cv) => cv.parentContactNodeId === ct.nodeId
              );
              if (childConvs.length > 0) {
                const convCols = Math.min(childConvs.length, MAX_COLUMNS);
                const convTotalWidth = convCols * NODE_WIDTH + (convCols - 1) * GAP_X;
                const convBaseX = ctPos.x + NODE_WIDTH / 2 - convTotalWidth / 2;
                const convBaseY = ctPos.y - (NODE_HEIGHT + GAP_Y);
                for (let cvi = 0; cvi < childConvs.length; cvi++) {
                  const conv = childConvs[cvi];
                  const convPos = positionInGrid(cvi, convBaseX, convBaseY, MAX_COLUMNS, "up");
                  nodes.push({
                    id: conv.nodeId,
                    type: "conversation",
                    position: convPos,
                    data: {
                      nodeType: "conversation",
                      entityId: conv.entityId,
                      parentContactNodeId: conv.parentContactNodeId,
                      messageCount: conv.messageCount,
                      latestMessageText: conv.latestMessageText,
                      latestMessageDate: conv.latestMessageDate,
                    },
                  });
                  edges.push({
                    id: `e-${ct.nodeId}-${conv.nodeId}`,
                    source: ct.nodeId,
                    target: conv.nodeId,
                    type: "smoothstep",
                  });
                }
              }
            }
          }
        }
      }
    }

    // ── Left zone: direct companies ────────────────────────────────────────

    const hypGridWidth = hypotheses.value.length > 0 ? gridWidth(hypotheses.value.length, MAX_COLUMNS) : 0;
    const LEFT_X = Math.min(-hypGridWidth / 2 - NODE_WIDTH - 120, -680);
    const leftYStart = -(directCompanies.length * (NODE_HEIGHT + GAP_Y) - GAP_Y) / 2;

    let leftY = leftYStart;
    for (const co of directCompanies) {
      nodes.push({
        id: co.nodeId,
        type: "company",
        position: { x: LEFT_X, y: leftY },
        data: {
          nodeType: "company",
          entityId: co.entityId,
          projectCompanyId: co.projectCompanyId,
          parentHypothesisNodeId: null,
          name: co.name,
          domain: co.domain,
        },
      });

      edges.push({
        id: `e-${CENTER_ID}-${co.nodeId}`,
        source: CENTER_ID,
        target: co.nodeId,
        type: "smoothstep",
      });

      // Contacts under this direct company, placed below it
      const directCoContacts = contacts.value.filter(
        (ct) => ct.parentCompanyNodeId === co.nodeId
      );
      for (let ci = 0; ci < directCoContacts.length; ci++) {
        const ct = directCoContacts[ci];
        const ctY = leftY + (ci + 1) * (NODE_HEIGHT + GAP_Y);
        nodes.push({
          id: ct.nodeId,
          type: "contact",
          position: { x: LEFT_X, y: ctY },
          data: {
            nodeType: "contact",
            entityId: ct.entityId,
            parentCompanyNodeId: ct.parentCompanyNodeId,
            firstName: ct.firstName,
            lastName: ct.lastName,
            position: ct.position,
          },
        });

        edges.push({
          id: `e-${co.nodeId}-${ct.nodeId}`,
          source: co.nodeId,
          target: ct.nodeId,
          type: "smoothstep",
        });

        // Conversations to the right of this contact
        const ctConvs = conversations.value.filter(
          (cv) => cv.parentContactNodeId === ct.nodeId
        );
        for (let cvi = 0; cvi < ctConvs.length; cvi++) {
          const conv = ctConvs[cvi];
          nodes.push({
            id: conv.nodeId,
            type: "conversation",
            position: { x: LEFT_X + (cvi + 1) * (NODE_WIDTH + GAP_X), y: ctY },
            data: {
              nodeType: "conversation",
              entityId: conv.entityId,
              parentContactNodeId: conv.parentContactNodeId,
              messageCount: conv.messageCount,
              latestMessageText: conv.latestMessageText,
              latestMessageDate: conv.latestMessageDate,
            },
          });
          edges.push({
            id: `e-${ct.nodeId}-${conv.nodeId}`,
            source: ct.nodeId,
            target: conv.nodeId,
            type: "smoothstep",
          });
        }
      }

      // Advance leftY by the company + its contacts
      leftY += (1 + directCoContacts.length) * (NODE_HEIGHT + GAP_Y);
    }

    // ── Right zone: direct contacts ────────────────────────────────────────

    const RIGHT_X = Math.max(hypGridWidth / 2 + NODE_WIDTH + 120, 680);
    const rightYStart = -(directContacts.length * (NODE_HEIGHT + GAP_Y) - GAP_Y) / 2;

    for (let i = 0; i < directContacts.length; i++) {
      const ct = directContacts[i];
      const y = rightYStart + i * (NODE_HEIGHT + GAP_Y);

      nodes.push({
        id: ct.nodeId,
        type: "contact",
        position: { x: RIGHT_X, y },
        data: {
          nodeType: "contact",
          entityId: ct.entityId,
          parentCompanyNodeId: null,
          firstName: ct.firstName,
          lastName: ct.lastName,
          position: ct.position,
        },
      });

      edges.push({
        id: `e-${CENTER_ID}-${ct.nodeId}`,
        source: CENTER_ID,
        target: ct.nodeId,
        type: "smoothstep",
      });

      // Conversations to the right of this direct contact
      const ctConvs = conversations.value.filter(
        (cv) => cv.parentContactNodeId === ct.nodeId
      );
      for (let cvi = 0; cvi < ctConvs.length; cvi++) {
        const conv = ctConvs[cvi];
        nodes.push({
          id: conv.nodeId,
          type: "conversation",
          position: { x: RIGHT_X + (cvi + 1) * (NODE_WIDTH + GAP_X), y },
          data: {
            nodeType: "conversation",
            entityId: conv.entityId,
            parentContactNodeId: conv.parentContactNodeId,
            messageCount: conv.messageCount,
            latestMessageText: conv.latestMessageText,
            latestMessageDate: conv.latestMessageDate,
          },
        });
        edges.push({
          id: `e-${ct.nodeId}-${conv.nodeId}`,
          source: ct.nodeId,
          target: conv.nodeId,
          type: "smoothstep",
        });
      }
    }

    return { nodes, edges };
  }

  // Single computed to avoid running layout twice per reactive update.
  const _layout = computed(() => recalculateLayout());

  const flowNodes = computed(() => _layout.value.nodes);
  const flowEdges = computed(() => _layout.value.edges);

  const sourceCount = computed(
    () =>
      hypotheses.value.length +
      companies.value.filter((c) => c.parentHypothesisNodeId === null).length +
      contacts.value.filter((ct) => ct.parentCompanyNodeId === null).length
  );

  const isEmpty = computed(() => sourceCount.value === 0);

  type SelectedNodeSummary = { id: string; type: ContextNodeData["nodeType"]; label: string };

  function labelForNodeId(nodeId: string): SelectedNodeSummary | null {
    const hyp = hypotheses.value.find((h) => h.nodeId === nodeId);
    if (hyp) return { id: nodeId, type: "hypothesis", label: hyp.name };
    const co = companies.value.find((c) => c.nodeId === nodeId);
    if (co) return { id: nodeId, type: "company", label: co.name ?? co.domain ?? "Company" };
    const ct = contacts.value.find((c) => c.nodeId === nodeId);
    if (ct) {
      const name = [ct.firstName, ct.lastName].filter(Boolean).join(" ").trim();
      return { id: nodeId, type: "contact", label: name || ct.position || "Contact" };
    }
    const conv = conversations.value.find((cv) => cv.nodeId === nodeId);
    if (conv) {
      const snippet = conv.latestMessageText
        ? conv.latestMessageText.slice(0, 40) + (conv.latestMessageText.length > 40 ? "…" : "")
        : "Conversation";
      return { id: nodeId, type: "conversation", label: snippet };
    }
    return null;
  }

  const selectedNodes = computed(() =>
    selectedNodeIds.value
      .map((id) => labelForNodeId(id))
      .filter((x): x is SelectedNodeSummary => x != null)
  );

  function removeSelectedNodes(): void {
    // Copy because removeNode mutates arrays
    const ids = [...selectedNodeIds.value];
    for (const id of ids) removeNode(id);
    clearSelection();
  }

  return {
    // Reactive state (read-only views)
    hypotheses,
    companies,
    contacts,
    conversations,

    // Derived
    flowNodes,
    flowEdges,
    sourceCount,
    isEmpty,

    // Actions
    addHypothesis,
    addCompany,
    addContact,
    addConversation,
    removeNode,
    clearGraph,

    // Selection
    selectedNodeIds,
    selectedNodes,
    isSelected,
    setSelected,
    toggleSelected,
    clearSelection,
    selectAllNodes,
    removeSelectedNodes,

    // Context presence
    hasCompanyContext,
    hasContactContext,
    checkCompanyContext,
    checkContactContext,

    // API helpers (used by picker modals in the page/node components)
    fetchHypothesesList,
    fetchHypothesisTargets,
    fetchProjectCompaniesList,
    fetchContactsForCompany,
    fetchProjectContactsList,
    fetchConversationsForContact,

    // High-level actions
    expandHypothesis,
  };
}

export type ContextBuilderContext = ReturnType<typeof useContextBuilder>;
export const CONTEXT_BUILDER_KEY: InjectionKey<ContextBuilderContext> = Symbol("contextBuilder");
