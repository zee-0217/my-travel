// Shared pure validation for the server Agent and browser's saved-plan editor.
export const minutes = (time) => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : null;
const urlIsSafe = (value) => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };
const durationOf = (stop) => stop.route?.available && Number.isFinite(stop.route.durationMs) && stop.route.durationMs >= 0 ? stop.route.durationMs / 60000 : null;
function weatherRiskAt(weather, start, end) {
  if (!weather?.available || start === null || end === null || end <= start) return null;
  const hours = weather.hourly || [];
  let covered = 0, risk = false;
  // An hourly sample covers its hour only; do not fill sparse 3-hour gaps.
  for (let time = Math.floor(start / 60) * 60; time < end; time += 60) {
    const row = hours.find((item) => minutes(item.time) === time);
    if (!row) continue;
    if ([1, 2, 3, 4].includes(row.precipitationTypeCode) || row.precipitationProbabilityPct != null && row.precipitationProbabilityPct >= 60) risk = true;
    if (row.precipitationTypeCode === 0 && row.precipitationProbabilityPct != null) covered++;
  }
  return risk ? true : covered === Math.ceil(end / 60) - Math.floor(start / 60) ? false : null;
}

export function validateItinerary(plan, input = plan) {
  const issues = [];
  const add = (code, severity, message, dayIndex = null, stopIndex = null, details = {}) => issues.push({ id: `${code}:${dayIndex ?? 'trip'}:${stopIndex ?? 'all'}`, code, severity, actionable: severity !== 'unknown', message, dayIndex, stopIndex, ...details });
  const budget = plan.budgetCalculation;
  const subtotal = budget?.pricedSubtotal ?? plan.total;
  const confirmedOver = Number.isFinite(budget?.confirmedTotal) && budget.confirmedTotal > input.budget || budget?.status === 'confirmed';
  if (Number.isFinite(subtotal) && subtotal > input.budget) add('BUDGET_EXCEEDED', confirmedOver ? 'error' : 'warning', `금액이 있는 항목 합계 ${subtotal.toLocaleString('ko-KR')}원이 총예산 ${input.budget.toLocaleString('ko-KR')}원을 초과합니다.`, null, null, { amount: subtotal, limit: input.budget, estimated: !confirmedOver });
  if (!budget || !Number.isFinite(budget.total) || budget.unknownCount !== 0) add('BUDGET_UNKNOWN', 'unknown', '미확인 가격이 있어 총예산 충족 여부는 확인 필요입니다.');
  const legLimit = input.maxTravelMinutesPerLeg ?? 60;
  const dayLimit = input.maxTravelMinutesPerDay ?? 180;
  if (plan.lodgings?.status === 'unconfirmed') add('LODGINGS_UNKNOWN', 'unknown', '검색으로 확인된 숙소 후보가 없어 숙박은 확인 필요입니다.');
  for (const stay of plan.lodgings?.candidates || []) {
    if (stay.availability?.status !== 'confirmed') add('LODGING_AVAILABILITY_UNKNOWN', 'unknown', `${stay.name}: 예약 가능 여부는 확인 필요입니다.`, stay.nightIndexes[0], null, { lodgingId: stay.id });
    if (stay.price.status === 'unknown') add('LODGING_PRICE_UNKNOWN', 'unknown', `${stay.name}: 숙박 요금과 예산 적합성은 확인 필요입니다.`, stay.nightIndexes[0], null, { lodgingId: stay.id });
    if (stay.budgetFit.startsWith('over_')) add('LODGING_BUDGET_EXCEEDED', 'warning', `${stay.name}: 확인된 숙박비가 예산 상한을 초과합니다. 다른 후보를 검토해 주세요.`, stay.nightIndexes[0], null, { lodgingId: stay.id });
    if (stay.comparisons.some((entry) => entry.durationMs === null)) add('LODGING_ROUTES_UNKNOWN', 'unknown', `${stay.name}: 일부 관광지까지 자동차 이동시간은 확인 필요입니다.`, stay.nightIndexes[0], null, { lodgingId: stay.id });
  }
  (plan.days || []).forEach((day, dayIndex) => {
    const stops = day.stops || [];
    if (stops.length > (input.maxPlacesPerDay ?? 4)) add('TOO_MANY_PLACES', 'error', `하루 방문 ${stops.length}곳이 제한 ${input.maxPlacesPerDay ?? 4}곳을 초과합니다.`, dayIndex);
    let total = 0, missing = 0;
    const weather = day.weather;
    if (!weather?.available) add('WEATHER_UNKNOWN', 'unknown', '이 날짜의 날씨가 미확인되어 장소 적합성은 확인 필요입니다.', dayIndex);
    stops.forEach((stop, stopIndex) => {
      const start = minutes(stop.time), end = minutes(stop.endTime);
      if (end === null) add('VISIT_END_UNKNOWN', 'unknown', '계획상 종료 시각이 없어 체류 시간 전체의 중복·영업시간 검증은 확인 필요입니다.', dayIndex, stopIndex);
      else if (start === null || end <= start) add('INVALID_VISIT_INTERVAL', 'error', '방문 종료 시각은 같은 날의 시작 시각보다 늦어야 합니다.', dayIndex, stopIndex);
      // Compare every pair, including non-adjacent/nested intervals; intervals are [start, end).
      for (let previous = 0; previous < stopIndex; previous++) {
        const other = stops[previous], otherStart = minutes(other.time), otherEnd = minutes(other.endTime);
        if (start !== null && otherStart !== null && (start === otherStart || otherEnd !== null && otherEnd > otherStart && start > otherStart && start < otherEnd || end !== null && end > start && otherStart > start && otherStart < end)) add('TIME_OVERLAP', 'error', `${previous + 1}번과 ${stopIndex + 1}번 방문 시간이 겹칩니다.`, dayIndex, stopIndex, { relatedStopIndex: previous });
      }
      if (stopIndex && start < minutes(stops[stopIndex - 1].time)) add('TIME_ORDER', 'error', '일정 시작 시각이 시간순으로 배치되지 않았습니다.', dayIndex, stopIndex);
      if (stopIndex < stops.length - 1) {
        const duration = durationOf(stop);
        if (duration === null) missing++;
        else {
          total += duration;
          if (duration > legLimit) add('LONG_DRIVE', 'error', `자동차 이동 약 ${Math.ceil(duration)}분이 ${input.maxTravelMinutesPerLeg == null ? '기본 점검 기준' : '구간 제한'} ${legLimit}분을 초과합니다.`, dayIndex, stopIndex, { limit: legLimit, durationMinutes: duration, defaultLimit: input.maxTravelMinutesPerLeg == null });
          const nextStart = minutes(stops[stopIndex + 1].time);
          const earliestDeparture = end !== null && end > start ? end : start;
          if (earliestDeparture !== null && nextStart !== null && earliestDeparture + duration > nextStart) add('TRAVEL_TIME_CONFLICT', 'error', '방문 시각과 실제 자동차 이동시간을 고려하면 다음 방문 시작에 맞출 수 없습니다.', dayIndex, stopIndex);
        }
      }
      const hours = stop.openingHours;
      const knownHours = hours?.status === 'confirmed' && hours.date === day.date && urlIsSafe(hours.sourceUrl) && typeof hours.checkedAt === 'string' && Number.isFinite(Date.parse(hours.checkedAt)) && Array.isArray(hours.intervals) && hours.intervals.every((interval) => minutes(interval.open) !== null && minutes(interval.close) !== null && minutes(interval.open) < minutes(interval.close));
      if (!knownHours) add('OPENING_HOURS_UNKNOWN', 'unknown', '방문일에 적용되는 출처가 확인된 영업시간이 없어 확인 필요입니다.', dayIndex, stopIndex);
      else if (!hours.intervals.some((interval) => start >= minutes(interval.open) && start < minutes(interval.close) && (end === null || end <= minutes(interval.close)))) add('OPENING_HOURS_CONFLICT', 'error', '확인된 방문일 영업시간과 방문 시각이 충돌합니다.', dayIndex, stopIndex, { sourceUrl: hours.sourceUrl, intervals: hours.intervals });
      const environment = stop.environment;
      if (weather?.available) {
        if (!environment || environment.type === 'unknown') add('PLACE_TYPE_UNKNOWN', 'unknown', '실내·실외 유형 근거가 없어 날씨 적합성은 확인 필요입니다.', dayIndex, stopIndex);
        else if (environment.type === 'outdoor') {
          const risk = weatherRiskAt(weather, start, end);
          if (risk === true || risk === null && (weather.rainExpected === true || weather.indoorSuggested === true)) add('WEATHER_PLACE_CONFLICT', 'warning', risk === true ? '방문 시간대에 강수가 예상되는 실외 장소입니다. 실내 대안이나 방문 시간 조정을 검토해 주세요.' : '강수 대비가 권장되는 날의 실외 장소이며 방문 시간대 예보가 불완전합니다. 실내 대안이나 시간 조정을 검토해 주세요.', dayIndex, stopIndex, { classification: environment.basis });
          else if (risk === null) add('WEATHER_TIME_UNKNOWN', 'unknown', '방문 시간대의 강수 정보가 충분하지 않아 날씨 적합성은 확인 필요입니다.', dayIndex, stopIndex);
        }
      }
    });
    if (missing) add('ROUTES_UNKNOWN', 'unknown', `자동차 경로 ${missing}구간이 미확인되어 이동 합계와 시간 충돌 여부는 확인 필요입니다.`, dayIndex);
    if (total > dayLimit) add('LONG_DAILY_DRIVE', 'error', `확인된 자동차 이동 합계 약 ${Math.ceil(total)}분이 ${input.maxTravelMinutesPerDay == null ? '하루 기본 점검 기준' : '하루 제한'} ${dayLimit}분을 초과합니다.`, dayIndex, null, { limit: dayLimit, durationMinutes: total, defaultLimit: input.maxTravelMinutesPerDay == null });
  });
  return { status: issues.some((issue) => issue.actionable) ? 'problems_found' : issues.length ? 'needs_confirmation' : 'passed', issues, problemCount: issues.filter((issue) => issue.actionable).length, confirmationCount: issues.filter((issue) => !issue.actionable).length,
    policy: { maxPlacesPerDay: input.maxPlacesPerDay ?? 4, maxTravelMinutesPerLeg: legLimit, maxTravelMinutesPerDay: dayLimit } };
}

export function describePlanChanges(previous, next) {
  const changes = [];
  next.days.forEach((day, dayIndex) => {
    const old = previous.days[dayIndex];
    if (old.stops.length !== day.stops.length) changes.push(`${dayIndex + 1}일차 방문 수: ${old.stops.length}곳 → ${day.stops.length}곳`);
    day.stops.forEach((stop, index) => {
      const before = old.stops[index];
      if (!before) { changes.push(`${dayIndex + 1}일차 ${index + 1}번 장소 추가: ${stop.title}`); return; }
      if (before.title !== stop.title) changes.push(`${dayIndex + 1}일차 ${index + 1}번 장소: ${before.title} → ${stop.title}`);
      if (before.time !== stop.time || before.endTime !== stop.endTime) changes.push(`${dayIndex + 1}일차 ${index + 1}번 방문: ${before.time}~${before.endTime || '미정'} → ${stop.time}~${stop.endTime || '미정'}`);
    });
  });
  if (previous.budgetCalculation?.pricedSubtotal !== next.budgetCalculation?.pricedSubtotal) changes.push('예산 계산 근거가 변경되었습니다. 미확인 가격을 포함한 최종 합계는 별도로 확인하세요.');
  return changes;
}
