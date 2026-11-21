"use client";
import { useEffect } from "react";
import { logError } from "./lib/errors";
import { t } from "./lib/i18n";

// Render errors land here instead of a blank page; the message goes to the local error log only.
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { logError(error.message, "render"); }, [error]);
  return (
    <main className="page"><div className="pin">
      <h1>{t("화면을 그리다 문제가 생겼습니다")}</h1>
      <p className="sub">{error.message}</p>
      <p className="note">{t("데이터는 그대로입니다. 다시 시도하거나 새로고침하세요. 오류는 도움말의 오류 기록에 남습니다.")}</p>
      <button className="btn primary" onClick={reset}>{t("다시 시도")}</button>
    </div></main>
  );
}
