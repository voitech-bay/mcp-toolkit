/**
 * Vercel serverless: GET /api/supabase-state
 * Returns current row counts for Supabase tables: contacts, linkedin_messages, senders.
 */
import { handleSupabaseState } from "../dist/api-handlers.js";
export default handleSupabaseState;
