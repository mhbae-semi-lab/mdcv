"""LLM second opinion for the self-host server. The rule result always exists; an LLM answer replaces level, reply flag,
summary and action items only after validate_answer() passes (twin of packages/engine/llm.ts validateAnswer).

Providers: anthropic (official SDK, imported only when used), openai, gemini (HTTP). No key -> rules only.
Mail text is masked before sending; per-mail character cap and daily call cap keep cost bounded.
"""
import json
import os
import urllib.request
from datetime import date

from .classifier import LEVELS, _level
from .masking import mask_pii

PROMPT_VERSION = "classify-v2"
SYSTEM = """You triage work mail for a semiconductor equipment field engineer.
Return JSON only, matching the schema. Judge the mail on its own:
- level: urgent (tool down, alarm with production impact, safety; act now), important (deadline within about 3 days, or a manager/customer request), normal (routine work, meetings), reference (FYI, newsletters, automated reports with no action).
- score: 0-100 consistent with level (urgent 80-100, important 55-79, normal 30-54, reference 0-29).
- needsReply: true only if the reader must reply, act or submit something.
- reasons: 1-3 short reasons quoting words from the mail.
- equipment: tool IDs, modules or alarm codes exactly as written in the mail. Never invent one.
- actionItems: requests to the reader; due = the deadline words exactly as written, or null.
- summary: at most 3 sentences in the mail's language.
Personal data is masked as [이름], [이메일] and similar; keep the masks as they are."""
SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["level", "score", "needsReply", "reasons", "equipment", "actionItems", "summary"],
    "properties": {
        "level": {"type": "string", "enum": list(LEVELS)}, "score": {"type": "integer"}, "needsReply": {"type": "boolean"},
        "reasons": {"type": "array", "items": {"type": "string"}}, "equipment": {"type": "array", "items": {"type": "string"}},
        "actionItems": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["text", "due"],
                                                   "properties": {"text": {"type": "string"}, "due": {"type": ["string", "null"]}}}},
        "summary": {"type": "string"},
    },
}


def validate_answer(a, mail):
    """Checks an LLM answer against the schema rules and the mail text. Returns a list of problems (empty = valid)."""
    if not isinstance(a, dict):
        return ["JSON 객체가 아님"]
    errors = []
    text = (mail.get("subject") or "") + "\n" + (mail.get("bodyText") or "")
    low = text.lower()
    level, score = a.get("level"), a.get("score")
    if level not in LEVELS:
        errors.append("중요도 값이 허용 목록에 없음: %s" % level)
    if not isinstance(score, int) or isinstance(score, bool) or not 0 <= score <= 100:
        errors.append("점수가 0~100 정수가 아님: %s" % score)
    elif level in LEVELS and _level(score) != level:
        errors.append("점수 %s와 중요도 %s 불일치" % (score, level))
    if not isinstance(a.get("needsReply"), bool):
        errors.append("needsReply가 true/false가 아님")
    reasons = a.get("reasons")
    if not isinstance(reasons, list) or not reasons or len(reasons) > 5 or any(not isinstance(r, str) or len(r) > 200 for r in reasons):
        errors.append("근거는 1~5개, 각 200자 이하 문자열이어야 함")
    eq = a.get("equipment")
    if not isinstance(eq, list):
        errors.append("equipment가 배열이 아님")
    else:
        for e in eq:
            if not isinstance(e, str) or not e.strip() or e.lower() not in low:
                errors.append("본문에 없는 설비: %s" % e)
    items = a.get("actionItems")
    if not isinstance(items, list) or len(items) > 5:
        errors.append("할 일은 5개 이하 배열이어야 함")
    else:
        for it in items:
            if not isinstance(it, dict) or not isinstance(it.get("text"), str) or len(it["text"]) > 200:
                errors.append("할 일 문장이 비었거나 너무 김")
            elif it.get("due") is not None and (not isinstance(it["due"], str) or it["due"] not in text):
                errors.append("본문에 없는 기한 표현: %s" % it.get("due"))
    if not isinstance(a.get("summary"), str) or len(a["summary"]) > 600:
        errors.append("요약이 문자열이 아니거나 600자 초과")
    return errors


class LLMAdapter:
    def __init__(self, provider=None, api_key=None, model=None):
        self.provider = (provider or os.getenv("MDCV_LLM_PROVIDER", "")).lower()
        self.api_key = api_key or os.getenv("MDCV_LLM_API_KEY", "")
        default = {"anthropic": "claude-opus-5-5", "openai": "gpt-4o-mini", "gemini": "gemini-2.0-flash"}.get(self.provider, "")
        self.model = model or os.getenv("MDCV_LLM_MODEL", "") or default
        self.enabled = bool(self.provider and self.api_key)
        self.max_chars = int(os.getenv("MDCV_LLM_MAX_CHARS", "4000"))
        self.daily_limit = int(os.getenv("MDCV_LLM_DAILY_LIMIT", "200"))
        self.usage = {"date": "", "calls": 0, "chars": 0, "blocked": 0, "invalid": 0}
        self.last_errors = []

    def _budget_ok(self):
        today = date.today().isoformat()
        if self.usage["date"] != today:
            self.usage = {"date": today, "calls": 0, "chars": 0, "blocked": 0, "invalid": 0}
        if self.daily_limit and self.usage["calls"] >= self.daily_limit:
            self.usage["blocked"] += 1
            return False
        return True

    def stats(self):
        return {"provider": self.provider, "model": self.model, "enabled": self.enabled, "promptVersion": PROMPT_VERSION,
                "maxChars": self.max_chars, "dailyLimit": self.daily_limit, "usage": dict(self.usage)}

    def _call(self, prompt):
        if self.provider == "anthropic":
            import anthropic  # official SDK, only needed when this provider is configured
            client = anthropic.Anthropic(api_key=self.api_key, max_retries=2)
            res = client.messages.create(
                model=self.model, max_tokens=2048, system=SYSTEM,
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
                messages=[{"role": "user", "content": prompt}])
            if res.stop_reason == "refusal":
                raise ValueError("model declined")
            return "".join(b.text for b in res.content if b.type == "text")
        if self.provider == "openai":
            url, headers = "https://api.openai.com/v1/chat/completions", {"Authorization": "Bearer " + self.api_key}
            payload = {"model": self.model, "response_format": {"type": "json_object"},
                       "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]}
        elif self.provider == "gemini":
            url = "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent" % self.model
            headers, payload = {"x-goog-api-key": self.api_key}, {"contents": [{"parts": [{"text": SYSTEM + "\n" + prompt}]}]}
        else:
            return None
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=dict(headers, **{"Content-Type": "application/json"}))
        with urllib.request.urlopen(req, timeout=30) as res:  # noqa: S310 (fixed official endpoints)
            data = json.loads(res.read().decode())
        if self.provider == "openai":
            return data["choices"][0]["message"]["content"]
        return data["candidates"][0]["content"]["parts"][0]["text"]

    def enhance(self, mail, base_result, mask=True):
        """Rule result, replaced by the LLM's level / reply / summary / actions only when the answer validates."""
        if not self.enabled or not self._budget_ok():
            return base_result
        body = (mail.get("bodyText") or "")[:self.max_chars]
        names = [mail.get("senderName") or ""] + list(base_result.get("entities", {}).get("people", []))
        subject = mail.get("subject", "")
        if mask:
            body, subject = mask_pii(body, names), mask_pii(subject, names)
        try:
            parsed = json.loads(self._call("Subject: %s\n\n%s" % (subject, body)))
            self.usage["calls"] += 1
            self.usage["chars"] += len(body)
        except Exception:
            return base_result
        self.last_errors = validate_answer(parsed, mail)
        if self.last_errors:
            self.usage["invalid"] += 1
            return base_result
        out = dict(base_result)
        out["importance"] = {"level": parsed["level"], "score": parsed["score"], "reasons": ["LLM 판단 (규칙 검증 통과)"] + parsed["reasons"]}
        out["needsReply"] = parsed["needsReply"]
        out["summary"] = parsed["summary"] or base_result.get("summary", "")
        dates = base_result.get("entities", {}).get("dates", [])

        def due_iso(raw):
            d = next((x for x in dates if raw and (x["raw"] == raw or x["raw"] in raw or raw in x["raw"])), None)
            return d["iso"] if d else None
        owner = mail.get("senderName") or None
        out["actionItems"] = [{"text": it["text"], "due": it["due"], "dueIso": due_iso(it["due"]), "owner": owner}
                              for it in parsed["actionItems"]] if parsed["needsReply"] else []
        out["engine"] = "hybrid"
        return out
