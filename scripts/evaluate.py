"""테스트 실행 + 골든셋 평가 -> docs/test-results.json 생성."""
import io
import json
import os
import sys
import unittest
from datetime import datetime

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from make_golden import make  # noqa: E402
from mdcv.classifier import RuleClassifier  # noqa: E402

# 1) 단위 테스트
suite = unittest.TestLoader().discover(os.path.join(ROOT, "tests"), pattern="test_*.py")
stream = io.StringIO()
result = unittest.TextTestRunner(stream=stream, verbosity=1).run(suite)

# 2) 골든셋 평가
golden = make()
with open(os.path.join(ROOT, "tests", "golden.json"), "w", encoding="utf-8") as f:
    json.dump(golden, f, ensure_ascii=False, indent=1)
clf = RuleClassifier(vip_senders=["boss@example.com"])
exact = 0
confusion = {}
for item in golden:
    pred = clf.classify(item)["importance"]["level"]
    exp = item["expected"]
    confusion.setdefault(exp, {}).setdefault(pred, 0)
    confusion[exp][pred] = confusion[exp].get(pred, 0) + 1
    exact += int(pred == exp)


def fab_sets():
    """Synthetic fab sets written blind to the rules (scripts/evaluate_fab.py has the details)."""
    from evaluate_fab import score
    out = {}
    for name in ("dev", "holdout", "blind2"):
        mails = json.load(open(os.path.join(ROOT, "packages", "shared", "samples", "fab-%s-30.json" % name), encoding="utf-8"))
        c = RuleClassifier()
        r = score(mails, {m["id"]: c.classify(m) for m in mails})
        out[name] = {"mails": r["total"], "replyNeeded": r["replyLabelled"], "replyMissed": len(r["replyMissed"]),
                     "replyFalseAlarm": len(r["replyFalseAlarm"]), "hotMissed": len(r["hotMissed"]),
                     "dueDay": "%d/%d" % (r["dueDay"], r["dueLabelled"]), "equipment": "%d/%d" % (r["equipFound"], r["equipLabelled"])}
    out["note"] = "Numbers after tuning on these sets; first-look numbers on unseen sets are in docs/evaluation-log.json."
    return out

report = {
    "generatedAt": datetime.now().isoformat(timespec="seconds"),
    "unitTests": {"total": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
                  "passed": result.testsRun - len(result.failures) - len(result.errors),
                  "success": result.wasSuccessful()},
    "goldenRegression": {"note": "합성 템플릿 4종 x 25통. 규칙이 바뀌어도 기존 판단이 유지되는지 보는 회귀 확인용이며 정확도가 아닙니다.",
                         "total": len(golden), "sameLevel": exact, "confusion": confusion},
    "fabSets": fab_sets(),
    "environment": {"python": sys.version.split()[0]},
    "detail": stream.getvalue()[-2000:],
}
with open(os.path.join(ROOT, "docs", "test-results.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print(json.dumps(report, ensure_ascii=False, indent=2))
sys.exit(0 if result.wasSuccessful() else 1)
