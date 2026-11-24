import { env } from '../config/env.js';
import { ToolError } from '../lib/tool-error.js';
import { placeText } from './naver-api-hub.js';
import { straightLineMeters } from '../agents/lodging-result.js';

const base = 'https://apis.data.go.kr/B551011/KorService2';
const sourceUrl = 'https://www.data.go.kr/data/15101578/openapi.do';
const clean = (value) => placeText(typeof value === 'string' ? value.replace(/<br\s*\/?\s*>/gi, '\n') : '').slice(0, 3000);
const normalized = (value) => clean(value).normalize('NFKC').replace(/[^가-힣a-z0-9]/gi, '').toLowerCase();
const publicSource = (id, checkedAt) => ({ name: '한국관광공사 TourAPI', url: sourceUrl, contentId: id || null, checkedAt });

export function normalizeOpeningHours(rawHours, rawRest, date, source, checkedAt) {
  const text = clean(rawHours), rest = clean(rawRest);
  const result = { status: 'published', date, text: text || '운영시간 미제공', restText: rest || '휴무 정보 미제공', intervals: [], sourceUrl: source, checkedAt, note: '공공 등록 운영정보입니다. 임시휴무·공휴일·현장 변경은 방문 전에 확인해 주세요.' };
  if (!text) return { ...result, status: 'unknown' };
  const compact = text.replace(/\s+/g, '').replace(/：/g, ':').replace(/[～〜–—]/g, '~');
  // Only unambiguous time ranges. Seasonal schedules/admission cutoffs/holiday rules stay published text.
  if (!/^\d{1,2}:\d{2}[~\-]\d{1,2}:\d{2}(?:[,/;]\d{1,2}:\d{2}[~\-]\d{1,2}:\d{2})*$/.test(compact)) return result;
  const ranges = compact.split(/[,/;]/).map((value) => { const [open, close] = value.split(/[~\-]/).map((time) => time.padStart(5, '0')); return { open, close }; });
  const minute = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
  if (ranges.some((range) => minute(range.open) === null || minute(range.close) === null || minute(range.open) >= minute(range.close))) return result;
  const restCompact = rest.replace(/\s+/g, '');
  let closed = false;
  if (!/^(?:연중무휴|없음|무휴)$/.test(restCompact)) {
    if (!/^(?:매주)?[월화수목금토일]요일(?:휴무|휴관|정기휴무|정기휴관)?$/.test(restCompact)) return result;
    const weekday = '일월화수목금토'[new Date(`${date}T12:00:00Z`).getUTCDay()];
    closed = restCompact.includes(`${weekday}요일`);
  }
  return { ...result, status: 'confirmed', intervals: closed ? [] : ranges, evidenceKind: 'published_regular_hours' };
}

export function matchTourPlace(place, candidates) {
  const matches = candidates.filter((candidate) => {
    if (normalized(candidate.title) !== normalized(place.name)) return false;
    const distance = straightLineMeters(place.coordinates, { longitude: Number(candidate.mapx), latitude: Number(candidate.mapy) });
    const addressA = normalized(place.roadAddress || place.address), addressB = normalized(candidate.addr1);
    return distance !== null && distance <= 150 || addressA.length >= 6 && addressA === addressB;
  });
  return matches.length === 1 ? matches[0] : null;
}

export function createTourDetails({ fetchImpl = globalThis.fetch, getKey = () => env.tourism.serviceKey, now = () => new Date() } = {}) {
  return async function get_place_details({ place, date }, { signal } = {}) {
    if (!place || typeof place.name !== 'string' || !place.name.trim() || place.name.length > 200 || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) !== date) throw new ToolError(400, 'INVALID_PLACE_DETAILS', '검색된 장소와 유효한 방문 날짜가 필요합니다.');
    const checkedAt = now().toISOString();
    const unknown = (reason, message) => ({ available: false, reason, message, date, placeName: place.name, source: publicSource(null, checkedAt), openingHours: null, publishedRates: [], facilities: null });
    let key = getKey();
    if (!key) return unknown('TOUR_NOT_CONFIGURED', '무료 TourAPI 활용 신청 후 .env의 TOUR_API_KEY를 설정해 주세요. 기상청 API허브 키와는 별도입니다.');
    try { key = decodeURIComponent(key); } catch { /* Raw key may contain a percent. */ }
    async function request(method, params) {
      const url = new URL(`${base}/${method}`); url.search = new URLSearchParams({ serviceKey: key, MobileOS: 'WEB', MobileApp: 'DomesticTravelPlanner', _type: 'json', numOfRows: '20', pageNo: '1', ...params });
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(12000)]) });
      if (!response.ok) throw new ToolError(response.status === 429 ? 429 : 502, 'TOUR_UPSTREAM_ERROR', '관광공사 운영정보 조회에 실패했습니다. 활용 권한·연결 상태를 확인해 주세요.');
      const data = await response.json();
      if (data?.response?.header?.resultCode !== '0000' && data?.response?.header?.resultCode !== '00') throw new ToolError(502, 'TOUR_API_ERROR', '관광공사 인증키 또는 서비스 활용 권한을 확인해 주세요.');
      const items = data?.response?.body?.items?.item;
      return Array.isArray(items) ? items : items && typeof items === 'object' ? [items] : [];
    }
    try {
      const candidates = await request('searchKeyword2', { keyword: place.name, arrange: 'C' });
      const matched = matchTourPlace(place, candidates);
      if (!matched) return unknown('TOUR_PLACE_NOT_MATCHED', '동명 장소의 좌표·주소를 확실히 연결하지 못했습니다. 다른 장소의 운영정보를 적용하지 않습니다.');
      if (!/^\d+$/.test(String(matched.contentid)) || !['12','14','15','25','28','32','38','39'].includes(String(matched.contenttypeid))) return unknown('TOUR_INVALID_CONTENT', '관광공사 콘텐츠 식별자를 확인할 수 없습니다.');
      const params = { contentId: String(matched.contentid), contentTypeId: String(matched.contenttypeid) };
      const intro = (await request('detailIntro2', params))[0] || {};
      const hourFields = { '12': ['usetime', 'restdate'], '14': ['usetimeculture', 'restdateculture'], '28': ['usetimeleports', 'restdateleports'], '38': ['opentime', 'restdateshopping'], '39': ['opentimefood', 'restdatefood'] };
      const fields = hourFields[String(matched.contenttypeid)];
      const openingHours = fields ? normalizeOpeningHours(intro[fields[0]], intro[fields[1]], date, sourceUrl, checkedAt) : null;
      const publishedRates = [];
      if (String(matched.contenttypeid) === '32') {
        const rooms = await request('detailInfo2', params);
        for (const room of rooms.slice(0, 10)) for (const [field, label] of [['roomoffseasonminfee1','비수기 주중'], ['roomoffseasonminfee2','비수기 주말'], ['roompeakseasonminfee1','성수기 주중'], ['roompeakseasonminfee2','성수기 주말']]) {
          const raw = String(room[field] ?? '').replaceAll(',', '').trim();
          if (/^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) > 0) publishedRates.push({ roomName: clean(room.roomtitle) || '객실명 미제공', label, amount: Number(raw), currency: 'KRW', status: 'published_reference', sourceUrl, checkedAt, note: '공공 등록 참고 요금이며 선택 날짜·인원·객실 조건의 실제 판매 요금이 아닙니다.' });
        }
      }
      return { available: true, date, placeName: place.name, matched: { title: clean(matched.title), contentId: String(matched.contentid), contentTypeId: String(matched.contenttypeid), modifiedTime: clean(matched.modifiedtime) || null }, source: publicSource(String(matched.contentid), checkedAt), openingHours, publishedRates,
        facilities: String(matched.contenttypeid) === '32' ? { roomCountText: clean(intro.roomcount) || null, checkInText: clean(intro.checkintime) || null, checkOutText: clean(intro.checkouttime) || null, reservationGuide: clean(intro.reservationlodging) || null, note: '시설에 등록된 객실 수는 남은 객실 재고가 아닙니다.' } : null };
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Details request cancelled', 'AbortError');
      if (error instanceof ToolError) throw error;
      throw new ToolError(502, 'TOUR_UNAVAILABLE', '관광공사 공개 정보를 가져오지 못했습니다. 요금·운영시간을 추정하지 않습니다.');
    }
  };
}

export const get_place_details = createTourDetails();
