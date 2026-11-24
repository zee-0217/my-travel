// Browser-local fixtures only. No SDK, fetch, or external API is used here.
export const transportLabels = { car: '자가용', rental: '렌터카', transit: '대중교통' };
export const money = (value) => `${new Intl.NumberFormat('ko-KR').format(value)}원`;

const destinations = {
  강릉: ['경포호 산책길', '오죽헌', '안목해변 카페 거리', '초당 순두부 거리', '강릉 중앙시장'],
  제주: ['함덕해수욕장', '성산일출봉', '애월 카페 거리', '제주 향토 음식점', '동문재래시장'],
  부산: ['해운대 해수욕장', '감천문화마을', '광안리 해변 카페', '부산 돼지국밥 거리', '국제시장'],
  경주: ['보문호 산책길', '대릉원', '황리단길 카페', '경주 한식당', '경주 중앙시장'],
  전주: ['덕진공원', '전주 한옥마을', '한옥 찻집', '전주 비빔밥 식당', '전주 남부시장'],
  서울: ['서울숲', '경복궁', '성수동 카페', '서울 한식당', '광장시장'],
  속초: ['속초해수욕장', '아바이마을', '영랑호 카페', '속초 생선구이 식당', '속초관광수산시장'],
  여수: ['오동도', '이순신광장', '여수 해변 카페', '여수 게장 식당', '여수 수산시장'],
};
const categories = ['자연', '관광', '휴식', '맛집', '쇼핑'];
const descriptions = {
  자연: '천천히 걸으며 풍경을 담아보세요. 서두르지 않아도 괜찮아요.',
  관광: '지역의 이야기를 만나고, 마음에 드는 순간을 사진으로 남겨요.',
  휴식: '좋아하는 음료 한 잔과 함께 잠시 쉬어가는 시간이에요.',
  맛집: '지역의 맛으로 든든하게 채우는 점심. 메뉴는 취향에 맞게 골라요.',
  쇼핑: '골목을 구경하며 간식이나 여행을 기억할 작은 선물을 찾아봐요.',
};

export function addDays(dateString, offset) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatDate(dateString, withYear = false) {
  return new Intl.DateTimeFormat('ko-KR', {
    ...(withYear ? { year: 'numeric' } : {}), month: 'long', day: 'numeric', weekday: 'short',
  }).format(new Date(`${dateString}T12:00:00`));
}

export function createSampleTrip(input) {
  const region = String(input.region || '').trim();
  const { startDate, duration, travelers, budget, transport } = input;
  const date = new Date(`${startDate}T12:00:00`);
  if (!region || region.length > 40 || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(date.getTime()) || addDays(startDate, 0) !== startDate) {
    throw new Error('여행 지역과 올바른 출발일을 입력해 주세요.');
  }
  if (!Number.isInteger(duration) || duration < 1 || duration > 7 || !Number.isInteger(travelers) || travelers < 1 || travelers > 20 || !Number.isInteger(budget) || budget < 10000 || budget > 100000000 || !Object.hasOwn(transportLabels, transport)) {
    throw new Error('기간, 인원, 예산, 이동수단을 확인해 주세요.');
  }
  const preferences = [...new Set(input.preferences || [])].filter((item) => categories.includes(item));
  const requests = String(input.requests || '').trim().slice(0, 500);
  const knownRegion = Object.keys(destinations).find((name) => region.includes(name));
  const placeNames = destinations[knownRegion] || [`${region} 자연 산책길`, `${region} 대표 관광지`, `${region} 여유로운 카페`, `${region} 지역 음식점`, `${region} 전통시장`];
  const pool = categories.map((category, index) => ({ category, title: placeNames[index], description: descriptions[category] }));
  const selected = pool.filter((place) => preferences.includes(place.category) && place.category !== '맛집');
  // Prioritize selected themes, then fill with other activities to avoid duplicate stops within a day.
  const activityPool = [...selected, ...pool.filter((place) => place.category !== '맛집' && !selected.includes(place))].slice(0, 3);
  const titles = ['설렘을 따라, 첫 번째 발걸음', '좋아하는 것들로 채우는 하루', '천천히 머물고 싶은 순간'];
  const days = Array.from({ length: duration }, (_, index) => {
    const morning = activityPool[index % activityPool.length];
    const afternoon = activityPool[(index + 1) % activityPool.length];
    const last = activityPool.length > 2 ? activityPool[(index + 2) % activityPool.length] : pool[2];
    return {
      date: addDays(startDate, index), title: titles[index % titles.length],
      stops: [morning, pool[3], afternoon, last].slice(0, input.maxPlacesPerDay || 4).map((place, stopIndex) => ({
        ...place, time: ['10:00', '12:00', '14:00', '16:00'][stopIndex],
        stay: stopIndex === 1 ? '약 60분 머무르기' : '약 90분 머무르기',
        transfer: transport === 'transit' ? '대중교통 약 40분 · 예시' : '자동차 약 20분 · 예시',
      })),
    };
  });
  const rooms = Math.ceil(travelers / 2);
  const costs = [
    { label: '숙박', amount: (duration - 1) * rooms * 110000 },
    { label: '식비 · 카페', amount: duration * travelers * 35000 },
    { label: transport === 'rental' ? '렌터카 · 주유 · 주차' : transport === 'car' ? '주유 · 주차' : '대중교통', amount: duration * (transport === 'transit' ? travelers * 12000 : Math.ceil(travelers / 4) * (transport === 'rental' ? 95000 : 45000)) },
    { label: '관광 · 체험', amount: duration * travelers * 15000 },
  ];
  const total = costs.reduce((sum, cost) => sum + cost.amount, 0);
  return {
    isSample: true, region, knownRegion: Boolean(knownRegion), startDate, duration, travelers, budget, preferences, transport, requests,
    maxPlacesPerDay: input.maxPlacesPerDay || 4, maxTravelMinutesPerLeg: input.maxTravelMinutesPerLeg ?? null, maxTravelMinutesPerDay: input.maxTravelMinutesPerDay ?? null,
    lodgingMode: input.lodgingMode || 'recommend', lodgingType: input.lodgingType || 'any', lodgingBudget: input.lodgingBudget ?? null,
    days, costs, total, remaining: budget - total,
    disclaimer: '외부 API를 호출하지 않은 반복 템플릿 기반 샘플입니다. 실제 장소 정보, 영업 여부, 경로, 가격은 확인되지 않았습니다. 추가 요청은 기록에만 남습니다. 숙박은 2인 1실, 자동차는 4인당 1대 기준이며 출발지까지의 왕복 교통비와 쇼핑비는 별도입니다.',
  };
}
