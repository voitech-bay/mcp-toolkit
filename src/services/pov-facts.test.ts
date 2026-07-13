import assert from "node:assert/strict";
import test from "node:test";
import { extractPovFacts, loadPriorityAnchors } from "./pov-facts.js";
import { N8N_WORKFLOW_RESULTS_TABLE } from "./supabase.js";

test("extractPovFacts assigns stable source-indexed ids", () => {
  const facts = extractPovFacts({
    headline_facts: ["Raised a Series B", { statement: "Hiring 12 backend engineers" }],
    verified_signals: [{ fact: "Migrated to AWS" }],
  });
  assert.deepEqual(
    facts.map((f) => f.id),
    ["verified_signals:1", "headline_facts:1", "headline_facts:2"]
  );
  assert.equal(facts.find((f) => f.id === "headline_facts:1")?.text, "Raised a Series B");
  assert.equal(facts.find((f) => f.id === "verified_signals:1")?.text, "Migrated to AWS");
});

// Minimal chainable Supabase stub: every builder method returns the awaitable
// builder; `from(table)` selects which canned result the await resolves to.
function stubClient(results: Record<string, { data: unknown[]; error: null | { message: string } }>) {
  const makeBuilder = (result: { data: unknown[]; error: unknown }) => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "in", "order", "limit"]) {
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
    [N8N_WORKFLOW_RESULTS_TABLE]: {
      data: [
        { id: "row-company", contact_id: null, company_id: COMPANY, result: { headline_facts: ["Company opened a Berlin office"] }, created_at: "2026-07-12T00:00:00Z" },
        { id: "row-contact", contact_id: CONTACT, company_id: COMPANY, result: { verified_signals: ["Owns the data platform roadmap", "Spoke at re:Invent"] }, created_at: "2026-07-13T00:00:00Z" },
      ],
      error: null,
    },
    pov_fact_marks: {
      data: [
        { entity_key: CONTACT, fact_id: "verified_signals:2", priority: true, rank: 2, comment: null, author_id: null, updated_at: "2026-07-13T09:00:00Z" },
        { entity_key: CONTACT, fact_id: "verified_signals:1", priority: true, rank: 1, comment: "Lead with this", author_id: null, updated_at: "2026-07-13T08:00:00Z" },
        { entity_key: COMPANY, fact_id: "headline_facts:1", priority: true, rank: null, comment: null, author_id: null, updated_at: "2026-07-13T10:00:00Z" },
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
  assert.equal(anchors[0].factId, "verified_signals:1");
});

test("loadPriorityAnchors returns empty when there are no marks", async () => {
  const client = stubClient({
    [N8N_WORKFLOW_RESULTS_TABLE]: { data: [{ id: "r", contact_id: CONTACT, company_id: COMPANY, result: { headline_facts: ["x"] }, created_at: "2026-07-13T00:00:00Z" }], error: null },
    pov_fact_marks: { data: [], error: null },
  });
  const anchors = await loadPriorityAnchors(client, { projectId: PROJECT, contactId: CONTACT, companyId: COMPANY });
  assert.deepEqual(anchors, []);
});
