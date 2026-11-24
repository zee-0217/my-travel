import { agentPlanSchema, safeNarrative } from './agent-result.js';
import { objectSchema, matchesSchema } from './tool-schemas.js';
import { validatePlanInput } from './plan-schema.js';
import { describePlanChanges } from './validate-itinerary.js';
import { PlanError } from '../lib/plan-error.js';

export function editPlanSchema(duration) {
  const full = agentPlanSchema(duration);
  const nullableInteger = (minimum, maximum) => ({ type: ['integer', 'null'], minimum, maximum });
  const travelLimit = (maximum) => ({ anyOf: [nullableInteger(5, maximum), { type: 'integer', minimum: 0, maximum: 0 }] });
  return objectSchema({ reason: { type: 'string', minLength: 1, maxLength: 500 },
    lodgings: { anyOf: [full.properties.lodgings, { type: 'null' }] },
    conditionChanges: objectSchema({ budget: nullableInteger(10000, 100000000), travelers: nullableInteger(1, 20), preferences: { type: ['array', 'null'], maxItems: 5, items: { type: 'string', enum: ['맛집', '관광', '자연', '휴식', '쇼핑'] } }, maxPlacesPerDay: nullableInteger(1, 6), maxTravelMinutesPerLeg: travelLimit(180), maxTravelMinutesPerDay: travelLimit(600), transport: { type: ['string', 'null'], enum: ['car', 'rental', 'transit', null] },
      lodgingMode: { type: ['string', 'null'], enum: ['recommend', 'none', null] }, lodgingType: { type: ['string', 'null'], enum: ['any', 'hotel', 'pension', 'guesthouse', 'resort', null] }, lodgingBudget: { anyOf: [nullableInteger(10000, 100000000), { type: 'integer', minimum: 0, maximum: 0 }] } }),
    budgetCallId: { type: ['string', 'null'] },
    days: { type: 'array', minItems: 0, maxItems: duration, items: objectSchema({ dayIndex: { type: 'integer', minimum: 0, maximum: duration - 1 }, ...full.properties.days.items.properties }) },
  });
}

export function mergePlanEdit(text, draft, input, targetDay) {
  let patch;
  try { patch = JSON.parse(text); } catch { throw new PlanError(502, 'INVALID_AI_RESPONSE', '일정 수정 응답을 읽지 못했어요. 다시 시도해 주세요.'); }
  if (patch && typeof patch === 'object' && !Object.hasOwn(patch, 'lodgings')) patch.lodgings = null;
  if (patch?.conditionChanges && typeof patch.conditionChanges === 'object' && !Array.isArray(patch.conditionChanges)) for (const key of ['lodgingMode', 'lodgingType', 'lodgingBudget']) if (!Object.hasOwn(patch.conditionChanges, key)) patch.conditionChanges[key] = null;
  if (!matchesSchema(patch, editPlanSchema(input.duration)) || new Set(patch.days.map((day) => day.dayIndex)).size !== patch.days.length) throw new PlanError(502, 'INVALID_AI_RESPONSE', '일정 수정 형식이 올바르지 않아요.');
  if (targetDay !== null && patch.days.some((day) => day.dayIndex !== targetDay)) throw new PlanError(502, 'EDIT_SCOPE_VIOLATION', '선택한 날짜 밖의 수정이 반환되어 적용하지 않았어요.');
  const nextInput = validatePlanInput({ ...input, ...Object.fromEntries(Object.entries(patch.conditionChanges).filter(([, value]) => value !== null).map(([key, value]) => [key, (key.startsWith('maxTravelMinutes') || key === 'lodgingBudget') && value === 0 ? null : value])) });
  const next = structuredClone(draft);
  if (patch.lodgings !== null) next.lodgings = patch.lodgings;
  for (const { dayIndex, ...day } of patch.days) next.days[dayIndex] = day;
  const conditionsChanged = JSON.stringify(nextInput) !== JSON.stringify(input);
  // A prior whole-trip budget must not appear valid after itinerary/conditions change.
  next.budgetCallId = patch.budgetCallId;
  next.replanReason = patch.reason;
  next.summary = patch.reason;
  next.warnings = [];
  return { draft: next, input: nextInput, reason: safeNarrative(patch.reason), conditionsChanged };
}

export function describeEdit(previous, plan, request, reason) {
  const changes = describePlanChanges(previous, plan);
  if (JSON.stringify(previous.lodgings?.candidates || []) !== JSON.stringify(plan.lodgings?.candidates || [])) changes.push('숙소 후보와 방문 장소 사이의 거리·자동차 이동 비교를 갱신했습니다.');
  plan.days.forEach((day, index) => {
    const old = previous.days[index];
    if (old.title !== day.title) changes.push(`${index + 1}일차 제목: ${old.title} → ${day.title}`);
    day.stops.forEach((stop, stopIndex) => {
      const before = old.stops[stopIndex];
      if (!before) return;
      if (before.description !== stop.description) changes.push(`${index + 1}일차 ${stopIndex + 1}번 장소의 추천 이유를 변경했습니다.`);
      if (before.stay !== stop.stay) changes.push(`${index + 1}일차 ${stopIndex + 1}번 장소의 체류 제안을 변경했습니다.`);
      if (before.category !== stop.category) changes.push(`${index + 1}일차 ${stopIndex + 1}번 장소의 여행 유형을 변경했습니다.`);
      if (before.title === stop.title && JSON.stringify(before.place) !== JSON.stringify(stop.place)) changes.push(`${index + 1}일차 ${stopIndex + 1}번 동명 장소의 검색 정보를 변경했습니다.`);
    });
  });
  const labels = { budget: '총예산', travelers: '여행 인원', preferences: '여행 취향', transport: '이동수단', maxPlacesPerDay: '하루 최대 방문 수', maxTravelMinutesPerLeg: '구간 이동 제한', maxTravelMinutesPerDay: '하루 이동 제한', lodgingMode: '숙소 추천', lodgingType: '숙소 유형', lodgingBudget: '숙박 예산 상한' };
  for (const [field, label] of Object.entries(labels)) if (JSON.stringify(previous[field]) !== JSON.stringify(plan[field])) changes.push(`${label}: ${previous[field] ?? '미지정'} → ${plan[field] ?? '미지정'}`);
  const changedDays = plan.days.flatMap((day, index) => JSON.stringify(previous.days[index]) === JSON.stringify(day) ? [] : [index]);
  return { request, reason: reason || '요청을 반영한 수정안을 검증했습니다.', changes, changedDays, unchangedDays: plan.days.map((_, index) => index).filter((index) => !changedDays.includes(index)) };
}
