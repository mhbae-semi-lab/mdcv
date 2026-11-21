import json
import json
import os
import sys
import unittest
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "apps", "api"))
from mdcv.classifier import RuleClassifier
from mdcv.dates import parse_dates, period_bucket
from mdcv.masking import mask_pii
from mdcv.validator import correct_text, check_consistency, make_reply_draft
from mdcv.digest import build_digest
from mdcv.store import Store
from mdcv.service import MailService
from plant_samples import NOW as SAMPLE_NOW, SAMPLE_MAILS
from mdcv import providers, oauth_service
from mdcv.api import Api, allowed_origins
from unittest import mock
import base64 as _b64


class TestDates(unittest.TestCase):
    def test_korean_dates(self):
        base = datetime(2026, 10, 23, 9, 0)  # 금요일
        dates = parse_dates("내일까지 제출 바랍니다. 다음 주 월요일 회의가 있습니다. 11월 5일 점검 예정입니다.", base)
        raws = [d["raw"] for d in dates]
        self.assertIn("내일", raws)
        self.assertTrue(any("월요일" in r for r in raws))
        self.assertTrue(any(d["kind"] == "deadline" for d in dates))

    def test_period(self):
        self.assertEqual(period_bucket("2026-10-23T09:00:00"), "morning")
        self.assertEqual(period_bucket("2026-10-23T15:00:00"), "afternoon")


class TestMasking(unittest.TestCase):
    def test_mask(self):
        out = mask_pii("연락처 010-1234-5678, 메일 a@b.com")
        self.assertNotIn("010-1234-5678", out)
        self.assertNotIn("a@b.com", out)


class TestClassifier(unittest.TestCase):
    def setUp(self):
        self.c = RuleClassifier(vip_senders=["boss@example.com"])

    def test_urgent_equipment(self):
        r = self.c.classify(SAMPLE_MAILS[0])
        self.assertEqual(r["importance"]["level"], "urgent")
        self.assertIn("PU-101", r["entities"]["equipment"])
        self.assertTrue(r["needsReply"])

    def test_equipment_anomaly_is_not_missed(self):
        r = self.c.classify(SAMPLE_MAILS[7])  # 변압기 절연유 수분 기준치 초과 + 교체 협의
        self.assertIn(r["importance"]["level"], ("important", "urgent"))
        self.assertTrue(any("이상 징후" in x for x in r["importance"]["reasons"]))
        ok = self.c.classify(SAMPLE_MAILS[6])  # AHU 필터 교체 완료, 정상화 보고
        self.assertNotIn(ok["importance"]["level"], ("important", "urgent"))

    def test_ad_is_reference(self):
        r = self.c.classify(SAMPLE_MAILS[4])
        self.assertEqual(r["importance"]["level"], "reference")

    def test_vip_boost(self):
        mail = {"id": "x", "subject": "보고서 제출", "senderName": "상사", "senderEmail": "boss@example.com",
                "receivedAt": "2026-10-23T09:00:00", "bodyText": "오늘까지 제출 바랍니다. 회신 부탁드립니다."}
        self.assertIn(self.c.classify(mail)["importance"]["level"], ("important", "urgent"))

    def test_schema_keys(self):
        r = self.c.classify(SAMPLE_MAILS[1])
        for k in ("messageId", "importance", "period", "entities", "summary", "actionItems", "needsReply", "confidence", "engine"):
            self.assertIn(k, r)


class TestValidator(unittest.TestCase):
    def test_spelling(self):
        r = correct_text("확인부탁드립니다. 있슴니다.")
        self.assertIn("확인 부탁", r["corrected"])
        self.assertIn("있습니다", r["corrected"])
        self.assertTrue(r["issues"])

    def test_consistency_deadlines(self):
        issues = check_consistency("내일까지 제출하고 모레까지도 제출합니다.",
                                   {"dates": [{"raw": "내일", "iso": "2026-10-24T18:00", "kind": "deadline"},
                                              {"raw": "모레", "iso": "2026-10-25T18:00", "kind": "deadline"}]})
        self.assertTrue(any(i["type"] == "consistency" for i in issues))

    def test_reply_draft_no_autosend(self):
        cls = RuleClassifier().classify(SAMPLE_MAILS[0])
        d = make_reply_draft(SAMPLE_MAILS[0], cls)
        self.assertIn("자동 발송되지 않습니다", d["note"])
        self.assertTrue(d["draft"])


class TestServiceStoreDigest(unittest.TestCase):
    def test_ingest_and_digest(self):
        svc = MailService(Store(":memory:"))
        svc.ingest_many(SAMPLE_MAILS)
        mails, total = svc.store.list_messages(limit=100)
        self.assertEqual(total, 8)
        d = build_digest(mails, "weekly", now=SAMPLE_NOW)
        self.assertEqual(d["total"], 8)
        self.assertIn("headline", d)

    def test_user_rule(self):
        store = Store(":memory:")
        svc = MailService(store)
        store.add_rule("vip_sender", "kim@example.com", 30)
        svc._classifier()
        r = svc.classifier.classify(SAMPLE_MAILS[7])
        self.assertGreaterEqual(r["importance"]["score"], 40)


class TestProviders(unittest.TestCase):
    def test_auth_urls(self):
        self.assertIn("login.microsoftonline.com", providers.begin_auth("graph")["authUrl"])
        self.assertIn("accounts.google.com", providers.begin_auth("gmail")["authUrl"])

    def test_normalize_graph(self):
        m = providers.normalize_graph({"id": "1", "subject": "제목", "receivedDateTime": "2026-10-23T09:00:00Z",
                                       "from": {"emailAddress": {"name": "김", "address": "a@b.com"}},
                                       "toRecipients": [], "bodyPreview": "본문", "isRead": False, "hasAttachments": False})
        self.assertEqual(m["provider"], "graph")
        self.assertEqual(m["subject"], "제목")


class TestOAuthFlow(unittest.TestCase):
    def test_crypt_roundtrip(self):
        self.assertEqual(providers._decrypt(providers._crypt("secret-token")), "secret-token")
        self.assertEqual(providers._decrypt(""), "")

    def test_crypt_is_authenticated_and_random(self):
        a, b = providers._crypt("same"), providers._crypt("same")
        self.assertNotEqual(a, b)  # nonce가 매번 다르다
        self.assertTrue(a.startswith("v3:"))  # AES-256-GCM
        raw = bytearray(_b64.b64decode(a[3:]))
        raw[20] ^= 1  # 한 비트만 바꿔도 거부해야 한다
        with self.assertRaises(ValueError):
            providers._decrypt("v3:" + _b64.b64encode(bytes(raw)).decode())

    def test_old_tokens_and_plain_bodies_are_migrated(self):
        import hashlib
        import sqlite3
        import tempfile
        key = hashlib.sha256(b"mdcv-local-secret").digest()
        legacy = _b64.b64encode(bytes(b ^ key[i % len(key)] for i, b in enumerate(b"old-token"))).decode()
        path = os.path.join(tempfile.mkdtemp(), "old.db")
        with mock.patch.dict("os.environ", {"MDCV_SECRET": "mdcv-local-secret"}):
            Store(path).db.close()
            raw = sqlite3.connect(path)
            raw.execute("INSERT INTO messages(id,provider,provider_message_id,subject,body_text) VALUES ('m1','demo','m1','s','INSP-03 점검 부탁드립니다')")
            raw.execute("INSERT INTO mail_accounts(provider,account_email,access_token_enc,refresh_token_enc) VALUES ('graph','a@example.com',?,'')", (legacy,))
            raw.commit(); raw.close()
            store = Store(path)
            row = store.db.execute("SELECT body_text FROM messages WHERE id='m1'").fetchone()[0]
            self.assertTrue(row.startswith("v3:"))  # 본문이 암호화되어 저장됨
            self.assertEqual(store.get_message("m1")["bodyText"], "INSP-03 점검 부탁드립니다")
            self.assertEqual(store.list_messages(q="점검")[1], 1)  # 암호화된 본문도 검색됨
            tok = store.db.execute("SELECT access_token_enc FROM mail_accounts").fetchone()[0]
            self.assertTrue(tok.startswith("v3:"))
            self.assertEqual(providers._decrypt(tok), "old-token")

    def test_legacy_xor_still_readable(self):
        import hashlib
        key = hashlib.sha256(b"mdcv-local-secret").digest()
        legacy = _b64.b64encode(bytes(b ^ key[i % len(key)] for i, b in enumerate(b"old-token"))).decode()
        with mock.patch.dict("os.environ", {"MDCV_SECRET": "mdcv-local-secret"}):
            self.assertEqual(providers._decrypt(legacy), "old-token")

    def test_pkce_and_state(self):
        begun = providers.begin_auth("gmail")
        self.assertIn("code_challenge=", begun["authUrl"])
        state = begun["authUrl"].split("state=")[1].split("&")[0]
        pending = providers.pop_pending(state)
        self.assertEqual(pending["provider"], "gmail")
        with self.assertRaises(providers.ProviderError):
            providers.pop_pending(state)  # 재사용 불가

    def test_error_translation(self):
        self.assertIn("Client ID/Secret", providers.ProviderError("invalid_client").korean("graph"))
        self.assertIn("테스트 사용자", providers.translate_error("access_blocked"))

    def test_diagnose_unconfigured(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            d = providers.diagnose(Store(":memory:"))
        self.assertFalse(d["graph"]["configured"])
        self.assertFalse(d["graph"]["checks"][0]["ok"])

    def test_gmail_body_and_date(self):
        body = _b64.urlsafe_b64encode("실제 본문입니다. 내일까지 회신 부탁드립니다.".encode()).decode()
        detail = {"payload": {"headers": [
            {"name": "Subject", "value": "본문 테스트"}, {"name": "From", "value": "김담당 <kim@x.com>"},
            {"name": "Date", "value": "Fri, 23 Oct 2026 09:00:00 +0900"}, {"name": "To", "value": "me@x.com"}],
            "mimeType": "multipart/mixed", "parts": [
                {"mimeType": "text/plain", "body": {"data": body}},
                {"mimeType": "application/pdf", "filename": "a.pdf", "body": {}}]}, "labelIds": ["UNREAD"]}
        m = providers.normalize_gmail({"id": "1"}, detail)
        self.assertIn("실제 본문", m["bodyText"])
        self.assertTrue(m["receivedAt"].startswith("2026-10-23"))
        self.assertEqual(m["senderEmail"], "kim@x.com")
        self.assertTrue(m["hasAttachment"])

    def test_graph_html_body(self):
        m = providers.normalize_graph({"id": "2", "subject": "제목", "receivedDateTime": "2026-10-23T09:00:00Z",
                                       "from": {"emailAddress": {"name": "김", "address": "a@b.com"}}, "toRecipients": [],
                                       "body": {"contentType": "html", "content": "<p>안녕<br>본문</p>"}, "isRead": True, "hasAttachments": False})
        self.assertIn("본문", m["bodyText"])
        self.assertNotIn("<p>", m["bodyText"])

    def test_callback_and_sync_with_mocks(self):
        store = Store(":memory:")
        svc = MailService(store)
        begun = providers.begin_auth("gmail")
        state = begun["authUrl"].split("state=")[1].split("&")[0]
        fake_tokens = {"accessTokenEnc": providers._crypt("at"), "refreshTokenEnc": providers._crypt("rt"),
                       "expiresAt": "2999-01-01T00:00:00+00:00"}
        mail = {"id": "gmail-9", "provider": "gmail", "providerMessageId": "9", "subject": "[긴급] 동기화 메일",
                "senderName": "김", "senderEmail": "a@b.com", "recipients": [], "receivedAt": "2026-10-23T09:00:00+09:00",
                "bodyText": "내일까지 회신 부탁드립니다. 즉시 확인 바랍니다.", "isRead": False, "hasAttachment": False}
        calls = []
        with mock.patch.object(providers, "exchange_code", return_value=fake_tokens), \
             mock.patch.object(providers, "fetch_profile", return_value="me@gmail.com"), \
             mock.patch("mdcv.notify.notify_all", side_effect=lambda *a: calls.append(a) or []), \
             mock.patch.object(providers, "sync_gmail", return_value=[mail]) as fetch:
            aid = oauth_service.handle_callback(store, "gmail", "code123", state)
            self.assertEqual(store.get_account(aid)["account_email"], "me@gmail.com")
            first = oauth_service.sync_account(store, svc, aid)
            self.assertEqual(fetch.call_args.kwargs["top"], 100)  # 첫 동기화는 넉넉히
            self.assertEqual(calls, [])  # 첫 동기화는 알림 폭주를 막기 위해 알리지 않는다
            self.assertEqual(first["new"], 1)
            self.assertEqual(store.list_messages()[1], 1)
            self.assertTrue(store.get_account(aid)["last_sync_at"])
            # 재동기화: 이미 아는 메일 ID를 넘겨 상세 조회를 생략하고, 같은 메일이 와도 중복·재알림 없음
            self.assertEqual(oauth_service.sync_account(store, svc, aid)["new"], 0)
            self.assertEqual(fetch.call_args.kwargs["known"], {"9"})
            self.assertEqual(fetch.call_args.kwargs["top"], 50)
            self.assertEqual(calls, [])
            # 새 메일은 두 번째부터 알린다
            fetch.return_value = [dict(mail, id="gmail-10", providerMessageId="10")]
            self.assertEqual(oauth_service.sync_account(store, svc, aid)["new"], 1)
            self.assertEqual(len(calls), 1)
        self.assertTrue(store.delete_account(aid))
        self.assertEqual(store.list_messages()[1], 0)

    def test_sync_failure_is_recorded(self):
        store = Store(":memory:")
        aid = store.add_account("gmail", "me@gmail.com", {"accessTokenEnc": providers._crypt("at"), "refreshTokenEnc": "",
                                                          "expiresAt": "2999-01-01T00:00:00+00:00"})
        with mock.patch.object(providers, "sync_gmail", side_effect=providers.ProviderError("invalid_grant", "x")):
            with self.assertRaises(providers.ProviderError):
                oauth_service.sync_account(store, MailService(store), aid)
        self.assertIn("만료", store.list_accounts()[0]["last_error"])
        with mock.patch.object(providers, "sync_gmail", return_value=[]):
            oauth_service.sync_account(store, MailService(store), aid)
        self.assertEqual(store.list_accounts()[0]["last_error"], "")  # 성공하면 오류 표시가 지워진다


class TestWorkflow(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.svc = MailService(self.store)
        self.svc.ingest_many(SAMPLE_MAILS)

    def test_sql_filters_and_paging(self):
        items, total = self.store.list_messages(equipment="PU-101")
        self.assertEqual((total, items[0]["id"]), (1, "demo-001"))
        self.assertEqual(self.store.list_messages(q="안전 교육")[1], 1)
        self.assertEqual(self.store.list_messages(q="%")[1], 0)  # LIKE 와일드카드는 글자 그대로 검색
        self.assertEqual(self.store.list_messages(importance="urgent")[1], 1)
        page1, total = self.store.list_messages(limit=3)
        page2, _ = self.store.list_messages(limit=3, offset=3)
        self.assertEqual((len(page1), total), (3, 8))
        self.assertFalse({m["id"] for m in page1} & {m["id"] for m in page2})

    def test_read_and_done_state_persist(self):
        self.assertTrue(self.store.update_message("demo-001", is_read=True, status="done"))
        m = self.store.get_message("demo-001")
        self.assertTrue(m["isRead"])
        self.assertEqual(m["status"], "done")
        reply_open = self.store.list_messages(reply=True, status="open")[1]
        self.assertEqual(reply_open, self.store.stats()["needsReply"])
        self.assertEqual(self.store.stats()["done"], 1)
        self.assertEqual(self.store.stats()["unread"], 5)
        self.assertEqual(self.store.stats()["providers"], {"demo": 8})

    def test_override_survives_reclassify(self):
        cls = self.svc.adjust("demo-005", level="urgent", equipment_add=["보일러"])
        self.assertEqual(cls["importance"]["level"], "urgent")
        self.assertTrue(cls["importance"]["overridden"])
        self.assertIn("보일러", cls["entities"]["equipment"])
        again = self.svc.reclassify("demo-005", use_llm=False)  # 재분류해도 사용자 지정 유지
        self.assertEqual(again["importance"]["level"], "urgent")
        self.assertEqual(self.store.list_messages(importance="urgent")[1], 2)
        self.assertEqual(self.store.list_messages(equipment="보일러")[1], 2)
        cleared = self.svc.adjust("demo-005", level="", equipment_remove=["보일러"], clear=True)
        self.assertEqual(cleared["importance"]["level"], "reference")
        with self.assertRaises(ValueError):
            self.svc.adjust("demo-005", level="bogus")

    def test_reingest_keeps_override_and_does_not_realert(self):
        self.svc.adjust("demo-001", level="reference")
        with mock.patch("mdcv.notify.notify_all", return_value=[]) as n:
            r = self.svc.ingest(SAMPLE_MAILS[0], do_notify=True)
        self.assertFalse(r["isNew"])
        n.assert_not_called()
        self.assertEqual(self.store.get_message("demo-001")["classification"]["importance"]["level"], "reference")

    def test_reclassify_all_applies_new_rules_and_keeps_override(self):
        self.svc.adjust("demo-001", level="reference")
        self.store.add_rule("keyword", "프로모션", 80)  # 광고 메일을 중요로 끌어올리는 규칙
        self.assertEqual(self.store.get_message("demo-005")["classification"]["importance"]["level"], "reference")
        with mock.patch("mdcv.notify.notify_all") as n:
            self.assertEqual(self.svc.reclassify_all(), 8)
        n.assert_not_called()
        self.assertNotEqual(self.store.get_message("demo-005")["classification"]["importance"]["level"], "reference")
        self.assertEqual(self.store.get_message("demo-001")["classification"]["importance"]["level"], "reference")  # 사용자 지정 유지

    def test_delete_account_keeps_other_mail(self):
        aid = self.store.add_account("gmail", "a@b.com", {})
        self.store.upsert_message(dict(SAMPLE_MAILS[0], id="gmail-1", provider="gmail", providerMessageId="1", accountId=aid))
        self.assertTrue(self.store.delete_account(aid))
        self.assertEqual(self.store.list_messages()[1], 8)  # 데모 메일은 남는다

    def test_backup_and_migration(self):
        import sqlite3
        import tempfile
        d = tempfile.mkdtemp()
        path = os.path.join(d, "old.db")
        old = sqlite3.connect(path)  # 이전 버전 스키마(새 컬럼 없음)
        old.executescript("CREATE TABLE messages(id TEXT PRIMARY KEY, account_id INTEGER, provider TEXT, provider_message_id TEXT, subject TEXT, sender_name TEXT, sender_email TEXT, recipients_json TEXT, received_at TEXT, body_text TEXT, is_read INTEGER, has_attachment INTEGER, thread_id TEXT);"
                          "CREATE TABLE classifications(message_id TEXT PRIMARY KEY, level TEXT, score INTEGER, data_json TEXT, created_at TEXT);"
                          "INSERT INTO messages VALUES('m1',0,'demo','m1','제목','a','a@b.c','[]','2026-10-23T09:00:00','본문',0,0,'');"
                          "INSERT INTO classifications VALUES('m1','urgent',90,'{\"needsReply\":true,\"entities\":{\"equipment\":[\"PU-101\"]}}','');")
        old.commit()
        old.close()
        store = Store(path)
        self.assertEqual(store.list_messages(equipment="PU-101")[1], 1)  # 기존 데이터의 필터 컬럼이 채워진다
        self.assertEqual(store.list_messages(reply=True)[1], 1)
        out = os.path.join(d, "copy.db")
        store.backup(out)
        self.assertEqual(Store(out).list_messages()[1], 1)


class TestApi(unittest.TestCase):
    def setUp(self):
        self.store = Store(":memory:")
        self.svc = MailService(self.store)
        self.svc.ingest_many(SAMPLE_MAILS)
        self.api = Api(self.store, self.svc)

    def call(self, method, path, query=None, body=None, auth=""):
        r = self.api.handle(method, path, query or {}, body or {}, auth)
        return r.status, r.body

    def test_basic_routes(self):
        self.assertEqual(self.call("GET", "/health")[1]["messages"], 8)
        status, body = self.call("GET", "/api/messages", {"folder": "reply", "limit": "2"})
        self.assertEqual((status, len(body["items"])), (200, 2))
        self.assertEqual(self.call("GET", "/api/messages/nope")[0], 404)
        self.assertEqual(self.call("GET", "/api/unknown")[0], 404)
        self.assertEqual(self.call("DELETE", "/api/messages/demo-001")[0], 405)

    def test_validation(self):
        self.assertEqual(self.call("GET", "/api/messages", {"limit": "abc"})[0], 400)
        self.assertEqual(self.call("GET", "/api/messages", {"importance": "x"})[0], 400)
        self.assertEqual(self.call("PATCH", "/api/messages/demo-001", body={"status": "x"})[0], 400)
        self.assertEqual(self.call("PATCH", "/api/messages/demo-001", body={"isRead": "yes"})[0], 400)
        self.assertEqual(self.call("POST", "/api/rules", body={"ruleType": "keyword", "pattern": "  "})[0], 400)
        self.assertEqual(self.call("POST", "/api/messages/demo-001/adjust", body={"level": "x"})[0], 400)
        self.assertEqual(self.call("GET", "/api/accounts/connect/yahoo")[0], 400)
        self.assertEqual(self.call("POST", "/api/rules", body=[1])[0], 400)

    def test_workflow_endpoints(self):
        status, m = self.call("PATCH", "/api/messages/demo-001", body={"isRead": True, "status": "done"})
        self.assertEqual((status, m["status"], m["isRead"]), (200, "done", True))
        self.assertEqual(self.call("GET", "/api/stats")[1]["done"], 1)
        status, cls = self.call("POST", "/api/messages/demo-005/adjust", body={"level": "important", "equipmentAdd": ["AHU"]})
        self.assertEqual((status, cls["importance"]["level"]), (200, "important"))
        status, rules = self.call("POST", "/api/rules", body={"ruleType": "keyword", "pattern": "안전", "weight": 999})
        self.assertEqual(rules["items"][0]["weight"], 50)  # 가중치 상한
        self.assertEqual(self.call("DELETE", "/api/rules/%d" % rules["items"][0]["id"])[1]["items"], [])

    def test_token_auth(self):
        with mock.patch.dict("os.environ", {"MDCV_API_TOKEN": "s3cret"}):
            api = Api(self.store, self.svc)
        status = lambda auth, path="/api/messages": api.handle("GET", path, {}, {}, auth).status
        self.assertEqual(status(""), 401)
        self.assertEqual(status("Bearer wrong"), 401)
        self.assertEqual(status("Bearer s3cret"), 200)
        self.assertEqual(status("", "/health"), 200)  # 상태 확인과 OAuth 콜백은 토큰 없이 접근
        self.assertEqual(api.handle("GET", "/api/accounts/callback/gmail", {"error": "access_denied"}, {}, "").status, 302)

    def test_internal_error_is_hidden(self):
        with mock.patch.object(self.store, "stats", side_effect=RuntimeError("boom secret")):
            status, body = self.call("GET", "/api/stats")
        self.assertEqual(status, 500)
        self.assertNotIn("boom", body["error"])

    def test_cors_allows_localhost_twin(self):
        with mock.patch.dict("os.environ", {"MDCV_WEB_URL": "http://localhost:3000"}):
            os.environ.pop("MDCV_CORS_ORIGINS", None)
            self.assertEqual(allowed_origins(), {"http://localhost:3000", "http://127.0.0.1:3000"})


class TestOps(unittest.TestCase):
    def test_env_loader(self):
        import tempfile
        from mdcv.env import load_env
        path = os.path.join(tempfile.mkdtemp(), ".env")
        with open(path, "w", encoding="utf-8") as f:
            f.write("# 주석\nT_A=hello\nT_B=\nT_C='quoted value'\nT_KEEP=new\n")
        with mock.patch.dict("os.environ", {"T_KEEP": "old"}):
            self.assertEqual(load_env(path), 2)
            self.assertEqual((os.environ["T_A"], os.environ["T_C"], os.environ["T_KEEP"]), ("hello", "quoted value", "old"))
            self.assertNotIn("T_B", os.environ)  # 빈 값은 미설정으로 취급
            for k in ("T_A", "T_C"):
                os.environ.pop(k)
        self.assertEqual(load_env(os.path.join(tempfile.gettempdir(), "no-such.env")), 0)

    def test_key_file_is_created_when_secret_missing(self):
        import tempfile
        from mdcv import crypto
        keyfile = os.path.join(tempfile.mkdtemp(), "mdcv.key")
        with mock.patch.dict("os.environ", {"MDCV_SECRET": "", "MDCV_KEY_FILE": keyfile}):
            token = crypto.encrypt("abc")
            self.assertTrue(os.path.exists(keyfile))
            self.assertEqual(crypto.decrypt(token), "abc")
        with mock.patch.dict("os.environ", {"MDCV_SECRET": "다른 비밀값", "MDCV_KEY_FILE": keyfile}):
            with self.assertRaises(ValueError):  # 키가 바뀌면 복호화하지 않고 재연결을 안내
                crypto.decrypt(token)

    def test_scheduler_can_be_disabled(self):
        from mdcv import scheduler
        store = Store(":memory:")
        store.update_settings({"syncMinutes": 0})
        self.assertEqual(scheduler._minutes(store), 0)  # 0이면 루프가 동기화를 건너뜀

    def test_settings_roundtrip(self):
        store = Store(":memory:")
        api = Api(store, MailService(store))
        self.assertEqual(api.handle("POST", "/api/settings", {}, {"syncMinutes": 30}, "").body, {"syncMinutes": 30})
        self.assertEqual(api.handle("GET", "/api/settings", {}, {}, "").body["syncMinutes"], 30)
        self.assertEqual(api.handle("POST", "/api/settings", {}, {"syncMinutes": 9999}, "").status, 400)

    def test_attachment_extract(self):
        import io, zipfile
        from mdcv import attachments
        self.assertIn("안녕", attachments.extract("a.txt", "안녕 본문".encode()))
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>점검 결과 정상</w:t></w:r></w:p></w:document>')
        self.assertIn("점검 결과 정상", attachments.extract("r.docx", buf.getvalue()))
        self.assertEqual(attachments.extract("x.exe", b"MZ"), "")

    def test_send_reply_requires_confirm_and_account(self):
        store = Store(":memory:")
        svc = MailService(store)
        svc.ingest_many(SAMPLE_MAILS[:1])
        api = Api(store, svc)
        mid = SAMPLE_MAILS[0]["id"]
        r = api.handle("POST", "/api/messages/%s/send-reply" % mid, {}, {"subject": "Re", "body": "확인", "confirm": True}, "")
        self.assertEqual(r.status, 403)  # 발송 기능은 기본으로 꺼져 있다
        self.assertNotIn("Mail.Send", providers.scope_for(providers.GRAPH))
        with mock.patch.dict("os.environ", {"MDCV_ENABLE_SEND": "1"}):
            self.assertIn("Mail.Send", providers.scope_for(providers.GRAPH))
            r = api.handle("POST", "/api/messages/%s/send-reply" % mid, {}, {"subject": "Re", "body": "확인"}, "")
            self.assertEqual(r.status, 400)  # confirm 없음
            r = api.handle("POST", "/api/messages/%s/send-reply" % mid, {}, {"subject": "Re", "body": "확인", "confirm": True}, "")
            self.assertEqual(r.status, 400)  # 데모 메일은 발송 계정 없음

    def test_dashboard_and_backup(self):
        import tempfile
        store = Store(os.path.join(tempfile.mkdtemp(), "t.db"))
        svc = MailService(store)
        svc.ingest_many(SAMPLE_MAILS[:2])
        api = Api(store, svc)
        d = api.handle("GET", "/api/dashboard", {"days": "14"}, {}, "").body
        self.assertIn("daily", d); self.assertIn("llm", d["stats"])
        r = api.handle("POST", "/api/backup", {}, {}, "")
        self.assertEqual(r.status, 200); self.assertTrue(r.body["file"].endswith(".db"))

    def test_llm_cost_caps(self):
        from mdcv.llm import LLMAdapter
        with mock.patch.dict("os.environ", {"MDCV_LLM_DAILY_LIMIT": "1"}):
            a = LLMAdapter()
        a.usage = {"date": "x", "calls": 1, "chars": 0, "blocked": 0}
        from datetime import date
        a.usage["date"] = date.today().isoformat()
        self.assertFalse(a._budget_ok())

    def test_llm_answer_is_validated_before_use(self):
        from mdcv.llm import LLMAdapter, validate_answer
        mail = {"subject": "INSP-03 결과 요청", "bodyText": "내일까지 보내 주세요", "receivedAt": "2026-11-18T09:00:00"}
        good = {"level": "important", "score": 60, "needsReply": True, "reasons": ["내일까지"], "equipment": ["INSP-03"],
                "actionItems": [{"text": "결과 전달", "due": "내일까지"}], "summary": "결과 요청"}
        self.assertEqual(validate_answer(good, mail), [])
        bad = dict(good, level="critical", score=140, equipment=["CMP-9"])
        errs = " | ".join(validate_answer(bad, mail))
        self.assertIn("허용 목록", errs)
        self.assertIn("CMP-9", errs)
        rule = RuleClassifier().classify(mail)
        a = LLMAdapter(provider="anthropic", api_key="test")
        with mock.patch.object(a, "_call", return_value=json.dumps(bad)):
            self.assertEqual(a.enhance(mail, rule)["engine"], "rule")  # 검증 실패 -> 규칙 결과 유지
        with mock.patch.object(a, "_call", return_value=json.dumps(good)) as call:
            out = a.enhance(dict(mail, senderName="한도윤", bodyText="한도윤입니다. 내일까지 보내 주세요"), rule)
            self.assertNotIn("한도윤", call.call_args[0][0])  # 이름은 가린 뒤 전송
        self.assertEqual(a.usage["invalid"], 1)

    def test_digest_loads_only_the_period(self):
        from datetime import datetime
        from mdcv.digest import period_start
        now = datetime(2026, 11, 18, 15, 0)
        self.assertEqual(period_start("daily", now), datetime(2026, 11, 18))
        self.assertEqual(period_start("monthly", now), datetime(2026, 11, 1))
        self.assertEqual(period_start("afternoon", now), datetime(2026, 11, 18, 12))

    def test_todos_sorted_by_due(self):
        store = Store(":memory:")
        svc = MailService(store)
        svc.ingest_many(SAMPLE_MAILS)
        items = Api(store, svc).handle("GET", "/api/todos", {}, {}, "").body["items"]
        dues = [t["dueIso"] or "9999" for t in items]
        self.assertTrue(items and all(t["mailId"] for t in items))
        self.assertEqual(dues, sorted(dues))  # 날짜로 바꾼 기한순 (지난 기한이 맨 앞)
        store.update_message("demo-001", status="done")  # 완료한 메일의 할 일은 빠진다
        after = Api(store, svc).handle("GET", "/api/todos", {}, {}, "").body["items"]
        self.assertFalse(any(t["mailId"] == "demo-001" for t in after))


if __name__ == "__main__":
    unittest.main()
