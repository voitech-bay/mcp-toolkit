-- Lead-views review state: approve / refuse decisions on research results.
-- ADDITIVE ONLY. Creates 1 new table + indexes. No changes to existing tables.
-- Apply once against the Supabase project (SQL editor or MCP apply_migration).
-- Rollback: DROP TABLE public.lead_review_state CASCADE;

CREATE TABLE IF NOT EXISTS public.lead_review_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL UNIQUE
    REFERENCES public.n8n_workflow_results(id) ON DELETE CASCADE,
  lead_uuid text,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | refused
  reason text,
  decided_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_review_state_status
  ON public.lead_review_state(status);
CREATE INDEX IF NOT EXISTS idx_lead_review_state_lead
  ON public.lead_review_state(lead_uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_review_state TO service_role;
