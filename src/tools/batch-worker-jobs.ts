import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createBatchWorkerJob,
  getBatchWorkerJobResults,
  getBatchWorkerJobStatus,
  isBatchWorkerEnabled,
  previewBatchWorkerMapping,
  publishBatchWorkerResults
} from "../services/batch-worker-client.js";

const rowSchema = z.record(z.unknown());

function batchWorkerUnavailable() {
  return {
    content: [
      {
        type: "text" as const,
        text: "Batch worker API is unavailable. Set BATCH_WORKER_API_BASE_URL in mcp-toolkit environment."
      }
    ],
    isError: true
  };
}

export function registerBatchWorkerJobTools(server: McpServer): void {
  server.tool(
    "create_batch_job",
    "Create a batch-worker job from source rows. Requires entityType and sourceRows.",
    {
      tenantId: z.string().optional().describe("Tenant identifier for multi-tenant isolation."),
      projectId: z.string().optional().describe("Project identifier used for grouping jobs."),
      entityType: z.enum(["contacts", "companies"]).describe("Target entity type for mapping/publish."),
      prompt: z.string().optional().describe("Prompt template or enrichment instruction."),
      mappingProfileId: z.string().optional().describe("Optional mapping profile identifier."),
      metadata: z.record(z.unknown()).optional().describe("Free-form metadata stored with the job."),
      sourceRows: z.array(rowSchema).min(1).describe("CSV-derived source rows to process."),
      batchSize: z.number().int().min(1).max(200).optional().describe("Initial row count per batch.")
    },
    async (args) => {
      if (!isBatchWorkerEnabled()) return batchWorkerUnavailable();
      try {
        const created = await createBatchWorkerJob({
          tenantId: args.tenantId,
          projectId: args.projectId ?? null,
          entityType: args.entityType,
          prompt: args.prompt,
          mappingProfileId: args.mappingProfileId ?? null,
          metadata: args.metadata,
          sourceRows: args.sourceRows,
          batchSize: args.batchSize
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(created, null, 2) }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "get_batch_job_status",
    "Get batch-worker job status/details by job ID.",
    {
      jobId: z.string().min(1).describe("Job ID returned by create_batch_job.")
    },
    async (args) => {
      if (!isBatchWorkerEnabled()) return batchWorkerUnavailable();
      try {
        const status = await getBatchWorkerJobStatus(args.jobId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "get_batch_job_results",
    "Get raw rows, mapping rows, and publish events for a batch-worker job.",
    {
      jobId: z.string().min(1).describe("Job ID returned by create_batch_job.")
    },
    async (args) => {
      if (!isBatchWorkerEnabled()) return batchWorkerUnavailable();
      try {
        const results = await getBatchWorkerJobResults(args.jobId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "preview_batch_mapping",
    "Preview result mapping to target schema before publish.",
    {
      jobId: z.string().min(1).describe("Job ID returned by create_batch_job.")
    },
    async (args) => {
      if (!isBatchWorkerEnabled()) return batchWorkerUnavailable();
      try {
        const preview = await previewBatchWorkerMapping(args.jobId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "publish_batch_results",
    "Publish mapped rows for a batch-worker job into main DB target.",
    {
      jobId: z.string().min(1).describe("Job ID returned by create_batch_job.")
    },
    async (args) => {
      if (!isBatchWorkerEnabled()) return batchWorkerUnavailable();
      try {
        const published = await publishBatchWorkerResults(args.jobId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(published, null, 2) }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );
}
