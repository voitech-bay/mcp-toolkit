-- Workflow launcher: records of n8n runs launched from the web app.
-- ADDITIVE ONLY. Creates 1 new table + indexes. No changes to existing tables.
-- Apply once against the Supabase project (SQL editor or MCP apply_migration).
-- Rollback: DROP TABLE public.n8n_launch_runs CASCADE;

CREATE TABLE IF NOT EXISTS public.n8n_launch_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- == launch_id passed to n8n
  project_id text NOT NULL,
  workflow_key text NOT NULL,            -- registry key: research | inmail | followup
  source_list_uuid text,                 -- GetSales list the contacts were chosen from
  source_list_name text,                 -- resolved at launch time for display
  lead_uuids jsonb NOT NULL DEFAULT '[]'::jsonb, -- selected lead/contact uuids
  requested_count int NOT NULL DEFAULT 0,
  contacts_count int NOT NULL DEFAULT 0,  -- distinct contacts seen in results
  companies_count int NOT NULL DEFAULT 0, -- distinct companies seen in results
  succeeded_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running', -- running | success | partial | failed
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_n8n_launch_runs_project
  ON public.n8n_launch_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_n8n_launch_runs_workflow
  ON public.n8n_launch_runs(project_id, workflow_key, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.n8n_launch_runs TO service_role;
