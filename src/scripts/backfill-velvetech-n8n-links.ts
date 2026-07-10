/**
 * One-off: link existing Velvetech n8n_workflow_results rows to companies/contacts.
 * Usage: tsx src/scripts/backfill-velvetech-n8n-links.ts [limit]
 */
import { getSupabase } from "../services/supabase.js";
import { backfillVelvetechN8nResultLinks } from "../services/n8n-entity-link.js";

const VELVETECH_PROJECT_ID = "51cc22a1-868e-42c4-974f-9a7c5f5dce20";

async function main(): Promise<void> {
  const client = getSupabase();
  if (!client) {
    console.error("Supabase not configured");
    process.exit(1);
  }
  const limit = parseInt(process.argv[2] ?? "5000", 10);
  const result = await backfillVelvetechN8nResultLinks(client, {
    projectId: VELVETECH_PROJECT_ID,
    limit,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.error) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
