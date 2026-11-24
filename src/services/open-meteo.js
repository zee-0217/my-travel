import { ToolError } from '../lib/tool-error.js';
import { validateWeatherInput, kstDate } from './kma-weather.js';
import { resolveWeatherLocation } from './weather-regions.js';

const source = { name: 'Open-Meteo', url: 'https://open-meteo.com/en/docs', license: 'CC BY 4.0', termsUrl: 'https://open-meteo.com/en/terms' };
const rainCodes = new Set([51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99]);
const snowCodes = new Set([71,73,75,77,85,86]);
const dryCodes = new Set([0,1,2,3,45,48]);
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;

export function createOpenMeteoLookup({ fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const cache = new Map();
  return async function openMeteo(input, { signal } = {}) {
    const { region, date, location } = validateWeatherInput(input);
    const current = now(), today = kstDate(current);
    const days = (Date.parse(date) - Date.parse(today)) / 86400000;
    const unknown = (reason, message) => ({ source, region, date, available: false, status: 'unknown', reason, message, rainExpected: null, indoorSuggested: null, precipitationProbabilityMax: null, temperatureRangeC: null, hourly: [] });
    if (days < 0 || days > 15) return unknown('OUTSIDE_FORECAST_RANGE', '무료 예보 제공 범위(오늘부터 최대 16일) 밖 날짜는 미확인입니다.');
    const point = resolveWeatherLocation(region, location);
    if (!point) return unknown('LOCATION_UNKNOWN', '지역 또는 실제 검색된 좌표를 확인해 주세요.');
    const key = JSON.stringify([point.longitude, point.latitude, date]);
    const saved = cache.get(key);
    if (saved && current.getTime() - saved.time < 600000) return structuredClone(saved.result);
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({ latitude: String(point.latitude), longitude: String(point.longitude), hourly: 'temperature_2m,precipitation_probability,weather_code', timezone: 'Asia/Seoul', start_date: date, end_date: date });
    try {
      const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(12000)]) });
      if (!response.ok) throw new ToolError(response.status === 429 ? 429 : 502, 'OPEN_METEO_ERROR', '무료 날씨 API 조회에 실패했습니다. 잠시 후 다시 확인해 주세요.');
      const data = await response.json();
      if (data.error || data.timezone !== 'Asia/Seoul' || data.utc_offset_seconds !== 32400) throw new ToolError(502, 'OPEN_METEO_INVALID_RESPONSE', '날씨 응답의 날짜·시간대를 확인할 수 없습니다.');
      const hourly = (Array.isArray(data.hourly?.time) ? data.hourly.time : []).flatMap((time, index) => {
        if (typeof time !== 'string' || !time.startsWith(`${date}T`) || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):00$/.test(time)) return [];
        const code = data.hourly.weather_code?.[index];
        const row = { time: time.slice(11), weatherCode: Number.isInteger(code) ? code : null,
          temperatureC: number(data.hourly.temperature_2m?.[index], -80, 60), precipitationProbabilityPct: number(data.hourly.precipitation_probability?.[index], 0, 100),
          precipitationTypeCode: rainCodes.has(code) ? 1 : snowCodes.has(code) ? 3 : dryCodes.has(code) ? 0 : null };
        return row.temperatureC === null && row.precipitationProbabilityPct === null && row.precipitationTypeCode === null ? [] : [row];
      });
      if (!hourly.length) return unknown('NO_FORECAST_FOR_DATE', '실제 응답에 해당 날짜의 예보가 없습니다.');
      const temps = hourly.map((row) => row.temperatureC).filter((v) => v !== null), probs = hourly.map((row) => row.precipitationProbabilityPct).filter((v) => v !== null);
      const rainExpected = hourly.some((row) => row.precipitationTypeCode === 1) ? true : hourly.every((row) => row.precipitationTypeCode !== null) ? false : null;
      const indoorSuggested = hourly.some((row) => [1,3].includes(row.precipitationTypeCode) || row.precipitationProbabilityPct >= 60) ? true : hourly.every((row) => row.precipitationTypeCode !== null && row.precipitationProbabilityPct !== null) ? false : null;
      const result = { source, region, date, available: true, status: 'available', location: point, issuedAt: null, retrievedAt: current.toISOString(), rainExpected, indoorSuggested,
        precipitationProbabilityMax: probs.length ? Math.max(...probs) : null, temperatureRangeC: temps.length ? { min: Math.min(...temps), max: Math.max(...temps), label: '제공 시간대 기온 범위' } : null, hourly,
        message: 'Open-Meteo 수치예보입니다. 미제공 시간은 미확인이며 먼 날짜의 예보는 변경될 수 있습니다.', forecastRange: { start: date, end: date } };
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, { time: current.getTime(), result }); return structuredClone(result);
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Weather request cancelled', 'AbortError');
      if (error instanceof ToolError) throw error;
      throw new ToolError(502, 'OPEN_METEO_UNAVAILABLE', '무료 날씨 정보를 가져오지 못해 미확인입니다.');
    }
  };
}
export const getOpenMeteoWeather = createOpenMeteoLookup();
