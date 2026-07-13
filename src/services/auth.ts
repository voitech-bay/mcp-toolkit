import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { VELVETECH_PROJECT_ID } from "./n8n-trigger.js";

export type AuthRole = "workspace" | "velvetech";
export type AuthLogin = "workspace" | "paul" | "velvetech";

export type AuthSession = {
  role: AuthRole;
  login: AuthLogin;
  name: string;
  projectId: string | null;
  exp: number;
};

const COOKIE_NAME = "voitech_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function authEnabled(): boolean {
  return process.env.VOITECH_AUTH_ENABLED === "true";
}

function authSecret(): string {
  return process.env.VOITECH_AUTH_SESSION_SECRET ?? "";
}

export function assertAuthConfigured(): void {
  if (!authEnabled()) return;
  const missing = [
    ["VOITECH_AUTH_SESSION_SECRET", process.env.VOITECH_AUTH_SESSION_SECRET],
    ["VOITECH_WORKSPACE_PASSWORD", process.env.VOITECH_WORKSPACE_PASSWORD],
    ["VOITECH_PAUL_PASSWORD", process.env.VOITECH_PAUL_PASSWORD],
    ["VOITECH_VELVETECH_PASSWORD", process.env.VOITECH_VELVETECH_PASSWORD],
  ].filter(([, value]) => !String(value ?? "").trim()).map(([key]) => key);
  if (missing.length) throw new Error(`Auth is enabled but missing: ${missing.join(", ")}`);
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", authSecret()).update(payload).digest("base64url");
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const raw = req.headers.cookie ?? "";
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function accountName(login: AuthLogin): string {
  if (login === "workspace") return "Voitech workspace";
  if (login === "paul") return "Paul (Voitech)";
  return "Velvetech";
}

function accountRole(login: AuthLogin): AuthRole {
  return login === "workspace" ? "workspace" : "velvetech";
}

export function createSessionCookie(login: AuthLogin): string {
  const role = accountRole(login);
  const session: AuthSession = {
    role,
    login,
    name: accountName(login),
    projectId: role === "velvetech" ? VELVETECH_PROJECT_ID : null,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payload = base64url(JSON.stringify(session));
  return `${payload}.${sign(payload)}`;
}

export function projectAllowedForLogin(login: AuthLogin, projectId: string): boolean {
  if (login === "workspace") return true;
  return projectId === VELVETECH_PROJECT_ID;
}

export function clearSessionCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=0`;
}

export function sessionCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function getAuthSession(req: IncomingMessage): AuthSession | null {
  if (!authEnabled()) {
    return { role: "workspace", login: "workspace", name: "Voitech workspace", projectId: null, exp: Number.MAX_SAFE_INTEGER };
  }
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthSession;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (parsed.role !== "workspace" && parsed.role !== "velvetech") return null;
    const login = parsed.login === "paul" || parsed.login === "velvetech" || parsed.login === "workspace"
      ? parsed.login
      : parsed.role === "workspace" ? "workspace" : "velvetech";
    return { ...parsed, login, name: parsed.name || accountName(login) };
  } catch {
    return null;
  }
}

export function loginRoleForCredentials(login: string, password: string): AuthLogin | null {
  const normalized = login.trim().toLowerCase();
  const expected =
    normalized === "workspace" ? process.env.VOITECH_WORKSPACE_PASSWORD :
    normalized === "paul" ? process.env.VOITECH_PAUL_PASSWORD :
    normalized === "velvetech" ? process.env.VOITECH_VELVETECH_PASSWORD :
    null;
  if (!expected) return null;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? normalized as AuthLogin : null;
}

export function isPublicAuthPath(pathname: string): boolean {
  return pathname === "/api/auth/login" || pathname === "/api/auth/session" || pathname === "/api/auth/logout" || pathname === "/api/auth/projects";
}

export function isPublicWebhookPath(pathname: string): boolean {
  return pathname.startsWith("/api/webhooks/");
}

export function isVelvetechAllowedApiPath(pathname: string): boolean {
  if (pathname === "/api/auth/session" || pathname === "/api/auth/logout") return true;
  if (pathname === "/api/projects" || pathname === "/api/users") return true;

  // Velvetech data mini-app: Companies, Contacts, Conversations.
  if (pathname === "/api/project-company-records" || pathname === "/api/project-contact-records") return true;
  if (pathname === "/api/supabase-table-query") return true;
  if (pathname === "/api/companies" || pathname === "/api/companies/by-ids" || pathname === "/api/project-companies") return true;
  if (pathname === "/api/contact-lists" || pathname === "/api/pipeline-stages/contacts") return true;
  if (pathname === "/api/company-context" || pathname === "/api/company-context-counts") return true;
  if (pathname === "/api/contact-context" || pathname === "/api/contact-context-counts") return true;
  if (pathname === "/api/conversations" || pathname === "/api/conversation" || pathname === "/api/conversations/refresh") return true;
  if (pathname === "/api/contacts/by-company" || pathname === "/api/contacts/find-by-uuid") return true;
  if (pathname === "/api/cards/company" || pathname === "/api/cards/contact") return true;
  if (pathname === "/api/hypotheses") return true;
  if (/^\/api\/hypotheses\/[^/]+\/targets$/.test(pathname)) return true;
  if (/^\/api\/companies\/[^/]+\/hypotheses$/.test(pathname)) return true;
  if (pathname === "/api/build-context") return true;
  if (pathname === "/api/generated-messages" || pathname === "/api/generated-messages/generate") return true;
  if (/^\/api\/generated-messages\/[^/]+$/.test(pathname)) return true;

  // Velvetech launch and results.
  if (pathname === "/api/n8n/workflows" || pathname === "/api/n8n/launch") return true;
  if (/^\/api\/n8n\/launch\/[^/]+\/status$/.test(pathname)) return true;
  if (pathname === "/api/n8n/launch/history") return true;
  if (pathname === "/api/n8n/workflow-results" || pathname === "/api/n8n/workflow-results/query") return true;
  if (pathname === "/api/n8n/workflow-results/executions") return true;
  if (/^\/api\/n8n\/workflow-results\/executions\/[^/]+$/.test(pathname)) return true;
  if (pathname === "/api/velvetech/research-csv/preview") return true;
  if (pathname === "/api/velvetech/research-csv/launch") return true;

  // Pipeline sync for Velvetech's GetSales-backed workspace.
  if (pathname === "/api/sync-preflight" || pathname === "/api/sync-status" || pathname === "/api/sync-history") return true;
  if (pathname === "/api/supabase-sync" || pathname === "/api/supabase-sync-cancel") return true;
  if (pathname === "/api/source-api-check") return true;
  if (/^\/api\/projects\/[^/]+\/integration-secrets\/meta$/.test(pathname)) return true;
  if (/^\/api\/projects\/[^/]+\/credentials$/.test(pathname)) return true;

  // Email Studio.
  if (pathname === "/api/email-studio/contact-search" || pathname === "/api/email-studio/emails") return true;
  if (/^\/api\/email-studio\/emails\/[^/]+$/.test(pathname)) return true;
  if (/^\/api\/email-studio\/emails\/[^/]+\/(status|generate|regenerate|comments|approve|versions|human-version)$/.test(pathname)) return true;
  if (/^\/api\/email-studio\/emails\/[^/]+\/versions\/[^/]+\/adopt$/.test(pathname)) return true;
  if (/^\/api\/email-studio\/comments\/[^/]+$/.test(pathname)) return true;
  if (/^\/api\/email-studio\/comments\/[^/]+\/replies$/.test(pathname)) return true;

  // Sequence Studio: channel-level review, POV fact marks, and GetSales handoff.
  if (pathname === "/api/sequence-studio/leads") return true;
  if (/^\/api\/sequence-studio\/leads\/[^/]+$/.test(pathname)) return true;
  if (pathname === "/api/sequence-studio/pov-fact-marks") return true;
  if (pathname === "/api/sequence-studio/push-linkedin") return true;
  return false;
}

export function sendAuthError(res: ServerResponse, status = 401, error = "Authentication required"): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error }));
}
