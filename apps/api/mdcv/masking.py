"""Personal data masking before any text leaves the server (LLM calls). Twin of packages/engine/masking.ts."""
import re

PATTERNS = [
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[이메일]"),
    (re.compile(r"(?<![0-9])[0-9]{6}-[1-4][0-9]{6}(?![0-9])"), "[주민번호]"),
    (re.compile(r"(?<![0-9])[0-9]{4}[- ][0-9]{4}[- ][0-9]{4}[- ][0-9]{4}(?![0-9])"), "[카드번호]"),
    (re.compile(r"(?<![0-9])(?:\+82[- ]?)?0?1[016789][- .]?[0-9]{3,4}[- .]?[0-9]{4}(?![0-9])"), "[전화번호]"),
    (re.compile(r"(?<![0-9])0[2-6][0-9]?[- .)][0-9]{3,4}[- .][0-9]{4}(?![0-9])"), "[전화번호]"),
    (re.compile(r"(?<![0-9.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9.])"), "[IP]"),
    (re.compile(r"(비밀번호|패스워드|password|pw)\s*[:=]\s*\S+", re.I), r"\1: [마스킹]"),
    (re.compile(r"(사번|employee\s+(?:id|no\.?))\s*[:#]?\s*[A-Za-z0-9-]{4,}", re.I), r"\1 [사번]"),
]


def mask_pii(text, names=()):
    """Masks contact data, ids and the given names (sender, recipients, people found in the text)."""
    out = text or ""
    for rx, repl in PATTERNS:
        out = rx.sub(repl, out)
    uniq = {(n or "").strip() for n in names}
    for name in sorted((n for n in uniq if len(n) >= 2), key=lambda n: (-len(n), n)):
        out = out.replace(name, "[이름]")
    return out
