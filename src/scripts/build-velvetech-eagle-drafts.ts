import "dotenv/config";
import crypto from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { VELVETECH_PROJECT_ID } from "../services/velvetech-messaging/types.js";

/**
 * Parse Eagle PART markdown into Email Studio drafts.json files.
 * Matches Voitech Contacts when possible. Unmatched people keep a stable hashed UUID
 * (GetSales import later should reuse email match, not this hash).
 *
 * Usage:
 *   npx tsx src/scripts/build-velvetech-eagle-drafts.ts
 */

const ROOT = "/Users/pavelpashkevich/Cursor/ai-toolkit/projects/Velvetech/artifacts";
const OUT = join(ROOT, "20260826-2305-eagle-email-studio");

type ResearchPoint = { id: string; statement: string; source?: string };
type Touch = { channel: "email"; step: number; subject: string; body: string; annotations: [] };
type ContactBlock = {
  contactId: string;
  contactName: string;
  companyId: string | null;
  companyName: string;
  persona: string;
  recipientEmail: string | null;
  research: { verified_signals: ResearchPoint[]; inferred_priorities: ResearchPoint[] };
  touches: Touch[];
};

type ParsedPerson = {
  batch: string;
  companyName: string;
  contactName: string;
  title: string;
  signals: string[];
  emails: { step: number; subject: string; body: string }[];
};

const SKIP_HEADINGS = /^(relevant signals|email \d+|assumptions|thin assumptions|title:|evidence boundaries|sources)\b/i;

function uuidFromKey(key: string): string {
  const bytes = Buffer.from(crypto.createHash("sha256").update(key).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function inferPersona(title: string, fallback: string) {
  const t = title.toLowerCase();
  if (/\b(cfo|finance|fp&a|controller|accounting|treasury|ar\b|audit)\b/.test(t)) return "fin";
  if (/\b(cio|cto|it\b|information|data|software|engineering manager|integrations?|infosec|security)\b/.test(t)) return "it";
  if (/\b(coo|operations|ops|logistics|supply|warehouse|inventory|procurement|pricing)\b/.test(t)) return "ops";
  return fallback;
}

function parseCsvEmails(path: string): Map<string, { email: string; company: string; persona: string; title: string }> {
  const map = new Map<string, { email: string; company: string; persona: string; title: string }>();
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return map;
  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
  const idx = (name: string) => header.indexOf(name);
  const nameI = ["full_name", "name"].map(idx).find((i) => i >= 0) ?? -1;
  const emailI = ["email", "final_email", "prospeo_email", "work_email"].map(idx).find((i) => i >= 0) ?? -1;
  const coI = ["company", "company_name"].map(idx).find((i) => i >= 0) ?? -1;
  const personaI = ["flow", "persona"].map(idx).find((i) => i >= 0) ?? -1;
  const titleI = ["title"].map(idx).find((i) => i >= 0) ?? -1;
  if (nameI < 0 || emailI < 0) return map;
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const name = (cols[nameI] ?? "").replace(/^"|"$/g, "").trim();
    const email = (cols[emailI] ?? "").replace(/^"|"$/g, "").trim().toLowerCase();
    if (!name || !email || !email.includes("@")) continue;
    map.set(norm(name), {
      email,
      company: (cols[coI] ?? "").replace(/^"|"$/g, "").trim(),
      persona: (cols[personaI] ?? "").replace(/^"|"$/g, "").trim().toLowerCase(),
      title: (cols[titleI] ?? "").replace(/^"|"$/g, "").trim(),
    });
  }
  return map;
}

function parsePart(md: string, batch: string): ParsedPerson[] {
  const lines = md.split(/\n/);
  let companyName = "";
  const people: ParsedPerson[] = [];
  let current: ParsedPerson | null = null;
  let mode: "none" | "signals" | "email" = "none";
  let emailBuf: string[] = [];
  let emailStep = 0;

  const flushEmail = () => {
    if (!current || !emailStep) return;
    const text = emailBuf.join("\n").trim();
    const subj = text.match(/^Subject:\s*(.+)$/m)?.[1]?.trim() ?? "";
    const body = text.replace(/^Subject:\s*.+\n?/m, "").trim();
    if (subj || body) current.emails.push({ step: emailStep, subject: subj, body });
    emailBuf = [];
    emailStep = 0;
  };

  const startPerson = (name: string): ParsedPerson => {
    flushEmail();
    const person: ParsedPerson = {
      batch,
      companyName: companyName || "Unknown",
      contactName: name.trim(),
      title: "",
      signals: [],
      emails: [],
    };
    people.push(person);
    mode = "none";
    return person;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const numbered = line.match(/^#{2,3} \d+\.\s+(.+)$/);
    const named = line.match(/^### ([A-Z].+)$/);
    const company = line.match(/^## (?!\d+\.)(.+)$/);

    if (numbered) {
      current = startPerson(numbered[1]!);
      continue;
    }
    if (named && !SKIP_HEADINGS.test(named[1]!.trim())) {
      current = startPerson(named[1]!);
      continue;
    }
    if (company && !/^#{3}/.test(line)) {
      flushEmail();
      current = null;
      companyName = company[1]!.trim();
      mode = "none";
      continue;
    }

    if (!current) continue;

    const titleStar = line.match(/^\*\*Title:\s*(.+)\*\*$/);
    const titlePlain = line.match(/^Title:\s*(.+)$/);
    if (titleStar) current.title = titleStar[1]!.trim();
    if (titlePlain) current.title = titlePlain[1]!.trim();

    if (/^### Relevant signals/i.test(line)) {
      flushEmail();
      mode = "signals";
      continue;
    }
    const emailHead = line.match(/^### Email (\d+)/i);
    if (emailHead) {
      flushEmail();
      mode = "email";
      emailStep = Number(emailHead[1]);
      emailBuf = [];
      continue;
    }

    if (mode === "signals" && /^[-*]\s+/.test(line)) {
      current.signals.push(line.replace(/^[-*]\s+/, "").trim());
    }
    if (mode === "email") emailBuf.push(line);
  }
  flushEmail();
  return people;
}

async function main() {
  const files: Array<{ path: string; batch: string }> = [
    { path: "20260826-1945-90-batch-10x3-rewrite/PART-A.md", batch: "eagle-live-30" },
    { path: "20260826-1945-90-batch-10x3-rewrite/PART-B.md", batch: "eagle-live-30" },
    { path: "20260826-1945-90-batch-10x3-rewrite/PART-C.md", batch: "eagle-live-30" },
    { path: "20260826-2046-90-batch-slice2-rewrite/PART-A.md", batch: "eagle-slice2" },
    { path: "20260826-2046-90-batch-slice2-rewrite/PART-B.md", batch: "eagle-slice2" },
    { path: "20260826-2046-90-batch-slice2-rewrite/PART-C.md", batch: "eagle-slice2" },
    { path: "20260826-2046-90-batch-slice2-rewrite/PART-D.md", batch: "eagle-slice2" },
    { path: "20260826-2055-post90-backfill-32/PART-A.md", batch: "eagle-backfill-32" },
    { path: "20260826-2055-post90-backfill-32/PART-B.md", batch: "eagle-backfill-32" },
  ];

  const parsed = files.flatMap((f) => parsePart(readFileSync(join(ROOT, f.path), "utf8"), f.batch));
  const byKey = new Map<string, ParsedPerson>();
  for (const p of parsed) byKey.set(`${p.batch}::${norm(p.contactName)}`, p);

  const e2e3 = JSON.parse(readFileSync(join(ROOT, "20260826-1945-90-batch-10x3-rewrite/smartlead-e2e3.json"), "utf8")) as Array<{
    email: string; first_name: string; last_name: string; subject_2: string; subject_3: string; body_2: string; body_3: string;
  }>;
  const overlay = new Map(e2e3.map((r) => [norm(`${r.first_name} ${r.last_name}`), r]));

  const csvMap = parseCsvEmails(join(ROOT, "20260826-1828-smartlead-cap5-backfill/FINAL-10-COMPANIES-30PLUS.csv"));
  for (const row of e2e3) {
    csvMap.set(norm(`${row.first_name} ${row.last_name}`), {
      email: row.email.toLowerCase(),
      company: "",
      persona: "",
      title: "",
    });
  }

  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const contacts: Array<{ uuid: string; name: string; first_name: string; last_name: string; company_name: string; company_uuid: string | null; work_email: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const page = await client
      .from("Contacts")
      .select("uuid,name,first_name,last_name,company_name,company_uuid,work_email")
      .eq("project_id", VELVETECH_PROJECT_ID)
      .range(from, from + 999);
    if (page.error) throw new Error(page.error.message);
    contacts.push(...((page.data ?? []) as typeof contacts));
    if ((page.data ?? []).length < 1000) break;
  }

  const matchContact = (name: string, company: string, email: string | null) => {
    const n = norm(name);
    if (email) {
      const byEmail = contacts.filter((c) => (c.work_email || "").toLowerCase() === email);
      if (byEmail.length === 1) return byEmail[0];
    }
    const hits = contacts.filter((c) => norm(c.name || `${c.first_name} ${c.last_name}`) === n);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      const co = norm(company);
      const narrowed = hits.filter((c) => norm(c.company_name).includes(co) || co.includes(norm(c.company_name)));
      if (narrowed.length === 1) return narrowed[0];
      return hits[0];
    }
    return null;
  };

  const batches = new Map<string, ContactBlock[]>();
  const unmatched: string[] = [];
  for (const person of byKey.values()) {
    const csv = csvMap.get(norm(person.contactName));
    const overlayRow = overlay.get(norm(person.contactName));
    const email = (overlayRow?.email || csv?.email || "").toLowerCase() || null;
    const matched = matchContact(person.contactName, person.companyName, email);
    if (!matched) unmatched.push(`${person.batch} ${person.contactName} <${email || "no-email"}>`);
    const contactId = matched?.uuid || uuidFromKey(`velvetech:eagle:${norm(person.contactName)}:${email || person.companyName}`);
    const emails = person.emails.slice().sort((a, b) => a.step - b.step);
    if (overlayRow) {
      const e2 = emails.find((e) => e.step === 2);
      const e3 = emails.find((e) => e.step === 3);
      if (e2) {
        e2.subject = overlayRow.subject_2;
        e2.body = overlayRow.body_2;
      }
      if (e3) {
        e3.subject = overlayRow.subject_3;
        e3.body = overlayRow.body_3;
      }
    }
    const personaRaw = (csv?.persona || inferPersona(person.title, "ops")).toLowerCase();
    const persona = personaRaw === "finance" || personaRaw === "fin" ? "fin"
      : personaRaw === "it" ? "it"
      : personaRaw === "ops" || personaRaw === "operations" ? "ops"
      : inferPersona(person.title, personaRaw || "ops");
    const verified = person.signals.map((statement, i) => ({
      id: `verified-${i + 1}`,
      statement,
      source: `${person.companyName} Eagle research · ${person.title || "title unknown"}`,
    }));
    const block: ContactBlock = {
      contactId,
      contactName: person.contactName,
      companyId: matched?.company_uuid ?? null,
      companyName: matched?.company_name || person.companyName,
      persona,
      recipientEmail: matched?.work_email || email,
      research: {
        verified_signals: verified.length ? verified : [{ id: "verified-1", statement: `${person.contactName} at ${person.companyName}. Title: ${person.title || "unknown"}.` }],
        inferred_priorities: [{ id: "inferred-1", statement: `E2/E3 should use a different named hook than E1 from the unused signals list.` }],
      },
      touches: emails.filter((e) => e.step >= 1 && e.step <= 3).map((e) => ({
        channel: "email" as const,
        step: e.step,
        subject: e.subject,
        body: e.body,
        annotations: [],
      })),
    };
    if (!block.touches.length) continue;
    batches.set(person.batch, [...(batches.get(person.batch) ?? []), block]);
  }

  mkdirSync(OUT, { recursive: true });
  const summary: Record<string, number> = {};
  for (const [batch, contactsBlocks] of batches) {
    const file = {
      projectId: VELVETECH_PROJECT_ID,
      campaignId: "eagle-abm-20260826",
      batchName: batch,
      model: "import/eagle-rewrite-2026-08-26",
      note: `Eagle ABM copy from PART markdown. ${basename(OUT)}. Review E2/E3 in Email Studio.`,
      contacts: contactsBlocks,
    };
    const outPath = join(OUT, `${batch}.json`);
    writeFileSync(outPath, JSON.stringify(file, null, 2));
    summary[batch] = contactsBlocks.length;
    console.log("wrote", outPath, contactsBlocks.length, "contacts", contactsBlocks.reduce((n, c) => n + c.touches.length, 0), "touches");
  }
  writeFileSync(join(OUT, "UNMATCHED.md"), unmatched.length ? unmatched.map((x) => `- ${x}`).join("\n") + "\n" : "none\n");
  console.log("summary", summary, "unmatched", unmatched.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
