# Outlook · Gmail 앱 등록 가이드

MDCV 는 메일 계정 비밀번호를 받지 않습니다. 사용자가 Microsoft · Google 로그인 창에서 직접 동의해야만 메일을 읽습니다.
그러려면 **내 Azure / Google 앱 등록**이 하나 필요합니다. 파일 가져오기(.eml · .mbox · .msg)만 쓸 거라면 이 문서는 건너뛰어도 됩니다.

| 쓰는 판 | 필요한 등록 | 권한 |
|---|---|---|
| 브라우저판 (GitHub Pages 등 정적 주소) | Azure 앱 · **단일 페이지 애플리케이션(SPA)** 플랫폼 | `Mail.Read` (위임) |
| 셀프호스트판 (Docker) | Azure 앱 · **웹** 플랫폼 + 클라이언트 비밀 / Google OAuth 클라이언트(웹) | `Mail.Read` · `offline_access` (발송을 켜면 `Mail.Send` 추가) / `gmail.readonly` (발송을 켜면 `gmail.send` 추가) |

## 1. 브라우저판: Azure 앱 등록 (SPA)

1. https://portal.azure.com → **Microsoft Entra ID → 앱 등록 → 새 등록**
2. 이름: `MDCV` (원하는 이름)
3. 지원되는 계정 유형: **모든 조직 디렉터리의 계정 및 개인 Microsoft 계정** (회사 계정만 쓸 거면 "이 조직 디렉터리의 계정만")
4. 리디렉션 URI: 플랫폼 **단일 페이지 애플리케이션(SPA)** → 앱 주소를 그대로 넣습니다. 앱의 설정 화면에 표시되는 값과 같아야 합니다.
   - 공개 주소 예: `https://<사용자>.github.io/mdcv/`
   - 내 PC에서 띄운 경우 예: `http://localhost:3106/`
5. 등록 후 **API 사용 권한 → 권한 추가 → Microsoft Graph → 위임된 권한 → Mail → `Mail.Read`** 를 추가합니다. 다른 권한은 필요 없습니다(`User.Read` 기본값은 그대로 둬도 됩니다).
6. 개요 화면의 **애플리케이션(클라이언트) ID** 를 복사해 MDCV **설정 → Outlook 연결 → Azure 앱 클라이언트 ID** 에 붙여 넣습니다.
   - 클라이언트 비밀은 만들지 않습니다. SPA 는 비밀 없이 PKCE 로 로그인합니다.
   - 공개 배포에서 기본값으로 넣으려면 빌드 때 `NEXT_PUBLIC_MS_CLIENT_ID` 를 지정합니다(GitHub Actions 저장소 변수 `MS_CLIENT_ID`).

### 여러 사람이 쓰는 공개 주소라면: 게시자 확인
- 다른 조직 사용자가 쓰는 다중 테넌트 앱은 **게시자 확인(Publisher verification)** 이 없으면 "확인되지 않은 앱" 경고가 뜨고, 많은 회사 테넌트에서 사용자 동의가 막힙니다(관리자 동의 필요).
- 절차: Microsoft AI Cloud Partner Program(MPN) 계정 생성 → 앱 등록의 **브랜딩 및 속성 → 게시자 도메인** 확인 → **게시자 확인**에 MPN ID 입력.
- 개인 Microsoft 계정(outlook.com 등)은 확인 전에도 경고와 함께 동의할 수 있습니다.

흔한 오류
- `AADSTS50011` 리디렉션 URI 불일치 → 설정 화면에 표시된 URI 를 SPA 플랫폼에 그대로 추가(끝의 `/` 포함)
- `AADSTS9002326` 플랫폼이 "웹"으로 등록됨 → URI 를 SPA 플랫폼으로 옮깁니다
- 팝업이 열리지 않음 → 브라우저 팝업 차단 해제

## 2. 셀프호스트판: Azure 앱 (웹 플랫폼)

1. 위와 같이 새 등록, 리디렉션 URI 는 플랫폼 **웹** → `http://localhost:8000/api/accounts/callback/graph` (운영 주소가 있으면 `https://<API 주소>/api/accounts/callback/graph` 를 추가)
2. **인증서 및 비밀 → 새 클라이언트 비밀** → "값"을 `.env` 의 `MDCV_GRAPH_CLIENT_SECRET` 에, 클라이언트 ID 를 `MDCV_GRAPH_CLIENT_ID` 에 넣습니다.
3. **API 사용 권한**: Microsoft Graph 위임 `Mail.Read`, `offline_access`(재로그인 없이 동기화). 답장 발송 기능을 켤 때만(`MDCV_ENABLE_SEND=1`) `Mail.Send` 를 추가하고 계정을 다시 연결합니다.

## 3. 셀프호스트판: Gmail (Google)

1. https://console.cloud.google.com → 프로젝트 → **Gmail API 사용 설정**
2. **OAuth 동의 화면**: 외부, 앱 이름 입력, 테스트 사용자에 본인 계정 추가(앱이 테스트 상태면 필수)
3. **사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션**, 승인된 리디렉션 URI `http://localhost:8000/api/accounts/callback/gmail`
4. 클라이언트 ID / 보안 비밀을 `.env` 의 `MDCV_GMAIL_CLIENT_ID` / `MDCV_GMAIL_CLIENT_SECRET` 에 넣습니다.
5. 기본 스코프는 `gmail.readonly` 하나입니다. `MDCV_ENABLE_SEND=1` 일 때만 `gmail.send` 를 추가로 요청합니다.
   - 공개 배포(테스트 상태가 아닌 앱)에서 Gmail 읽기 스코프는 Google 의 **제한된 스코프 검증**이 필요합니다. 개인 · 팀 셀프호스트라면 테스트 상태로 두고 사용자를 테스트 사용자로 추가하세요.

흔한 오류: `access_blocked` = 테스트 사용자 미등록, `redirect_uri_mismatch` = URI 불일치, `invalid_client` = 비밀 값 오류.

## 4. 확인
- 브라우저판: 설정 → Outlook 연결 → "로그인하고 최근 메일 200통 읽기". 결과 메시지에 읽은 수와 새 메일 수가 나옵니다.
- 셀프호스트판: API 서버를 다시 시작한 뒤 상단 Outlook / Gmail 버튼 → 진단 체크리스트가 모두 ✓ 일 때만 "동의하고 연결"이 인증 창으로 이어집니다. `GET /api/accounts/diagnose` 로도 확인할 수 있습니다.
