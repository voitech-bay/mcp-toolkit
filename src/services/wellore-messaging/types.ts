export type WelloreChannel = "email" | "linkedin_dm";

export const WELLORE_PROJECT_ID = "0038d0db-aab2-40f1-9f6e-38d38e157f8f";

export function isWelloreProjectId(projectId: unknown): projectId is string {
  return typeof projectId === "string" && projectId.toLowerCase() === WELLORE_PROJECT_ID;
}
