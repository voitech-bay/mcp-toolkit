import "dotenv/config";
import { getSupabase, PROJECTS_TABLE, updateProjectCredentials } from "../services/supabase.js";

interface LegacyProjectCredentialsRow {
  id: string;
  source_api_key: string | null;
  source_api_base_url: string | null;
}

const client = getSupabase();
if (!client) {
  console.error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const { data, error } = await client
  .from(PROJECTS_TABLE)
  .select("id, source_api_key, source_api_base_url")
  .or("source_api_key.not.is.null,source_api_base_url.not.is.null");

if (error) {
  console.error(`Failed to load legacy project credentials: ${error.message}`);
  process.exit(1);
}

let migrated = 0;
for (const row of (data ?? []) as LegacyProjectCredentialsRow[]) {
  if (!row.source_api_key || !row.source_api_base_url) {
    console.warn(`Skipping ${row.id}: source_api_key and source_api_base_url are both required.`);
    continue;
  }
  const result = await updateProjectCredentials(client, row.id, {
    apiKey: row.source_api_key,
    baseUrl: row.source_api_base_url,
  });
  if (result.error) {
    console.error(`Failed to migrate ${row.id}: ${result.error}`);
    process.exit(1);
  }
  migrated += 1;
}

console.log(`Migrated ${migrated} GetSales credential row(s) into ProjectIntegrationSecrets.`);
