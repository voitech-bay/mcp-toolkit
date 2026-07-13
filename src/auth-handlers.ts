import type { IncomingMessage, ServerResponse } from "node:http";
import {
  clearSessionCookieHeader,
  createSessionCookie,
  getAuthSession,
  loginRoleForCredentials,
  projectAllowedForLogin,
  sessionCookieHeader,
} from "./services/auth.js";
import { getProjects, getSupabase } from "./services/supabase.js";

type Json = Record<string, unknown>;

function send(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(data));
}

async function body(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    const x = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    return x && typeof x === "object" && !Array.isArray(x) ? x as Json : {};
  } catch {
    return {};
  }
}

export async function handleAuthSession(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
  const session = getAuthSession(req);
  send(res, 200, { authenticated: Boolean(session), session });
}

export async function handleAuthProjects(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return send(res, 500, { error: "Supabase not configured" });
  const result = await getProjects(client);
  if (result.error) return send(res, 500, { data: [], error: result.error });
  send(res, 200, { data: result.data });
}

export async function handleAuthLogin(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const b = await body(req);
  const projectId = String(b.projectId ?? "").trim();
  if (!projectId) return send(res, 400, { error: "Select a project" });
  const login = loginRoleForCredentials(String(b.login ?? ""), String(b.password ?? ""));
  if (!login) return send(res, 401, { error: "Invalid login" });
  if (!projectAllowedForLogin(login, projectId)) {
    return send(res, 403, { error: "This login is not assigned to the selected project" });
  }
  const token = createSessionCookie(login);
  send(res, 200, {
    authenticated: true,
    login,
    role: login === "workspace" ? "workspace" : "velvetech",
    projectId,
  }, { "Set-Cookie": sessionCookieHeader(token) });
}

export async function handleAuthLogout(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  send(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookieHeader() });
}
