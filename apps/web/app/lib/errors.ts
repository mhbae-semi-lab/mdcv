// Local error log: the last 50 errors stay in this browser only (nothing is sent anywhere).
// Only the message and where it happened are kept, never mail text.
const KEY = "mdcv.errors";
export type LoggedError = { at: string; message: string; where: string };

export function readErrors(): LoggedError[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
export function logError(message: string, where = "") {
  const entry = { at: new Date().toISOString().slice(0, 19), message: String(message).slice(0, 300), where: where.slice(0, 200) };
  try { localStorage.setItem(KEY, JSON.stringify([entry, ...readErrors()].slice(0, 50))); } catch { /* storage blocked */ }
  return entry;
}
export function clearErrors() {
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
/** Installs window-level handlers once; onError lets the page show a toast. */
export function installErrorHandlers(onError: (message: string) => void) {
  const handle = (message: string, where: string) => { logError(message, where); onError(message); };
  const onErr = (e: ErrorEvent) => handle(e.message, `${e.filename}:${e.lineno}`);
  const onRej = (e: PromiseRejectionEvent) => handle((e.reason as Error)?.message || String(e.reason), "promise");
  window.addEventListener("error", onErr);
  window.addEventListener("unhandledrejection", onRej);
  return () => { window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onRej); };
}
