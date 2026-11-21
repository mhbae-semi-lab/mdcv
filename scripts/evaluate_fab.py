"""Scores the rule engine on the synthetic fab mail sets (labels written blind to the rules).

Usage:
  python scripts/evaluate_fab.py [--set dev|holdout] [--verbose] [--dump other_engine_output.json]

Reports reply-needed misses (the completion measure: 0), false alarms, importance level agreement,
deadline extraction and equipment recall. The sets are synthetic: treat the numbers as a regression
check on known phrasing, not as accuracy on real mail.
"""
import argparse
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
from mdcv.classifier import RuleClassifier  # noqa: E402
from mdcv.rules import RULES  # noqa: E402

HOT = {"urgent", "important"}


def canonical(term):
    term = term.replace("_", "-")  # the engine writes tool IDs with "-" (AOI_09 -> AOI-09)
    low = term.lower()
    for entry in RULES["equipment"]:
        if any(low == t.lower() for t in entry):
            return entry[0]
    return term


def predicted_due(cls):
    items = [a for a in cls.get("actionItems", []) if a.get("dueIso")]
    if items:
        return items[0]["dueIso"]
    dl = [d for d in cls["entities"]["dates"] if d.get("kind") == "deadline" and d.get("iso")]
    return dl[0]["iso"] if dl else None


def score(mails, preds, verbose=False):
    r = {"total": len(mails), "replyLabelled": 0, "replyMissed": [], "replyFalseAlarm": [], "levelExact": 0,
         "hotMissed": [], "dueLabelled": 0, "dueExact": 0, "dueDay": 0, "dueWrong": [], "equipLabelled": 0, "equipFound": 0}
    for m in mails:
        lab, cls = m["labels"], preds[m["id"]]
        need = cls["needsReply"]
        if lab["needsReply"]:
            r["replyLabelled"] += 1
            if not need:
                r["replyMissed"].append(m["id"])
        elif need:
            r["replyFalseAlarm"].append(m["id"])
        level = cls["importance"]["level"]
        r["levelExact"] += level == lab["level"]
        if lab["level"] in HOT and level not in HOT:
            r["hotMissed"].append(m["id"])
        if lab.get("due"):
            r["dueLabelled"] += 1
            got = predicted_due(cls)
            if got == lab["due"]:
                r["dueExact"] += 1
            if got and got[:10] == lab["due"][:10]:
                r["dueDay"] += 1
            else:
                r["dueWrong"].append("%s want %s (%s) got %s" % (m["id"], lab["due"], lab.get("dueText"), got))
        want = {canonical(e) for e in lab.get("equipment", [])}
        have = set(cls["entities"]["equipment"]) | set(cls["entities"].get("alarms", []))
        r["equipLabelled"] += len(want)
        r["equipFound"] += len(want & have)
        if verbose and (need != lab["needsReply"] or level != lab["level"] or want - have):
            print("  %s [%s→%s %s→%s] %s | missing equip %s | %s" % (
                m["id"], lab["level"], level, lab["needsReply"], need, m["subject"][:50], sorted(want - have),
                "; ".join(cls["importance"]["reasons"])))
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="dev", choices=["dev", "holdout", "blind2"])
    ap.add_argument("--dump", help="classification JSON {id: classification} from another engine (e.g. the v1 baseline)")
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()
    mails = json.load(open(os.path.join(ROOT, "packages", "shared", "samples", "fab-%s-30.json" % a.set), encoding="utf-8"))
    if a.dump:
        preds = json.load(open(a.dump, encoding="utf-8"))
    else:
        clf = RuleClassifier()
        preds = {m["id"]: clf.classify(m) for m in mails}
    r = score(mails, preds, a.verbose)
    summary = {
        "set": a.set, "mails": r["total"],
        "replyNeeded": r["replyLabelled"], "replyMissed": len(r["replyMissed"]), "replyFalseAlarm": len(r["replyFalseAlarm"]),
        "levelExact": "%d/%d" % (r["levelExact"], r["total"]), "hotMissed": len(r["hotMissed"]),
        "dueDay": "%d/%d" % (r["dueDay"], r["dueLabelled"]), "dueExact": "%d/%d" % (r["dueExact"], r["dueLabelled"]),
        "equipmentRecall": "%d/%d" % (r["equipFound"], r["equipLabelled"]),
        "missedIds": r["replyMissed"], "falseAlarmIds": r["replyFalseAlarm"], "hotMissedIds": r["hotMissed"],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    if a.verbose:
        for w in r["dueWrong"]:
            print("  due:", w)
    return 1 if r["replyMissed"] else 0


if __name__ == "__main__":
    sys.exit(main())
