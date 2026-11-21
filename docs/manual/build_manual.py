# -*- coding: utf-8 -*-
"""MDCV 사용자 매뉴얼(PPTX) 생성기. llm-pulse docs/manual/build_manual.py 양식(로그 분석기 판을 거친 웹 앱용)을 이 앱에 맞게 고쳐 쓴다.

    python docs/manual/build_manual.py

스크린샷은 docs/manual/capture.mjs 로 만든 shots/*.png (1280x800 CSS px, 배율 1.5) 와
말풍선 자리 shots/marks.json (CSS px 사각형) 을 쓴다. 화면은 모두 합성 데이터다.
PDF: PowerPoint 로 열어 PDF 로 저장 (README 의 PowerShell 한 줄 참고).
"""
import json
import os
import sys

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
ASSETS = os.path.join(HERE, "assets")
CACHE = os.path.join(HERE, ".cache")
OUT = os.path.join(HERE, "MDCV-User-Manual-ko.pptx")
VERSION = "1.0.0"
DATE = "2026.11.22"
NAME = "MDCV 메일 분류 · 검증기"
MARKS = json.load(open(os.path.join(SHOTS, "marks.json"), encoding="utf-8"))
DIP = (1280, 800)

# ---------------------------------------------------------------- 디자인 토큰 (llm-pulse 매뉴얼과 같음, 강조색만 앱 색)
INK = RGBColor(0x1F, 0x29, 0x37)
SUB = RGBColor(0x5B, 0x65, 0x73)
BLUE = RGBColor(0x1E, 0x4E, 0x8C)
NAVY = RGBColor(0x1E, 0x2A, 0x36)
CARD = RGBColor(0xF3, 0xF5, 0xF8)
LINE = RGBColor(0xD9, 0xDE, 0xE5)
AMBER = RGBColor(0xE5, 0xA0, 0x2D)
AMBER_BG = RGBColor(0xFF, 0xF6, 0xE5)
AMBER_TX = RGBColor(0x7A, 0x4E, 0x00)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
SOFT = RGBColor(0xF4, 0xC4, 0x30)
YELLOW = RGBColor(0xF4, 0xC4, 0x30)
FONT = "맑은 고딕"
MONO = "Consolas"

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
TOTAL = 23
state = {"n": 0}


def new_slide():
    state["n"] += 1
    return prs.slides.add_slide(prs.slide_layouts[6])


def box(s, x, y, w, h, fill=None, line=None, shape=MSO_SHAPE.RECTANGLE, radius=None, lw=0.75):
    sh = s.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid()
        sh.fill.fore_color.rgb = fill
    if line is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line
        sh.line.width = Pt(lw)
    sh.shadow.inherit = False
    if radius is not None and shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        sh.adjustments[0] = radius
    return sh


def rbox(s, x, y, w, h, fill=CARD, line=None, radius=0.03, lw=0.75):
    return box(s, x, y, w, h, fill, line, MSO_SHAPE.ROUNDED_RECTANGLE, radius, lw)


def text(s, x, y, w, h, t, size=12, bold=False, color=INK, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
         shape=None, font=FONT, spacing=None):
    tb = shape or s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.05)
    tf.margin_top = tf.margin_bottom = Inches(0.02)
    tf.vertical_anchor = anchor
    lines = t if isinstance(t, list) else [t]
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if spacing:
            p.line_spacing = spacing
        r = p.add_run()
        r.text = line
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.color.rgb = color
        r.font.name = font
    return tb


def num_circle(s, x, y, n, d=0.3, size=11):
    c = box(s, x, y, d, d, fill=BLUE, line=WHITE, shape=MSO_SHAPE.OVAL, lw=1.5)
    text(s, 0, 0, 0, 0, str(n), size, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=c)
    c.text_frame.margin_left = c.text_frame.margin_right = 0
    return c


# ---------------------------------------------------------------- 공통 틀
def header(s, section, title, bullets):
    pill = box(s, 10.2, 0.0, 2.7, 0.34, fill=BLUE, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.3)
    text(s, 0, 0, 0, 0, section, 10, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=pill)
    text(s, 0.45, 0.32, 11.5, 0.6, f"[MDCV] {title}", 28, True)
    box(s, 0.5, 1.0, 0.9, 0.06, fill=BLUE)
    for i, t in enumerate(bullets):
        box(s, 0.55, 1.37 + i * 0.36, 0.07, 0.07, fill=BLUE, shape=MSO_SHAPE.OVAL)
        text(s, 0.72, 1.24 + i * 0.36, 12.1, 0.32, t, 13.5)
    footer(s)


def footer(s):
    box(s, 0.5, 7.05, 12.33, 0.01, fill=LINE)
    s.shapes.add_picture(os.path.join(ASSETS, "icon.png"), Inches(0.5), Inches(7.12), Inches(0.22), Inches(0.22))
    text(s, 0.78, 7.1, 6, 0.25, f"{NAME} 사용자 매뉴얼  ·  v{VERSION}  ·  배민혁", 9, False, SUB)
    text(s, 11.8, 7.1, 1.03, 0.25, f"{state['n']} / {TOTAL}", 9, True, SUB, PP_ALIGN.RIGHT)


# ---------------------------------------------------------------- 스크린샷 카드
def load_shot(name, crop=None, dip=DIP):
    """crop: CSS px 사각형 (x0,y0,x1,y1). 반환: (경로, 크기, 오프셋)"""
    path = os.path.join(SHOTS, f"{name}.png")
    im = Image.open(path)
    k = im.width / dip[0]
    if not crop:
        return path, dip, (0, 0)
    os.makedirs(CACHE, exist_ok=True)
    x0, y0, x1, y1 = crop
    out = os.path.join(CACHE, f"{name}_{x0}_{y0}_{x1}_{y1}.png")
    im.crop((round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k))).save(out, optimize=True)
    return out, (x1 - x0, y1 - y0), (x0, y0)


def M(name, *idx):
    """marks.json 에서 말풍선 자리 고르기 (숫자 대신 사각형을 직접 줄 수도 있음)"""
    out = []
    for i in idx:
        r = MARKS[name][i] if isinstance(i, int) else i
        if r:
            out.append(tuple(r))
    return out


def shot_card(s, x, y, w, h, title, name, callouts=(), crop=None, dip=DIP, d=0.24):
    rbox(s, x, y, w, h)
    text(s, x + 0.15, y + 0.1, w - 0.3, 0.32, title, 13, True)
    path, (dw, dh), (ox, oy) = load_shot(name, crop, dip)
    bw, bh = w - 0.4, h - 0.82  # 아래 0.2in 는 "합성 데이터" 표기 자리
    k = min(bw / dw, bh / dh)
    iw, ih = dw * k, dh * k
    ix, iy = x + (w - iw) / 2, y + 0.5
    box(s, ix - 0.02, iy - 0.02, iw + 0.04, ih + 0.04, fill=WHITE, line=LINE)
    s.shapes.add_picture(path, Inches(ix), Inches(iy), Inches(iw), Inches(ih))
    for n, r in enumerate(callouts, 1):
        x0, y0, x1, y1 = r
        x0, y0, x1, y1 = max(x0, ox), max(y0, oy), min(x1, ox + dw), min(y1, oy + dh)
        box(s, ix + (x0 - ox) * k, iy + (y0 - oy) * k, max(0.05, (x1 - x0) * k), max(0.05, (y1 - y0) * k), fill=None, line=BLUE,
            shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.08, lw=1.75)
        c = box(s, ix + (x0 - ox) * k - d / 2, iy + (y0 - oy) * k - d / 2, d, d, fill=BLUE, line=WHITE,
                shape=MSO_SHAPE.OVAL, lw=1.25)
        text(s, 0, 0, 0, 0, str(n), 10, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=c)
        c.text_frame.margin_left = c.text_frame.margin_right = 0
    text(s, x + w - 3.0, y + h - 0.27, 2.85, 0.22, "※ 합성 데이터로 찍은 화면", 8.5, False, SUB, PP_ALIGN.RIGHT)


def steps_card(s, x, y, w, h, steps, title="사용 순서", tip=None, desc_size=10):
    rbox(s, x, y, w, h)
    text(s, x + 0.15, y + 0.1, w - 0.3, 0.32, title, 13, True)
    n = len(steps)
    top = y + 0.52
    avail = h - 0.52 - (0.62 if tip else 0.15)
    pitch = min(0.8, avail / n)
    for i, (hd, ds) in enumerate(steps):
        yy = top + i * pitch
        num_circle(s, x + 0.2, yy + 0.03, i + 1)
        text(s, x + 0.62, yy - 0.02, w - 0.8, 0.28, hd, 12, True)
        text(s, x + 0.62, yy + 0.24, w - 0.8, pitch - 0.22, ds, desc_size, False, SUB)
    if tip:
        t = rbox(s, x + 0.15, y + h - 0.55, w - 0.3, 0.42, fill=AMBER_BG, line=AMBER, radius=0.15)
        text(s, 0, 0, 0, 0, "Tip  " + tip, 9.5, False, AMBER_TX, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE, shape=t)
        t.text_frame.margin_left = Inches(0.12)


CY, CH = 2.45, 4.5      # 카드 영역
LX, LW = 0.5, 7.0       # 왼쪽(스크린샷) 카드
RX, RW = 7.65, 5.18     # 오른쪽(순서) 카드


def shot_steps(section, title, bullets, shot, callouts, steps, tip=None, card_title=None, crop=None, desc_size=10):
    s = new_slide()
    header(s, section, title, bullets)
    shot_card(s, LX, CY, LW, CH, card_title or title, shot, callouts, crop)
    steps_card(s, RX, CY, RW, CH, steps, tip=tip, desc_size=desc_size)
    return s




# ================================================================ 1. 표지
def cover():
    s = new_slide()
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = NAVY
    s.shapes.add_picture(os.path.join(ASSETS, "icon.png"), Inches(0.8), Inches(0.9), Inches(0.9), Inches(0.9))
    text(s, 0.75, 1.95, 5.8, 0.9, "MDCV", 46, True, WHITE)
    text(s, 0.8, 2.85, 5.8, 0.5, "메일 분류 · 검증기  사용자 매뉴얼", 22, False, SOFT)
    box(s, 0.85, 3.75, 0.9, 0.06, fill=YELLOW)
    text(s, 0.8, 3.95, 5.8, 1.2, ["설비 · 알람 코드 · 마감을 아는 메일 분류기", "브라우저 안에서 파일만으로, 또는 Docker 셀프호스트로"], 15, False, RGBColor(0xC9, 0xD3, 0xE0))
    text(s, 0.8, 5.2, 7, 0.3, f"Version {VERSION}   ·   {DATE}   ·   배민혁", 11, False, RGBColor(0x8A, 0x97, 0xA8))
    path, _, _ = load_shot("Mailbox")
    box(s, 6.68, 0.98, 6.2, 3.895, fill=None, line=RGBColor(0x3A, 0x48, 0x58), lw=1.5)
    s.shapes.add_picture(path, Inches(6.7), Inches(1.0), Inches(6.16), Inches(3.85))
    text(s, 6.7, 4.95, 6.16, 0.3, "※ 화면은 모두 합성 데이터(반도체 검사 장비 현장 가상 메일)", 9.5, False, RGBColor(0x8A, 0x97, 0xA8), PP_ALIGN.RIGHT)


# ================================================================ 2. 목차
def toc():
    s = new_slide()
    pill = box(s, 10.2, 0.0, 2.7, 0.34, fill=BLUE, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.3)
    text(s, 0, 0, 0, 0, "목차", 10, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, shape=pill)
    text(s, 0.45, 0.32, 11.5, 0.6, "목차", 28, True)
    box(s, 0.5, 1.0, 0.9, 0.06, fill=BLUE)
    text(s, 0.55, 1.2, 12, 0.35, "처음 쓰는 분은 1번, 규칙을 바꾸거나 LLM 을 붙이려는 분은 3번을 먼저 보세요.", 13.5, False, SUB)
    groups = [
        ("1", "시작하기", [("3", "이 앱이 푸는 문제"), ("4", "설치와 첫 실행"), ("5", "화면 구성")]),
        ("2", "화면별 사용법", [("6", "읽기 창 · 근거 · 고치기"), ("7", "답장 초안"), ("8", "할 일 (기한순)"), ("9", "기간 요약")]),
        ("3", "현장 검증 절차", [("10", "4단계 한눈에"), ("11", "재현"), ("12", "비교"), ("13–14", "Shadow · 마스킹"), ("15", "전환 · 롤백")]),
        ("4", "내 데이터 · 개인정보", [("16", "가져올 수 있는 파일"), ("17", "가져오기 결과 · 오류"), ("18", "설정 · Outlook 연결"), ("19", "LLM 키 · 개인정보")]),
        ("5", "부록", [("20", "영어 · 다크 · 모바일 · 키보드"), ("21", "셀프호스트판"), ("22", "FAQ · 문제 해결"), ("23", "버전 정보")]),
    ]
    pos = [(0.5, 1.9, 3.95, 2.45), (4.69, 1.9, 3.95, 2.45), (8.88, 1.9, 3.95, 2.45),
           (0.5, 4.5, 6.05, 2.4), (6.78, 4.5, 6.05, 2.4)]
    for (no, name, items), (x, y, w, h) in zip(groups, pos):
        rbox(s, x, y, w, h)
        num_circle(s, x + 0.2, y + 0.2, no, 0.38, 13)
        text(s, x + 0.7, y + 0.2, w - 0.9, 0.4, name, 16, True, anchor=MSO_ANCHOR.MIDDLE)
        for i, (pg, nm) in enumerate(items):
            yy = y + 0.74 + i * 0.32
            text(s, x + 0.3, yy, 0.9, 0.3, pg, 11.5, True, BLUE)
            text(s, x + 1.2, yy, w - 1.4, 0.3, nm, 11.5, False, INK)
    footer(s)


# ================================================================ 3. 소개
def intro():
    s = new_slide()
    header(s, "시작하기", "이 앱이 푸는 문제", [
        "관점: 하루 30~100통 메일에서 설비 이상 · 회신이 필요한 요청 · 마감을 놓치지 않게 한다",
        "메일함 위에 설비를 아는 분류 층을 얹는다. 메일 클라이언트를 대체하지 않고, 스스로 메일을 보내지 않는다",
        "규칙이 먼저 판단하고, LLM 은 선택(내 키). LLM 답은 본문과 대조해 통과할 때만 쓴다",
    ])
    cards = [
        ("설비 · 알람이 기본 개념", "INSP-03 같은 장비 ID, 로드포트 · EFEM · 칠러 같은 모듈(영문 별칭 포함), ALM-2041 같은 알람 코드를 뽑아 설비별 메일 흐름을 만듭니다."),
        ("한국어 마감 → 기한순 할 일", "금주 중, 차주 화요일, 11/24(화), 익일 09시, 월말, 3일 이내, by Friday 를 실제 날짜 · 시각으로 바꿔 급한 순으로 정렬합니다."),
        ("파일만으로, 이 브라우저 안에서", ".eml · .mbox · .msg 를 끌어다 놓으면 끝. 서버가 없고, LLM 을 쓸 때는 가린 내용을 먼저 보여 줍니다."),
    ]
    for i, (hd, ds) in enumerate(cards):
        x = 0.5 + i * 4.19
        rbox(s, x, 2.45, 3.95, 1.95)
        num_circle(s, x + 0.2, 2.65, i + 1, 0.36)
        text(s, x + 0.68, 2.64, 3.1, 0.38, hd, 14.5, True, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + 0.25, 3.18, 3.5, 1.15, ds, 11, False, SUB)
    text(s, 0.5, 4.62, 6, 0.3, "메일이 할 일이 되기까지", 13, True)
    flow = [
        ("가져오기", [".eml · .mbox · .msg", "Outlook(읽기 전용)"]),
        ("규칙 분류", ["설비 · 알람 · 날짜 · 사람", "중요도 점수와 근거"]),
        ("할 일 · 요약", ["마감 표현 → 날짜", "기한순 정렬"]),
        ("현장 검증", ["재현 → 비교", "Shadow → 전환 · 롤백"]),
    ]
    w, gap = 2.78, 0.4
    for i, (hd, ln) in enumerate(flow):
        x = 0.5 + i * (w + gap)
        hl = i == 1
        rbox(s, x, 5.0, w, 1.75, fill=WHITE if hl else CARD, line=BLUE if hl else None, radius=0.04, lw=2)
        text(s, x + 0.1, 5.1, w - 0.2, 0.4, hd, 14, True, BLUE if hl else INK, PP_ALIGN.CENTER)
        text(s, x + 0.1, 5.6, w - 0.2, 1.0, ln, 10.5, False, SUB, PP_ALIGN.CENTER)
        if i < 3:
            box(s, x + w + 0.06, 5.72, gap - 0.12, 0.34, fill=BLUE, shape=MSO_SHAPE.RIGHT_ARROW)


# ================================================================ 4. 설치
def install():
    s = new_slide()
    header(s, "시작하기", "설치와 첫 실행", [
        "웹 주소를 열면 바로 씀. 브라우저의 '앱 설치'로 PWA 설치하면 오프라인에서도 열림",
        "처음 화면에서 '예시 세트 열기(합성 30통)'로 내 메일 없이 모든 기능을 둘러볼 수 있음",
        "계정 · 로그인이 없음. 데이터는 이 브라우저(IndexedDB)에만 저장",
    ])
    shot_card(s, 0.5, CY, 6.6, CH, "첫 화면", "Welcome", M("Welcome", 0, 1, 2), crop=(250, 40, 1280, 560))
    steps_card(s, 7.35, CY, 5.48, CH, [
        ("예시 세트 열기", "반도체 검사 장비 현장의 합성 메일 30통이 열립니다 (①)"),
        ("내 메일 가져오기", ".eml · .mbox · .msg 를 고르거나 창에 끌어다 놓습니다 (② · ③)"),
        ("앱 설치 (선택)", "주소창 오른쪽 '앱 설치' → 시작 메뉴에서 창으로 열립니다"),
        ("내 PC 에서 직접 실행", "apps/web 에서 npm ci · npm run build 후  python -m http.server 3106 --directory out"),
    ], title="설치 순서", tip="새로고침해도 메일 · 규칙 · 수정 기록이 그대로 남습니다", desc_size=10.5)


# ================================================================ 본문
def screens():
    shot_steps("시작하기", "화면 구성", [
        "위: 검색 · 가져오기 · 글자 크기 · 어두운 화면 · 고대비 · 한/영",
        "왼쪽: 폴더(받은 메일 · 회신 필요 · 중요도별) · 할 일 · 설비 명판 · 기간 요약 · 관리",
        "가운데 목록, 오른쪽 읽기 창. 명판을 누르면 그 설비 메일만 남음",
    ], "Mailbox", M("Mailbox", 0, 1, 2, 4, 5), [
        ("가져오기", ".eml · .mbox · .msg (끌어다 놓아도 됨)"),
        ("회신 필요", "처리 전인 회신 필요 메일만. E 키로 처리 완료"),
        ("설비 명판", "메일에서 뽑은 장비 ID · 모듈. 누르면 그 설비 메일만"),
        ("중요도 근거", "점수를 만든 이유가 모두 나옵니다"),
        ("회신 · 기한", "회신 필요 여부와 날짜로 바꾼 마감"),
    ], tip="키보드: / 검색, ↑↓ 또는 j/k 이동, E 처리 완료, Esc 검색 지우기", card_title="메일함")

    SEC = "화면별 사용법"
    shot_steps(SEC, "읽기 창 · 근거 · 고치기", [
        "중요도(긴급 · 중요 · 일반 · 참고)와 점수, 그 점수를 만든 근거를 함께 보여 줌",
        "틀렸으면 그 자리에서 중요도 · 회신 필요 · 설비 태그를 고침. 고친 판단은 재분류 뒤에도 유지",
        "고친 메일은 현장 검증의 평가 세트가 되어, 규칙 버전별 놓침 추이에 쓰임",
    ], "Reader", M("Reader", 0, 1, 2, 3, 4, 5), [
        ("중요도 · 점수", "80 이상 긴급, 55 이상 중요, 30 이상 일반"),
        ("근거", "긴급 키워드 · 설비 이상 · 72시간 내 마감 · 고객 관련 등"),
        ("중요도 직접 지정", "'자동 판정'으로 되돌릴 수 있습니다"),
        ("회신 필요 고치기", "회신 필요 ↔ 필요 없음"),
        ("추출 정보", "설비 · 알람 · 날짜(기한/일정/언급) · 키워드"),
        ("설비 태그 추가", "잘못 잡힌 태그는 x 로 뺍니다"),
    ], card_title="읽기 창", desc_size=9.5)

    shot_steps(SEC, "답장 초안", [
        "요청 사항과 마감을 되짚는 답장 초안을 만들고 맞춤법을 첨삭함",
        "브라우저판은 메일을 보내지 않음. 복사해서 쓰던 메일 프로그램에서 보냄",
        "화면이 영어면 영어 초안을 만듦",
    ], "Draft", M("Draft", 0, 1, 2), [
        ("초안", "직접 고칠 수 있습니다"),
        ("복사", "제목과 본문을 함께 복사합니다"),
        ("안내", "자동 발송되지 않는다는 안내"),
    ], tip="셀프호스트판은 관리자가 발송 기능을 켠 경우에만 확인 창을 거쳐 보냅니다", card_title="답장 초안")

    shot_steps(SEC, "할 일 (기한순)", [
        "처리 전인 회신 필요 메일에서 요청 문장을 뽑아, 마감 표현을 날짜 · 시각으로 바꿔 정렬",
        "기한이 지난 항목은 빨갛게, 아래에 원래 표현(“금주 중”)을 함께 보여 줌",
        "기준 시각: 가져온 메일이 지난 날짜면 마지막 메일 날짜, 아니면 지금",
    ], "Todo", M("Todo", 0, 1, 2, 3), [
        ("설명", "어떤 표현을 날짜로 바꾸는지"),
        ("가장 급한 할 일", "날짜 · 시각 · 남은 날 / 지난 날"),
        ("지난 기한", "빨갛게 표시"),
        ("원래 표현", "메일에 쓰인 마감 표현 그대로"),
    ], tip="행을 누르면 원본 메일이 열립니다", card_title="할 일")

    shot_steps(SEC, "기간 요약", [
        "오전 · 오후 · 일간 · 주간 · 월간 · 연간 중 고르면 그 기간 메일을 중요도순으로 요약",
        "먼저 볼 메일 10통과 기한순 할 일 20개, 주요 설비를 보여 줌",
        "가져온 메일이 지난 날짜면 마지막 메일 날짜를 기준으로 계산",
    ], "Digest", M("Digest", 0, 1, 2, 3), [
        ("기간", "6가지"),
        ("요약 한 줄", "통 수 · 긴급 · 중요 · 주요 설비"),
        ("먼저 볼 메일", "중요도 · 점수 순"),
        ("할 일", "기한순"),
    ], card_title="기간 요약")


def flow_overview():
    s = new_slide()
    header(s, "현장 검증 절차", "4단계 한눈에", [
        "바꾸기 전에 같은 데이터로 확인하고, 새 방법은 옆에서 먼저 돌려 보고, 언제든 되돌린다",
        "왼쪽 '관리 → 현장 검증'의 단계 4개가 이 순서를 그대로 따름",
        "LLM 으로 전환하면 위 상태 표시에 LLM 배지가 붙음. 되돌리면 사라짐",
    ])
    st = [
        ("재현", "같은 메일로 다시 돌려 본다", ["합성 예시 세트 30통", "내가 고친 메일 = 재현 세트", "규칙 버전별 놓침 추이"]),
        ("비교", "바꾸기 전에 전 · 후를 본다", ["VIP · 설비 · 키워드 규칙", "바뀌는 메일만, 바뀐 칸 강조", "적용 = 새 버전"]),
        ("Shadow", "LLM 은 옆 칸에서만", ["보내기 전 마스킹 미리보기", "본문과 대조 검증", "다른 판단만 모아 보기"]),
        ("전환 · 롤백", "기준을 넘으면 전환", ["비교 20통 · 검증 실패 10% 이하", "중요도 일치 70% · 놓친 회신 0", "언제든 규칙으로 되돌리기"]),
    ]
    w, gap = 2.85, 0.31
    for i, (hd, sub, items) in enumerate(st):
        x = 0.5 + i * (w + gap)
        rbox(s, x, 2.6, w, 3.9, fill=WHITE, line=BLUE if i == 0 else LINE, radius=0.04, lw=1.5)
        num_circle(s, x + 0.2, 2.8, i + 1, 0.42, 14)
        text(s, x + 0.75, 2.8, w - 0.9, 0.42, hd, 17, True, anchor=MSO_ANCHOR.MIDDLE)
        text(s, x + 0.2, 3.4, w - 0.4, 0.6, sub, 11.5, True, SUB)
        for j, it in enumerate(items):
            box(s, x + 0.25, 4.18 + j * 0.62, 0.07, 0.07, fill=BLUE, shape=MSO_SHAPE.OVAL)
            text(s, x + 0.4, 4.05 + j * 0.62, w - 0.6, 0.55, it, 11)
        if i < 3:
            box(s, x + w + 0.04, 4.35, gap - 0.08, 0.3, fill=BLUE, shape=MSO_SHAPE.RIGHT_ARROW)


def verify():
    SEC = "현장 검증 절차"
    shot_steps(SEC, "1 재현", [
        "예시 세트(합성 30통)를 버튼 하나로 엶. 내가 중요도 · 회신 필요를 고친 메일이 내 재현 세트가 됨",
        "규칙 버전마다 같은 메일을 다시 분류해 중요 놓침 · 회신 놓침 · 오경보를 셈 (막대가 낮을수록 좋음)",
        "같은 엔진 코드에서 사용자 규칙만 버전별로 바꿔 돌린 결과",
    ], "Replay", M("Replay", 0, 2, 3, 4), [
        ("단계", "재현 → 비교 → Shadow → 전환 · 롤백"),
        ("놓침 추이", "빨강 = 놓침, 주황 = 오경보"),
        ("버전별 표", "버전 · 메모 · 놓침 · 오경보"),
        ("내가 고친 메일", "내 판단과 규칙 판단을 나란히"),
    ], card_title="재현")
    shot_steps(SEC, "2 비교", [
        "규칙(VIP 발신자 · 설비 추가 · 키워드 가중치)을 목록에 넣고 '바뀌는 메일 미리보기'",
        "같은 메일에서 중요도 · 회신 · 설비가 바뀌는 메일만 전 → 후로, 바뀐 칸은 노란 바탕",
        "적용하면 새 버전이 되고, 이력에서 어느 버전으로든 같은 방식으로 미리 보고 되돌림",
    ], "Compare", M("Compare", 0, 1, 2, 3, 4, 5), [
        ("규칙 입력", "종류 · 대상 · 가중치(-50 ~ 50)"),
        ("편집 중인 규칙", "적용 전에는 아무것도 바뀌지 않습니다"),
        ("바뀌는 양", "판단이 바뀌는 메일 · 점수만 바뀌는 메일"),
        ("바뀐 칸", "중요도 · 회신 · 설비 중 바뀐 것"),
        ("적용", "메모와 함께 새 버전으로 저장"),
        ("변경 이력", "'이 버전으로 되돌리기'도 미리보기부터"),
    ], card_title="비교", desc_size=9.5)
    shot_steps(SEC, "3 Shadow", [
        "내 Anthropic 키(기본은 메모리에만)와 모델을 고르고, 한 번에 보낼 메일 수를 정함",
        "LLM 답은 옆 칸에만 쌓이고 결정은 규칙이 함. 본문에 없는 설비 · 기한, 범위 밖 점수는 검증 실패",
        "규칙과 다른 판단만 모아 보고, 메일을 눌러 원문과 대조",
    ], "Shadow", M("Shadow", 0, 1, 2, 3), [
        ("API 키", "'이 기기에 키 기억'을 켠 경우에만 저장"),
        ("모델", "Opus 5.5 · Sonnet 5.5 · Haiku 5.5 (가격 표시)"),
        ("일치 기록", "비교 수 · 중요도 일치 · 회신 일치 · 놓친 회신 · 검증 실패"),
        ("다른 판단", "규칙 vs LLM"),
    ], tip="이 화면의 LLM 결과는 매뉴얼용 모의 결과(mock-demo)입니다", card_title="Shadow")
    shot_steps(SEC, "보낼 내용 미리보기 · 마스킹", [
        "처음 보내기 전에, 가린 뒤의 실제 전송 내용을 그대로 보여 줌",
        "이름 · 이메일 · 전화 · 주민번호 · 카드번호 · 사번 · IP · 비밀번호를 가림",
        "제목과 본문 외에는 아무것도 보내지 않음. '확인' 뒤에만 호출",
    ], "MaskPreview", M("MaskPreview", 0, 1), [
        ("전송될 내용", "[이름] · [이메일] · [전화번호] 등으로 바뀐 텍스트"),
        ("확인", "누르기 전에는 아무것도 보내지 않습니다"),
    ], card_title="마스킹 미리보기")
    s = new_slide()
    header(s, SEC, "4 전환 · 롤백", [
        "기준 4가지를 모두 넘어야 'LLM 판단으로 전환'이 켜짐. 하나라도 ✗ 면 버튼이 꺼져 있음",
        "전환 뒤에도 사용자가 고친 판단이 먼저, 검증 실패 · 아직 안 본 메일은 규칙이 결정",
        "'규칙으로 되돌리기' 한 번으로 돌아가고, 전환 이력이 남음",
    ])
    shot_card(s, 0.5, CY, 6.05, CH, "기준 미달 (LLM 이 회신 1건 놓침)", "Switch", M("Switch", 0, 1), crop=(240, 225, 1280, 625))
    shot_card(s, 6.78, CY, 6.05, CH, "전환 후 · 되돌리기", "Switched", M("Switched", 0, 1, 2), crop=(240, 0, 1280, 560))


def data():
    SEC = "내 데이터 · 개인정보"
    s = new_slide()
    header(s, SEC, "가져올 수 있는 파일", [
        "파일은 이 브라우저 안에서만 읽음. 여러 개를 한 번에 고르거나 창에 끌어다 놓음",
        "같은 메일(Message-ID 기준)은 한 번만 들어감. 200MB 보다 큰 파일은 나눠서",
        "UTF-8 · EUC-KR(ks_c_5601-1987) · MIME 인코딩 헤더 · HTML 본문을 읽음",
    ])
    rows = [
        ("형식", "만드는 법", "읽는 것"),
        (".msg", "Outlook 에서 메일을 바탕 화면으로 끌어 놓기 (여러 통 가능)", "제목 · 보낸 사람 · 받는 사람 · 본문 · 수신 시각 · 첨부 유무"),
        (".eml", "Gmail ⋮ > 원본 다운로드, Thunderbird 다른 이름으로 저장", "MIME 여러 부분 중 텍스트 본문 우선, 없으면 HTML 을 글자로"),
        (".mbox", "Google 테이크아웃, Thunderbird 메일함 파일", "'From ' 줄로 나눠 여러 통. >From 이스케이프 복원"),
        ("Outlook 연결", "설정 → Outlook 연결 (내 Azure 앱 등록 필요)", "받은 편지함 최근 200통, Mail.Read 권한만"),
    ]
    widths = [1.6, 5.2, 5.5]
    y = CY
    for i, r in enumerate(rows):
        x = 0.5
        h = 0.5 if i == 0 else 0.78
        for j, cell in enumerate(r):
            fill = NAVY if i == 0 else (CARD if i % 2 else WHITE)
            b = box(s, x, y, widths[j], h, fill=fill, line=LINE)
            text(s, 0, 0, 0, 0, cell, 11.5 if i else 12, i == 0 or j == 0, WHITE if i == 0 else INK, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE, shape=b)
            b.text_frame.margin_left = Inches(0.12)
            x += widths[j]
        y += h
    footer(s)

    shot_steps(SEC, "가져오기 결과 · 오류 메시지", [
        "파일 수 · 새 메일 · 이미 있던 메일 · 문제 수를 보여 주고, 문제마다 파일 · 몇 번째 메일 · 몇 번째 줄 · 이유를 적음",
        "읽을 수 있는 부분은 살리고(경고), 메일로 볼 수 없는 파일은 건너뜀",
        "헤더와 본문 사이 빈 줄이 없으면 그 줄부터 본문으로 읽고 알려 줌",
    ], "Import", M("Import", 0, 1, 2), [
        ("요약", "파일 5개 중 3통을 가져오고 2개를 건너뜀"),
        ("메일이 아닌 파일", "첫 줄이 '이름: 값' 헤더가 아님"),
        ("잘린 .msg", "OLE 섹터 범위를 벗어남 → 건너뜀"),
    ], tip="다른 메시지: Date 헤더 없음(파일 시각 사용), RTF 압축 본문만 있는 .msg(제목 · 발신자만)", card_title="가져오기 결과")

    shot_steps(SEC, "설정 · Outlook 연결", [
        "데이터: 백업 내보내기(JSON) · 가져오기 · 예시 세트 · 모든 데이터 삭제",
        "Outlook: 내 Azure 앱 클라이언트 ID 를 넣고 로그인하면 받은 편지함 최근 200통을 읽음",
        "리디렉션 URI 는 화면에 나온 값을 Azure 앱의 '단일 페이지 애플리케이션'에 그대로 넣음",
    ], "Settings", M("Settings", 0, 1, 2, 3, 4), [
        ("백업", "메일 본문이 들어 있으니 안전한 곳에 보관"),
        ("모든 데이터 삭제", "되돌릴 수 없음 (확인 창)"),
        ("클라이언트 ID", "GUID 형식. 등록은 docs/oauth-setup-guide.md"),
        ("리디렉션 URI", "끝의 / 까지 그대로"),
        ("로그인하고 읽기", "Microsoft 창에서 동의 → 읽기만"),
    ], card_title="설정", desc_size=10)

    s = new_slide()
    header(s, SEC, "LLM 키 · 개인정보", [
        "키가 없어도 모든 기능이 규칙으로 동작. LLM 은 현장 검증 > Shadow 에서만 씀",
        "보내기 전에 가린 내용을 보여 주고, 제목과 본문만 보냄. 키는 기본적으로 메모리에만",
        "오류 기록은 이 브라우저에만 남고(최근 50건, 메일 내용 제외), 어디로도 보내지 않음",
    ])
    shot_card(s, 0.5, CY, 6.6, CH, "개인정보 처리 안내 (도움말)", "Privacy", M("Privacy", 0), crop=(370, 60, 1280, 560))
    rbox(s, 7.35, CY, 5.48, CH)
    text(s, 7.5, CY + 0.1, 5.2, 0.32, "어디에 무엇이 남나", 13, True)
    items = [
        ("이 브라우저 IndexedDB", "메일 · 규칙 이력 · 수정 기록 · Shadow 결과"),
        ("브라우저 저장소", "화면 설정 · 언어 · (선택) API 키 · 오류 기록"),
        ("세션 저장소", "Outlook 로그인 토큰 (탭을 닫으면 사라짐)"),
        ("Anthropic API", "가린 제목 · 본문 (Shadow 실행 때만)"),
        ("Microsoft Graph", "읽기 요청만 (Outlook 연결 때만)"),
        ("그 밖의 서버", "없음"),
    ]
    for i, (k, v) in enumerate(items):
        yy = CY + 0.6 + i * 0.6
        text(s, 7.55, yy, 2.0, 0.5, k, 11, True, BLUE)
        text(s, 9.55, yy, 3.15, 0.55, v, 10.5, False, INK)


def appendix():
    s = new_slide()
    header(s, "부록", "영어 · 다크 · 모바일 · 키보드", [
        "오른쪽 위 EN / 한 으로 화면 언어를 바꿈. 분류 규칙과 마감 파서는 영어 메일도 읽음",
        "어두운 화면은 처음에 운영체제 설정을 따름. 고대비 · 글자 크기(가− · 가+)도 기억",
        "모바일 폭에서는 목록과 읽기 창이 위아래로. 키보드: / ↑↓ j k E Esc, Tab 으로 모든 버튼",
    ])
    shot_card(s, 0.5, CY, 4.6, CH, "English", "EnMailbox", M("EnMailbox", 0), crop=(0, 0, 1280, 720))
    shot_card(s, 5.3, CY, 4.6, CH, "어두운 화면", "Dark", crop=(0, 0, 1280, 720))
    shot_card(s, 10.1, CY, 2.73, CH, "모바일", "Mobile", dip=(390, 844))


def selfhost():
    s = new_slide()
    header(s, "부록", "셀프호스트판 (Docker)", [
        "Outlook · Gmail 을 주기적으로(기본 10분) 동기화하고 Teams · 카카오로 긴급 · 중요 메일을 알림",
        "메일 본문과 토큰은 AES-256-GCM 으로 저장. 암호화 키 파일(mdcv.key)은 DB 와 함께 백업",
        "답장 발송 권한은 관리자가 MDCV_ENABLE_SEND=1 로 켤 때만 요청. 현장 검증 화면은 브라우저판에만 있음",
    ])
    rbox(s, 0.5, CY, 6.0, CH)
    text(s, 0.65, CY + 0.1, 5.7, 0.32, "실행", 13, True)
    text(s, 0.65, CY + 0.55, 5.7, 3.8, [
        "1.  cp .env.example .env",
        "2.  .env 에 값 입력 (다른 PC 에서 쓰면 MDCV_API_TOKEN 필수)",
        "3.  docker compose up -d --build",
        "4.  http://127.0.0.1:3000 접속",
        "",
        "Outlook · Gmail 앱 등록: docs/oauth-setup-guide.md 2 · 3절",
        "배포 · 운영: docs/deploy-guide.md",
    ], 11.5, False, INK, font=MONO)
    rbox(s, 6.75, CY, 6.08, CH)
    text(s, 6.9, CY + 0.1, 5.8, 0.32, "브라우저판과 다른 점", 13, True)
    rows = [("메일 저장", "서버 SQLite (암호화)"), ("메일 입력", "Outlook · Gmail 자동 동기화"), ("알림", "Teams 웹훅 · 카카오 나에게 보내기"),
            ("LLM", "anthropic · openai · gemini (서버 .env)"), ("규칙 변경", "저장 · 전체 다시 분류 (미리보기 없음)"), ("사용자", "한 사람 또는 한 팀 공용 메일함")]
    for i, (k, v) in enumerate(rows):
        yy = CY + 0.6 + i * 0.6
        text(s, 6.95, yy, 1.6, 0.5, k, 11, True, BLUE)
        text(s, 8.55, yy, 4.1, 0.55, v, 11, False, INK)


def faq():
    s = new_slide()
    header(s, "부록", "FAQ · 문제 해결", [
        "도움말 화면에도 같은 내용이 있음. 예기치 않은 오류는 도움말 → 오류 기록에 이 기기에만 남음",
        "데이터 백업 · 가져오기 · 전체 삭제는 설정 → 데이터",
        "설비 이름 · 표현은 현장 검증 → 비교의 규칙으로 늘림",
    ])
    qa = [
        ("설비 이름이 안 잡혀요", "비교에서 '설비 추가' 규칙으로 넣고 미리보기 후 적용. INSP-03 · AOI_09 같은 ID 와 ALM-2041 같은 알람 코드는 자동으로 잡습니다."),
        ("회신이 필요한데 안 잡혀요", "읽기 창에서 '회신 필요로 고치기'. 고친 메일은 재현 세트가 되어 규칙을 바꿀 때 놓침이 줄었는지 확인할 수 있습니다."),
        ("한글이 깨져요", ".eml 의 charset 이 없으면 UTF-8 → EUC-KR 순으로 시도합니다. 그래도 깨지면 원본을 다시 저장해 보세요."),
        ("날짜가 이상해요", "Date 헤더가 없으면 파일 시각을 씁니다. 가져오기 결과에 그 파일이 표시됩니다."),
        ("Outlook 로그인 오류 AADSTS50011", "리디렉션 URI 가 다릅니다. 설정 화면의 URI 를 Azure 앱 SPA 플랫폼에 그대로(끝의 / 포함) 넣으세요."),
        ("팝업이 안 떠요", "브라우저의 팝업 차단을 이 사이트만 해제하세요."),
        ("LLM 결과가 결정에 안 쓰여요", "기본은 규칙이 결정합니다. 전환 기준 4가지를 넘긴 뒤 전환 단계에서 전환하세요."),
        ("저장소를 열 수 없대요", "시크릿 창이나 사이트 데이터 차단 설정에서는 IndexedDB 를 쓸 수 없습니다."),
    ]
    cw, ch = 6.05, 1.02
    for i, (q, a) in enumerate(qa):
        col, row = i % 2, i // 2
        x = 0.5 + col * (cw + 0.23)
        y = CY + row * (ch + 0.13)
        rbox(s, x, y, cw, ch)
        text(s, x + 0.15, y + 0.08, 0.4, 0.32, "Q", 13, True, BLUE)
        text(s, x + 0.5, y + 0.08, cw - 0.65, 0.32, q, 12, True)
        text(s, x + 0.5, y + 0.42, cw - 0.65, 0.56, a, 10, False, SUB)


def back():
    s = new_slide()
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = NAVY
    s.shapes.add_picture(os.path.join(ASSETS, "icon.png"), Inches(6.2), Inches(1.4), Inches(0.9), Inches(0.9))
    text(s, 0, 2.7, 13.333, 0.6, NAME, 30, True, WHITE, PP_ALIGN.CENTER)
    text(s, 0, 3.4, 13.333, 0.4, "설비 · 알람 코드 사전 · 한국어 마감 → 기한순 할 일 · 파일만으로 브라우저 안에서 · 현장 검증 절차", 13, False, RGBColor(0xC9, 0xD3, 0xE0), PP_ALIGN.CENTER)
    text(s, 0, 4.3, 13.333, 1.2, [f"v{VERSION}   ·   만든 사람 배민혁   ·   MIT License   ·   © 2026",
                                  "포함: Next.js · React (MIT) · Anthropic TypeScript SDK 1.6.0 (MIT) · MSAL.js 5.28.0 (MIT)",
                                  "예시 메일과 화면은 모두 합성 데이터입니다"],
         10.5, False, RGBColor(0x8A, 0x97, 0xA8), PP_ALIGN.CENTER)


def main():
    cover()            # 1
    toc()              # 2
    intro()            # 3
    install()          # 4
    screens()          # 5–9
    flow_overview()    # 10
    verify()           # 11–15
    data()             # 16–19
    appendix()         # 20
    selfhost()         # 21
    faq()              # 22
    back()             # 23
    assert state["n"] == TOTAL, state["n"]
    prs.save(OUT)
    print("saved", OUT)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
