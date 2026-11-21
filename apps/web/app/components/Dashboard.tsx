import { useEffect, useState } from "react";
import { LEVELS, LOCAL, Level, levelName, sourceName, api, post } from "../lib/api";
import { t } from "../lib/i18n";

export function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [backup, setBackup] = useState("");
  useEffect(() => { api("/api/dashboard?days=14").then(setData).catch((e) => setErr(e.message)); }, []);
  if (err) return <main className="page"><div className="pin"><h1>{t("사용량 현황")}</h1><div className="empty"><h2>{t("불러올 수 없습니다")}</h2><p>{err}</p></div></div></main>;
  if (!data) return <main className="page"><div className="pin"><h1>{t("사용량 현황")}</h1><p className="sub">{t("불러오는 중…")}</p></div></main>;
  const max = Math.max(1, ...data.daily.map((d: any) => d.total));
  const llm = data.stats.llm || {};
  const makeBackup = async () => {
    try { const r = await post("/api/backup"); setBackup(t("백업 완료: {f} ({k}KB).", { f: r.file, k: Math.round(r.size / 1024) }) + " " + r.note); }
    catch (e) { setBackup(t("백업 실패: {m}", { m: (e as Error).message })); }
  };
  return (
    <main className="page"><div className="pin">
      <h1>{t("사용량 현황")}</h1><p className="sub">{t("최근 14일 메일량, 중요도 분포, 최근 작업 기록을 확인합니다.")}</p>
      <div className="cols">
        <section className="block" style={{ marginTop: 0 }}>
          <div className="head"><h2>{t("최근 14일 메일량")}</h2><span className="note" style={{ margin: 0 }}>{t("총 {n}통", { n: data.stats.total })}</span></div>
          {data.daily.length ? <div className="bars" role="img" aria-label={t("최근 14일 메일량, 최대 {n}통", { n: max })}>
            {data.daily.map((d: any) => <div key={d.date} className="bar-col" title={`${d.date}: ${d.total}`}>
              <div className="bar" style={{ height: `${Math.max(4, (d.total / max) * 100)}%` }} /><span>{d.date.slice(5)}</span><b>{d.total}</b></div>)}
          </div> : <p className="note">{t("기간 내 메일이 없습니다.")}</p>}
          <h2 className="bodyhead">{t("중요도 분포")}</h2>
          <table className="grid"><tbody>
            {LEVELS.filter((k) => data.stats.byImportance?.[k]).map((k: Level) => <tr key={k}><td className={`lv ${k}`}>{levelName(k)}</td><td>{data.stats.byImportance[k]}</td></tr>)}
          </tbody></table>
          <h2 className="bodyhead">{t("출처별")}</h2>
          <p className="note" style={{ margin: 0 }}>{Object.entries(data.stats.providers || {}).map(([k, v]: any) => `${sourceName(k)} ${v}`).join(" · ") || t("없음")}</p>
        </section>
        <div>
          {!LOCAL && <section className="block" style={{ marginTop: 0 }}>
            <div className="head"><h2>{t("LLM 사용량")}</h2></div>
            {llm.enabled ? <table className="grid"><tbody>
              <tr><td>{t("모델")}</td><td>{llm.provider} · {llm.model} ({llm.promptVersion})</td></tr>
              <tr><td>{t("오늘 호출")}</td><td>{llm.usage?.calls ?? 0} / {llm.dailyLimit} ({t("차단")} {llm.usage?.blocked ?? 0})</td></tr>
              <tr><td>{t("전송 글자")}</td><td>{(llm.usage?.chars ?? 0).toLocaleString()} · {t("건당 상한")} {llm.maxChars}</td></tr>
            </tbody></table> : <p className="note" style={{ margin: 0 }}>{t("LLM이 꺼져 있어 규칙으로만 분류 중입니다.")}</p>}
          </section>}
          <section className="block" style={LOCAL ? { marginTop: 0 } : undefined}>
            <div className="head"><h2>{t("최근 작업")}</h2></div>
            {[...data.notifications.map((n: any) => ({ t: `${n.channel} ${n.status}`, at: n.created_at })),
              ...data.audit.map((n: any) => ({ t: n.action, at: n.created_at }))].slice(0, 10)
              .map((n: any, i: number) => <p key={i} className="note" style={{ margin: "0 0 .2rem" }}>{String(n.at).replace("T", " ")} · {n.t}</p>)}
            {!data.audit.length && !data.notifications.length && <p className="note" style={{ margin: 0 }}>{t("기록이 없습니다.")}</p>}
          </section>
          {!LOCAL && <section className="block">
            <div className="head"><h2>{t("백업")}</h2></div>
            <p className="note" style={{ marginTop: 0 }}>{t("DB 스냅샷을 서버의 backups 폴더에 만듭니다. 복구에는 스냅샷과 암호화 키 파일이 함께 필요합니다.")}</p>
            <button className="btn primary" onClick={makeBackup}>{t("지금 백업 만들기")}</button>
            {backup && <p className="msg" role="status">{backup}</p>}
          </section>}
        </div>
      </div>
    </div></main>
  );
}
