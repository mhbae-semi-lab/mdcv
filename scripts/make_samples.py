"""Writes synthetic sample mail files (.eml, .mbox, .msg and broken ones) from fab-dev-30.json.

Usage: python scripts/make_samples.py
Output: packages/shared/samples/files/  (used by the importer tests and the manual)
All content is synthetic. The .msg writer below is a minimal OLE compound file (v3, 512-byte sectors).
"""
import base64
import json
import os
import quopri
import struct
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "packages", "shared", "samples", "files")
KST = timezone(timedelta(hours=9))


def b_word(text, charset="utf-8"):
    return "=?%s?B?%s?=" % (charset, base64.b64encode(text.encode(charset)).decode())


def eml_utf8(m, html=False, attach=False):
    date = format_datetime(datetime.fromisoformat(m["receivedAt"]).replace(tzinfo=KST))
    head = ["From: %s <%s>" % (b_word(m["senderName"]), m["senderEmail"]), "To: me@example.com",
            "Subject: %s" % b_word(m["subject"]), "Date: %s" % date, "Message-ID: <%s@mdcv.example>" % m["id"], "MIME-Version: 1.0"]
    text_part = ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "",
                 base64.encodebytes(m["bodyText"].encode()).decode()]
    if not html and not attach:
        return "\r\n".join(head + text_part)
    parts = [text_part]
    if html:
        body = "<html><body><p>" + m["bodyText"].replace("\n", "<br>") + "</p></body></html>"
        parts.append(["Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: quoted-printable", "",
                      quopri.encodestring(body.encode()).decode()])
    alt = "----=_alt_" + m["id"]
    inner = ["Content-Type: multipart/alternative; boundary=\"%s\"" % alt, ""]
    for p in parts:
        inner += ["--" + alt] + p
    inner += ["--" + alt + "--", ""]
    if not attach:
        return "\r\n".join(head + inner)
    mix = "----=_mix_" + m["id"]
    out = head + ["Content-Type: multipart/mixed; boundary=\"%s\"" % mix, "", "--" + mix] + inner
    out += ["--" + mix, "Content-Type: application/pdf; name=\"report.pdf\"", "Content-Disposition: attachment; filename=\"report.pdf\"",
            "Content-Transfer-Encoding: base64", "", base64.encodebytes(b"%PDF-1.4 synthetic").decode(), "--" + mix + "--", ""]
    return "\r\n".join(out)


def eml_euckr(m):
    date = format_datetime(datetime.fromisoformat(m["receivedAt"]).replace(tzinfo=KST))
    head = ["From: %s <%s>" % (b_word(m["senderName"], "euc-kr"), m["senderEmail"]), "To: me@example.com",
            "Subject: %s" % b_word(m["subject"], "euc-kr"), "Date: %s" % date, "Message-ID: <%s@mdcv.example>" % m["id"],
            "MIME-Version: 1.0", "Content-Type: text/plain; charset=\"ks_c_5601-1987\"", "Content-Transfer-Encoding: quoted-printable", "", ""]
    return ("\r\n".join(head)).encode() + quopri.encodestring(m["bodyText"].encode("euc-kr"))


# --- minimal OLE compound file writer ------------------------------------------------------------------------------------
SECT, MINI, CUTOFF = 512, 64, 4096
END, FREE, FATSECT, NOSTREAM = 0xFFFFFFFE, 0xFFFFFFFF, 0xFFFFFFFD, 0xFFFFFFFF


def cfb(tree):
    """tree: {name: bytes | dict} under the root. Returns the compound file bytes."""
    nodes = [{"name": "Root Entry", "type": 5, "kids": []}]

    def add(parent, items):
        for name in sorted(items, key=lambda n: (len(n), n.upper())):
            val = items[name]
            node = {"name": name, "type": 1 if isinstance(val, dict) else 2, "kids": [], "data": None if isinstance(val, dict) else val}
            nodes.append(node)
            parent["kids"].append(len(nodes) - 1)
            if isinstance(val, dict):
                add(node, val)
    add(nodes[0], tree)
    mini, big = bytearray(), []  # big: (node, bytes)
    for n in nodes:
        if n["type"] == 2:
            d = n["data"]
            n["size"] = len(d)
            if len(d) < CUTOFF:
                n["start"] = len(mini) // MINI if d else END
                mini += d + b"\0" * (-len(d) % MINI)
            else:
                big.append(n)
    minifat = []
    for n in nodes:
        if n["type"] == 2 and n["size"] < CUTOFF and n["size"]:
            count = -(-n["size"] // MINI)
            minifat += [n["start"] + i + 1 for i in range(count - 1)] + [END]
    dir_bytes = bytearray()
    for n in nodes:
        e = bytearray(128)
        name = n["name"].encode("utf-16-le") + b"\0\0"
        e[0:len(name)] = name
        struct.pack_into("<HBB", e, 0x40, len(name), n["type"], 1)
        kids = n["kids"]
        struct.pack_into("<III", e, 0x44, NOSTREAM, NOSTREAM, kids[0] if kids else NOSTREAM)
        n["dir"] = e
        dir_bytes += e
    for n in nodes:  # siblings as a right-leaning chain (all black): valid for readers that walk the tree
        for a, b in zip(n["kids"], n["kids"][1:]):
            struct.pack_into("<I", nodes[a]["dir"], 0x48, b)
    dir_bytes = b"".join(n["dir"] for n in nodes)
    dir_bytes += b"\0" * (-len(dir_bytes) % SECT)
    mf_bytes = b"".join(struct.pack("<I", x) for x in minifat)
    mf_bytes += struct.pack("<I", FREE) * ((-len(mf_bytes) % SECT) // 4)
    mini_bytes = bytes(mini) + b"\0" * (-len(mini) % SECT)
    counts = [len(dir_bytes) // SECT, len(mf_bytes) // SECT, len(mini_bytes) // SECT] + [-(-len(n["data"]) // SECT) for n in big]
    data_sectors = sum(counts)
    nfat = 1
    while nfat * (SECT // 4) < nfat + data_sectors:
        nfat += 1
    fat = [FATSECT] * nfat
    starts = []
    for c in counts:
        starts.append(len(fat) if c else END)
        fat += [len(fat) + i + 1 for i in range(c - 1)] + ([END] if c else [])
    fat += [FREE] * (nfat * (SECT // 4) - len(fat))
    dir_start, mf_start, mini_start = starts[0], starts[1], starts[2]
    for n, s in zip(big, starts[3:]):
        n["start"] = s
    root = nodes[0]
    root["start"], root["size"] = (mini_start if mini else END), len(mini)
    out_dir = bytearray(dir_bytes)
    for i, n in enumerate(nodes):
        if n["type"] in (2, 5):
            struct.pack_into("<II", out_dir, i * 128 + 0x74, n["start"] if n.get("size") or n["type"] == 5 else END, n.get("size", 0))
    header = bytearray(SECT)
    header[0:8] = bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
    struct.pack_into("<HHHHH", header, 0x18, 0x3E, 3, 0xFFFE, 9, 6)
    struct.pack_into("<IIIIIIIII", header, 0x28, 0, nfat, dir_start, 0, CUTOFF, mf_start if minifat else END,
                     len(mf_bytes) // SECT if minifat else 0, END, 0)
    for i in range(109):
        struct.pack_into("<I", header, 0x4C + i * 4, i if i < nfat else FREE)
    body = b"".join(struct.pack("<I", x) for x in fat) + bytes(out_dir) + mf_bytes + mini_bytes
    for n in big:
        body += n["data"] + b"\0" * (-len(n["data"]) % SECT)
    return bytes(header) + body


def msg(m):
    def s(text):
        return text.encode("utf-16-le")

    when = datetime.fromisoformat(m["receivedAt"]).replace(tzinfo=KST)
    ft = int((when - datetime(1601, 1, 1, tzinfo=timezone.utc)).total_seconds() * 10 ** 7)
    strings = {0x0037: m["subject"], 0x0C1A: m["senderName"], 0x0C1F: m["senderEmail"], 0x5D01: m["senderEmail"],
               0x1000: m["bodyText"], 0x1035: "<%s@mdcv.example>" % m["id"]}
    props = bytearray(32)
    struct.pack_into("<IIII", props, 8, 1, 1, 1, 1)
    for pid, text in strings.items():
        props += struct.pack("<IIII", (pid << 16) | 0x001F, 6, len(s(text)) + 2, 0)
    props += struct.pack("<II", (0x0E06 << 16) | 0x0040, 6) + struct.pack("<Q", ft)
    props += struct.pack("<II", (0x3FDE << 16) | 0x0003, 6) + struct.pack("<II", 65001, 0)
    tree = {"__substg1.0_%04X001F" % pid: s(text) for pid, text in strings.items()}
    tree["__properties_version1.0"] = bytes(props)
    tree["__nameid_version1.0"] = {"__substg1.0_00020102": b"", "__substg1.0_00030102": b"", "__substg1.0_00040102": b""}
    tree["__recip_version1.0_#00000000"] = {"__substg1.0_39FE001F": s("me@example.com"), "__substg1.0_3001001F": s("Me"),
                                             "__properties_version1.0": bytes(8)}
    tree["__attach_version1.0_#00000000"] = {"__substg1.0_3707001F": s("report.pdf"), "__substg1.0_37010102": b"%PDF-1.4 synthetic" * 300,
                                              "__properties_version1.0": bytes(8)}
    return cfb(tree)


def main():
    mails = {m["id"]: m for m in json.load(open(os.path.join(ROOT, "packages", "shared", "samples", "fab-dev-30.json"), encoding="utf-8"))}
    os.makedirs(OUT, exist_ok=True)
    files = {
        "alarm-INSP-03.eml": eml_utf8(mails["dev-01"]).encode(),
        "report-request-html.eml": eml_utf8(mails["dev-03"], html=True).encode(),
        "review-with-attachment.eml": eml_utf8(mails["dev-14"], html=True, attach=True).encode(),
        "legacy-euckr.eml": eml_euckr(mails["dev-21"]),
        "customer-request.msg": msg(mails["dev-05"]),
        "chiller-leak.msg": msg(mails["dev-17"]),
        "broken-no-headers.eml": "이 파일은 메일이 아닙니다.\n그냥 메모입니다.\n".encode(),
        "broken-truncated.msg": msg(mails["dev-22"])[:700],
    }
    box = []
    for mid in ["dev-%02d" % i for i in range(1, 31)]:
        m = mails[mid]
        raw = eml_utf8(m).replace("\r\n", "\n")
        raw = raw.replace("\nFrom ", "\n>From ")
        box.append("From %s %s\n%s\n" % (m["senderEmail"], datetime.fromisoformat(m["receivedAt"]).strftime("%a %b %d %H:%M:%S %Y"), raw))
    files["fab-week-30.mbox"] = "\n".join(box).encode()
    for name, data in files.items():
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(data)
    print("wrote %d files to %s" % (len(files), OUT))


if __name__ == "__main__":
    main()
