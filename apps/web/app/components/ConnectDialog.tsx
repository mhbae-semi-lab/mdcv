import { useEffect, useRef } from "react";
import { PROVIDER_NAME } from "../lib/api";
import { t } from "../lib/i18n";

export type Connect = { provider: string; authUrl: string; configured: boolean; redirectUri: string; consentItems: string[]; diagnose?: any; agreed: boolean };

export function ConnectDialog({ connect, onChange, onClose }: { connect: Connect | null; onChange: (c: Connect) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (connect && !d.open) d.showModal();
    if (!connect && d.open) d.close();
  }, [connect]);

  return (
    <dialog ref={ref} aria-labelledby="dlg-t" onClose={onClose}>
      {connect && (
        <form method="dialog" className="dlg">
          <h2 id="dlg-t">{t("{p} 계정 연동 동의", { p: PROVIDER_NAME[connect.provider] })}</h2>
          <p className="note" style={{ marginTop: 0 }}>{t("연동 전에 아래 항목을 확인하고 동의해야 합니다.")}</p>
          <ul>{(connect.consentItems || []).map((c) => <li key={c}>{t(c)}</li>)}</ul>
          {connect.diagnose && (
            <div className="block" style={{ margin: ".5rem 0" }}>
              <h2 className="bodyhead" style={{ marginTop: 0 }}>{t("설정 진단")}</h2>
              <ul>{connect.diagnose.checks.map((c: any) => <li key={c.key}>{c.ok ? "✓" : "✗"} {c.label}{c.ok ? "" : ` — ${c.hint}`}</li>)}</ul>
              {!connect.configured && <p className="note">{t("설정이 비어 있어 인증 창으로 이동할 수 없습니다. .env에 값을 넣고 API 서버를 재시작하세요. 절차는 docs/oauth-setup-guide.md에 있습니다.")}<br />{t("리디렉션 URI")}: <code>{connect.redirectUri}</code></p>}
            </div>
          )}
          <label><input type="checkbox" checked={connect.agreed} onChange={(e) => onChange({ ...connect, agreed: e.target.checked })} />{t("메일 수집·이용 및 LLM 전송 시 마스킹 처리에 동의합니다.")}</label>
          <div className="row-btns">
            <button className="btn" value="cancel">{t("취소")}</button>
            <button type="button" className="btn primary" disabled={!connect.agreed || !connect.configured}
              onClick={() => { window.open(connect.authUrl, "_blank", "noopener"); ref.current?.close(); }}>{t("동의하고 연결")}</button>
          </div>
        </form>
      )}
    </dialog>
  );
}
