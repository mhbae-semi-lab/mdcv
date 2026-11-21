"""Demo mail for the self-host server: the same synthetic fab set the browser build opens (packages/shared/samples)."""
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_CANDIDATES = (os.path.join(_HERE, "..", "..", "..", "packages", "shared", "samples", "fab-dev-30.json"),
               os.path.join(_HERE, "..", "packages", "shared", "samples", "fab-dev-30.json"))


def sample_mails():
    path = next(p for p in _CANDIDATES if os.path.isfile(p))
    with open(path, encoding="utf-8") as f:
        return [{"id": m["id"], "provider": "demo", "providerMessageId": m["id"], "subject": m["subject"], "senderName": m["senderName"],
                 "senderEmail": m["senderEmail"], "recipients": ["me@example.com"], "receivedAt": m["receivedAt"], "bodyText": m["bodyText"],
                 "isRead": False, "hasAttachment": "첨부" in m["bodyText"] or "attached" in m["bodyText"]} for m in json.load(f)]


SAMPLE_MAILS = sample_mails()
