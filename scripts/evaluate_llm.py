"""LLM 품질 평가: 규칙 결과와 LLM 보강 결과를 골든/실메일 라벨과 비교한다.

키가 없으면 규칙 기준선만 재고, 키가 있으면 같은 데이터로 LLM을 호출해
중요도 일치율과 요약 길이를 비교한다. 프롬프트를 바꾸면 PROMPT_VERSION을 올리고 재실행하세요.
결과는 docs/test-results.json의 llm 섹션에 병합됩니다.
"""
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
sys.path.insert(0, os.path.dirname(__file__))
from evaluate_real import evaluate as eval_real  # noqa: E402
from make_golden import make  # noqa: E402
from mdcv.classifier import RuleClassifier  # noqa: E402
from mdcv.llm import LLMAdapter, PROMPT_VERSION  # noqa: E402

clf = RuleClassifier(vip_senders=["boss@example.com"])
golden = make()
rule_hit = sum(int(clf.classify(g)["importance"]["level"] == g["expected"]) for g in golden)

adapter = LLMAdapter()
report = {"promptVersion": PROMPT_VERSION, "adapter": adapter.stats(),
          "goldenRuleSameLevel": "%d/%d" % (rule_hit, len(golden)), "realMail": eval_real()}

if adapter.enabled:
    hit, summaries = 0, []
    for g in golden[:20]:  # 비용 고려해 20건만 표본 평가
        base = clf.classify(g)
        out = adapter.enhance(g, base)
        hit += int(out["importance"]["level"] == g["expected"])
        summaries.append(len(out.get("summary", "")))
    report["goldenLlmSample"] = {"n": 20, "sameLevel": hit,
                                 "avgSummaryChars": round(sum(summaries) / max(1, len(summaries)), 1),
                                 "usageAfter": adapter.stats()["usage"]}
else:
    report["goldenLlmSample"] = {"status": "skipped", "reason": "MDCV_LLM_API_KEY 미설정. 규칙 기준선만 측정"}

print(json.dumps(report, ensure_ascii=False, indent=2))
out_path = os.path.join(ROOT, "docs", "test-results.json")
if os.path.isfile(out_path):
    results = json.load(open(out_path, encoding="utf-8"))
    results["llm"] = report
    json.dump(results, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
