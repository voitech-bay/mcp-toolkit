-- Lead-views qualification marker (Feasible company-bundle view). Stored on the existing
-- companies table (no new table) — the decision is per-company. ADDITIVE ONLY.
-- Apply once against the Supabase project. Rollback: drop the two columns.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS qualification_status text,      -- approved | refused | pending (manual lead-views decision)
  ADD COLUMN IF NOT EXISTS qualification_decided_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_companies_qualification_status
  ON public.companies(qualification_status);
