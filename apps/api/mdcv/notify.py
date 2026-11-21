"""알림 어댑터: Teams 웹훅, 카카오 나에게 보내기, 웹푸시(로그형 MVP)."""
import json
import os
import urllib.request


def _post_json(url, payload, headers=None):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers=dict({"Content-Type": "application/json"}, **(headers or {})))
    with urllib.request.urlopen(req, timeout=15) as res:
        return res.status, res.read().decode()[:300]


def notify_teams(text, webhook=None):
    url = webhook or os.getenv("MDCV_TEAMS_WEBHOOK", "")
    if not url:
        return {"channel": "teams", "status": "skipped", "detail": "MDCV_TEAMS_WEBHOOK 미설정"}
    try:
        code, _ = _post_json(url, {"text": text})
        return {"channel": "teams", "status": "sent" if code < 300 else "failed", "detail": str(code)}
    except Exception as e:  # 네트워크 오류를 서비스 중단으로 전파하지 않음
        return {"channel": "teams", "status": "failed", "detail": str(e)[:200]}


def notify_kakao(text, access_token=None):
    """카카오 '나에게 보내기'. 팀 전파용 알림톡은 사업자 채널이 필요해 Phase 4 범위."""
    token = access_token or os.getenv("MDCV_KAKAO_TOKEN", "")
    if not token:
        return {"channel": "kakao", "status": "skipped", "detail": "MDCV_KAKAO_TOKEN 미설정(나에게 보내기 토큰 필요)"}
    try:
        template = json.dumps({"object_type": "text", "text": text[:1000],
                               "link": {"web_url": os.getenv("MDCV_WEB_URL", "http://localhost:3000")}})
        import urllib.parse
        req = urllib.request.Request("https://kapi.kakao.com/v2/api/talk/memo/default/send",
                                     data=urllib.parse.urlencode({"template_object": template}).encode(),
                                     headers={"Authorization": "Bearer " + token})
        with urllib.request.urlopen(req, timeout=15) as res:
            return {"channel": "kakao", "status": "sent" if res.status < 300 else "failed", "detail": str(res.status)}
    except Exception as e:
        return {"channel": "kakao", "status": "failed", "detail": str(e)[:200]}


def notify_all(store, mail, classification):
    """긴급/중요 메일만 알림. 결과는 notification_logs에 기록."""
    if classification["importance"]["level"] not in ("urgent", "important"):
        return []
    text = "[MDCV %s] %s\n발신: %s\n요약: %s" % (
        classification["importance"]["level"], mail.get("subject", ""), mail.get("senderName", ""),
        classification.get("summary", "")[:200])
    results = [notify_teams(text), notify_kakao(text),
               {"channel": "webpush", "status": "skipped", "detail": "브라우저 구독 정보 없음(MVP 로그형)"}]
    for r in results:
        store.log_notification(mail.get("id", ""), r["channel"], r["status"], r["detail"])
    return results
