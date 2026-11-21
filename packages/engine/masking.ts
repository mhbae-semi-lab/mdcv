// Personal data masking before any text leaves the device (LLM calls). Twin of apps/api/mdcv/masking.py.

const PATTERNS: [RegExp, string][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[이메일]"],
  [/(?<![0-9])[0-9]{6}-[1-4][0-9]{6}(?![0-9])/g, "[주민번호]"],
  [/(?<![0-9])[0-9]{4}[- ][0-9]{4}[- ][0-9]{4}[- ][0-9]{4}(?![0-9])/g, "[카드번호]"],
  [/(?<![0-9])(?:\+82[- ]?)?0?1[016789][- .]?[0-9]{3,4}[- .]?[0-9]{4}(?![0-9])/g, "[전화번호]"],
  [/(?<![0-9])0[2-6][0-9]?[- .)][0-9]{3,4}[- .][0-9]{4}(?![0-9])/g, "[전화번호]"],
  [/(?<![0-9.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9.])/g, "[IP]"],
  [/(비밀번호|패스워드|password|pw)\s*[:=]\s*\S+/gi, "$1: [마스킹]"],
  [/(사번|employee\s+(?:id|no\.?))\s*[:#]?\s*[A-Za-z0-9-]{4,}/gi, "$1 [사번]"],
];

/** Masks contact data, ids and the given names (sender, recipients, people found in the text). */
export function maskPii(text: string, names: string[] = []): string {
  let out = text || "";
  for (const [rx, repl] of PATTERNS) out = out.replace(rx, repl);
  const uniq = [...new Set(names.map((n) => (n || "").trim()).filter((n) => Array.from(n).length >= 2))];
  for (const name of uniq.sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))) out = out.split(name).join("[이름]");
  return out;
}
