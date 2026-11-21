"""공용 REST API. 표준 라이브러리 서버(server.py)와 FastAPI(main.py)가 같은 처리를 쓴다.

HTTP 계층은 `Api.handle(method, path, query, payload, authorization)` 하나만 호출하면 된다.
"""
import hmac
import logging
import os
import re
import time
from datetime import datetime, timedelta
from urllib.parse import quote, urlparse

from . import notify, oauth_service, providers
from .digest import build_digest, period_start
from .sample_data import sample_mails

log = logging.getLogger("mdcv.api")
VERSION = "1.0.0"
LEVELS = ("urgent", "important", "normal", "reference")


def setup_logging():
    logging.basicConfig(level=os.getenv("MDCV_LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if os.getenv("MDCV_SECRET", "") in ("", "change-me-in-production"):
        log.info("MDCV_SECRET 미설정: 토큰 암호화 키를 데이터 폴더의 mdcv.key 파일로 관리합니다(백업 대상에 포함하세요).")
    if (os.getenv("MDCV_HOST") or "127.0.0.1") not in ("127.0.0.1", "localhost") and not os.getenv("MDCV_API_TOKEN"):
        log.warning("외부 접속을 허용했지만 MDCV_API_TOKEN이 없습니다. 누구나 메일을 읽을 수 있습니다.")


class HttpError(Exception):
    def __init__(self, status, message, code=""):
        super().__init__(message)
        self.status, self.message, self.code = status, message, code


class Reply:
    def __init__(self, status=200, body=None, location=None):
        self.status, self.body, self.location = status, body if body is not None else {}, location


def _int(q, name, default, lo, hi):
    try:
        return min(max(int(q.get(name, default)), lo), hi)
    except (TypeError, ValueError):
        raise HttpError(400, "%s 값은 숫자여야 합니다." % name)


def _bool(body, name):
    v = body.get(name)
    if v is not None and not isinstance(v, bool):
        raise HttpError(400, "%s 값은 true/false여야 합니다." % name)
    return v


def _strs(body, name):
    v = body.get(name, [])
    if not isinstance(v, list) or not all(isinstance(x, str) and x.strip() for x in v):
        raise HttpError(400, "%s 값은 문자열 목록이어야 합니다." % name)
    return [x.strip()[:40] for x in v]


def allowed_origins():
    """브라우저에서 API를 부를 수 있는 웹 주소. localhost와 127.0.0.1은 같은 PC로 보고 함께 허용한다."""
    env = os.getenv("MDCV_CORS_ORIGINS")
    if env:
        return {o.strip().rstrip("/") for o in env.split(",") if o.strip()}
    web = providers.web_url()
    host = urlparse(web).hostname
    twin = {"localhost": "127.0.0.1", "127.0.0.1": "localhost"}.get(host)
    return {web} | ({web.replace(host, twin)} if twin else set())


class Api:
    def __init__(self, store, service):
        self.store, self.service = store, service
        self.token = os.getenv("MDCV_API_TOKEN", "")
        r = self._route
        self.routes = [
            r("GET", r"/health", self.health, public=True),
            r("POST", r"/api/demo/seed", self.seed),
            r("GET", r"/api/messages", self.messages),
            r("GET", r"/api/messages/([^/]+)", self.message),
            r("PATCH", r"/api/messages/([^/]+)", self.update_message),
            r("POST", r"/api/messages/([^/]+)/classify", self.classify),
            r("POST", r"/api/messages/([^/]+)/adjust", self.adjust),
            r("POST", r"/api/messages/([^/]+)/correct", self.correct),
            r("POST", r"/api/messages/([^/]+)/reply-draft", self.reply_draft),
            r("POST", r"/api/messages/([^/]+)/send-reply", self.send_reply),
            r("GET", r"/api/settings", self.get_settings),
            r("POST", r"/api/settings", self.save_settings),
            r("GET", r"/api/dashboard", self.dashboard),
            r("POST", r"/api/backup", self.make_backup),
            r("GET", r"/api/digests/([a-z]+)", self.digest),
            r("GET", r"/api/stats", self.stats),
            r("POST", r"/api/reclassify", self.reclassify_all),
            r("GET", r"/api/todos", self.todos),
            r("GET", r"/api/rules", self.rules),
            r("POST", r"/api/rules", self.add_rule),
            r("DELETE", r"/api/rules/(\d+)", self.delete_rule),
            r("GET", r"/api/accounts", self.accounts),
            r("GET", r"/api/accounts/diagnose", self.diagnose),
            r("GET", r"/api/accounts/connect/([a-z]+)", self.connect),
            r("GET", r"/api/accounts/callback/([a-z]+)", self.callback, public=True),  # 제공자가 브라우저를 돌려보내는 주소
            r("POST", r"/api/accounts/(\d+)/sync", self.sync),
            r("DELETE", r"/api/accounts/(\d+)", self.disconnect),
            r("POST", r"/api/notify/test", self.notify_test),
        ]

    @staticmethod
    def _route(method, pattern, fn, public=False):
        return method, re.compile("^" + pattern + "$"), fn, public

    # --- 진입점 ---
    def handle(self, method, path, query=None, payload=None, authorization=""):
        start = time.perf_counter()
        path = path.rstrip("/") or "/"
        try:
            reply = self._dispatch(method, path, query or {}, payload or {}, authorization)
        except HttpError as e:
            reply = Reply(e.status, {"error": e.message, "code": e.code})
        except providers.ProviderError as e:
            status = {"unknown_provider": 400, "invalid_state": 400, "account_not_found": 404, "sync_busy": 409}.get(e.code, 502)
            reply = Reply(status, {"error": e.korean(), "code": e.code})
        except Exception:
            log.exception("처리 중 오류: %s %s", method, path)
            reply = Reply(500, {"error": "서버 내부 오류입니다. 로그를 확인하세요."})
        if path != "/health":
            log.info("%s %s %d %.0fms", method, path, reply.status, (time.perf_counter() - start) * 1000)
        return reply

    def _dispatch(self, method, path, query, payload, authorization):
        known = False
        for m, rx, fn, public in self.routes:
            hit = rx.match(path)
            if not hit:
                continue
            known = True
            if m != method:
                continue
            if self.token and not public and not self._authorized(authorization):
                raise HttpError(401, "접속 토큰이 필요합니다.", "auth")
            if not isinstance(payload, dict):
                raise HttpError(400, "요청 본문은 JSON 객체여야 합니다.")
            out = fn(*hit.groups(), q=query, body=payload)
            return out if isinstance(out, Reply) else Reply(200, out)
        raise HttpError(405 if known else 404, "허용되지 않는 요청입니다." if known else "찾을 수 없습니다.")

    def _authorized(self, header):
        return header.startswith("Bearer ") and hmac.compare_digest(header[7:].encode(), self.token.encode())

    def _message_or_404(self, mid):
        m = self.store.get_message(mid)
        if not m:
            raise HttpError(404, "메일을 찾을 수 없습니다.")
        return m

    # --- 상태 ---
    def health(self, q, body):
        s = self.store.stats()
        return {"status": "ok", "service": "mdcv-api", "version": VERSION, "llmEnabled": self.service.llm.enabled,
                "authRequired": bool(self.token), "messages": s["total"], "accounts": len(self.store.list_accounts())}

    def stats(self, q, body):
        out = self.store.stats()
        out["llm"] = self.service.llm.stats() if hasattr(self.service, "llm") else {}
        out["sendEnabled"] = providers.send_enabled()
        return out

    def dashboard(self, q, body):
        out = self.store.dashboard(days=_int(q, "days", 14, 1, 90))
        out["stats"] = self.stats(q, body)
        out["accounts"] = self.accounts(q, body)["items"]
        return out

    def make_backup(self, q, body):
        """DB 스냅샷을 DB 옆 backups 폴더에 만든다. 토큰 암호화 키(mdcv.key)도 함께 보관해야 복구된다."""
        if self.store.path == ":memory:":
            raise HttpError(400, "파일 DB가 아니어서 백업할 수 없습니다.")
        folder = os.path.join(os.path.dirname(os.path.abspath(self.store.path)), "backups")
        os.makedirs(folder, exist_ok=True)
        name = "mdcv-%s.db" % datetime.now().strftime("%Y%m%d-%H%M%S")
        self.store.backup(os.path.join(folder, name))
        self.store.audit("backup", {"file": name})
        return {"ok": True, "file": name, "size": os.path.getsize(os.path.join(folder, name)),
                "note": "복구 시 이 파일과 mdcv.key를 함께 보관하세요."}

    def get_settings(self, q, body):
        s = self.store.get_settings()
        return {"syncMinutes": int(s.get("syncMinutes", os.getenv("MDCV_SYNC_MINUTES", "10")))}

    def save_settings(self, q, body):
        minutes = body.get("syncMinutes")
        if not isinstance(minutes, int) or not 0 <= minutes <= 1440:
            raise HttpError(400, "syncMinutes는 0~1440 사이 정수여야 합니다(0=자동 동기화 끔).")
        self.store.update_settings({"syncMinutes": minutes})
        self.store.audit("settings_save", {"syncMinutes": minutes})
        return {"syncMinutes": minutes}

    def send_reply(self, mid, q, body):
        """답장 실제 발송. confirm=true가 없으면 거부한다(자동 발송 금지 원칙)."""
        if not providers.send_enabled():
            raise HttpError(403, "발송 기능이 꺼져 있습니다. 관리자가 MDCV_ENABLE_SEND=1 로 켜고 계정을 다시 연결해야 합니다.", "send_disabled")
        if body.get("confirm") is not True:
            raise HttpError(400, "발송 확인(confirm)이 필요합니다. 자동 발송은 하지 않습니다.", "confirm_required")
        mail = self._message_or_404(mid)
        subject = str(body.get("subject") or "").strip()
        text = str(body.get("body") or "").strip()
        if not subject or not text:
            raise HttpError(400, "제목과 본문을 입력하세요.")
        acct = self.store.get_account(mail.get("accountId") or 0) if mail.get("accountId") else None
        if not acct or acct["provider"] not in ("graph", "gmail"):
            raise HttpError(400, "연결된 메일 계정이 없는 메일이라 발송할 수 없습니다(데모 메일 등).", "no_account")
        token = providers.valid_access_token(self.store, acct)
        result = providers.send_mail(acct["provider"], token, mail["senderEmail"], subject, text)
        self.store.audit("reply_send", {"message": mid, "to": mail["senderEmail"], "provider": acct["provider"]})
        self.store.log_notification(mid, "mail-send", "sent", acct["provider"])
        return {"ok": True, **result}

    def reclassify_all(self, q, body):
        n = self.service.reclassify_all()
        self.store.audit("reclassify_all", {"count": n})
        return {"count": n}

    def todos(self, q, body):
        """처리 전(open) 회신 필요 메일의 할 일. 기한이 급한 순, 같으면 중요도순."""
        items = []
        for m in self.store.list_messages(reply=True, status="open", limit=500)[0]:
            lv = m["classification"]["importance"]["level"]
            items += [{"text": a["text"], "due": a.get("due"), "dueIso": a.get("dueIso"), "mailId": m["id"], "subject": m["subject"],
                       "sender": m["senderName"], "level": lv} for a in m["classification"]["actionItems"]]
        items.sort(key=lambda t: (t["dueIso"] or "9999", LEVELS.index(t["level"])))  # resolved due time, then level
        return {"items": items, "now": datetime.now().isoformat(timespec="minutes")}

    # --- 메일 ---
    def seed(self, q, body):
        return {"inserted": sum(1 for r in self.service.ingest_many(sample_mails()) if r["isNew"])}

    def messages(self, q, body):
        folder = q.get("folder", "")
        importance = q.get("importance", "")
        if importance and importance not in LEVELS:
            raise HttpError(400, "importance는 %s 중 하나여야 합니다." % ", ".join(LEVELS))
        items, total = self.store.list_messages(
            q=q.get("q", "").strip(), importance=importance, equipment=q.get("equipment", ""),
            limit=_int(q, "limit", 50, 1, 200), offset=_int(q, "offset", 0, 0, 10 ** 7),
            reply=folder == "reply", status="open" if folder == "reply" else q.get("status", ""),
            unread=q.get("unread") == "1")
        return {"items": items, "total": total}

    def message(self, mid, q, body):
        return self._message_or_404(mid)

    def update_message(self, mid, q, body):
        status = body.get("status")
        if status not in (None, "open", "done"):
            raise HttpError(400, "status는 open 또는 done이어야 합니다.")
        self._message_or_404(mid)
        self.store.update_message(mid, is_read=_bool(body, "isRead"), status=status)
        return self.store.get_message(mid)

    def classify(self, mid, q, body):
        self._message_or_404(mid)
        return self.service.reclassify(mid, use_llm=body.get("useLlm", True) is not False)

    def adjust(self, mid, q, body):
        self._message_or_404(mid)
        level = body.get("level")
        if level is not None and level != "" and level not in LEVELS:
            raise HttpError(400, "level은 %s 중 하나여야 합니다." % ", ".join(LEVELS))
        cls = self.service.adjust(mid, level=level, equipment_add=_strs(body, "equipmentAdd"),
                                  equipment_remove=_strs(body, "equipmentRemove"), clear=bool(body.get("clear")))
        self.store.audit("adjust", {"message": mid})
        return cls

    def correct(self, mid, q, body):
        self._message_or_404(mid)
        return self.service.correct(mid)

    def reply_draft(self, mid, q, body):
        self._message_or_404(mid)
        return self.service.reply_draft(mid)

    def digest(self, period, q, body):
        if period not in ("morning", "afternoon", "daily", "weekly", "monthly", "yearly"):
            raise HttpError(404, "알 수 없는 기간입니다.")
        now = datetime.now()
        # Load only the mails the period can contain (the old code loaded a whole year for every digest).
        since = period_start(period, now).strftime("%Y-%m-%dT%H:%M")
        return build_digest(self.store.list_messages(limit=20000, since=since)[0], period, now)

    # --- 규칙·알림 ---
    def rules(self, q, body):
        return {"items": self.store.rules()}

    def add_rule(self, q, body):
        kind, pattern = body.get("ruleType", "keyword"), str(body.get("pattern", "")).strip()
        if kind not in ("vip_sender", "equipment", "keyword"):
            raise HttpError(400, "ruleType은 vip_sender, equipment, keyword 중 하나여야 합니다.")
        if not pattern:
            raise HttpError(400, "대상을 입력하세요.")
        try:
            weight = int(body.get("weight", 0))
        except (TypeError, ValueError):
            raise HttpError(400, "가중치는 숫자여야 합니다.")
        self.store.add_rule(kind, pattern[:100], max(-50, min(50, weight)))
        self.service._classifier()
        return {"ok": True, "items": self.store.rules()}

    def delete_rule(self, rid, q, body):
        if not self.store.delete_rule(int(rid)):
            raise HttpError(404, "규칙을 찾을 수 없습니다.")
        self.service._classifier()
        return {"ok": True, "items": self.store.rules()}

    def notify_test(self, q, body):
        channel = body.get("channel", "teams")
        if channel not in ("teams", "kakao"):
            raise HttpError(400, "channel은 teams 또는 kakao여야 합니다.")
        return (notify.notify_teams if channel == "teams" else notify.notify_kakao)(str(body.get("text") or "[MDCV] 알림 테스트입니다."))

    # --- 계정 ---
    def accounts(self, q, body):
        items = []
        for a in self.store.list_accounts():
            exp = a.get("token_expires_at") or ""
            left = None
            try:
                left = (datetime.fromisoformat(exp.replace("Z", "+00:00")) - datetime.now(datetime.fromisoformat(exp.replace("Z", "+00:00")).tzinfo)).days if exp else None
            except Exception:
                left = None
            items.append({**a, "tokenExpiresAt": exp, "tokenDaysLeft": left,
                          "tokenExpiringSoon": left is not None and left < 7,
                          "tokenExpired": left is not None and left < 0})
        return {"items": items}

    def diagnose(self, q, body):
        return providers.diagnose(self.store)

    def connect(self, provider, q, body):
        return oauth_service.start_connect(self.store, provider)

    def callback(self, provider, q, body):
        web = providers.web_url()
        if q.get("error"):
            return Reply(302, location="%s/?connectError=%s&provider=%s" % (web, quote(providers.translate_error(q["error"], provider)), provider))
        try:
            aid = oauth_service.handle_callback(self.store, provider, q.get("code", ""), q.get("state", ""))
            return Reply(302, location="%s/?connected=%s&account=%d" % (web, provider, aid))
        except providers.ProviderError as e:
            return Reply(302, location="%s/?connectError=%s&provider=%s" % (web, quote(e.korean(provider)), provider))

    def sync(self, aid, q, body):
        return oauth_service.sync_account(self.store, self.service, int(aid))

    def disconnect(self, aid, q, body):
        if not self.store.delete_account(int(aid)):
            raise HttpError(404, "계정을 찾을 수 없습니다.")
        self.store.audit("account_disconnect", {"accountId": int(aid)})
        return {"ok": True, "message": "계정 연결이 해제되고 메일 데이터가 삭제됐습니다."}
