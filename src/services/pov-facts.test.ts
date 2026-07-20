import assert from "node:assert/strict";
import test from "node:test";
import {
  companyKeyFromHost,
  extractPovFacts,
  loadLatestPovRows,
  loadPriorityAnchors,
  povFactId,
} from "./pov-facts.js";
import { N8N_WORKFLOW_RESULTS_TABLE } from "./supabase.js";

test("extractPovFacts assigns content-hashed ids and keeps legacy ids", () => {
  const facts = extractPovFacts({
    headline_facts: ["Raised a Series B", { statement: "Hiring 12 backend engineers" }],
    verified_signals: [{ fact: "Migrated to AWS" }],
  });
  assert.deepEqual(
    facts.map((f) => f.id),
    [
      povFactId("verified_signals", "Migrated to AWS"),
      povFactId("headline_facts", "Raised a Series B"),
      povFactId("headline_facts", "Hiring 12 backend engineers"),
    ]
  );
  assert.deepEqual(
    facts.map((f) => f.legacyId),
    ["verified_signals:1", "headline_facts:1", "headline_facts:2"]
  );
  assert.equal(povFactId("headline_facts", "Raised   a Series B"), povFactId("headline_facts", "raised a series b"));
  assert.equal(facts.find((f) => f.legacyId === "headline_facts:1")?.text, "Raised a Series B");
  assert.equal(facts.find((f) => f.legacyId === "verified_signals:1")?.text, "Migrated to AWS");
});

test("extractPovFacts reads velvetech-pov fields including claim objects", () => {
  const facts = extractPovFacts({
    pressure_points: ["Cash conversion is stretched"],
    transformation_signals: [{ claim: "ERP rollout in Q3", source: "careers" }],
    discovery_questions: ["Who owns the close calendar?"],
    hiring_signals: [{ signal: "Hiring a VP Finance" }],
  });
  assert.deepEqual(
    facts.map((f) => f.source),
    ["pressure_points", "transformation_signals", "hiring_signals", "discovery_questions"]
  );
  assert.equal(facts.find((f) => f.source === "transformation_signals")?.text, "ERP rollout in Q3");
  assert.equal(facts.find((f) => f.source === "hiring_signals")?.text, "Hiring a VP Finance");
  assert.equal(facts.find((f) => f.source === "discovery_questions")?.text, "Who owns the close calendar?");
});

test("companyKeyFromHost normalizes domains and website URLs", () => {
  assert.equal(companyKeyFromHost("VentureLogistics.com"), "venturelogistics.com");
  assert.equal(companyKeyFromHost("https://www.venturelogistics.com/about"), "venturelogistics.com");
  assert.equal(companyKeyFromHost("www.example.com"), "example.com");
});

// Minimal chainable Supabase stub: every builder method returns the awaitable
// builder; `from(table)` selects which canned result the await resolves to.
function stubClient(results: Record<string, { data: unknown; error: null | { message: string } }>) {
  const makeBuilder = (result: { data: unknown; error: unknown }) => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "in", "order", "limit", "maybeSingle", "single"]) {
      builder[m] = () => builder;
    }
    builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return builder;
  };
  return {
    from: (table: string) => makeBuilder(results[table] ?? { data: [], error: null }),
  } as never;
}

const CONTACT = "11111111-1111-1111-1111-111111111111";
const COMPANY = "22222222-2222-2222-2222-222222222222";
const PROJECT = "33333333-3333-3333-3333-333333333333";

test("loadPriorityAnchors joins marks to facts, drops stale, and orders by rank", async () => {
  const client = stubClient({
    companies: { data: { domain: "acme.com", website: "https://www.acme.com" }, error: null },
    [N8N_WORKFLOW_RESULTS_TABLE]: {
      data: [
        { id: "row-company", contact_id: null, company_id: COMPANY, result: { headline_facts: ["Company opened a Berlin office"] }, created_at: "2026-07-12T00:00:00Z" },
        { id: "row-contact", contact_id: CONTACT, company_id: COMPANY, result: { verified_signals: ["Owns the data platform roadmap", "Spoke at re:Invent"] }, created_at: "2026-07-13T00:00:00Z" },
      ],
      error: null,
    },
    pov_fact_marks: {
      data: [
        { entity_key: CONTACT, fact_id: povFactId("verified_signals", "Spoke at re:Invent"), priority: true, rank: 2, comment: null, author_id: null, updated_at: "2026-07-13T09:00:00Z" },
        { entity_key: CONTACT, fact_id: "verified_signals:1", priority: true, rank: 1, comment: "Lead with this", author_id: null, updated_at: "2026-07-13T08:00:00Z" },
        { entity_key: COMPANY, fact_id: povFactId("headline_facts", "Company opened a Berlin office"), priority: true, rank: null, comment: null, author_id: null, updated_at: "2026-07-13T10:00:00Z" },
        { entity_key: CONTACT, fact_id: "verified_signals:9", priority: true, rank: 5, comment: null, author_id: null, updated_at: "2026-07-13T07:00:00Z" }, // stale: no such fact
      ],
      error: null,
    },
  });

  const anchors = await loadPriorityAnchors(client, { projectId: PROJECT, contactId: CONTACT, companyId: COMPANY });

  // Stale mark (verified_signals:9) dropped; ranks 1,2 then null-rank last.
  assert.deepEqual(
    anchors.map((a) => a.text),
    ["Owns the data platform roadmap", "Spoke at re:Invent", "Company opened a Berlin office"]
  );
  assert.equal(anchors[0].comment, "Lead with this");
  assert.equal(anchors[0].factId, povFactId("verified_signals", "Owns the data platform roadmap"));
});

test("loadPriorityAnchors returns empty when there are no marks", async () => {
  const client = stubClient({
    companies: { data: { domain: "acme.com", website: null }, error: null },
    [N8N_WORKFLOW_RESULTS_TABLE]: { data: [{ id: "r", contact_id: CONTACT, company_id: COMPANY, result: { headline_facts: ["x"] }, created_at: "2026-07-13T00:00:00Z" }], error: null },
    pov_fact_marks: { data: [], error: null },
  });
  const anchors = await loadPriorityAnchors(client, { projectId: PROJECT, contactId: CONTACT, companyId: COMPANY });
  assert.deepEqual(anchors, []);
});

test("loadLatestPovRows matches company_key domain when FKs are null", async () => {
  let capturedOr = "";
  const makeBuilder = (result: { data: unknown; error: unknown }) => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) {
      builder[m] = () => builder;
    }
    builder.or = (clause: string) => {
      capturedOr = clause;
      return builder;
    };
    builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return builder;
  };
  const client = {
    from: () =>
      makeBuilder({
        data: [
          {
            id: "domain-only",
            contact_id: null,
            company_id: null,
            result: { company_key: "venturelogistics.com", pressure_points: ["Close is slow"] },
            created_at: "2026-07-13T00:00:00Z",
          },
        ],
        error: null,
      }),
  } as never;

  const rows = await loadLatestPovRows(client, [CONTACT], ["VentureLogistics.com"]);
  assert.match(capturedOr, /result->>company_key\.in\.\("venturelogistics\.com"\)/);
  assert.equal(rows.length, 1);
  assert.equal(extractPovFacts(rows[0].result)[0]?.text, "Close is slow");
});
