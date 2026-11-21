// Korean is the source language: t("한국어 문장") returns the English text when the UI language is English.
// Missing English entries fall back to Korean (scripts/i18n-check.mjs lists them).
import { EN } from "./i18n-en";

export type Lang = "ko" | "en";
let lang: Lang = "ko";

export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  if (typeof document !== "undefined") document.documentElement.lang = l;
}
export function initialLang(stored: string | null): Lang {
  if (stored === "ko" || stored === "en") return stored;
  return typeof navigator !== "undefined" && !navigator.language.toLowerCase().startsWith("ko") ? "en" : "ko";
}

export function t(ko: string, vars?: Record<string, string | number>): string {
  let s = lang === "en" ? EN[ko] ?? ko : ko;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

// Engine reasons and validation messages are produced in Korean; translate the known prefixes for display.
const REASONS: [RegExp, string][] = [
  [/^VIP 발신자$/, "VIP sender"],
  [/^긴급 키워드: /, "Urgent words: "],
  [/^설비 이상 관련\((.*)\)$/, "Equipment problem ($1)"],
  [/^생산 영향: /, "Production impact: "],
  [/^설비 이상 징후: /, "Equipment warning signs: "],
  [/^해결·복구 표현: /, "Resolved / recovered: "],
  [/^고객 관련: /, "Customer: "],
  [/^회신\/조치 요청 포함$/, "Asks for a reply or action"],
  [/^72시간 내 마감\((.*)\)$/, "Due within 72 h ($1)"],
  [/^7일 내 마감\((.*)\)$/, "Due within 7 days ($1)"],
  [/^기한 있는 회신 요청$/, "Request with a deadline"],
  [/^설비 언급\((.*)\)$/, "Equipment mentioned ($1)"],
  [/^회의\/점검 일정$/, "Meeting or maintenance schedule"],
  [/^날짜\/일정 포함$/, "Contains dates"],
  [/^대량\/광고성 메일$/, "Bulk / promotional mail"],
  [/^회신 불필요 표시: /, "Marked no-reply: "],
  [/^참고용 표시로 '일반' 이하$/, "FYI mail: capped at 'normal'"],
  [/^사용자 키워드: /, "Your keyword: "],
  [/^일반 업무 메일$/, "Ordinary work mail"],
  [/^사용자가 직접 지정$/, "Set by you"],
  [/^LLM 판단 \(규칙 검증 통과\)$/, "LLM decision (passed rule checks)"],
  [/^중요도 값이 허용 목록에 없음: /, "Level not allowed: "],
  [/^점수가 0~100 정수가 아님: /, "Score is not an integer 0-100: "],
  [/^점수 (\S+)와 중요도 (\S+) 불일치$/, "Score $1 does not match level $2"],
  [/^본문에 없는 설비: /, "Equipment not in the mail: "],
  [/^본문에 없는 기한 표현: /, "Deadline words not in the mail: "],
  [/^맞춤법\/표현 교정 제안$/, "Spelling / wording suggestion"],
];
export function tr(text: string): string {
  if (lang !== "en") return text;
  for (const [rx, en] of REASONS) if (rx.test(text)) return text.replace(rx, en);
  return EN[text] ?? text;
}
