# Function Calling 여행 Agent

`POST /api/plan`은 Responses API에서 모델이 선택한 도구를 실행하고 결과를 다시 전달하는 Agent Loop입니다. 모든 도구를 순서대로 실행하지 않습니다. `tool_choice: "auto"`이므로 도구 없이 끝내거나 일부 도구만 선택할 수 있습니다.

## 구조와 프로토콜

대화형 수정도 동일한 `createAgentPlanner()`를 사용합니다. 서버에 저장한 현재 초안과 도구 근거를 시드하고 모델이 날짜별 수정 패치를 반환하면 병합·재검증합니다. [대화형 수정 흐름](CHAT_EDIT.md)

- `src/agents/tool-schemas.js`: search_places, get_routes, calculate_budget, get_weather의 엄격한 스키마와 인수 재검증
- `src/agents/agent-loop.js`: 함수 허용 목록, 실행·오류 피드백, 최대 횟수·취소·Trace
- `src/agents/agent-result.js`: 최종 응답과 실제 도구 근거 연결
- `src/agents/travel-planner.js`: 기존 인터페이스와 호환되는 진입점

함수는 `type: "function"`, `strict: true`로 등록합니다. 최신 관광 정보 확인에는 내장 `web_search`를 선택할 수 있습니다. 함수는 Node.js에서, 내장 웹 검색은 OpenAI에서 실행합니다. [공식 함수 호출 문서](https://developers.openai.com/api/docs/guides/function-calling), [공식 웹 검색 문서](https://developers.openai.com/api/docs/guides/tools-web-search)

Level 2에서는 날씨가 일정에 영향을 줄 때 `get_weather`를 선택할 수 있습니다. 비·눈 예보 또는 강수확률 60% 이상이면 취향에 맞는 실내 대안을 검색하거나 기존 결과를 재사용하도록 지시합니다. 고정 호출 순서나 강제 날씨 조회는 없습니다. 실제 날씨·이동 제한 검증 결과는 서버가 도구 결과에서 연결하며 LLM이 숫자를 만들어 채우지 않습니다. [Level 2 세부 내용](LEVEL2.md)

모델의 `function_call`을 검증해 함수를 실행하고 동일한 `call_id`로 `function_call_output`을 전달합니다. 오류도 안전한 JSON으로 돌아가므로 모델이 조건을 수정하거나 미확인으로 끝낼 수 있습니다. `store: false`로 전체 이력을 전달하며 reasoning·내장 도구 항목도 보존합니다. stateless reasoning을 위해 `reasoning.encrypted_content`를 요청하되 브라우저에는 전송하지 않습니다.

## 근거 없는 가격·시간 방지

최종 JSON은 금액이나 이동 시간을 자유롭게 쓰지 않고 도구 실행 결과를 참조합니다.

- `placeRef: {callId,index} | null`: 실제 검색 결과 장소
- `routeCallId: string | null`: 이 장소에서 다음 장소까지 조회한 실제 자동차 경로
- `budgetCallId: string | null`: 실제 예산 계산 결과

서버는 현재 장소→다음 장소의 좌표가 해당 경로 도구의 입력과 정확히 일치하는지 검사합니다. 다르면 그 이동 시간은 확인 불가입니다. 경로 도구에는 이번 요청의 검색 결과에서 확인한 좌표만 사용할 수 있습니다. 대중교통 요청을 자동차 경로로 대체하지 않습니다.

현재 폼에는 총예산만 있고 개별 단가 근거가 없습니다. 모델이 제출한 숫자 가격과 근거 문자열은 확인된 가격으로 인정하지 않으며 예산 도구 실행 전에 `unknown/null`로 바꿉니다. 당일 숙박 제외 0원만 논리적인 제외로 허용합니다. 웹 출처 URL 자체도 정량 가격 검증으로 취급하지 않습니다. 사용자 가격 입력을 구조화하거나 웹 가격을 검증·추출하는 기능은 이번 단계에 포함하지 않습니다.

도구가 실행되지 않았거나 가격이 미확인이면 전체 비용·잔여 예산을 `null`로 반환하고 화면에서도 미확인으로 표시합니다. 서술문에 작성된 숫자 가격·시간·거리·무료 표현은 보수적으로 가립니다. 방문 시각과 체류 제안은 여행 계획이며 실제 이동 시간이나 영업시간이 아닙니다.

## 설정과 제한

`.env`에서 선택적으로 설정할 수 있으며 없으면 기본값을 사용합니다.

| 변수 | 기본값 | 범위 |
| --- | --- | --- |
| AGENT_MAX_ITERATIONS | 8 | 1~12회 Responses 요청 |
| AGENT_MAX_REPLANS | 2 | 0~4회 검증 후 재계획 |
| AGENT_MAX_TOOL_CALLS | 16 | 1~30개 함수/내장 도구 호출 |
| AGENT_TIMEOUT_MS | 240000 | 1000~600000ms |

SDK 자동 재시도는 끄고 개별 NAVER 제한 시간도 유지합니다. 내장 도구에는 남은 `max_tool_calls`를 전달합니다. 마지막 반복이나 호출 한도에서는 추가 도구를 닫고 확보된 근거만으로 최종 일정을 마무리합니다. 모델이 이를 따르지 않고 도구를 요청하면 `AGENT_ITERATION_LIMIT`·`AGENT_TOOL_LIMIT`, 전체 지연은 `AI_TIMEOUT` 오류입니다. 취소·연결 종료는 SDK/NAVER 요청에 전파합니다. 미등록 함수·잘못된 인수·임의 좌표·중복 call_id는 실행하지 않습니다.

## Trace와 출처

성공은 `plan.trace`, 실패는 응답의 `trace`에 도구 이름·요약·상태·반복 번호·실행 여부를 담습니다. 실행 전 차단은 `executed:false`입니다. 원본 SDK 오류·인증 정보·프롬프트·추론은 담지 않습니다. Trace는 완료나 오류 시 반환하며 실시간 스트리밍하지 않습니다.

웹 Trace와 출처는 실제 `web_search_call`, `action.sources`, `url_citation`에서 추출합니다. 인용 링크는 요약 옆에, 조회 출처 목록은 Trace 아래에 표시합니다. 모델이 만들어낸 URL을 근거로 사용하지 않습니다.

## 검증

최종 초안은 `validate-itinerary.js`에서 검사합니다. 문제를 발견하면 같은 대화에서 피드백을 주고 선택적 도구 재호출과 수정이 가능합니다. 검증은 실제 Tool Trace와 별도로 `plan.validation`에 기록합니다. 영업시간은 NAVER 검색에 없으므로 서버에서 확인한 구조화된 자료가 없으면 확인 필요입니다. [일정 검증과 재계획](ITINERARY_VALIDATION.md)

`npm.cmd run check`, `npm.cmd test`는 외부 API 없이 선택적 실행·미호출·다단계 도구·오류 후 재시도·한도·취소·출처·가격/좌표 차단을 검사합니다.

실제 통합 요청에서는 모델이 search_places, get_routes, web_search를 선택하고 calculate_budget은 생략했습니다. 총비용은 가격 근거가 없어 미확인으로 유지됐습니다. 예산 선택 경로는 별도 자동 검사에서 실제 계산 함수를 실행해 확인했습니다.
