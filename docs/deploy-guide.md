# MDCV 배포 가이드

MDCV 는 두 가지로 씁니다.

| | 브라우저판 | 셀프호스트판 |
|---|---|---|
| 서버 | 없음 (정적 파일) | Python API + 정적 웹 (Docker) |
| 메일 저장 | 이 브라우저의 IndexedDB | 서버 SQLite, 본문 · 토큰 AES-256-GCM 암호화 |
| 메일 입력 | .eml · .mbox · .msg 가져오기, Outlook(읽기 전용) | Outlook · Gmail 자동 동기화(기본 10분) |
| 현장 검증(규칙 미리보기 · Shadow · 전환) | 있음 | 없음 (규칙 저장 · 전체 재분류만) |
| 알림 | 없음 | Teams 웹훅, 카카오 나에게 보내기 |
| 답장 발송 | 없음 (초안 복사) | 관리자가 켠 경우만 (`MDCV_ENABLE_SEND=1`) |

## 1. 브라우저판

빌드 없이 쓰려면 공개 주소 https://mhbae-semi-lab.github.io/mdcv/ 를 엽니다. 직접 빌드하려면:
```powershell
cd apps/web
npm ci
npm run build                      # 결과: apps/web/out (정적 파일)
python -m http.server 3106 --directory out   # http://localhost:3106
```
- 하위 경로에 올릴 때는 빌드 전에 `NEXT_PUBLIC_BASE_PATH=/mdcv` 처럼 지정합니다.
- Outlook 연결 기본 클라이언트 ID 를 넣으려면 `NEXT_PUBLIC_MS_CLIENT_ID` 를 지정합니다(없으면 사용자가 설정 화면에서 자기 ID 를 넣습니다). 등록은 `docs/oauth-setup-guide.md` 1절.
- 정적 파일 호스트면 어디든 됩니다. 서비스 워커가 앱 화면을 캐시해 오프라인에서도 열립니다.

## 2. 셀프호스트판 (Docker Compose)

```bash
cp .env.example .env        # 값 입력. 다른 PC에서 접속한다면 MDCV_API_TOKEN 필수
docker compose up -d --build
# 웹 http://127.0.0.1:3000 · API http://127.0.0.1:8000
```
- 두 서비스 모두 기본은 **이 PC(127.0.0.1)에서만** 열립니다. 다른 PC에서 쓰려면 HTTPS 리버스 프록시를 앞에 두고 `MDCV_API_TOKEN` · `MDCV_CORS_ORIGINS` · `MDCV_WEB_URL` · `MDCV_API_BASE` 를 운영 주소로 맞춥니다.
- 데이터(SQLite DB 와 암호화 키 `mdcv.key`)는 `mdcv-data` 볼륨에 있습니다. **둘을 함께 백업**하세요. 키를 잃으면 본문과 토큰을 복호화할 수 없습니다.
- 웹 이미지는 정적 파일을 nginx 로 내보냅니다. API 주소는 빌드 때 고정되므로(`NEXT_PUBLIC_API_URL`), 주소를 바꾸면 `docker compose build web` 을 다시 합니다.
- 한 사람(또는 한 팀의 공용 메일함) 기준입니다. 사용자별 로그인 · 권한은 없으며 접속 토큰을 아는 사람은 같은 메일을 봅니다.

### Docker 없이 (개발용)
```powershell
pip install -r apps/api/requirements.txt   # cryptography 는 필수(암호화)
copy .env.example .env
python apps/api/server.py                  # 표준 라이브러리 서버, http://127.0.0.1:8000
cd apps/web; npm ci; $env:NEXT_PUBLIC_API_URL="http://127.0.0.1:8000"; npm run build
python -m http.server 3000 --directory out
```

## 3. 선택 기능

- **LLM**: `.env` 에 `MDCV_LLM_PROVIDER=anthropic` (또는 `openai` · `gemini`) 와 `MDCV_LLM_API_KEY`. 없으면 규칙만으로 동작합니다. 보내기 전에 이름 · 연락처 · 사번 · IP 를 가리고, 답은 `validate_answer` 를 통과해야 쓰입니다(본문에 없는 설비 · 기한, 범위 밖 점수, 점수와 등급 불일치 거부). 하루 호출 상한 `MDCV_LLM_DAILY_LIMIT`(기본 200), 건당 글자 상한 `MDCV_LLM_MAX_CHARS`(기본 4000).
- **답장 발송**: 기본은 꺼짐. `MDCV_ENABLE_SEND=1` 로 켜야 앱 등록에서 발송 권한을 요청하고 발송 버튼이 보입니다. 켠 뒤에는 계정을 다시 연결해 발송 권한에 동의해야 합니다. 발송은 매번 확인 창을 거치고 감사 로그에 남습니다.
- **알림**: `MDCV_TEAMS_WEBHOOK`(Teams 채널 웹훅), `MDCV_KAKAO_TOKEN`(카카오 나에게 보내기). 새로 동기화된 긴급 · 중요 메일만, 메일당 한 번 보냅니다.

## 4. 운영 체크리스트
- [ ] `.env` 가 저장소에 올라가지 않았는지 확인 (`.gitignore` 에 포함)
- [ ] 다른 PC에서 접속한다면 `MDCV_API_TOKEN` 설정 + HTTPS
- [ ] `MDCV_SECRET` 를 지정했거나, 데이터 폴더의 `mdcv.key` 를 DB 와 함께 백업
- [ ] 백업 자동화: `python scripts/backup.py` (`docs/maintenance.md`)
- [ ] `python scripts/evaluate.py` · `node --test "tests/js/*.test.ts"` · `python scripts/parity.py` 통과
- [ ] 설비 사전은 `packages/shared/rules.json` 한 곳만 고칩니다(Python · 브라우저 공용)
