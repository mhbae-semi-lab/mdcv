"""Extractive summary, spelling / consistency checks and reply drafts. Twin of packages/engine/validator.ts."""
import re

from .rules import RULES, js_repl

SENTENCE_SPLIT = re.compile(r"(?<=[.!?。])\s+|\n+")
NUMBER = re.compile(r"([가-힣A-Za-z\- ]{2,20}?)\s*[:은는이가]?\s*([0-9]+(?:\.[0-9]+)?)\s*(%|도|℃|°C|bar|MPa|kPa|Pa|rpm|mm|um|nm|kg|건|대|시간|ea|EA)")


def summarize(text, max_sentences=3):
    """Extractive summary: up to 3 sentences that carry requests, deadlines or numbers, in original order."""
    body = re.sub(r"\s+", " ", text or "").strip()
    if not body:
        return ""
    sentences = [s.strip() for s in SENTENCE_SPLIT.split(body) if len(s.strip()) > 8]
    if not sentences:
        return body[:200]

    def score(s):
        low = s.lower()
        return sum(2 for k in RULES["summaryBoost"] if k in low) + (1 if re.search(r"[0-9]", s) else 0)

    ranked = sorted(enumerate(sentences), key=lambda x: (-score(x[1]), x[0]))
    picked = sorted(i for i, _ in ranked[:max_sentences])
    return " ".join(sentences[i] for i in picked)[:600]


def correct_text(text):
    """Applies the spelling and spacing dictionary and lists what it changed."""
    issues, out = [], text or ""
    for pattern, repl in RULES["spelling"]:
        for m in re.finditer(pattern, out):
            issues.append({"type": "spelling", "original": m.group(0),
                           "suggestion": re.sub(pattern, js_repl(repl), m.group(0), count=1),
                           "message": "맞춤법/표현 교정 제안"})
    for pattern, repl in RULES["spelling"] + RULES["spacing"]:
        out = re.sub(pattern, js_repl(repl), out)
    return {"corrected": out.strip(), "issues": issues}


def check_consistency(text, entities):
    """Flags the same quantity written with different numbers, and more than one deadline day."""
    issues, numbers = [], {}
    for m in NUMBER.finditer(text or ""):
        key = m.group(1).strip()
        vals = numbers.setdefault(key, [])
        val = m.group(2) + m.group(3)
        if val not in vals:
            vals.append(val)
    for key, vals in numbers.items():
        if len(vals) > 1:
            issues.append({"type": "consistency", "original": key, "suggestion": "",
                           "message": "'%s'에 서로 다른 수치 %s 가 함께 쓰였습니다. 확인이 필요합니다." % (key, ", ".join(sorted(vals)))})
    deadlines = [d for d in (entities or {}).get("dates", []) if d.get("kind") == "deadline" and d.get("iso")]
    if len({d["iso"][:10] for d in deadlines}) > 1:
        issues.append({"type": "consistency", "original": "마감일", "suggestion": "",
                       "message": "서로 다른 마감 날짜가 %d개 감지됐습니다: %s" % (len(deadlines), ", ".join(d["raw"] for d in deadlines))})
    return issues


def make_reply_draft(mail, classification, lang="ko"):
    """Reply draft with the requests and deadline echoed back. Never sent automatically."""
    actions = (classification or {}).get("actionItems", [])
    dates = ((classification or {}).get("entities", {}) or {}).get("dates", [])
    due = next((d["raw"] for d in dates if d.get("kind") == "deadline"), None)
    subject = mail.get("subject", "")
    if lang == "en":
        sender = (mail.get("senderName") or mail.get("sender_name") or "").strip() or "there"
        lines = ["Hi %s," % sender, "", "Thank you for your email. I will review it and follow up."]
        if actions:
            lines.append("Requested: " + "; ".join(a["text"] for a in actions[:3]))
        if due:
            lines.append("I will get back to you by %s." % due)
        lines += ["", "Please let me know if anything else is needed.", "Best regards,"]
        return {"subject": "RE: %s" % subject, "draft": "\n".join(lines), "issues": [],
                "note": "Not sent automatically. Review and edit it, then send it from your mail client."}
    sender = (mail.get("senderName") or mail.get("sender_name") or "").strip() or "담당자"
    lines = ["%s님, 안녕하세요." % sender, "", "메일 확인했습니다. 보내주신 내용 검토 후 진행하겠습니다."]
    if actions:
        lines.append("요청 사항: %s" % "; ".join(a["text"] for a in actions[:3]))
    if due:
        lines.append("말씀하신 기한(%s)까지 회신드리겠습니다." % due)
    lines += ["", "추가로 확인이 필요한 사항이 있으면 알려주시기 바랍니다.", "감사합니다."]
    fixed = correct_text("\n".join(lines))
    return {"subject": "RE: %s" % subject, "draft": fixed["corrected"], "issues": fixed["issues"],
            "note": "자동 발송되지 않습니다. 내용을 확인·수정한 뒤 메일 클라이언트에서 발송하세요."}
