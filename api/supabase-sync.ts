/**
 * Vercel serverless: POST /api/supabase-sync
 * Syncs Supabase tables from the source API (contacts, LinkedIn messages, senders). Dedupes by uuid.
 */
import { handleSupabaseSync } from "../dist/api-handlers.js";
export default handleSupabaseSync;
