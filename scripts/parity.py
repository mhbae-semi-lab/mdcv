"""Python and TypeScript engines must classify every mail identically.

Usage: python scripts/parity.py            (exit code 1 on any difference)
Needs Node 22.18+ (runs .ts files directly).
"""
import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
from mdcv.classifier import RuleClassifier  # noqa: E402

SETS = ["tests/golden.json", "packages/shared/samples/fab-blind2-30.json",
        "packages/shared/samples/fab-dev-30.json", "packages/shared/samples/fab-holdout-30.json"]


def diff(a, b, path=""):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            yield from diff(a.get(k), b.get(k), path + "." + k)
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            yield from diff(x, y, "%s[%d]" % (path, i))
    elif a != b:
        yield "%s: python=%r ts=%r" % (path, a, b)


def main():
    files = [f for f in SETS if os.path.isfile(os.path.join(ROOT, f))]
    ts = json.loads(subprocess.run(["node", "scripts/engine-dump.mjs"] + files, cwd=ROOT, capture_output=True,
                                   check=True, encoding="utf-8").stdout)
    clf, total, bad = RuleClassifier(), 0, 0
    for f in files:
        same = 0
        mails = json.load(open(os.path.join(ROOT, f), encoding="utf-8"))
        for mail in mails:
            problems = list(diff(clf.classify(mail), ts.get(mail["id"])))
            total += 1
            if problems:
                bad += 1
                print("MISMATCH %s %s\n  %s" % (f, mail["id"], "\n  ".join(problems[:5])))
            else:
                same += 1
        print("%-45s %d/%d identical" % (f, same, len(mails)))
    print("parity: %d/%d identical" % (total - bad, total))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
