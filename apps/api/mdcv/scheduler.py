"""연동된 계정을 주기적으로 자동 동기화한다.

주기는 설정 화면 값(store settings syncMinutes, 기본은 MDCV_SYNC_MINUTES=10분)을
매 주기마다 다시 읽어 서버 재시작 없이 반영한다. 0이면 끈다.
"""
import logging
import os
import threading

from . import oauth_service, providers

log = logging.getLogger("mdcv.sync")


def _minutes(store):
    try:
        return float(store.get_settings().get("syncMinutes", os.getenv("MDCV_SYNC_MINUTES") or 10))
    except Exception:
        return 10.0


def start(store, service):
    stop = threading.Event()

    def loop():
        stop.wait(15)  # 기동 직후 서버가 안정된 뒤 첫 실행
        while not stop.is_set():
            minutes = _minutes(store)
            if minutes > 0:
                for acc in store.list_accounts():
                    try:
                        r = oauth_service.sync_account(store, service, acc["id"])
                    except providers.ProviderError as e:
                        if e.code == "sync_busy":
                            continue
                        log.warning("계정 %s 동기화 실패(1차): %s — 30초 후 재시도", acc["id"], e.korean(acc["provider"]))
                        if stop.wait(30):
                            break
                        try:
                            r = oauth_service.sync_account(store, service, acc["id"])
                        except Exception:
                            log.warning("계정 %s 동기화 재시도도 실패", acc["id"])
                            continue
                    except Exception:
                        log.exception("계정 %s 동기화 중 예기치 못한 오류", acc["id"])
                        continue
                    if r["new"]:
                        log.info("계정 %s 새 메일 %d건", acc["id"], r["new"])
            stop.wait(max(minutes, 1) * 60)

    threading.Thread(target=loop, daemon=True, name="mdcv-sync").start()
    return stop
