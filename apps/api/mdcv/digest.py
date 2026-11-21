"""Period digest (morning ... yearly). Twin of packages/engine/digest.ts."""
from collections import Counter
from datetime import datetime, timedelta

from .text import parse_wall

PERIOD_LABEL = {"morning": "오전", "afternoon": "오후", "daily": "일간", "weekly": "주간", "monthly": "월간", "yearly": "연간"}
LEVEL_ORDER = {"urgent": 0, "important": 1, "normal": 2, "reference": 3}


def period_start(period, now):
    """Earliest received time a period can include: callers load only mails after this."""
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "weekly":
        return now - timedelta(days=7)
    if period == "monthly":
        return day.replace(day=1)
    if period == "yearly":
        return day.replace(month=1, day=1)
    if period == "afternoon":
        return day.replace(hour=12)
    return day


def _in_period(received, period, now):
    dt = parse_wall(received)
    if dt is None:
        return False
    if period == "morning":
        return dt.date() == now.date() and dt.hour < 12
    if period == "afternoon":
        return dt.date() == now.date() and dt.hour >= 12
    if period == "daily":
        return dt.date() == now.date()
    if period == "weekly":
        return now - timedelta(days=7) <= dt <= now + timedelta(days=1)
    if period == "monthly":
        return (dt.year, dt.month) == (now.year, now.month)
    return dt.year == now.year


def build_digest(mails, period, now=None):
    """mails: [{..., classification}] -> digest dict"""
    now = now or datetime.now()
    lvl = lambda m: (m.get("classification") or {}).get("importance", {}).get("level", "normal")  # noqa: E731
    items = [m for m in mails if _in_period(m.get("receivedAt", ""), period, now)]
    items.sort(key=lambda m: (LEVEL_ORDER.get(lvl(m), 2), -(m.get("classification") or {}).get("importance", {}).get("score", 0)))
    by_level, by_equipment, actions = Counter(), Counter(), []
    for m in items:
        cls = m.get("classification") or {}
        by_level[lvl(m)] += 1
        for e in cls.get("entities", {}).get("equipment", []):
            by_equipment[e] += 1
        if cls.get("needsReply"):
            for a in cls.get("actionItems", []):
                actions.append({"mailId": m.get("id"), "subject": m.get("subject"), "text": a["text"], "due": a.get("due"), "dueIso": a.get("dueIso")})
    actions.sort(key=lambda a: a["dueIso"] or "9999")
    top = by_equipment.most_common(10)
    return {
        "period": period, "label": PERIOD_LABEL.get(period, period),
        "generatedAt": now.isoformat(timespec="minutes"), "total": len(items),
        "byImportance": dict(by_level), "byEquipment": dict(top),
        "headline": "%s 다이제스트: 총 %d건 (긴급 %d · 중요 %d), 주요 설비 %s" % (
            PERIOD_LABEL.get(period, period), len(items), by_level.get("urgent", 0), by_level.get("important", 0),
            ", ".join(k for k, _ in top[:3]) or "없음"),
        "topMails": [{"id": m.get("id"), "subject": m.get("subject"), "importance": (m.get("classification") or {}).get("importance"),
                      "summary": (m.get("classification") or {}).get("summary", "")} for m in items[:10]],
        "actionItems": actions[:20],
    }
