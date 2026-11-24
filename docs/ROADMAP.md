# 단계별 개발 계획

Responses API Function Calling Agent와 세 함수 및 내장 웹 검색, 신규 Maps Web Dynamic Map을 연결했습니다. 부산·제주도 요청과 실제 지도 표시 검증을 완료했습니다.

Level 2로 기상청 `get_weather`, 선택적 실내 대안 검색과 일정 변경, 방문 수·이동시간 제한을 추가했습니다. 인증 설정과 검증 범위는 [LEVEL2.md](LEVEL2.md)를 참고하세요. 실제 기상청 예보 검증에는 별도 기상청 인증키가 필요합니다.

| 단계 | 구현 범위 | 주로 확장할 위치 |
| --- | --- | --- |
| 준비 (현재) | 정적 준비 화면, health API, 서비스별 인증 설정 | `src/config`, `src/services`, `public` |
| 프론트엔드 (완료) | 여행 조건 폼, 샘플 일정, 개념 지도, 예산 계산, 실행 기록, JSON 다운로드 | `public`, `tests/sample-data.test.js` |
| Level 1 (구현) | POST /api/plan, Responses API 일정 생성, 입력/출력 검증, 로딩·오류·취소·재시도 | `public`, `src/routes/plan.js`, `src/agents`, `src/services/openai.js` |
| Level 2 기반 (구현) | search_places, GET /api/places, 검색 화면, 좌표 정규화, 독립 테스트 | `src/services/naver-api-hub.js`, `src/routes/places.js`, `public/js/places.js` |
| Agent Loop (구현) | LLM 도구 선택, 함수 실행·결과 피드백, 웹 검색, 제한과 실제 Trace, 근거 참조 검증 | `src/agents/agent-loop.js`, `src/agents/tool-schemas.js`, `src/agents/agent-result.js` |
| Tool 기반 (구현) | get_routes, calculate_budget, 경로 조회 화면, 미확인/추정 가격 구분 | `src/services/naver-maps.js`, `src/tools`, `src/routes/travel-tools.js` |
| 지도 결과 화면 (구현) | 신규 Maps SDK, 날짜별 실제 마커·경로, 예산 표, 출처와 Tool Trace | `public/js/trip-map.js`, `src/routes/maps-config.js`, `docs/LEVEL1_UI.md` |
| Level 2 (구현) | 기상청 날씨, 실내 대안 선택, 취향·방문 수·이동 제한, 날짜별 확인 상태 | `src/services/kma-weather.js`, `src/agents`, `public`, `docs/LEVEL2.md` |
| 일정 검증·재계획 (구현) | JS 검증, 문제 피드백, 제한된 선택적 재계획, 변경 이유·확인 필요 표시 | `src/agents/validate-itinerary.js`, `src/agents/agent-loop.js`, `docs/ITINERARY_VALIDATION.md` |
| 대화형 수정 (구현) | 현재 일정·근거 재사용, 날짜 패치, 재검증, 변경 이유, 직전 수정 되돌리기 | `src/agents/edit-plan.js`, `src/services/plan-store.js`, `public/js/app.js`, `docs/CHAT_EDIT.md` |
| 숙소 추천 (구현) | NAVER 숙박 후보, 예산·유형, 방문지 거리·자동차 경로 비교, 지도·채팅 연결, 확인된 공식 링크 | `src/agents/lodging-result.js`, `src/agents/lodging-schema.js`, `docs/LODGINGS.md` |

공통 흐름은 `브라우저 → Express 라우터 → Agent → 서비스 모듈`로 유지합니다. 각 단계의 라우터는 구현 후 등록하며, 아직 사용할 수 없는 기능의 성공 응답을 만들지 않습니다.

Level 1에서는 서버에서 여행 조건을 검증하고 OpenAI의 `responses.create`를 사용합니다. 모델 이름은 `.env`에서 관리하고, 구조화된 일정의 응답 형식과 사용자에게 보여줄 오류를 정의합니다.

Level 2는 기존 실제 검색·좌표 정규화를 유지하며, 필요한 경우에만 기상청 예보를 확인하고 실내 장소로 조정합니다. 지역 검색은 `display` 최대 5, `start` 1 제한을 고려합니다. 예보 밖 날짜와 미조회 경로는 미확인으로 표시합니다.

Level 3 확장에서도 기존 신규 Maps 인증과 등록 도메인 제한을 유지합니다. Client Secret은 브라우저로 보내지 않습니다. Directions 5는 운전 경로이므로 도보·대중교통 경로로 표시하지 않습니다. 실시간 교통과 영업 정보의 한계를 화면에 반영합니다.

외부 요청 기능을 추가할 때 입력 검증, 제한 시간, 호출 횟수 제한, 안전한 오류 처리를 함께 구현합니다. 공개 배포 전에는 인증·사용량 제한과 HTTPS 정책을 추가합니다.
