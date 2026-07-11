export type VelvetechChannel = "email" | "linkedin_dm" | "inmail" | "reply";
export type VelvetechSequenceMode = "standard" | "cfo";

export const VELVETECH_PROJECT_ID = "51cc22a1-868e-42c4-974f-9a7c5f5dce20";

export function isVelvetechProjectId(projectId: unknown): projectId is string {
  return typeof projectId === "string" && projectId.toLowerCase() === VELVETECH_PROJECT_ID;
}
