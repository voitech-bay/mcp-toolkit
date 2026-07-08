import { getProjects, getSupabase } from "./supabase.js";
import { syncSupabaseFromSource } from "./sync-supabase.js";

export interface ScheduledSyncConfig {
  enabled: boolean;
  timeZone: string;
  startHour: number;
  endHour: number;
}

export function getScheduledSyncConfig(env: NodeJS.ProcessEnv = process.env): ScheduledSyncConfig {
  const hour = (name: string, fallback: number) => {
    const parsed = Number.parseInt(env[name] ?? "", 10);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : fallback;
  };
  return {
    enabled: /^(1|true|yes)$/i.test(env.GETSALES_SCHEDULED_SYNC_ENABLED ?? ""),
    timeZone: env.GETSALES_SCHEDULED_SYNC_TIMEZONE?.trim() || "Europe/Lisbon",
    startHour: hour("GETSALES_SCHEDULED_SYNC_START_HOUR", 8),
    endHour: hour("GETSALES_SCHEDULED_SYNC_END_HOUR", 20),
  };
}

export function localHour(now: Date, timeZone: string): number {
  const value = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now);
  return Number.parseInt(value, 10);
}

export function isInsideScheduledWindow(now: Date, config: ScheduledSyncConfig): boolean {
  const hour = localHour(now, config.timeZone);
  return hour >= config.startHour && hour <= config.endHour;
}

let running = false;
let timer: ReturnType<typeof setInterval> | undefined;

export async function runScheduledGetSalesSync(now = new Date()): Promise<void> {
  const config = getScheduledSyncConfig();
  if (!config.enabled || !isInsideScheduledWindow(now, config) || running) return;
  running = true;
  try {
    const client = getSupabase();
    if (!client) throw new Error("Supabase is not configured");
    const projects = await getProjects(client);
    if (projects.error) throw new Error(projects.error);
    for (const project of projects.data.filter((item) => item.api_key_set)) {
      try {
        const result = await syncSupabaseFromSource(project.id);
        if (result.error) console.error(`[scheduled-sync] ${project.name}: ${result.error}`);
      } catch (error) {
        console.error(`[scheduled-sync] ${project.name}:`, error);
      }
    }
  } finally {
    running = false;
  }
}

export function startScheduledGetSalesSync(): void {
  const config = getScheduledSyncConfig();
  if (!config.enabled || timer) return;
  console.log(`[scheduled-sync] enabled hourly ${config.startHour}:00-${config.endHour}:00 ${config.timeZone}`);
  void runScheduledGetSalesSync();
  timer = setInterval(() => void runScheduledGetSalesSync(), 60 * 60 * 1000);
  timer.unref?.();
}
