import { env } from '../config/env.js';
import { get_weather as getKmaWeather, validateWeatherInput } from './kma-weather.js';
import { getOpenMeteoWeather } from './open-meteo.js';

export function createWeatherService({ kma = getKmaWeather, fallback = getOpenMeteoWeather, enabled = () => env.weather.freeFallback } = {}) {
  return async function get_weather(input, options = {}) {
    validateWeatherInput(input);
    let primary, failure;
    try { primary = await kma(input, options); if (primary.available) return primary; }
    catch (error) { if (options.signal?.aborted || error.name === 'AbortError') throw error; failure = ['WEATHER_AUTH_ERROR','WEATHER_TIMEOUT','WEATHER_RATE_LIMIT','WEATHER_API_ERROR','WEATHER_UNAVAILABLE','WEATHER_UPSTREAM_ERROR'].includes(error.code) ? error.code : 'WEATHER_UNAVAILABLE'; }
    if (!enabled()) { if (failure) return { source: { name: '기상청', url: 'https://apihub.kma.go.kr/apiList.do?seqApi=10' }, region: input.region, date: input.date, available: false, reason: failure, hourly: [], message: '기상청 조회 실패 · 무료 대체 예보 비활성화', rainExpected: null, indoorSuggested: null }; return primary; }
    const result = await fallback(input, options);
    return { ...result, fallback: { from: '기상청', reason: failure || primary.reason, message: '기상청 미제공 또는 조회 실패로 무료 대체 예보를 사용했습니다.' } };
  };
}
export const get_weather = createWeatherService();
