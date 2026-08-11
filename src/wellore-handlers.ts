import type { IncomingMessage, ServerResponse } from "node:http";
import { getSupabase } from "./services/supabase.js";
import {
  getWelloreCompaniesSummary,
  getWelloreCompanyCard,
  getWelloreContactsSummary,
  isWelloreProjectId,
  listWelloreCompanies,
  listWelloreContacts,
  parseBoolParam,
} from "./services/wellore-explorer.js";

function getQueryParams(req: IncomingMessage): URLSearchParams {
  try {
    const host = req.headers.host ?? "localhost";
    return new URL(req.url ?? "/", `http://${host}`).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function requireWelloreProject(
  res: ServerResponse,
  projectId: string | null
): boolean {
  if (!projectId || !isWelloreProjectId(projectId)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Wellore projectId required" }));
    return false;
  }
  return true;
}

export async function handleGetWelloreCompanies(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET", "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  if (!requireWelloreProject(res, params.get("projectId"))) return;

  const sortDirection = params.get("sortDirection") === "desc" ? "desc" : "asc";
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const result = await listWelloreCompanies(client, {
    population: params.get("population") ?? undefined,
    segment: params.get("segment") ?? undefined,
    contactPresence: params.get("contactPresence") ?? undefined,
    channelMode: params.get("channelMode") ?? undefined,
    disqualificationReason: params.get("disqualificationReason") ?? undefined,
    prioritySegment: params.get("prioritySegment") ?? undefined,
    sourceList: params.get("sourceList") ?? undefined,
    recommendedChannel: params.get("recommendedChannel") ?? undefined,
    search: params.get("search") ?? undefined,
    hqCountry: params.get("hqCountry") ?? undefined,
    hasDomain: params.get("hasDomain") ?? undefined,
    sortBy: params.get("sortBy") ?? undefined,
    sortDirection,
    limit,
    offset,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

export async function handleGetWelloreCompaniesSummary(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET", "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  if (!requireWelloreProject(res, params.get("projectId"))) return;
  const result = await getWelloreCompaniesSummary(client, {
    population: params.get("population") ?? undefined,
    segment: params.get("segment") ?? undefined,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: null, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleGetWelloreContactsSummary(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET", "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  if (!requireWelloreProject(res, params.get("projectId"))) return;
  const result = await getWelloreContactsSummary(client, {
    population: params.get("population") ?? undefined,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: null, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleGetWelloreContacts(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET", "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  if (!requireWelloreProject(res, params.get("projectId"))) return;

  const sortDirection = params.get("sortDirection") === "desc" ? "desc" : "asc";
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const companyIdRaw = params.get("companyId");
  const companyId = companyIdRaw ? Number.parseInt(companyIdRaw, 10) : null;
  const result = await listWelloreContacts(client, {
    population: params.get("population") ?? undefined,
    companySegment: params.get("companySegment") ?? undefined,
    presence: params.get("presence") ?? undefined,
    source: params.get("source") ?? undefined,
    emailStatus: params.get("emailStatus") ?? undefined,
    fit: params.get("fit") ?? undefined,
    icpFit: params.get("icpFit") ?? undefined,
    contactSegment: params.get("contactSegment") ?? undefined,
    outreachList: params.get("outreachList") ?? undefined,
    outreachChannel: params.get("outreachChannel") ?? undefined,
    outreachDecision: params.get("outreachDecision") ?? undefined,
    eligible: parseBoolParam(params.get("eligible")),
    verificationStatus: params.get("verificationStatus") ?? undefined,
    companyId: Number.isFinite(companyId) ? companyId : null,
    search: params.get("search") ?? undefined,
    sortBy: params.get("sortBy") ?? undefined,
    sortDirection,
    limit,
    offset,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

export async function handleGetWelloreCompanyCard(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET", "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const idRaw = params.get("id");
  const id = idRaw ? Number.parseInt(idRaw, 10) : NaN;
  if (!Number.isFinite(id) || id <= 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing or invalid query param: id" }));
    return;
  }
  const result = await getWelloreCompanyCard(client, id);
  if (result.error) {
    res.writeHead(result.error === "Company not found" ? 404 : 500);
    res.end(JSON.stringify({ data: null, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}
