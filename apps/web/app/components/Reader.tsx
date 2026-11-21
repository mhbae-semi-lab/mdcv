import { useEffect, useState } from "react";
import { I, Icon } from "./Icon";
import { Cls, LEVELS, LOCAL, Level, Mail, deadline, engineName, levelName, post, sourceName, when } from "../lib/api";
import { getLang, t, tr } from "../lib/i18n";

type Props = {
  mail: Mail | null;
  onEquip: (e: string) => void;
  onDone: (m: Mail, status: "open" | "done") => Promise<void>;
  onClassified: (c: Cls) => void;
  canSend?: boolean;
};

const KIND: Record<string, string> = { deadline: "기한", meeting: "일정", mentioned: "언급" };

export function Reader({ mail, onEquip, onDone, onClassified, canSend }: Props) {
  const [busy, setBusy] = useState("");
  const [sentMsg, setSentMsg] = useState("");
  const [err, setErr] = useState("");
  const [fix, setFix] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [tag, setTag] = useState("");
  useEffect(() => { setFix(null); setDraft(null); setErr(""); setCopied(false); setTag(""); setSentMsg(""); }, [mail?.id]);

  if (!mail) return <section className="read"><div className="empty"><h2>{t("메일을 선택하세요")}</h2><p>{t("왼쪽 목록에서 메일을 고르면 요약과 분류 근거가 여기에 표시됩니다. ↑↓ 키로 이동하고, E 키로 처리 완료할 수 있습니다.")}</p></div></section>;
  const c = mail.classification;
  const lv: Level = c?.importance.level || "normal";
  const due = deadline(c);
  const done = mail.status === "done";
  const sh = mail.shadow;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr("");
    try { await fn(); } catch (e) { setErr((e as Error).message || t("요청에 실패했습니다.")); } finally { setBusy(""); }
  };
  const adjust = (body: object) => run("adjust", async () => onClassified(await post(`/api/messages/${encodeURIComponent(mail.id)}/adjust`, body)));
  const addTag = () => { const v = tag.trim(); if (v) { setTag(""); adjust({ equipmentAdd: [v] }); } };

  return (
    <section className="read" aria-label={t("메일 내용")}>
      <div className="rin">
        <div className="rmeta"><b>{mail.senderName}</b><span>{mail.senderEmail}</span><span>{when(mail.receivedAt, true)}</span>
          {mail.hasAttachment && <span>{t("첨부 있음")}</span>}<span>{sourceName(mail.provider)}{mail.source && mail.provider === "file" ? ` · ${mail.source}` : ""}</span>{done && <b>{t("처리 완료")}</b>}</div>
        <h1>{mail.subject}</h1>
        <div className="actions">
          <button className="btn primary" aria-busy={busy === "draft"} disabled={!!busy} onClick={() => run("draft", async () => setDraft(await post(`/api/messages/${encodeURIComponent(mail.id)}/reply-draft`, { lang: getLang() })))}>
            <Icon d={I.reply} />{busy === "draft" ? t("작성 중…") : t("답장 초안 · 첨삭")}</button>
          <button className="btn" aria-busy={busy === "done"} disabled={!!busy} onClick={() => run("done", () => onDone(mail, done ? "open" : "done"))}>
            <Icon d={I.check} />{done ? t("다시 열기") : t("처리 완료")}<kbd>E</kbd></button>
          <button className="btn" aria-busy={busy === "fix"} disabled={!!busy} onClick={() => run("fix", async () => setFix(await post(`/api/messages/${encodeURIComponent(mail.id)}/correct`)))}>
            {busy === "fix" ? t("검증 중…") : t("내용 검증 · 교정")}</button>
          <button className="btn" aria-busy={busy === "cls"} disabled={!!busy} onClick={() => run("cls", async () => onClassified(await post(`/api/messages/${encodeURIComponent(mail.id)}/classify`)))}>
            <Icon d={I.redo} />{busy === "cls" ? t("분류 중…") : t("다시 분류")}</button>
        </div>
        {err && <p className="msg err" role="alert">{err}</p>}

        {c && (
          <div className="facts">
            <section><h2>{t("중요도")} · {engineName(c.engine)} · {t("신뢰도")} {Math.round(c.confidence * 100)}%</h2>
              <p className={`big ${lv}`}>{levelName(lv)} {c.importance.score}{t("점")}{c.importance.overridden && ` · ${t("직접 지정")}`}</p>
              <ul>{c.importance.reasons.map((r) => <li key={r}>{tr(r)}</li>)}</ul>
              <label className="inline">{t("분류가 틀렸다면")}
                <select value={c.importance.overridden ? lv : ""} disabled={!!busy} onChange={(e) => adjust({ level: e.target.value })} aria-label={t("중요도 직접 지정")}>
                  <option value="">{t("자동 판정")}</option>
                  {LEVELS.map((l) => <option key={l} value={l}>{levelName(l)}</option>)}
                </select></label></section>
            <section><h2>{t("요약")}</h2><p>{c.summary || t("요약 없음")}</p></section>
            <section><h2>{t("회신 · 할 일")}</h2>
              <p className="big">{c.needsReply ? `${t("회신 필요")}${due ? ` · ${t("기한")} ${due}` : ""}` : t("회신 필요 없음")}</p>
              {c.actionItems.length > 0 && <ul>{c.actionItems.map((a, i) => <li key={i}>{a.text}{a.due ? ` (${a.due})` : ""}</li>)}</ul>}
              <button className="linkbtn" disabled={!!busy} onClick={() => adjust({ needsReply: !c.needsReply })}>
                {c.needsReply ? t("회신 필요 아님으로 고치기") : t("회신 필요로 고치기")}</button></section>
            <section><h2>{t("추출 정보")}</h2>
              <dl className="kv">
                <dt>{t("설비")}</dt><dd className="tags">
                  {c.entities.equipment.map((e) => (
                    <span key={e} className="plate-group">
                      <button className="plate" onClick={() => onEquip(e)} title={t("{e} 메일만 보기", { e })}>{e}</button>
                      <button className="plate-x" disabled={!!busy} onClick={() => adjust({ equipmentRemove: [e] })} aria-label={t("설비 태그 {e} 제거", { e })} title={t("잘못 잡힌 태그 제거")}><Icon d={I.x} size={10} /></button>
                    </span>))}
                  <input className="addtag" value={tag} maxLength={40} placeholder={t("+ 설비 추가")} aria-label={t("설비 태그 추가")} disabled={!!busy}
                    onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} />
                </dd>
                {!!c.entities.alarms?.length && <><dt>{t("알람")}</dt><dd>{c.entities.alarms.join(", ")}</dd></>}
                <dt>{t("날짜")}</dt><dd>{c.entities.dates.map((d) => `${d.raw}(${t(KIND[d.kind] ?? d.kind)})`).join(", ") || t("없음")}</dd>
                <dt>{t("키워드")}</dt><dd>{c.entities.keywords.join(", ") || t("없음")}</dd>
              </dl></section>
          </div>
        )}

        {sh && (
          <div className={`block ${sh.valid ? "" : "warn"}`}>
            <div className="head"><h2>{t("LLM 의견 (Shadow)")} · {sh.model}</h2>
              <span className="note" style={{ margin: 0 }}>{sh.valid ? (c?.engine === "hybrid" ? t("결정에 사용 중") : t("참고만, 결정은 규칙")) : t("검증 실패, 사용 안 함")}</span></div>
            {sh.answer && <p style={{ margin: 0 }}><b>{levelName(sh.answer.level)} {sh.answer.score}</b> · {sh.answer.needsReply ? t("회신 필요") : t("회신 필요 없음")} — {sh.answer.reasons.join(" / ")}</p>}
            {!sh.valid && <p className="note">{sh.errors.map(tr).join(" · ")}</p>}
          </div>
        )}

        {fix && (
          <div className="block warn">
            <div className="head"><h2>{t("검증 · 교정 결과")}</h2><span className="note" style={{ margin: 0 }}>{fix.issues?.length ? t("수정 제안 {n}건", { n: fix.issues.length }) : t("발견된 문제 없음")}</span>
              <button className="btn sp" onClick={() => setFix(null)} aria-label={t("교정 결과 닫기")}><Icon d={I.x} size={12} /></button></div>
            {fix.issues?.map((i: any, idx: number) => (
              <p key={idx} className="issue"><del>{i.original}</del> → <ins>{i.suggestion || tr(i.message)}</ins> <span className="note">{tr(i.message)}</span></p>))}
            <h2 className="bodyhead">{t("교정된 본문")}</h2><p className="bodytext">{fix.corrected}</p>
          </div>
        )}

        {draft && (
          <div className="block ok">
            <div className="head"><h2>{t("답장 초안")}</h2><span className="note" style={{ margin: 0 }}>{t("자동 발송되지 않습니다")}</span>
              <button className="btn sp" onClick={async () => { try { await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.draft}`); setCopied(true); } catch { setErr(t("복사 권한이 없습니다. 직접 선택해 복사하세요.")); } }}>
                <Icon d={copied ? I.check : I.copy} />{copied ? t("복사됨") : t("복사")}</button>
              <button className="btn" onClick={() => setDraft(null)} aria-label={t("답장 초안 닫기")}><Icon d={I.x} size={12} /></button></div>
            <p style={{ margin: "0 0 .4rem", fontWeight: 700 }}>{draft.subject}</p>
            <textarea className="draft" value={draft.draft} onChange={(e) => { setDraft({ ...draft, draft: e.target.value }); setCopied(false); }} aria-label={t("답장 초안 내용")} />
            {draft.issues?.length > 0 && <p className="note">{t("첨삭")}: {draft.issues.map((i: any) => `${i.original} → ${i.suggestion}`).join(", ")}</p>}
            <p className="note">{draft.note}</p>
            {!LOCAL && canSend && mail.provider !== "demo" && <div className="actions" style={{ marginBottom: 0 }}>
              <button className="btn primary" disabled={!!busy} aria-busy={busy === "send"} onClick={() => {
                if (!confirm(t("이 답장을 실제로 발송할까요? 발송 후에는 취소할 수 없습니다."))) return;
                run("send", async () => {
                  await post(`/api/messages/${encodeURIComponent(mail.id)}/send-reply`, { subject: draft.subject, body: draft.draft, confirm: true });
                  setSentMsg(t("발송했습니다. 보낸편지함에 저장됩니다.")); setDraft(null);
                });
              }}><Icon d={I.reply} />{busy === "send" ? t("발송 중…") : t("이 내용으로 실제 발송")}</button>
              <span className="note">{t("발송 기능을 켠 셀프호스트 서버에서만 보입니다. 발송 이력은 감사 로그에 남습니다.")}</span>
            </div>}
            {sentMsg && <p className="msg ok" role="status">{sentMsg}</p>}
          </div>
        )}

        <div className="block"><h2>{t("원문")}</h2><p className="bodytext">{mail.bodyText}</p></div>
      </div>
    </section>
  );
}
