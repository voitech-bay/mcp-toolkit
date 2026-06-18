/**
 * Tag-backed prospect list assembly for the lists-checker record view
 * ("MSSP Leaders in MENA" and any other GetSalesTags-backed list).
 *
 * Read-only. Joins existing tables/views only:
 *   Contacts (tags jsonb of GetSalesTags uuids) → identity + pipeline stage,
 *   PipelineStages (status label/category), companies (HQ location),
 *   company_workflow_latest / n8n_workflow_results (POV: phase_b_company),
 *   FlowLeads + Flows (automations enrolled), LinkedinMessages (out/replies,
 *   connection state). Marker derivation reuses account-context helpers.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONTACTS_TABLE,
  COMPANIES_TABLE,
  LINKEDIN_MESSAGES_TABLE,
  FLOWS_TABLE,
  FLOW_LEADS_TABLE,
  PIPELINE_STAGES_TABLE,
} from "./supabase.js";
import {
  groupMessagesIntoThreads,
  summarizeContactActivity,
  type MessageRow,
} from "./account-context.js";

const COMPANY_WORKFLOW_LATEST_VIEW = "company_workflow_latest";
const PHASE_B_WORKFLOW = "phase_b_company";

type Json = Record<string, unknown>;

/** A message row plus linkedin_type, used to detect connection-request events. */
interface ListMessageRow extends MessageRow {
  linkedin_type: string | null;
  reply_received: boolean | null;
}

export interface LeaderListRecord {
  uuid: string;
  name: string;
  position: string | null;
  headline: string | null;
  linkedin_url: string | null;
  location: string | null;
  email: string | null;
  email_status: string | null;
  company_id: string | null;
  company_name: string | null;
  company_hq: string | null;
  employee_count: number | null;
  // POV (n8n phase_b_company only; null where absent)
  pov_markdown: string | null;
  company_type: string | null;
  services: string[];
  vendors: string[];
  // markers
  connection_status: "accepted" | "sent" | "none";
  connection_accepted_at: string | null;
  automations: string[];
  outgoing_count: number;
  reply_count: number;
  email_count: number;
  status: string;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/** Map a GetSales pipeline-stage name to the rep-facing status, else derive from activity. */
function deriveStatus(stageName: string | null, outgoing: number, replyStatus: string): string {
  if (stageName) {
    const s = stageName.toLowerCase();
    if (s.includes("opportunity") || s.includes("meeting")) return "Meeting / Opportunity";
    if (s.includes("positive")) return "Positive Reply";
    if (s.includes("negative") || s.includes("do not contact")) return "Not Interested";
    if (s.includes("customer")) return "Current Customer";
    if (s.includes("unresponsive")) return "No Reply";
    if (s.includes("bad timing")) return "Bad Timing";
    if (s.includes("engaging")) return "Engaging";
  }
  if (replyStatus === "got_response") return "Waiting for Reply";
  if (replyStatus === "waiting_for_response") return "Awaiting Their Reply";
  if (outgoing >= 2) return "No reply after 2 messages";
  if (outgoing > 0) return "Contacted";
  return "Not Contacted";
}

/** services/vendors are not first-class n8n fields; pull only if trivially present. */
function arrField(result: Json | undefined, ...keys: string[]): string[] {
  if (!result) return [];
  for (const k of keys) {
    const v = result[k];
    if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean).slice(0, 12);
  }
  return [];
}

/** Parse location stored as JSON string {"city":"X","country":"Y",...} or plain text. */
function parseCityCountry(loc: unknown): string | null {
  if (!loc) return null;
  if (typeof loc === "string") {
    if (loc.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(loc) as Json;
        const city = str(parsed.city);
        const country = str(parsed.country);
        return [city, country].filter(Boolean).join(", ") || null;
      } catch { /* not JSON */ }
    }
    return loc.trim() || null;
  }
  if (typeof loc === "object" && loc !== null) {
    const o = loc as Json;
    return [str(o.city), str(o.country)].filter(Boolean).join(", ") || null;
  }
  return null;
}

/** Normalize a partial LinkedIn path/URL to a full https URL. */
function normalizeLinkedinUrl(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  if (s.startsWith("http")) return s;
  if (s.startsWith("linkedin.com")) return `https://www.${s}`;
  if (s.startsWith("www.linkedin.com")) return `https://${s}`;
  if (s.startsWith("in/")) return `https://www.linkedin.com/${s}`;
  return `https://www.linkedin.com/in/${s}`;
}

export async function buildLeadersList(
  client: SupabaseClient,
  tagUuid: string
): Promise<{ data: LeaderListRecord[]; error: string | null }> {
  const tag = tagUuid.trim();
  if (!tag) return { data: [], error: "tag is required" };

  const { data: contacts, error: cErr } = await client
    .from(CONTACTS_TABLE)
    .select(
      "uuid, name, first_name, last_name, position, headline, linkedin, linkedin_url, location, work_email, personal_email, email, email_status, company_id, company_uuid, company_name, pipeline_stage_uuid, email_sent_count, gs_connection_accepted_at, markers_synced_at"
    )
    // tags is a jsonb array of GetSalesTags uuids → containment needs a JSON string,
    // not a JS array (which supabase-js would serialize as a PostgREST array literal).
    .contains("tags", JSON.stringify([tag]));
  if (cErr) return { data: [], error: cErr.message };
  const rows = (contacts ?? []) as Json[];
  if (rows.length === 0) return { data: [], error: null };

  const leadUuids = rows.map((r) => String(r.uuid)).filter(Boolean);
  const companyIds = [
    ...new Set(
      rows
        .map((r) => str(r.company_id) ?? str(r.company_uuid))
        .filter((x): x is string => Boolean(x))
    ),
  ];
  const stageUuids = [
    ...new Set(rows.map((r) => str(r.pipeline_stage_uuid)).filter((x): x is string => Boolean(x))),
  ];

  const [stagesRes, companiesRes, povRes, flowLeadsRes, msgsRes] = await Promise.all([
    stageUuids.length
      ? client.from(PIPELINE_STAGES_TABLE).select("uuid, name, category").in("uuid", stageUuids)
      : Promise.resolve({ data: [], error: null }),
    companyIds.length
      ? client.from(COMPANIES_TABLE).select("id, name, hq_location, hq_raw_address, employees_on_linkedin, employees_range").in("id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    companyIds.length
      ? client
          .from(COMPANY_WORKFLOW_LATEST_VIEW)
          .select("company_id, result")
          .eq("workflow_name", PHASE_B_WORKFLOW)
          .in("company_id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    leadUuids.length
      ? client.from(FLOW_LEADS_TABLE).select("lead_uuid, flow_uuid").in("lead_uuid", leadUuids)
      : Promise.resolve({ data: [], error: null }),
    leadUuids.length
      ? client
          .from(LINKEDIN_MESSAGES_TABLE)
          .select(
            "uuid, lead_uuid, linkedin_conversation_uuid, sender_profile_uuid, text, subject, type, status, sent_at, created_at, linkedin_type, reply_received"
          )
          .in("lead_uuid", leadUuids)
          .order("sent_at", { ascending: false })
          .limit(8000)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // Lookup maps
  const stageById = new Map<string, { name: string | null; category: string | null }>();
  for (const s of ((stagesRes as { data: Json[] }).data ?? []) as Json[])
    stageById.set(String(s.uuid), { name: str(s.name), category: str(s.category) });

  const companyById = new Map<string, { name: string | null; hq: string | null; employee_count: number | null }>();
  for (const c of ((companiesRes as { data: Json[] }).data ?? []) as Json[]) {
    let hq: string | null = null;
    if (c.hq_location && typeof c.hq_location === "object") {
      const loc = c.hq_location as Json;
      hq = [str(loc.city), str(loc.country)].filter(Boolean).join(", ") || null;
    }
    if (!hq) hq = parseCityCountry(c.hq_raw_address);
    companyById.set(String(c.id), {
      name: str(c.name),
      hq,
      employee_count: typeof c.employees_on_linkedin === "number" ? c.employees_on_linkedin : null,
    });
  }

  const povByCompany = new Map<string, Json>();
  for (const p of ((povRes as { data: Json[] }).data ?? []) as Json[]) {
    const cid = String(p.company_id);
    if (!povByCompany.has(cid)) povByCompany.set(cid, (p.result as Json) ?? {});
  }

  // Flows → names
  const flowUuids = [
    ...new Set(
      ((flowLeadsRes as { data: Json[] }).data ?? []).map((f) => str((f as Json).flow_uuid)).filter(Boolean) as string[]
    ),
  ];
  const flowNameById = new Map<string, string>();
  if (flowUuids.length) {
    const { data: flows } = await client.from(FLOWS_TABLE).select("uuid, name").in("uuid", flowUuids);
    for (const f of (flows ?? []) as Json[]) flowNameById.set(String(f.uuid), str(f.name) ?? "Flow");
  }
  const automationsByLead = new Map<string, Set<string>>();
  for (const fl of ((flowLeadsRes as { data: Json[] }).data ?? []) as Json[]) {
    const lead = str(fl.lead_uuid);
    const fu = str(fl.flow_uuid);
    if (!lead || !fu) continue;
    const nm = flowNameById.get(fu);
    if (!nm) continue;
    const set = automationsByLead.get(lead) ?? new Set<string>();
    set.add(nm);
    automationsByLead.set(lead, set);
  }

  // Messages per lead
  const allMsgs = ((msgsRes as { data: ListMessageRow[] }).data ?? []) as ListMessageRow[];
  const msgsByLead = new Map<string, ListMessageRow[]>();
  for (const m of allMsgs) {
    const lead = m.lead_uuid ? String(m.lead_uuid) : "";
    if (!lead) continue;
    const arr = msgsByLead.get(lead) ?? [];
    arr.push(m);
    msgsByLead.set(lead, arr);
  }

  const records: LeaderListRecord[] = rows.map((r) => {
    const uuid = String(r.uuid);
    const cid = str(r.company_id) ?? str(r.company_uuid);
    const pov = cid ? povByCompany.get(cid) : undefined;
    const stage = str(r.pipeline_stage_uuid) ? stageById.get(str(r.pipeline_stage_uuid)!) : undefined;
    const co = cid ? companyById.get(cid) : undefined;

    const leadMsgs = msgsByLead.get(uuid) ?? [];
    const threads = groupMessagesIntoThreads(leadMsgs);
    const activity = summarizeContactActivity(threads).get(uuid);
    const outgoing = activity?.outbox_count ?? 0;
    const replies = activity?.inbox_count ?? 0;
    const replyStatus = activity?.reply_status ?? "no_response";

    // Connection state: any linkedin_type='message' = accepted (you can only message
    // 1st-degree connections). A lone connection_note with no subsequent message = sent.
    const hasMessage = leadMsgs.some((m) => (m.linkedin_type ?? "") === "message");
    const sentConn = leadMsgs.some((m) => (m.linkedin_type ?? "") === "connection_note");
    const connection_status: LeaderListRecord["connection_status"] = hasMessage
      ? "accepted"
      : sentConn
        ? "sent"
        : "none";

    // Accepted-at: prefer GS-synced value (accurate); fall back to earliest message-type msg.
    const gsAcceptedAt = str(r.gs_connection_accepted_at);
    const messageDates = leadMsgs
      .filter((m) => (m.linkedin_type ?? "") === "message")
      .map((m) => m.sent_at ?? m.created_at ?? "")
      .filter(Boolean)
      .sort();
    const connection_accepted_at = gsAcceptedAt ?? (messageDates.length ? messageDates[0] : null);

    // Email count: prefer GS-synced value; fall back to subject-bearing outbox msgs.
    const email_count =
      typeof r.email_sent_count === "number"
        ? r.email_sent_count
        : leadMsgs.filter(
            (m) => m.subject && m.subject.trim() && (m.type ?? "").toLowerCase() === "outbox"
          ).length;

    const name =
      str(r.name) ?? ([str(r.first_name), str(r.last_name)].filter(Boolean).join(" ").trim() || "—");

    return {
      uuid,
      name,
      position: str(r.position),
      headline: str(r.headline),
      linkedin_url: normalizeLinkedinUrl(r.linkedin_url) ?? normalizeLinkedinUrl(r.linkedin),
      location: parseCityCountry(r.location),
      email: str(r.work_email) ?? str(r.email) ?? str(r.personal_email),
      email_status: str(r.email_status),
      company_id: cid,
      company_name: co?.name ?? str(r.company_name),
      company_hq: co?.hq ?? null,
      employee_count: co?.employee_count ?? null,
      pov_markdown: str(pov?.pov_markdown),
      company_type: str(pov?.company_type_tag),
      services: arrField(pov, "services", "services_list"),
      vendors: arrField(pov, "vendors", "vendor_list", "technologies"),
      connection_status,
      connection_accepted_at,
      automations: [...(automationsByLead.get(uuid) ?? [])],
      outgoing_count: outgoing,
      reply_count: replies,
      email_count,
      status: deriveStatus(stage?.name ?? null, outgoing, replyStatus),
    };
  });

  records.sort((a, b) => (a.company_name ?? "").localeCompare(b.company_name ?? "") || a.name.localeCompare(b.name));
  return { data: records, error: null };
}
