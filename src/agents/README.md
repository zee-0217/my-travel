# Agent 확장 위치

Level 1 여행 계획 흐름을 구현했습니다.

- `plan-schema.js`: HTTP 입력과 방문 수·이동시간 제한 검증
- `travel-planner.js`: 기존 여행 계획 생성 인터페이스
- `agent-result.js`: AI JSON Schema, 실제 근거와 날짜별 날씨·이동 제한 상태 연결

- `routes/`: HTTP 입력 검증과 응답
- `agents/`: 여행 조건 해석, 일정 생성, 도구 호출 흐름
- `services/`: OpenAI Responses, NAVER API HUB, 신규 Maps 연동
- `config/`: 서버 전용 환경 설정

Level 2에서는 기상청 날씨 도구와 비 예보 시 실내 대안, 취향·방문 수·이동 제한을 지원합니다. [Level 2 설정](../../docs/LEVEL2.md)
현재는 Function Calling Agent Loop가 필요한 도구만 선택합니다. `agent-loop.js`는 실행과 결과 피드백을, `tool-schemas.js`는 스키마를, `agent-result.js`는 근거 참조 검증을 담당합니다. 내장 web_search와 실제 Tool Trace를 지원합니다. [전체 설명](../../docs/AGENT.md)
