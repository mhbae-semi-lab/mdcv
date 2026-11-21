"""Rule classifier: equipment / alarm / date / people extraction, importance score with reasons, action items.

Twin of packages/engine/classifier.ts - keep both identical (scripts/parity.py).
"""
import re

from .dates import parse_dates, period_bucket
from .rules import RULES
from .text import fresh_text, has, hits, iso_minutes, now_wall, parse_wall
from .validator import SENTENCE_SPLIT, check_consistency, correct_text, summarize

LEVELS = ("urgent", "important", "normal", "reference")
DEFAULT_EQUIPMENT = [list(e) for e in RULES["equipment"]]
CODE = re.compile(r"(?<![A-Za-z0-9_])([A-Z]{2,5})[-_]?([0-9]{1,5})([A-Z]?)(?![A-Za-z0-9_])")
ALARM = re.compile(r"(?<![A-Za-z0-9_])" + RULES["alarmCode"] + r"(?![A-Za-z0-9_])")
ALARM_FULL = re.compile("^" + RULES["alarmCode"] + "$")
PEOPLE = re.compile(r"([가-힣]{2,4})\s*(?:님|과장|부장|팀장|대리|차장|책임|선임|수석|主任|담당)")


def _level(score):
    return "urgent" if score >= 80 else "important" if score >= 55 else "normal" if score >= 30 else "reference"


def _longest(xs):
    """Drops names contained in a longer matched name ("펌프" when "진공 펌프" matched)."""
    return [c for c in xs if not any(o != c and c in o for o in xs)]


def _entries(equipment):
    """Accepts dictionary entries ([canonical, alias...]) or plain names."""
    return [list(e) if isinstance(e, (list, tuple)) else [e] for e in (equipment or DEFAULT_EQUIPMENT)]


def find_equipment(text, dictionary=None):
    names = [entry[0] for entry in _entries(dictionary) if any(term and has(text, term) for term in entry)]
    stop = set(RULES["codeStop"])
    codes = [m.group(0).replace("_", "-") for m in CODE.finditer(text)
             if m.group(1) not in stop and not ALARM_FULL.match(m.group(0))]
    return sorted(set(_longest(sorted(set(names + codes)))))


def find_alarms(text):
    return sorted({m.group(0) for m in ALARM.finditer(text)})


class RuleClassifier:
    def __init__(self, equipment=None, vip_senders=None, keyword_weights=None):
        self.equipment = _entries(equipment)
        self.vip = {s.lower() for s in (vip_senders or [])}
        self.keyword_weights = keyword_weights or {}

    def classify(self, mail):
        """mail dict -> classification.schema.json dict"""
        subject = mail.get("subject", "") or ""
        body = mail.get("bodyText") or mail.get("body_text") or ""
        fresh = fresh_text(body)
        text = subject + "\n" + fresh
        received = mail.get("receivedAt") or mail.get("received_at") or iso_minutes(now_wall())
        base = parse_wall(received) or now_wall()
        sender_email = (mail.get("senderEmail") or mail.get("sender_email") or "").lower()
        sender_name = mail.get("senderName") or mail.get("sender_name") or ""

        # Entities come from the whole mail (a forward's equipment matters); requests and urgency only from the new text.
        full = subject + "\n" + body
        equipment = find_equipment(full, self.equipment)
        alarms = find_alarms(full)
        dates = parse_dates(text, base)
        people = sorted({p for p in [sender_name] + PEOPLE.findall(text) if p})
        keywords = hits(text, RULES["keywords"])

        score, reasons = 10, []
        if sender_email in self.vip or sender_name.lower() in self.vip:
            score += 25; reasons.append("VIP 발신자")
        resolved = hits(text, RULES["resolved"])
        urgent = [] if (hits(text, RULES["notUrgent"]) or resolved) else hits(text, RULES["urgent"])
        if urgent:
            score += 25; reasons.append("긴급 키워드: " + ", ".join(urgent[:3]))
        assets = equipment or alarms
        if assets and urgent:
            score += 15; reasons.append("설비 이상 관련(%s)" % ", ".join(assets[:3]))
            impact = hits(text, RULES["impact"])
            if impact:
                score += 10; reasons.append("생산 영향: " + ", ".join(impact[:2]))
        anomaly = hits(text, RULES["anomaly"]) + alarms
        if assets and anomaly and not urgent and not resolved:
            score += 30; reasons.append("설비 이상 징후: " + ", ".join(anomaly[:3]))
        if resolved:
            reasons.append("해결·복구 표현: " + resolved[0])
        customer = hits(text, RULES["customer"])
        if customer:
            score += 10; reasons.append("고객 관련: " + customer[0])
        bulk = hits(text, RULES["bulk"])
        no_reply = hits(text, RULES["noReply"])
        # A reply's subject repeats the original request ("RE: 검토 요청"), so only the new text counts as asking.
        # Conditional requests ("변경이 필요한 경우에만 공유해 주십시오") are offers, not obligations.
        ask_source = ("" if re.match(r"^\s*(re|fw|fwd|회신|답장|전달)\s*:", subject, re.I) else subject) + "\n" + fresh
        ask_text = "\n".join(s for s in SENTENCE_SPLIT.split(ask_source) if not hits(s, RULES["conditional"]))
        asks = hits(ask_text, RULES["action"])
        question = "?" in ask_text or "？" in ask_text
        needs_reply = not bulk and not no_reply and (bool(asks) or question)
        if needs_reply:
            score += 15; reasons.append("회신/조치 요청 포함")
        deadlines = [d for d in dates if d["kind"] == "deadline" and d["iso"]]
        def hours_left(d):
            return (parse_wall(d["iso"]) - base).total_seconds() / 3600
        soon = next((d for d in deadlines if 0 <= hours_left(d) <= 72), None)
        week = next((d for d in deadlines if 0 <= hours_left(d) <= 168), None)
        if soon:
            score += 25; reasons.append("72시간 내 마감(%s)" % soon["raw"])
        elif week:
            score += 10; reasons.append("7일 내 마감(%s)" % week["raw"])
        if needs_reply and (soon or week):
            score += 15; reasons.append("기한 있는 회신 요청")
        if equipment:
            score += 5; reasons.append("설비 언급(%s)" % ", ".join(equipment[:3]))
        if any(d["kind"] == "meeting" for d in dates):
            score += 10; reasons.append("회의/점검 일정")
        if dates:
            score += 5; reasons.append("날짜/일정 포함")
        if bulk:
            score -= 30; reasons.append("대량/광고성 메일")
        if no_reply:
            reasons.append("회신 불필요 표시: " + no_reply[0])
        for kw, w in self.keyword_weights.items():
            if kw and has(text, kw):
                score += int(w); reasons.append("사용자 키워드: %s" % kw)
        score = max(0, min(100, score))
        if not urgent:
            score = min(score, 79)  # urgent needs an explicit urgency / outage word
        if no_reply and score > 54:
            score = 54; reasons.append("참고용 표시로 '일반' 이하")

        action_items = []
        if needs_reply:
            first_due = next((d for d in deadlines if d["iso"][:10] >= base.date().isoformat()), None)
            for line in (s.strip() for s in re.split(SENTENCE_SPLIT, fresh)):
                if not line or hits(line, RULES["conditional"]) or not (hits(line, RULES["action"]) or "?" in line or "？" in line):
                    continue
                own = next((d for d in deadlines if d["raw"] in line), first_due)
                action_items.append({"text": line[:160], "due": own["raw"] if own else None,
                                     "dueIso": own["iso"] if own else None, "owner": sender_name or None})
                if len(action_items) >= 5:
                    break
            if not action_items:
                action_items.append({"text": (subject or "회신 요청")[:160], "due": first_due["raw"] if first_due else None,
                                     "dueIso": first_due["iso"] if first_due else None, "owner": sender_name or None})

        correction = correct_text(body)
        correction["issues"] = correction["issues"] + check_consistency(body, {"dates": dates})
        return {
            "messageId": str(mail.get("id", "")),
            "importance": {"level": _level(score), "score": score, "reasons": reasons or ["일반 업무 메일"]},
            "period": period_bucket(received),
            "entities": {"equipment": equipment, "alarms": alarms, "dates": dates, "people": people, "keywords": keywords},
            "summary": summarize(fresh) or summarize(body),
            "actionItems": action_items,
            "needsReply": bool(needs_reply),
            "correction": correction if correction["issues"] else None,
            "confidence": 0.9 if (equipment or dates or needs_reply) else 0.6,
            "engine": "rule",
            "rulesVersion": RULES["version"],
        }
