# POST /api/plan

`.env`에 `OPENAI_API_KEY`, `OPENAI_MODEL`을 설정한 뒤 서버를 재시작합니다. 기존 `.env` 값은 자동으로 바꾸지 않습니다. 모델은 Responses API와 Structured Outputs를 지원해야 합니다.

브라우저 → Express → Responses API Agent Loop → 실제 도구 실행·결과 피드백 → 최종 검증 → 브라우저 순서입니다. 네 함수(search_places, get_routes, calculate_budget, get_weather)와 내장 웹 검색을 등록하며 모델이 필요에 따라 선택합니다. 현재 프로토콜은 [Agent 문서](AGENT.md)를 참조하세요.

## 요청

`Content-Type: application/json`

```json
{
  "region": "강릉",
  "startDate": "2026-12-01",
  "duration": 2,
  "travelers": 2,
  "budget": 600000,
  "preferences": ["자연", "맛집", "휴식"],
  "transport": "car",
  "maxPlacesPerDay": 4,
  "maxTravelMinutesPerLeg": 30,
  "maxTravelMinutesPerDay": 90,
  "requests": "부모님과 함께하니 걷는 코스는 짧게 해 주세요."
}
```

기간은 1~7일, 인원은 1~20명, 총예산은 1만~1억원 정수입니다. 지역은 1~40자, 추가 요청은 500자까지입니다. `transport`는 `car`·`rental`·`transit`, 취향은 맛집·관광·자연·휴식·쇼핑 배열입니다. 출발일은 유효한 `YYYY-MM-DD`이며 지원 범위는 2000-01-01~2100-12-24입니다. 브라우저에서는 오늘 이후를 선택합니다. 모델·API 키·도구를 클라이언트가 지정할 수 없습니다.

## 응답

성공은 `200 { "plan": { ... } }`입니다. plan에는 입력 조건, `source: "openai"`, `isSample: false`, `title`, `summary`, `days`, `costs`, `total`, `remaining`, `budgetCalculation`, `budgetNote`, `warnings`, `disclaimer`, `trace`, `sources`가 포함됩니다. 미확인 금액·합계·잔여 예산은 `null`입니다.

대화형 수정을 위해 planId를 함께 반환합니다. `POST /api/plan/revise`에 planId, request, targetDay를 보내 현재 서버 일정을 수정합니다. [수정 API 문서](CHAT_EDIT.md)

숙소 추천 입력: lodgingMode(`recommend`/`none`), lodgingType(`any`/`hotel`/`pension`/`guesthouse`/`resort`), lodgingBudget(null 또는 전체 인원·전 기간 숙박 예산 상한). `plan.lodgings`에 검색 후보, 일정 연결, 거리·자동차 이동 비교와 확인 상태를 반환합니다. [숙소 결과와 확인 기준](LODGINGS.md)

일정 검증 확장으로 `days[].stops[].endTime`(계획상 종료 시각), `openingHours`(서버의 확인 근거 또는 null), `environment`, `plan.validation`을 포함합니다. 초안을 JavaScript로 검사하고 필요한 경우 기본 최대 2회 자동 수정합니다. 해결되지 않은 문제도 200 응답의 검증 보고서에 남습니다. 미확인은 검증 통과로 취급하지 않습니다. [상세 결과 형식](ITINERARY_VALIDATION.md)

- `days`: 요청한 일수만큼 날짜를 서버에서 배정하며, 날짜별 1~maxPlacesPerDay개 장소와 실제 조회된 자동차 이동정보, `weather`, `travelConstraints`를 표시합니다. 방문 시각·체류는 계획 제안입니다. 미조회 날씨와 이동정보는 미확인입니다.
- `costs`: 실제 예산 도구 결과이며 가격 근거가 없으면 null/unknown입니다. 총액과 잔여 예산도 미확인 항목이 있으면 null입니다.
- AI 응답의 JSON, 필드 길이·타입, 일수, 장소 수, 시간 순서, 음수 비용, 당일 숙박비를 검사합니다. 구조가 맞아도 장소나 가격의 사실성을 검증한 것은 아닙니다.

실패는 `{ "error": { "code": "...", "message": "사용자용 안내" } }`입니다. 원본 SDK 오류·프롬프트·헤더·인증 정보·스택은 반환하지 않습니다.

Level 2 추가 입력은 생략할 수 있습니다. maxPlacesPerDay는 기본 4(1~6), maxTravelMinutesPerLeg는 기본 null(5~180분), maxTravelMinutesPerDay는 기본 null(5~600분)입니다. 기상청 인증과 독립 `POST /api/weather`는 [Level 2 문서](LEVEL2.md)를 참조하세요.

| 상태 | 코드 | 의미 |
| --- | --- | --- |
| 400 / 413 / 415 | INVALID_INPUT / INVALID_REQUEST / JSON_REQUIRED | 입력이나 본문 형식·크기 오류 |
| 422 | AI_REFUSAL | 모델이 생성을 거절함 |
| 429 | AI_RATE_LIMIT | OpenAI 호출 한도·잔액 문제 |
| 503 | AI_NOT_CONFIGURED / AI_AUTH_ERROR / AI_MODEL_ERROR | 서버 설정·인증·모델 호환성 확인 필요 |
| 504 | AI_TIMEOUT | 응답 지연 |
| 502 | AI_INCOMPLETE / INVALID_AI_RESPONSE / AI_UNAVAILABLE | 불완전·잘못된 응답 또는 서비스 연결 오류 |

개별 SDK 요청 제한 시간은 90초이며 자동 재시도는 하지 않습니다. 전체 Agent 제한은 기본 240초이며 환경 변수로 조정합니다. 취소/연결 종료는 서버 요청에도 중단 신호를 전달하지만 이미 처리된 API 사용량까지 되돌리지는 못합니다. 재시도 버튼은 새 요청을 전송합니다. 시작·새로고침·자동 테스트는 실제 OpenAI API를 호출하지 않습니다.
