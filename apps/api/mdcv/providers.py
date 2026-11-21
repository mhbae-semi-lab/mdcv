"""메일 제공자 연동: Microsoft Graph / Gmail OAuth + 토큰 생명주기 + 동기화.

보안 원칙: 토큰은 서버에만 보관(암호화), 브라우저에 노출하지 않는다.
state/PKCE로 인증 요청을 검증하고, 만료 시 refresh token으로 자동 갱신한다.
"""
import base64
import hashlib
import html
import json
import os
import re
import secrets
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

from .crypto import decrypt, encrypt

GRAPH = {"auth": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
         "token": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
         "api": "https://graph.microsoft.com/v1.0",
         "scope": "openid profile Mail.Read offline_access", "sendScope": "Mail.Send"}
GMAIL = {"auth": "https://accounts.google.com/o/oauth2/v2/auth",
         "token": "https://oauth2.googleapis.com/token",
         "api": "https://gmail.googleapis.com/gmail/v1/users/me",
         "scope": "openid email https://www.googleapis.com/auth/gmail.readonly", "sendScope": "https://www.googleapis.com/auth/gmail.send"}


def send_enabled():
    """Reply sending is off unless the operator sets MDCV_ENABLE_SEND=1; only then is the send permission requested."""
    return os.getenv("MDCV_ENABLE_SEND", "") == "1"


def scope_for(base):
    return base["scope"] + (" " + base["sendScope"] if send_enabled() else "")

ERROR_KO = {
    "invalid_client": "Client ID/Secret이 올바르지 않습니다. .env 값을 확인하세요 (Azure/Google에서 복사한 '값'인지 확인).",
    "redirect_uri_mismatch": "리디렉션 URI가 등록된 값과 다릅니다. http://localhost:8000/api/accounts/callback/{provider} 로 등록했는지 확인하세요.",
    "AADSTS50011": "리디렉션 URI가 Azure 앱 등록과 일치하지 않습니다.",
    "access_blocked": "Google 테스트 사용자에 본인 계정이 등록되지 않았습니다. OAuth 동의 화면에서 테스트 사용자를 추가하세요.",
    "invalid_grant": "인증 코드가 만료됐거나 이미 사용됐습니다. 연동을 처음부터 다시 시도하세요.",
    "interaction_required": "다시 로그인이 필요합니다. 계정을 다시 연결하세요.",
}


class ProviderError(Exception):
    def __init__(self, code, detail=""):
        self.code = str(code)
        self.detail = str(detail)[:300]
        super().__init__(self.code + ": " + self.detail)

    def korean(self, provider=""):
        if self.code in ("invalid_state", "unknown_provider", "account_not_found", "sync_busy") and self.detail:
            return self.detail
        for key, msg in ERROR_KO.items():
            if key in self.code or key in self.detail:
                return msg.replace("{provider}", provider)
        return "제공자 요청 실패(%s). 잠시 후 다시 시도하거나 설정을 확인하세요." % self.code


def translate_error(text, provider=""):
    for key, msg in ERROR_KO.items():
        if key in str(text):
            return msg.replace("{provider}", provider)
    return str(text)[:200]


def cfg(provider):
    p = provider.upper()
    return {"clientId": os.getenv("MDCV_%s_CLIENT_ID" % p, ""),
            "clientSecret": os.getenv("MDCV_%s_CLIENT_SECRET" % p, "")}


def api_base():
    return os.getenv("MDCV_API_BASE", "http://localhost:8000").rstrip("/")


def web_url():
    return os.getenv("MDCV_WEB_URL", "http://localhost:3000").rstrip("/")


def redirect_uri(provider):
    return "%s/api/accounts/callback/%s" % (api_base(), provider)


_crypt, _decrypt = encrypt, decrypt


# 진행 중 인증 요청 (state -> PKCE verifier). 단일 사용자 로컬 앱 기준 인메모리 보관.
_PENDING = {}


def begin_auth(provider):
    """state와 PKCE 쌍을 발급하고 인증 URL을 만든다. 설정이 없으면 사유를 함께 알린다."""
    conf, base = cfg(provider), GRAPH if provider == "graph" else GMAIL
    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    for k in [k for k, v in _PENDING.items() if datetime.now(timezone.utc) - v["created"] > timedelta(minutes=10)]:
        del _PENDING[k]  # 끝내지 않은 인증 요청 정리
    _PENDING[state] = {"provider": provider, "verifier": verifier, "created": datetime.now(timezone.utc)}
    params = {"client_id": conf["clientId"], "response_type": "code", "redirect_uri": redirect_uri(provider),
              "response_mode": "query", "scope": scope_for(base), "state": state,
              "code_challenge": challenge, "code_challenge_method": "S256",
              "access_type": "offline", "prompt": "consent"}
    return {"provider": provider, "authUrl": base["auth"] + "?" + urllib.parse.urlencode(params),
            "configured": bool(conf["clientId"] and conf["clientSecret"]),
            "redirectUri": redirect_uri(provider)}


def pop_pending(state):
    item = _PENDING.pop(state or "", None)
    if not item:
        raise ProviderError("invalid_state", "인증 요청(state)이 없거나 만료됐습니다. 연동을 다시 시작하세요.")
    if datetime.now(timezone.utc) - item["created"] > timedelta(minutes=10):
        raise ProviderError("invalid_state", "인증 요청이 10분을 초과했습니다. 다시 시도하세요.")
    return item


def _request(req):
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        try:
            data = json.loads(body)
            code = data.get("error", {}).get("code") or data.get("error") or e.code
            detail = data.get("error", {}).get("message") or data.get("error_description") or body
        except Exception:
            code, detail = e.code, body
        raise ProviderError(code, detail)
    except Exception as e:
        raise ProviderError("network", e)


def _post_form(url, form):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode(),
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    return _request(req)


def _get(url, token):
    return _request(urllib.request.Request(url, headers={"Authorization": "Bearer " + token}))


def _pack(tokens):
    expires = datetime.now(timezone.utc) + timedelta(seconds=int(tokens.get("expires_in", 3600)))
    return {"accessTokenEnc": _crypt(tokens.get("access_token", "")),
            "refreshTokenEnc": _crypt(tokens.get("refresh_token", "")),
            "expiresAt": expires.isoformat()}


def exchange_code(provider, code, verifier=""):
    conf, base = cfg(provider), GRAPH if provider == "graph" else GMAIL
    form = {"client_id": conf["clientId"], "client_secret": conf["clientSecret"], "code": code,
            "redirect_uri": redirect_uri(provider), "grant_type": "authorization_code"}
    if provider == "gmail" and verifier:
        form["code_verifier"] = verifier
    if provider == "graph" and verifier:  # Graph 공용 클라이언트 흐름에서도 PKCE 허용
        form["code_verifier"] = verifier
    return _pack(_post_form(base["token"], form))


def refresh_tokens(provider, refresh_token_enc):
    conf, base = cfg(provider), GRAPH if provider == "graph" else GMAIL
    form = {"client_id": conf["clientId"], "client_secret": conf["clientSecret"],
            "refresh_token": _decrypt(refresh_token_enc), "grant_type": "refresh_token"}
    if provider == "graph":
        form["scope"] = scope_for(GRAPH)
    tokens = _pack(_post_form(base["token"], form))
    if not tokens["refreshTokenEnc"]:  # 갱신 응답에 refresh가 없으면 기존 것 유지
        tokens["refreshTokenEnc"] = refresh_token_enc
    return tokens


def valid_access_token(store, account):
    """만료 60초 전이면 refresh로 갱신해 저장까지 마친 access token을 돌려준다."""
    expires = account.get("token_expires_at") or ""
    try:
        left = (datetime.fromisoformat(expires) - datetime.now(timezone.utc)).total_seconds()
    except Exception:
        left = 0
    if left > 60 and account.get("access_token_enc"):
        return _decrypt(account["access_token_enc"])
    if not account.get("refresh_token_enc"):
        raise ProviderError("interaction_required", "refresh token이 없습니다. 다시 연결하세요.")
    tokens = refresh_tokens(account["provider"], account["refresh_token_enc"])
    store.update_tokens(account["id"], tokens)
    return _decrypt(tokens["accessTokenEnc"])


def fetch_profile(provider, access_token):
    if provider == "graph":
        me = _get(GRAPH["api"] + "/me", access_token)
        return me.get("mail") or me.get("userPrincipalName") or ""
    prof = _get(GMAIL["api"] + "/profile", access_token)
    return prof.get("emailAddress") or ""


def _post_json(url, token, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    return _request(req)


def send_mail(provider, access_token, to, subject, body):
    """답장 발송. Mail.Send/gmail.send 권한이 없으면 제공자 오류가 그대로 올라간다."""
    if provider == "graph":
        _post_json(GRAPH["api"] + "/me/sendMail", access_token,
                   {"message": {"subject": subject, "body": {"contentType": "Text", "content": body},
                                "toRecipients": [{"emailAddress": {"address": to}}]}, "saveToSentItems": True})
        return {"sent": True, "provider": "graph"}
    raw = ("To: %s\r\nSubject: %s\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s" % (to, subject, body)).encode()
    _post_json(GMAIL["api"] + "/messages/send", access_token,
               {"raw": base64.urlsafe_b64encode(raw).decode()})
    return {"sent": True, "provider": "gmail"}


def fetch_graph_attachment_text(access_token, message_id):
    from . import attachments as att
    try:
        data = _get("%s/me/messages/%s/attachments?$select=name,contentBytes" % (GRAPH["api"], message_id), access_token)
    except Exception:
        return ""
    texts = []
    for a in data.get("value", []):
        raw = a.get("contentBytes")
        if not raw or a.get("@odata.type", "").endswith("itemAttachment"):
            continue
        try:
            text = att.extract(a.get("name", ""), base64.b64decode(raw))
        except Exception:
            text = ""
        if text:
            texts.append("[첨부: %s]\n%s" % (a.get("name", ""), text))
    return "\n\n".join(texts)


def _gmail_attachment_parts(payload, out=None):
    out = out if out is not None else []
    body = (payload or {}).get("body") or {}
    if body.get("attachmentId"):
        out.append((payload.get("filename", ""), body["attachmentId"]))
    for part in (payload or {}).get("parts", []):
        _gmail_attachment_parts(part, out)
    return out


def fetch_gmail_attachment_text(access_token, detail):
    from . import attachments as att
    texts = []
    for name, att_id in _gmail_attachment_parts(detail.get("payload", {})):
        try:
            data = _get("%s/messages/%s/attachments/%s" % (GMAIL["api"], detail["id"], att_id), access_token)
            text = att.extract(name, base64.urlsafe_b64decode(data.get("data", "") + "=="))
        except Exception:
            text = ""
        if text:
            texts.append("[첨부: %s]\n%s" % (name, text))
    return "\n\n".join(texts)


def _strip_html(text):
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", text or "")
    text = re.sub(r"(?s)<br\s*/?>|</p>", "\n", text)
    return html.unescape(re.sub(r"(?s)<[^>]+>", " ", text)).strip()


def normalize_graph(msg):
    sender = (msg.get("from") or {}).get("emailAddress") or {}
    body = (msg.get("body") or {}).get("content") or msg.get("bodyPreview") or ""
    if (msg.get("body") or {}).get("contentType") == "html":
        body = _strip_html(body)
    return {"id": "graph-" + msg["id"], "provider": "graph", "providerMessageId": msg["id"],
            "subject": msg.get("subject") or "", "senderName": sender.get("name", ""), "senderEmail": sender.get("address", ""),
            "recipients": [r["emailAddress"]["address"] for r in msg.get("toRecipients", [])],
            "receivedAt": msg.get("receivedDateTime", ""), "bodyText": body,
            "isRead": bool(msg.get("isRead")), "hasAttachment": bool(msg.get("hasAttachments"))}


def _gmail_body(payload):
    """payload 트리에서 text/plain을 우선해 base64 디코딩한다."""
    plain, html_part = [], []

    def walk(part):
        mime, data = part.get("mimeType", ""), (part.get("body") or {}).get("data")
        if data:
            try:
                decoded = base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode(errors="replace")
            except Exception:
                decoded = ""
            (plain if mime == "text/plain" else html_part).append(decoded)
        for sub in part.get("parts", []):
            walk(sub)

    walk(payload or {})
    if plain:
        return "\n".join(plain).strip()
    return _strip_html("\n".join(html_part)) if html_part else ""


def _gmail_has_attachment(payload):
    if (payload or {}).get("filename"):
        return True
    return any(_gmail_has_attachment(p) for p in (payload or {}).get("parts", []))


def normalize_gmail(msg, detail):
    payload = detail.get("payload", {})
    headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
    try:
        received = parsedate_to_datetime(headers.get("date", "")).isoformat()
    except Exception:
        received = headers.get("date", "")
    sender = headers.get("from", "")
    m = re.match(r'\s*"?([^"<]+)"?\s*<([^>]+)>', sender)
    body = _gmail_body(payload) or detail.get("snippet", "")
    return {"id": "gmail-" + msg["id"], "provider": "gmail", "providerMessageId": msg["id"],
            "subject": headers.get("subject", ""), "senderName": (m.group(1).strip() if m else sender),
            "senderEmail": (m.group(2) if m else sender),
            "recipients": [headers.get("to", "")], "receivedAt": received,
            "bodyText": body, "isRead": "UNREAD" not in detail.get("labelIds", []),
            "hasAttachment": _gmail_has_attachment(payload)}


def diagnose(store=None):
    """제공자별 설정 상태를 항목별로 알려준다 (비밀값 자체는 노출하지 않음)."""
    accounts = store.list_accounts() if store else []
    out = {}
    for provider in ("graph", "gmail"):
        conf = cfg(provider)
        connected = [a for a in accounts if a["provider"] == provider]
        checks = [
            {"key": "clientId", "label": "Client ID 설정", "ok": bool(conf["clientId"]),
             "hint": ".env의 MDCV_%s_CLIENT_ID 입력" % provider.upper()},
            {"key": "clientSecret", "label": "Client Secret 설정", "ok": bool(conf["clientSecret"]),
             "hint": ".env의 MDCV_%s_CLIENT_SECRET 입력" % provider.upper()},
            {"key": "redirect", "label": "리디렉션 URI", "ok": True, "hint": redirect_uri(provider)},
            {"key": "account", "label": "계정 연결", "ok": bool(connected),
             "hint": connected[0]["account_email"] if connected else "아직 연결된 계정 없음"},
        ]
        out[provider] = {"configured": all(c["ok"] for c in checks[:2]), "checks": checks,
                         "accounts": connected, "guide": "docs/oauth-setup-guide.md"}
    return out


def _enrich_graph(access_token, msg):
    mail = normalize_graph(msg)
    if mail["hasAttachment"]:
        extra = fetch_graph_attachment_text(access_token, msg["id"])
        if extra:
            mail["bodyText"] = (mail["bodyText"] + "\n\n" + extra).strip()
    return mail


def sync_graph(access_token, top=50, known=()):
    """받은편지함 최신 top건. 같은 메일을 다시 받아도 저장소가 중복을 걸러낸다."""
    url = GRAPH["api"] + ("/me/mailFolders/inbox/messages?$select=id,subject,from,toRecipients,receivedDateTime,body,bodyPreview,isRead,hasAttachments"
                          "&$top=%d&$orderby=receivedDateTime%%20desc" % top)
    return [_enrich_graph(access_token, m) for m in _get(url, access_token).get("value", []) if m["id"] not in known]


def _enrich_gmail(access_token, msg):
    detail = _get("%s/messages/%s?format=full" % (GMAIL["api"], msg["id"]), access_token)
    mail = normalize_gmail(msg, detail)
    if mail["hasAttachment"]:
        extra = fetch_gmail_attachment_text(access_token, detail)
        if extra:
            mail["bodyText"] = (mail["bodyText"] + "\n\n" + extra).strip()
    return mail


def sync_gmail(access_token, top=50, known=()):
    """INBOX 최신 top건. 이미 저장된 메일은 상세 조회를 건너뛰어 호출 수를 줄인다."""
    data = _get(GMAIL["api"] + "/messages?labelIds=INBOX&maxResults=%d" % top, access_token)
    return [_enrich_gmail(access_token, m)
            for m in data.get("messages", []) if m["id"] not in known]
