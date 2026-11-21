import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDates } from "../../packages/engine/dates.ts";
import { RuleClassifier, findEquipment } from "../../packages/engine/classifier.ts";
import { maskPii } from "../../packages/engine/masking.ts";
import { applyAnswer, buildUserMessage, validateAnswer } from "../../packages/engine/llm.ts";
import { buildDigest } from "../../packages/engine/digest.ts";
import { parseWall } from "../../packages/engine/text.ts";

const WED = "2026-11-18T09:30:00"; // Wednesday
const due = (text: string) => parseDates(text, WED).filter((d) => d.kind === "deadline").map((d) => d.iso);

test("Korean deadline expressions resolve against the received time", () => {
  assert.deepEqual(due("11/24(화)까지 회신"), ["2026-11-24T18:00"]);
  assert.deepEqual(due("금주 중 회신 바랍니다"), ["2026-11-20T18:00"]);
  assert.deepEqual(due("차주 화요일까지 제출"), ["2026-11-24T18:00"]);
  assert.deepEqual(due("익일 09시까지"), ["2026-11-19T09:00"]);
  assert.deepEqual(due("내일 오전 중 보내 주세요"), ["2026-11-19T12:00"]);
  assert.deepEqual(due("이번 달 말까지"), ["2026-11-30T18:00"]);
  assert.deepEqual(due("3일 이내 회신"), ["2026-11-21T18:00"]);
  assert.deepEqual(due("주중에 공유 부탁드립니다"), ["2026-11-20T18:00"]);
});

test("next-week weekday is next calendar week (v1 added 7 days to the wrong base)", () => {
  assert.equal(parseDates("다음 주 월요일 오전 10시 회의", WED)[0].iso, "2026-11-23T10:00");
});

test("English deadlines", () => {
  assert.deepEqual(due("Please confirm by Friday"), ["2026-11-20T18:00"]);
  assert.deepEqual(due("by Nov 24"), ["2026-11-24T18:00"]);
  assert.deepEqual(due("EOD Thursday"), ["2026-11-19T18:00"]);
  assert.deepEqual(due("no later than Friday"), ["2026-11-20T18:00"]);
});

test("tool IDs next to Korean particles and alarm codes are entities", () => {
  assert.deepEqual(findEquipment("INSP-03이 다운됐고 진공 펌프 교체"), ["INSP-03", "진공 펌프"]);
  const c = new RuleClassifier().classify({ subject: "[알람] AOI_09 ALM-4127", bodyText: "로드포트 E-1093 반복", receivedAt: WED });
  assert.deepEqual(c.entities.alarms, ["ALM-4127", "E-1093"]);
  assert.ok(c.entities.equipment.includes("AOI-09"));
});

test("reply detection: requests yes, FYI / conditional / quoted no", () => {
  const clf = new RuleClassifier();
  const reply = (bodyText: string, subject = "건") => clf.classify({ subject, bodyText, receivedAt: WED }).needsReply;
  assert.equal(reply("결과를 공유해 주셨으면 합니다."), true);
  assert.equal(reply("I'd appreciate it if you could share the logs."), true);
  assert.equal(reply("참고용으로 공유드립니다. 회신 불필요합니다."), false);
  assert.equal(reply("변경이 필요한 경우에만 공유해 주십시오."), false);
  assert.equal(reply("감사합니다.\n> 회신 부탁드립니다?"), false);
});

test("urgency needs an outage word; resolved issues are not urgent", () => {
  const clf = new RuleClassifier();
  const down = clf.classify({ subject: "INSP-21 Tool DOWN", bodyText: "즉시 점검하십시오. 진행 중 Lot Hold", receivedAt: WED });
  assert.equal(down.importance.level, "urgent");
  const fixed = clf.classify({ subject: "RE: INSP-03 다운 긴급 지원", bodyText: "정상 가동 중입니다. 결과서를 내일까지 보내 주세요.", receivedAt: WED });
  assert.notEqual(fixed.importance.level, "urgent");
});

test("PII masking covers contacts, ids and names", () => {
  const out = maskPii("한도윤 010-0000-1234, kim@example.com, 사번 EMP-0042, IP 10.1.2.3", ["한도윤"]);
  assert.equal(out, "[이름] [전화번호], [이메일], 사번 [사번], IP [IP]");
});

test("LLM answers are validated against the mail before use", () => {
  const mail = { subject: "INSP-03 결과 요청", bodyText: "내일까지 보내 주세요" };
  const good = { level: "important", score: 60, needsReply: true, reasons: ["내일까지"], equipment: ["INSP-03"], actionItems: [{ text: "결과 전달", due: "내일까지" }], summary: "결과 요청" };
  assert.deepEqual(validateAnswer(good, mail).errors, []);
  const bad = { ...good, level: "critical", score: 140, equipment: ["CMP-9"], actionItems: [{ text: "x", due: "모레" }] };
  const errs = validateAnswer(bad, mail).errors.join(" | ");
  assert.match(errs, /허용 목록/);
  assert.match(errs, /0~100/);
  assert.match(errs, /본문에 없는 설비: CMP-9/);
  assert.match(errs, /본문에 없는 기한/);
  assert.match(validateAnswer({ ...good, score: 90 }, mail).errors[0], /불일치/);
  const rule = new RuleClassifier().classify({ ...mail, receivedAt: WED });
  assert.equal(applyAnswer(rule, { at: "", model: "m", promptVersion: "v", answer: null, valid: false, errors: ["x"] }), rule);
  assert.match(buildUserMessage({ subject: "s", bodyText: "a@b.com 한도윤", senderName: "한도윤" }), /\[이메일\] \[이름\]/);
});

test("digest anchors on the given day and sorts action items by due", () => {
  const clf = new RuleClassifier();
  const mk = (id: string, body: string) => ({ id, subject: id, receivedAt: WED, classification: clf.classify({ subject: id, bodyText: body, receivedAt: WED }) });
  const d = buildDigest([mk("a", "금요일까지 회신 부탁드립니다"), mk("b", "내일까지 회신 부탁드립니다")], "daily", parseWall(WED)!);
  assert.equal(d.total, 2);
  assert.deepEqual(d.actionItems.map((a) => a.mailId), ["b", "a"]);
});
