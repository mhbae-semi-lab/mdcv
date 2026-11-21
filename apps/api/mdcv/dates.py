"""Korean and English date / deadline expressions -> wall-clock times. Twin of packages/engine/dates.ts."""
import re
from datetime import timedelta

from .rules import RULES
from .text import add_days, at_time, iso_minutes, now_wall, parse_wall, wall

TIME = r"(?:\s*(오전|오후|AM|PM|am|pm)?\s*([0-9]{1,2})(?:\s*시(?:\s*([0-9]{1,2})\s*분)?|:([0-9]{2})))?(?:\s*(오전\s*중|오후\s*중|중(?=으로|에|까지|\s|[,.]|$)|퇴근\s*전|EOD|오전|오후))?"
KO_WD = r"(?:\s*(?:\([월화수목금토일]\)|[월화수목금토일]요일|\((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\)))?"
EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
EN_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
EN_SHORT = {"mon": 0, "tue": 1, "tues": 1, "wed": 2, "thu": 3, "thur": 3, "thurs": 3, "fri": 4}
KO_DAYS = "월화수목금토일"
REL = {"오늘": 0, "금일": 0, "당일": 0, "내일": 1, "명일": 1, "익일": 1, "모레": 2, "어제": -1, "전일": -1}


def _timed(day, g):
    """Applies the trailing TIME groups; without a time a day-level date means the end of the working day (18:00)."""
    if day is None:
        return None
    ampm, h, m1, m2, part = g[-5:]
    if h is not None:
        hour = int(h)
        if ampm in ("오후", "PM", "pm") and hour < 12:
            hour += 12
        minute = int(m1 if m1 is not None else (m2 if m2 is not None else 0))
        if hour <= 23 and minute <= 59:
            return at_time(day, hour, minute)
    if part and part.startswith("오전"):
        return at_time(day, 12)
    return at_time(day, 18)


def _end_of_day(d):
    return at_time(d, 18) if d else None


def _month_day(base, y, mo, d):
    """Month/day without a year: this year, or next year when that would be more than 180 days in the past."""
    if y:
        return wall(int(y), mo, d)
    dt = wall(base.year, mo, d)
    if dt and dt < base - timedelta(days=180):
        return wall(base.year + 1, mo, d)
    return dt


def _month_end(y, mo):
    return wall(y + 1 if mo == 12 else y, 1 if mo == 12 else mo + 1, 1) - timedelta(days=1)


def _week_day(base, target, scope):
    """this = this calendar week (Mon-Sun), next = next calendar week, '' = the coming one (today counts)."""
    today = wall(base.year, base.month, base.day)
    if scope == "":
        return add_days(today, (target - today.weekday() + 7) % 7)
    return add_days(today, -today.weekday() + target + (7 if scope == "next" else 0))


def _scope(s):
    if not s:
        return ""
    return "next" if re.match(r"(다음|차주|담주|next)", re.sub(r"\s", "", s), re.I) else "this"


def _r_ymd(g, b):
    return _timed(wall(int(g[1]), int(g[2]), int(g[3])), g)


def _r_ko_md(g, b):
    return _timed(_month_day(b, g[1], int(g[2]), int(g[3])), g)


def _r_slash(g, b):
    return _timed(_month_day(b, None, int(g[1]), int(g[2])), g)


def _r_en_md(g, b):
    return _end_of_day(_month_day(b, None, EN_MONTHS.index(g[1]) + 1, int(g[2])))


def _r_en_dm(g, b):
    return _end_of_day(_month_day(b, None, EN_MONTHS.index(g[2]) + 1, int(g[1])))


def _r_month_end(g, b):
    y, mo = b.year, b.month
    if g[1]:
        mo = int(g[1])
        if mo < 1 or mo > 12:
            return None
        if _month_end(y, mo) < b - timedelta(days=180):
            y += 1
    elif g[3]:
        mo += 1
        if mo > 12:
            mo, y = 1, y + 1
    return at_time(_month_end(y, mo), 18)


def _r_day_only(g, b):
    d = int(g[1])
    y, mo = b.year, b.month
    if d < b.day:
        mo += 1
        if mo > 12:
            mo, y = 1, y + 1
    return _timed(wall(y, mo, d), g)


def _r_rel(g, b):
    delta = 2 if re.match(r"^내일\s*모레$", g[1]) else REL[g[1]]
    return _timed(add_days(b, delta), g)


def _r_ko_week(g, b):
    return _timed(_week_day(b, KO_DAYS.index(g[2]), _scope(g[1])), g)


def _r_week_scope(g, b):
    return at_time(_week_day(b, 4, _scope(g[1])), 18)


def _r_duration(g, b):
    return at_time(add_days(b, int(g[1])), 18) if g[2] == "일" else b + timedelta(hours=int(g[1]))


def _r_within(g, b):
    return b + timedelta(hours=int(g[1])) if g[2].lower().startswith("h") else at_time(add_days(b, int(g[1])), 18)


def _r_en_rel(g, b):
    w = (g[1] if g[1] is not None else (g[2] if g[2] is not None else "")).lower()
    if w in EN_DAYS:
        return at_time(_week_day(b, EN_DAYS.index(w), ""), 18)
    return at_time(add_days(b, 1 if w == "tomorrow" else 0), 18)


def _r_week_start(g, b):
    return at_time(_week_day(b, 0, "next"), 18)


def _r_en_week(g, b):
    w = g[2].lower()
    target = EN_DAYS.index(w) if w in EN_DAYS else EN_SHORT[w]
    return at_time(_week_day(b, target, _scope(g[1])), 18)


def _r_time_only(g, b):
    return _timed(b, [g[1], g[2], g[3], None, None])


_M = "|".join(EN_MONTHS)
# Priority order matters: a later pattern never takes text an earlier one already matched.
PATTERNS = [
    (re.compile(r"(?<![0-9])(20[0-9]{2})[-/.]\s?([0-9]{1,2})[-/.]\s?([0-9]{1,2})(?![0-9])" + KO_WD + TIME), _r_ymd),
    (re.compile(r"(?<![0-9])(?:(20[0-9]{2})\s*년\s*)?([0-9]{1,2})\s*월\s*([0-9]{1,2})\s*일" + KO_WD + TIME), _r_ko_md),
    (re.compile(r"(?<![0-9/.])([0-9]{1,2})/([0-9]{1,2})(?![0-9/])" + KO_WD + TIME), _r_slash),
    (re.compile(r"(?<![A-Za-z])(" + _M + r")[a-z]*\.?\s+([0-9]{1,2})(?:st|nd|rd|th)?(?![0-9])"), _r_en_md),
    (re.compile(r"(?<![0-9])([0-9]{1,2})(?:st|nd|rd|th)?\s+(" + _M + r")[a-z]*(?![A-Za-z])"), _r_en_dm),
    (re.compile(r"(?:([0-9]{1,2})\s*월|(이번\s*달|이달|금월|당월)|(다음\s*달|익월|내달)|(?<![0-9])월)\s*말일?(?=까지|에|이전|\s|[,.)]|$)"), _r_month_end),
    (re.compile(r"(?<![0-9월/.])([0-9]{1,2})\s*일(?:\s*\([월화수목금토일]\))?(?=\s*(?:오전|오후|[0-9]|까지|마감|중|전까지))" + TIME), _r_day_only),
    (re.compile(r"(내일\s*모레|오늘|금일|당일|내일|명일|익일|모레|어제|전일)" + TIME), _r_rel),
    (re.compile(r"(?:(이번\s*주|금주|다음\s*주|차주|담주)\s*)?([월화수목금토일])요일" + TIME), _r_ko_week),
    (re.compile(r"(?:(이번\s*주|금주|다음\s*주|차주|담주)\s*(?:중|내|안)|(?<![가-힣])주중(?=에|으로|까지|\s|[,.]|$))"), _r_week_scope),
    (re.compile(r"(다음\s*주|차주)\s*초"), _r_week_start),
    (re.compile(r"(?<![0-9])([0-9]{1,3})\s*(일|시간)\s*(?:이내|내로|내에|안에|안으로|내)"), _r_duration),
    (re.compile(r"(?<![A-Za-z])within\s+([0-9]{1,3})\s+(business\s+days?|days?|hours?)(?![A-Za-z])", re.I), _r_within),
    (re.compile(r"(?<![A-Za-z])(?:(?:end\s+of\s+(?:the\s+)?(?:business\s+)?day|EOD|COB)(?:\s+(?:on\s+)?(today|tomorrow|monday|tuesday|wednesday|thursday|friday))?|(today|tomorrow|tonight))(?![A-Za-z])", re.I), _r_en_rel),
    (re.compile(r"(?<![A-Za-z0-9_-])(?:(this|next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri)(?![A-Za-z0-9_-])", re.I), _r_en_week),
    (re.compile(r"(?<![0-9])(?:(오전|오후)\s*)?([0-9]{1,2})\s*시(?:\s*([0-9]{1,2})\s*분)?(?=\s*(?:까지|전까지|마감))"), _r_time_only),
]


def _kind(text, start, end):
    after = text[end:end + 12]
    before = text[max(0, start - 16):start].lower()
    raw = text[start:end].lower()
    if any(h in raw for h in RULES["deadlineRaw"]) or any(h in after for h in RULES["deadlineAfter"]) \
            or any(h in before for h in RULES["deadlineBefore"]):
        return "deadline"
    if any(h in after for h in RULES["deadlineSoft"]):
        return "deadline"
    around = text[max(0, start - 15):end + 15].lower()
    if any(h in around for h in RULES["meetingHints"]):
        return "meeting"
    return "mentioned"


def parse_dates(text, base):
    """Finds dates in text relative to base (the mail's received time). Returns [{raw, iso, kind}] in reading order."""
    b = parse_wall(base) or now_wall()
    src = text or ""
    taken, found, seen = [], [], set()
    for rx, resolve in PATTERNS:
        for m in rx.finditer(src):
            start, end = m.start(), m.end()
            if not m.group(0).strip() or any(start < e and s < end for s, e in taken):
                continue
            dt = resolve((m.group(0),) + m.groups(), b)
            if dt is None:
                continue
            taken.append((start, end))
            raw = m.group(0).strip()
            key = (raw, dt.date().isoformat())
            if key in seen:
                continue
            seen.add(key)
            found.append((start, {"raw": raw, "iso": iso_minutes(dt), "kind": _kind(src, start, end)}))
    return [hit for _, hit in sorted(found, key=lambda x: x[0])]


def period_bucket(received_at):
    """Default period bucket from the received time: before noon = morning."""
    dt = parse_wall(received_at)
    if dt is None:
        return "daily"
    return "morning" if dt.hour < 12 else "afternoon"
