// Rule classifier: equipment / alarm / date / people extraction, importance score with reasons, action items.
// Twin of apps/api/mdcv/classifier.py — keep both identical (scripts/parity.py).
import { RULES, cut, freshText, has, hits, isoMinutes, nowWall, parseWall, ymd as ymdOf } from "./text.ts";
import { type DateHit, parseDates, periodBucket } from "./dates.ts";
import { SENTENCE_SPLIT, type Issue, checkConsistency, correctText, summarize } from "./validator.ts";

export type Level = "urgent" | "important" | "normal" | "reference";
export const LEVELS: Level[] = ["urgent", "important", "normal", "reference"];
export type ActionItem = { text: string; due: string | null; dueIso: string | null; owner: string | null };
export type Classification = {
  messageId: string;
  importance: { level: Level; score: number; reasons: string[]; overridden?: boolean; autoLevel?: Level };
  period: string;
  entities: { equipment: string[]; alarms: string[]; dates: DateHit[]; people: string[]; keywords: string[] };
  summary: string;
  actionItems: ActionItem[];
  needsReply: boolean;
  correction: { corrected: string; issues: Issue[] } | null;
  confidence: number;
  engine: "rule" | "llm" | "hybrid";
  rulesVersion?: number;
};
export type MailIn = { id?: string; subject?: string; bodyText?: string; receivedAt?: string; senderEmail?: string; senderName?: string };
/** Equipment dictionary entry: canonical name first, then aliases. */
export type EquipmentEntry = string[];
export type RuleOptions = { equipment?: EquipmentEntry[]; vip?: string[]; weights?: Record<string, number> };

export const DEFAULT_EQUIPMENT: EquipmentEntry[] = RULES.equipment;
const CODE = /(?<![A-Za-z0-9_])([A-Z]{2,5})[-_]?([0-9]{1,5})([A-Z]?)(?![A-Za-z0-9_])/g;
const ALARM = new RegExp("(?<![A-Za-z0-9_])" + RULES.alarmCode + "(?![A-Za-z0-9_])", "g");
const ALARM_FULL = new RegExp("^" + RULES.alarmCode + "$");
const PEOPLE = /([가-힣]{2,4})\s*(?:님|과장|부장|팀장|대리|차장|책임|선임|수석|主任|담당)/g;

export const levelOf = (score: number): Level => (score >= 80 ? "urgent" : score >= 55 ? "important" : score >= 30 ? "normal" : "reference");
const uniqSorted = (xs: Iterable<string>) => [...new Set(xs)].sort();
/** Drops names contained in a longer matched name ("펌프" when "진공 펌프" matched). */
const longest = (xs: string[]) => xs.filter((c) => !xs.some((o) => o !== c && o.includes(c)));

export function findEquipment(text: string, dictionary: EquipmentEntry[] = DEFAULT_EQUIPMENT): string[] {
  const names = dictionary.filter((entry) => entry.some((term) => term && has(text, term))).map((entry) => entry[0]);
  const stop = new Set(RULES.codeStop);
  const codes = [...text.matchAll(CODE)]
    .filter((m) => !stop.has(m[1]) && !ALARM_FULL.test(m[0]))
    .map((m) => m[0].replace("_", "-"));
  return uniqSorted(longest(uniqSorted([...names, ...codes])));
}

export const findAlarms = (text: string) => uniqSorted([...text.matchAll(ALARM)].map((m) => m[0]));

export class RuleClassifier {
  equipment: EquipmentEntry[];
  vip: Set<string>;
  weights: Record<string, number>;

  constructor(opts: RuleOptions = {}) {
    this.equipment = opts.equipment ?? DEFAULT_EQUIPMENT;
    this.vip = new Set((opts.vip ?? []).map((s) => s.toLowerCase()));
    this.weights = opts.weights ?? {};
  }

  classify(mail: MailIn): Classification {
    const subject = mail.subject || "";
    const body = mail.bodyText || "";
    const fresh = freshText(body);
    const text = subject + "\n" + fresh;
    const received = mail.receivedAt || isoMinutes(nowWall());
    const base = parseWall(received) ?? nowWall();
    const senderEmail = (mail.senderEmail || "").toLowerCase();
    const senderName = mail.senderName || "";

    // Entities come from the whole mail (a forward's equipment matters); requests and urgency only from the new text.
    const full = subject + "\n" + body;
    const equipment = findEquipment(full, this.equipment);
    const alarms = findAlarms(full);
    const dates = parseDates(text, base);
    const people = uniqSorted([senderName, ...[...text.matchAll(PEOPLE)].map((m) => m[1])].filter(Boolean));
    const keywords = hits(text, RULES.keywords);

    let score = 10;
    const reasons: string[] = [];
    if (this.vip.has(senderEmail) || this.vip.has(senderName.toLowerCase())) { score += 25; reasons.push("VIP 발신자"); }
    const resolved = hits(text, RULES.resolved);
    const urgent = hits(text, RULES.notUrgent).length || resolved.length ? [] : hits(text, RULES.urgent);
    if (urgent.length) { score += 25; reasons.push("긴급 키워드: " + urgent.slice(0, 3).join(", ")); }
    const assets = equipment.length ? equipment : alarms;
    if (assets.length && urgent.length) {
      score += 15; reasons.push(`설비 이상 관련(${assets.slice(0, 3).join(", ")})`);
      const impact = hits(text, RULES.impact);
      if (impact.length) { score += 10; reasons.push("생산 영향: " + impact.slice(0, 2).join(", ")); }
    }
    const anomaly = [...hits(text, RULES.anomaly), ...alarms];
    if (assets.length && anomaly.length && !urgent.length && !resolved.length) {
      score += 30; reasons.push("설비 이상 징후: " + anomaly.slice(0, 3).join(", "));
    }
    if (resolved.length) reasons.push("해결·복구 표현: " + resolved[0]);
    const customer = hits(text, RULES.customer);
    if (customer.length) { score += 10; reasons.push("고객 관련: " + customer[0]); }
    const bulk = hits(text, RULES.bulk);
    const noReply = hits(text, RULES.noReply);
    // A reply's subject repeats the original request ("RE: 검토 요청"), so only the new text counts as asking.
    // Conditional requests ("변경이 필요한 경우에만 공유해 주십시오") are offers, not obligations.
    const askText = ((/^\s*(re|fw|fwd|회신|답장|전달)\s*:/i.test(subject) ? "" : subject) + "\n" + fresh)
      .split(SENTENCE_SPLIT).filter((s) => !hits(s, RULES.conditional).length).join("\n");
    const asks = hits(askText, RULES.action);
    const question = askText.includes("?") || askText.includes("？");
    const needsReply = !bulk.length && !noReply.length && (asks.length > 0 || question);
    if (needsReply) { score += 15; reasons.push("회신/조치 요청 포함"); }
    const deadlines = dates.filter((d) => d.kind === "deadline" && d.iso);
    const hoursLeft = (d: DateHit) => (parseWall(d.iso!)!.getTime() - base.getTime()) / 36e5;
    const soon = deadlines.find((d) => hoursLeft(d) >= 0 && hoursLeft(d) <= 72);
    const week = deadlines.find((d) => hoursLeft(d) >= 0 && hoursLeft(d) <= 168);
    if (soon) { score += 25; reasons.push(`72시간 내 마감(${soon.raw})`); }
    else if (week) { score += 10; reasons.push(`7일 내 마감(${week.raw})`); }
    if (needsReply && (soon || week)) { score += 15; reasons.push("기한 있는 회신 요청"); }
    if (equipment.length) { score += 5; reasons.push(`설비 언급(${equipment.slice(0, 3).join(", ")})`); }
    if (dates.some((d) => d.kind === "meeting")) { score += 10; reasons.push("회의/점검 일정"); }
    if (dates.length) { score += 5; reasons.push("날짜/일정 포함"); }
    if (bulk.length) { score -= 30; reasons.push("대량/광고성 메일"); }
    if (noReply.length) reasons.push("회신 불필요 표시: " + noReply[0]);
    for (const [kw, w] of Object.entries(this.weights)) {
      if (kw && has(text, kw)) { score += Math.trunc(Number(w)) || 0; reasons.push("사용자 키워드: " + kw); }
    }
    score = Math.max(0, Math.min(100, score));
    if (!urgent.length) score = Math.min(score, 79); // urgent needs an explicit urgency / outage word
    if (noReply.length && score > 54) { score = 54; reasons.push("참고용 표시로 '일반' 이하"); }

    const actionItems: ActionItem[] = [];
    if (needsReply) {
      const firstDue = deadlines.find((d) => d.iso!.slice(0, 10) >= ymdOf(base)) ?? null;
      for (const line of fresh.split(SENTENCE_SPLIT).map((s) => s.trim())) {
        if (!line || hits(line, RULES.conditional).length || !(hits(line, RULES.action).length || line.includes("?") || line.includes("？"))) continue;
        const own = deadlines.find((d) => line.includes(d.raw)) ?? firstDue;
        actionItems.push({ text: cut(line, 160), due: own?.raw ?? null, dueIso: own?.iso ?? null, owner: senderName || null });
        if (actionItems.length >= 5) break;
      }
      if (!actionItems.length) {
        actionItems.push({ text: cut(subject || "회신 요청", 160), due: firstDue?.raw ?? null, dueIso: firstDue?.iso ?? null, owner: senderName || null });
      }
    }

    const correction = correctText(body);
    correction.issues = [...correction.issues, ...checkConsistency(body, { dates })];
    return {
      messageId: String(mail.id ?? ""),
      importance: { level: levelOf(score), score, reasons: reasons.length ? reasons : ["일반 업무 메일"] },
      period: periodBucket(received),
      entities: { equipment, alarms, dates, people, keywords },
      summary: summarize(fresh) || summarize(body),
      actionItems,
      needsReply,
      correction: correction.issues.length ? correction : null,
      confidence: equipment.length || dates.length || needsReply ? 0.9 : 0.6,
      engine: "rule",
      rulesVersion: RULES.version,
    };
  }
}
