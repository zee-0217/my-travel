import { addPlanDays } from './plan-schema.js';

const pointOK = (point) => point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.latitude >= 33 && point.latitude <= 39 && point.longitude >= 124 && point.longitude <= 132;
const samePoint = (a, b) => Boolean(pointOK(a) && pointOK(b) && a.longitude === b.longitude && a.latitude === b.latitude);
const httpsUrl = (raw) => { try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; } };
const checked = (value) => value && typeof value.checkedAt === 'string' && Number.isFinite(Date.parse(value.checkedAt)) && httpsUrl(value.sourceUrl);
const normalizedName = (name) => String(name || '').normalize('NFKC').replace(/[^가-힣a-z0-9]/gi, '').toLowerCase();

export function isLodging(place) {
  const leaf = String(place?.category || '').split('>').at(-1).trim();
  if (/카페|음식|레스토랑|뷔페|예식|웨딩|수영장|사우나|예약|대행|중개|관리|컨설팅/.test(leaf)) return false;
  return /(?:호텔|모텔|펜션|게스트하우스|리조트|민박|여관|콘도|호스텔|한옥스테이|캠핑장|숙박)$/.test(leaf);
}

export function straightLineMeters(a, b) {
  if (!pointOK(a) || !pointOK(b)) return null;
  const rad = (value) => value * Math.PI / 180;
  const value = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return Math.round(6371008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, value)), Math.sqrt(Math.max(0, 1 - value))));
}

export function buildLodgings(output, input, days, records, sources, getPlaceFacts, safeNarrative) {
  const enabled = input.duration > 1 && input.lodgingMode !== 'none';
  const planning = { totalBudget: input.budget, lodgingBudget: input.lodgingBudget ?? null, lodgingType: input.lodgingType || 'any', nights: input.duration - 1, priceFit: 'unknown', note: '숙박 예산은 사용자 상한이며 실제 요금이 아닙니다. 후보는 예약·확정 숙소가 아니며 대안들의 요금을 합산하지 않습니다.' };
  if (!enabled) return { status: 'not_needed', candidates: [], planning, warnings: [], note: input.duration === 1 ? '당일 일정은 숙박을 포함하지 않습니다.' : '숙소 추천을 요청하지 않았습니다.' };
  const warnings = [];
  const unique = new Set();
  const candidates = [];
  for (const item of output || []) {
    const record = records.get(item.placeRef.callId);
    const place = record?.name === 'search_places' && record.ok ? record.result.places[item.placeRef.index] : null;
    if (!place || !isLodging(place)) { warnings.push('숙박업소로 확인되지 않은 추천은 제외했습니다.'); continue; }
    const nights = [...new Set(item.nightIndexes)].sort((a, b) => a - b);
    if (!nights.length || nights.some((value) => value < 0 || value >= input.duration - 1)) { warnings.push('여행 숙박일 범위 밖 후보를 제외했습니다.'); continue; }
    if (nights.some((night, index) => index && night !== nights[index - 1] + 1)) { warnings.push('연속하지 않은 숙박일의 후보를 제외했습니다. 기간별로 나눠 추천해야 합니다.'); continue; }
    const identity = JSON.stringify([place.name, place.roadAddress || place.address, place.coordinates?.longitude, place.coordinates?.latitude, nights]);
    if (unique.has(identity)) continue;
    unique.add(identity);
    const relevantDays = new Set(nights.flatMap((night) => [night, night + 1]));
    const comparisons = [];
    days.forEach((day, dayIndex) => {
      if (!relevantDays.has(dayIndex)) return;
      day.stops.forEach((stop, stopIndex) => {
        if (!stop.place || isLodging(stop.place)) return;
        // Driving routes are directional. Never reuse attraction -> hotel as hotel -> attraction.
        const routeRecord = input.transport !== 'transit' ? [...records.values()].reverse().find((entry) => entry.name === 'get_routes' && entry.ok && entry.args.mode === 'driving' && samePoint(entry.args.start, place.coordinates) && samePoint(entry.args.goal, stop.place.coordinates)) : null;
        const route = routeRecord?.result || null;
        comparisons.push({ dayIndex, date: day.date, stopIndex, name: stop.title, coordinates: stop.place.coordinates,
          straightLineMeters: straightLineMeters(place.coordinates, stop.place.coordinates), route: route ? { ...route } : null,
          durationMs: route?.available ? route.durationMs : null, distanceMeters: route?.available ? route.distanceMeters : null });
      });
    });
    const checkInDate = addPlanDays(input.startDate, nights[0]);
    const checkOutDate = addPlanDays(input.startDate, nights.at(-1) + 1);
    const facts = getPlaceFacts(place, checkInDate);
    const quote = facts?.lodgingPrice;
    const contiguous = nights.every((night, index) => !index || night === nights[index - 1] + 1);
    const priceKnown = contiguous && quote?.status === 'confirmed' && checked(quote) && quote.currency === 'KRW' && quote.scope === 'entire_party_entire_stay' && quote.checkInDate === checkInDate && quote.checkOutDate === checkOutDate && quote.travelers === input.travelers && Number.isSafeInteger(quote.totalAmount) && quote.totalAmount >= 0;
    const price = priceKnown ? { status: 'confirmed', totalAmount: quote.totalAmount, sourceUrl: httpsUrl(quote.sourceUrl), checkedAt: quote.checkedAt, scope: quote.scope } : { status: 'unknown', totalAmount: null, sourceUrl: null };
    const booking = facts?.officialBooking;
    const bookingLink = booking?.status === 'confirmed' && booking.kind === 'official_booking' && checked(booking) && httpsUrl(booking.url) ? { url: httpsUrl(booking.url), sourceUrl: httpsUrl(booking.sourceUrl), checkedAt: booking.checkedAt } : null;
    const name = normalizedName(place.name);
    const publicSources = item.webSourceUrls.flatMap((url) => {
      const source = sources.find((value) => value.url === url);
      return source && httpsUrl(url) && name.length >= 2 && normalizedName(source.title).includes(name) ? [{ title: source.title, url: httpsUrl(url) }] : [];
    });
    const numericDistances = comparisons.map((entry) => entry.straightLineMeters).filter((value) => value !== null);
    const budgetFit = !priceKnown ? 'unknown' : quote.totalAmount > input.budget ? 'over_total_budget' : input.lodgingBudget != null ? quote.totalAmount <= input.lodgingBudget ? 'within_lodging_cap' : 'over_lodging_cap' : 'total_budget_only';
    const reason = /예약|객실|요금|가격|저렴|최저가|가성비|할인|평점|무료|예산.{0,10}(이내|충족|적합)/.test(item.reason) ? '실제 검색된 숙박 후보로, 방문 장소까지의 거리와 확인된 자동차 경로를 비교해 검토할 수 있습니다.' : safeNarrative(item.reason);
    candidates.push({ id: `stay-${candidates.length + 1}`, name: place.name, place: { ...place, source: { name: 'NAVER API HUB 지역 검색', query: record.result.query } }, nightIndexes: nights, checkInDate, checkOutDate, reason, comparisons,
      meanStraightLineMeters: numericDistances.length ? Math.round(numericDistances.reduce((sum, value) => sum + value, 0) / numericDistances.length) : null,
      price, budgetFit, publishedRates: facts?.publishedRates || [], facilities: facts?.facilities || null, tourismSource: facts?.tourismSource || null,
      availability: { status: 'unknown', message: '예약 가능 여부 미확인 · 무료 공공 API는 날짜별 남은 객실과 실판매 요금을 제공하지 않습니다.', reason: 'LIVE_SUPPLIER_NOT_CONNECTED' }, bookingLink, publicSources });
  }
  // Price-fit is never inferred from accommodation type or name; unknown candidates remain unknown.
  candidates.sort((a, b) => Number(a.budgetFit.startsWith('over_')) - Number(b.budgetFit.startsWith('over_')) || (a.meanStraightLineMeters ?? Infinity) - (b.meanStraightLineMeters ?? Infinity));
  return { status: candidates.length ? 'available' : 'unconfirmed', planning, candidates, warnings: [...new Set(warnings)],
    note: candidates.length ? '위치와 실제 조회된 자동차 경로를 비교하는 숙소 후보입니다. 좌표상 직선거리는 도로거리와 다르며, 요금·예약 가능 여부가 미확인이면 예산 충족을 보장하지 않습니다.' : '아직 실제 검색으로 연결된 숙소 후보가 없습니다. 채팅으로 숙소 추천을 요청하거나 다시 생성할 수 있습니다.' };
}
