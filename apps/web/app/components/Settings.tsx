import { useEffect, useRef, useState } from "react";
import { I, Icon } from "./Icon";
import { Account, LOCAL, PROVIDER_NAME, api, local, post } from "../lib/api";
import { t } from "../lib/i18n";
import { clientId, defaultClientId, redirectUri, setClientId, validClientId } from "../lib/outlook-config";

type Msg = { ok: boolean; text: string } | null;
type Props = {
  accounts: Account[]; diag: any; syncing: number | null;
  onConnect: (p: "graph" | "gmail") => void; onSeed: () => Promise<void>;
  onSync: (id: number) => void; onDisconnect: (id: number) => void; onReclassified: () => void;
  onVerify: () => void; onPrivacy: () => void;
};

export function Settings(p: Props) {
  return LOCAL ? <LocalSettings {...p} /> : <ServerSettings {...p} />;
}

function LocalSettings({ onReclassified, onVerify, onPrivacy, onSeed }: Props) {
  const [msg, setMsg] = useState<Msg>(null);
  const [cid, setCid] = useState(clientId());
  const [busy, setBusy] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const be = local();
  const exportAll = () => {
    const blob = new Blob([be.exportAll()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mdcv-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg({ ok: true, text: t("백업 파일을 내려받았습니다. 메일 본문이 들어 있으니 안전한 곳에 보관하세요.") });
  };
  const importAll = async (f: File) => {
    if (!confirm(t("백업을 가져오면 지금 이 브라우저의 데이터가 백업 내용으로 바뀝니다. 계속할까요?"))) return;
    try { const r = await be.importAll(await f.text()); setMsg({ ok: true, text: t("메일 {n}통을 복원했습니다.", { n: r.mails }) }); onReclassified(); }
    catch (e) { setMsg({ ok: false, text: t((e as Error).message) }); }
  };
  const wipe = async () => {
    if (!confirm(t("이 브라우저의 메일 · 규칙 · 수정 기록 · Shadow 결과를 모두 지웁니다. 되돌릴 수 없습니다. 계속할까요?"))) return;
    await be.clearAll(); setMsg({ ok: true, text: t("모든 데이터를 지웠습니다.") }); onReclassified();
  };
  const connect = async () => {
    setClientId(cid);
    setBusy("outlook"); setMsg(null);
    try {
      const r = await (await import("../lib/outlook")).fetchInbox(200);
      const added = await be.addMails(r.mails);
      setMsg({ ok: true, text: t("{a}의 받은 편지함에서 {n}통을 읽었습니다 (새 메일 {k}통, 중복 {d}통).", { a: r.account, n: r.mails.length, k: added.added, d: added.duplicates }) });
      onReclassified();
    } catch (e) { setMsg({ ok: false, text: t((e as Error).message) }); }
    finally { setBusy(""); }
  };
  return (
    <main className="page"><div className="pin">
      <h1>{t("설정")}</h1><p className="sub">{t("브라우저판: 데이터는 이 브라우저에만 있습니다.")} <button className="linkbtn" onClick={onPrivacy}>{t("개인정보 처리 안내")}</button></p>
      {msg && <p className={`msg ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</p>}
      <div className="cols">
        <div>
          <section className="block" style={{ marginTop: 0 }}>
            <div className="head"><h2>{t("데이터")}</h2></div>
            <p className="note" style={{ marginTop: 0 }}>{t("메일 · 규칙 이력 · 수정 기록 · Shadow 결과를 JSON 파일 하나로 내보내고 다시 가져옵니다.")}</p>
            <div className="actions">
              <button className="btn primary" onClick={exportAll}>{t("백업 내보내기")}</button>
              <button className="btn" onClick={() => fileRef.current?.click()}>{t("백업 가져오기")}</button>
              <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importAll(f); }} />
              <button className="btn" onClick={onSeed}>{t("예시 세트 열기")}</button>
            </div>
            <button className="btn danger" onClick={wipe}>{t("모든 데이터 삭제")}</button>
          </section>
          <section className="block">
            <div className="head"><h2>{t("규칙")}</h2></div>
            <p className="note" style={{ marginTop: 0 }}>{t("규칙은 현장 검증 화면에서 바꿉니다. 바꾸기 전에 바뀌는 메일을 미리 보고, 적용한 뒤에도 이전 버전으로 되돌릴 수 있습니다.")}</p>
            <button className="btn" onClick={onVerify}>{t("현장 검증 열기")}</button>
          </section>
        </div>
        <section className="block" style={{ marginTop: 0 }}>
          <div className="head"><h2>{t("Outlook 연결 (읽기 전용)")}</h2></div>
          <p className="note" style={{ marginTop: 0 }}>{t("Microsoft 로그인 창에서 동의하면 받은 편지함의 최근 메일을 이 브라우저로 읽어 옵니다. 요청 권한은 Mail.Read 하나이고, 메일을 보내거나 지우지 않습니다.")}</p>
          <label className="field"><span>{t("Azure 앱 클라이언트 ID")}{defaultClientId ? ` (${t("기본값 있음")})` : ""}</span>
            <input value={cid} onChange={(e) => setCid(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" spellCheck={false} /></label>
          <p className="note">{t("리디렉션 URI (Azure 앱 등록의 '단일 페이지 애플리케이션'에 넣을 값)")}: <code>{redirectUri()}</code></p>
          <div className="actions" style={{ marginBottom: 0 }}>
            <button className="btn primary" disabled={!validClientId(cid) || !!busy} aria-busy={busy === "outlook"} onClick={connect}>
              <Icon d={I.link} />{busy === "outlook" ? t("읽는 중…") : t("로그인하고 최근 메일 200통 읽기")}</button>
            <button className="btn" disabled={!validClientId(cid)} onClick={() => import("../lib/outlook").then((o) => o.signOut()).catch((e) => setMsg({ ok: false, text: String(e) }))}>{t("로그아웃")}</button>
          </div>
          {!validClientId(cid) && <p className="note">{t("클라이언트 ID가 없으면 Outlook 연결을 쓸 수 없습니다. 파일 가져오기는 그대로 됩니다. 등록 방법은 저장소의 docs/oauth-setup-guide.md에 있습니다.")}</p>}
        </section>
      </div>
    </div></main>
  );
}

const RULE_TYPES: Record<string, string> = { vip_sender: "VIP 발신자", equipment: "설비 추가", keyword: "키워드 가중치" };

function ServerSettings({ accounts, diag, syncing, onConnect, onSeed, onSync, onDisconnect, onReclassified, onPrivacy }: Props) {
  const [rules, setRules] = useState<any[]>([]);
  const [rule, setRule] = useState({ ruleType: "vip_sender", pattern: "", weight: 20 });
  const [msg, setMsg] = useState<Msg>(null);
  const [notice, setNotice] = useState<Record<string, string>>({});
  const [reclassing, setReclassing] = useState(false);
  const [syncMin, setSyncMin] = useState(10);
  useEffect(() => { api("/api/rules").then((r) => setRules(r.items)).catch((e) => setMsg({ ok: false, text: e.message })); }, []);
  useEffect(() => { api("/api/settings").then((r) => setSyncMin(r.syncMinutes)).catch(() => {}); }, []);
  const save = async () => {
    if (!rule.pattern.trim()) return setMsg({ ok: false, text: t("대상을 입력하세요. 예: boss@example.com") });
    try {
      setRules((await post("/api/rules", rule)).items); setRule({ ...rule, pattern: "" });
      setMsg({ ok: true, text: t("저장했습니다. 기존 메일에도 적용하려면 '전체 메일 다시 분류'를 누르세요.") });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const remove = async (id: number) => {
    try { setRules((await api(`/api/rules/${id}`, { method: "DELETE" })).items); setMsg(null); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const saveSync = async () => {
    try { const r = await post("/api/settings", { syncMinutes: syncMin }); setSyncMin(r.syncMinutes); setMsg({ ok: true, text: syncMin === 0 ? t("자동 동기화를 껐습니다.") : t("자동 동기화 주기를 {n}분으로 저장했습니다.", { n: r.syncMinutes }) }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const reclassify = async () => {
    setReclassing(true);
    try { const r = await post("/api/reclassify"); setMsg({ ok: true, text: t("메일 {n}통을 다시 분류했습니다. 직접 지정한 중요도 · 설비는 그대로입니다.", { n: r.count }) }); onReclassified(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setReclassing(false); }
  };
  const test = async (channel: string) => {
    setNotice((n) => ({ ...n, [channel]: t("보내는 중…") }));
    try {
      const r = await post("/api/notify/test", { channel });
      setNotice((n) => ({ ...n, [channel]: r.status === "sent" ? t("보냈습니다") : r.status === "skipped" ? `${t("보내지 않음")}: ${r.detail}` : `${t("실패")}: ${r.detail}` }));
    } catch (e) { setNotice((n) => ({ ...n, [channel]: `${t("실패")}: ${(e as Error).message}` })); }
  };
  return (
    <main className="page"><div className="pin">
      <h1>{t("규칙 · 알림 · 연동")}</h1><p className="sub">{t("셀프호스트판 설정입니다.")} <button className="linkbtn" onClick={onPrivacy}>{t("개인정보 처리 안내")}</button></p>
      <div className="cols">
        <section className="block" style={{ marginTop: 0 }}>
          <div className="head"><h2>{t("사용자 규칙")}</h2></div>
          <label className="field"><span>{t("규칙 종류")}</span>
            <select value={rule.ruleType} onChange={(e) => setRule({ ...rule, ruleType: e.target.value })}>
              {Object.entries(RULE_TYPES).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></label>
          <label className="field"><span>{t("대상")}</span>
            <input value={rule.pattern} onChange={(e) => setRule({ ...rule, pattern: e.target.value })} placeholder="boss@example.com · CMP-2 · 레시피" /></label>
          <label className="field"><span>{t("가중치 (-50 ~ 50)")}</span>
            <input type="number" min={-50} max={50} value={rule.weight} onChange={(e) => setRule({ ...rule, weight: Number(e.target.value) })} /></label>
          <div className="actions" style={{ margin: 0 }}>
            <button className="btn primary" onClick={save}>{t("규칙 저장")}</button>
            <button className="btn" disabled={reclassing} aria-busy={reclassing} onClick={reclassify}>{reclassing ? t("분류 중…") : t("전체 메일 다시 분류")}</button>
          </div>
          {msg && <p className={`msg ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</p>}
          <h2 className="bodyhead">{t("저장된 규칙 {n}건", { n: rules.length })}</h2>
          {rules.length ? <table className="grid"><thead><tr><th>{t("종류")}</th><th>{t("대상")}</th><th>{t("가중치")}</th><th /></tr></thead><tbody>
            {rules.map((r) => <tr key={r.id}><td className="nw">{t(RULE_TYPES[r.rule_type] || r.rule_type)}</td><td>{r.pattern}</td>
              <td className="nw">{r.weight > 0 ? `+${r.weight}` : r.weight}</td>
              <td className="nw"><button className="btn sp" onClick={() => remove(r.id)} aria-label={t("규칙 {p} 빼기", { p: r.pattern })}><Icon d={I.x} size={12} /></button></td></tr>)}
          </tbody></table> : <p className="note">{t("사용자 규칙이 없습니다. 기본 설비 사전과 규칙만 씁니다.")}</p>}
        </section>
        <div>
          <section className="block" style={{ marginTop: 0 }}>
            <div className="head"><h2>{t("알림")}</h2></div>
            <p className="note" style={{ marginTop: 0 }}>{t("새로 동기화된 긴급 · 중요 메일만 알립니다(같은 메일은 한 번만). 동기화 주기마다 확인합니다.")}</p>
            <div className="actions" style={{ marginBottom: 0 }}>
              <button className="btn" onClick={() => test("teams")}>{t("Teams 테스트")}</button>
              <button className="btn" onClick={() => test("kakao")}>{t("카카오 테스트")}</button>
            </div>
            {Object.entries(notice).map(([k, v]) => <p key={k} className="msg" role="status">{k === "teams" ? "Teams" : t("카카오")}: {v}</p>)}
          </section>
          <section className="block">
            <div className="head"><h2>{t("자동 동기화")}</h2></div>
            <label className="field"><span>{t("동기화 주기 (분, 0 = 끔, 1~1440)")}</span>
              <input type="number" min={0} max={1440} value={syncMin} onChange={(e) => setSyncMin(Number(e.target.value))} /></label>
            <button className="btn primary" onClick={saveSync}>{t("주기 저장")}</button>
          </section>
          <section className="block">
            <div className="head"><h2>{t("계정 연동")}</h2></div>
            {accounts.length ? accounts.map((a) => (
              <div key={a.id} className="acct">
                <p className="note" style={{ margin: 0, display: "flex", alignItems: "center", gap: ".4rem", flexWrap: "wrap" }}>
                  <b>{PROVIDER_NAME[a.provider]}</b> {a.account_email || t("연결됨")}
                  <span>· {a.last_sync_at ? t("마지막 동기화 {at}", { at: a.last_sync_at }) : t("아직 동기화 안 함")}</span>
                  <button className="btn sp" disabled={syncing === a.id} onClick={() => onSync(a.id)}>{syncing === a.id ? t("동기화 중…") : t("지금 동기화")}</button>
                  <button className="btn" onClick={() => { if (confirm(t("연결을 해제하면 이 계정의 메일 데이터가 삭제됩니다. 계속할까요?"))) onDisconnect(a.id); }}>{t("연결 해제")}</button>
                </p>
                {a.last_error && <p className="msg err" role="alert">{t("최근 동기화 실패")}: {a.last_error}</p>}
                {a.tokenExpired ? <p className="msg err" role="alert">{t("토큰이 만료됐습니다. 아래 버튼으로 다시 연결하세요.")}</p>
                  : a.tokenExpiringSoon ? <p className="msg" role="alert">{t("토큰 만료 {n}일 전입니다.", { n: a.tokenDaysLeft ?? 0 })}</p> : null}
              </div>
            )) : <p className="note" style={{ marginTop: 0 }}>{t("연결된 계정이 없습니다.")}</p>}
            {diag && (["graph", "gmail"] as const).map((pv) => (
              <p key={pv} className="note">{PROVIDER_NAME[pv]}: {diag[pv]?.checks.map((c: any) => `${c.ok ? "✓" : "✗"} ${c.label}`).join(" · ")}</p>
            ))}
            <div className="actions" style={{ marginBottom: 0 }}>
              <button className="btn" onClick={() => onConnect("graph")}><Icon d={I.link} />{t("Outlook 연동")}</button>
              <button className="btn" onClick={() => onConnect("gmail")}><Icon d={I.link} />{t("Gmail 연동")}</button>
              <button className="btn" onClick={onSeed}>{t("예시 세트 열기")}</button>
            </div>
          </section>
        </div>
      </div>
    </div></main>
  );
}
