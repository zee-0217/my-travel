# GitHub·Vercel 배포 안내

대상 저장소: https://github.com/zee-0217/my-travel

## 1. Git과 GitHub

이 PC에는 Git 2.55.0과 GitHub CLI가 설치되어 있습니다. 다른 PC에 Git이 없으면 [공식 설치 페이지](https://git-scm.com/downloads)에서 설치 후 터미널을 다시 열거나 Windows에서 `winget install --id Git.Git -e`를 실행하세요.

```powershell
git --version
gh auth status
# 로그인이 필요할 때 본인 PC에서 실행
gh auth login --hostname github.com --web
npm.cmd run check:deploy
```

`.env`, `.env.*`(빈 `.env.example` 제외), `.vercel`, 로컬 미리보기·데이터, 인증 파일은 Git과 Vercel 업로드에서 제외합니다. 비밀정보 검사는 실제 로컬 인증값과 업로드 후보 파일을 대조하며 값 자체는 출력하지 않습니다. GitHub Actions에서도 구문·테스트·비밀정보 패턴 검사를 실행합니다. GitHub의 Secret scanning과 Push protection도 사용하세요.

새 변경을 올릴 때:

```powershell
npm.cmd run check:deploy
git add .
git diff --cached --stat
git commit -m "Update travel planner"
git push origin main
```

`.env`에 `git add -f`를 사용하지 마세요. 공개 저장소에 비밀이 올라갔다면 파일 삭제만으로 해결되지 않습니다. 해당 키를 폐기·재발급하고 Git 이력도 처리해야 합니다.

## 2. Vercel 프로젝트 생성

1. [Vercel New Project](https://vercel.com/new)에서 본인 계정으로 로그인합니다.
2. GitHub 연결 권한을 주고 `zee-0217/my-travel`을 Import 합니다.
3. Root Directory는 저장소 루트, Framework Preset은 **Express**, Node.js는 **24.x**를 선택합니다. Output Directory를 `public`로 강제 지정하지 마세요. 그러면 API가 빠진 정적 사이트가 될 수 있습니다.
4. `vercel.json`은 설치 `npm ci`, 검사 `npm run check`, `src/app.js` 함수 최대 300초, Fluid Compute 및 CDN 보안 헤더를 지정합니다. 로컬 실행은 기존 `npm run dev`를 사용합니다.
5. 아래 환경변수와 세션 암호화 키를 설정한 후 Deploy 합니다. Redis 연결은 생략합니다. 환경변수 변경 뒤에는 Redeploy가 필요합니다.

[공식 Express 문서](https://vercel.com/docs/frameworks/backend/express)에 맞춰 `src/app.js`에서 Express 앱을 기본 내보내기합니다. Vercel에서는 `public/` 파일이 CDN에서 제공되므로 Express의 `express.static()`에만 의존하지 않고 `vercel.json`에도 보안 헤더를 지정했습니다. 기존 로컬 정적 파일 제공은 유지합니다.

CLI를 선호한다면 본인 계정에서 `npx vercel@latest login`, `npx vercel@latest link`, `npx vercel@latest`로 Preview를 생성하고 검증 후 `npx vercel@latest --prod`를 실행할 수 있습니다. 명령 인수에 API 키를 넣지 마세요.

## 3. Vercel 환경변수

프로젝트 **Settings → Environment Variables**에서 등록합니다. Production과 필요한 Preview 환경을 선택하고 인증키·토큰은 **Secret** 유형으로 저장하세요. 키를 README, `vercel.json`, GitHub 파일, 브라우저 JS에 입력하지 마세요. `NEXT_PUBLIC_` 또는 `VITE_` 접두어를 붙이지 않습니다.

| 변수 | 값·역할 |
| --- | --- |
| `OPENAI_API_KEY` | 본인 OpenAI 프로젝트 API 키, 서버 전용 |
| `OPENAI_MODEL` | 현재 계정에서 Responses API·구조화 출력·Function Calling을 사용할 수 있는 모델명 |
| `NAVER_API_HUB_CLIENT_ID` | NAVER API HUB 지역 검색 전용 ID |
| `NAVER_API_HUB_CLIENT_SECRET` | 지역 검색 전용 Secret |
| `NAVER_MAPS_CLIENT_ID` | 신규 NAVER Maps Application ID |
| `NAVER_MAPS_CLIENT_SECRET` | 신규 NAVER Maps Secret, 서버 전용 |
| `TOUR_API_KEY` | 한국관광공사 KorService2 활용 승인을 받은 공공데이터포털 키 |
| `KMA_API_KEY` | 기상청 API허브 키, 선택 |
| `KMA_SERVICE_KEY` | 공공데이터포털 단기예보 키, 위 키의 대안·선택 |
| `WEATHER_FREE_FALLBACK` | `true`: 기상청 실패·미제공 시 Open-Meteo 비상업용 무료 대체 |
| `SESSION_ENCRYPTION_KEY` | 32바이트 난수를 Base64로 인코딩한 서버 전용 Secret. 최초 한 번 생성 후 재배포 때 유지 |
| `SESSION_NAMESPACE` | 예: `my-travel-production`. Preview는 `my-travel-preview` 등 다르게 설정 |
| `AGENT_MAX_ITERATIONS` | `8` |
| `AGENT_MAX_TOOL_CALLS` | `16` |
| `AGENT_MAX_REPLANS` | `2` |
| `AGENT_TIMEOUT_MS` | `240000`, Vercel에서 최대 `270000` |
| `AI_REQUESTS_PER_HOUR` | 서버 인스턴스별 AI 생성·수정 요청 상한, 기본 `30` |
| `API_REQUESTS_PER_MINUTE` | 서버 인스턴스별 외부 조회 HTTP 요청 상한, 기본 `120` |

Vercel의 `VERCEL`, `VERCEL_ENV`, `PORT` 등 시스템 값은 수동 복사하지 않습니다. 로컬 `.env`의 `HOST=127.0.0.1`도 배포 변수로 복사할 필요가 없습니다. `NODE_ENV=production`은 Vercel 실행 환경에서 사용합니다.

NAVER Maps Client ID는 지도 SDK 인증을 위해 브라우저에 공개되는 식별자입니다. **Client Secret, OpenAI·지역 검색 API 키, 세션 암호화 키는 브라우저에 전달하지 않습니다.**

[환경변수 공식 안내](https://vercel.com/docs/environment-variables): 수정은 새 배포에만 적용됩니다. Preview에 운영용 키를 공유하기보다 별도 키와 호출 한도를 설정하는 편이 좋습니다.

## 4. Redis 없는 임시 수정 세션

요청에 따라 Redis 연결과 외부 DB 생성은 생략합니다. 브라우저의 **저장한 여행**은 계속 localStorage를 사용합니다. Vercel 함수가 바뀌어도 검색 장소 추가·채팅 수정을 이어갈 수 있도록 서버가 검증한 근거를 AES-256-GCM 암호화·인증 토큰으로 전달하며 유효기간은 30분입니다.

토큰은 서버 전용 `SESSION_ENCRYPTION_KEY`로만 복호화·검증할 수 있습니다. 변조, 다른 프로젝트·환경의 토큰, 만료, 계획과 검색 토큰의 교차 사용을 거부합니다. API 키는 토큰 내용에 넣지 않습니다. 암호화 토큰도 임시 권한이므로 공유하지 마세요. 토큰은 브라우저 메모리에서만 이어받고 localStorage·JSON 내보내기에 포함하지 않습니다. 새로고침 뒤에는 기존처럼 저장 일정을 직접 수정하거나 새 AI 계획을 생성할 수 있습니다.

본인 터미널에서 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`로 암호화 키를 생성하고 결과를 Vercel의 Secret 변수에만 등록하세요. 채팅·GitHub·예시 파일에는 붙이지 않습니다. 자동 등록 스크립트는 명시적으로 승인한 경우에만 사용하며 키를 메모리에서 생성해 stdin으로 전달하고 출력하지 않습니다. 키를 바꾸면 이전 임시 세션은 만료되므로 재배포 시 기존 값을 유지합니다.

Vercel에서 암호화 키 미설정 시 유료 AI 호출 전에 503 `SESSION_KEY_NOT_CONFIGURED`로 안내합니다. 토큰 변조·만료 시 410, 과도하게 큰 근거는 413으로 처리합니다. 복호화 뒤 펼친 데이터와 HTTP 본문 크기도 제한합니다. 로컬에서는 기존 메모리 세션을 계속 사용합니다. 향후 별도로 Redis REST 환경변수를 제공하면 선택적으로 공유 저장 모드를 사용할 수 있으나 이번 배포에는 연결하지 않습니다.

## 5. NAVER Maps 배포 도메인 허용

1. NAVER Cloud Platform Console에서 **신규 Maps → Application**의 현재 앱을 엽니다. 지역 검색용 NAVER API HUB 인증과 서로 다른 서비스입니다.
2. **Web Dynamic Map**과 **Directions 5** 사용 권한·이용 한도를 확인합니다.
3. **서비스 환경/Web 서비스 URL**에 최종 프로젝트 주소(예: `https://my-travel-xxxxx.vercel.app`)를 등록합니다. 커스텀 도메인이 있으면 그것도 등록합니다. 실제 주소를 사용하고 공유 최상위 `vercel.app` 전체나 광범위한 와일드카드를 허용하지 마세요.
4. 콘솔에서 `http://` 형식만 입력받는 경우 같은 호스트를 그 형식으로 입력합니다. 공식 안내는 HTTP/HTTPS 구분이 없다고 설명하므로 화면의 요구 형식을 따릅니다. localhost는 개발용으로 유지할 수 있습니다.
5. Preview URL이 매번 바뀌면 테스트할 정확한 주소를 별도 등록하거나 안정된 Preview 도메인을 사용합니다. 허용 URL 수 제한은 콘솔에서 확인하세요.
6. 새 배포 주소에서 새로고침하고 실제 장소가 있는 일정을 열어 마커·도로 경로·지도 인증 오류 유무를 확인합니다.

[NAVER 공식 Application 안내](https://guide.ncloud-docs.com/docs/en/maps-app/). REST Directions가 성공해도 Web Dynamic Map의 도메인 인증 성공을 의미하지는 않습니다. UI의 지도 오류 메시지와 브라우저 콘솔도 확인하세요.

## 6. 실제 배포 검증

```powershell
# 정적 파일, 보안 헤더, 비밀 파일 차단, API 상태 (유료 호출 없음)
npm.cmd run test:deployment -- https://YOUR-PROJECT.vercel.app
# 실제 NAVER 장소 검색·Directions·OpenAI 계획 생성·세션 기반 장소 추가
# OpenAI와 NAVER 계정의 실제 사용량이 발생할 수 있습니다.
npm.cmd run test:deployment -- https://YOUR-PROJECT.vercel.app --live
```

배포 보호가 켜진 경우 401/403/리다이렉트가 API 오류처럼 보일 수 있습니다. 본인 Vercel 프로젝트의 자동화 Bypass Secret을 필요할 때만 터미널 세션의 `VERCEL_AUTOMATION_BYPASS_SECRET`에 설정하세요. URL 쿼리나 Git 파일에 넣지 않습니다.

Web Dynamic Map은 최종 도메인에서 브라우저로 따로 확인합니다. 이어서 채팅 수정, 직전 수정 되돌리기, 저장·새로고침·다시 열기, 검색 장소 추가, JSON 다운로드를 확인하세요. localStorage는 origin별로 분리되어 localhost의 저장 일정이 배포 사이트로 자동 이전되지 않습니다.

## 7. 오류·한도·운영 점검

- OpenAI 401/403·400/404·429·시간 초과, NAVER 인증·쿼터·없는 경로, 날씨·TourAPI 실패는 안전한 오류/미확인으로 표시합니다. 원문 에러·키·인증 URL을 사용자 응답이나 로그로 보내지 않습니다.
- Agent 반복·Tool 호출·재계획·전체 시간 제한을 유지합니다. 300초 함수 시간보다 앱 제한을 짧게 두며, 현재 설정은 기본 240초입니다. 해당 Vercel 플랜에서 Fluid Compute와 최대 시간이 적용되는지 확인하세요.
- Redis 없이 운영하므로 앱 내 호출 카운터는 **인스턴스별 메모리 기준**이며 콜드 스타트·여러 인스턴스를 합친 전역 한도를 보장하지 않습니다. 정확한 요금 상한이나 사용자 인증도 대신하지 않습니다. Vercel Firewall/Deployment Protection, OpenAI 프로젝트 예산·사용 제한, NAVER API별 이용 한도·알림, Vercel 사용량·Spend Management를 함께 설정하세요. Tool 내부 여러 API 호출은 HTTP 요청 카운터 1건 안에 포함될 수 있습니다. 선택적 Redis 모드를 연결할 때만 원자적 공유 카운터를 사용합니다.
- 검증 중에는 가능한 Vercel Deployment Protection·Firewall을 사용하고, 공개 이후도 비용·과도한 사용량을 감시하세요. Public GitHub 저장소와 Vercel 접근 공개 범위는 별개입니다.
- Vercel Logs에서 상태 코드·기간·안전한 오류 코드 위주로 확인하고 요청 본문·환경변수 덤프를 기록하지 마세요. 변수 변경 후 재배포, API 활용 승인, 도메인 등록과 계정 잔액을 우선 점검합니다.

## 8. 검증 상태의 구분

`npm run check:deploy`는 로컬/CI 코드 검증입니다. Node.js 24 테스트, 서버 인스턴스 간 세션 복원 테스트, 로컬에서의 실제 API 성공은 **실제 Vercel 배포 성공을 대신하지 않습니다.** 배포 URL에서 위 검사를 실행하고 성공 결과를 확인하기 전까지 배포 실호출 검증은 미완료입니다.
