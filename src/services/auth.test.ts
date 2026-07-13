import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessage } from "node:http";
import { isN8nMachineAuth, isN8nWorkflowResultsMachineAuth } from "./auth.js";

function req(method: string, authorization?: string): IncomingMessage {
  return {
    method,
    headers: authorization ? { authorization } : {},
  } as IncomingMessage;
}

test("n8n machine auth accepts workflow results, ingest, and GetSales push paths", () => {
  process.env.N8N_WORKFLOW_RESULTS_SECRET = "machine-secret";
  const authed = req("POST", "Bearer machine-secret");

  assert.equal(isN8nMachineAuth(authed, "/api/n8n/workflow-results"), true);
  assert.equal(isN8nMachineAuth(authed, "/api/email-studio/ingest-from-n8n"), true);
  assert.equal(isN8nMachineAuth(authed, "/api/email-studio/push-getsales-linkedin-sequence"), true);
});

test("n8n machine auth rejects wrong method, path, missing secret, and bad token", () => {
  process.env.N8N_WORKFLOW_RESULTS_SECRET = "machine-secret";

  assert.equal(isN8nMachineAuth(req("GET", "Bearer machine-secret"), "/api/email-studio/ingest-from-n8n"), false);
  assert.equal(isN8nMachineAuth(req("POST", "Bearer machine-secret"), "/api/email-studio/emails"), false);
  assert.equal(isN8nMachineAuth(req("POST", "Bearer wrong"), "/api/email-studio/ingest-from-n8n"), false);

  delete process.env.N8N_WORKFLOW_RESULTS_SECRET;
  assert.equal(isN8nMachineAuth(req("POST", "Bearer machine-secret"), "/api/email-studio/ingest-from-n8n"), false);
});

test("legacy workflow-results helper delegates to the shared n8n machine auth", () => {
  process.env.N8N_WORKFLOW_RESULTS_SECRET = "machine-secret";
  assert.equal(
    isN8nWorkflowResultsMachineAuth(req("POST", "Bearer machine-secret"), "/api/n8n/workflow-results"),
    true,
  );
});
