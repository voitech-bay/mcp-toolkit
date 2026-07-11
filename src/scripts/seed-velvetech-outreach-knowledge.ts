import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSupabase } from "../services/supabase.js";

const PROJECT_ID = process.env.VELVETECH_PROJECT_ID?.trim() || "51cc22a1-868e-42c4-974f-9a7c5f5dce20";
const HERE = dirname(fileURLToPath(import.meta.url));
const AI_TOOLKIT = process.env.AI_TOOLKIT_ROOT?.trim() || join(HERE, "../../../ai-toolkit");
const MESSAGING = join(AI_TOOLKIT, "projects/Velvetech/messaging");

function readMessaging(name: string, fallback: string): string {
  const path = join(MESSAGING, name);
  return existsSync(path) ? readFileSync(path, "utf8") : fallback;
}

const digest = readMessaging("rules-digest-velvetech.md", "Velvetech messaging digest unavailable.");
const tactics = readMessaging("12-messaging-tactics.md", "").slice(0, 6000);
const caseProof = readMessaging("10-velvetech-case-proof.md", "").slice(0, 4000);

const documents = [
  { kind: "messaging_style", title: "Velvetech messaging digest", priority: 10, source_path: "projects/Velvetech/messaging/rules-digest-velvetech.md", content: digest },
  { kind: "forbidden_claims", title: "Velvetech hard bans", priority: 1, source_path: "projects/Velvetech/messaging/rules-digest-velvetech.md", content: "No em/en dashes. No hyphen-joined words in prose. No trailing antithesis. No source of truth. No presumptive absolutes. No abstract spatial metaphors. No vendor architecture jargon labels. Offer to prospect stays future tense; reference case proof stays past tense only." },
  { kind: "proof_points", title: "Velvetech case proof bank", priority: 20, source_path: "projects/Velvetech/messaging/10-velvetech-case-proof.md", content: caseProof },
  { kind: "icp_angle_framework", title: "Velvetech email sequence rules", priority: 40, source_path: "projects/Velvetech/messaging/rules-digest-velvetech.md", content: "Three-touch proactive arc: E1 diagnostic hypothesis question, E2 proof plus different diagnostic on E2 signal, E3 future-tense offer plus soft time ask. 60 words default; 80 only for dedicated CFO sequence mode. Subject 2-4 words under 50 chars." },
  { kind: "inmail_guidelines", title: "Velvetech InMail fallback", priority: 50, source_path: "projects/Velvetech/messaging/05-channel-playbooks.md", content: "Single InMail fallback touch. Cold inbox register, not chat. Subject under 50 chars. Body target 40-60 words, hard cap 100. No connection-note tone." },
  { kind: "message_guidelines", title: "Velvetech LinkedIn DM rules", priority: 50, source_path: "projects/Velvetech/messaging/05-channel-playbooks.md", content: "Connection DM after accept: short, natural, one idea, no pasted email paragraph. Cap 130 words. Reactive replies continue the thread; do not restart proactive cadence." },
  { kind: "examples", title: "Velvetech messaging tactics", priority: 35, source_path: "projects/Velvetech/messaging/12-messaging-tactics.md", content: tactics || "Tactics catalog unavailable." },
];

const client = getSupabase();
if (!client) throw new Error("Supabase is not configured");
const project = await client.from("Projects").select("id,name").eq("id", PROJECT_ID).single();
if (project.error || project.data?.name !== "Velvetech") throw new Error("Velvetech project validation failed");

let upgraded = 0;
for (const d of documents) {
  const checksum = createHash("sha256").update(d.content).digest("hex");
  const latest = await client.from("project_knowledge_documents").select("version").eq("project_id", PROJECT_ID).eq("kind", d.kind).eq("title", d.title).order("version", { ascending: false }).limit(1).maybeSingle();
  const active = await client.from("project_knowledge_documents").select("id,source_checksum").eq("project_id", PROJECT_ID).eq("kind", d.kind).eq("title", d.title).eq("status", "active").maybeSingle();
  if (active.data?.source_checksum === checksum) continue;
  await client.from("project_knowledge_documents").update({ status: "archived", updated_at: new Date().toISOString() }).eq("project_id", PROJECT_ID).eq("kind", d.kind).eq("title", d.title).eq("status", "active");
  const ins = await client.from("project_knowledge_documents").insert({ project_id: PROJECT_ID, kind: d.kind, title: d.title, version: Number(latest.data?.version ?? 0) + 1, content_markdown: d.content, priority: d.priority, status: "active", source_path: d.source_path, source_checksum: checksum });
  if (ins.error) throw new Error(ins.error.message);
  upgraded += 1;
}

const configured = await client.from("project_outreach_settings").upsert({
  project_id: PROJECT_ID,
  enabled: true,
  email_studio_enabled: true,
  default_model: "openai/gpt-5.5",
  research_ttl_days: 30,
  contact_message_limit: 100,
  company_message_limit: 100,
  active_guideline_profile: "default",
  updated_at: new Date().toISOString(),
});
if (configured.error) throw new Error(configured.error.message);
console.log(`Velvetech outreach knowledge: ${documents.length} documents checked, ${upgraded} upgraded.`);
