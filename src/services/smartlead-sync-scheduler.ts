import { getProjects, getSupabase } from "./supabase.js";
import { loadSmartleadCampaignMap, syncSmartleadCampaignSends, type CampaignSyncSummary } from "./smartlead-reconcile.js";

/**
 * Hourly sweep that keeps Email Studio in step with what Smartlead actually sent.
 *
 * On by default whenever SMARTLEAD_API_KEY is set; SMARTLEAD_SCHEDULED_SYNC_ENABLED=false
 * turns it off, SMARTLEAD_SCHEDULED_SYNC_INTERVAL_MINUTES changes the cadence. Campaign
 * membership per project comes from gtm_flow_source_map, so adding a campaign there is the
 * whole onboarding step.
 */
export interface SmartleadSyncConfig {
  enabled: boolean;
  intervalMs: number;
}

export function getSmartleadSyncConfig(env: NodeJS.ProcessEnv = process.env): SmartleadSyncConfig {
  const hasKey = Boolean(String(env.SMARTLEAD_API_KEY ?? "").trim());
  const flag = String(env.SMARTLEAD_SCHEDULED_SYNC_ENABLED ?? "").trim();
  const disabled = /^(0|false|no|off)$/i.test(flag);
  const minutes = Number.parseInt(env.SMARTLEAD_SCHEDULED_SYNC_INTERVAL_MINUTES ?? "", 10);
  return {
    enabled: hasKey && !disabled,
    intervalMs: (Number.isInteger(minutes) && minutes >= 5 ? minutes : 60) * 60 * 1000,
  };
}

export function summarizeCampaignSync(campaigns: CampaignSyncSummary[]): {
  campaigns: number;
  sends: number;
  inserted: number;
  updated: number;
  skipped: number;
  contactsCreated: number;
  withoutSnapshot: number;
  errors: number;
} {
  return campaigns.reduce(
    (acc, c) => ({
      campaigns: acc.campaigns + 1,
      sends: acc.sends + c.sentRows,
      inserted: acc.inserted + c.inserted,
      updated: acc.updated + c.updated,
      skipped: acc.skipped + c.skipped,
      contactsCreated: acc.contactsCreated + c.contactsCreated,
      withoutSnapshot: acc.withoutSnapshot + c.withoutSnapshot,
      errors: acc.errors + c.errors.length,
    }),
    { campaigns: 0, sends: 0, inserted: 0, updated: 0, skipped: 0, contactsCreated: 0, withoutSnapshot: 0, errors: 0 }
  );
}

let running = false;
let timer: ReturnType<typeof setInterval> | undefined;

export async function runScheduledSmartleadSync(config = getSmartleadSyncConfig()): Promise<void> {
  if (!config.enabled || running) return;
  running = true;
  const startedMs = Date.now();
  try {
    const client = getSupabase();
    if (!client) throw new Error("Supabase is not configured");
    const projects = await getProjects(client);
    if (projects.error) throw new Error(projects.error);
    for (const project of projects.data) {
      const campaigns = await loadSmartleadCampaignMap(client, project.id);
      if (!campaigns.length) continue;
      try {
        const result = await syncSmartleadCampaignSends({ projectId: project.id, campaigns, apply: true });
        const totals = summarizeCampaignSync(result.campaigns);
        console.log(`[smartlead-sync] ${project.name}`, JSON.stringify(totals));
        for (const c of result.campaigns) {
          for (const err of c.errors) console.error(`[smartlead-sync] ${project.name} campaign ${c.campaignId} ${err.email} step ${err.step}: ${err.error}`);
        }
      } catch (error) {
        console.error(`[smartlead-sync] ${project.name}:`, error);
      }
    }
    console.log(`[smartlead-sync] cycle done in ${Date.now() - startedMs}ms`);
  } catch (error) {
    console.error("[smartlead-sync] cycle failed:", error);
  } finally {
    running = false;
  }
}

export function startScheduledSmartleadSync(): void {
  const config = getSmartleadSyncConfig();
  if (!config.enabled || timer) return;
  console.log(`[smartlead-sync] enabled every ${config.intervalMs / 60000} min`);
  // First pass after a short delay so boot-time work (GetSales sync, reaper) is not competing.
  const first = setTimeout(() => void runScheduledSmartleadSync(), 30_000);
  first.unref?.();
  timer = setInterval(() => void runScheduledSmartleadSync(), config.intervalMs);
  timer.unref?.();
}

export function stopScheduledSmartleadSync(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
