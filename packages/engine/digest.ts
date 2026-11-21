// Period digest (morning … yearly). Twin of apps/api/mdcv/digest.py.
import { type Wall, addDays, nowWall, parseWall } from "./text.ts";
import type { Classification, Level } from "./classifier.ts";

export const PERIODS = ["morning", "afternoon", "daily", "weekly", "monthly", "yearly"] as const;
export type Period = (typeof PERIODS)[number];
const LABEL: Record<Period, string> = { morning: "오전", afternoon: "오후", daily: "일간", weekly: "주간", monthly: "월간", yearly: "연간" };
const ORDER: Record<Level, number> = { urgent: 0, important: 1, normal: 2, reference: 3 };
type DigestMail = { id: string; subject: string; receivedAt: string; classification?: Classification };

/** Earliest received time a period can include: callers load only mails after this (no full-table load). */
export function periodStart(period: Period, now: Wall): Wall {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "weekly") return addDays(now, -7);
  if (period === "monthly") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (period === "yearly") return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  if (period === "afternoon") return new Date(day.getTime() + 12 * 36e5);
  return day;
}

function inPeriod(received: string, period: Period, now: Wall): boolean {
  const dt = parseWall(received);
  if (!dt) return false;
  const sameDay = dt.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
  if (period === "morning") return sameDay && dt.getUTCHours() < 12;
  if (period === "afternoon") return sameDay && dt.getUTCHours() >= 12;
  if (period === "daily") return sameDay;
  if (period === "weekly") return addDays(now, -7) <= dt && dt <= addDays(now, 1);
  if (period === "monthly") return dt.getUTCFullYear() === now.getUTCFullYear() && dt.getUTCMonth() === now.getUTCMonth();
  return dt.getUTCFullYear() === now.getUTCFullYear();
}

export function buildDigest(mails: DigestMail[], period: Period, now: Wall = nowWall()) {
  const lvl = (m: DigestMail) => m.classification?.importance.level ?? "normal";
  const items = mails.filter((m) => inPeriod(m.receivedAt, period, now))
    .sort((a, b) => ORDER[lvl(a)] - ORDER[lvl(b)] || (b.classification?.importance.score ?? 0) - (a.classification?.importance.score ?? 0));
  const byLevel: Record<string, number> = {};
  const byEquipment = new Map<string, number>();
  const actions: { mailId: string; subject: string; text: string; due: string | null; dueIso: string | null }[] = [];
  for (const m of items) {
    byLevel[lvl(m)] = (byLevel[lvl(m)] ?? 0) + 1;
    for (const e of m.classification?.entities.equipment ?? []) byEquipment.set(e, (byEquipment.get(e) ?? 0) + 1);
    if (m.classification?.needsReply) {
      for (const a of m.classification.actionItems) actions.push({ mailId: m.id, subject: m.subject, text: a.text, due: a.due, dueIso: a.dueIso ?? null });
    }
  }
  const topEquipment = [...byEquipment.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  return {
    period, label: LABEL[period], generatedAt: now.toISOString().slice(0, 16), total: items.length,
    byImportance: byLevel, byEquipment: Object.fromEntries(topEquipment),
    headline: `${LABEL[period]} 다이제스트: 총 ${items.length}건 (긴급 ${byLevel.urgent ?? 0} · 중요 ${byLevel.important ?? 0}), 주요 설비 ${topEquipment.slice(0, 3).map(([k]) => k).join(", ") || "없음"}`,
    topMails: items.slice(0, 10).map((m) => ({ id: m.id, subject: m.subject, importance: m.classification?.importance, summary: m.classification?.summary ?? "" })),
    actionItems: actions.sort((a, b) => (a.dueIso ?? "9999") < (b.dueIso ?? "9999") ? -1 : (a.dueIso ?? "9999") > (b.dueIso ?? "9999") ? 1 : 0).slice(0, 20),
  };
}
