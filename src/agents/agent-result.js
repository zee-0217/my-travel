import { objectSchema, matchesSchema } from './tool-schemas.js';
import { addPlanDays } from './plan-schema.js';
import { PlanError } from '../lib/plan-error.js';
import { getVerifiedPlaceFacts, placeEnvironment } from '../services/place-facts.js';
import { lodgingSchema } from './lodging-schema.js';
import { buildLodgings } from './lodging-result.js';

const text = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const reference = { anyOf: [{ type: 'null' }, objectSchema({ callId: text(200), index: { type: 'integer', minimum: 0, maximum: 4 } })] };
export function agentPlanSchema(duration) {
  // Keep a hard size bound; user visit limits are checked in JS to enable repair.
  return objectSchema({ title: text(100), summary: text(600), budgetCallId: { type: ['string', 'null'] }, replanReason: { type: ['string', 'null'], maxLength: 500 }, lodgings: lodgingSchema(duration), warnings: { type: 'array', maxItems: 8, items: text(300) },
    days: { type: 'array', minItems: duration, maxItems: duration, items: objectSchema({ title: text(100), stops: { type: 'array', minItems: 1, maxItems: 12, items: objectSchema({
      time: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }, endTime: { type: ['string', 'null'], pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }, category: { type: 'string', enum: ['맛집', '관광', '자연', '휴식', '쇼핑'] }, title: text(100), description: text(350), stay: text(80), placeRef: reference, routeCallId: { type: ['string', 'null'] },
    }) } }) },
  });
}

// Narrative is not a trusted numeric data source. Verified route and price fields are rendered separately.
export function safeNarrative(value) {
  return value.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '웹 검색 출처 참고').replace(/(?:[₩$€]\s*)?\d[\d,.]*(?:\s*(?:만|천|억))?\s*(?:원|만원|천원|억원|분|시간|km|킬로미터|미터|m\b|달러|유로)/gi, '미확인 수치').replace(/무료|공짜/g, '가격 미확인');
}
const samePoint = (a, b) => Boolean(a && b && a.longitude === b.longitude && a.latitude === b.latitude);

export function buildAgentPlan(textOutput, input, records, trace, sources, { getPlaceFacts = getVerifiedPlaceFacts } = {}) {
  const baseFacts = getPlaceFacts;
  getPlaceFacts = (place, date) => {
    const details = [...records.values()].reverse().find((record) => record.name === 'get_place_details' && record.ok && record.result.available && record.args.date === date && record.args.place?.name === place.name && (record.args.place.roadAddress || record.args.place.address) === (place.roadAddress || place.address) && samePoint(record.args.place.coordinates, place.coordinates));
    return { ...baseFacts(place, date), ...(details ? { openingHours: details.result.openingHours, publishedRates: details.result.publishedRates, facilities: details.result.facilities, tourismSource: details.result.source } : {}) };
  };
  let output;
  try { output = JSON.parse(textOutput); } catch { throw new PlanError(502, 'INVALID_AI_RESPONSE', 'Agent의 최종 일정 형식을 읽지 못했어요. 다시 시도해 주세요.'); }
  // Older saved drafts omit these planning fields; missing end times stay unknown.
  if (output && typeof output === 'object') {
    if (!Object.hasOwn(output, 'replanReason')) output.replanReason = null;
    if (!Object.hasOwn(output, 'lodgings')) output.lodgings = [];
    if (Array.isArray(output.days)) for (const day of output.days) if (Array.isArray(day?.stops)) for (const stop of day.stops) if (stop && typeof stop === 'object' && !Object.hasOwn(stop, 'endTime')) stop.endTime = null;
  }
  if (!matchesSchema(output, agentPlanSchema(input.duration))) throw new PlanError(502, 'INVALID_AI_RESPONSE', 'Agent의 최종 일정 형식이 올바르지 않아요.');
  const getPlace = (ref, title) => {
    let record = ref && records.get(ref.callId);
    let place = record?.name === 'search_places' && record.ok ? record.result.places[ref.index] : null;
    if (!ref && title) {
      // Recover a missing reference only by an unambiguous exact provider name; never fuzzy-match coordinates.
      const matches = new Map();
      for (const candidate of records.values()) if (candidate.name === 'search_places' && candidate.ok) {
        for (const value of candidate.result.places) if (value.name.trim() === title.trim()) matches.set(JSON.stringify([value.name, value.address, value.coordinates?.longitude, value.coordinates?.latitude]), { record: candidate, place: value });
      }
      if (matches.size === 1) ({ record, place } = matches.values().next().value);
    }
    return place ? { ...place, source: { name: 'NAVER API HUB 지역 검색', query: record.result.query, link: place.link || null } } : null;
  };
  const days = output.days.map((day, dayIndex) => {
    return { date: addPlanDays(input.startDate, dayIndex), title: safeNarrative(day.title), stops: day.stops.map((stop, index) => {
      const place = getPlace(stop.placeRef, stop.title);
      const next = getPlace(day.stops[index + 1]?.placeRef, day.stops[index + 1]?.title);
      const record = stop.routeCallId ? records.get(stop.routeCallId) : [...records.values()].find((candidate) => candidate.name === 'get_routes' && candidate.ok && samePoint(candidate.args.start, place?.coordinates) && samePoint(candidate.args.goal, next?.coordinates));
      const route = input.transport !== 'transit' && record?.name === 'get_routes' && record.ok && record.args.mode === 'driving' && samePoint(record.args.start, place?.coordinates) && samePoint(record.args.goal, next?.coordinates) ? record.result : null;
      const facts = place ? getPlaceFacts(place, addPlanDays(input.startDate, dayIndex)) : null;
      return { time: stop.time, endTime: stop.endTime, category: stop.category, title: place?.name || safeNarrative(stop.title), description: safeNarrative(stop.description), stay: `계획상 체류 제안: ${safeNarrative(stop.stay)}`,
        openingHours: facts?.openingHours || null, environment: facts?.environment || placeEnvironment(place),
        place: place || null, route: route || null,
        transfer: index === day.stops.length - 1 ? '이날 일정 마무리' : route?.available ? `자동차 ${(route.distanceMeters / 1000).toFixed(2)} km · 약 ${Math.ceil(route.durationMs / 60000)}분 (Directions 5 조회)` : '이동 시간 확인 불가',
      };
    }) };
  });
  for (const day of days) {
    const weatherRecords = [...records.values()].filter((record) => record.name === 'get_weather' && record.ok && record.result.date === day.date);
    day.weather = weatherRecords.at(-1)?.result || { date: day.date, available: false, status: 'unknown', reason: 'NOT_REQUESTED', message: '이 날짜의 날씨 도구가 호출되지 않아 미확인입니다.' };
    const legs = day.stops.slice(0, -1);
    const known = legs.filter((stop) => stop.route?.available && Number.isFinite(stop.route.durationMs));
    const durationMs = known.reduce((sum, stop) => sum + stop.route.durationMs, 0);
    const exceedsPerLeg = input.maxTravelMinutesPerLeg != null && known.some((stop) => stop.route.durationMs > input.maxTravelMinutesPerLeg * 60000);
    const exceedsPerDay = input.maxTravelMinutesPerDay != null && durationMs > input.maxTravelMinutesPerDay * 60000;
    day.travelConstraints = { knownDurationMinutes: Math.ceil(durationMs / 60000), unknownLegs: legs.length - known.length, exceedsPerLeg, exceedsPerDay,
      status: exceedsPerLeg || exceedsPerDay ? 'exceeded' : known.length < legs.length ? 'unknown' : 'within_limits' };
  }
  const budgetRecord = records.get(output.budgetCallId);
  const budget = budgetRecord?.name === 'calculate_budget' && budgetRecord.ok && budgetRecord.result.totalBudget === input.budget ? budgetRecord.result : null;
  const names = { accommodation: '숙박', food: '식비 · 카페', transport: '교통', activities: '관광 · 체험', other: '기타' };
  const costs = budget ? budget.categories.map((row) => ({ label: names[row.category], amount: row.total, status: row.status === 'incomplete' ? 'unknown' : row.status })) : Object.values(names).slice(0, 4).map((label) => ({ label, amount: null, status: 'unknown' }));
  const lodgings = buildLodgings(output.lodgings, input, days, records, sources, getPlaceFacts, safeNarrative);
  return { ...input, source: 'openai', isSample: false, title: safeNarrative(output.title), summary: safeNarrative(output.summary), replanReason: output.replanReason ? safeNarrative(output.replanReason) : null, days, costs, lodgings,
    total: budget?.total ?? null, remaining: budget?.remainingBudget ?? null, budgetCalculation: budget, budgetNote: budget?.message || '예산 도구가 호출되지 않아 비용과 잔여 예산은 미확인입니다.',
    warnings: [...output.warnings.filter((text) => !/placeRef|routeCallId|budgetCallId|call_id|callId/.test(text)).map(safeNarrative), ...(days.some((day) => day.travelConstraints.status === 'exceeded') ? ['실제 조회된 이동시간이 설정한 제한을 초과하는 날이 있습니다. 장소 수나 동선을 조정해 주세요.'] : []), '가격과 이동 시간은 도구가 제공한 근거가 있을 때만 표시합니다. 미확인 값은 방문 전에 확인해 주세요.'], trace, sources,
    disclaimer: 'Agent가 필요한 도구를 선택해 만든 일정입니다. 검색되지 않은 장소 정보와 미확인 가격·이동 시간은 보장하지 않습니다.',
  };
}
