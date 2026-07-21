/**
 * Enrich one velvetech-run-billing row with token-estimated cost + funnel.
 * Usage: tsx src/scripts/backfill-velvetech-billing-one.ts <executionId> <runId>
 */
import "dotenv/config";
import { getSupabase } from "../services/supabase.js";
import { computeAndEmitBilling } from "../services/velvetech-billing.js";

const executionId = process.argv[2]?.trim();
const runId = process.argv[3]?.trim();
if (!executionId || !runId) {
  console.error("Usage: tsx src/scripts/backfill-velvetech-billing-one.ts <executionId> <runId>");
  process.exit(1);
}

const client = getSupabase();
if (!client) {
  console.error("Supabase not configured");
  process.exit(1);
}

const result = await computeAndEmitBilling({
  client,
  runId,
  executionId,
  fallbackStatus: "success",
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
