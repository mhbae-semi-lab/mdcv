// Fault injection for the LLM answer validator (node scripts/validator-faults.mjs).
// For each synthetic mail a correct answer is built from its labels; five broken variants must all be rejected.
import { readFileSync } from "node:fs";
import { validateAnswer } from "../packages/engine/llm.ts";

const sets = ["dev", "holdout", "blind2"].flatMap((s) => JSON.parse(readFileSync(new URL(`../packages/shared/samples/fab-${s}-30.json`, import.meta.url), "utf8")));
const mid = { urgent: 88, important: 65, normal: 40, reference: 15 };
const faults = {
  levelNotAllowed: (a) => ({ ...a, level: "critical" }),
  scoreOutOfRange: (a) => ({ ...a, score: 140 }),
  scoreLevelMismatch: (a) => ({ ...a, score: a.level === "urgent" ? 20 : 95 }),
  inventedEquipment: (a) => ({ ...a, equipment: [...a.equipment, "ZZQ-999"] }),
  inventedDeadline: (a) => ({ ...a, needsReply: true, actionItems: [{ text: "회신", due: "12월 31일 23시까지" }] }),
};
let goodPass = 0;
const caught = Object.fromEntries(Object.keys(faults).map((k) => [k, 0]));
for (const m of sets) {
  const l = m.labels;
  const good = { level: l.level, score: mid[l.level], needsReply: l.needsReply, reasons: ["근거"], equipment: l.equipment,
    actionItems: l.needsReply ? [{ text: "요청 처리", due: l.dueText }] : [], summary: "요약" };
  if (!validateAnswer(good, m).errors.length) goodPass++;
  for (const [k, f] of Object.entries(faults)) if (validateAnswer(f(good), m).errors.length) caught[k]++;
}
const total = Object.values(caught).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ mails: sets.length, goodAccepted: goodPass, faultsInjected: sets.length * Object.keys(faults).length, faultsRejected: total, byFault: caught }));
