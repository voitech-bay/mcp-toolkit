import type { IncomingMessage, ServerResponse } from "node:http";
import {
  clearSessionCookieHeader,
  createSessionCookie,
  getAuthSession,
  loginRoleForCredentials,
  sessionCookieHeader,
} from "./services/auth.js";

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

export async function handleAuthLogin(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const b = await body(req);
  const role = loginRoleForCredentials(String(b.login ?? ""), String(b.password ?? ""));
  if (!role) return send(res, 401, { error: "Invalid login" });
  const token = createSessionCookie(role);
  send(res, 200, { authenticated: true, role }, { "Set-Cookie": sessionCookieHeader(token) });
}

export async function handleAuthLogout(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  send(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookieHeader() });
}
