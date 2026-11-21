"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectDialog, Connect } from "./components/ConnectDialog";
import { I, Icon } from "./components/Icon";
import { Reader } from "./components/Reader";
import { Row } from "./components/Row";
import { Settings } from "./components/Settings";
import { Dashboard } from "./components/Dashboard";
import { Verify } from "./components/Verify";
import { Help } from "./components/Help";
import {
  Account, ApiError, Cls, LOCAL, Level, Mail, PROVIDER_NAME, Stats, api, dueLabel, levelName, loadToken, local, patch, post, setToken, store, when,
} from "./lib/api";
import { type Lang, initialLang, setLang, t } from "./lib/i18n";
import { installErrorHandlers, logError } from "./lib/errors";
import { type ImportIssue, localIso, parseMailFile } from "../../../packages/engine/importers.ts";

const PAGE = 100;
const PERIODS = [["morning", "오전"], ["afternoon", "오후"], ["daily", "일간"], ["weekly", "주간"], ["monthly", "월간"], ["yearly", "연간"]] as const;
const FOLDERS: [Folder, string][] = [["all", "받은 메일"], ["reply", "회신 필요"], ["urgent", "긴급"], ["important", "중요"], ["normal", "일반"], ["reference", "참고"]];
const MAX_FILE = 200 * 1024 * 1024;
type View = "mail" | "todo" | "digest" | "settings" | "dashboard" | "verify" | "help" | "privacy";
type Folder = "all" | "reply" | Level;
type Todo = { text: string; due: string | null; dueIso?: string | null; mailId: string; subject: string; sender: string; level: Level };
type ImportReport = { files: number; added: number; duplicates: number; issues: ImportIssue[] };

export default function Page() {
  const [lang, setLangState] = useState<Lang>("ko");
  const [mails, setMails] = useState<Mail[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "offline" | "auth">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncedAt, setSyncedAt] = useState("");
  const [view, setView] = useState<View>("mail");
  const [folder, setFolder] = useState<Folder>("all");
  const [equip, setEquip] = useState("");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [sel, setSel] = useState<Mail | null>(null);
  const [period, setPeriod] = useState("weekly");
  const [digest, setDigest] = useState<any>(null);
  const [todos, setTodos] = useState<{ items: Todo[]; now: string } | null | false>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [contrast, setContrast] = useState(false);
  const [size, setSize] = useState(15);
  const [tokenInput, setTokenInput] = useState("");
  const [connect, setConnect] = useState<Connect | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [diag, setDiag] = useState<any>(null);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [importing, setImporting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const count = useRef(0);
  const keep = useRef("");
  count.current = mails.length;

  const notify = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text });
    window.setTimeout(() => setToast(null), 6000);
  }, []);

  // Display settings: restore, then follow the OS dark-mode setting until the user picks one.
  useEffect(() => {
    const th = store("mdcv.theme"); const s = Number(store("mdcv.size"));
    if (th === "dark" || th === "light") setTheme(th);
    else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) setTheme("dark");
    if (store("mdcv.contrast") === "high") setContrast(true);
    if (s >= 13 && s <= 20) setSize(s);
    const l = initialLang(store("mdcv.lang"));
    setLang(l); setLangState(l);
    loadToken();
    return installErrorHandlers((m) => notify(false, t("오류가 기록되었습니다: {m}", { m })));
  }, [notify]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { document.documentElement.dataset.contrast = contrast ? "high" : ""; }, [contrast]);
  useEffect(() => { document.documentElement.style.fontSize = `${size}px`; }, [size]);
  useEffect(() => { const tm = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(tm); }, [q]);
  const pickTheme = (th: "light" | "dark") => { setTheme(th); store("mdcv.theme", th); };
  const pickLang = (l: Lang) => { setLang(l); setLangState(l); store("mdcv.lang", l); };

  const query = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE) });
    if (dq) p.set("q", dq);
    if (folder === "reply") p.set("folder", "reply"); else if (folder !== "all") p.set("importance", folder);
    if (equip) p.set("equipment", equip);
    return p.toString();
  }, [dq, folder, equip]);

  const fail = useCallback((e: unknown) => { setState((e as ApiError).status === 401 ? "auth" : "offline"); if (LOCAL) logError((e as Error).message, "load"); }, []);
  const refreshStats = useCallback(() => { api<Stats>("/api/stats").then(setStats).catch(() => {}); }, []);
  const load = useCallback(async (more = false) => {
    const id = ++seq.current;
    if (more) setLoadingMore(true);
    try {
      const [data, st] = await Promise.all([api(`/api/messages?${query}&offset=${more ? count.current : 0}`), api<Stats>("/api/stats")]);
      if (id !== seq.current) return;
      setMails((prev) => more ? [...prev, ...data.items.filter((n: Mail) => !prev.some((p) => p.id === n.id))] : data.items);
      setTotal(data.total); setStats(st); setState("ready"); setSyncedAt(when(new Date().toISOString()));
    } catch (e) { if (id === seq.current) fail(e); }
    finally { if (more && id === seq.current) setLoadingMore(false); }
  }, [query, fail]);
  useEffect(() => { load(); }, [load]);

  // Self-host: pick up mail synced by the server every minute and when the window regains focus.
  useEffect(() => {
    if (LOCAL) return;
    const refresh = () => { if (!document.hidden && count.current <= PAGE) load(); };
    const tm = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(tm); window.removeEventListener("focus", refresh); };
  }, [load]);

  useEffect(() => { document.title = `${stats?.unreadUrgent ? `(${stats.unreadUrgent}) ` : ""}MDCV`; }, [stats?.unreadUrgent]);
  useEffect(() => {
    if (view !== "digest") return;
    setDigest(null);
    api(`/api/digests/${period}`).then(setDigest).catch(() => setDigest(false));
  }, [view, period, stats?.total]);
  useEffect(() => {
    if (view !== "todo") return;
    api<{ items: Todo[]; now?: string }>("/api/todos").then((r) => setTodos({ items: r.items, now: r.now ?? new Date().toISOString() })).catch(() => setTodos(false));
  }, [view, stats?.needsReply, stats?.done]);

  useEffect(() => {
    if (state !== "ready") return;
    if (sel && (keep.current === sel.id || mails.some((m) => m.id === sel.id))) return;
    setSel(mails[0] || null);
  }, [mails, sel, state]);

  const patchMail = useCallback(async (id: string, body: object) => {
    const u = await patch<Mail>(`/api/messages/${encodeURIComponent(id)}`, body);
    setMails((ms) => ms.map((m) => (m.id === id ? u : m)));
    setSel((s) => (s?.id === id ? u : s));
    refreshStats();
    return u;
  }, [refreshStats]);

  // Mark as read only after the mail stayed open for a second (not while arrowing through the list).
  useEffect(() => {
    if (!sel || sel.isRead) return;
    const id = sel.id;
    const tm = setTimeout(() => { patchMail(id, { isRead: true }).catch(() => {}); }, 1000);
    return () => clearTimeout(tm);
  }, [sel?.id, sel?.isRead, patchMail]);

  const select = useCallback((m: Mail) => { keep.current = ""; setSel(m); }, []);
  const openMail = (m: Mail) => { keep.current = m.id; setView("mail"); setFolder("all"); setEquip(""); setQ(""); setDq(""); setSel(m); };
  const openById = async (id: string) => { try { openMail(await api<Mail>(`/api/messages/${encodeURIComponent(id)}`)); } catch (e) { notify(false, (e as Error).message); } };
  const pickFolder = (f: Folder) => { setView("mail"); setFolder(f); setEquip(""); };
  const pickEquip = useCallback((e: string) => { setView("mail"); setEquip((cur) => (cur === e ? "" : e)); }, []);
  const classified = (c: Cls) => {
    setMails((ms) => ms.map((m) => (m.id === sel?.id ? { ...m, classification: c } : m)));
    setSel((s) => (s ? { ...s, classification: c } : s));
    load();
  };

  const done = useCallback(async (m: Mail, status: "open" | "done") => {
    const idx = mails.findIndex((x) => x.id === m.id);
    await patchMail(m.id, { status });
    if (folder === "reply" && status === "done") {
      const rest = mails.filter((x) => x.id !== m.id);
      setMails(rest); setTotal((n) => n - 1); setSel(rest[Math.min(idx, rest.length - 1)] || null);
    }
  }, [mails, folder, patchMail]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select");
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/" && !typing) { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === "Escape" && e.target === searchRef.current) { setQ(""); searchRef.current?.blur(); return; }
      if (typing || view !== "mail") return;
      if ((e.key === "e" || e.key === "E") && sel) { done(sel, sel.status === "done" ? "open" : "done").catch((err) => notify(false, err.message)); return; }
      if (!["ArrowDown", "ArrowUp", "j", "k"].includes(e.key)) return;
      e.preventDefault();
      const i = mails.findIndex((m) => m.id === sel?.id);
      const next = mails[Math.min(mails.length - 1, Math.max(0, i + (e.key === "ArrowDown" || e.key === "j" ? 1 : -1)))];
      if (!next) return;
      select(next);
      const el = rowsRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(next.id)}"]`);
      el?.focus(); el?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --- file import (browser build) -------------------------------------------------------------------------------------
  const importFiles = useCallback(async (files: File[]) => {
    if (!LOCAL || !files.length) return;
    setImporting(true);
    const rep: ImportReport = { files: files.length, added: 0, duplicates: 0, issues: [] };
    try {
      for (const f of files) {
        if (f.size > MAX_FILE) { rep.issues.push({ file: f.name, message: t("200MB보다 큰 파일은 나눠서 가져오세요"), fatal: true }); continue; }
        // ponytail: parses on the main thread; move to a Web Worker if multi-hundred-MB mbox files become common
        const r = parseMailFile(f.name, new Uint8Array(await f.arrayBuffer()), localIso(new Date(f.lastModified)));
        rep.issues.push(...r.issues);
        const a = await local().addMails(r.mails);
        rep.added += a.added; rep.duplicates += a.duplicates;
      }
    } catch (e) { rep.issues.push({ file: "", message: (e as Error).message, fatal: true }); logError((e as Error).message, "import"); }
    setImporting(false); setReport(rep); setView("mail"); setFolder("all"); load();
  }, [load]);
  useEffect(() => {
    if (!LOCAL) return;
    let depth = 0;
    const enter = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) { depth++; setDragging(true); e.preventDefault(); } };
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (e: DragEvent) => { e.preventDefault(); depth = 0; setDragging(false); importFiles([...(e.dataTransfer?.files ?? [])]); };
    window.addEventListener("dragenter", enter); window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragenter", enter); window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
  }, [importFiles]);

  // --- self-host accounts ----------------------------------------------------------------------------------------------
  const loadAccounts = useCallback(async () => {
    if (LOCAL) return;
    try { const [a, d] = await Promise.all([api("/api/accounts"), api("/api/accounts/diagnose")]); setAccounts(a.items); setDiag(d); } catch { /* the list area explains connection state */ }
  }, []);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { if (LOCAL) return; const tm = setInterval(loadAccounts, 120_000); return () => clearInterval(tm); }, [loadAccounts]);
  const openConnect = async (provider: "graph" | "gmail") => {
    try { setConnect({ ...(await api<Omit<Connect, "agreed">>(`/api/accounts/connect/${provider}`)), agreed: false }); } catch (e) { notify(false, (e as Error).message); }
  };
  const syncAccount = useCallback(async (accountId: number) => {
    setSyncing(accountId);
    try {
      const r = await post(`/api/accounts/${accountId}/sync`);
      notify(true, t("동기화 완료: 새 메일 {n}통", { n: r.new }));
      await Promise.all([load(), loadAccounts()]);
    } catch (e) { notify(false, t("동기화 실패: {m}", { m: (e as Error).message })); loadAccounts(); }
    finally { setSyncing(null); }
  }, [load, loadAccounts, notify]);
  const seed = async () => { try { const r = await post("/api/demo/seed"); notify(true, t("예시 메일 {n}통을 열었습니다.", { n: r.inserted })); setView("mail"); load(); } catch (e) { notify(false, (e as Error).message); } };
  useEffect(() => {
    if (LOCAL) return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected"); const account = params.get("account"); const err = params.get("connectError");
    if (!connected && !err) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (err) { notify(false, t("연동 실패: {m}", { m: err })); return; }
    notify(true, t("{p} 연결 완료. 메일을 동기화합니다.", { p: PROVIDER_NAME[connected || ""] || "" }));
    loadAccounts();
    if (account) syncAccount(Number(account));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = (f: Folder) => (!stats ? "" : f === "all" ? stats.total : f === "reply" ? stats.needsReply : stats.byImportance[f] ?? 0);
  const equipment = useMemo(() => Object.entries(stats?.byEquipment || {}).sort((a, b) => b[1] - a[1]).slice(0, 40), [stats]);
  const demo = !!stats && stats.total > 0 && Object.keys(stats.providers).every((k) => k === "demo");
  const title = view === "mail" ? (equip ? t("설비 {e}", { e: equip }) : t(FOLDERS.find(([f]) => f === folder)?.[1] ?? "")) : "";
  const filtered = !!(dq || equip || folder !== "all");
  const chooseFiles = () => fileRef.current?.click();

  return (
    <div className="app" key={lang}>
      <a className="skip" href="#main">{t("본문으로 건너뛰기")}</a>
      <header className="top">
        <div className="brand"><b>MDCV</b><span>{t("메일 분류·검증")}</span></div>
        <label className="search">
          <Icon d={I.search} />
          <input ref={searchRef} value={q} onChange={(e) => { setQ(e.target.value); setView("mail"); }} placeholder={t("제목 · 본문 · 발신자 · 설비 검색")} aria-label={t("메일 검색")} />
          {!q && <kbd>/</kbd>}
        </label>
        <span className={`sync${state === "offline" || state === "auth" ? " off" : ""}`}>
          <i />{state === "offline" ? t("API 연결 안 됨") : state === "auth" ? t("접속 토큰 필요") : state === "loading" ? t("불러오는 중") : demo ? t("예시 데이터 {n}통", { n: stats?.total ?? 0 }) : LOCAL ? t("이 브라우저에 {n}통", { n: stats?.total ?? 0 }) : t("{n}통 · {at} 갱신", { n: stats?.total ?? 0, at: syncedAt })}
          {stats?.engine === "llm" && <b className="eng">LLM</b>}
        </span>
        <div className="tools">
          {LOCAL ? <>
            <button className="tbtn" onClick={chooseFiles} disabled={importing} title={t(".eml · .mbox · .msg 파일을 가져옵니다 (끌어다 놓아도 됩니다)")}><Icon d={I.link} />{importing ? t("가져오는 중…") : t("가져오기")}</button>
            <input ref={fileRef} type="file" multiple accept=".eml,.mbox,.mbx,.msg,message/rfc822,application/vnd.ms-outlook" hidden
              onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; importFiles(fs); }} />
          </> : <>
            <button className="tbtn" onClick={() => { load(); loadAccounts(); }} title={t("새로고침")}><Icon d={I.sync} />{t("새로고침")}</button>
            <button className="tbtn" onClick={() => openConnect("graph")}><Icon d={I.link} />Outlook</button>
            <button className="tbtn" onClick={() => openConnect("gmail")}><Icon d={I.link} />Gmail</button>
          </>}
          <span className="tsep" />
          <button className="tbtn" onClick={() => setSize((s) => { const n = Math.max(13, s - 1); store("mdcv.size", String(n)); return n; })} aria-label={t("글자 작게")} disabled={size <= 13}>{t("가−")}</button>
          <button className="tbtn" onClick={() => setSize((s) => { const n = Math.min(20, s + 1); store("mdcv.size", String(n)); return n; })} aria-label={t("글자 크게")} disabled={size >= 20}>{t("가+")}</button>
          <button className="tbtn" onClick={() => pickTheme(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? t("밝은 화면") : t("어두운 화면")}>
            <Icon d={theme === "dark" ? I.sun : I.moon} />
          </button>
          <button className="tbtn" aria-pressed={contrast} onClick={() => setContrast((c) => { store("mdcv.contrast", c ? "" : "high"); return !c; })} title={t("글자·테두리 대비를 강하게")}>{t("고대비")}</button>
          <button className="tbtn" onClick={() => pickLang(lang === "ko" ? "en" : "ko")} aria-label={lang === "ko" ? "English" : "한국어"}>{lang === "ko" ? "EN" : "한"}</button>
        </div>
      </header>

      <nav className="rail" aria-label={t("메일함")}>
        <h2>{t("메일함")}</h2>
        {FOLDERS.map(([f, label]) => (
          <button key={f} className="ritem" aria-current={view === "mail" && folder === f && !equip} onClick={() => pickFolder(f)}>
            {f !== "all" && f !== "reply" && <span className="sq" style={{ background: f === "urgent" ? "var(--urgent)" : f === "important" ? "var(--important)" : undefined }} />}
            {t(label)}<span className="n">{counts(f)}</span>
          </button>
        ))}
        <button className="ritem" aria-current={view === "todo"} onClick={() => setView("todo")}>{t("할 일 (기한순)")}</button>
        <h2>{t("설비")}</h2>
        <div className="plates">
          {equipment.length ? equipment.map(([e, n]) => (
            <button key={e} className="plate" aria-pressed={view === "mail" && equip === e} onClick={() => pickEquip(e)}>{e}<span className="c">{n}</span></button>
          )) : <span className="ritem" style={{ padding: 0, color: "var(--steel-mute)" }}>{t("메일을 불러오면 표시")}</span>}
        </div>
        <h2>{t("기간 요약")}</h2>
        {PERIODS.map(([k, label]) => (
          <button key={k} className="ritem" aria-current={view === "digest" && period === k} onClick={() => { setPeriod(k); setView("digest"); }}>{t(label)}</button>
        ))}
        <h2>{t("관리")}</h2>
        {LOCAL && <button className="ritem" aria-current={view === "verify"} onClick={() => setView("verify")}>{t("현장 검증")}</button>}
        <button className="ritem" aria-current={view === "settings"} onClick={() => setView("settings")}>{LOCAL ? t("설정 · 데이터 · Outlook") : t("규칙 · 알림 · 연동")}</button>
        <button className="ritem" aria-current={view === "dashboard"} onClick={() => setView("dashboard")}>{t("사용량 현황")}</button>
        <button className="ritem" aria-current={view === "help" || view === "privacy"} onClick={() => setView("help")}>{t("도움말 · 개인정보")}</button>
        {accounts.map((a) => (
          <div key={a.id} className="ritem acct-rail">
            <span className="acct-text">
              {PROVIDER_NAME[a.provider]} · {a.account_email || t("연결됨")}
              <small>{a.tokenExpired ? <b className="err">{t("토큰 만료 — 재연결 필요")}</b> : a.last_error ? <b className="err">{t("동기화 실패 — 설정에서 확인")}</b> : a.last_sync_at ? t("동기화 {at}", { at: a.last_sync_at.slice(5, 16) }) : t("아직 동기화 안 함")}</small>
            </span>
            <button className="btn sp" disabled={syncing === a.id} onClick={() => syncAccount(a.id)} title={t("지금 동기화")}>
              <Icon d={I.sync} size={12} />{syncing === a.id ? t("중…") : t("동기화")}</button>
          </div>
        ))}
      </nav>

      <div id="main" className="mainwrap" tabIndex={-1}>
      {report && (
        <div className={`block ${report.issues.some((i) => i.fatal) ? "warn" : "ok"} importrep`} role="status">
          <div className="head"><h2>{t("가져오기 결과")}</h2>
            <button className="btn sp" onClick={() => setReport(null)} aria-label={t("가져오기 결과 닫기")}><Icon d={I.x} size={12} /></button></div>
          <p style={{ margin: 0 }}>{t("파일 {f}개 · 새 메일 {a}통 · 이미 있던 메일 {d}통 · 문제 {i}건", { f: report.files, a: report.added, d: report.duplicates, i: report.issues.length })}</p>
          {report.issues.length > 0 && <ul className="plain">{report.issues.slice(0, 20).map((i, n) => (
            <li key={n}><b>{i.file || t("파일")}</b>{i.mail ? ` · ${t("{n}번째 메일", { n: i.mail })}` : ""}{i.line ? ` · ${t("{n}번째 줄", { n: i.line })}` : ""}: {t(i.message)}{i.fatal ? ` (${t("건너뜀")})` : ""}</li>))}</ul>}
        </div>
      )}

      {view === "mail" && (
        <div className="work">
          <section className="list" aria-label={t("메일 목록")}>
            <div className="lhead">
              <h1>{title}</h1><span className="meta">{state === "ready" ? t("{n}통", { n: total }) : ""}</span>
              {equip && <button className="plate on sp" onClick={() => setEquip("")} aria-label={t("설비 필터 {e} 해제", { e: equip })}>{equip}<Icon d={I.x} size={12} /></button>}
            </div>
            {state === "ready" && !!stats?.total && (
              <div className="brief">
                <span>{t("읽지 않음")} <b>{stats.unread}</b></span>
                <span className="u">{t("긴급")} <b>{stats.byImportance.urgent ?? 0}</b></span>
                <span>{t("중요")} <b>{stats.byImportance.important ?? 0}</b></span>
                <span>{t("회신 필요")} <b>{stats.needsReply}</b></span>
              </div>
            )}
            <div className="rows" role="listbox" aria-label={title} ref={rowsRef}>
              {state === "loading" && Array.from({ length: 8 }, (_, i) => <div key={i} className="skel" />)}
              {state === "offline" && (
                <div className="empty"><h2>{LOCAL ? t("저장소를 열 수 없습니다") : t("API 서버에 연결할 수 없습니다")}</h2>
                  <p>{LOCAL ? t("브라우저가 사이트 데이터 저장(IndexedDB)을 막고 있을 수 있습니다. 시크릿 창이나 저장 차단 설정을 확인하세요.") : t("API 서버가 꺼져 있습니다. python apps/api/server.py 를 실행한 뒤 다시 시도하세요.")}</p>
                  <button className="btn" onClick={() => load()}><Icon d={I.sync} />{t("다시 시도")}</button></div>
              )}
              {state === "auth" && (
                <form className="empty" onSubmit={(e) => { e.preventDefault(); setToken(tokenInput); setTokenInput(""); load(); loadAccounts(); }}>
                  <h2>{t("접속 토큰이 필요합니다")}</h2>
                  <p>{t("관리자가 설정한 MDCV_API_TOKEN 값을 입력하세요. 이 브라우저에만 저장됩니다.")}</p>
                  <label className="field"><span>{t("접속 토큰")}</span><input type="password" autoComplete="off" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} /></label>
                  <button className="btn primary" disabled={!tokenInput.trim()}>{t("접속")}</button></form>
              )}
              {state === "ready" && !stats?.total && (
                <div className="empty welcome"><h2>{t("설비를 아는 메일 분류기, MDCV")}</h2>
                  <p>{LOCAL ? t("메일함 위에 설비 · 알람 · 기한을 아는 분류 층을 얹습니다. 메일 파일은 이 브라우저 안에서만 처리되고 서버로 가지 않습니다.") : t("Outlook이나 Gmail 계정을 연동하거나, 예시 메일로 먼저 확인하세요.")}</p>
                  <div className="actions" style={{ justifyContent: "center" }}>
                    <button className="btn primary" onClick={seed}>{t("예시 세트 열기 (합성 30통)")}</button>
                    {LOCAL ? <button className="btn" onClick={chooseFiles}>{t(".eml · .mbox · .msg 가져오기")}</button>
                      : <button className="btn" onClick={() => openConnect("graph")}><Icon d={I.link} />{t("Outlook 연결")}</button>}
                    <button className="btn" onClick={() => setView("help")}>{t("처음 사용 안내")}</button>
                  </div>
                  {LOCAL && <p className="note">{t("파일을 이 창에 끌어다 놓아도 됩니다.")}</p>}</div>
              )}
              {state === "ready" && !!stats?.total && mails.length === 0 && (
                <div className="empty"><h2>{t("조건에 맞는 메일이 없습니다")}</h2>
                  <p>{dq ? t("\"{q}\" 검색 결과가 없습니다.", { q: dq }) : folder === "reply" ? t("회신이 필요한 메일을 모두 처리했습니다.") : t("이 분류에 해당하는 메일이 없습니다.")}</p>
                  {filtered && <button className="btn" onClick={() => { setQ(""); setDq(""); setEquip(""); setFolder("all"); }}>{t("필터 모두 해제")}</button>}</div>
              )}
              {mails.map((m) => <Row key={m.id} m={m} selected={m.id === sel?.id} onSelect={select} onEquip={pickEquip} />)}
              {mails.length < total && <button className="btn more-btn" disabled={loadingMore} onClick={() => load(true)}>{loadingMore ? t("불러오는 중…") : t("더 보기 ({a}/{b})", { a: mails.length, b: total })}</button>}
            </div>
          </section>
          <Reader mail={sel} onEquip={pickEquip} onDone={done} onClassified={classified} canSend={!!stats?.sendEnabled} />
        </div>
      )}

      {view === "todo" && (
        <main className="page"><div className="pin">
          <h1>{t("할 일 (기한순)")}</h1><p className="sub">{t("처리 전인 회신 필요 메일에서 뽑은 요청입니다. 한국어 · 영어 마감 표현(금주 중, 차주 화요일, 11/24(화), by Friday 등)을 날짜로 바꿔 급한 순으로 정렬합니다.")}</p>
          {todos === null && <p className="sub">{t("불러오는 중…")}</p>}
          {todos === false && <div className="empty"><h2>{t("할 일을 불러올 수 없습니다")}</h2></div>}
          {todos && (todos.items.length ? (<>
            <p className="note">{t("기준 시각 {at}", { at: todos.now.replace("T", " ").slice(0, 16) })}</p>
            <table className="grid"><thead><tr><th>{t("기한")}</th><th>{t("할 일")}</th><th>{t("메일")}</th><th>{t("발신")}</th><th>{t("중요도")}</th></tr></thead>
              <tbody>{todos.items.map((td, i) => (
                <tr key={i} className={`click${td.dueIso && td.dueIso < todos.now ? " overdue" : ""}`} tabIndex={0} onClick={() => openById(td.mailId)} onKeyDown={(e) => { if (e.key === "Enter") openById(td.mailId); }}>
                  <td className="nw"><b>{dueLabel(td.dueIso, td.due, todos.now)}</b>{td.due && <div className="note" style={{ margin: 0 }}>“{td.due}”</div>}</td><td>{td.text}</td><td>{td.subject}</td>
                  <td className="nw">{td.sender}</td><td className={`nw lv ${td.level}`}>{levelName(td.level)}</td>
                </tr>))}</tbody></table>
          </>) : <div className="empty"><h2>{t("처리할 할 일이 없습니다")}</h2><p>{t("회신 · 제출 · 확인 요청이 있는 메일이 오면 여기에 모입니다.")}</p></div>)}
        </div></main>
      )}

      {view === "digest" && (
        <main className="page"><div className="pin">
          <h1>{t("기간 요약")}</h1>
          <div className="seg" role="group" aria-label={t("기간")}>
            {PERIODS.map(([k, label]) => <button key={k} aria-pressed={period === k} onClick={() => setPeriod(k)}>{t(label)}</button>)}
          </div>
          {digest === null && <p className="sub">{t("요약을 만드는 중…")}</p>}
          {digest === false && <div className="empty"><h2>{t("요약을 불러올 수 없습니다")}</h2></div>}
          {digest && (<>
            <p className="big" style={{ margin: "0 0 .25rem" }}>{t("{p} 요약: {n}통 (긴급 {u} · 중요 {i}), 주요 설비 {e}", { p: t(digest.label), n: digest.total, u: digest.byImportance.urgent ?? 0, i: digest.byImportance.important ?? 0, e: Object.keys(digest.byEquipment).slice(0, 3).join(", ") || t("없음") })}</p>
            <p className="sub">{t("기준 {at}", { at: String(digest.generatedAt).replace("T", " ") })}</p>
            <div className="cols">
              <section>
                <h2 className="bodyhead" style={{ marginTop: 0 }}>{t("먼저 볼 메일")}</h2>
                {digest.topMails.length ? <table className="grid"><tbody>{digest.topMails.map((tm: any) => {
                  const lv: Level = tm.importance?.level || "normal";
                  return (<tr key={tm.id} className="click" onClick={() => openById(tm.id)}>
                    <td className={`nw lv ${lv}`}>{levelName(lv)}</td><td><b>{tm.subject}</b><div className="note" style={{ margin: 0 }}>{tm.summary}</div></td></tr>);
                })}</tbody></table> : <p className="sub">{t("이 기간에 받은 메일이 없습니다.")}</p>}
              </section>
              <section>
                <h2 className="bodyhead" style={{ marginTop: 0 }}>{t("할 일")}</h2>
                {digest.actionItems.length ? <table className="grid"><tbody>{digest.actionItems.map((a: any, i: number) => (
                  <tr key={i} className="click" onClick={() => openById(a.mailId)}><td className="nw"><b>{a.dueIso ? dueLabel(a.dueIso, a.due, digest.generatedAt) : a.due || "—"}</b></td><td>{a.text}</td></tr>))}</tbody></table> : <p className="sub">{t("없음")}</p>}
              </section>
            </div>
          </>)}
        </div></main>
      )}

      {view === "verify" && LOCAL && <Verify onChanged={load} onOpen={openById} notify={notify} />}
      {view === "dashboard" && <Dashboard />}
      {(view === "help" || view === "privacy") && <Help section={view === "privacy" ? "privacy" : undefined} onSeed={seed} onImport={chooseFiles} />}
      {view === "settings" && <Settings accounts={accounts} diag={diag} syncing={syncing} onConnect={openConnect} onSeed={seed} onSync={syncAccount} onReclassified={load}
        onVerify={() => setView("verify")} onPrivacy={() => setView("privacy")}
        onDisconnect={async (id) => { try { await api(`/api/accounts/${id}`, { method: "DELETE" }); notify(true, t("계정을 해제하고 메일 데이터를 삭제했습니다.")); loadAccounts(); load(); } catch (e) { notify(false, (e as Error).message); } }} />}
      </div>

      {dragging && <div className="dropzone" aria-hidden="true"><div>{t("여기에 놓으면 이 브라우저 안에서만 읽습니다 (.eml · .mbox · .msg)")}</div></div>}
      {toast && <div role="status" className={`msg toast ${toast.ok ? "ok" : "err"}`}>{toast.text}</div>}
      {!LOCAL && <ConnectDialog connect={connect} onChange={setConnect} onClose={() => setConnect(null)} />}
    </div>
  );
}
