# 국내 여행 AI Agent

**배포**: [GitHub·Vercel 설정과 환경변수 등록](docs/DEPLOYMENT.md), [검증 결과와 남은 실제 배포 확인](docs/DEPLOYMENT_CHECKS.md). Vercel은 Redis 없이 암호화된 임시 수정 세션을 사용하고, 여행 일정 저장은 계속 localStorage를 사용합니다.

예산 입력은 천 단위 쉼표를 지원합니다. 검색 장소는 날짜와 방문 시간을 정해 일정에 추가할 수 있고, 미리보기에서 고른 장소도 AI 생성 후 반영합니다. [장소 추가·예산 입력·관광지 사진 롤링](docs/PLAN_INTERACTIONS.md)

**일정 저장**: 생성 결과의 ‘여행 일정 저장’으로 이 브라우저에 보관하고 ‘저장한 여행’ 목록에서 다시 열 수 있습니다. 제목·방문 시각·메모 직접 수정, 삭제, JSON 내보내기를 지원합니다. [저장 범위와 사용법](docs/SAVED_TRIPS.md)

무료 날씨 대체(Open-Meteo), 공식 영업시간·숙박 참고 요금표(TourAPI)의 설정과 실시간 객실 데이터의 한계는 [무료 공공 API 안내](docs/free-public-data.md)를 참고하세요. TourAPI는 별도 무료 활용 신청 후 `TOUR_API_KEY`가 필요합니다.

지역 드롭다운·실제 생성 서버 연결·전체 기능 재점검 결과와 아직 필요한 서비스는 [전체 점검 보고서](docs/AUDIT.md)를 참고하세요. 접속은 http://localhost:3000 입니다. 화면 초기화·입력 오류·연결 설정 상태를 앱에서 확인할 수 있습니다.

HTML·CSS·JavaScript와 Node.js·Express 기반 국내 여행 플래너입니다. **Function Calling Agent**가 필요한 도구를 선택하며 신규 **NAVER Maps Web Dynamic Map**에 실제 장소와 조회 경로를 표시합니다.

**Level 2**: 기상청 공식 단기예보 `get_weather`, 비 예보에 따른 실내 대안 검색, 하루 방문 수·자동차 이동시간 제한을 지원합니다. 예보 범위 밖 날짜는 미확인입니다. [설정과 검증 방법](docs/LEVEL2.md)

**일정 검증·재계획**: 예산, 방문 수, 긴 자동차 이동, 시간 중복, 확인된 영업시간, 날씨 적합성을 JavaScript로 점검합니다. 문제가 있으면 LLM이 필요한 도구를 다시 선택해 기본 최대 2회 수정하고, 발견된 문제·수정 이유·확인 필요 항목을 표시합니다. [검증 기준과 제한](docs/ITINERARY_VALIDATION.md)

**대화형 수정**: 생성된 일정 아래 채팅에서 자연어로 변경을 요청합니다. 필요한 날짜만 수정하고 같은 Agent Loop로 도구 선택과 재검증을 수행하며 변경 내용·이유를 보여 줍니다. 직전 수정은 API 재호출 없이 되돌릴 수 있습니다. 수정용 일정·근거는 서버 메모리에 최대 40버전/30분간 임시 보관합니다. [수정 API·보관 범위·되돌리기](docs/CHAT_EDIT.md)

**숙소 추천**: 숙박 일정에 NAVER 검색 숙박업소 후보를 연결하고, 방문 장소까지의 직선거리와 실제 자동차 이동시간을 비교합니다. 숙박 예산·유형을 지정할 수 있으며 요금·예약 가능 여부는 확인 필요로 구분합니다. 확인된 공식 예약 페이지에만 링크를 제공하며 예약 기능은 없습니다. [추천·요금·링크 확인 기준](docs/LODGINGS.md)

모델의 도구 선택 → 서버 실행 → 결과 피드백 → 추가 선택 → 최종 일정의 루프를 사용합니다. 고정 순서로 모든 도구를 실행하지 않습니다. 실제 호출은 Agent Trace에 표시하며 웹 검색 출처도 링크로 제공합니다. 미확인 가격과 이동 시간은 생성하지 않습니다. [Agent 구조·제한·검증](docs/AGENT.md)

## 여행 계획 만들기

- 지역, 출발일, 1~7일 기간, 인원, 총예산, 복수 취향, 이동수단, 추가 요청을 입력합니다.
- 처음에는 로컬 샘플 미리보기를 표시하며 API를 호출하지 않습니다. **AI 여행 계획 만들기**를 누르면 입력 조건을 Express 서버를 통해 OpenAI에 전달합니다.
- 생성 중에는 로딩 표시와 중복 제출 방지, 생성 취소를 제공합니다. 오류가 나면 이전 결과를 유지하고 오류 메시지와 재시도 버튼을 표시합니다.
- 날짜 탭으로 일정을 전환하고, 지도 번호를 누르면 해당 장소를 강조합니다. 날짜 탭은 방향키·Home·End로도 이동할 수 있습니다.
- 날짜별 일정과 요청 반영 요약을 표시합니다. 비용·이동 시간은 도구 근거가 있을 때만 표시하며 없으면 미확인으로 유지합니다.
- **일정 다운로드**는 현재 표시된 결과를 JSON으로 내려받습니다. **기본값으로**는 입력과 결과를 함께 초기화합니다.
- 날짜별 실제 검색 좌표를 지도 마커로 표시하고 조회한 자동차 경로 선형이 있을 때만 선을 그립니다. 확인되지 않은 장소·경로를 임의로 그리지 않습니다. [지도 설정과 결과 화면](docs/LEVEL1_UI.md)
- 추가 요청도 AI에 전달됩니다. 생성 결과에서 반영 여부를 확인하세요. 앱은 입력과 결과를 파일·DB·브라우저 저장소에 저장하지 않으며 새로고침하면 미리보기로 돌아갑니다. OpenAI 요청에는 `store: false`를 지정합니다. 이것이 OpenAI의 모든 처리 로그 보관을 없애는 설정은 아닙니다.

`public/js/sample-data.js`는 초기 미리보기를, `public/js/app.js`는 렌더링을, `public/js/api.js`는 같은 출처의 `/api/plan` 요청을 담당합니다. OpenAI SDK와 API 키는 백엔드에만 있습니다. 모바일 화면, 키보드 조작, 동작 줄이기 설정을 지원합니다.

## 실제 장소 검색

위의 여행 지역을 입력하고 '가보고 싶은 장소를 찾아요'에서 키워드 또는 관광지·음식점·카페 버튼으로 검색합니다. NAVER API HUB가 반환한 장소명, 도로명/지번 주소, 카테고리, WGS84 좌표, 업체 제공 링크만 표시합니다. 영업시간·평점·가격은 생성하지 않습니다. API가 값을 주지 않으면 미제공으로 표시합니다.

수동 검색 결과는 AI 일정과 별도로 표시하며 Agent가 선택한 검색 결과는 해당 요청의 일정 구성에 활용합니다. 검색은 지역명을 포함한 키워드 방식이므로 결과 주소를 확인하세요. [장소 검색 문서](docs/PLACE_SEARCH.md)

검색 결과 카드에서 출발지·도착지를 선택하면 **자동차 경로 확인**으로 Directions 5의 거리와 시간을 조회합니다. 수동 조회는 Agent 일정과 별도이며, 지도는 선택한 날짜의 Agent 경로를 표시합니다. 확인할 수 없는 경로와 도보·대중교통 경로는 추정하지 않습니다.

직접 호출하는 `calculate_budget` 함수는 확인 금액·추정치·미확인을 구분합니다. Agent 경로에서는 근거 없는 모델 가격을 미확인으로 바꿉니다. [두 Tool의 독립 실행](docs/TRAVEL_TOOLS.md)

```powershell
npm.cmd run test:places        # 독립 함수 자동 검사 (네트워크 없음)
npm.cmd run test:places:live   # 실제 API HUB: 강릉 관광지·음식점·카페 검색
npm.cmd run test:places:live -- 제주 카페
npm.cmd run test:routes:live   # 실제 Maps 자동차 경로 요청 1회
npm.cmd run demo:budget        # 외부 API 없는 예산 계산 예제
```

## 실행

Node.js 22 이상과 npm이 필요합니다. 이 환경에서는 Node.js v26.8.1, npm 11.19.0 설치를 확인했습니다.

```powershell
npm.cmd install
npm.cmd run dev
```

브라우저에서 <http://127.0.0.1:3000>을 엽니다. 코드가 바뀌면 Node.js watch 모드가 서버를 재시작하며, 브라우저는 직접 새로고침합니다. `.env` 변경 시 서버를 다시 실행하세요.

PowerShell 실행 정책으로 `npm.ps1`이 차단되면 위처럼 `npm.cmd`를 사용합니다. 실행 정책을 변경할 필요가 없습니다. 다른 셸에서는 `npm`도 사용할 수 있습니다.

```powershell
npm.cmd start       # watch 없이 실행
npm.cmd run check   # JavaScript 문법 검사
npm.cmd test        # HTTP, 입력/응답 검증, SDK 요청, 오류/취소 처리 검사 (실제 API 호출 없음)
npm.cmd ci         # 다른 환경에서 lockfile 기준으로 재설치
```

기본 바인딩은 로컬 전용 `127.0.0.1`입니다. 키가 비어 있어도 서버와 샘플 플래너를 실행할 수 있습니다. `/api/health`는 로컬 서버 상태만 확인하며 외부 API 인증 여부는 확인하지 않습니다. 시작 시 외부 API 요청이나 API 비용이 발생하지 않습니다.

## 환경 변수

기존 `.env`는 값을 보존합니다. 새 환경에서 `.env`가 없다면 `.env.example`을 복사한 뒤 실제 값을 입력하세요. 기존 `.env`를 덮어쓰지 마세요.

| 변수 | 용도 |
| --- | --- |
| `NODE_ENV`, `HOST`, `PORT` | 실행 환경, 바인딩 주소, 포트 |
| `OPENAI_API_KEY` | 서버 전용 OpenAI API 키 |
| `OPENAI_MODEL` | 계정에서 사용 가능하고 Responses API·Structured Outputs를 지원하는 모델 ID |
| `NAVER_API_HUB_CLIENT_ID` | NAVER API HUB 애플리케이션 Client ID |
| `NAVER_API_HUB_CLIENT_SECRET` | NAVER API HUB 애플리케이션 Client Secret |
| `NAVER_MAPS_CLIENT_ID` | NCP 신규 Maps 애플리케이션 Client ID |
| `NAVER_MAPS_CLIENT_SECRET` | NCP 신규 Maps 애플리케이션 Client Secret |
| `KMA_API_KEY` | 기상청 API허브 단기예보 authKey (서버 전용) |
| `KMA_SERVICE_KEY` | 대안: 공공데이터포털 단기예보 서비스 인증키 (서버 전용, 둘 중 하나 설정) |

API HUB에서 지역 검색 사용 권한을, 신규 Maps에서 사용할 지도·경로 API를 각각 신청합니다. 두 서비스의 Client ID/Secret은 별도로 관리합니다. NCP 계정용 Access Key/Secret Key와 혼동하지 마세요.

지역 검색은 **NAVER API HUB**의 `https://naverapihub.apigw.ntruss.com/search/v1/local`을 사용하도록 설정했습니다. 신규 Maps는 `https://maps.apigw.ntruss.com`을 사용합니다. 두 REST API 모두 `x-ncp-apigw-api-key-id`, `x-ncp-apigw-api-key` 헤더를 사용하지만 각 서비스의 인증 정보를 전달해야 합니다.

## 디렉터리

```text
public/                 HTML, CSS, 브라우저 JavaScript (유일한 웹 공개 폴더)
src/
  app.js                Express 앱, 정적 파일, 오류 처리
  server.js             서버 실행
  config/env.js         .env 로딩, 서버 전용 설정
  routes/               health, plan, places, POST /api/routes, /api/budget, /api/weather
  agents/               입력/출력 스키마, 프롬프트, 여행 계획 생성
  lib/                  사용자에게 반환할 안전한 오류
  services/             OpenAI 클라이언트, search_places, get_routes, get_weather
  tools/                calculate_budget 및 Tool 내보내기
scripts/check.js        문법 검사
tests/app.test.js       외부 API를 호출하지 않는 HTTP 검사
docs/ROADMAP.md         Level 1~3 개발 순서
.env.example            빈 인증 값으로 된 공유용 템플릿
```

프론트엔드와 API를 같은 Express 서버에서 제공하므로 별도 빌드 도구나 CORS 설정이 필요하지 않습니다. `openai`, `express`, `dotenv`, `helmet`을 사용하고, 서버 변경 감지는 Node.js 내장 watch 모드를 사용합니다. NAVER 지역 검색은 서버의 Node.js 내장 `fetch`를 사용합니다.

## 인증 정보 보호

- `.env`, `.env.*`는 Git에서 제외하고, 값이 비어 있는 `.env.example`만 공유합니다. `node_modules/`, 로그, 로컬 인증 파일도 제외합니다.
- Express는 `public/`만 공개합니다. 비밀 키는 `public/`, HTML, 브라우저 JavaScript, 응답, 로그에 넣지 않습니다.
- OpenAI, NAVER API HUB, Maps REST 인증 정보는 백엔드에서만 사용합니다. AI 생성 및 검색 텍스트는 `textContent`로 표시하며 HTML로 실행하지 않습니다.
- Web Dynamic Map의 SDK 인증용 Client ID는 브라우저에 전달되는 공개 식별자이며, 등록 도메인 제한을 함께 설정해야 합니다. Client Secret과 기상청 인증키는 서버에만 보관합니다.
- `.gitignore`는 이미 Git에 추적된 비밀을 제거하지 않습니다. 커밋 전에 `git status`를 확인하고, 실제 인증 값은 `.env`에만 입력하세요. 외부로 유출된 키는 폐기하고 재발급해야 합니다.

## 공식 문서

- [OpenAI Responses API 시작하기](https://developers.openai.com/api/docs/quickstart)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [NAVER API HUB 지역 검색](https://api.ncloud-docs.com/docs/naver-api-hub-search-local)
- [NCP 신규 Maps 개요](https://api.ncloud-docs.com/docs/application-maps-overview)
