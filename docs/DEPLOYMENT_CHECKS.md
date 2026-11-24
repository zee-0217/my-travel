# 배포 준비 검증 결과

점검일: 2026-11-24 (한국 시간)

## 확인 완료

- Git 2.55.0.windows.5 및 GitHub CLI 설치 확인.
- 허용된 네트워크 환경에서 `zee-0217` GitHub 인증과 빈 공개 저장소 `zee-0217/my-travel` 접근 확인. 제한된 실행 환경의 인증 실패 표시와 구분함.
- Vercel Express 진입점 기본 내보내기, `public/` CDN 보안 헤더, Node.js 24 설정, 최대 함수 300초·Agent 기본 240초 설정 추가.
- `.gitignore`·`.vercelignore`와 빈 `.env.example`, 실제 로컬 인증값 대조·키 패턴 검사 준비. 비밀 값은 검사 결과에 출력하지 않음.
- 기본 로컬 Node.js와 별도 Node.js 24 런타임에서 자동 테스트 **120개 통과**. GitHub Actions의 Node.js 24 검사도 성공.
- Redis 없이 독립 서버 인스턴스 간 암호화 토큰으로 Agent 컨텍스트·검색 결과를 복원하는 방식을 추가. 변조·다른 키/환경·만료 거부, 실제 HTTP 장소 추가·수정과 내보내기 제외 검증. Redis 연결은 사용자 요청으로 생략.
- 실제 Chrome에서 예산 쉼표, 사진 지역 선택·롤링, 검색 장소 추가·되돌리기·AI 반영, 일정 저장·열기·수정·삭제·JSON 내보내기 회귀 검사 통과.

## 실제 외부 API 호출 결과 — 로컬 production 설정

`NODE_ENV=production`의 별도 로컬 서버 `http://127.0.0.1:3001`에 대해 `scripts/smoke-deployment.mjs --live`를 실행함. **Vercel 배포에서 실행한 결과가 아님.**

| 항목 | 결과 |
| --- | --- |
| 프론트엔드·보안 헤더 | 성공 |
| `.env`, Git 설정, 서버 소스 비공개 | 성공 |
| 상태·환경변수 설정 여부 조회 | 성공 (키 값 노출 없음) |
| NAVER API HUB 실제 장소 검색 | 성공 |
| 신규 Maps Directions 5 실제 자동차 경로 | 성공 |
| OpenAI Responses 실제 계획 생성 | 성공 |
| 생성한 일정에 실제 검색 장소 추가 | 성공 |
| Agent의 실제 선택 Tool | search_places, get_place_details, get_routes, web_search 성공 |

위 실제 로컬 호출은 로컬 메모리 세션을 사용함. 외부 Redis는 생성·연결하지 않음. Vercel용 암호화 토큰은 독립 서버 인스턴스를 사용한 자동 테스트로 검증함.

## 실제 Vercel Production 검증 — 완료

운영 URL: **https://my-travel-peach.vercel.app**

Vercel 프로젝트: `my-travel` (`zee0217`). GitHub `zee-0217/my-travel`과 연결됨. 최초 배포와 실제 API 키·새 세션 암호화 키의 Vercel 전송에 대한 사용자 명시적 승인을 받아 완료. 키는 stdin으로만 전송했으며 Secret 환경변수로 Preview·Production에 등록하고 재배포함. Redis는 요청대로 생략함.

운영 주소에서 `scripts/smoke-deployment.mjs`와 **실제 Chrome·실제 API 응답**을 사용하는 `scripts/audit-browser-deployment.mjs --live`로 확인:

| 항목 | 결과 |
| --- | --- |
| 운영 화면·정적 파일·보안 헤더·서버 상태 | 성공 |
| `.env`·Git 설정·서버 소스 공개 차단 | 성공 |
| 필요한 서버 환경변수 인식 | 모두 확인 |
| OpenAI Responses 실제 일정 생성 | 성공, 실제 검색 장소 2곳 포함 |
| Agent 선택 Tool | search_places, get_routes, get_weather, web_search 성공 |
| 실제 NAVER 지역 검색·Directions 5 | 성공, 테스트 구간 3,610m·736,828ms |
| 운영 도메인 Web Dynamic Map | ready, 마커 2개·실제 경로 선형 1개 |
| 암호화 토큰으로 검색 장소 추가 | 성공 |
| 실제 AI 채팅 수정·API 추가 호출 없는 되돌리기 | 성공 |
| 일정 저장·새로고침·다시 열기 | 성공, 저장 데이터에 sessionToken 미포함 |
| 브라우저 실행 예외 | 없음 |

이 시점의 검증 배포: https://my-travel-3u6y1se2a-zee0217.vercel.app (`Ready`). 고정 운영 별칭은 위 `my-travel-peach.vercel.app`을 사용함. 배포별 생성 URL은 Vercel 인증이 필요할 수 있고, 운영 별칭은 일반 HTTPS 요청으로 확인함. 향후 커스텀 도메인·허용 주소 변경 시 지도 인증을 해당 주소에서 다시 확인해야 함.

재현: `npm run audit:deployment -- https://my-travel-peach.vercel.app --live`. 실제 OpenAI·NAVER 사용량이 발생함. 키나 세션 토큰은 결과에 출력하지 않음.

비용과 호출량은 각 제공자 콘솔에서 점검. 테스트가 성공해도 미래의 API 쿼터·잔액·운영 가용성을 보장하지 않음.
