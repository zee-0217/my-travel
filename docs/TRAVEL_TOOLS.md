# 자동차 경로와 예산 Tool

`get_routes`와 `calculate_budget`의 독립 JavaScript 함수 사용법입니다. 공통 내보내기는 `src/tools/index.js`이며, 이제 Agent의 선택적 Function Calling에도 연결합니다. Agent의 근거 검증과 제한은 [Agent 문서](AGENT.md)를 참조하세요.

## get_routes

```js
import { get_routes } from '../src/services/naver-maps.js';

const route = await get_routes({
  start: { longitude: 128.8785, latitude: 37.7782 },
  goal: { longitude: 128.8986, latitude: 37.754 },
  mode: 'driving',
  option: 'traoptimal',
});
```

신규 Maps `GET https://maps.apigw.ntruss.com/map-direction/v1/driving`을 사용합니다. `NAVER_MAPS_CLIENT_ID`, `NAVER_MAPS_CLIENT_SECRET`을 `.env`에서 읽고 `x-ncp-apigw-api-key-id`, `x-ncp-apigw-api-key` 헤더에 서버에서만 전달합니다. API HUB 인증 정보와 분리합니다.

좌표는 WGS84 소수 경위도의 숫자이며, 요청은 **경도,위도** 순서입니다. `search_places` 결과의 `coordinates.longitude`, `coordinates.latitude`를 전달하세요. 원본 `mapx`, `mapy` 정수 문자열을 그대로 전달하거나 위도·경도를 뒤집으면 입력 오류입니다. 지원 옵션은 `traoptimal`(기본), `trafast`, `tracomfort`, `traavoidtoll`, `traavoidcaronly`입니다. [Directions 5 공식 문서](https://api.ncloud-docs.com/docs/application-maps-directions5)

성공 결과는 `available: true`, `distanceMeters`, `durationMs`, `distanceKm`, `durationMinutes`를 포함합니다. API 원본 거리는 미터, 시간은 밀리초이며 km는 `/1000`, 분은 `/60000`으로 계산합니다. 소요 시간은 조회 시점 교통 상황에 따라 달라집니다. [공식 응답 단위](https://api.ncloud-docs.com/docs/application-maps-directions5)

경로 없음·도로 주변이 아닌 좌표·동일 장소·조회 거리 제한은 `available: false`, `status: "unavailable"`, `message: "자동차 경로 확인 불가…"`, 거리와 시간은 `null`로 반환합니다. 특히 API의 업무 오류 코드 1~5는 HTTP 400에도 반환되므로 이를 처리합니다. 도보·대중교통 요청은 API 호출 없이 `UNSUPPORTED_MODE`와 `null`을 반환합니다. 직선거리나 평균 속도로 대체하지 않습니다.

인증·한도·통신·형식 오류는 안전한 `ToolError`로 구분합니다. 제한 시간은 15초이며 자동 재시도와 리다이렉트는 하지 않습니다. HTTP 경로는 `POST /api/routes`이고 성공 응답은 `{ route }`입니다.

화면에서는 검색 결과 카드의 '출발지로 선택'과 '도착지로 선택'을 누른 뒤 '자동차 경로 확인'을 누릅니다. 누락된 좌표의 선택은 비활성화합니다. 수동 조회는 AI 일정과 별도이며, 결과의 동적 지도에는 선택한 날짜의 Agent 경로를 표시합니다.

## calculate_budget

```js
import { calculate_budget } from '../src/tools/calculate-budget.js';

const budget = calculate_budget({
  totalBudget: 500000,
  items: [
    { category: 'food', label: '식비', amount: 120000, status: 'estimated' },
    { category: 'accommodation', label: '숙박', amount: 180000, status: 'confirmed', source: '사용자 확인 예약 금액' },
    { category: 'transport', label: '주유·주차', amount: 50000, status: 'estimated' },
    { category: 'activities', label: '관광비', amount: null, status: 'unknown' },
  ],
});
```

외부 API·환경 변수·파일 접근이 없는 동기 순수 함수입니다. 금액은 0~1조원의 원 단위 정수이며 총예산도 같은 범위를 사용합니다. 항목은 최대 200개입니다. 카테고리는 `food`, `accommodation`, `transport`, `activities`, `other`이며 여러 항목을 같은 카테고리로 합산할 수 있습니다. 항목의 금액은 인원·일수를 이미 반영한 합계로 입력하며 함수가 다시 곱하지 않습니다.

| 상태 | 뜻과 입력 규칙 |
| --- | --- |
| `confirmed` | 입력자가 확인했다고 명시한 금액. 0 이상 정수와 근거 `source` 필요. 함수가 영수증이나 가격을 검증했다는 뜻은 아님 |
| `estimated` | 추정 금액. 숫자를 입력하고 상태를 생략하면 기본값 |
| `unknown` | 미확인 가격. `amount`는 `null` 또는 생략. 임의로 0원이나 평균 가격을 채우지 않음 |

식비·숙박비·교통비·관광비 중 생략된 카테고리는 미확인 항목으로 추가합니다. 당일 숙박이나 무료 관광은 근거와 함께 0원을 명시해야 미확인으로 남지 않습니다.

| 반환값 | 의미 |
| --- | --- |
| `confirmedTotal`, `estimatedTotal` | 확인 금액 합계, 추정 금액 합계 |
| `pricedSubtotal` | 위 두 금액의 합계. 미확인 항목은 포함하지 않음 |
| `unknownCount` | 가격이 미확인인 항목 수 |
| `total`, `remainingBudget` | 미확인 항목이 없을 때 전체 합계와 `totalBudget - total`. 추정치가 있으면 역시 추정값 |
| `remainingAfterPricedItems` | `totalBudget - pricedSubtotal`. 미확인 가격을 차감하기 전의 잠정 계산 |
| `status` | `confirmed`, `estimated`, `incomplete` |
| `overBudget` | 입력 금액만으로도 초과면 `true`, 전부 계산해 예산 이내면 `false`, 미확인 가격 때문에 판단할 수 없으면 `null` |

미확인 금액이 하나라도 있으면 `total`과 `remainingBudget`은 `null`입니다. 예시에서는 입력된 항목까지만 35만원, 잠정 차액 15만원이며 최종 잔여 예산은 미확인입니다. 관광비 3만원을 추정치로 넣으면 예상 합계 38만원, 예상 잔여 예산 12만원이 됩니다.

HTTP 경로는 `POST /api/budget`이며 `{ budget }`를 반환합니다. Agent가 이 함수를 선택하면 비용을 합산하며, 근거 없는 모델 단가는 실행 전에 `unknown/null`로 바꿉니다. 독립 호출의 입력자 제공 추정치와 Agent의 임의 추정을 구분합니다.

## 독립 실행 및 검증

```powershell
npm.cmd run test:routes        # 네트워크 없이 경로 함수 검사
npm.cmd run test:routes:live   # .env 인증 정보로 실제 Directions 5 요청 1회
npm.cmd run test:budget        # 외부 API 없이 예산 함수 검사
npm.cmd run demo:budget        # 미확인 관광비/추정 관광비 예제 각각 실행
npm.cmd test                  # 전체 자동 검사. 실제 외부 API 호출 없음
```

2026-11-23 실제 Maps 호출에서 테스트 좌표 사이의 자동차 거리 `3915m`, 시간 `512283ms`를 확인했습니다(조회 시점 값). 별도로 경로 없음·도보/대중교통 미지원·동일 장소·잘못된 좌표·인증·한도·취소·지연을 모의 응답으로 검사합니다. 예산 함수는 확인/추정/미확인·생략 카테고리·초과 예산·무료 항목·잘못된 금액을 검사합니다.
