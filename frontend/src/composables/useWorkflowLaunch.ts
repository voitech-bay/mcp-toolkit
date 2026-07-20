import { ref, computed } from "vue";
import { useMessage, useDialog } from "naive-ui";
import { useProjectStore } from "../stores/project";

interface ExistingResearchInfo {
  domain: string;
  companyName: string | null;
  lastRunAt: string;
  runCount: number;
}

export interface LaunchableWorkflow {
  key: string;
  label: string;
  project: string;
  adapter: string;
  configured: boolean;
}

const VELVETECH_RESEARCH = "velvetech_research";
const VELVETECH_REPLY = "velvetech_reply";

export function useWorkflowLaunch() {
  const projectStore = useProjectStore();
  const message = useMessage();
  const dialog = useDialog();
  const launching = ref(false);
  const workflows = ref<LaunchableWorkflow[]>([]);

  const projectId = computed(() => projectStore.selectedProjectId);

  async function loadWorkflows(): Promise<void> {
    const pid = projectId.value;
    if (!pid) {
      workflows.value = [];
      return;
    }
    const r = await fetch(`/api/n8n/workflows?projectId=${encodeURIComponent(pid)}`);
    const data = (await r.json()) as { items?: LaunchableWorkflow[]; error?: string };
    workflows.value = r.ok ? (data.items ?? []) : [];
  }

  function workflowByKey(key: string): LaunchableWorkflow | undefined {
    return workflows.value.find((w) => w.key === key);
  }

  function isConfigured(key: string): boolean {
    return workflowByKey(key)?.configured ?? false;
  }

  function confirmRerun(info: ExistingResearchInfo[]): Promise<boolean> {
    const names = info
      .map((c) => c.companyName || c.domain)
      .filter(Boolean)
      .slice(0, 5)
      .join(", ");
    const more = info.length > 5 ? ` and ${info.length - 5} more` : "";
    const noun = info.length === 1 ? "company already has" : "companies already have";
    return new Promise<boolean>((resolve) => {
      dialog.warning({
        title: "Already researched",
        content: `${info.length} ${noun} research on file (${names}${more}). Running again creates a new research run with its own cost. Re-run anyway?`,
        positiveText: "Re-run",
        negativeText: "Cancel",
        onPositiveClick: () => resolve(true),
        onNegativeClick: () => resolve(false),
        onClose: () => resolve(false),
        onMaskClick: () => resolve(false),
      });
    });
  }

  async function launch(
    workflowKey: string,
    leadUuids: string[],
    options?: { sourceListUuid?: string | null; successMessage?: string; force?: boolean }
  ): Promise<string | null> {
    const pid = projectId.value;
    if (!pid) {
      message.warning("Select a project in the top-left corner");
      return null;
    }
    const uuids = [...new Set(leadUuids.map((u) => u.trim()).filter(Boolean))];
    if (uuids.length === 0) {
      message.warning("No contacts selected to launch");
      return null;
    }
    const wf = workflowByKey(workflowKey);
    if (!wf) {
      message.error("Workflow not available for the selected project");
      return null;
    }
    if (!wf.configured) {
      message.error(`${wf.label} webhook is not configured`);
      return null;
    }

    launching.value = true;
    try {
      const body: Record<string, unknown> = {
        projectId: pid,
        workflowKey,
        leadUuids: uuids,
      };
      if (options?.sourceListUuid) body.sourceListUuid = options.sourceListUuid;
      if (options?.force) body.force = true;

      const r = await fetch("/api/n8n/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await r.json()) as {
        launchId?: string;
        error?: string;
        gated?: boolean;
        alreadyResearched?: ExistingResearchInfo[];
      };
      // Skip gate: the company already has research. Ask, then re-launch with force.
      if (r.status === 409 && data.gated) {
        launching.value = false;
        const confirmed = await confirmRerun(data.alreadyResearched ?? []);
        if (!confirmed) return null;
        return await launch(workflowKey, leadUuids, { ...options, force: true });
      }
      if (!r.ok || !data.launchId) throw new Error(data.error ?? "Launch failed");

      message.success(
        options?.successMessage ??
          `Launched ${wf.label} for ${uuids.length} contact${uuids.length === 1 ? "" : "s"}. Results appear here in a few minutes.`
      );
      return data.launchId;
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Launch failed");
      return null;
    } finally {
      launching.value = false;
    }
  }

  async function launchVelvetechResearch(leadUuids: string[]): Promise<string | null> {
    return launch(VELVETECH_RESEARCH, leadUuids);
  }

  async function launchVelvetechReply(leadUuids: string[]): Promise<string | null> {
    return launch(VELVETECH_REPLY, leadUuids, {
      successMessage: `Draft reply started for ${leadUuids.length} contact${leadUuids.length === 1 ? "" : "s"}. Review in Email Studio → LinkedIn.`,
    });
  }

  return {
    launching,
    workflows,
    projectId,
    loadWorkflows,
    launch,
    launchVelvetechResearch,
    launchVelvetechReply,
    isConfigured,
    velvetechResearchKey: VELVETECH_RESEARCH,
    velvetechReplyKey: VELVETECH_REPLY,
  };
}
