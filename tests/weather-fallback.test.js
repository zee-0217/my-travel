import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenMeteoLookup } from '../src/services/open-meteo.js';
import { createWeatherService } from '../src/services/weather.js';

const now = () => new Date('2026-11-24T03:00:00Z');
const input = { region: '부산', date: '2026-11-24', location: null };
test('free forecast uses actual KST hours, explicit WMO codes and cache, without a key', async () => {
  let calls = 0;
  const lookup = createOpenMeteoLookup({ now, fetchImpl: async (url) => {
    calls++; assert.equal(url.hostname, 'api.open-meteo.com'); assert.equal(url.searchParams.get('timezone'), 'Asia/Seoul'); assert.equal(url.searchParams.has('apikey'), false);
    return Response.json({ timezone: 'Asia/Seoul', utc_offset_seconds: 32400, hourly: { time: ['2026-11-24T10:00','2026-11-24T11:00','2026-11-25T10:00'], temperature_2m: [10,null,20], precipitation_probability: [80,null,0], weather_code: [61,null,0] } });
  } });
  const result = await lookup(input); assert.equal(result.available, true); assert.equal(result.source.name, 'Open-Meteo'); assert.equal(result.rainExpected, true); assert.equal(result.hourly.length, 1); assert.equal(result.hourly[0].precipitationTypeCode, 1);
  await lookup(input); assert.equal(calls, 1);
  const future = await lookup({ ...input, date: '2027-01-01' }); assert.equal(future.available, false); assert.equal(calls, 1);
});
test('fallback only runs after KMA failure or unavailable data; disabled option and abort respected', async () => {
  let calls = 0;
  const fallback = async () => { calls++; return { available: true, source: { name: 'Open-Meteo' } }; };
  const kma = async () => { throw Object.assign(new Error('secret payload'), { code: 'WEATHER_AUTH_ERROR' }); };
  const result = await createWeatherService({ kma, fallback, enabled: () => true })(input);
  assert.equal(result.fallback.reason, 'WEATHER_AUTH_ERROR'); assert.ok(!JSON.stringify(result).includes('secret')); assert.equal(calls, 1);
  await createWeatherService({ kma: async () => ({ available: true }), fallback })(input); assert.equal(calls, 1);
  await createWeatherService({ kma, fallback, enabled: () => false })(input); assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createWeatherService({ kma: async () => { throw new DOMException('cancelled', 'AbortError'); }, fallback })(input, { signal: controller.signal })); assert.equal(calls, 1);
});
