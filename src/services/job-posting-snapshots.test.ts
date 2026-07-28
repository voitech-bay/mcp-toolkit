import assert from "node:assert/strict";
import test from "node:test";
import {
  collectJobSnapshotCandidates,
  extractJobBody,
} from "./job-posting-snapshots.js";

test("extractJobBody prefers the longest description-like field", () => {
  assert.equal(extractJobBody({ snippet: "short", description: "much longer body text here" }), "much longer body text here");
  assert.equal(extractJobBody({ snippet: "" }), "");
});

test("collectJobSnapshotCandidates skips empty bodies and dedupes ids", () => {
  const rows = collectJobSnapshotCandidates(
    {
      job_postings: [
        { title: "Engineer", snippet: "", date: "2026-01-01" },
        {
          title: "Data Engineer",
          description: "Build pipelines for TMS/ERP integrations.",
          url: "https://example.com/jobs/1",
          id: "job-1",
          date: "2026-02-01",
        },
      ],
      leadership_openings: [
        {
          title: "VP Finance",
          snippet: "Own FP&A and systems.",
          department: "finance",
          id: "job-1", // same id — dedupe
        },
        {
          title: "Head of Ops",
          snippet: "Scale operations across terminals.",
          date: "2026-03-01",
        },
      ],
    },
    "company-uuid"
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "Data Engineer");
  assert.equal(rows[0].source_url, "https://example.com/jobs/1");
  assert.equal(rows[0].external_id, "job-1");
  assert.equal(rows[1].title, "Head of Ops");
  assert.ok(rows[1].external_id.length > 0);
  assert.match(rows[1].content, /Scale operations/);
});
