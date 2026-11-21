"""파이프라인 오케스트레이션: 수집 -> 분류 -> 저장 -> (중요 시) 알림."""
from .classifier import RuleClassifier, DEFAULT_EQUIPMENT
from .store import LEVELS
from .llm import LLMAdapter
from .validator import correct_text, check_consistency, make_reply_draft
from . import notify as notify_mod


class MailService:
    def __init__(self, store, llm=None):
        self.store = store
        self.llm = llm or LLMAdapter()
        self._classifier()

    def _classifier(self):
        rules = self.store.rules()
        vip = [r["pattern"] for r in rules if r["rule_type"] == "vip_sender"]
        equipment = [r["pattern"] for r in rules if r["rule_type"] == "equipment"] or None
        weights = {r["pattern"]: r["weight"] for r in rules if r["rule_type"] == "keyword"}
        base = RuleClassifier(equipment=equipment, vip_senders=vip, keyword_weights=weights)
        if equipment:  # 사용자 설비는 기본 사전과 병합
            base.equipment = sorted(set(DEFAULT_EQUIPMENT) | set(equipment))
        self.classifier = base
        return base

    def ingest(self, mail, use_llm=False, do_notify=False):
        is_new = self.store.upsert_message(mail)
        cls = self.classifier.classify(mail)
        if use_llm:
            cls = self.llm.enhance(mail, cls)
        cls["messageId"] = mail["id"]
        self.store.save_classification(cls)
        alerts = notify_mod.notify_all(self.store, mail, cls) if do_notify and is_new else []  # 이미 본 메일은 다시 알리지 않음
        return {"isNew": is_new, "classification": cls, "notifications": alerts}

    def ingest_many(self, mails, **kw):
        return [self.ingest(m, **kw) for m in mails]

    def reclassify(self, mid, use_llm=True):
        mail = self.store.get_message(mid)
        if not mail:
            return None
        self._classifier()
        return self.ingest(mail, use_llm=use_llm)["classification"]

    def reclassify_all(self):
        """분류 규칙·사용자 규칙을 바꾼 뒤 저장된 모든 메일을 규칙 기반으로 다시 분류한다(사용자 지정 유지, 알림 없음)."""
        self._classifier()
        done, offset = 0, 0
        while True:
            batch, _ = self.store.list_messages(limit=200, offset=offset)
            if not batch:
                return done
            for mail in batch:
                self.ingest(mail)
            done += len(batch)
            offset += len(batch)

    def adjust(self, mid, level=None, equipment_add=(), equipment_remove=(), clear=False):
        """사용자가 중요도·설비 태그를 직접 고친다. 재분류·재동기화 후에도 유지된다."""
        if not self.store.get_message(mid):
            return None
        ov = {} if clear else self.store.get_override(mid)
        if level is not None:
            if level and level not in LEVELS:
                raise ValueError("중요도는 %s 중 하나여야 합니다." % ", ".join(LEVELS))
            ov["level"] = level
        add, rem = set(ov.get("equipmentAdd", [])), set(ov.get("equipmentRemove", []))
        add = (add | set(equipment_add)) - set(equipment_remove)
        rem = (rem | set(equipment_remove)) - set(equipment_add)
        ov = {k: v for k, v in {"level": ov.get("level"), "equipmentAdd": sorted(add), "equipmentRemove": sorted(rem)}.items() if v}
        self.store.set_override(mid, ov)
        return self.reclassify(mid, use_llm=self.llm.enabled)

    def correct(self, mid):
        mail = self.store.get_message(mid)
        if not mail:
            return None
        result = correct_text(mail["bodyText"])
        result["issues"] += check_consistency(mail["bodyText"], (mail.get("classification") or {}).get("entities", {}))
        return result

    def reply_draft(self, mid):
        mail = self.store.get_message(mid)
        if not mail:
            return None
        return make_reply_draft(mail, mail.get("classification") or self.classifier.classify(mail))
