"""실메일 라벨 데이터로 분류 정확도를 실측한다.

사용법:
  1) tests/real_labeled.json 만들기 (아래 형식, 익명화 필수)
  2) python scripts/evaluate_real.py
형식: [{"subject": "...", "senderEmail": "...", "bodyText": "...", "receivedAt": "ISO", "expected": "urgent|important|normal|reference"}]
개인정보(이메일 실주소·전화·이름)는 넣기 전에 반드시 익명화하세요.
결과는 docs/test-results.json의 realMail 섹션에 병합됩니다.
"""
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
from mdcv.classifier import RuleClassifier  # noqa: E402

PATH = os.path.join(ROOT, "tests", "real_labeled.json")
EXAMPLE = [{"subject": "예시: 설비 점검 요청", "senderEmail": "user@example.com",
            "bodyText": "내일까지 점검 결과를 회신 부탁드립니다.", "receivedAt": "2026-10-23T09:00:00",
            "expected": "important"}]


def evaluate(path=PATH, classifier=None):
    if not os.path.isfile(path):
        return {"status": "no_data", "note": "tests/real_labeled.json 없음. 형식 예시는 scripts/evaluate_real.py 상단 참고", "example": EXAMPLE}
    data = json.load(open(path, encoding="utf-8"))
    clf = classifier or RuleClassifier()
    exact, confusion, misses = 0, {}, []
    for i, item in enumerate(data):
        mail = {"id": "real-%d" % i, "subject": item.get("subject", ""), "senderName": item.get("senderName", ""),
                "senderEmail": item.get("senderEmail", ""), "receivedAt": item.get("receivedAt", "2026-10-23T09:00:00"),
                "bodyText": item.get("bodyText", "")}
        pred = clf.classify(mail)["importance"]["level"]
        exp = item["expected"]
        confusion.setdefault(exp, {}).setdefault(pred, 0)
        confusion[exp][pred] += 1
        exact += int(pred == exp)
        if pred != exp and len(misses) < 20:
            misses.append({"subject": item.get("subject", "")[:60], "expected": exp, "predicted": pred})
    return {"status": "ok", "total": len(data), "exactLevelAccuracy": round(exact / max(1, len(data)), 4),
            "confusion": confusion, "misses": misses,
            "note": "오분류(misses)를 보고 설비 사전·키워드 가중치·사용자 규칙을 조정하세요."}


if __name__ == "__main__":
    report = evaluate()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    out_path = os.path.join(ROOT, "docs", "test-results.json")
    if os.path.isfile(out_path):
        results = json.load(open(out_path, encoding="utf-8"))
        results["realMail"] = report
        json.dump(results, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print("docs/test-results.json에 realMail 섹션을 병합했습니다.")
