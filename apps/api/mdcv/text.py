"""Shared text helpers. Twin of packages/engine/text.ts; keep them identical (scripts/parity.py)."""
import re
from datetime import datetime, timedelta

from .rules import RULES

_ASCII_TERM = re.compile(r"^[\x20-\x7e]+$")
_cache = {}


def term_regex(term):
    """Terms made of ASCII match as whole words, ignoring case; "re:" terms are regular expressions matched the same way;
    other terms (Korean) match as substrings."""
    is_re = term.startswith("re:")
    if not is_re and not _ASCII_TERM.match(term):
        return None
    rx = _cache.get(term)
    if rx is None:
        body = term[3:] if is_re else re.escape(term)
        rx = _cache[term] = re.compile(r"(?<![A-Za-z0-9_])(?:" + body + r")(?![A-Za-z0-9_])", re.I)
    return rx


def has(text, term):
    rx = term_regex(term)
    return bool(rx.search(text)) if rx else term in text


def hits(text, terms):
    return [t for t in terms if has(text, t)]


QUOTE_HEADER = re.compile(r"^(?:On .{4,80} wrote:|20[0-9]{2}(?:년|[-./]).{0,80}작성:|(?:From|보낸 사람|보낸사람):[^\n]*\n(?:Sent|Date|보낸 날짜|날짜):)", re.M)


def fresh_text(body):
    """Mail text the sender wrote now: drops lines quoted with '>' and everything after a reply/forward header."""
    out = body or ""
    for marker in RULES["quoteMarkers"]:
        i = out.find(marker)
        if i >= 0:
            out = out[:i]
    m = QUOTE_HEADER.search(out)
    if m:
        out = out[:m.start()]
    return "\n".join(line for line in out.split("\n") if not line.lstrip().startswith(">"))


_ISO = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]{1,6})?)?)?(?:Z|[+-][0-9]{2}:?[0-9]{2})?$")


def wall(y, mo, d, h=0, mi=0, s=0):
    try:
        return datetime(y, mo, d, h, mi, s)
    except ValueError:
        return None


def parse_wall(iso):
    """Keeps the written wall-clock time; any offset is ignored."""
    if isinstance(iso, datetime):
        return iso.replace(tzinfo=None)
    m = _ISO.match(str(iso or "").strip())
    if not m:
        return None
    return wall(int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4) or 0), int(m.group(5) or 0), int(m.group(6) or 0))


def now_wall():
    return datetime.now().replace(microsecond=0)


def at_time(d, h, mi=0):
    return d.replace(hour=h, minute=mi, second=0, microsecond=0)


def add_days(d, n):
    return d + timedelta(days=n)


def iso_minutes(d):
    return d.strftime("%Y-%m-%dT%H:%M")
