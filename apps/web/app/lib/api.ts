/** API calls, shared types and display helpers. Every screen goes through here.
 *  Browser build (default): requests are answered by the in-browser backend (lib/local.ts, IndexedDB).
 *  Self-host build: NEXT_PUBLIC_API_URL points at the Python API and requests go over HTTP. */
import { createBackend, type Backend, LocalError } from "./local";
import { idbPersist } from "./idb";
import { getLang, t } from "./i18n";

export const API = process.env.NEXT_PUBLIC_API_URL || "";
export const LOCAL = !API;
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

let backend: Backend | null = null;
/** The in-browser backend (browser build only). */
export function local(): Backend {
  if (!LOCAL) throw new Error("local backend is only available in the browser build");
  return (backend ??= createBackend(idbPersist()));
}

export type Level = "urgent" | "important" | "normal" | "reference";
export type Action = { text: string; due: string | null; dueIso?: string | null };
export type Cls = {
  importance: { level: Level; score: number; reasons: string[]; overridden?: boolean; autoLevel?: Level };
  entities: { equipment: string[]; alarms?: string[]; dates: { raw: string; kind: string; iso?: string | null }[]; keywords: string[] };
  summary: string; actionItems: Action[]; needsReply: boolean; confidence: number; engine: string;
};
export type Mail = {
  id: string; provider: string; subject: string; senderName: string; senderEmail: string;
  receivedAt: string; bodyText: string; isRead: boolean; hasAttachment: boolean; status: "open" | "done";
  source?: string; classification?: Cls;
  shadow?: { valid: boolean; errors: string[]; model: string; answer: { level: Level; score: number; needsReply: boolean; reasons: string[]; summary: string } | null };
};
export type Stats = {
  total: number; needsReply: number; unread: number; unreadUrgent: number; done: number;
  byImportance: Record<string, number>; byEquipment: Record<string, number>; providers: Record<string, number>;
  engine?: "rule" | "llm"; rulesVersion?: number; sendEnabled?: boolean;
};
export type Account = { id: number; provider: "graph" | "gmail"; account_email: string; last_sync_at: string | null; last_error: string; token_expires_at?: string; tokenExpiresAt?: string; tokenDaysLeft?: number | null; tokenExpiringSoon?: boolean; tokenExpired?: boolean };

export const LEVELS: Level[] = ["urgent", "important", "normal", "reference"];
const LEVEL_KO: Record<Level, string> = { urgent: "긴급", important: "중요", normal: "일반", reference: "참고" };
export const levelName = (l: Level) => t(LEVEL_KO[l]);
export const engineName = (e: string) => t(({ rule: "규칙", llm: "LLM", hybrid: "규칙+LLM" } as Record<string, string>)[e] ?? e);
export const sourceName = (p: string) => t(({ demo: "예시 메일", graph: "Outlook", gmail: "Gmail", file: "가져온 파일" } as Record<string, string>)[p] ?? p);
export const PROVIDER_NAME: Record<string, string> = { graph: "Outlook", gmail: "Gmail" };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const TOKEN_KEY = "mdcv.token";
let token = "";
export function store(key: string, value?: string) {
  try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { /* storage blocked: settings just don't persist */ }
  return null;
}
export const loadToken = () => { token = store(TOKEN_KEY) || ""; };
export const setToken = (tk: string) => { token = tk.trim(); store(TOKEN_KEY, token); };

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  if (LOCAL) {
    try { return await local().route(init.method || "GET", path, init.body ? JSON.parse(String(init.body)) : {}) as T; }
    catch (e) { throw e instanceof LocalError ? new ApiError(e.status, t(e.message)) : e; }
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  let r: Response;
  try { r = await fetch(API + path, { ...init, headers }); }
  catch { throw new ApiError(0, t("API 서버에 연결할 수 없습니다.")); }
  if (!r.ok) {
    let msg = t("요청 실패 ({n})", { n: r.status });
    try { const b = await r.json(); msg = b.error || msg; } catch { /* no body */ }
    throw new ApiError(r.status, msg);
  }
  return r.json();
}
export const post = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });

const pad = (n: number) => String(n).padStart(2, "0");
export function when(iso: string, long = false) {
  const d = new Date(iso);
  if (isNaN(+d)) return iso;
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  if (long) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
  if (days === 0) return hm;
  if (days === 1) return t("어제");
  return getLang() === "en" ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getMonth() + 1}/${d.getDate()}`;
}
/** Due label: "11/24(화) · 2일 남음" style, relative to the given reference time. */
export function dueLabel(dueIso: string | null | undefined, raw: string | null | undefined, ref: string) {
  if (!dueIso) return raw || "—";
  const days = Math.round((new Date(dueIso.slice(0, 10)).getTime() - new Date(ref.slice(0, 10)).getTime()) / 864e5);
  const rel = days < 0 ? t("{n}일 지남", { n: -days }) : days === 0 ? t("오늘") : days === 1 ? t("내일") : t("{n}일 남음", { n: days });
  return `${dueIso.slice(5, 10).replace("-", "/")} ${dueIso.slice(11, 16)} · ${rel}`;
}
export const deadline = (c?: Cls) => c?.entities.dates.find((d) => d.kind === "deadline")?.raw;
export const level = (m: Mail): Level => m.classification?.importance.level || "normal";
