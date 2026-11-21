// Korean and English date / deadline expressions -> wall-clock times. Twin of apps/api/mdcv/dates.py.
import { RULES, type Wall, addDays, addHours, atTime, isoMinutes, nowWall, parseWall, wall, weekday, ymd } from "./text.ts";

export type DateKind = "deadline" | "meeting" | "mentioned";
export type DateHit = { raw: string; iso: string | null; kind: DateKind };

// Optional time after a day expression: "오후 3시 30분", "17시", "14:00", "오전 중", "퇴근 전", "EOD". Always the last 5 groups.
const TIME = "(?:\\s*(오전|오후|AM|PM|am|pm)?\\s*([0-9]{1,2})(?:\\s*시(?:\\s*([0-9]{1,2})\\s*분)?|:([0-9]{2})))?(?:\\s*(오전\\s*중|오후\\s*중|중(?=으로|에|까지|\\s|[,.]|$)|퇴근\\s*전|EOD|오전|오후))?";
const KO_WD = "(?:\\s*(?:\\([월화수목금토일]\\)|[월화수목금토일]요일|\\((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\)))?";
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EN_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const EN_SHORT: Record<string, number> = { mon: 0, tue: 1, tues: 1, wed: 2, thu: 3, thur: 3, thurs: 3, fri: 4 };
const KO_DAYS = "월화수목금토일";
const REL: Record<string, number> = { 오늘: 0, 금일: 0, 당일: 0, 내일: 1, 명일: 1, 익일: 1, 모레: 2, 어제: -1, 전일: -1 };

type G = (string | undefined)[];
type Resolver = (g: G, base: Wall) => Wall | null;

/** Applies the trailing TIME groups; without a time a day-level date means the end of the working day (18:00). */
function timed(day: Wall | null, g: G): Wall | null {
  if (!day) return null;
  const [ampm, h, m1, m2, part] = g.slice(-5);
  if (h !== undefined) {
    let hour = +h;
    if ((ampm === "오후" || ampm === "PM" || ampm === "pm") && hour < 12) hour += 12;
    const minute = +(m1 ?? m2 ?? 0);
    if (hour <= 23 && minute <= 59) return atTime(day, hour, minute);
  }
  if (part && /^오전/.test(part)) return atTime(day, 12);
  return atTime(day, 18);
}

const endOfDay = (d: Wall | null) => (d ? atTime(d, 18) : null);

/** Month/day without a year: this year, or next year when that would be more than 180 days in the past. */
function monthDay(base: Wall, y: string | undefined, mo: number, d: number): Wall | null {
  if (y) return wall(+y, mo, d);
  const dt = wall(base.getUTCFullYear(), mo, d);
  if (dt && dt.getTime() < addDays(base, -180).getTime()) return wall(base.getUTCFullYear() + 1, mo, d);
  return dt;
}

function monthEnd(y: number, mo: number): Wall {
  return addDays(wall(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1)!, -1);
}

/** Week-relative day: "this" = this calendar week (Mon-Sun), "next" = next calendar week, none = the coming one (today counts). */
function weekDay(base: Wall, target: number, scope: "this" | "next" | ""): Wall {
  const today = wall(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate())!;
  if (scope === "") return addDays(today, (target - weekday(today) + 7) % 7);
  return addDays(today, -weekday(today) + target + (scope === "next" ? 7 : 0));
}
const scopeOf = (s: string | undefined): "this" | "next" | "" =>
  !s ? "" : /^(다음|차주|담주|next)/i.test(s.replace(/\s/g, "")) ? "next" : "this";

// Priority order matters: a later pattern never takes text an earlier one already matched.
const PATTERNS: [RegExp, Resolver][] = [
  [new RegExp("(?<![0-9])(20[0-9]{2})[-/.]\\s?([0-9]{1,2})[-/.]\\s?([0-9]{1,2})(?![0-9])" + KO_WD + TIME, "g"),
    (g) => timed(wall(+g[1]!, +g[2]!, +g[3]!), g)],
  [new RegExp("(?<![0-9])(?:(20[0-9]{2})\\s*년\\s*)?([0-9]{1,2})\\s*월\\s*([0-9]{1,2})\\s*일" + KO_WD + TIME, "g"),
    (g, b) => timed(monthDay(b, g[1], +g[2]!, +g[3]!), g)],
  [new RegExp("(?<![0-9/.])([0-9]{1,2})/([0-9]{1,2})(?![0-9/])" + KO_WD + TIME, "g"),
    (g, b) => timed(monthDay(b, undefined, +g[1]!, +g[2]!), g)],
  [new RegExp("(?<![A-Za-z])(" + EN_MONTHS.join("|") + ")[a-z]*\\.?\\s+([0-9]{1,2})(?:st|nd|rd|th)?(?![0-9])", "g"),
    (g, b) => endOfDay(monthDay(b, undefined, EN_MONTHS.indexOf(g[1]!) + 1, +g[2]!))],
  [new RegExp("(?<![0-9])([0-9]{1,2})(?:st|nd|rd|th)?\\s+(" + EN_MONTHS.join("|") + ")[a-z]*(?![A-Za-z])", "g"),
    (g, b) => endOfDay(monthDay(b, undefined, EN_MONTHS.indexOf(g[2]!) + 1, +g[1]!))],
  [new RegExp("(?:([0-9]{1,2})\\s*월|(이번\\s*달|이달|금월|당월)|(다음\\s*달|익월|내달)|(?<![0-9])월)\\s*말일?(?=까지|에|이전|\\s|[,.)]|$)", "g"),
    (g, b) => {
      let y = b.getUTCFullYear(), mo = b.getUTCMonth() + 1;
      if (g[1]) { mo = +g[1]; if (mo < 1 || mo > 12) return null; if (monthEnd(y, mo).getTime() < addDays(b, -180).getTime()) y += 1; }
      else if (g[3]) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
      return atTime(monthEnd(y, mo), 18);
    }],
  [new RegExp("(?<![0-9월/.])([0-9]{1,2})\\s*일(?:\\s*\\([월화수목금토일]\\))?(?=\\s*(?:오전|오후|[0-9]|까지|마감|중|전까지))" + TIME, "g"),
    (g, b) => {
      const d = +g[1]!;
      let y = b.getUTCFullYear(), mo = b.getUTCMonth() + 1;
      if (d < b.getUTCDate()) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
      return timed(wall(y, mo, d), g);
    }],
  [new RegExp("(내일\\s*모레|오늘|금일|당일|내일|명일|익일|모레|어제|전일)" + TIME, "g"),
    (g, b) => timed(addDays(b, /^내일\s*모레$/.test(g[1]!) ? 2 : REL[g[1]!]), g)],
  [new RegExp("(?:(이번\\s*주|금주|다음\\s*주|차주|담주)\\s*)?([월화수목금토일])요일" + TIME, "g"),
    (g, b) => timed(weekDay(b, KO_DAYS.indexOf(g[2]!), scopeOf(g[1])), g)],
  [new RegExp("(?:(이번\\s*주|금주|다음\\s*주|차주|담주)\\s*(?:중|내|안)|(?<![가-힣])주중(?=에|으로|까지|\\s|[,.]|$))", "g"),
    (g, b) => atTime(weekDay(b, 4, scopeOf(g[1])), 18)],
  [new RegExp("(다음\\s*주|차주)\\s*초", "g"),
    (g, b) => atTime(weekDay(b, 0, "next"), 18)],
  [new RegExp("(?<![0-9])([0-9]{1,3})\\s*(일|시간)\\s*(?:이내|내로|내에|안에|안으로|내)", "g"),
    (g, b) => (g[2] === "일" ? atTime(addDays(b, +g[1]!), 18) : addHours(b, +g[1]!))],
  [new RegExp("(?<![A-Za-z])within\\s+([0-9]{1,3})\\s+(business\\s+days?|days?|hours?)(?![A-Za-z])", "gi"),
    (g, b) => (/^h/i.test(g[2]!) ? addHours(b, +g[1]!) : atTime(addDays(b, +g[1]!), 18))],
  [new RegExp("(?<![A-Za-z])(?:(?:end\\s+of\\s+(?:the\\s+)?(?:business\\s+)?day|EOD|COB)(?:\\s+(?:on\\s+)?(today|tomorrow|monday|tuesday|wednesday|thursday|friday))?|(today|tomorrow|tonight))(?![A-Za-z])", "gi"),
    (g, b) => {
      const w = (g[1] ?? g[2] ?? "").toLowerCase();
      if (EN_DAYS.includes(w)) return atTime(weekDay(b, EN_DAYS.indexOf(w), ""), 18);
      return atTime(addDays(b, w === "tomorrow" ? 1 : 0), 18);
    }],
  [new RegExp("(?<![A-Za-z0-9_-])(?:(this|next)\\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri)(?![A-Za-z0-9_-])", "gi"),
    (g, b) => {
      const w = g[2]!.toLowerCase();
      const target = EN_DAYS.includes(w) ? EN_DAYS.indexOf(w) : EN_SHORT[w];
      return atTime(weekDay(b, target, scopeOf(g[1])), 18);
    }],
  [new RegExp("(?<![0-9])(?:(오전|오후)\\s*)?([0-9]{1,2})\\s*시(?:\\s*([0-9]{1,2})\\s*분)?(?=\\s*(?:까지|전까지|마감))", "g"),
    (g, b) => timed(b, [g[1], g[2], g[3], undefined, undefined])],
];

function kindOf(text: string, start: number, end: number): DateKind {
  const after = text.slice(end, end + 12);
  const before = text.slice(Math.max(0, start - 16), start).toLowerCase();
  const raw = text.slice(start, end).toLowerCase();
  if (RULES.deadlineRaw.some((h) => raw.includes(h)) || RULES.deadlineAfter.some((h) => after.includes(h)) || RULES.deadlineBefore.some((h) => before.includes(h))) return "deadline";
  if (RULES.deadlineSoft.some((h) => after.includes(h))) return "deadline";
  const around = text.slice(Math.max(0, start - 15), end + 15).toLowerCase();
  if (RULES.meetingHints.some((h) => around.includes(h))) return "meeting";
  return "mentioned";
}

/** Finds dates in text relative to base (the mail's received time). Returns hits in reading order. */
export function parseDates(text: string, base: Wall | string): DateHit[] {
  const b = (typeof base === "string" ? parseWall(base) : base) ?? nowWall();
  const src = text || "";
  const taken: [number, number][] = [];
  const found: { start: number; hit: DateHit; day: string | null }[] = [];
  const seen = new Set<string>();
  for (const [rx, resolve] of PATTERNS) {
    for (const m of src.matchAll(rx)) {
      const start = m.index!, end = start + m[0].length;
      if (!m[0].trim() || taken.some(([s, e]) => start < e && s < end)) continue;
      const dt = resolve(m as unknown as G, b);
      if (!dt || isNaN(dt.getTime())) continue;
      taken.push([start, end]);
      const raw = m[0].trim();
      const key = raw + "|" + ymd(dt);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ start, day: ymd(dt), hit: { raw, iso: isoMinutes(dt), kind: kindOf(src, start, end) } });
    }
  }
  return found.sort((x, y) => x.start - y.start).map((f) => f.hit);
}

/** Default period bucket from the received time: before noon = morning. */
export function periodBucket(receivedAt: string): "morning" | "afternoon" | "daily" {
  const dt = parseWall(receivedAt);
  if (!dt) return "daily";
  return dt.getUTCHours() < 12 ? "morning" : "afternoon";
}
