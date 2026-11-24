import { env } from '../config/env.js';
import { ToolError } from '../lib/tool-error.js';
import { resolveWeatherLocation, toKmaGrid } from './weather-regions.js';

const source = { name: '기상청 단기예보', url: 'https://apihub.kma.go.kr/apiList.do?seqApi=10' };
export const kstDate = (date) => new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
export function weatherBaseTime(now) {
  // Publication is not instantaneous; use a conservative 15-minute availability delay.
  const shifted = new Date(now.getTime() + 9 * 3600000 - 15 * 60000);
  let hour = [...[2, 5, 8, 11, 14, 17, 20, 23]].reverse().find((value) => value <= shifted.getUTCHours());
  if (hour === undefined) { shifted.setUTCDate(shifted.getUTCDate() - 1); hour = 23; }
  return { base_date: shifted.toISOString().slice(0, 10).replaceAll('-', ''), base_time: `${String(hour).padStart(2, '0')}00` };
}

function configuration() {
  if (env.weather.apiKey) return { url: 'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst', keyName: 'authKey', key: env.weather.apiKey };
  if (env.weather.serviceKey) {
    let key = env.weather.serviceKey;
    try { key = decodeURIComponent(key); } catch { /* A raw key may contain a literal percent. */ }
    return { url: 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst', keyName: 'serviceKey', key };
  }
  return null;
}

function unavailable(region, date, reason, message, extra = {}) {
  return { source, region, date, available: false, status: 'unknown', reason, message,
    rainExpected: null, indoorSuggested: null, precipitationProbabilityMax: null, temperatureRangeC: null, hourly: [], ...extra };
}

export function validateWeatherInput(input) {
  if (!input || typeof input.region !== 'string' || !input.region.trim() || input.region.trim().length > 40 || typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(`${input.date}T12:00:00Z`)) || new Date(`${input.date}T12:00:00Z`).toISOString().slice(0,10) !== input.date) {
    throw new ToolError(400, 'INVALID_WEATHER_INPUT', '국내 여행 지역과 유효한 YYYY-MM-DD 날짜를 입력해 주세요.');
  }
  if (input.location !== null && input.location !== undefined && !resolveWeatherLocation(input.region, input.location)) throw new ToolError(400, 'INVALID_WEATHER_LOCATION', '국내 지역의 WGS84 소수 경위도를 입력해 주세요.');
  return { region: input.region.trim(), date: input.date, location: input.location ?? null };
}

const valueInRange = (value, min, max) => value !== undefined && value !== null && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : null;

export function createWeatherLookup({ fetchImpl = globalThis.fetch, getConfig = configuration, now = () => new Date(), cacheTtlMs = 600000 } = {}) {
  const cache = new Map();
  return async function get_weather(input, { signal } = {}) {
    const { region, date, location } = validateWeatherInput(input);
    const current = now();
    const today = kstDate(current);
    const daysAhead = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    if (daysAhead < 0) return unavailable(region, date, 'PAST_DATE', '현재 단기예보로 과거 날짜의 날씨를 확인할 수 없습니다.');
    if (daysAhead > 4) return unavailable(region, date, 'OUTSIDE_FORECAST_RANGE', '단기예보 제공 범위를 벗어난 날짜이므로 날씨는 미확인입니다. 출발일이 가까워지면 다시 확인해 주세요.');
    const point = resolveWeatherLocation(region, location);
    if (!point) return unavailable(region, date, 'LOCATION_UNKNOWN', '지역 대표 지점을 정할 수 없습니다. 시·군 이름 또는 검색으로 확인한 좌표가 필요합니다.');
    const grid = toKmaGrid(point);
    const base = weatherBaseTime(current);
    const common = { location: point, grid, issuedAt: `${base.base_date.slice(0,4)}-${base.base_date.slice(4,6)}-${base.base_date.slice(6,8)}T${base.base_time.slice(0,2)}:00:00+09:00`, retrievedAt: current.toISOString() };
    const config = getConfig();
    if (!config) return unavailable(region, date, 'NOT_CONFIGURED', '날씨 미확인: .env에 KMA_API_KEY 또는 KMA_SERVICE_KEY를 설정해 주세요.', common);
    try {
      const cacheKey = `${config.keyName}:${base.base_date}:${base.base_time}:${grid.nx}:${grid.ny}`;
      let cached = cache.get(cacheKey);
      if (!cached || cached.expires <= current.getTime()) {
        const items = [];
        let expected = 1;
        for (let page = 1; page <= Math.ceil(expected / 1000); page++) {
          const url = new URL(config.url);
          url.search = new URLSearchParams({ [config.keyName]: config.key, pageNo: String(page), numOfRows: '1000', dataType: 'JSON', ...base, nx: String(grid.nx), ny: String(grid.ny) });
          const response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(12000)]) });
          if ([401, 403].includes(response.status)) throw new ToolError(503, 'WEATHER_AUTH_ERROR', '기상청 인증키와 단기예보 활용 신청 상태를 확인해 주세요.');
          if (response.status === 429) throw new ToolError(429, 'WEATHER_RATE_LIMIT', '기상청 요청 한도에 도달했어요. 잠시 후 다시 확인해 주세요.');
          if (!response.ok) throw new ToolError(502, 'WEATHER_UPSTREAM_ERROR', '기상청 날씨 조회에 실패했어요. 잠시 후 다시 확인해 주세요.');
          const data = await response.json();
          const header = data?.response?.header;
          if (header?.resultCode === '03') return unavailable(region, date, 'NO_FORECAST', '해당 발표 시각의 예보 자료가 아직 없습니다.', common);
          if (header?.resultCode !== '00') throw new ToolError(502, 'WEATHER_API_ERROR', '기상청 응답 오류입니다. 인증키·활용 권한·서비스 상태를 확인해 주세요.');
          const body = data.response.body;
          const entries = body?.items?.item;
          if (!Array.isArray(entries) || !entries.length) return unavailable(region, date, 'NO_FORECAST', '사용 가능한 예보 자료가 없습니다.', common);
          expected = Number.isSafeInteger(body.totalCount) ? body.totalCount : entries.length;
          if (expected > 4000 || (page > 1 && !entries.length)) throw new ToolError(502, 'INVALID_WEATHER_RESPONSE', '예보 응답의 범위를 확인할 수 없습니다.');
          items.push(...entries);
        }
        cached = { items, expires: current.getTime() + cacheTtlMs, retrievedAt: current.toISOString() };
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, cached);
      }
      const dateKeys = cached.items.map((item) => String(item.fcstDate || '')).filter((key) => /^\d{8}$/.test(key)).sort();
      const range = { start: dateKeys[0] || null, end: dateKeys.at(-1) || null };
      const rows = new Map();
      for (const item of cached.items) {
        if (String(item.fcstDate) !== date.replaceAll('-', '') || !/^([01]\d|2[0-3])[0-5]\d$/.test(String(item.fcstTime))) continue;
        const time = `${String(item.fcstTime).slice(0,2)}:${String(item.fcstTime).slice(2)}`;
        if (!rows.has(time)) rows.set(time, { time, temperatureC: null, precipitationProbabilityPct: null, precipitationTypeCode: null, skyCode: null });
        const row = rows.get(time);
        if (item.category === 'TMP') row.temperatureC = valueInRange(item.fcstValue, -80, 60);
        if (item.category === 'POP') row.precipitationProbabilityPct = valueInRange(item.fcstValue, 0, 100);
        if (item.category === 'PTY') { const value = valueInRange(item.fcstValue, 0, 4); row.precipitationTypeCode = [0, 1, 2, 3, 4].includes(value) ? value : null; }
        if (item.category === 'SKY') { const value = valueInRange(item.fcstValue, 1, 4); row.skyCode = [1, 3, 4].includes(value) ? value : null; }
      }
      const hourly = [...rows.values()].filter((row) => Object.entries(row).some(([key, value]) => key !== 'time' && value !== null)).sort((a,b) => a.time.localeCompare(b.time));
      if (!hourly.length) return unavailable(region, date, 'NO_FORECAST_FOR_DATE', '실제 예보 응답에 해당 날짜가 없어 날씨는 미확인입니다.', { ...common, forecastRange: range });
      const temperatures = hourly.map((row) => row.temperatureC).filter((value) => value !== null);
      const probabilities = hourly.map((row) => row.precipitationProbabilityPct).filter((value) => value !== null);
      const rainExpected = hourly.some((row) => [1, 2, 4].includes(row.precipitationTypeCode)) ? true : hourly.every((row) => row.precipitationTypeCode !== null) ? false : null;
      const probability = probabilities.length ? Math.max(...probabilities) : null;
      const indoorSuggested = rainExpected === true || (probability !== null && probability >= 60) || hourly.some((row) => row.precipitationTypeCode === 3) ? true : rainExpected === null && probability === null ? null : false;
      return { source, region, date, available: true, status: 'available', ...common, retrievedAt: cached.retrievedAt, forecastRange: range, rainExpected,
        indoorSuggested, precipitationProbabilityMax: probability,
        temperatureRangeC: temperatures.length ? { min: Math.min(...temperatures), max: Math.max(...temperatures), label: '제공된 예보 시점의 기온 범위 (일 최저·최고 보장 아님)' } : null,
        hourly, message: indoorSuggested ? '비·눈 또는 높은 강수확률이 예보돼 실내 장소 대안을 고려해 주세요.' : '실제 응답의 제공 시간대만 확인한 예보입니다. 미제공 시간은 미확인입니다.',
        adaptationRule: 'PTY의 비·비/눈·소나기·눈 또는 제공 시간대 최대 강수확률 60% 이상이면 실내 대안 권장',
      };
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Weather request cancelled', 'AbortError');
      if (error instanceof ToolError) throw error;
      if (error?.name === 'TimeoutError') throw new ToolError(504, 'WEATHER_TIMEOUT', '날씨 응답이 지연되고 있어요. 잠시 후 다시 확인해 주세요.');
      throw new ToolError(502, 'WEATHER_UNAVAILABLE', '공식 날씨 자료를 가져오지 못해 미확인입니다. 잠시 후 다시 확인해 주세요.');
    }
  };
}

export const get_weather = createWeatherLookup();
