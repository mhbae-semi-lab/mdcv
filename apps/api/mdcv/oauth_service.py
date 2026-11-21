"""OAuth 흐름 공유 서비스: 두 HTTP 서버(server.py/main.py)가 동일하게 사용한다."""
import threading

from . import providers


def start_connect(store, provider):
    if provider not in ("graph", "gmail"):
        raise providers.ProviderError("unknown_provider", provider)
    begun = providers.begin_auth(provider)
    diag = providers.diagnose(store)[provider]
    return {"provider": provider, "authUrl": begun["authUrl"], "configured": begun["configured"],
            "redirectUri": begun["redirectUri"], "diagnose": diag,
            "consentRequired": True,
            "consentItems": ["메일 읽기(최소권한)", "토큰 암호화 저장(서버에만 보관)", "LLM 전송 시 마스킹·고지", "연결 해제 시 데이터 삭제"]
            + (["답장 발송(관리자가 발송 기능을 켠 서버)"] if providers.send_enabled() else [])}


def handle_callback(store, provider, code, state):
    pending = providers.pop_pending(state)  # state 검증 + PKCE verifier 회수
    if pending["provider"] != provider:
        raise providers.ProviderError("invalid_state", "제공자가 일치하지 않습니다.")
    tokens = providers.exchange_code(provider, code, pending["verifier"])
    try:
        email = providers.fetch_profile(provider, providers._decrypt(tokens["accessTokenEnc"]))
    except Exception:
        email = ""
    account_id = store.add_account(provider, email, tokens)
    store.audit("account_connect", {"provider": provider, "accountId": account_id})
    return account_id


_LOCKS = {}  # 계정별 동기화 잠금: 수동 동기화와 자동 동기화가 겹치지 않게 한다


def sync_account(store, service, account_id):
    """서버 보관 토큰으로 최신 메일을 가져온다. 만료 시 자동 갱신하고 결과·오류를 계정에 기록한다."""
    account = store.get_account(account_id)
    if not account:
        raise providers.ProviderError("account_not_found", "계정을 찾을 수 없습니다.")
    lock = _LOCKS.setdefault(account_id, threading.Lock())
    if not lock.acquire(blocking=False):
        raise providers.ProviderError("sync_busy", "이미 동기화 중입니다. 잠시 후 확인하세요.")
    try:
        first = not account.get("last_sync_at")  # 첫 동기화는 과거 메일이 많아 알림을 보내지 않는다
        try:
            token = providers.valid_access_token(store, account)
            fetch = providers.sync_graph if account["provider"] == "graph" else providers.sync_gmail
            mails = fetch(token, top=100 if first else 50, known=store.known_provider_ids(account["provider"]))
            new_count = 0
            for mail in mails:
                mail["accountId"] = account_id
                new_count += int(service.ingest(mail, do_notify=not first)["isNew"])
        except Exception as e:
            err = e if isinstance(e, providers.ProviderError) else providers.ProviderError("sync_failed", e)
            store.record_sync(account_id, err.korean(account["provider"]))
            raise err
        store.record_sync(account_id)
        store.audit("account_sync", {"accountId": account_id, "new": new_count})
        return {"accountId": account_id, "provider": account["provider"], "new": new_count}
    finally:
        lock.release()
