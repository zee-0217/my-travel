import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createWeatherLookup, weatherBaseTime } from '../src/services/kma-weather.js';
import { resolveWeatherLocation, toKmaGrid } from '../src/services/weather-regions.js';
import { createApp } from '../src/app.js';

const now = () => new Date('2026-11-23T03:30:00Z');
const input = { region: '부산', date: '2026-11-24', location: null };
const getConfig = () => ({ url: 'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst', keyName: 'authKey', key: 'private-weather-key' });
const rows = (date = '20261124', pty = '1', pop = '80') => ['0900', '1200'].flatMap((fcstTime) => [['TMP', '15'], ['PTY', pty], ['POP', pop]].map(([category, fcstValue]) => ({ fcstDate: date, fcstTime, category, fcstValue })));
const response = (items, totalCount = items.length) => new Response(JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: { item: items }, totalCount } } }));

test('KMA grid and representative locations distinguish cities and ambiguous regions', () => {
  assert.deepEqual(toKmaGrid(resolveWeatherLocation('서울')), { nx: 60, ny: 127 });
  assert.deepEqual(toKmaGrid(resolveWeatherLocation('부산')), { nx: 98, ny: 76 });
  assert.deepEqual(toKmaGrid(resolveWeatherLocation('제주도')), { nx: 53, ny: 38 });
  assert.match(resolveWeatherLocation('제주 서귀포').label, /서귀포/);
  assert.equal(resolveWeatherLocation('서울 부산'), null);
  assert.equal(resolveWeatherLocation('국내 어디든'), null);
});

test('KST issue selection handles publication delay and previous-day rollover', () => {
  assert.deepEqual(weatherBaseTime(new Date('2026-11-22T17:10:00Z')), { base_date: '20261122', base_time: '2300' });
  assert.deepEqual(weatherBaseTime(new Date('2026-11-22T17:20:00Z')), { base_date: '20261123', base_time: '0200' });
});

test('standalone get_weather uses official parameters and actual rainy data; reuses grid forecast cache', async () => {
  let calls = 0;
  const weather = createWeatherLookup({ now, getConfig, fetchImpl: async (url) => {
    calls++;
    assert.equal(url.hostname, 'apihub.kma.go.kr');
    assert.equal(url.searchParams.get('authKey'), 'private-weather-key');
    assert.equal(url.searchParams.get('nx'), '98');
    assert.equal(url.searchParams.get('base_time'), '1100');
    return response([...rows(), ...rows('20261125', '0', '10')]);
  } });
  const wet = await weather(input);
  assert.equal(wet.available, true);
  assert.equal(wet.rainExpected, true);
  assert.equal(wet.indoorSuggested, true);
  assert.equal(wet.precipitationProbabilityMax, 80);
  assert.deepEqual([wet.temperatureRangeC.min, wet.temperatureRangeC.max], [15, 15]);
  const dry = await weather({ ...input, date: '2026-11-25' });
  assert.equal(dry.rainExpected, false);
  assert.equal(dry.indoorSuggested, false);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(wet).includes('private-weather-key'));
  assert.equal((await weather({ ...input, date: '2026-11-26' })).reason, 'NO_FORECAST_FOR_DATE');
});

test('far-future, past, unknown region and absent key stay unknown without network', async () => {
  const weather = createWeatherLookup({ now, getConfig: () => null, fetchImpl: () => { throw new Error('must not fetch'); } });
  for (const [args, reason] of [[{ ...input, date: '2027-01-01' }, 'OUTSIDE_FORECAST_RANGE'], [{ ...input, date: '2026-11-22' }, 'PAST_DATE'], [{ ...input, region: '어딘가' }, 'LOCATION_UNKNOWN'], [input, 'NOT_CONFIGURED']]) {
    const result = await weather(args);
    assert.equal(result.reason, reason);
    assert.equal(result.available, false);
    assert.equal(result.rainExpected, null);
  }
  await assert.rejects(weather({ ...input, date: '2026-02-30' }), (error) => error.code === 'INVALID_WEATHER_INPUT');
});

test('missing precipitation fields never imply clear weather; high probability suggests indoor alternatives', async () => {
  const partial = createWeatherLookup({ now, getConfig, fetchImpl: async () => response(rows().filter((row) => row.category === 'TMP')) });
  const result = await partial(input);
  assert.equal(result.rainExpected, null);
  assert.equal(result.indoorSuggested, null);
  const highPop = createWeatherLookup({ now, getConfig, fetchImpl: async () => response(rows('20261124', '0', '60')) });
  assert.equal((await highPop(input)).indoorSuggested, true);
});

test('pagination reads full actual forecast and upstream errors never disclose URLs or keys', async () => {
  let calls = 0;
  const weather = createWeatherLookup({ now, getConfig, fetchImpl: async () => { calls++; return response(calls === 1 ? rows('20261123') : rows(), 1006); } });
  assert.equal((await weather(input)).available, true);
  assert.equal(calls, 2);
  for (const fetchImpl of [async () => new Response('', { status: 403 }), async () => { throw new Error('https://example.com/?authKey=private-weather-key'); }, async () => new Response('bad-json')]) {
    await assert.rejects(createWeatherLookup({ now, getConfig, fetchImpl })(input), (error) => !error.message.includes('private-weather-key') && error.code.startsWith('WEATHER_'));
  }
});

test('POST /api/weather runs independently and returns safe JSON for malformed requests', async (t) => {
  const server = createApp({ getWeather: createWeatherLookup({ now, getConfig, fetchImpl: async () => response(rows()) }) }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/weather`;
  const result = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).weather.rainExpected, true);
  const malformed = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_REQUEST');
});
