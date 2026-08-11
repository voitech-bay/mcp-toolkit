/** Well-known Supabase project ids (matches server n8n-trigger / feasible-context). */
export const FEASIBLE_PROJECT_ID = "94dc3b92-1cae-4360-a958-917a58063309";
export const VELVETECH_PROJECT_ID = "51cc22a1-868e-42c4-974f-9a7c5f5dce20";
export const WELLORE_PROJECT_ID = "0038d0db-aab2-40f1-9f6e-38d38e157f8f";

export function isFeasibleProjectId(projectId: string | null | undefined): boolean {
  return projectId === FEASIBLE_PROJECT_ID;
}

export function isVelvetechProjectId(projectId: string | null | undefined): boolean {
  return projectId === VELVETECH_PROJECT_ID;
}

export function isWelloreProjectId(projectId: string | null | undefined): boolean {
  return typeof projectId === "string" && projectId.toLowerCase() === WELLORE_PROJECT_ID;
}
