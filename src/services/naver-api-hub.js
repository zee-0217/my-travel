import { env } from '../config/env.js';
import { PlacesError, publicPlacesError } from '../lib/places-error.js';

// Server only. API HUB credentials are separate from Maps application credentials.
export function getLocalSearchConfig() {
  if (!env.naverApiHub.clientId.trim() || !env.naverApiHub.clientSecret.trim()) {
    throw new PlacesError(503, 'PLACES_NOT_CONFIGURED', '서버 .env에 NAVER_API_HUB_CLIENT_ID와 NAVER_API_HUB_CLIENT_SECRET을 설정한 뒤 서버를 다시 실행해 주세요.');
  }
  return {
    url: 'https://naverapihub.apigw.ntruss.com/search/v1/local',
    headers: {
      'X-NCP-APIGW-API-KEY-ID': env.naverApiHub.clientId.trim(),
      'X-NCP-APIGW-API-KEY': env.naverApiHub.clientSecret.trim(),
    },
  };
}

export function validatePlaceSearch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PlacesError(400, 'INVALID_PLACE_QUERY', '여행 지역과 검색 키워드를 입력해 주세요.');
  }
  const { region, keyword, display = 5, sort = 'random' } = input;
  if (typeof region !== 'string' || !region.trim() || region.trim().length > 40 ||
      typeof keyword !== 'string' || !keyword.trim() || keyword.trim().length > 80 ||
      !Number.isInteger(display) || display < 1 || display > 5 || !['random', 'comment'].includes(sort)) {
    throw new PlacesError(400, 'INVALID_PLACE_QUERY', '지역은 1~40자, 키워드는 1~80자, 검색 개수는 1~5개로 입력해 주세요.');
  }
  return { region: region.trim(), keyword: keyword.trim(), display, sort };
}

// Remove provider highlighting, then decode common text entities once.
// Clients must still use textContent; this function is not an HTML sanitizer.
export function placeText(value) {
  if (typeof value !== 'string') return '';
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return value.replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, code) => {
    if (!code.startsWith('#')) return named[code.toLowerCase()] ?? entity;
    const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : entity;
  }).trim();
}

function safeLink(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Official API HUB docs: mapx/mapy are WGS84 strings, x=longitude/y=latitude.
// Preserve raw values: the docs do not specify a numeric scaling factor.
export function normalizePlaceCoordinates(mapx, mapy) {
  const raw = {
    mapx: typeof mapx === 'string' || typeof mapx === 'number' ? String(mapx) : null,
    mapy: typeof mapy === 'string' || typeof mapy === 'number' ? String(mapy) : null,
  };
  const unavailable = { crs: 'WGS84', longitude: null, latitude: null, encoding: 'unrecognized', raw };
  const numeric = (value) => value !== null && /^-?\d+(?:\.\d+)?$/.test(value.trim());
  if (!numeric(raw.mapx) || !numeric(raw.mapy)) return unavailable;
  const x = Number(raw.mapx);
  const y = Number(raw.mapy);
  const validDegrees = (longitude, latitude) => Number.isFinite(longitude) && Number.isFinite(latitude) && Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90 && !(longitude === 0 && latitude === 0);
  if (validDegrees(x, y)) return { crs: 'WGS84', longitude: x, latitude: y, encoding: 'decimal_degrees', raw };
  // Live API HUB check (2026-11-18): "1289475239", "377724092" -> 128.9475239, 37.7724092.
  // Accept the Korean-region integer encoding only when BOTH values fit its range.
  // Do not treat old KATEC values or arbitrary out-of-range values as degrees.
  if (/^-?\d+$/.test(raw.mapx.trim()) && /^-?\d+$/.test(raw.mapy.trim()) &&
      Number.isSafeInteger(x) && Number.isSafeInteger(y) &&
      x >= 1240000000 && x <= 1320000000 && y >= 330000000 && y <= 390000000) {
    return { crs: 'WGS84', longitude: x / 10000000, latitude: y / 10000000, encoding: 'scaled_1e7', raw };
  }
  return unavailable;
}

function upstreamError(status) {
  if (status === 401 || status === 403) return new PlacesError(503, 'PLACES_AUTH_ERROR', 'NAVER API HUB 인증 정보와 지역 검색 사용 권한을 확인해 주세요.');
  if (status === 429) return new PlacesError(429, 'PLACES_RATE_LIMIT', 'NAVER 장소 검색 한도를 초과했어요. 잠시 후 다시 검색해 주세요.');
  return new PlacesError(502, 'PLACES_UPSTREAM_ERROR', 'NAVER 장소 검색 응답을 받지 못했어요. 잠시 후 다시 검색해 주세요.');
}

export function createPlaceSearch({ getConfig = getLocalSearchConfig, fetchImpl = globalThis.fetch } = {}) {
  return async function search_places(input, { signal } = {}) {
    const { region, keyword, display, sort } = validatePlaceSearch(input);
    try {
      const config = getConfig();
      const url = new URL(config.url);
      const query = `${region} ${keyword}`;
      url.search = new URLSearchParams({ query, display: String(display), start: '1', sort, format: 'json' }).toString();
      const response = await fetchImpl(url, {
        method: 'GET', headers: { ...config.headers, Accept: 'application/json' },
        signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(12000)]),
        redirect: 'error', cache: 'no-store',
      });
      if (!response.ok) throw upstreamError(response.status);
      const data = await response.json();
      if (!data || !Array.isArray(data.items) || data.error || data.errorCode || data.items.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
        throw new PlacesError(502, 'INVALID_PLACES_RESPONSE', 'NAVER 장소 검색 결과를 읽지 못했어요. 잠시 후 다시 검색해 주세요.');
      }
      const places = data.items.slice(0, display).map((item) => ({
        name: placeText(item.title), address: placeText(item.address), roadAddress: placeText(item.roadAddress),
        category: placeText(item.category), link: safeLink(item.link),
        coordinates: normalizePlaceCoordinates(item.mapx, item.mapy),
      }));
      return {
        source: 'NAVER API HUB', region, keyword, query,
        total: Number.isSafeInteger(data.total) && data.total >= 0 ? data.total : null,
        returnedCount: places.length, places,
      };
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Place search cancelled', 'AbortError');
      if (error instanceof SyntaxError) throw new PlacesError(502, 'INVALID_PLACES_RESPONSE', 'NAVER 장소 검색 결과를 읽지 못했어요. 잠시 후 다시 검색해 주세요.');
      throw publicPlacesError(error);
    }
  };
}

export const search_places = createPlaceSearch();
