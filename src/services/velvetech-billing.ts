/**
 * Velvetech run-billing: compute + emit the per-run cost/summary row the
 * "executions history" page reads (workflow_name = 'velvetech-run-billing').
 *
 * Faithful TS port of ai-toolkit/projects/Velvetech/scripts/n8n_velvetech_run_billing.py
 * (aggregate_child_usage + helpers). That script stays the reference implementation —
 * field shapes here MUST match mapBillingResultRow() in ./supabase.ts.
 *
 * Cost model: LLM token usage comes only from n8n execution logs, so the LLM/coresignal
 * parts require N8N_API_KEY. Pricing is the PUBLIC OpenRouter /models endpoint (no key).
 * Without N8N_API_KEY the row still emits instantly (run_id/status/duration/funnel) with
 * cost_usd_total = null (warning cost_pending_no_n8n_key) — see buildBillingResult.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { N8N_WORKFLOW_RESULTS_TABLE } from "./supabase.js";

const N8N_BASE = (process.env.N8N_BASE_URL?.trim() || "https://primary-production-36cb4.up.railway.app").replace(/\/+$/, "");

export const BILLING_WORKFLOW_NAME = "velvetech-run-billing";
export const RESEARCH_PARENT_WORKFLOW_ID = "l9pGpKlzrQuCj4Yn";

// Child sub-workflows walked for token/credit usage (id -> stage tag).
// Stage tags MUST match the Python reference (p0/p1/p2/p4/p5/p6) so tokens_by_stage /
// llm_breakdown.by_stage keys are consistent with existing rows and the detail view.
const CHILD_WORKFLOWS: Record<string, string> = {
  cG1sgVDYOqSnqIvh: "p0",
  Fscz5AfDuu7nczEv: "p1",
  RXqgtQ0h9Ui1Dn6a: "p2",
  opF6RMhOj4TeQVw2: "p4",
  iUwSdJw9fYzUzMfH: "p5",
  sYrlBgFkQq0GCSv1: "p6",
};

const STAGE_WORKFLOW_NAMES: Record<string, string> = {
  icp: "velvetech-icp-gate",
  discovery: "velvetech-contact-discovery",
  enrichment: "velvetech-contact-enrichment",
  fit: "velvetech-contact-fit",
  deep: "velvetech-company-deep-research",
  pov: "velvetech-pov",
};

const CORESIGNAL_NODE_CREDITS: Record<string, [string, number]> = {
  "Coresignal employee search": ["agentic_search", 2],
  "Coresignal employee collect": ["employee_collect", 2],
  "Coresignal company search": ["agentic_search", 2],
  "Coresignal company collect": ["company_collect", 2],
  "Coresignal jobs search": ["jobs_search", 1],
};
const PARALLEL_SEARCH_NODES = new Set(["Parallel ICP Gate Search", "Parallel Velvetech Search", "Exa ICP Gate Search", "Exa Velvetech Search"]);
const PARALLEL_EXTRACT_NODES = new Set(["Parallel Velvetech Get Contents", "Exa Velvetech Get Contents"]);
const PARALLEL_USD = { search: 5.0 / 1000.0, extract: 1.0 / 1000.0 };

// Fallback node->model map (matches the build script / billing script default).
const DEFAULT_OPENROUTER_NODE_MODELS: Record<string, string> = {
  "OpenRouter Velvetech ICP Gate": "deepseek/deepseek-v4-pro",
  "OpenRouter Velvetech ICP Gate parser": "qwen/qwen3-30b-a3b-instruct-2507",
  "OpenRouter Velvetech Contact Fit": "qwen/qwen3-30b-a3b-instruct-2507",
  "OpenRouter Velvetech Contact Fit parser": "qwen/qwen3-30b-a3b-instruct-2507",
  "OpenRouter Velvetech Web": "openai/gpt-5.6-luna",
  "OpenRouter Velvetech Web parser": "qwen/qwen3-30b-a3b-instruct-2507",
  "OpenRouter Velvetech People": "openai/gpt-5.6-luna",
  "OpenRouter Velvetech People parser": "qwen/qwen3-30b-a3b-instruct-2507",
  "OpenRouter Velvetech Synthesis": "openai/gpt-5.6-luna",
  "OpenRouter Velvetech Synthesis parser": "qwen/qwen3-30b-a3b-instruct-2507",
  "OpenRouter Velvetech POV Builder": "openai/gpt-5.6-luna",
  "OpenRouter Velvetech POV Builder parser": "qwen/qwen3-30b-a3b-instruct-2507",
};

type Json = Record<string, unknown>;
type Pricing = Record<string, { prompt: number; completion: number; input_cache_read: number; input_cache_write: number }>;

// --- HTTP helpers ------------------------------------------------------------

async function httpJson(url: string, headers?: Record<string, string>): Promise<Json> {
  const r = await fetch(url, { headers: headers ?? {} });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const raw = (await r.text()).trim();
  return raw ? (JSON.parse(raw) as Json) : {};
}

function n8nHeaders(apiKey: string): Record<string, string> {
  return { "X-N8N-API-KEY": apiKey };
}

export function n8nApiKey(): string {
  return process.env.N8N_API_KEY?.trim() ?? "";
}

async function n8nGetExecution(apiKey: string, eid: string, includeData = false): Promise<Json> {
  const suffix = includeData ? "?includeData=true" : "";
  return httpJson(`${N8N_BASE}/api/v1/executions/${eid}${suffix}`, n8nHeaders(apiKey));
}

async function n8nListExecutions(apiKey: string, workflowId: string, limit = 250): Promise<Json[]> {
  const payload = await httpJson(`${N8N_BASE}/api/v1/executions?workflowId=${workflowId}&limit=${limit}`, n8nHeaders(apiKey));
  return Array.isArray(payload.data) ? (payload.data as Json[]) : [];
}

async function n8nGetWorkflow(apiKey: string, workflowId: string): Promise<Json> {
  return httpJson(`${N8N_BASE}/api/v1/workflows/${workflowId}`, n8nHeaders(apiKey));
}

// --- OpenRouter pricing (public /models; auth optional) ----------------------

let pricingCache: Pricing | null = null;

export async function fetchOpenRouterPricing(): Promise<Pricing> {
  if (pricingCache) return pricingCache;
  const key = process.env.OPENROUTER_MANAGEMENT_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim() || "";
  const headers = key ? { Authorization: `Bearer ${key}` } : undefined;
  const out: Pricing = {};
  try {
    const payload = await httpJson("https://openrouter.ai/api/v1/models", headers);
    for (const row of (payload.data as Json[]) ?? []) {
      const id = String(row.id ?? "");
      if (!id) continue;
      const p = (row.pricing as Json) ?? {};
      out[id] = {
        prompt: Number(p.prompt ?? 0) || 0,
        completion: Number(p.completion ?? 0) || 0,
        input_cache_read: Number(p.input_cache_read ?? 0) || 0,
        input_cache_write: Number(p.input_cache_write ?? 0) || 0,
      };
    }
  } catch {
    /* pricing unavailable -> costs estimate to 0, surfaced via warnings upstream */
  }
  pricingCache = out;
  return out;
}

const workflowModelCache = new Map<string, Record<string, string>>();

async function fetchWorkflowOpenRouterModels(apiKey: string, workflowId: string): Promise<Record<string, string>> {
  const cached = workflowModelCache.get(workflowId);
  if (cached) return cached;
  const models: Record<string, string> = { ...DEFAULT_OPENROUTER_NODE_MODELS };
  try {
    const wf = await n8nGetWorkflow(apiKey, workflowId);
    for (const node of (wf.nodes as Json[]) ?? []) {
      const name = String(node.name ?? "");
      if (!name.includes("OpenRouter")) continue;
      const model = String(((node.parameters as Json) ?? {}).model ?? "").trim();
      if (model) models[name] = model;
    }
  } catch {
    /* keep defaults */
  }
  workflowModelCache.set(workflowId, models);
  return models;
}

// --- token math (ports parse_token_usage / estimate_token_cost) --------------

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
  cached_tokens: number;
  cache_write_tokens: number;
}

export function parseTokenUsage(tu: Json): TokenUsage {
  const prompt = Math.trunc(num(tu.promptTokens) || num(tu.prompt_tokens));
  const completion = Math.trunc(num(tu.completionTokens) || num(tu.completion_tokens));
  const total = Math.trunc(num(tu.totalTokens) || num(tu.total_tokens) || prompt + completion);
  const details = ((tu.prompt_tokens_details ?? tu.promptTokensDetails) as Json) ?? {};
  const d = details && typeof details === "object" ? details : {};
  let cached = Math.trunc(num(tu.cachedTokens) || num(tu.cached_tokens) || num(d.cached_tokens) || num(d.cachedTokens));
  let cacheWrite = Math.trunc(num(tu.cacheWriteTokens) || num(tu.cache_write_tokens) || num(d.cache_write_tokens) || num(d.cacheWriteTokens));
  cached = Math.max(0, Math.min(cached, prompt));
  cacheWrite = Math.max(0, Math.min(cacheWrite, prompt - cached));
  return { prompt, completion, total, cached_tokens: cached, cache_write_tokens: cacheWrite };
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function estimateTokenCost(
  model: string,
  prompt: number,
  completion: number,
  pricing: Pricing,
  cachedTokens = 0,
  cacheWriteTokens = 0
): [number, number] {
  const row = pricing[model] ?? { prompt: 0, completion: 0, input_cache_read: 0, input_cache_write: 0 };
  const promptRate = row.prompt || 0;
  const completionRate = row.completion || 0;
  const cacheReadRate = row.input_cache_read || 0;
  const cacheWriteRate = row.input_cache_write || promptRate;
  const cached = Math.max(0, Math.min(Math.trunc(cachedTokens), Math.trunc(prompt)));
  const cw = Math.max(0, Math.min(Math.trunc(cacheWriteTokens), Math.trunc(prompt) - cached));
  const uncached = Math.max(0, Math.trunc(prompt) - cached - cw);
  const cacheAware = uncached * promptRate + cw * cacheWriteRate + cached * cacheReadRate + Math.trunc(completion) * completionRate;
  const naive = Math.trunc(prompt) * promptRate + Math.trunc(completion) * completionRate;
  return [round(cacheAware, 6), round(naive, 6)];
}

// --- n8n execution structure helpers -----------------------------------------

function runData(ex: Json): Record<string, Json[]> {
  const rd = (((ex.data as Json) ?? {}).resultData as Json)?.runData;
  return rd && typeof rd === "object" ? (rd as Record<string, Json[]>) : {};
}

function firstMainJson(runs: Json[]): Json {
  const main = ((runs?.[0]?.data as Json) ?? {}).main as Json[][] | undefined;
  if (main && main[0] && main[0][0]) return ((main[0][0] as Json).json as Json) ?? {};
  return {};
}

function nodeSucceeded(runs: Json[]): boolean {
  if (!runs || !runs.length) return false;
  const run = runs[0];
  if (run.executionStatus === "error") return false;
  const main = ((run.data as Json) ?? {}).main as Json[][] | undefined;
  if (main && main[0]) {
    for (const item of main[0]) if ((item as Json).error) return false;
  }
  return true;
}

function executionEntityKeys(ex: Json): { company_key: string; contact_key: string; run_id: string } {
  const out = { company_key: "", contact_key: "", run_id: "" };
  const rd = runData(ex);
  const trigger = rd["When Executed by Another Workflow"];
  if (trigger) {
    const j = firstMainJson(trigger);
    for (const k of ["company_key", "contact_key", "run_id"] as const) {
      if (j[k]) out[k] = k.endsWith("_key") ? String(j[k]).trim().toLowerCase() : String(j[k]).trim();
    }
  }
  for (const [node, runs] of Object.entries(rd)) {
    if (!node.startsWith("Normalize ")) continue;
    const j = firstMainJson(runs);
    if (j.company_key) out.company_key = String(j.company_key).trim().toLowerCase();
    if (j.contact_key) out.contact_key = String(j.contact_key).trim().toLowerCase();
    if (j.run_id) out.run_id = String(j.run_id).trim();
  }
  if (!out.company_key || !out.contact_key) {
    for (const runs of Object.values(rd)) {
      const j = firstMainJson(runs);
      if (!out.company_key && j.company_key) out.company_key = String(j.company_key).trim().toLowerCase();
      if (!out.contact_key && j.contact_key) out.contact_key = String(j.contact_key).trim().toLowerCase();
      if (!out.run_id && j.run_id) out.run_id = String(j.run_id).trim();
    }
  }
  return out;
}

interface LineItem {
  stage: string;
  node: string;
  model: string;
  entity_type: string;
  entity_key: string;
  company_key: string;
  contact_key: string;
  child_execution_id: string;
  prompt_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens_source: string;
  usd_estimated: number;
  usd_estimated_naive: number;
}

function extractLlmCalls(
  ex: Json,
  stage: string,
  childExecutionId: string,
  nodeModels: Record<string, string>,
  pricing: Pricing
): LineItem[] {
  const entity = executionEntityKeys(ex);
  const calls: LineItem[] = [];
  for (const [node, runs] of Object.entries(runData(ex))) {
    if (!node.includes("OpenRouter")) continue;
    const branch = ((runs?.[0]?.data as Json) ?? {}).ai_languageModel as Json[][] | undefined;
    if (!branch || !branch[0]) continue;
    const model = nodeModels[node] || DEFAULT_OPENROUTER_NODE_MODELS[node] || "unknown";
    for (const item of branch[0]) {
      const tu = (((item as Json).json as Json) ?? {}).tokenUsage as Json | undefined;
      if (!tu || !Object.keys(tu).length) continue;
      const u = parseTokenUsage(tu);
      const [usd, usdNaive] = estimateTokenCost(model, u.prompt, u.completion, pricing, u.cached_tokens, u.cache_write_tokens);
      const rowKey = entity.contact_key || entity.company_key || childExecutionId;
      calls.push({
        stage,
        node,
        model,
        entity_type: entity.contact_key ? "contact" : "company",
        entity_key: rowKey,
        company_key: entity.company_key,
        contact_key: entity.contact_key,
        child_execution_id: childExecutionId,
        prompt_tokens: u.prompt,
        cached_tokens: u.cached_tokens,
        cache_write_tokens: u.cache_write_tokens,
        completion_tokens: u.completion,
        total_tokens: u.total,
        cached_tokens_source: u.cached_tokens || u.cache_write_tokens ? "reported" : "none",
        usd_estimated: usd,
        usd_estimated_naive: usdNaive,
      });
    }
  }
  return calls;
}

function enrichLineItemsCacheEstimates(items: LineItem[]): void {
  const groups = new Map<string, LineItem[]>();
  for (const it of items) {
    const k = `${it.stage}|${it.node}|${it.model}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
  }
  for (const entries of groups.values()) {
    if (entries.length < 2) {
      for (const it of entries) if (!it.cached_tokens_source) it.cached_tokens_source = "none";
      continue;
    }
    entries.sort((a, b) => (a.child_execution_id || "").localeCompare(b.child_execution_id || "") || a.prompt_tokens - b.prompt_tokens);
    const prefix = Math.min(...entries.map((x) => x.prompt_tokens));
    const freshFloor = 250;
    entries.forEach((it, idx) => {
      if ((it.cached_tokens || 0) > 0) {
        it.cached_tokens_source = "reported";
        return;
      }
      const prompt = it.prompt_tokens;
      if (idx === 0) {
        it.cached_tokens = 0;
        it.cache_write_tokens = Math.max(0, Math.min(prefix, prompt - freshFloor));
        it.cached_tokens_source = "estimated";
      } else {
        it.cached_tokens = Math.max(0, Math.min(prefix, prompt - freshFloor));
        it.cached_tokens_source = "estimated";
      }
    });
  }
}

type Bucket = {
  calls: number;
  prompt_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  usd_estimated: number;
  usd_estimated_naive: number;
};

function newBucket(): Bucket {
  return { calls: 0, prompt_tokens: 0, cached_tokens: 0, cache_write_tokens: 0, completion_tokens: 0, total_tokens: 0, usd_estimated: 0, usd_estimated_naive: 0 };
}
function bumpRow(row: Bucket, it: LineItem): void {
  row.calls += 1;
  row.prompt_tokens += it.prompt_tokens;
  row.cached_tokens += it.cached_tokens || 0;
  row.cache_write_tokens += it.cache_write_tokens || 0;
  row.completion_tokens += it.completion_tokens;
  row.total_tokens += it.total_tokens;
  row.usd_estimated = round(row.usd_estimated + it.usd_estimated, 6);
  row.usd_estimated_naive = round(row.usd_estimated_naive + (it.usd_estimated_naive || it.usd_estimated), 6);
}
function bump(bucket: Record<string, Bucket>, key: string, it: LineItem): void {
  const row = bucket[key] ?? (bucket[key] = newBucket());
  bumpRow(row, it);
}

async function rollupLlmBreakdown(items: LineItem[]): Promise<Json> {
  enrichLineItemsCacheEstimates(items);
  const pricing = await fetchOpenRouterPricing();
  for (const it of items) {
    if (it.cached_tokens_source === "estimated") {
      const [usd, usdNaive] = estimateTokenCost(it.model, it.prompt_tokens, it.completion_tokens, pricing, it.cached_tokens || 0, it.cache_write_tokens || 0);
      it.usd_estimated = usd;
      it.usd_estimated_naive = usdNaive;
    }
  }
  const byStageModel: Record<string, Record<string, Bucket>> = {};
  const byModel: Record<string, Bucket> = {};
  const byStage: Record<string, Bucket> = {};
  const byCompany: Record<string, Bucket> = {};
  const byContact: Record<string, Bucket> = {};
  let totalUsd = 0;
  let totalUsdNaive = 0;
  let totalCached = 0;
  const cacheSources = new Set<string>();
  for (const it of items) {
    const sm = (byStageModel[it.stage] ??= {});
    const smRow = sm[it.model] ?? (sm[it.model] = newBucket());
    bumpRow(smRow, it);
    bump(byModel, it.model, it);
    bump(byStage, it.stage, it);
    if (it.company_key) bump(byCompany, it.company_key, it);
    if (it.contact_key) bump(byContact, it.contact_key, it);
    totalUsd += it.usd_estimated;
    totalUsdNaive += it.usd_estimated_naive || it.usd_estimated;
    totalCached += it.cached_tokens || 0;
    const src = it.cached_tokens_source || "none";
    if (src !== "none") cacheSources.add(src);
  }
  let cacheSource = "none";
  if (cacheSources.size === 1 && cacheSources.has("reported")) cacheSource = "reported";
  else if (cacheSources.has("estimated") || cacheSources.has("reported")) cacheSource = cacheSources.has("reported") ? "mixed" : "estimated";
  return {
    line_items: items,
    by_stage_model: byStageModel,
    by_model: byModel,
    by_stage: byStage,
    by_company: byCompany,
    by_contact: byContact,
    usd_estimated_total: round(totalUsd, 4),
    usd_estimated_naive_total: round(totalUsdNaive, 4),
    cache_savings_usd: round(Math.max(0, totalUsdNaive - totalUsd), 4),
    cached_tokens_total: totalCached,
    cache_tokens_source: cacheSource,
  };
}

function sumOpenRouterTokens(ex: Json): { calls: number; total: number; payment_errors: number } {
  const rd = runData(ex);
  const blob = JSON.stringify(rd);
  let paymentErrors = (blob.match(/Payment required/g) || []).length;
  let calls = 0;
  let total = 0;
  for (const [node, runs] of Object.entries(rd)) {
    if (!node.includes("OpenRouter")) continue;
    const branch = ((runs?.[0]?.data as Json) ?? {}).ai_languageModel as Json[][] | undefined;
    if (!branch || !branch[0]) continue;
    for (const item of branch[0]) {
      const tu = (((item as Json).json as Json) ?? {}).tokenUsage as Json | undefined;
      if (!tu || !Object.keys(tu).length) continue;
      const u = parseTokenUsage(tu);
      calls += 1;
      total += u.total;
    }
  }
  return { calls, total, payment_errors: paymentErrors };
}

function countBillableNodes(ex: Json): { coresignal: Record<string, number>; parallel: { search_calls: number; extract_calls: number }; prospeo_pages: number } {
  const coresignal: Record<string, number> = {};
  const parallel = { search_calls: 0, extract_calls: 0 };
  let prospeoPages = 0;
  for (const [node, runs] of Object.entries(runData(ex))) {
    if (CORESIGNAL_NODE_CREDITS[node] && nodeSucceeded(runs)) {
      const [kind, credits] = CORESIGNAL_NODE_CREDITS[node];
      coresignal[kind] = (coresignal[kind] ?? 0) + 1;
      coresignal._credits = (coresignal._credits ?? 0) + credits;
    }
    if (PARALLEL_SEARCH_NODES.has(node) && nodeSucceeded(runs)) parallel.search_calls += 1;
    if (PARALLEL_EXTRACT_NODES.has(node) && nodeSucceeded(runs)) parallel.extract_calls += 1;
    if (node === "Prospeo search person" && nodeSucceeded(runs)) prospeoPages += 1;
  }
  return { coresignal, parallel, prospeo_pages: prospeoPages };
}

// --- child usage aggregation (ports aggregate_child_usage) -------------------

export interface ChildUsage {
  child_execs: number;
  cross_run_excluded: number;
  tokens_by_stage: Record<string, number>;
  llm_calls: number;
  payment_errors: number;
  coresignal: { calls_by_type: Record<string, number>; credits_estimated: number };
  parallel: { search_calls: number; extract_calls: number; usd_estimated: number };
  prospeo: { search_pages: number };
  llm_breakdown: Json;
}

async function aggregateChildUsage(apiKey: string, parent: Json, runId: string): Promise<ChildUsage> {
  const start = String(parent.startedAt ?? "");
  const stop = String(parent.stoppedAt ?? parent.startedAt ?? "");
  const inWindow = (ts: string) => start <= ts && ts <= stop;

  const tokensByStage: Record<string, number> = {};
  let llmCalls = 0;
  let paymentErrors = 0;
  const coresignalCalls: Record<string, number> = {};
  let coresignalCredits = 0;
  const parallel = { search_calls: 0, extract_calls: 0 };
  let prospeoPages = 0;
  let childExecs = 0;
  let crossRunExcluded = 0;
  const lineItems: LineItem[] = [];
  const pricing = await fetchOpenRouterPricing();

  for (const [wfId, stage] of Object.entries(CHILD_WORKFLOWS)) {
    const hits = (await n8nListExecutions(apiKey, wfId)).filter((e) => inWindow(String(e.startedAt ?? "")));
    const nodeModels = await fetchWorkflowOpenRouterModels(apiKey, wfId);
    let stageTokens = 0;
    for (const hit of hits) {
      const eid = String(hit.id);
      const ex = await n8nGetExecution(apiKey, eid, true);
      if (runId) {
        const childRunId = executionEntityKeys(ex).run_id || "";
        if (childRunId && childRunId !== runId) {
          crossRunExcluded += 1;
          continue;
        }
      }
      childExecs += 1;
      const tok = sumOpenRouterTokens(ex);
      llmCalls += tok.calls;
      stageTokens += tok.total;
      paymentErrors += tok.payment_errors;
      lineItems.push(...extractLlmCalls(ex, stage, eid, nodeModels, pricing));
      const bill = countBillableNodes(ex);
      for (const [k, v] of Object.entries(bill.coresignal)) {
        if (k === "_credits") coresignalCredits += v;
        else coresignalCalls[k] = (coresignalCalls[k] ?? 0) + v;
      }
      parallel.search_calls += bill.parallel.search_calls;
      parallel.extract_calls += bill.parallel.extract_calls;
      prospeoPages += bill.prospeo_pages;
    }
    if (stageTokens) tokensByStage[stage] = stageTokens;
  }

  const parallelUsd = parallel.search_calls * PARALLEL_USD.search + parallel.extract_calls * PARALLEL_USD.extract;
  const llmBreakdown = await rollupLlmBreakdown(lineItems);
  return {
    child_execs: childExecs,
    cross_run_excluded: crossRunExcluded,
    tokens_by_stage: tokensByStage,
    llm_calls: llmCalls,
    payment_errors: paymentErrors,
    coresignal: { calls_by_type: coresignalCalls, credits_estimated: coresignalCredits },
    parallel: { ...parallel, usd_estimated: round(parallelUsd, 4) },
    prospeo: { search_pages: prospeoPages },
    llm_breakdown: llmBreakdown,
  };
}

/** Fetch a parent execution and return its child usage (no DB). Mirrors py --analyze-parent. */
export async function analyzeParentUsage(executionId: string, runId: string): Promise<ChildUsage> {
  const apiKey = n8nApiKey();
  if (!apiKey) throw new Error("N8N_API_KEY required");
  const parent = await n8nGetExecution(apiKey, executionId, false);
  return aggregateChildUsage(apiKey, parent, runId);
}

// --- funnel (from the app's own result rows; ports fetch_funnel_from_voitech) -

async function fetchFunnel(client: SupabaseClient, runId: string): Promise<{ funnel: Record<string, number>; warnings: string[] }> {
  const funnel: Record<string, number> = {
    companies_icp: 0,
    companies_discovery: 0,
    contacts_enriched: 0,
    contacts_fit_scored: 0,
    contacts_high_medium: 0,
    companies_deep: 0,
    companies_pov: 0,
    companies_pov_ok: 0,
  };
  const warnings: string[] = [];
  const { data, error } = await client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("workflow_name,result")
    .or(`result->>run_id.eq.${runId},result->>launch_id.eq.${runId}`)
    .limit(5000);
  if (error) {
    warnings.push(`funnel_fetch_failed:${error.message}`);
    return { funnel, warnings };
  }
  for (const row of (data ?? []) as Json[]) {
    const j = (row.result as Json) ?? {};
    const wf = String(j.workflow_name ?? row.workflow_name ?? "");
    if (wf === STAGE_WORKFLOW_NAMES.icp) funnel.companies_icp += 1;
    else if (wf === STAGE_WORKFLOW_NAMES.discovery) funnel.companies_discovery += 1;
    else if (wf === STAGE_WORKFLOW_NAMES.enrichment) funnel.contacts_enriched += 1;
    else if (wf === STAGE_WORKFLOW_NAMES.fit) {
      funnel.contacts_fit_scored += 1;
      if (["high", "medium"].includes(String(j.fit ?? ""))) funnel.contacts_high_medium += 1;
    } else if (wf === STAGE_WORKFLOW_NAMES.deep) funnel.companies_deep += 1;
    else if (wf === STAGE_WORKFLOW_NAMES.pov) {
      funnel.companies_pov += 1;
      if (j.pov_ok === true) funnel.companies_pov_ok += 1;
    }
  }
  return { funnel, warnings };
}

function durationFromParent(parent: Json): number {
  const started = String(parent.startedAt ?? "");
  const stopped = String(parent.stoppedAt ?? started);
  const a = Date.parse(started);
  const b = Date.parse(stopped);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 1000));
}

// --- top-level build + emit --------------------------------------------------

export interface BuildBillingArgs {
  /** Supabase client for the funnel query. Optional if `funnel` is supplied directly. */
  client?: SupabaseClient | null;
  runId: string;
  /** Parent n8n execution id; enables the cost figure. Omit for keyless instant emit. */
  executionId?: string | null;
  /** Fallback duration when there is no n8n key: launch created->finished, in seconds. */
  fallbackDurationSec?: number | null;
  /** Fallback status (from the launch record) when the parent execution can't be read. */
  fallbackStatus?: string | null;
  /** Pre-fetched funnel (e.g. from a local/MCP query) to use instead of querying the client. */
  funnel?: Record<string, number>;
}

export interface BuiltBilling {
  result: Json;
  executionId: string | null;
  /** created_at to stamp on the row so history sorts by run time, not insert time. */
  createdAt?: string | null;
}

/** Assemble the `result` payload for one velvetech-run-billing row (mapBillingResultRow shape). */
export async function buildBillingResult(args: BuildBillingArgs): Promise<BuiltBilling> {
  const { runId } = args;
  const apiKey = n8nApiKey();
  const { funnel, warnings } = args.funnel
    ? { funnel: args.funnel, warnings: [] as string[] }
    : args.client
      ? await fetchFunnel(args.client, runId)
      : { funnel: {} as Record<string, number>, warnings: ["funnel_unavailable_no_client"] };

  let parent: Json | null = null;
  if (apiKey && args.executionId) {
    try {
      parent = await n8nGetExecution(apiKey, args.executionId, false);
    } catch (e) {
      warnings.push(`parent_fetch_failed:${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Keyless / no-parent path: still emit an instant row (status/duration/funnel).
  if (!apiKey || !parent) {
    if (!apiKey) warnings.push("cost_pending_no_n8n_key");
    const result: Json = {
      workflow_name: BILLING_WORKFLOW_NAME,
      entity_key: runId,
      run_id: runId,
      parent_execution_id: args.executionId ?? null,
      status: String(args.fallbackStatus ?? "success"),
      duration_sec: args.fallbackDurationSec ?? null,
      billing: null,
      tokens_by_stage: null,
      llm_breakdown: null,
      funnel,
      cost_usd_total: null,
      warnings,
      persisted_at: new Date().toISOString(),
    };
    return { result, executionId: args.executionId ?? null };
  }

  const usage = await aggregateChildUsage(apiKey, parent, runId);
  if (usage.payment_errors) warnings.push("openrouter_payment_errors");
  if (usage.cross_run_excluded) warnings.push(`cross_run_child_execs_excluded:${usage.cross_run_excluded}`);
  warnings.push("cost_llm_token_estimated"); // app uses token-estimate (no balance delta)

  const llm = usage.llm_breakdown as { usd_estimated_total?: number };
  const parallelUsd = Number(usage.parallel.usd_estimated) || 0;
  const costTotal = round((Number(llm.usd_estimated_total) || 0) + parallelUsd, 4);

  const result: Json = {
    workflow_name: BILLING_WORKFLOW_NAME,
    entity_key: runId,
    run_id: runId,
    parent_execution_id: String(parent.id ?? args.executionId ?? ""),
    status: String(parent.status ?? args.fallbackStatus ?? "unknown"),
    duration_sec: durationFromParent(parent),
    billing: {
      openrouter: { llm_calls: usage.llm_calls, payment_errors: usage.payment_errors, usd_estimated_from_tokens: llm.usd_estimated_total ?? null },
      prospeo: { search_pages: usage.prospeo.search_pages },
      coresignal: usage.coresignal,
      parallel: usage.parallel,
    },
    tokens_by_stage: usage.tokens_by_stage,
    llm_breakdown: usage.llm_breakdown,
    funnel,
    cost_usd_total: costTotal,
    warnings,
    persisted_at: new Date().toISOString(),
  };
  // created_at should reflect the run time, not insert time (accurate history ordering).
  const createdAt = String(parent.stoppedAt ?? parent.startedAt ?? "") || null;
  return { result, executionId: String(parent.id ?? args.executionId ?? ""), createdAt };
}

/** Idempotent: replace any existing billing row(s) for this run_id with one fresh row. */
export async function emitBillingRow(
  client: SupabaseClient,
  args: { result: Json; executionId: string | null; createdAt?: string | null }
): Promise<{ ok: boolean; error?: string }> {
  const runId = String((args.result as Json).run_id ?? "");
  if (!runId) return { ok: false, error: "missing run_id" };
  await client.from(N8N_WORKFLOW_RESULTS_TABLE).delete().eq("workflow_name", BILLING_WORKFLOW_NAME).eq("result->>run_id", runId);
  const insert: Json = {
    workflow_name: BILLING_WORKFLOW_NAME,
    execution_id: args.executionId,
    contact_id: null,
    company_id: null,
    result: args.result,
    updated_at: new Date().toISOString(),
  };
  if (args.createdAt) insert.created_at = args.createdAt;
  const { error } = await client.from(N8N_WORKFLOW_RESULTS_TABLE).insert(insert);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Convenience: build + emit for a run. Returns ok even on keyless path (row still emitted). */
export async function computeAndEmitBilling(args: BuildBillingArgs): Promise<{ ok: boolean; error?: string; costed: boolean }> {
  if (!args.client) return { ok: false, error: "client required to emit", costed: false };
  const built = await buildBillingResult(args);
  const emit = await emitBillingRow(args.client, built);
  const costed = (built.result as Json).cost_usd_total != null;
  return { ...emit, costed };
}

/** Research parent executions (optionally only those lacking a billing row) for backfill. */
export async function findResearchParentsMissingBilling(client: SupabaseClient, limit = 100): Promise<Array<{ executionId: string; runId: string }>> {
  const apiKey = n8nApiKey();
  if (!apiKey) return [];
  const execs = await n8nListExecutions(apiKey, RESEARCH_PARENT_WORKFLOW_ID, limit);
  const out: Array<{ executionId: string; runId: string }> = [];
  const { data: billed } = await client.from(N8N_WORKFLOW_RESULTS_TABLE).select("result").eq("workflow_name", BILLING_WORKFLOW_NAME).limit(5000);
  const billedRunIds = new Set(((billed ?? []) as Json[]).map((r) => String(((r.result as Json) ?? {}).run_id ?? "")));
  for (const ex of execs) {
    if (ex.finished !== true) continue;
    const eid = String(ex.id);
    try {
      const full = await n8nGetExecution(apiKey, eid, true);
      const runId = executionEntityKeys(full).run_id;
      if (!runId || billedRunIds.has(runId)) continue;
      out.push({ executionId: eid, runId });
    } catch {
      /* skip unreadable execution */
    }
  }
  return out;
}
