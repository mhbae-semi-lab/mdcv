"""첨부파일 텍스트 추출. 외부 라이브러리 없이 표준 라이브러리만 쓴다.

지원: txt/csv, docx(OOXML), xlsx(공유 문자열), pdf(pypdf가 설치된 경우만, 없으면 건너뜀)
실패하면 빈 문자열을 돌려줘 동기화를 막지 않는다.
"""
import io
import re
import zipfile
import xml.etree.ElementTree as ET

MAX_CHARS = 4000


def extract(filename, data):
    if not data:
        return ""
    name = (filename or "").lower()
    try:
        if name.endswith((".txt", ".csv", ".md", ".log")):
            text = data.decode("utf-8", errors="replace")
        elif name.endswith(".docx"):
            text = _ooxml_text(data, "word/document.xml")
        elif name.endswith(".xlsx"):
            text = _xlsx_text(data)
        elif name.endswith(".pdf"):
            text = _pdf_text(data)
        else:
            return ""
    except Exception:
        return ""
    return re.sub(r"\s+\n", "\n", text).strip()[:MAX_CHARS]


def _ooxml_text(data, member):
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        root = ET.fromstring(z.read(member))
    return "\n".join("".join(t.text or "" for t in p.iter(ns + "t")) for p in root.iter(ns + "p"))


def _xlsx_text(data):
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if "xl/sharedStrings.xml" not in z.namelist():
            return ""
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    return "\n".join("".join(t.text or "" for t in si.iter(ns + "t")) for si in root.iter(ns + "si"))


def _pdf_text(data):
    try:
        from pypdf import PdfReader  # 선택 의존성
    except Exception:
        return ""
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages[:10])
