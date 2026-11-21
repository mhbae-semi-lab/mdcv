# MDCV — 설비를 아는 메일 분류기

**바로 쓰기: https://mhbae-semi-lab.github.io/mdcv/** (설치 없음, 메일은 이 브라우저 밖으로 나가지 않음)

반도체 장비 현장 엔지니어의 메일함 위에 **설비 · 알람 코드 · 마감**을 아는 분류 층을 얹는 웹 앱입니다.
메일 클라이언트를 대체하지 않고, 스스로 메일을 보내지 않습니다.

- **브라우저판** (서버 없음): `.eml` · `.mbox` · `.msg` 파일을 끌어다 놓으면 이 브라우저 안에서만 처리합니다. Outlook 은 읽기 전용으로 연결할 수 있습니다.
- **셀프호스트판** (Docker): Outlook · Gmail 을 주기적으로 동기화하고 Teams · 카카오로 알립니다.

English summary at the end.

## 관점
설비 담당자는 하루 30~100통의 메일에서 설비 이상, 회신이 필요한 요청, 마감을 놓치면 안 됩니다. 범용 메일 도구는 메일을 보낸 사람 · 단어 · 대화로만 봅니다.
MDCV 는 `INSP-03` 같은 장비 ID, `로드포트` · `EFEM` · `칠러` 같은 모듈, `ALM-2041` 같은 알람 코드, `금주 중` · `차주 화요일` · `11/24(화)까지` 같은 한국어 마감 표현을 기본 개념으로 다룹니다.

## 해결
- 메일마다 설비 · 알람 · 날짜 · 사람을 뽑고, 중요도(긴급 · 중요 · 일반 · 참고)와 그 점수를 만든 근거를 함께 보여 줍니다.
- 한국어 · 영어 마감 표현을 실제 날짜 · 시각으로 바꿔 **기한순 할 일**을 만듭니다.
- 설비별로 메일 흐름을 모아 보고(설비 명판을 누르면 그 설비 메일만), 기간 요약과 답장 초안(복사해서 직접 발송)을 제공합니다.
- 규칙을 먼저 적용하고, LLM 은 선택입니다(사용자 본인 Anthropic 키). LLM 에 보내기 전에 이름 · 연락처 · 사번 · IP 등을 가리고, LLM 답은 본문과 대조해 통과할 때만 씁니다.
- 바꾸기 전에 확인하는 **현장 검증 절차**를 화면으로 넣었습니다: 재현 → 비교 → Shadow → 전환 · 롤백.

## 상용 제품과 비교 (2026-11-22 조사)

| 제품 | 설비 · 알람 코드를 분류 개념으로 | 한국어 마감 → 기한순 할 일 | LLM 전 마스킹 + 파일만으로 브라우저 처리 | 규칙 변경 전 · 후 비교와 되돌리기 | LLM Shadow · 전환 기준 |
|---|---|---|---|---|---|
| Inbox Zero (오픈소스, 셀프호스트) | 없음 | 없음 (할 일은 Todoist 연동) | 자격 증명 · 카드번호 가림만, 기본 꺼짐 / 메일함 연결 필요 | 과거 메일에 "전체 테스트"(일치 목록), 전 · 후 비교 · 이력 없음 | 없음 |
| Microsoft Copilot in Outlook ("Prioritize my inbox") | 없음 | 없음 | 없음 | 없음 | 없음 — 이 기능은 2026-10-26 부터 단계적으로 제거 중 |
| Gmail (AI Inbox 등) | 없음 | 마감 추출 있음, 미국 · 영어 사용자만 | 없음 | 필터 검색 미리보기(일치 목록) | 없음 |
| NAVER WORKS | 없음 | AI 가 할 일 · 일정 추천(유료 부가), 기한 정렬 문서 없음 | 없음 | 없음 | 없음 |
| Superhuman · Shortwave · SaneBox | 없음 | 없음 | 없음 | 라벨 미리보기 · 재적용 정도 | 없음 |

출처: [Inbox Zero 규칙 코드](https://github.com/elie222/inbox-zero) · [Inbox Zero LLM 설정](https://docs.getinboxzero.com/hosting/llm-setup.md) · [Prioritize my inbox 제거 공지 MC1519861](https://mc.merill.net/message/MC1519861) · [Gmail AI Inbox](https://support.google.com/mail/answer/16845247) · [NAVER WORKS AI 일정 · 할 일 추천](https://help.worksmobile.com/ko/use-guides/mail/check-mail/ai-event-task-recommend/) · [Superhuman Auto Labels](https://help.superhuman.com/hc/en-us/articles/40127432866323) · [Shortwave labels](https://shortwave.com/docs/guides/labels) · [SaneBox](https://sanebox.com/help/155-how-does-sanebox-work) · [Freshdesk shadow mode](https://support.freshdesk.com/support/solutions/articles/50000014350-deploy-email-ai-agent-in-shadow-mode)

## 차별점 (조사한 제품 중에서 찾지 못함, 2026-11 기준)
1. **설비 사전 기반 분류**: 장비 ID · 모듈(별칭 포함) · 알람 코드를 엔티티로 뽑아 설비별 메일 흐름을 만듭니다. 사전은 `packages/shared/rules.json` 하나이고 사용자가 규칙으로 늘립니다.
2. **한국어 마감 표현 → 기한순 할 일**: `금주 중`, `차주 화요일`, `익일 09시`, `11/24(화)`, `월말`, `3일 이내`, `by Friday`, `EOD Thursday` 등을 날짜 · 시각으로 바꿉니다.
3. **메일함 연결 없이 파일만으로, 브라우저 안에서** 처리하고, LLM 을 쓸 때는 가린 내용을 먼저 보여 줍니다.
4. **현장 검증 절차**: 규칙을 바꾸기 전에 같은 메일에서 중요도 · 회신 · 설비가 바뀌는 메일만 전 · 후로 보여 주고, 적용 뒤 버전별로 되돌립니다. LLM 은 Shadow 로만 답하다가 기준(비교 20통 이상, 검증 실패 10% 이하, 중요도 일치 70% 이상, LLM 이 놓친 회신 0)을 넘으면 전환할 수 있고, 언제든 규칙으로 돌아갑니다. 사용자가 고친 메일은 평가 세트가 되어 규칙 버전별 놓침 추이를 보여 줍니다.

Shadow 운영이나 미리보기 각각은 다른 제품에도 비슷한 것이 있습니다(위 표). 메일 분류에 네 단계를 한 흐름으로 묶은 것을 찾지 못했다는 뜻입니다.

## 측정 (합성 데이터)
모든 메일은 합성입니다. 분류 규칙을 보지 않은 별도 작성자가 라벨을 붙인 반도체 검사 장비 현장 메일 3세트(각 30통)를 썼습니다. 정확도가 아니라 **알려진 표현에 대한 회귀 확인**으로 읽어 주세요.

| | 원본 v1 (처음 엔진) | 처음 본 세트에서 (규칙 고정 후 1회) | 현재 v5 (세 세트 모두 반영 후) |
|---|---|---|---|
| 회신 필요 메일 놓침 | 개발 8/16 · 보류 9/15 · 블라인드 11/16 | 보류 4/15 · 블라인드 5/16 | **0/47** |
| 회신 오경보 | 4 · 3 · 5 | 1 · 1 | 0 |
| 긴급 · 중요 메일을 일반 이하로 | 6 · 8 · 8 | 2 · 0 | 1 |
| 마감 날짜 맞춤 | 5/13 · 2/12 · 4/13 | 12/12 · 10/13 | 38/38 |
| 설비 · 알람 인식 | 26/54 · 21/55 · 24/59 | 52/55 · 43/59 | 168/168 |

- 처음 본 세트의 수치(회신 놓침 약 30%)가 규칙만으로 낯선 표현을 만났을 때의 현실적인 값입니다. 그래서 LLM Shadow 와 사용자 수정 기록을 둡니다. 기록: `docs/evaluation-log.json`, 재현: `python scripts/evaluate_fab.py --set blind2`.
- Python(셀프호스트)과 TypeScript(브라우저) 엔진은 같은 사전을 읽고 **190통에서 결과가 같습니다** (`python scripts/parity.py`).
- 속도(Node 24, 개발 PC): 1,000통 규칙 분류 약 0.3초, 990통 mbox(0.9MB) 파싱 약 0.16초 (`node scripts/bench.mjs`).

## 설치 · 사용
- 브라우저판: **https://mhbae-semi-lab.github.io/mdcv/** 또는 `docs/deploy-guide.md` 1절로 직접 빌드. 첫 화면에서 **예시 세트 열기(합성 30통)** 로 바로 볼 수 있습니다.
- 셀프호스트판: `cp .env.example .env` → `docker compose up -d --build` → http://127.0.0.1:3000 (`docs/deploy-guide.md` 2절).
- Outlook · Gmail 연결은 사용자 본인 앱 등록이 필요합니다: `docs/oauth-setup-guide.md`.
- 사용자 매뉴얼(한국어): `docs/manual/MDCV-User-Manual-ko.pdf`

### 내 데이터 형식
| 형식 | 만드는 법 |
|---|---|
| `.msg` | Outlook 에서 메일을 바탕 화면으로 끌어 놓기 |
| `.eml` | Gmail ⋮ > 원본 다운로드, Thunderbird 다른 이름으로 저장 |
| `.mbox` | Google 테이크아웃, Thunderbird 메일함 파일 |

UTF-8 · EUC-KR(ks_c_5601-1987) · MIME 인코딩 헤더를 읽습니다. 깨진 파일은 건너뛰고 몇 번째 메일 · 몇 번째 줄에서 무엇이 문제인지 알려 줍니다.

### 개인정보
- 브라우저판: 메일 · 규칙 · 기록은 이 브라우저의 IndexedDB 에만 있습니다. 서버 · 분석 도구 · 외부 오류 수집이 없습니다. 설정 > 데이터에서 백업 내보내기 · 가져오기 · 전체 삭제.
- LLM 은 사용자가 키를 넣고 실행할 때만, 가린 제목 · 본문만 보냅니다. 키는 기본적으로 메모리에만 있습니다.
- 셀프호스트판: 토큰과 메일 본문을 AES-256-GCM 으로 저장합니다(키 파일 `mdcv.key` 는 DB 와 함께 백업). 발송 권한은 관리자가 `MDCV_ENABLE_SEND=1` 로 켤 때만 요청합니다.

## 한계
- 규칙 분류는 사전과 표현 목록에 있는 것만 압니다. 처음 본 표현에서 회신 필요를 약 30% 놓쳤습니다(위 측정).
- 합성 데이터로만 측정했습니다. 실제 메일 정확도는 측정하지 않았습니다.
- `.msg` 본문이 압축 RTF 만 있으면 본문을 읽지 못합니다(제목 · 발신자만). 첨부 파일 내용은 읽지 않습니다.
- 브라우저판은 기기 간 동기화가 없고(백업 파일로 옮김), 아주 큰 mbox(수백 MB)는 나눠서 가져와야 합니다.
- 셀프호스트판은 한 사용자(또는 한 팀 공용 메일함) 기준이고, 현장 검증 화면은 브라우저판에만 있습니다.
- 공개 주소에서 Outlook 연결을 여러 조직에 제공하려면 Microsoft 게시자 확인이 필요합니다.

## 구조 · 개발
- `packages/shared/rules.json` 설비 사전 · 표현 목록 (Python · TS 공용)
- `packages/engine/*.ts` 분류 · 날짜 · 검증 · 마스킹 · 요약 · LLM 검증 · 파일 파서 (브라우저 · Node 공용)
- `apps/web` Next.js 정적 내보내기. `app/lib/local.ts` 가 브라우저 안에서 API 경로를 처리합니다
- `apps/api` FastAPI / 표준 라이브러리 서버, `mdcv/` 는 엔진의 Python 쌍둥이와 동기화 · 알림 · 암호화 저장

```powershell
node --test "tests/js/*.test.ts"     # 엔진 · 파서 · 브라우저 백엔드 25개
python scripts/evaluate.py           # Python 단위 테스트 50개 + 골든 회귀 + 합성 세트
python scripts/parity.py             # Python ↔ TS 결과 일치
node scripts/i18n-check.mjs          # 영어 문자열 누락 확인
cd apps/web; npm ci; npm run build   # 정적 내보내기 (apps/web/out)
```

AI 보조 개발: 이 저장소의 코드와 문서는 Claude Code(Anthropic)를 사용해 작성했습니다. 요구사항 · 설계 판단 · 검증은 작성자가 했습니다.

License: MIT

---

## English
MDCV is a triage layer for work mail that understands semiconductor equipment: tool IDs, modules (with aliases) and alarm codes become entities, Korean and English deadline phrases become due dates, and requests become a due-sorted to-do list. Rules decide first; an LLM (your own Anthropic key) is optional, sees masked text only, and its answers are used only after they validate against the mail. A field-verification flow lets you preview a rule change on the same mail before applying it, roll back to any rule version, run the LLM in shadow mode with explicit switch criteria, and track misses per rule version using your own corrections as the evaluation set.
The browser build needs no server: drop `.eml`, `.mbox` or `.msg` files (or connect Outlook read-only) and everything stays in the browser's IndexedDB. A Docker self-host build syncs Outlook and Gmail and sends Teams / Kakao alerts. The UI is available in Korean and English.
