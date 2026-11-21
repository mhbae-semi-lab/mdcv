"""SQLite 저장소. 운영 시 PostgreSQL로 교체 가능한 얇은 계층.

- 연결 하나를 여러 스레드(HTTP·동기화 스케줄러)가 쓰므로 모든 공개 메서드는 잠금으로 직렬화한다.
- 필터링용 값(level, needs_reply, equipment)은 별도 컬럼에 두어 SQL에서 거른다(JSON 함수 비의존).
"""
import functools
import json
import os
import sqlite3
import threading

from . import crypto

LEVELS = ("urgent", "important", "normal", "reference")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE, display_name TEXT, settings_json TEXT DEFAULT '{}', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS mail_accounts(id INTEGER PRIMARY KEY, user_id INTEGER, provider TEXT, account_email TEXT, access_token_enc TEXT, refresh_token_enc TEXT, sync_cursor TEXT, consent_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, account_id INTEGER, provider TEXT, provider_message_id TEXT, subject TEXT, sender_name TEXT, sender_email TEXT, recipients_json TEXT DEFAULT '[]', received_at TEXT, body_text TEXT, is_read INTEGER DEFAULT 0, has_attachment INTEGER DEFAULT 0, thread_id TEXT, UNIQUE(provider, provider_message_id));
CREATE TABLE IF NOT EXISTS classifications(message_id TEXT PRIMARY KEY, level TEXT, score INTEGER, data_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS user_rules(id INTEGER PRIMARY KEY, user_id INTEGER DEFAULT 1, rule_type TEXT, pattern TEXT, weight INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notification_logs(id INTEGER PRIMARY KEY, message_id TEXT, channel TEXT, status TEXT, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY, user_id INTEGER DEFAULT 1, action TEXT, detail_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
"""

# (테이블, 컬럼, 정의): 기존 DB에는 ALTER로 추가한다.
MIGRATIONS = (
    ("mail_accounts", "token_expires_at", "TEXT"),
    ("mail_accounts", "last_sync_at", "TEXT"),
    ("mail_accounts", "last_error", "TEXT DEFAULT ''"),
    ("messages", "status", "TEXT DEFAULT 'open'"),
    ("classifications", "needs_reply", "INTEGER DEFAULT 0"),
    ("classifications", "equipment", "TEXT DEFAULT ''"),
    ("classifications", "override_json", "TEXT DEFAULT ''"),
)
INDEXES = (
    "CREATE INDEX IF NOT EXISTS ix_messages_received ON messages(received_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_messages_account ON messages(account_id)",
    "CREATE INDEX IF NOT EXISTS ix_messages_unread ON messages(is_read, status)",
    "CREATE INDEX IF NOT EXISTS ix_cls_level ON classifications(level)",
)


def _locked(fn):
    @functools.wraps(fn)
    def wrap(self, *a, **kw):
        with self._lock:
            return fn(self, *a, **kw)
    return wrap


def _like(text):
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def apply_override(cls, ov):
    """사용자가 지정한 중요도·설비 수정을 분류 결과에 덮어쓴다."""
    if not ov:
        return cls
    imp, ent = cls["importance"], cls["entities"]
    level = ov.get("level")
    if level in LEVELS:
        if level != imp["level"]:
            imp["autoLevel"] = imp["level"]
            imp["level"] = level
            imp["reasons"] = ["사용자가 직접 지정"] + [r for r in imp["reasons"] if r != "사용자가 직접 지정"]
        imp["overridden"] = True
    remove = set(ov.get("equipmentRemove", []))
    eq = [e for e in ent["equipment"] if e not in remove]
    eq += [e for e in ov.get("equipmentAdd", []) if e not in eq]
    ent["equipment"] = eq
    return cls


class Store:
    def __init__(self, path=None):
        self.path = path or os.getenv("MDCV_DB", os.path.join(os.path.dirname(__file__), "..", "mdcv.db"))
        self._lock = threading.RLock()
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA busy_timeout=5000")
        self.db.execute("PRAGMA journal_mode=WAL")  # 읽기·쓰기 동시성. :memory:에서는 무시된다.
        self.db.executescript(SCHEMA)
        # Mail bodies are stored encrypted; search decrypts them inside SQLite through this function.
        # ponytail: a search decrypts every body (fine for one person's mailbox); add an encrypted index if it grows large
        self.db.create_function("mdcv_body", 1, lambda v: crypto.decrypt(v).lower() if v and v[:3] in ("v3:", "v2:") else (v or "").lower())
        self._migrate()
        self._migrate_secrets()

    def _migrate(self):
        backfill = False
        for table, col, ddl in MIGRATIONS:
            cols = {r[1] for r in self.db.execute("PRAGMA table_info(%s)" % table).fetchall()}
            if col not in cols:
                self.db.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table, col, ddl))
                backfill = backfill or (table, col) == ("classifications", "needs_reply")
        if backfill:  # 이전 버전 DB: 필터용 컬럼을 기존 분류 결과에서 채운다
            self._backfill_filter_columns()
        for ddl in INDEXES:
            self.db.execute(ddl)
        self.db.commit()

    def _migrate_secrets(self):
        """Encrypts plaintext bodies and re-encrypts v1/v2 tokens as AES-GCM (v3), once."""
        changed = 0
        for r in self.db.execute("SELECT id, body_text FROM messages WHERE body_text<>'' AND body_text NOT LIKE 'v3:%'").fetchall():
            body = r["body_text"]
            self.db.execute("UPDATE messages SET body_text=? WHERE id=?", (crypto.encrypt(crypto.decrypt(body) if body.startswith("v2:") else body), r["id"]))
            changed += 1
        for r in self.db.execute("SELECT id, access_token_enc, refresh_token_enc FROM mail_accounts").fetchall():
            new = [crypto.migrate_value(r["access_token_enc"] or ""), crypto.migrate_value(r["refresh_token_enc"] or "")]
            if any(new):
                self.db.execute("UPDATE mail_accounts SET access_token_enc=COALESCE(?,access_token_enc), refresh_token_enc=COALESCE(?,refresh_token_enc) WHERE id=?",
                                (new[0], new[1], r["id"]))
                changed += 1
        if changed:
            self.db.execute("INSERT INTO audit_logs(action,detail_json) VALUES ('migrate_encryption',?)", (json.dumps({"rows": changed}),))
        self.db.commit()

    def _backfill_filter_columns(self):
        for r in self.db.execute("SELECT message_id, data_json FROM classifications").fetchall():
            cls = json.loads(r["data_json"] or "{}")
            self.db.execute("UPDATE classifications SET needs_reply=?, equipment=? WHERE message_id=?",
                            (1 if cls.get("needsReply") else 0, self._eq_text(cls), r["message_id"]))

    @staticmethod
    def _eq_text(cls):
        eq = cls.get("entities", {}).get("equipment", [])
        return "|" + "|".join(eq) + "|" if eq else ""

    # --- 메일 ---
    @_locked
    def upsert_message(self, m):
        cur = self.db.execute(
            "INSERT OR IGNORE INTO messages(id,account_id,provider,provider_message_id,subject,sender_name,sender_email,recipients_json,received_at,body_text,is_read,has_attachment,thread_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (m["id"], m.get("accountId", 0), m.get("provider", "demo"), m.get("providerMessageId", m["id"]),
             m.get("subject", ""), m.get("senderName", ""), m.get("senderEmail", ""),
             json.dumps(m.get("recipients", []), ensure_ascii=False), m.get("receivedAt", ""),
             crypto.encrypt(m.get("bodyText", "")), 1 if m.get("isRead") else 0, 1 if m.get("hasAttachment") else 0, m.get("threadId", "")))
        self.db.commit()
        return cur.rowcount > 0

    @_locked
    def known_provider_ids(self, provider):
        return {r[0] for r in self.db.execute("SELECT provider_message_id FROM messages WHERE provider=?", (provider,))}

    @_locked
    def save_classification(self, cls):
        old = self.db.execute("SELECT override_json FROM classifications WHERE message_id=?", (cls["messageId"],)).fetchone()
        ov = json.loads(old["override_json"]) if old and old["override_json"] else {}
        apply_override(cls, ov)
        self.db.execute(
            "INSERT OR REPLACE INTO classifications(message_id,level,score,data_json,needs_reply,equipment,override_json) VALUES (?,?,?,?,?,?,?)",
            (cls["messageId"], cls["importance"]["level"], cls["importance"]["score"], json.dumps(cls, ensure_ascii=False),
             1 if cls.get("needsReply") else 0, self._eq_text(cls), json.dumps(ov, ensure_ascii=False) if ov else ""))
        self.db.commit()

    @_locked
    def set_override(self, mid, ov):
        """override 저장. 반영은 서비스가 재분류하며 한다(빈 dict면 해제)."""
        if not self.db.execute("SELECT 1 FROM messages WHERE id=?", (mid,)).fetchone():
            return False
        if self.db.execute("SELECT 1 FROM classifications WHERE message_id=?", (mid,)).fetchone():
            self.db.execute("UPDATE classifications SET override_json=? WHERE message_id=?",
                            (json.dumps(ov, ensure_ascii=False) if ov else "", mid))
        else:
            self.db.execute("INSERT INTO classifications(message_id,override_json) VALUES (?,?)",
                            (mid, json.dumps(ov, ensure_ascii=False) if ov else ""))
        self.db.commit()
        return True

    @_locked
    def get_override(self, mid):
        r = self.db.execute("SELECT override_json FROM classifications WHERE message_id=?", (mid,)).fetchone()
        return json.loads(r["override_json"]) if r and r["override_json"] else {}

    @_locked
    def update_message(self, mid, is_read=None, status=None):
        sets, args = [], []
        if is_read is not None:
            sets.append("is_read=?"); args.append(1 if is_read else 0)
        if status in ("open", "done"):
            sets.append("status=?"); args.append(status)
        if not sets:
            return False
        cur = self.db.execute("UPDATE messages SET %s WHERE id=?" % ",".join(sets), args + [mid])
        self.db.commit()
        return cur.rowcount > 0

    @_locked
    def list_messages(self, q="", importance="", equipment="", limit=50, offset=0, reply=False, status="", unread=False, since=""):
        where, args = ["1=1"], []
        if q:
            like = _like(q.lower())
            where.append("(LOWER(m.subject) LIKE ? ESCAPE '\\' OR mdcv_body(m.body_text) LIKE ? ESCAPE '\\' OR LOWER(m.sender_name) LIKE ? ESCAPE '\\' OR LOWER(m.sender_email) LIKE ? ESCAPE '\\' OR LOWER(c.equipment) LIKE ? ESCAPE '\\')")
            args += [like] * 5
        if importance:
            where.append("c.level=?"); args.append(importance)
        if equipment:
            where.append("c.equipment LIKE ? ESCAPE '\\'"); args.append(_like("|" + equipment + "|"))
        if reply:
            where.append("c.needs_reply=1")
        if status:
            where.append("m.status=?"); args.append(status)
        if unread:
            where.append("m.is_read=0")
        if since:
            where.append("m.received_at>=?"); args.append(since)
        sql = " FROM messages m LEFT JOIN classifications c ON c.message_id=m.id WHERE " + " AND ".join(where)
        total = self.db.execute("SELECT COUNT(*)" + sql, args).fetchone()[0]
        rows = self.db.execute("SELECT m.*, c.data_json" + sql + " ORDER BY m.received_at DESC, m.id LIMIT ? OFFSET ?",
                               args + [int(limit), int(offset)]).fetchall()
        return [self._row(r) for r in rows], total

    @_locked
    def get_message(self, mid):
        r = self.db.execute("SELECT m.*, c.data_json FROM messages m LEFT JOIN classifications c ON c.message_id=m.id WHERE m.id=?", (mid,)).fetchone()
        return self._row(r) if r else None

    @_locked
    def stats(self):
        q = self.db.execute
        by_level = {(r[0] or "unknown"): r[1] for r in q("SELECT c.level, COUNT(*) FROM messages m LEFT JOIN classifications c ON c.message_id=m.id GROUP BY c.level")}
        by_eq = {}
        for r in q("SELECT c.equipment FROM classifications c JOIN messages m ON m.id=c.message_id WHERE c.equipment<>''"):
            for e in filter(None, r[0].split("|")):
                by_eq[e] = by_eq.get(e, 0) + 1
        one = lambda sql: q(sql).fetchone()[0]
        return {"total": one("SELECT COUNT(*) FROM messages"), "byImportance": by_level, "byEquipment": by_eq,
                "needsReply": one("SELECT COUNT(*) FROM messages m JOIN classifications c ON c.message_id=m.id WHERE c.needs_reply=1 AND m.status='open'"),
                "unread": one("SELECT COUNT(*) FROM messages WHERE is_read=0"),
                "unreadUrgent": one("SELECT COUNT(*) FROM messages m JOIN classifications c ON c.message_id=m.id WHERE m.is_read=0 AND c.level='urgent'"),
                "done": one("SELECT COUNT(*) FROM messages WHERE status='done'"),
                "providers": {r[0]: r[1] for r in q("SELECT provider, COUNT(*) FROM messages GROUP BY provider")}}

    @staticmethod
    def _row(r):
        item = {"id": r["id"], "provider": r["provider"], "accountId": r["account_id"] or 0, "subject": r["subject"] or "",
                "senderName": r["sender_name"] or "", "senderEmail": r["sender_email"] or "",
                "recipients": json.loads(r["recipients_json"] or "[]"), "receivedAt": r["received_at"] or "",
                "bodyText": crypto.decrypt(r["body_text"] or ""), "isRead": bool(r["is_read"]), "hasAttachment": bool(r["has_attachment"]),
                "status": r["status"] or "open"}
        if r["data_json"]:
            item["classification"] = json.loads(r["data_json"])
        return item

    # --- 계정 ---
    @_locked
    def add_account(self, provider, email, tokens):
        row = self.db.execute("SELECT id FROM mail_accounts WHERE provider=? AND account_email=? AND account_email<>''",
                              (provider, email)).fetchone() if email else None
        if row:
            self.update_tokens(row["id"], tokens)
            return row["id"]
        cur = self.db.execute("INSERT INTO mail_accounts(user_id,provider,account_email,access_token_enc,refresh_token_enc,token_expires_at,consent_at) VALUES (1,?,?,?,?,?,CURRENT_TIMESTAMP)",
                              (provider, email, tokens.get("accessTokenEnc", ""), tokens.get("refreshTokenEnc", ""), tokens.get("expiresAt", "")))
        self.db.commit()
        return cur.lastrowid

    @_locked
    def update_tokens(self, account_id, tokens):
        self.db.execute("UPDATE mail_accounts SET access_token_enc=?, refresh_token_enc=COALESCE(NULLIF(?,''),refresh_token_enc), token_expires_at=? WHERE id=?",
                        (tokens.get("accessTokenEnc", ""), tokens.get("refreshTokenEnc", ""), tokens.get("expiresAt", ""), account_id))
        self.db.commit()

    @_locked
    def list_accounts(self):
        return [{"id": r["id"], "provider": r["provider"], "account_email": r["account_email"] or "",
                 "last_sync_at": r["last_sync_at"], "last_error": r["last_error"] or "", "created_at": r["created_at"],
                 "token_expires_at": r["token_expires_at"] or ""}
                for r in self.db.execute("SELECT * FROM mail_accounts ORDER BY id").fetchall()]

    @_locked
    def get_settings(self):
        r = self.db.execute("SELECT settings_json FROM users WHERE id=1").fetchone()
        try:
            return json.loads(r["settings_json"] or "{}") if r else {}
        except Exception:
            return {}

    @_locked
    def update_settings(self, patch):
        cur = self.get_settings()
        cur.update(patch or {})
        self.db.execute("INSERT INTO users(id,email,display_name,settings_json) VALUES (1,'local','local',?) "
                        "ON CONFLICT(id) DO UPDATE SET settings_json=excluded.settings_json",
                        (json.dumps(cur, ensure_ascii=False),))
        self.db.commit()
        return cur

    @_locked
    def get_account(self, account_id):
        r = self.db.execute("SELECT * FROM mail_accounts WHERE id=?", (account_id,)).fetchone()
        return dict(r) if r else None

    @_locked
    def delete_account(self, account_id):
        if not self.get_account(account_id):
            return False
        mids = [r[0] for r in self.db.execute("SELECT id FROM messages WHERE account_id=?", (account_id,))]
        self.db.executemany("DELETE FROM classifications WHERE message_id=?", [(m,) for m in mids])
        self.db.executemany("DELETE FROM notification_logs WHERE message_id=?", [(m,) for m in mids])
        self.db.execute("DELETE FROM messages WHERE account_id=?", (account_id,))
        self.db.execute("DELETE FROM mail_accounts WHERE id=?", (account_id,))
        self.db.commit()
        return True

    @_locked
    def record_sync(self, account_id, error=""):
        """동기화 결과 기록. 성공이면 시각을 갱신하고 오류를 지운다."""
        if error:
            self.db.execute("UPDATE mail_accounts SET last_error=? WHERE id=?", (error[:300], account_id))
        else:
            self.db.execute("UPDATE mail_accounts SET last_sync_at=CURRENT_TIMESTAMP, last_error='' WHERE id=?", (account_id,))
        self.db.commit()

    # --- 규칙·로그 ---
    @_locked
    def add_rule(self, rule_type, pattern, weight=0):
        pattern = (pattern or "").strip()
        if not pattern:
            return
        self.db.execute("INSERT INTO user_rules(rule_type,pattern,weight) VALUES (?,?,?)", (rule_type, pattern, int(weight)))
        self.db.commit()

    @_locked
    def delete_rule(self, rule_id):
        cur = self.db.execute("DELETE FROM user_rules WHERE id=?", (rule_id,))
        self.db.commit()
        return cur.rowcount > 0

    @_locked
    def rules(self):
        return [dict(r) for r in self.db.execute("SELECT * FROM user_rules ORDER BY id").fetchall()]

    @_locked
    def log_notification(self, mid, channel, status, detail=""):
        self.db.execute("INSERT INTO notification_logs(message_id,channel,status,detail) VALUES (?,?,?,?)", (mid, channel, status, detail))
        self.db.commit()

    @_locked
    def audit(self, action, detail=None):
        self.db.execute("INSERT INTO audit_logs(action,detail_json) VALUES (?,?)", (action, json.dumps(detail or {}, ensure_ascii=False)))
        self.db.commit()

    @_locked
    def backup(self, dest):
        """실행 중에도 안전한 일관 스냅샷."""
        target = sqlite3.connect(dest)
        try:
            self.db.backup(target)
        finally:
            target.close()

    @_locked
    def dashboard(self, days=14):
        """사용량 현황: 최근 N일 일별 건수, 알림·감사 최근 기록."""
        daily = [{"date": r[0], "total": r[1]} for r in self.db.execute(
            "SELECT substr(received_at,1,10) d, COUNT(*) FROM messages "
            "WHERE d >= date('now', ?) GROUP BY d ORDER BY d", ("-%d days" % max(1, days),))]
        notif = [dict(r) for r in self.db.execute("SELECT channel,status,detail,created_at FROM notification_logs ORDER BY id DESC LIMIT 10")]
        audit = [dict(r) for r in self.db.execute("SELECT action,detail_json,created_at FROM audit_logs ORDER BY id DESC LIMIT 10")]
        return {"daily": daily, "notifications": notif, "audit": audit}
