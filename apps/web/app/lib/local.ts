// Browser backend: everything the self-host API does for one user, kept in memory and saved through a Persist
// adapter (IndexedDB in the browser, memory in tests). Also holds the field-verification features:
// rule versions with preview / apply / rollback, LLM shadow results, switch-over, and the correction-based eval.
import { DEFAULT_EQUIPMENT, LEVELS, RuleClassifier, type Classification, type Level, type MailIn } from "../../../../packages/engine/classifier.ts";
import { PERIODS, type Period, buildDigest } from "../../../../packages/engine/digest.ts";
import { type Shadow, applyAnswer } from "../../../../packages/engine/llm.ts";
import { checkConsistency, correctText, makeReplyDraft } from "../../../../packages/engine/validator.ts";
import { addDays, isoMinutes, nowWall, parseWall } from "../../../../packages/engine/text.ts";
import demoSet from "../../../../packages/shared/samples/fab-dev-30.json" with { type: "json" };

export type RuleType = "vip_sender" | "equipment" | "keyword";
export type UserRule = { id: number; rule_type: RuleType; pattern: string; weight: number };
export type RuleVersion = { version: number; at: string; note: string; rules: UserRule[] };
export type Override = { level?: Level; needsReply?: boolean; equipmentAdd?: string[]; equipmentRemove?: string[]; at?: string; ruleVersion?: number };
export type StoredMail = MailIn & {
  id: string; provider: string; subject: string; senderName: string; senderEmail: string; receivedAt: string; bodyText: string;
  recipients: string[]; hasAttachment: boolean; isRead: boolean; status: "open" | "done"; source?: string;
  override?: Override; shadow?: Shadow;
};
export type Mail = Omit<StoredMail, "override"> & { classification: Classification };
export type DecisionEvent = { at: string; engine: "rule" | "llm"; note: string };
export type LogEvent = { at: string; action: string; detail?: string };
export type Persist = {
  load(): Promise<{ mails: StoredMail[]; kv: Record<string, unknown> }>;
  putMails(list: StoredMail[]): Promise<void>;
  deleteMails(ids: string[]): Promise<void>;
  putKv(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
};
export class LocalError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export const SWITCH_RULES = { minCompared: 20, maxInvalidRate: 0.1, minLevelAgree: 0.7, maxReplyMisses: 0 };
const HOT = new Set<Level>(["urgent", "important"]);
const now = () => isoMinutes(nowWall());

export function memoryPersist(): Persist {
  const mails = new Map<string, StoredMail>();
  const kv: Record<string, unknown> = {};
  return {
    async load() { return { mails: [...mails.values()], kv: { ...kv } }; },
    async putMails(list) { for (const m of list) mails.set(m.id, structuredClone(m)); },
    async deleteMails(ids) { for (const id of ids) mails.delete(id); },
    async putKv(key, value) { kv[key] = structuredClone(value); },
    async clear() { mails.clear(); for (const k of Object.keys(kv)) delete kv[k]; },
  };
}

export function classifierFor(rules: UserRule[]): RuleClassifier {
  const own = rules.filter((r) => r.rule_type === "equipment").map((r) => [r.pattern]);
  return new RuleClassifier({
    equipment: own.length ? [...DEFAULT_EQUIPMENT, ...own] : DEFAULT_EQUIPMENT,
    vip: rules.filter((r) => r.rule_type === "vip_sender").map((r) => r.pattern),
    weights: Object.fromEntries(rules.filter((r) => r.rule_type === "keyword").map((r) => [r.pattern, r.weight])),
  });
}

/** User corrections win over rules and LLM. Twin of apply_override in apps/api/mdcv/store.py (plus needsReply). */
export function applyOverride(cls: Classification, ov?: Override): Classification {
  if (!ov) return cls;
  const out = structuredClone(cls);
  const imp = out.importance;
  if (ov.level && LEVELS.includes(ov.level)) {
    if (ov.level !== imp.level) {
      imp.autoLevel = imp.level;
      imp.level = ov.level;
      imp.reasons = ["사용자가 직접 지정", ...imp.reasons.filter((r) => r !== "사용자가 직접 지정")];
    }
    imp.overridden = true;
  }
  if (typeof ov.needsReply === "boolean" && ov.needsReply !== out.needsReply) {
    out.needsReply = ov.needsReply;
    if (!ov.needsReply) out.actionItems = [];
    else if (!out.actionItems.length) out.actionItems = [{ text: "회신 필요(사용자 지정)", due: null, dueIso: null, owner: null }];
  }
  const remove = new Set(ov.equipmentRemove ?? []);
  const eq = out.entities.equipment.filter((e) => !remove.has(e));
  for (const e of ov.equipmentAdd ?? []) if (!eq.includes(e)) eq.push(e);
  out.entities.equipment = eq;
  return out;
}

const levelRank = (l: Level) => LEVELS.indexOf(l);
const byDue = (a: string | null, b: string | null) => (a ?? "9999") < (b ?? "9999") ? -1 : (a ?? "9999") > (b ?? "9999") ? 1 : 0;

export function createBackend(persist: Persist) {
  const mails = new Map<string, StoredMail>();
  const cache = new Map<string, Classification>();
  let history: RuleVersion[] = [{ version: 1, at: now(), note: "기본 규칙", rules: [] }];
  let decision: { engine: "rule" | "llm"; history: DecisionEvent[] } = { engine: "rule", history: [] };
  let events: LogEvent[] = [];
  let clf = classifierFor([]);
  let ready: Promise<void> | null = null;

  const current = () => history[history.length - 1];
  const log = (action: string, detail = "") => {
    events = [{ at: now(), action, detail }, ...events].slice(0, 200);
    void persist.putKv("events", events);
  };
  const rawOf = (m: StoredMail): Classification => {
    let cls = cache.get(m.id);
    if (!cls) {
      cls = clf.classify(m);
      cls.messageId = m.id;
      cache.set(m.id, cls);
    }
    return cls;
  };
  const decide = (m: StoredMail): Classification => {
    const cls = rawOf(m);
    const decided = decision.engine === "llm" ? applyAnswer(cls, m.shadow) : cls;
    return applyOverride(decided, m.override);
  };
  const view = (m: StoredMail): Mail => {
    const { override: _o, ...rest } = m;
    return { ...rest, classification: decide(m) };
  };
  const get = (id: string) => {
    const m = mails.get(decodeURIComponent(id));
    if (!m) throw new LocalError(404, "메일을 찾을 수 없습니다.");
    return m;
  };
  const save = (list: StoredMail[]) => persist.putMails(list);
  const reclassifyAll = () => { clf = classifierFor(current().rules); cache.clear(); };
  /** Reference "now": the last received mail when the data is an older archive (imported files, demo set). */
  const anchor = () => {
    let last = "";
    for (const m of mails.values()) if (m.receivedAt > last) last = m.receivedAt;
    const n = nowWall();
    const lw = parseWall(last);
    return lw && lw.getTime() < addDays(n, -1).getTime() ? new Date(Date.UTC(lw.getUTCFullYear(), lw.getUTCMonth(), lw.getUTCDate(), 23, 59)) : n;
  };
  const sorted = () => [...mails.values()].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : a.id < b.id ? -1 : 1));

  function stats() {
    const byImportance: Record<string, number> = {};
    const byEquipment: Record<string, number> = {};
    const providers: Record<string, number> = {};
    let needsReply = 0, unread = 0, unreadUrgent = 0, done = 0;
    for (const m of mails.values()) {
      const c = decide(m);
      const lv = c.importance.level;
      byImportance[lv] = (byImportance[lv] ?? 0) + 1;
      for (const e of c.entities.equipment) byEquipment[e] = (byEquipment[e] ?? 0) + 1;
      providers[m.provider] = (providers[m.provider] ?? 0) + 1;
      if (c.needsReply && m.status === "open") needsReply++;
      if (!m.isRead) { unread++; if (lv === "urgent") unreadUrgent++; }
      if (m.status === "done") done++;
    }
    return { total: mails.size, byImportance, byEquipment, providers, needsReply, unread, unreadUrgent, done, engine: decision.engine, rulesVersion: current().version };
  }

  function list(q: URLSearchParams) {
    const text = (q.get("q") ?? "").trim().toLowerCase();
    const importance = q.get("importance") ?? "";
    if (importance && !LEVELS.includes(importance as Level)) throw new LocalError(400, `importance는 ${LEVELS.join(", ")} 중 하나여야 합니다.`);
    const equipment = q.get("equipment") ?? "";
    const reply = q.get("folder") === "reply";
    const limit = Math.min(200, Math.max(1, Number(q.get("limit") ?? 50) || 50));
    const offset = Math.max(0, Number(q.get("offset") ?? 0) || 0);
    const items: Mail[] = [];
    for (const m of sorted()) {
      const c = decide(m);
      if (text && ![m.subject, m.bodyText, m.senderName, m.senderEmail, ...c.entities.equipment].some((s) => s.toLowerCase().includes(text))) continue;
      if (importance && c.importance.level !== importance) continue;
      if (equipment && !c.entities.equipment.includes(equipment)) continue;
      if (reply && !(c.needsReply && m.status === "open")) continue;
      items.push({ ...view(m), classification: c });
    }
    return { items: items.slice(offset, offset + limit), total: items.length };
  }

  function todos() {
    const items: { text: string; due: string | null; dueIso: string | null; mailId: string; subject: string; sender: string; level: Level }[] = [];
    for (const m of mails.values()) {
      const c = decide(m);
      if (!c.needsReply || m.status !== "open") continue;
      for (const a of c.actionItems) items.push({ text: a.text, due: a.due, dueIso: a.dueIso, mailId: m.id, subject: m.subject, sender: m.senderName, level: c.importance.level });
    }
    items.sort((a, b) => byDue(a.dueIso, b.dueIso) || levelRank(a.level) - levelRank(b.level));
    return { items, now: isoMinutes(anchor()) };
  }

  function adjust(m: StoredMail, body: Record<string, unknown>) {
    const ov: Override = body.clear ? {} : { ...(m.override ?? {}) };
    if (body.level !== undefined) {
      if (body.level && !LEVELS.includes(body.level as Level)) throw new LocalError(400, `level은 ${LEVELS.join(", ")} 중 하나여야 합니다.`);
      ov.level = (body.level || undefined) as Level | undefined;
    }
    if (body.needsReply !== undefined) ov.needsReply = typeof body.needsReply === "boolean" ? body.needsReply : undefined;
    const add = new Set([...(ov.equipmentAdd ?? []), ...((body.equipmentAdd as string[]) ?? [])]);
    const rem = new Set([...(ov.equipmentRemove ?? []), ...((body.equipmentRemove as string[]) ?? [])]);
    for (const e of (body.equipmentAdd as string[]) ?? []) rem.delete(e);
    for (const e of (body.equipmentRemove as string[]) ?? []) add.delete(e);
    ov.equipmentAdd = [...add].sort();
    ov.equipmentRemove = [...rem].sort();
    ov.at = now();
    ov.ruleVersion = current().version;
    const empty = !ov.level && ov.needsReply === undefined && !ov.equipmentAdd.length && !ov.equipmentRemove.length;
    m.override = empty ? undefined : ov;
    void save([m]);
    log("adjust", m.id);
    return decide(m);
  }

  // --- field verification -------------------------------------------------------------------------------------------
  type Snap = { level: Level; score: number; needsReply: boolean; equipment: string[] };
  const snap = (c: Classification): Snap => ({ level: c.importance.level, score: c.importance.score, needsReply: c.needsReply, equipment: c.entities.equipment });

  /** Same mails, current rules vs candidate rules: only the mails whose decision changes. */
  function preview(candidate: UserRule[]) {
    const next = classifierFor(candidate);
    const changes = [];
    for (const m of sorted()) {
      const before = snap(decide(m));
      const raw = next.classify(m);
      const after = snap(applyOverride(decision.engine === "llm" ? applyAnswer(raw, m.shadow) : raw, m.override));
      const changed = (["level", "needsReply", "equipment"] as const).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      if (changed.length || before.score !== after.score) changes.push({ id: m.id, subject: m.subject, sender: m.senderName, before, after, changed });
    }
    return { total: mails.size, changed: changes.filter((c) => c.changed.length).length, scoreOnly: changes.filter((c) => !c.changed.length).length, items: changes };
  }

  async function applyRules(candidate: UserRule[], note: string) {
    const version = current().version + 1;
    history = [...history, { version, at: now(), note, rules: candidate.map((r, i) => ({ ...r, id: r.id || Date.now() + i })) }];
    await persist.putKv("ruleHistory", history);
    reclassifyAll();
    log("rules_apply", `v${version} ${note}`);
    return current();
  }

  function labelled() {
    return [...mails.values()].filter((m) => m.override && (m.override.level || typeof m.override.needsReply === "boolean"));
  }

  /** Replays every rule version on the mails the user corrected: how many corrections each version would miss. */
  function evalTrend() {
    const set = labelled();
    return history.map((v) => {
      const c = classifierFor(v.rules);
      let hotMissed = 0, replyMissed = 0, falseAlarm = 0, agree = 0;
      for (const m of set) {
        const p = c.classify(m);
        const ov = m.override!;
        const hotTruth = ov.level ? HOT.has(ov.level) : null;
        const replyTruth = typeof ov.needsReply === "boolean" ? ov.needsReply : null;
        if (hotTruth === true && !HOT.has(p.importance.level)) hotMissed++;
        if (replyTruth === true && !p.needsReply) replyMissed++;
        if ((hotTruth === false && HOT.has(p.importance.level)) || (replyTruth === false && p.needsReply)) falseAlarm++;
        if ((!ov.level || ov.level === p.importance.level) && (replyTruth === null || replyTruth === p.needsReply)) agree++;
      }
      return { version: v.version, at: v.at, note: v.note, rules: v.rules.length, labelled: set.length, hotMissed, replyMissed, falseAlarm, agree };
    });
  }

  function shadowStats() {
    let compared = 0, invalid = 0, levelAgree = 0, replyAgree = 0, replyMisses = 0, pending = 0;
    const disagreements = [];
    const failures = [];
    for (const m of sorted()) {
      if (!m.shadow) { pending++; continue; }
      const rule = applyOverride(rawOf(m), m.override);
      if (!m.shadow.valid || !m.shadow.answer) { invalid++; failures.push({ id: m.id, subject: m.subject, errors: m.shadow.errors }); continue; }
      compared++;
      const a = m.shadow.answer;
      const sameLevel = a.level === rule.importance.level;
      const sameReply = a.needsReply === rule.needsReply;
      levelAgree += +sameLevel;
      replyAgree += +sameReply;
      if (rule.needsReply && !a.needsReply) replyMisses++;
      if (!sameLevel || !sameReply) {
        disagreements.push({ id: m.id, subject: m.subject, rule: { level: rule.importance.level, needsReply: rule.needsReply, reasons: rule.importance.reasons.slice(0, 3) },
          llm: { level: a.level, needsReply: a.needsReply, reasons: a.reasons } });
      }
    }
    const runs = compared + invalid;
    const checks = [
      { key: "compared", ok: compared >= SWITCH_RULES.minCompared, value: compared, need: `≥ ${SWITCH_RULES.minCompared}` },
      { key: "invalid", ok: runs > 0 && invalid / runs <= SWITCH_RULES.maxInvalidRate, value: runs ? invalid / runs : 0, need: `≤ ${SWITCH_RULES.maxInvalidRate * 100}%` },
      { key: "levelAgree", ok: compared > 0 && levelAgree / compared >= SWITCH_RULES.minLevelAgree, value: compared ? levelAgree / compared : 0, need: `≥ ${SWITCH_RULES.minLevelAgree * 100}%` },
      { key: "replyMisses", ok: compared > 0 && replyMisses <= SWITCH_RULES.maxReplyMisses, value: replyMisses, need: `= ${SWITCH_RULES.maxReplyMisses}` },
    ];
    return { compared, invalid, pending, levelAgree, replyAgree, replyMisses, disagreements, failures, checks,
      canSwitch: checks.every((c) => c.ok), engine: decision.engine, history: decision.history };
  }

  async function setEngine(engine: "rule" | "llm", note: string) {
    if (engine === "llm" && !shadowStats().canSwitch) throw new LocalError(400, "전환 기준을 아직 넘지 못했습니다.");
    decision = { engine, history: [{ at: now(), engine, note }, ...decision.history] };
    await persist.putKv("decision", decision);
    log("engine_switch", engine);
    return decision;
  }

  async function addMails(list: Omit<StoredMail, "isRead" | "status">[]) {
    const known = new Set(mails.keys());
    const added: StoredMail[] = [];
    let duplicates = 0;
    for (const m of list) {
      if (known.has(m.id)) { duplicates++; continue; }
      known.add(m.id);
      added.push({ ...m, isRead: false, status: "open" });
    }
    for (const m of added) mails.set(m.id, m);
    await save(added);
    if (added.length) log("import", `${added.length}`);
    return { added: added.length, duplicates };
  }

  // --- routes shared with the self-host API (same paths and shapes) --------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each path returns its own JSON shape, typed at the call site
  async function route(method: string, path: string, body: Record<string, unknown> = {}): Promise<any> {
    await init();
    const [p, qs = ""] = path.split("?");
    const q = new URLSearchParams(qs);
    const m1 = (rx: RegExp) => p.match(rx);
    let m: RegExpMatchArray | null;
    if (method === "GET" && p === "/api/stats") return stats();
    if (method === "GET" && p === "/api/messages") return list(q);
    if (method === "POST" && p === "/api/demo/seed") {
      return addMails((demoSet as unknown as StoredMail[]).map((d) => ({
        id: d.id, provider: "demo", subject: d.subject, senderName: d.senderName, senderEmail: d.senderEmail, receivedAt: d.receivedAt,
        bodyText: d.bodyText, recipients: ["me@example.com"], hasAttachment: /첨부|attached/i.test(d.bodyText), source: "fab-dev-30" })))
        .then((r) => ({ inserted: r.added }));
    }
    if ((m = m1(/^\/api\/messages\/([^/]+)$/))) {
      const mail = get(m[1]);
      if (method === "GET") return view(mail);
      if (method === "PATCH") {
        if (body.status !== undefined && body.status !== "open" && body.status !== "done") throw new LocalError(400, "status는 open 또는 done이어야 합니다.");
        if (typeof body.isRead === "boolean") mail.isRead = body.isRead;
        if (body.status) mail.status = body.status as "open" | "done";
        await save([mail]);
        return view(mail);
      }
    }
    if (method === "POST" && (m = m1(/^\/api\/messages\/([^/]+)\/(classify|adjust|correct|reply-draft)$/))) {
      const mail = get(m[1]);
      if (m[2] === "classify") { cache.delete(mail.id); return decide(mail); }
      if (m[2] === "adjust") return adjust(mail, body);
      if (m[2] === "correct") {
        const r = correctText(mail.bodyText);
        return { ...r, issues: [...r.issues, ...checkConsistency(mail.bodyText, decide(mail).entities)] };
      }
      return makeReplyDraft(mail, decide(mail), body.lang === "en" ? "en" : "ko");
    }
    if (method === "POST" && /\/send-reply$/.test(p)) throw new LocalError(400, "브라우저판은 메일을 보내지 않습니다. 초안을 복사해 메일 프로그램에서 보내세요.");
    if (method === "GET" && p === "/api/todos") return todos();
    if (method === "GET" && (m = m1(/^\/api\/digests\/([a-z]+)$/))) {
      if (!PERIODS.includes(m[1] as Period)) throw new LocalError(404, "알 수 없는 기간입니다.");
      return buildDigest([...mails.values()].map(view), m[1] as Period, anchor());
    }
    if (method === "GET" && p === "/api/rules") return { items: current().rules, version: current().version };
    if (method === "POST" && p === "/api/reclassify") { reclassifyAll(); return { count: mails.size }; }
    if (method === "GET" && p === "/api/dashboard") {
      const days = new Map<string, number>();
      const n = anchor();
      for (let i = 13; i >= 0; i--) days.set(isoMinutes(addDays(n, -i)).slice(0, 10), 0);
      for (const ml of mails.values()) { const d = ml.receivedAt.slice(0, 10); if (days.has(d)) days.set(d, days.get(d)! + 1); }
      return { daily: [...days].map(([date, total]) => ({ date, total })), notifications: [], audit: events.slice(0, 10).map((e) => ({ action: e.action, created_at: e.at })), stats: stats(), accounts: [] };
    }
    if (method === "GET" && p === "/api/accounts") return { items: [] };
    throw new LocalError(404, `브라우저판에 없는 기능입니다: ${method} ${p}`);
  }

  function init() {
    return (ready ??= persist.load().then(({ mails: stored, kv }) => {
      for (const s of stored) mails.set(s.id, s);
      if (Array.isArray(kv.ruleHistory) && kv.ruleHistory.length) history = kv.ruleHistory as RuleVersion[];
      if (kv.decision) decision = kv.decision as typeof decision;
      if (Array.isArray(kv.events)) events = kv.events as LogEvent[];
      reclassifyAll();
    }));
  }

  return {
    init, route, addMails, preview, applyRules, evalTrend, shadowStats, setEngine,
    history: () => history,
    ids: () => sorted().map((m) => m.id),
    rules: () => current().rules,
    events: () => events,
    mail: (id: string) => mails.get(id),
    /** The rule engine's own call, before user corrections and before any LLM switch. */
    rawView: (id: string) => { const m = mails.get(id); return m ? rawOf(m) : null; },
    ruleView: (id: string) => { const m = mails.get(id); return m ? applyOverride(rawOf(m), m.override) : null; },
    async rollback(version: number) {
      const v = history.find((h) => h.version === version);
      if (!v) throw new LocalError(404, "그 규칙 버전이 없습니다.");
      return applyRules(v.rules, `v${version}로 되돌림`);
    },
    async saveShadow(id: string, shadow: Shadow) {
      const m = get(id);
      m.shadow = shadow;
      await save([m]);
    },
    async clearShadow() {
      const touched = [...mails.values()].filter((m) => m.shadow);
      for (const m of touched) m.shadow = undefined;
      await save(touched);
    },
    exportAll() {
      return JSON.stringify({ app: "mdcv", schema: 1, exportedAt: now(), mails: [...mails.values()], ruleHistory: history, decision, events }, null, 1);
    },
    async importAll(json: string) {
      let data: { app?: string; schema?: number; mails?: StoredMail[]; ruleHistory?: RuleVersion[]; decision?: typeof decision; events?: LogEvent[] };
      try { data = JSON.parse(json); } catch { throw new LocalError(400, "백업 파일이 JSON이 아닙니다."); }
      if (data.app !== "mdcv" || data.schema !== 1 || !Array.isArray(data.mails)) throw new LocalError(400, "MDCV 백업 파일(schema 1)이 아닙니다.");
      await persist.clear();
      mails.clear();
      for (const s of data.mails) mails.set(s.id, s);
      history = data.ruleHistory?.length ? data.ruleHistory : history;
      decision = data.decision ?? decision;
      events = data.events ?? [];
      await persist.putMails(data.mails);
      await Promise.all([persist.putKv("ruleHistory", history), persist.putKv("decision", decision), persist.putKv("events", events)]);
      reclassifyAll();
      return { mails: mails.size };
    },
    async clearAll() {
      await persist.clear();
      mails.clear();
      history = [{ version: 1, at: now(), note: "기본 규칙", rules: [] }];
      decision = { engine: "rule", history: [] };
      events = [];
      reclassifyAll();
    },
    async deleteMails(ids: string[]) {
      for (const id of ids) mails.delete(id);
      await persist.deleteMails(ids);
    },
  };
}

export type Backend = ReturnType<typeof createBackend>;
