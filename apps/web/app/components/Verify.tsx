"use client";
// Field verification, in the order used on equipment: replay -> compare -> shadow -> switch / rollback.
import { useMemo, useRef, useState } from "react";
import { I, Icon } from "./Icon";
import { type Level, levelName, local, post } from "../lib/api";
import { t, tr } from "../lib/i18n";
import { MODELS, llmKey, llmModel, remembered, setLlm } from "../lib/llm-settings";
import type { RuleType, UserRule } from "../lib/local";
import { buildUserMessage } from "../../../../packages/engine/llm.ts";

type Tab = "replay" | "compare" | "shadow" | "switch";
type Props = { onChanged: () => void; onOpen: (id: string) => void; notify: (ok: boolean, text: string) => void };
const RULE_TYPES: Record<RuleType, string> = { vip_sender: "VIP 발신자", equipment: "설비 추가", keyword: "키워드 가중치" };
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function Verify({ onChanged, onOpen, notify }: Props) {
  const be = local();
  const [tab, setTab] = useState<Tab>("replay");
  const [tick, setTick] = useState(0);
  const refresh = () => { setTick((n) => n + 1); onChanged(); };
  const steps: [Tab, string, string][] = [
    ["replay", "1 재현", "예시 세트와 내가 고친 메일로 지금 규칙을 다시 돌려 봅니다"],
    ["compare", "2 비교", "규칙을 바꾸기 전에 같은 메일에서 무엇이 바뀌는지 봅니다"],
    ["shadow", "3 Shadow", "LLM은 옆 칸에만 답하고, 결정은 규칙이 합니다"],
    ["switch", "4 전환 · 롤백", "기준을 넘으면 전환하고, 언제든 되돌립니다"],
  ];
  return (
    <main className="page"><div className="pin">
      <h1>{t("현장 검증")}</h1>
      <p className="sub">{t("바꾸기 전에 같은 데이터로 확인하고, 새 방법은 먼저 옆에서 돌려 보고, 언제든 되돌립니다.")}</p>
      <div className="steps" role="tablist" aria-label={t("현장 검증 단계")}>
        {steps.map(([k, label, hint]) => (
          <button key={k} role="tab" aria-selected={tab === k} className="step" onClick={() => setTab(k)}>
            <b>{t(label)}</b><span>{t(hint)}</span></button>
        ))}
      </div>
      <div role="tabpanel" key={tab + tick}>
        {tab === "replay" && <Replay be={be} onOpen={onOpen} refresh={refresh} notify={notify} />}
        {tab === "compare" && <Compare be={be} refresh={refresh} notify={notify} onOpen={onOpen} />}
        {tab === "shadow" && <ShadowPanel be={be} refresh={refresh} notify={notify} onOpen={onOpen} />}
        {tab === "switch" && <Switch be={be} refresh={refresh} notify={notify} />}
      </div>
    </div></main>
  );
}

type Sub = { be: ReturnType<typeof local>; refresh: () => void; notify: Props["notify"]; onOpen?: (id: string) => void };

function Replay({ be, refresh, notify, onOpen }: Sub) {
  const trend = useMemo(() => be.evalTrend(), [be]);
  const last = trend[trend.length - 1];
  const max = Math.max(1, ...trend.map((v) => v.hotMissed + v.replyMissed + v.falseAlarm));
  const seed = async () => {
    try { const r = await post("/api/demo/seed"); notify(true, t("예시 메일 {n}통을 열었습니다.", { n: r.inserted })); refresh(); }
    catch (e) { notify(false, (e as Error).message); }
  };
  return (
    <div className="cols">
      <section className="block" style={{ marginTop: 0 }}>
        <div className="head"><h2>{t("재현 세트")}</h2></div>
        <p className="note" style={{ marginTop: 0 }}>{t("문제 상황을 담은 합성 메일 30통(반도체 검사 장비 현장)을 버튼 하나로 엽니다. 내 메일에서 중요도나 회신 필요를 고치면 그 메일이 내 재현 세트가 됩니다.")}</p>
        <button className="btn primary" onClick={seed}><Icon d={I.redo} />{t("예시 세트 열기 (합성 30통)")}</button>
        <h2 className="bodyhead">{t("내가 고친 메일 {n}통", { n: last?.labelled ?? 0 })}</h2>
        {last?.labelled ? (
          <p className="note">{t("지금 규칙(v{v})으로 다시 돌리면: 중요 놓침 {h} · 회신 놓침 {r} · 오경보 {f} · 일치 {a}/{n}",
            { v: last.version, h: last.hotMissed, r: last.replyMissed, f: last.falseAlarm, a: last.agree, n: last.labelled })}</p>
        ) : <p className="note">{t("아직 없습니다. 메일 읽기 창에서 중요도나 '회신 필요'를 고쳐 보세요.")}</p>}
        <CorrectedList be={be} onOpen={onOpen} />
      </section>
      <section className="block" style={{ marginTop: 0 }}>
        <div className="head"><h2>{t("규칙 버전별 놓침 추이")}</h2></div>
        <p className="note" style={{ marginTop: 0 }}>{t("내가 고친 메일을 평가 세트로 써서, 규칙 버전마다 같은 메일을 다시 분류합니다. 막대가 낮을수록 좋습니다.")}</p>
        {trend.length && last?.labelled ? (
          <>
            <div className="trend" role="img" aria-label={t("규칙 버전별 놓침 추이")}>
              {trend.map((v) => (
                <div key={v.version} className="tcol" title={`v${v.version}: ${v.note}`}>
                  <div className="tbar" style={{ height: `${((v.hotMissed + v.replyMissed) / max) * 100}%` }} />
                  <div className="tbar fa" style={{ height: `${(v.falseAlarm / max) * 100}%` }} />
                  <span>v{v.version}</span>
                </div>
              ))}
            </div>
            <table className="grid"><thead><tr><th>{t("버전")}</th><th>{t("메모")}</th><th>{t("중요 놓침")}</th><th>{t("회신 놓침")}</th><th>{t("오경보")}</th></tr></thead>
              <tbody>{trend.map((v) => <tr key={v.version}><td>v{v.version}</td><td>{t(v.note)}</td><td>{v.hotMissed}</td><td>{v.replyMissed}</td><td>{v.falseAlarm}</td></tr>)}</tbody></table>
            <p className="note">{t("같은 엔진 코드에서 사용자 규칙만 버전별로 바꿔 다시 돌린 결과입니다.")}</p>
          </>
        ) : <p className="note">{t("고친 메일이 생기면 표시됩니다.")}</p>}
      </section>
    </div>
  );
}

function CorrectedList({ be, onOpen }: { be: ReturnType<typeof local>; onOpen?: (id: string) => void }) {
  const rows = be.ids().flatMap((id) => {
    const m = be.mail(id);
    const ov = m?.override;
    if (!m || !ov || (!ov.level && typeof ov.needsReply !== "boolean")) return [];
    const rule = be.rawView(id);
    const reply = (v: boolean) => (v ? t("회신 필요") : t("회신 불필요"));
    const label = [ov.level ? levelName(ov.level) : "", typeof ov.needsReply === "boolean" ? reply(ov.needsReply) : ""].filter(Boolean).join(" · ");
    const auto = rule ? [ov.level ? levelName(rule.importance.level) : "", typeof ov.needsReply === "boolean" ? reply(rule.needsReply) : ""].filter(Boolean).join(" · ") : "";
    return [{ id, subject: m.subject, label, now: auto }];
  });
  if (!rows.length) return null;
  return (
    <table className="grid"><thead><tr><th>{t("메일")}</th><th>{t("내 판단")}</th><th>{t("규칙 판단")}</th></tr></thead>
      <tbody>{rows.slice(0, 20).map((r) => <tr key={r.id} className="click" onClick={() => onOpen?.(r.id)}><td>{r.subject}</td><td className="nw">{r.label}</td><td className="nw">{r.now}</td></tr>)}</tbody></table>
  );
}

function Compare({ be, refresh, notify, onOpen }: Sub) {
  const [draft, setDraft] = useState<UserRule[]>(() => be.rules().map((r) => ({ ...r })));
  const [form, setForm] = useState<{ rule_type: RuleType; pattern: string; weight: number }>({ rule_type: "keyword", pattern: "", weight: 20 });
  const [pv, setPv] = useState<ReturnType<typeof be.preview> | null>(null);
  const [note, setNote] = useState("");
  const [rollTo, setRollTo] = useState<number | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(be.rules());
  const add = () => {
    const p = form.pattern.trim();
    if (!p) return notify(false, t("대상을 입력하세요."));
    if (form.rule_type === "keyword" && (form.weight < -50 || form.weight > 50)) return notify(false, t("가중치는 -50 ~ 50 사이여야 합니다."));
    setDraft([...draft, { id: Date.now(), rule_type: form.rule_type, pattern: p, weight: form.rule_type === "keyword" ? form.weight : 0 }]);
    setForm({ ...form, pattern: "" }); setPv(null); setRollTo(null);
  };
  const previewDraft = () => { setRollTo(null); setPv(be.preview(draft)); };
  const previewVersion = (v: number) => { const ver = be.history().find((h) => h.version === v)!; setDraft(ver.rules.map((r) => ({ ...r }))); setRollTo(v); setPv(be.preview(ver.rules)); };
  const apply = async () => {
    try {
      const v = rollTo ? await be.rollback(rollTo) : await be.applyRules(draft, note.trim() || t("규칙 변경"));
      notify(true, t("규칙 v{v}를 적용했습니다. 메일 {n}통의 판단이 바뀌었습니다.", { v: v.version, n: pv?.changed ?? 0 }));
      setPv(null); setNote(""); setRollTo(null); refresh();
    } catch (e) { notify(false, (e as Error).message); }
  };
  return (
    <div className="cols">
      <section className="block" style={{ marginTop: 0 }}>
        <div className="head"><h2>{t("규칙 편집 (적용 전)")}</h2><span className="note" style={{ margin: 0 }}>{t("현재 v{v}", { v: be.history().at(-1)!.version })}</span></div>
        <div className="formrow">
          <label className="field"><span>{t("규칙 종류")}</span>
            <select value={form.rule_type} onChange={(e) => setForm({ ...form, rule_type: e.target.value as RuleType })}>
              {Object.entries(RULE_TYPES).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></label>
          <label className="field"><span>{t("대상")}</span>
            <input value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} placeholder="boss@example.com · CMP-2 · 레시피"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} /></label>
          {form.rule_type === "keyword" && <label className="field"><span>{t("가중치 (-50 ~ 50)")}</span>
            <input type="number" min={-50} max={50} value={form.weight} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} /></label>}
        </div>
        <button className="btn" onClick={add}>{t("목록에 추가")}</button>
        {draft.length ? <table className="grid" style={{ marginTop: ".75rem" }}><thead><tr><th>{t("종류")}</th><th>{t("대상")}</th><th>{t("가중치")}</th><th /></tr></thead><tbody>
          {draft.map((r) => <tr key={r.id}><td className="nw">{t(RULE_TYPES[r.rule_type])}</td><td>{r.pattern}</td><td className="nw">{r.rule_type === "keyword" ? (r.weight > 0 ? `+${r.weight}` : r.weight) : "—"}</td>
            <td className="nw"><button className="btn sp" onClick={() => { setDraft(draft.filter((x) => x.id !== r.id)); setPv(null); setRollTo(null); }} aria-label={t("규칙 {p} 빼기", { p: r.pattern })}><Icon d={I.x} size={12} /></button></td></tr>)}
        </tbody></table> : <p className="note">{t("사용자 규칙이 없습니다. 기본 설비 사전과 규칙만 씁니다.")}</p>}
        <div className="actions">
          <button className="btn primary" disabled={!dirty && !rollTo} onClick={previewDraft}>{t("바뀌는 메일 미리보기")}</button>
          {dirty && <button className="btn" onClick={() => { setDraft(be.rules().map((r) => ({ ...r }))); setPv(null); }}>{t("편집 취소")}</button>}
        </div>
        <h2 className="bodyhead">{t("규칙 변경 이력")}</h2>
        <table className="grid"><thead><tr><th>{t("버전")}</th><th>{t("시각")}</th><th>{t("메모")}</th><th>{t("규칙 수")}</th><th /></tr></thead><tbody>
          {[...be.history()].reverse().map((h, i) => <tr key={h.version}><td>v{h.version}</td><td className="when">{h.at.replace("T", " ")}</td><td className="memo">{t(h.note)}</td><td>{h.rules.length}</td>
            <td className="nw">{i > 0 && <button className="btn sp" onClick={() => previewVersion(h.version)}>{t("이 버전으로 되돌리기")}</button>}</td></tr>)}
        </tbody></table>
      </section>
      <section className="block" style={{ marginTop: 0 }} aria-live="polite">
        <div className="head"><h2>{rollTo ? t("v{v}로 되돌리면 바뀌는 메일", { v: rollTo }) : t("적용하면 바뀌는 메일")}</h2></div>
        {!pv && <p className="note" style={{ marginTop: 0 }}>{t("왼쪽에서 규칙을 바꾸고 '미리보기'를 누르면, 같은 메일에서 중요도 · 회신 필요 · 설비가 바뀌는 메일만 여기에 나옵니다. 적용 전에는 아무것도 바뀌지 않습니다.")}</p>}
        {pv && (<>
          <p className="big" style={{ margin: "0 0 .5rem" }}>{t("{c}통 판단이 바뀜 · {s}통 점수만 바뀜 (전체 {n}통)", { c: pv.changed, s: pv.scoreOnly, n: pv.total })}</p>
          {pv.items.length > 0 && <table className="grid diff"><thead><tr><th>{t("메일")}</th><th>{t("중요도")}</th><th>{t("회신")}</th><th>{t("설비")}</th></tr></thead><tbody>
            {pv.items.slice(0, 60).map((d) => (
              <tr key={d.id} className="click" onClick={() => onOpen?.(d.id)}>
                <td>{d.subject}</td>
                <td className={`nw${d.changed.includes("level") ? " chg" : ""}`}>{levelName(d.before.level)} {d.before.score} → {levelName(d.after.level)} {d.after.score}</td>
                <td className={`nw${d.changed.includes("needsReply") ? " chg" : ""}`}>{d.before.needsReply ? "✓" : "—"} → {d.after.needsReply ? "✓" : "—"}</td>
                <td className={d.changed.includes("equipment") ? "chg" : ""}>{d.changed.includes("equipment") ? `${d.before.equipment.join(", ") || "—"} → ${d.after.equipment.join(", ") || "—"}` : "="}</td>
              </tr>))}
          </tbody></table>}
          <label className="field"><span>{t("변경 메모 (이력에 남음)")}</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("예: 고객사 메일 가중치 +20")} /></label>
          <div className="actions" style={{ marginBottom: 0 }}>
            <button className="btn primary" onClick={apply}>{rollTo ? t("v{v}로 되돌리기 적용", { v: rollTo }) : t("적용")}</button>
            <button className="btn" onClick={() => { setPv(null); setRollTo(null); }}>{t("취소")}</button>
          </div>
        </>)}
      </section>
    </div>
  );
}

function ShadowPanel({ be, refresh, notify, onOpen }: Sub) {
  const [key, setKey] = useState(llmKey());
  const [model, setModel] = useState(llmModel());
  const [remember, setRemember] = useState(remembered());
  const [limit, setLimit] = useState(10);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const stopRef = useRef(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const stats = useMemo(() => be.shadowStats(), [be, running]);
  const queue = useMemo(() => be.ids().filter((id) => !be.mail(id)?.shadow), [be, running]);
  const masked = (id: string) => {
    const m = be.mail(id)!;
    return buildUserMessage(m, be.ruleView(id)?.entities.people ?? []);
  };
  const run = async () => {
    setLlm(key, model, remember);
    if (!key.trim()) return notify(false, t("Anthropic API 키를 입력하세요. 키가 없어도 규칙만으로 모든 기능이 동작합니다."));
    if (!agreed) { setPreviewId(queue[0] ?? null); return; }
    const ids = queue.slice(0, limit);
    setRunning({ done: 0, total: ids.length }); stopRef.current = false;
    let n = 0;
    const { askLlm, llmErrorMessage } = await import("../lib/llm-client");
    for (const id of ids) {
      if (stopRef.current) break;
      try { await be.saveShadow(id, await askLlm(be.mail(id)!, be.ruleView(id)?.entities.people ?? [])); }
      catch (e) { notify(false, t(llmErrorMessage(e))); break; }
      setRunning({ done: ++n, total: ids.length });
    }
    setRunning(null); refresh();
  };
  return (
    <div className="cols">
      <section className="block" style={{ marginTop: 0 }}>
        <div className="head"><h2>{t("LLM 설정 (내 키)")}</h2></div>
        <p className="note" style={{ marginTop: 0 }}>{t("키는 기본적으로 이 탭의 메모리에만 있고 새로고침하면 사라집니다. 메일은 이름 · 연락처 · 사번 · IP를 가린 뒤 Anthropic API로만 보냅니다.")}</p>
        <label className="field"><span>Anthropic API key</span><input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" /></label>
        <label className="field"><span>{t("모델")}</span><select value={model} onChange={(e) => setModel(e.target.value)}>
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.price}</option>)}</select></label>
        <label className="inline"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t("이 기기에 키 기억 (공용 PC에서는 끄세요)")}</label>
        <label className="field"><span>{t("한 번에 보낼 메일 수 (대기 {n}통)", { n: queue.length })}</span>
          <input type="number" min={1} max={200} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(200, Number(e.target.value))))} /></label>
        <div className="actions">
          <button className="btn primary" disabled={!!running || !queue.length} onClick={run}>{agreed ? t("Shadow 실행") : t("보낼 내용 미리보기")}</button>
          {running && <button className="btn" onClick={() => { stopRef.current = true; }}>{t("멈춤")}</button>}
          {stats.compared + stats.invalid > 0 && !running && <button className="btn" onClick={async () => { await be.clearShadow(); refresh(); }}>{t("Shadow 결과 지우기")}</button>}
        </div>
        {running && <p className="msg" role="status">{t("LLM 판단 중… {d}/{n}", { d: running.done, n: running.total })}</p>}
        {previewId && !agreed && (
          <div className="block warn">
            <div className="head"><h2>{t("이 내용이 전송됩니다 (마스킹 후)")}</h2></div>
            <pre className="bodytext masked">{masked(previewId)}</pre>
            <p className="note">{t("{n}통을 이렇게 가린 뒤 보냅니다. 제목과 본문 외에는 아무것도 보내지 않습니다.", { n: Math.min(limit, queue.length) })}</p>
            <div className="actions" style={{ marginBottom: 0 }}>
              <button className="btn primary" onClick={() => { setAgreed(true); setPreviewId(null); }}>{t("확인, 이렇게 보내기")}</button>
              <button className="btn" onClick={() => setPreviewId(null)}>{t("취소")}</button>
            </div>
          </div>
        )}
      </section>
      <section className="block" style={{ marginTop: 0 }}>
        <div className="head"><h2>{t("규칙 vs LLM")}</h2><span className="note" style={{ margin: 0 }}>{t("결정은 {e}", { e: stats.engine === "llm" ? t("LLM(전환됨)") : t("규칙") })}</span></div>
        <dl className="kv">
          <dt>{t("비교한 메일")}</dt><dd>{stats.compared}</dd>
          <dt>{t("중요도 일치")}</dt><dd>{stats.compared ? pct(stats.levelAgree / stats.compared) : "—"}</dd>
          <dt>{t("회신 판단 일치")}</dt><dd>{stats.compared ? pct(stats.replyAgree / stats.compared) : "—"}</dd>
          <dt>{t("LLM이 놓친 회신")}</dt><dd>{stats.replyMisses}</dd>
          <dt>{t("검증 실패(사용 안 함)")}</dt><dd>{stats.invalid}</dd>
        </dl>
        <h2 className="bodyhead">{t("서로 다른 판단 {n}건", { n: stats.disagreements.length })}</h2>
        {stats.disagreements.length ? <table className="grid"><thead><tr><th>{t("메일")}</th><th>{t("규칙")}</th><th>LLM</th></tr></thead><tbody>
          {stats.disagreements.slice(0, 40).map((d) => (
            <tr key={d.id} className="click" onClick={() => onOpen?.(d.id)}>
              <td>{d.subject}</td>
              <td className="nw">{levelName(d.rule.level as Level)}{d.rule.needsReply ? ` · ${t("회신")}` : ""}</td>
              <td title={d.llm.reasons.join(" / ")}>{levelName(d.llm.level as Level)}{d.llm.needsReply ? ` · ${t("회신")}` : ""}<div className="note" style={{ margin: 0 }}>{d.llm.reasons[0]}</div></td>
            </tr>))}
        </tbody></table> : <p className="note">{t("아직 없습니다.")}</p>}
        {stats.failures.length > 0 && <>
          <h2 className="bodyhead">{t("검증 실패 {n}건 — 규칙 결과를 그대로 씀", { n: stats.failures.length })}</h2>
          <ul className="plain">{stats.failures.slice(0, 10).map((f) => <li key={f.id}><b>{f.subject}</b>: {f.errors.map(tr).join(" · ")}</li>)}</ul>
        </>}
      </section>
    </div>
  );
}

function Switch({ be, refresh, notify }: Sub) {
  const st = be.shadowStats();
  const label: Record<string, string> = { compared: "비교한 메일 수", invalid: "검증 실패 비율", levelAgree: "중요도 일치율", replyMisses: "LLM이 놓친 회신" };
  const fmt = (k: string, v: number) => (k === "invalid" || k === "levelAgree" ? pct(v) : String(v));
  const go = async (engine: "rule" | "llm") => {
    try { await be.setEngine(engine, engine === "llm" ? t("Shadow 기준 통과") : t("규칙으로 되돌림")); notify(true, engine === "llm" ? t("LLM 판단으로 전환했습니다.") : t("규칙 판단으로 되돌렸습니다.")); refresh(); }
    catch (e) { notify(false, t((e as Error).message)); }
  };
  return (
    <div className="cols">
      <section className="block" style={{ marginTop: 0 }}>
        <div className="head"><h2>{t("전환 기준")}</h2><span className="note" style={{ margin: 0 }}>{t("지금 결정: {e}", { e: st.engine === "llm" ? "LLM" : t("규칙") })}</span></div>
        <table className="grid"><thead><tr><th>{t("기준")}</th><th>{t("필요")}</th><th>{t("지금")}</th><th /></tr></thead><tbody>
          {st.checks.map((c) => <tr key={c.key}><td>{t(label[c.key])}</td><td className="nw">{c.need}</td><td className="nw">{fmt(c.key, c.value)}</td><td className={`nw ${c.ok ? "okc" : "noc"}`}>{c.ok ? "✓" : "✗"}</td></tr>)}
        </tbody></table>
        <p className="note">{t("전환해도 사용자가 고친 판단이 먼저이고, LLM 답이 검증에 실패한 메일과 아직 LLM이 보지 않은 메일은 규칙이 결정합니다.")}</p>
        <div className="actions" style={{ marginBottom: 0 }}>
          {st.engine === "rule"
            ? <button className="btn primary" disabled={!st.canSwitch} onClick={() => go("llm")}>{t("LLM 판단으로 전환")}</button>
            : <button className="btn primary" onClick={() => go("rule")}><Icon d={I.redo} />{t("규칙으로 되돌리기")}</button>}
        </div>
        {!st.canSwitch && st.engine === "rule" && <p className="note">{t("Shadow 단계에서 LLM을 더 돌려 기준을 채우면 버튼이 켜집니다.")}</p>}
      </section>
      <section className="block" style={{ marginTop: 0 }}>
        <div className="head"><h2>{t("전환 이력")}</h2></div>
        {st.history.length ? <table className="grid"><tbody>{st.history.map((h, i) => <tr key={i}><td className="nw">{h.at.replace("T", " ")}</td><td>{h.engine === "llm" ? "→ LLM" : t("→ 규칙")}</td><td>{t(h.note)}</td></tr>)}</tbody></table>
          : <p className="note" style={{ marginTop: 0 }}>{t("아직 전환한 적이 없습니다.")}</p>}
      </section>
    </div>
  );
}
