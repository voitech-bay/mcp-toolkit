/**
 * Vercel serverless: GET /api/supabase-table-query
 * Returns filtered rows for a table. Query: table, filters (JSON), limit, offset.
 */
import { handleSupabaseTableQuery } from "../dist/api-handlers.js";
export default handleSupabaseTableQuery;
