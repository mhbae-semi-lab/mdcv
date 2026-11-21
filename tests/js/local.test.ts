import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackend, memoryPersist } from "../../apps/web/app/lib/local.ts";

async function seeded() {
  const persist = memoryPersist();
  const be = createBackend(persist);
  await be.route("POST", "/api/demo/seed");
  return { be, persist };
}

test("demo seed, list filters and stats", async () => {
  const { be } = await seeded();
  const all = await be.route("GET", "/api/messages?limit=200");
  assert.equal(all.total, 30);
  const reply = await be.route("GET", "/api/messages?folder=reply&limit=200");
  assert.equal(reply.total, 16);
  const stats = await be.route("GET", "/api/stats");
  assert.equal(stats.needsReply, 16);
  assert.ok(stats.byEquipment["INSP-03"] > 0);
  await assert.rejects(be.route("GET", "/api/messages?importance=critical"), /importance/);
});

test("to-dos are sorted by due date", async () => {
  const { be } = await seeded();
  const { items } = await be.route("GET", "/api/todos");
  const dues = items.map((t: { dueIso: string | null }) => t.dueIso).filter(Boolean);
  assert.deepEqual(dues, [...dues].sort());
});

test("corrections survive reload and reclassification", async () => {
  const { be, persist } = await seeded();
  await be.route("POST", "/api/messages/dev-28/adjust", { level: "urgent", needsReply: true });
  await be.route("POST", "/api/reclassify");
  const again = createBackend(persist);
  const m = await again.route("GET", "/api/messages/dev-28");
  assert.equal(m.classification.importance.level, "urgent");
  assert.equal(m.classification.needsReply, true);
});

test("rule change: preview lists only changed mails, apply versions it, rollback restores", async () => {
  const { be } = await seeded();
  const before = await be.route("GET", "/api/messages/dev-28");
  const rule = [{ id: 0, rule_type: "keyword" as const, pattern: "agenda", weight: 40 }];
  const pv = be.preview(rule);
  assert.ok(pv.items.some((i) => i.id === "dev-28"));
  assert.equal(pv.items.find((i) => i.id === "dev-04"), undefined);
  assert.equal((await be.route("GET", "/api/messages/dev-28")).classification.importance.score, before.classification.importance.score, "preview must not change anything");
  await be.applyRules(rule, "agenda +40");
  assert.equal(be.history().length, 2);
  assert.ok((await be.route("GET", "/api/messages/dev-28")).classification.importance.score > before.classification.importance.score);
  await be.rollback(1);
  assert.equal(be.history().length, 3);
  assert.equal((await be.route("GET", "/api/messages/dev-28")).classification.importance.score, before.classification.importance.score);
});

test("eval trend replays each rule version on corrected mails", async () => {
  const { be } = await seeded();
  await be.route("POST", "/api/messages/dev-28/adjust", { needsReply: true });
  await be.applyRules([{ id: 0, rule_type: "keyword", pattern: "agenda", weight: 10 }], "noop");
  const trend = be.evalTrend();
  assert.equal(trend.length, 2);
  assert.equal(trend[0].labelled, 1);
  assert.equal(trend[0].replyMissed, 1);
});

test("shadow: switching needs the thresholds, and rollback returns to rules", async () => {
  const { be } = await seeded();
  await assert.rejects(be.setEngine("llm", "too early"), /전환 기준/);
  const ids = (await be.route("GET", "/api/messages?limit=200")).items.map((m: { id: string }) => m.id);
  for (const id of ids) {
    const c = be.ruleView(id)!;
    await be.saveShadow(id, { at: "", model: "test", promptVersion: "v", valid: true, errors: [],
      answer: { level: c.importance.level, score: c.importance.score, needsReply: c.needsReply, reasons: ["same"], equipment: [], actionItems: [], summary: "s" } });
  }
  const st = be.shadowStats();
  assert.equal(st.compared, 30);
  assert.equal(st.canSwitch, true);
  await be.setEngine("llm", "agreement 100%");
  assert.equal((await be.route("GET", "/api/messages/dev-01")).classification.engine, "hybrid");
  await be.setEngine("rule", "rollback");
  assert.equal((await be.route("GET", "/api/messages/dev-01")).classification.engine, "rule");
});

test("backup export / import round trip; foreign files rejected", async () => {
  const { be } = await seeded();
  await be.route("POST", "/api/messages/dev-02/adjust", { level: "reference" });
  const json = be.exportAll();
  const other = createBackend(memoryPersist());
  await other.importAll(json);
  assert.equal((await other.route("GET", "/api/stats")).total, 30);
  assert.equal((await other.route("GET", "/api/messages/dev-02")).classification.importance.level, "reference");
  await assert.rejects(other.importAll("{\"app\":\"x\"}"), /백업 파일/);
});

test("browser build never sends mail", async () => {
  const { be } = await seeded();
  await assert.rejects(be.route("POST", "/api/messages/dev-01/send-reply", { confirm: true }), /보내지 않습니다/);
});
