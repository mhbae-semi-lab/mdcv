// Extractive summary, spelling / consistency checks and reply drafts. Twin of apps/api/mdcv/validator.py.
import { RULES, cut, len } from "./text.ts";
import type { DateHit } from "./dates.ts";

export type Issue = { type: "spelling" | "consistency"; original: string; suggestion: string; message: string };

export const SENTENCE_SPLIT = /(?<=[.!?。])\s+|\n+/;

/** Extractive summary: up to 3 sentences that carry requests, deadlines or numbers, in original order. */
export function summarize(text: string, maxSentences = 3): string {
  const body = (text || "").replace(/\s+/g, " ").trim();
  if (!body) return "";
  const sentences = body.split(SENTENCE_SPLIT).map((s) => s.trim()).filter((s) => len(s) > 8);
  if (!sentences.length) return cut(body, 200);
  const score = (s: string) => RULES.summaryBoost.filter((k) => s.toLowerCase().includes(k)).length * 2 + (/[0-9]/.test(s) ? 1 : 0);
  const ranked = sentences.map((s, i) => [i, score(s)] as const).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const picked = ranked.slice(0, maxSentences).map(([i]) => i).sort((a, b) => a - b);
  return cut(picked.map((i) => sentences[i]).join(" "), 600);
}

/** Applies the spelling and spacing dictionary and lists what it changed. */
export function correctText(text: string): { corrected: string; issues: Issue[] } {
  const issues: Issue[] = [];
  let out = text || "";
  for (const [pattern, repl] of RULES.spelling) {
    for (const m of out.matchAll(new RegExp(pattern, "g"))) {
      issues.push({ type: "spelling", original: m[0], suggestion: m[0].replace(new RegExp(pattern), repl), message: "맞춤법/표현 교정 제안" });
    }
  }
  for (const [pattern, repl] of [...RULES.spelling, ...RULES.spacing]) out = out.replace(new RegExp(pattern, "g"), repl);
  return { corrected: out.trim(), issues };
}

const NUMBER = /([가-힣A-Za-z\- ]{2,20}?)\s*[:은는이가]?\s*([0-9]+(?:\.[0-9]+)?)\s*(%|도|℃|°C|bar|MPa|kPa|Pa|rpm|mm|um|nm|kg|건|대|시간|ea|EA)/g;

/** Flags the same quantity written with different numbers, and more than one deadline day. */
export function checkConsistency(text: string, entities: { dates?: DateHit[] }): Issue[] {
  const issues: Issue[] = [];
  const numbers = new Map<string, string[]>();
  for (const m of (text || "").matchAll(NUMBER)) {
    const key = m[1].trim();
    const val = m[2] + m[3];
    const vals = numbers.get(key) ?? [];
    if (!vals.includes(val)) vals.push(val);
    numbers.set(key, vals);
  }
  for (const [key, vals] of numbers) {
    if (vals.length > 1) {
      issues.push({ type: "consistency", original: key, suggestion: "",
        message: `'${key}'에 서로 다른 수치 ${[...vals].sort().join(", ")} 가 함께 쓰였습니다. 확인이 필요합니다.` });
    }
  }
  const deadlines = (entities?.dates ?? []).filter((d) => d.kind === "deadline" && d.iso);
  if (new Set(deadlines.map((d) => d.iso!.slice(0, 10))).size > 1) {
    issues.push({ type: "consistency", original: "마감일", suggestion: "",
      message: `서로 다른 마감 날짜가 ${deadlines.length}개 감지됐습니다: ${deadlines.map((d) => d.raw).join(", ")}` });
  }
  return issues;
}

type DraftInput = { senderName?: string; subject?: string };
type DraftCls = { actionItems?: { text: string }[]; entities?: { dates?: DateHit[] } } | null | undefined;

/** Reply draft with the requests and deadline echoed back. Never sent automatically. */
export function makeReplyDraft(mail: DraftInput, cls: DraftCls, lang: "ko" | "en" = "ko") {
  const actions = cls?.actionItems ?? [];
  const due = (cls?.entities?.dates ?? []).find((d) => d.kind === "deadline")?.raw ?? null;
  if (lang === "en") {
    const sender = (mail.senderName || "").trim() || "there";
    const lines = [`Hi ${sender},`, "", "Thank you for your email. I will review it and follow up."];
    if (actions.length) lines.push("Requested: " + actions.slice(0, 3).map((a) => a.text).join("; "));
    if (due) lines.push(`I will get back to you by ${due}.`);
    lines.push("", "Please let me know if anything else is needed.", "Best regards,");
    return { subject: "RE: " + (mail.subject || ""), draft: lines.join("\n"), issues: [] as Issue[],
      note: "Not sent automatically. Review and edit it, then send it from your mail client." };
  }
  const sender = (mail.senderName || "").trim() || "담당자";
  const lines = [`${sender}님, 안녕하세요.`, "", "메일 확인했습니다. 보내주신 내용 검토 후 진행하겠습니다."];
  if (actions.length) lines.push("요청 사항: " + actions.slice(0, 3).map((a) => a.text).join("; "));
  if (due) lines.push(`말씀하신 기한(${due})까지 회신드리겠습니다.`);
  lines.push("", "추가로 확인이 필요한 사항이 있으면 알려주시기 바랍니다.", "감사합니다.");
  const fixed = correctText(lines.join("\n"));
  return { subject: "RE: " + (mail.subject || ""), draft: fixed.corrected, issues: fixed.issues,
    note: "자동 발송되지 않습니다. 내용을 확인·수정한 뒤 메일 클라이언트에서 발송하세요." };
}
