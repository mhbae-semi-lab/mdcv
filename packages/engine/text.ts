// Shared text helpers. Every function here has a twin in apps/api/mdcv/text.py; keep them identical
// (scripts/parity.py compares both engines on the golden and synthetic sets).
import rules from "../shared/rules.json" with { type: "json" };

export const RULES = rules;

const ASCII_TERM = /^[\x20-\x7e]+$/;
const cache = new Map<string, RegExp>();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Terms made of ASCII match as whole words, ignoring case; "re:" terms are regular expressions matched the same way;
 *  other terms (Korean) match as substrings. */
export function termRegex(term: string): RegExp | null {
  const isRe = term.startsWith("re:");
  if (!isRe && !ASCII_TERM.test(term)) return null;
  let rx = cache.get(term);
  if (!rx) {
    rx = new RegExp("(?<![A-Za-z0-9_])(?:" + (isRe ? term.slice(3) : esc(term)) + ")(?![A-Za-z0-9_])", "i");
    cache.set(term, rx);
  }
  return rx;
}

export function has(text: string, term: string): boolean {
  const rx = termRegex(term);
  return rx ? rx.test(text) : text.includes(term);
}

export const hits = (text: string, terms: readonly string[]) => terms.filter((t) => has(text, t));

/** Python-style slice by code points (JS strings index UTF-16 units). */
export const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("");
export const len = (s: string) => Array.from(s).length;

const QUOTE_HEADER = /^(?:On .{4,80} wrote:|20[0-9]{2}(?:년|[-./]).{0,80}작성:|(?:From|보낸 사람|보낸사람):[^\n]*\n(?:Sent|Date|보낸 날짜|날짜):)/m;

/** Mail text the sender wrote now: drops lines quoted with '>' and everything after a reply/forward header. */
export function freshText(body: string): string {
  let out = body || "";
  for (const marker of RULES.quoteMarkers) {
    const i = out.indexOf(marker);
    if (i >= 0) out = out.slice(0, i);
  }
  const m = QUOTE_HEADER.exec(out);
  if (m) out = out.slice(0, m.index);
  return out.split("\n").filter((line) => !line.trimStart().startsWith(">")).join("\n");
}

// Naive (wall-clock) date-times, stored as UTC Dates so arithmetic never meets DST or the host time zone.
export type Wall = Date;
const pad = (n: number) => String(n).padStart(2, "0");

/** Parses "YYYY-MM-DD[THH:MM[:SS[.fff]]][Z|±HH:MM]" and keeps the written wall-clock time (offset ignored, like Python's replace(tzinfo=None)). */
export function parseWall(iso: string): Wall | null {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]{1,6})?)?)?(?:Z|[+-][0-9]{2}:?[0-9]{2})?$/.exec(String(iso || "").trim());
  if (!m) return null;
  return wall(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

/** Builds a wall time, or null when a field is out of range (Python's datetime() raises). */
export function wall(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Wall | null {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  dt.setUTCFullYear(y);
  return dt.getUTCDate() === d && dt.getUTCMonth() === mo - 1 ? dt : null;
}

export const nowWall = (): Wall => {
  const n = new Date();
  return wall(n.getFullYear(), n.getMonth() + 1, n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds())!;
};
export const addDays = (d: Wall, days: number) => new Date(d.getTime() + days * 864e5);
export const addHours = (d: Wall, h: number) => new Date(d.getTime() + h * 36e5);
export const atTime = (d: Wall, h: number, mi = 0) => wall(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, mi)!;
/** Monday = 0 … Sunday = 6, as Python's weekday(). */
export const weekday = (d: Wall) => (d.getUTCDay() + 6) % 7;
export const isoMinutes = (d: Wall) =>
  `${String(d.getUTCFullYear()).padStart(4, "0")}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
export const ymd = (d: Wall) => isoMinutes(d).slice(0, 10);
