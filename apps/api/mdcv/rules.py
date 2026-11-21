"""Rule dictionaries shared with the TypeScript engine (packages/shared/rules.json)."""
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_CANDIDATES = (
    os.getenv("MDCV_RULES", ""),
    os.path.join(_HERE, "..", "..", "..", "packages", "shared", "rules.json"),  # repository layout
    os.path.join(_HERE, "..", "packages", "shared", "rules.json"),  # Docker image layout (/app)
)


def _load():
    for path in _CANDIDATES:
        if path and os.path.isfile(path):
            with open(path, encoding="utf-8") as f:
                return json.load(f)
    raise FileNotFoundError("packages/shared/rules.json not found (set MDCV_RULES)")


RULES = _load()


def js_repl(repl):
    """rules.json stores JS-style replacements ($1); Python's re.sub wants \1."""
    import re
    return re.sub(r"\$([0-9])", r"\\1", repl)
