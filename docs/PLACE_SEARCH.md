# NAVER API HUB 지역 검색

서버 함수 `search_places`는 OpenAI나 Express 없이 독립 호출할 수 있으며, Agent가 선택하는 Function Calling에도 연결합니다. [Agent 연결 설명](AGENT.md)

## 독립 실행

```powershell
npm.cmd run test:places
npm.cmd run test:places:live
npm.cmd run test:places:live -- 제주 카페
npm.cmd run test:places:live -- 부산 관광지 음식점 카페
```

`test:places`는 네트워크 없는 자동 검사입니다. `test:places:live`는 `.env`의 실제 API HUB 인증 정보를 사용해 API를 호출합니다. 기본값은 강릉 관광지·음식점·카페를 각각 3개씩 검색합니다. 라이브 실행 파일은 Node.js 자동 테스트 대상과 분리했으므로 `npm test`는 외부 API를 호출하지 않습니다.

```js
import { search_places } from './src/services/naver-api-hub.js';

const result = await search_places({
  region: '강릉', keyword: '바다 카페', display: 5, sort: 'random',
});
```

`region`은 1~40자, `keyword`는 1~80자, `display`는 1~5의 정수입니다. `sort`는 `random`(정확도순) 또는 `comment`(리뷰 개수순)이며 기본값은 `random`입니다. 검색어는 `${region} ${keyword}`로 합치고 `URLSearchParams`로 인코딩합니다.

## API 요청 및 인증

- GET `https://naverapihub.apigw.ntruss.com/search/v1/local`
- `query`, `display`, `start=1`, `sort`, `format=json`
- `X-NCP-APIGW-API-KEY-ID`: `.env`의 `NAVER_API_HUB_CLIENT_ID`
- `X-NCP-APIGW-API-KEY`: `.env`의 `NAVER_API_HUB_CLIENT_SECRET`

Maps 인증 정보나 구 NAVER Developers 헤더를 사용하지 않습니다. 인증 정보는 서버에서만 전송하며 응답·브라우저·로그에 포함하지 않습니다. 요청 제한 시간은 12초이고 자동 재시도는 없습니다. 리다이렉트는 거부하며, 호출자의 취소 신호를 전파합니다. [공식 공통 요청 문서](https://api.ncloud-docs.com/docs/naver-api-hub-overview)

## 반환 정보

`{ source, region, keyword, query, total, returnedCount, places }`를 반환합니다. `total`은 API가 제공한 값이며 없으면 `null`, `returnedCount`는 이번에 받은 장소 수입니다. 전체 검색 결과를 페이지별로 모두 가져오는 기능은 제공하지 않습니다.

각 장소는 다음 필드만 포함합니다.

| 필드 | API 원본 |
| --- | --- |
| `name` | `title`의 강조 태그 제거 및 텍스트 엔티티 처리 |
| `address` | `address` 지번 주소 |
| `roadAddress` | `roadAddress` 도로명 주소 |
| `category` | `category` |
| `link` | `link`의 유효한 HTTP(S) URL, 없거나 안전하지 않으면 `null` |
| `coordinates` | `mapx`, `mapy` 원본과 정규화된 좌표 |

API가 제공하지 않는 영업시간·평점·가격·메뉴 등을 추가하지 않습니다. 주소·카테고리가 없으면 빈 문자열로 유지하고 화면에는 'API에서 제공하지 않음'으로 표시합니다. 검색 결과 텍스트는 브라우저에서 `textContent`로 렌더링합니다. [공식 응답 필드 문서](https://api.ncloud-docs.com/docs/naver-api-hub-search-local)

## 좌표 처리 근거

2026-11-18 확인한 공식 문서는 `mapx`, `mapy`를 **String / WGS84**로 명시하며, 응답 예시의 `mapx`는 경도, `mapy`는 위도입니다. 문서에는 정수 배율이 명시되어 있지 않습니다. [공식 지역 검색 문서](https://api.ncloud-docs.com/docs/naver-api-hub-search-local)

같은 날 실제 API HUB 독립 호출에서 `mapx="1289475239"`, `mapy="377724092"` 형식을 확인했습니다. 이를 경도 `128.9475239`, 위도 `37.7724092`로 처리했습니다. **1e7 변환은 실제 응답을 근거로 한 정규화이며, 공식 문서가 배율을 보장한다고 해석하지 않습니다.**

- 유효 범위의 소수 경위도는 그대로 사용합니다(`encoding: "decimal_degrees"`).
- 두 값 모두 정수이며 국내 좌표의 1e7 배율 범위(경도 124~132, 위도 33~39)에 해당할 때만 나눕니다(`encoding: "scaled_1e7"`).
- 누락·빈 문자열·범위 이탈·혼합 형식·옛 KATEC로 보이는 값·0,0은 임의 추정하거나 좌표 변환하지 않습니다. 경도·위도를 `null`, 인코딩을 `unrecognized`로 반환합니다.
- 항상 `crs: "WGS84"`, `raw: { mapx, mapy }`를 보존합니다. 나중에 Maps에 전달할 때는 `longitude`, `latitude`를 사용하고 `null`을 제외해야 합니다.

## 화면 및 HTTP 경로

`GET /api/places?region=강릉&keyword=카페&display=5`에서 같은 함수를 호출합니다. 화면의 '가보고 싶은 장소를 찾아요'에서 위의 여행 지역과 검색 키워드를 사용합니다. 관광지·음식점·카페 바로 검색, 로딩·오류·빈 결과·취소를 지원합니다.

검색은 지역명을 포함한 텍스트 검색이며 행정구역 경계 필터나 거리순 검색이 아닙니다. 결과 주소를 확인해야 합니다. 결과는 기존 AI 일정 및 샘플 지도와 별도이며 자동으로 합치지 않습니다.

오류는 `{ error: { code, message } }` 형식입니다. 입력 오류는 400, 설정·인증 오류는 503, 한도 초과는 429, 응답 지연은 504, 연결·형식·서비스 오류는 502입니다. 공급자의 원본 오류와 인증 정보는 전달하지 않습니다.
