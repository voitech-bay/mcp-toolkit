-- InMail review feature: review overlay on top of public.n8n_workflow_results.
-- ADDITIVE ONLY. Creates 3 new tables + indexes. No changes to existing tables.
-- Apply once against the Supabase project (SQL editor or MCP apply_migration).
-- Rollback: DROP TABLE inmail_review_comments, inmail_review_versions, inmail_review_state CASCADE;

CREATE TABLE IF NOT EXISTS public.inmail_review_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL UNIQUE
    REFERENCES public.n8n_workflow_results(id) ON DELETE CASCADE,
  lead_uuid text,
  workflow text,
  pipeline text,                       -- 'inmail' | 'followup' (from posted marker, fallback inferred)
  status text NOT NULL DEFAULT 'pending', -- pending | approved | pushed | skipped
  current_version_id uuid,
  push_log jsonb,                      -- last dry-run / push response for audit
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inmail_review_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL
    REFERENCES public.n8n_workflow_results(id) ON DELETE CASCADE,
  subject text,
  body text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'n8n',  -- 'n8n' | 'regenerated'
  model text,
  prompt_version text,
  feedback_used text,
  violations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inmail_review_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL
    REFERENCES public.n8n_workflow_results(id) ON DELETE CASCADE,
  version_id uuid,                     -- nullable: comment may predate a regenerate
  kind text NOT NULL DEFAULT 'general', -- 'inline' | 'general'
  quoted_text text,
  char_start int,
  char_end int,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inmail_review_versions_result
  ON public.inmail_review_versions(result_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inmail_review_comments_result
  ON public.inmail_review_comments(result_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inmail_review_state_status
  ON public.inmail_review_state(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.inmail_review_state,
  public.inmail_review_versions,
  public.inmail_review_comments
TO service_role;
