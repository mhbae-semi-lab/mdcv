// node --test "tests/js/*.test.ts"   (Node 22.18+ runs TypeScript directly)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeHeader, parseMailDate, parseMailFile } from "../../packages/engine/importers.ts";

const dir = new URL("../../packages/shared/samples/files/", import.meta.url);
const load = (name: string) => parseMailFile(name, new Uint8Array(readFileSync(new URL(name, dir))), "2026-11-01T00:00:00+09:00");

test("RFC 2047 headers in UTF-8 and EUC-KR", () => {
  assert.equal(decodeHeader("=?utf-8?B?7ISk67mE?= =?utf-8?B?IOyVjOuejA==?="), "설비 알람");
  assert.equal(decodeHeader("=?euc-kr?Q?=BC=B3=BA=F1?="), "설비");
});

test("RFC 2822 dates keep the sender's wall time", () => {
  assert.equal(parseMailDate("Mon, 16 Nov 2026 07:12:00 +0900"), "2026-11-16T07:12:00+09:00");
  assert.equal(parseMailDate("16 Nov 26 7:12 GMT"), "2026-11-16T07:12:00+00:00");
  assert.equal(parseMailDate("yesterday"), null);
});

test(".eml base64 UTF-8 with encoded-word headers", () => {
  const { mails, issues } = load("alarm-INSP-03.eml");
  assert.equal(issues.length, 0);
  assert.equal(mails[0].subject, "[알람] INSP-03 ALM-2041 스테이지 위치 편차 초과 (Critical)");
  assert.equal(mails[0].receivedAt, "2026-11-16T07:12:00+09:00");
  assert.match(mails[0].bodyText, /즉시 현장 확인/);
  assert.equal(mails[0].hasAttachment, false);
});

test(".eml multipart: plain text preferred, attachment counted", () => {
  const { mails } = load("review-with-attachment.eml");
  assert.equal(mails[0].hasAttachment, true);
  assert.doesNotMatch(mails[0].bodyText, /<p>/);
  assert.match(mails[0].bodyText, /검토해 주시면 감사하겠습니다/);
});

test(".eml EUC-KR quoted-printable (ks_c_5601-1987)", () => {
  const { mails } = load("legacy-euckr.eml");
  assert.match(mails[0].subject, /로드포트/);
  assert.match(mails[0].bodyText, /로드포트/);
});

test(".mbox splits 30 mails and unescapes >From", () => {
  const { mails, issues } = load("fab-week-30.mbox");
  assert.equal(mails.length, 30);
  assert.equal(issues.filter((i) => i.fatal).length, 0);
  assert.equal(new Set(mails.map((m) => m.id)).size, 30);
});

test(".msg (OLE compound file): subject, sender, body, time, attachment", () => {
  const { mails, issues } = load("customer-request.msg");
  assert.equal(issues.length, 0);
  const m = mails[0];
  assert.equal(m.subject, "AOI-12 nuisance defect spike on M2 layer");
  assert.equal(m.senderEmail, "ethan.morrow@example.net");
  assert.match(m.bodyText, /autofocus logs/);
  assert.equal(m.hasAttachment, true);
  assert.deepEqual(m.recipients, ["me@example.com"]);
  assert.equal(new Date(m.receivedAt).toISOString(), "2026-11-16T02:30:00.000Z");
});

test("broken files report the file and the reason, never throw", () => {
  const eml = load("broken-no-headers.eml");
  assert.equal(eml.mails.length, 0);
  assert.equal(eml.issues[0].fatal, true);
  assert.equal(eml.issues[0].line, 1);
  const msg = load("broken-truncated.msg");
  assert.equal(msg.mails.length, 0);
  assert.equal(msg.issues[0].fatal, true);
  assert.match(parseMailFile("notes.docx", new Uint8Array([80, 75, 3, 4])).issues[0].message, /지원하지 않는/);
});

test("missing blank line between headers and body: body kept, line reported", () => {
  const r = parseMailFile("x.eml", new TextEncoder().encode("Subject: 점검\nFrom: a@example.com\nDate: Mon, 16 Nov 2026 07:12:00 +0900\n본문 INSP-03 점검 부탁드립니다\n둘째 줄"));
  assert.equal(r.mails[0].bodyText, "본문 INSP-03 점검 부탁드립니다\n둘째 줄");
  assert.equal(r.issues[0].line, 4);
  assert.equal(r.issues[0].fatal, false);
});
