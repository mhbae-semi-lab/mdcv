// LLM second opinion: prompt, JSON schema and validation. The rule result always stays; an LLM answer is used only
// after every check here passes. Twin of the validation in apps/api/mdcv/llm.py.
import { LEVELS, type Classification, type Level, levelOf } from "./classifier.ts";
import { maskPii } from "./masking.ts";

export const PROMPT_VERSION = "classify-v2";

export const SYSTEM = `You triage work mail for a semiconductor equipment field engineer.
Return JSON only, matching the schema. Judge the mail on its own:
- level: urgent (tool down, alarm with production impact, safety; act now), important (deadline within about 3 days, or a manager/customer request), normal (routine work, meetings), reference (FYI, newsletters, automated reports with no action).
- score: 0-100 consistent with level (urgent 80-100, important 55-79, normal 30-54, reference 0-29).
- needsReply: true only if the reader must reply, act or submit something.
- reasons: 1-3 short reasons quoting words from the mail.
- equipment: tool IDs, modules or alarm codes exactly as written in the mail. Never invent one.
- actionItems: requests to the reader; due = the deadline words exactly as written, or null.
- summary: at most 3 sentences in the mail's language.
Personal data is masked as [이름], [이메일] and similar; keep the masks as they are.`;

export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["level", "score", "needsReply", "reasons", "equipment", "actionItems", "summary"],
  properties: {
    level: { type: "string", enum: LEVELS },
    score: { type: "integer" },
    needsReply: { type: "boolean" },
    reasons: { type: "array", items: { type: "string" } },
    equipment: { type: "array", items: { type: "string" } },
    actionItems: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["text", "due"],
        properties: { text: { type: "string" }, due: { type: ["string", "null"] } },
      },
    },
    summary: { type: "string" },
  },
} as const;

export type LlmAnswer = {
  level: Level; score: number; needsReply: boolean; reasons: string[]; equipment: string[];
  actionItems: { text: string; due: string | null }[]; summary: string;
};
export type Shadow = {
  at: string; model: string; promptVersion: string;
  answer: LlmAnswer | null; valid: boolean; errors: string[];
};

type MailText = { subject?: string; bodyText?: string; senderName?: string; recipients?: string[] };

/** What leaves the device: masked subject and body, nothing else. maxChars caps cost per mail. */
export function buildUserMessage(mail: MailText, people: string[] = [], maxChars = 4000): string {
  const names = [mail.senderName ?? "", ...people, ...(mail.recipients ?? [])];
  const body = maskPii((mail.bodyText ?? "").slice(0, maxChars), names);
  return `Subject: ${maskPii(mail.subject ?? "", names)}\n\n${body}`;
}

/** Checks an LLM answer against the schema rules and against the mail text itself. */
export function validateAnswer(raw: unknown, mail: MailText): { answer: LlmAnswer | null; errors: string[] } {
  const errors: string[] = [];
  const a = raw as Partial<LlmAnswer> | null;
  if (!a || typeof a !== "object") return { answer: null, errors: ["JSON 객체가 아님"] };
  const text = `${mail.subject ?? ""}\n${mail.bodyText ?? ""}`;
  const low = text.toLowerCase();
  if (!LEVELS.includes(a.level as Level)) errors.push(`중요도 값이 허용 목록에 없음: ${String(a.level)}`);
  if (!Number.isInteger(a.score) || a.score! < 0 || a.score! > 100) errors.push(`점수가 0~100 정수가 아님: ${String(a.score)}`);
  else if (LEVELS.includes(a.level as Level) && levelOf(a.score!) !== a.level) errors.push(`점수 ${a.score}와 중요도 ${a.level} 불일치`);
  if (typeof a.needsReply !== "boolean") errors.push("needsReply가 true/false가 아님");
  if (!Array.isArray(a.reasons) || !a.reasons.length || a.reasons.length > 5 || a.reasons.some((r) => typeof r !== "string" || r.length > 200)) {
    errors.push("근거는 1~5개, 각 200자 이하 문자열이어야 함");
  }
  if (!Array.isArray(a.equipment)) errors.push("equipment가 배열이 아님");
  else for (const e of a.equipment) if (typeof e !== "string" || !e.trim() || !low.includes(e.toLowerCase())) errors.push(`본문에 없는 설비: ${String(e)}`);
  if (!Array.isArray(a.actionItems) || a.actionItems.length > 5) errors.push("할 일은 5개 이하 배열이어야 함");
  else for (const it of a.actionItems) {
    if (!it || typeof it.text !== "string" || it.text.length > 200) errors.push("할 일 문장이 비었거나 너무 김");
    else if (it.due !== null && (typeof it.due !== "string" || !text.includes(it.due))) errors.push(`본문에 없는 기한 표현: ${String(it.due)}`);
  }
  if (typeof a.summary !== "string" || a.summary.length > 600) errors.push("요약이 문자열이 아니거나 600자 초과");
  return { answer: errors.length ? null : (a as LlmAnswer), errors };
}

/** Decision after switching to the LLM: its level / reply / summary, the rule engine's entities and dates. */
export function applyAnswer(rule: Classification, shadow: Shadow | undefined): Classification {
  if (!shadow?.valid || !shadow.answer) return rule;
  const a = shadow.answer;
  const dates = rule.entities.dates;
  return {
    ...rule,
    importance: { level: a.level, score: a.score, reasons: ["LLM 판단 (규칙 검증 통과)", ...a.reasons] },
    needsReply: a.needsReply,
    summary: a.summary || rule.summary,
    actionItems: a.needsReply
      ? a.actionItems.map((it) => {
        const d = it.due ? dates.find((x) => x.raw === it.due || it.due!.includes(x.raw) || x.raw.includes(it.due!)) : undefined;
        return { text: it.text, due: it.due, dueIso: d?.iso ?? null, owner: rule.actionItems[0]?.owner ?? null };
      })
      : [],
    engine: "hybrid",
  };
}
