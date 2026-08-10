import { randomUUID } from "node:crypto";
import {
  hermesChatCompletions,
  type HermesChatMessage,
  type HermesChatResult,
} from "./hermes.js";

export type HermesJobStatus = "queued" | "running" | "complete" | "failed";

export type HermesJob = {
  id: string;
  status: HermesJobStatus;
  stage: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  progress: number;
  model: string | null;
  content: string | null;
  usage: Record<string, unknown> | null;
  stages: unknown[];
  degradedReasons: string[];
  error: string | null;
};

export type StartHermesJobInput = {
  messages: HermesChatMessage[];
  model?: string;
  temperature?: number;
  sessionId?: string;
  sessionKey?: string;
};

const MAX_JOBS = 100;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const jobs = new Map<string, HermesJob>();

function isoNow(): string {
  return new Date().toISOString();
}

function snapshot(job: HermesJob): HermesJob {
  return structuredClone(job);
}

function pruneJobs(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (Date.parse(job.updatedAt) < cutoff) jobs.delete(id);
  }
  if (jobs.size <= MAX_JOBS) return;
  const oldest = [...jobs.values()]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(0, jobs.size - MAX_JOBS);
  for (const job of oldest) jobs.delete(job.id);
}

export function parseResearchMetadata(content: string): {
  stages: unknown[];
  degradedReasons: string[];
} {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { stages: [], degradedReasons: [] };
    }
    const obj = parsed as Record<string, unknown>;
    const stages = Array.isArray(obj.stages) ? obj.stages : [];
    const degradedReasons = stages.flatMap((stage) => {
      if (!stage || typeof stage !== "object" || Array.isArray(stage)) return [];
      const reasons = (stage as Record<string, unknown>).degraded_reasons;
      return Array.isArray(reasons) ? reasons.filter((item): item is string => typeof item === "string") : [];
    });
    return { stages, degradedReasons: [...new Set(degradedReasons)] };
  } catch {
    return { stages: [], degradedReasons: [] };
  }
}

async function executeJob(id: string, input: StartHermesJobInput): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  const startedAt = isoNow();
  Object.assign(job, {
    status: "running" as const,
    stage: "hermes_research",
    startedAt,
    updatedAt: startedAt,
    progress: 10,
  });

  try {
    const result: HermesChatResult = await hermesChatCompletions({
      ...input,
      timeoutMs: 900_000,
    });
    const metadata = parseResearchMetadata(result.content);
    const completedAt = isoNow();
    Object.assign(job, {
      status: "complete" as const,
      stage: "complete",
      updatedAt: completedAt,
      completedAt,
      progress: 100,
      model: result.model,
      content: result.content,
      usage: result.usage,
      stages: metadata.stages,
      degradedReasons: metadata.degradedReasons,
    });
  } catch (error) {
    const completedAt = isoNow();
    Object.assign(job, {
      status: "failed" as const,
      stage: "failed",
      updatedAt: completedAt,
      completedAt,
      progress: 100,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function startHermesJob(input: StartHermesJobInput): HermesJob {
  pruneJobs();
  const now = isoNow();
  const job: HermesJob = {
    id: randomUUID(),
    status: "queued",
    stage: "queued",
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    progress: 0,
    model: null,
    content: null,
    usage: null,
    stages: [],
    degradedReasons: [],
    error: null,
  };
  jobs.set(job.id, job);
  void executeJob(job.id, input);
  return snapshot(job);
}

export function getHermesJob(id: string): HermesJob | null {
  pruneJobs();
  const job = jobs.get(id);
  return job ? snapshot(job) : null;
}

export function clearHermesJobsForTests(): void {
  jobs.clear();
}
