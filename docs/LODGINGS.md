# 숙소 추천과 여행 일정 연결

숙박이 있는 일정을 생성하면 기존 Agent Loop가 필요한 검색·경로 도구를 선택해 숙소 후보를 추천합니다. 기존 날짜별 일정, 검증·자동 재계획, 채팅 수정·되돌리기, 예산과 지도 기능을 유지합니다. 예약 기능은 추가하지 않습니다.

## 입력과 사용

- **숙소 추천**: 숙박 일정에 함께 추천 / 추천 안 함. 당일 일정은 숙박 후보를 표시하지 않습니다.
- **원하는 숙소 유형**: 유형 무관, 호텔, 펜션, 게스트하우스, 리조트.
- **숙박 총예산 상한**: 전체 인원·전체 숙박 기간의 합계입니다. 1만원 이상, 여행 총예산 이하여야 하며 비워 둘 수 있습니다. 객실당·1박당 요금이 아니며 실제 견적이 아닙니다.

API 입력은 lodgingMode(`recommend` 기본값 / `none`), lodgingType(`any` 기본값 / `hotel` / `pension` / `guesthouse` / `resort`), lodgingBudget(기본 null)입니다. 새로운 인증키나 패키지는 필요하지 않습니다.

## 후보와 위치 비교

1. 기존 `search_places`로 여행 지역과 숙박 키워드를 NAVER API HUB에 전달합니다. [공식 지역 검색 문서](https://api.ncloud-docs.com/docs/naver-api-hub-search-local)의 장소명·주소·카테고리·좌표·출처만 사용합니다.
2. 모델은 실제 검색 결과의 placeRef와 연속된 숙박일 nightIndexes를 지정해 최대 3개 후보를 반환합니다. 식당·카페·예약 대행 등 숙박업소가 아닌 카테고리는 제외합니다. 검색 결과에 없는 상호를 숙소로 표시하지 않습니다.
3. 방문 장소와의 직선거리를 WGS84 좌표의 Haversine 계산으로 비교합니다. 이는 지구 구면상의 근사 직선거리로 도로거리나 이동시간이 아닙니다. 예산 초과가 확인된 후보는 뒤에 두고, 그 외에는 연결된 일정 장소의 평균 직선거리가 작은 후보부터 표시합니다. 금액 미확인을 저렴함으로 취급하지 않습니다.
4. 모델이 필요에 따라 **숙소 → 같은 주요 관광지**의 자동차 경로를 `get_routes`로 조회해 비교합니다. 모든 후보와 모든 관광지 조합을 강제 호출하지 않습니다. 나머지 이동시간은 확인 불가로 남깁니다. [Directions 5 공식 안내](https://api.ncloud-docs.com/docs/ai-naver-mapsdirections-driving)의 거리 m, 시간 ms 단위를 사용합니다. 실제 요청은 기존 신규 Maps 엔드포인트 `https://maps.apigw.ntruss.com/map-direction/v1/driving`을 유지합니다.
5. 역방향 경로를 정방향으로 돌려 쓰지 않으며, 숙소·관광지 좌표가 바뀌면 정확히 일치하는 경로만 연결합니다. 도보·대중교통 이동시간은 만들지 않습니다.

후보 카드에는 추천 숙박일·체크인/체크아웃 날짜, 주소, 추천 이유, 예산 확인 상태, 날짜별 일정 장소의 직선거리와 자동차 이동시간을 표시합니다. 표의 장소 버튼은 해당 날짜와 방문 장소를 선택합니다. **지도에서 비교**는 숙소 마커와 선택한 후보의 실제 경로 선형을 표시합니다. 조회하지 않은 경로는 그리지 않습니다.

숙소 후보는 관광지 방문 수에 섞어 넣지 않습니다. 여러 후보는 대안이며, 모두 숙박하거나 예약된 것으로 취급하지 않습니다. 호텔 왕복 경로를 기존 방문지 사이 이동시간 합계에 자동으로 추가하지 않습니다. 숙소를 실제 동선으로 반영하려면 **이 숙소 주변으로 일정 다듬기**로 채팅 요청을 작성하고 전송할 수 있습니다.

## 요금·예약 가능 여부와 예산

NAVER 지역 검색은 요금과 예약 가능 여부를 제공하지 않습니다. 기본 결과는 **숙박 요금 미확인 / 예약 가능 여부 미확인**입니다. 숙박 유형·이름·총예산만 보고 평균 가격, 최저가, 빈 객실, 가격대, 예산 적합성을 생성하지 않습니다. 모델이 가격·예약 가능성을 추천 이유에 썼다면 보수적으로 제거합니다.

서버에 별도로 확인된 공개 요금 자료가 있으면 다음 조건이 모두 일치할 때만 금액을 표시합니다.

- `getPlaceFacts(place, checkInDate)`가 돌려준 자료로서 장소 이름·주소·기준 날짜가 맞아야 합니다.
- lodgingPrice.status=`confirmed`, currency=`KRW`, scope=`entire_party_entire_stay`.
- 실제 체크인/체크아웃 날짜와 여행 인원이 정확히 일치해야 합니다.
- 원 단위 정수 totalAmount, HTTPS sourceUrl과 유효한 checkedAt 확인 시각이 있어야 합니다.

기본 서버 자료 저장소 `src/services/place-facts.js`는 비어 있습니다. 자동 요금 수집기는 포함하지 않습니다. 객실당·1박당 가격을 임의로 전체 인원·전 기간 금액으로 환산하지 않습니다. 일부 숙박일에 대한 후보라면 해당 기간의 비용만 비교하며 남은 숙박일 비용까지 예산에 맞는다고 보장하지 않습니다.

추천 후보의 요금을 전체 여행 예산에 모두 합산하지 않습니다. 기존 `calculate_budget`의 확인 필요 정책을 유지하며 요금·예약 가능 여부·경로 미확인과 확인된 예산 초과를 일정 검증에도 표시합니다.

## web_search와 공식 예약 링크

필요한 경우 기존 OpenAI 내장 `web_search`를 선택해 공개 정보를 추가 확인할 수 있습니다. 후보의 webSourceUrls는 실제 내장 검색 출처에 존재하고 숙소 이름이 출처 제목에서 확인되는 것만 연결합니다. 웹 검색을 했거나 URL에 booking이 있다고 해서 가격·예약 가능 여부나 공식 예약 페이지를 확인한 것으로 승격하지 않습니다.

**공식 예약 페이지 버튼은 서버에서 직접 확인한 자료가 있을 때만** 표시합니다. NAVER의 link는 업체 상세 정보 URL이므로 그 자체를 공식 예약 페이지로 간주하지 않습니다. 현재 공식 예약 페이지 자동 소유권 검증·크롤링 기능은 없습니다. 미확인 후보에는 예약 링크를 표시하지 않습니다.

서버의 확인 자료 예시는 다음과 같습니다. 예시 URL·금액은 형식 설명이며 실제 숙소 정보가 아닙니다.

```js
{
  name: '확인한 숙박업소 이름',
  address: '검색 결과의 roadAddress 또는 address와 정확히 같은 주소',
  date: '2027-01-01',
  officialBooking: {
    status: 'confirmed', kind: 'official_booking',
    url: 'https://official.example/reservations',
    sourceUrl: 'https://official.example/official-reservation-guide',
    checkedAt: '2026-11-24T00:00:00Z'
  },
  lodgingPrice: {
    status: 'confirmed', currency: 'KRW', scope: 'entire_party_entire_stay',
    checkInDate: '2027-01-01', checkOutDate: '2027-01-02', travelers: 2,
    totalAmount: 200000, sourceUrl: 'https://official.example/verified-quote',
    checkedAt: '2026-11-24T00:00:00Z'
  }
}
```

확인 자료는 서버 담당자가 실제 공식 안내를 확인한 후 등록합니다. HTTP나 모델 출력의 가격·예약 URL은 허용하지 않습니다. 공식 예약 링크가 있어도 해당 날짜의 객실이나 금액·예약 가능 여부를 보장하지 않습니다. 이 앱은 결제·예약 생성·예약 가능 여부 조회를 수행하지 않습니다.

## 채팅·재계획·되돌리기

기존 수정 스키마에서 lodgings=null은 후보 유지, []는 삭제, 배열은 후보 교체입니다. lodgingMode/lodgingType/lodgingBudget도 conditionChanges로 수정할 수 있습니다. lodgingBudget=0은 상한 해제, null은 유지입니다. 일정 장소가 변경되면 숙소와의 비교표도 현재 좌표에 맞춰 다시 연결합니다. 직전 수정 되돌리기는 숙소 결과·경로·검증을 포함한 이전 스냅샷을 복원합니다.

응답의 `plan.lodgings`에는 status, planning, candidates, warnings, note가 있습니다. candidates는 실제 place·숙박 기간·comparisons·price·budgetFit·availability·bookingLink·publicSources를 담습니다. JSON 다운로드에도 포함됩니다. 아직 후보를 확보하지 못하면 unconfirmed, 당일/추천 제외는 not_needed로 표시합니다.

## 검증

```powershell
npm.cmd run test:lodgings
npm.cmd test
npm.cmd run check
```

자동 검사는 카테고리 필터, 좌표 계산, 방향별 경로 근거, 요금·예약 링크 검증, 출처·예산 입력·지도와 선택적 도구 루프를 모의 데이터로 검증합니다. 브라우저에서는 비교 표·미확인 표시·조건부 링크·날짜 선택·채팅 연결과 기존 기능을 확인했습니다.

실제 OpenAI·NAVER API HUB·신규 Maps 연동 검사에서는 부산 숙소 2곳과 해운대해수욕장 사이의 자동차 경로를 조회했습니다. 요금·예약 가능 여부는 미확인, 공식 예약 링크는 미제공으로 유지했습니다. 도구가 필요에 따라 선택되었으며 새 예약·결제 요청은 하지 않았습니다.
