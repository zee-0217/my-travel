import { validateItinerary, minutes } from './itinerary-validation.js';

export const placeCategory = (place) => /카페/.test(place.category) ? '휴식' : /음식|식당|한식|중식|일식|양식/.test(place.category) ? '맛집' : /해수욕|해변|산|공원|숲/.test(place.category) ? '자연' : '관광';
export function validatePlaceAddition(plan, place, { dayIndex, time, endTime }) {
  if (!Number.isInteger(dayIndex) || !plan.days[dayIndex] || minutes(time) === null || minutes(endTime) === null || minutes(endTime) <= minutes(time)) throw new Error('일정 날짜와 올바른 방문·종료 시각을 선택해 주세요.');
  const stops = plan.days[dayIndex].stops;
  if (stops.length >= 12) throw new Error('하루에 최대 12개 장소까지 편집할 수 있어요. 기존 일정을 먼저 정리해 주세요.');
  if (!place?.name || stops.some((stop) => stop.place?.name === place.name && (stop.place.roadAddress || stop.place.address) === (place.roadAddress || place.address))) throw new Error('이 날짜에 이미 포함된 장소예요.');
}
export function appendLocalPlace(plan, place, query, options) {
  validatePlaceAddition(plan, place, options);
  const next = structuredClone(plan), day = next.days[options.dayIndex];
  const oldStops = [...day.stops];
  const stop = { title: place.name, time: options.time, endTime: options.endTime, category: placeCategory(place), description: '검색 결과에서 직접 선택한 방문 장소입니다.', stay: '직접 지정한 방문 시간', place: { ...structuredClone(place), source: { name: 'NAVER API HUB 지역 검색', query, link: place.link || null } }, route: null, openingHours: null, environment: { type: 'unknown', basis: '장소 유형 확인 필요' }, transfer: '이동 시간 확인 불가' };
  day.stops.push(stop); day.stops.sort((a,b) => a.time.localeCompare(b.time));
  for (let index = 0; index < day.stops.length; index++) {
    const current = day.stops[index], oldIndex = oldStops.indexOf(current);
    if (oldIndex < 0 || oldStops[oldIndex + 1] !== day.stops[index + 1]) { current.route = null; current.transfer = '이동 시간 확인 불가'; }
    if (index === day.stops.length - 1) { current.route = null; current.transfer = '이날 일정 마무리'; }
  }
  day.travelConstraints = { knownDurationMinutes: Math.ceil(day.stops.reduce((sum, item) => sum + (item.route?.available ? item.route.durationMs : 0), 0) / 60000), unknownLegs: day.stops.slice(0,-1).filter((item) => !item.route?.available).length, status: 'unknown', exceedsPerLeg: false, exceedsPerDay: false };
  next.total = null; next.remaining = null; next.budgetCalculation = null; next.costs = next.costs.map((row) => ({ ...row, amount: null, status: 'unknown' }));
  next.budgetNote = '장소를 추가해 비용과 잔여 예산은 다시 확인해야 합니다.';
  for (const stay of next.lodgings?.candidates || []) {
    stay.comparisons = stay.comparisons.filter((entry) => entry.dayIndex !== options.dayIndex);
    if (stay.nightIndexes.some((night) => night === options.dayIndex || night + 1 === options.dayIndex)) day.stops.filter((item) => item.place).forEach((item, stopIndex) => stay.comparisons.push({ dayIndex: options.dayIndex, date: day.date, stopIndex, name: item.title, coordinates: item.place.coordinates, route: null, durationMs: null, distanceMeters: null, straightLineMeters: null }));
    stay.meanStraightLineMeters = null;
  }
  delete next.planId;
  delete next.sessionToken;
  if (!next.isSample) next.localEditedAt = new Date().toISOString();
  next.validation = { ...validateItinerary(next), replanCount: 0, maxReplans: 0, stopReason: 'MANUAL_PLACE_ADDED', history: [], repairs: [] };
  return next;
}
