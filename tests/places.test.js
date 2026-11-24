import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaceSearch, normalizePlaceCoordinates } from '../src/services/naver-api-hub.js';
import { PlacesError } from '../src/lib/places-error.js';

const config = { url: 'https://naverapihub.apigw.ntruss.com/search/v1/local', headers: { 'X-NCP-APIGW-API-KEY-ID': 'test-id-private', 'X-NCP-APIGW-API-KEY': 'test-secret-private' } };
const item = { title: '<b>강릉</b> 카페 &amp; 쉼', address: '강원특별자치도 강릉시 예시동', roadAddress: '강원특별자치도 강릉시 예시로 1', category: '카페,디저트>카페', mapx: '128.9301234', mapy: '37.7901234', link: 'https://example.com/place', openingHours: 'untrusted extra', rating: 5, price: 1000 };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('independent search_places uses new API HUB URL, headers and encoded region/keyword', async () => {
  const search_places = createPlaceSearch({ getConfig: () => config, fetchImpl: async (url, options) => {
    assert.equal(url.origin + url.pathname, config.url);
    assert.equal(url.searchParams.get('query'), '강릉 바다 카페 & 디저트');
    assert.equal(url.searchParams.get('display'), '5');
    assert.equal(url.searchParams.get('start'), '1');
    assert.equal(url.searchParams.get('format'), 'json');
    assert.equal(url.searchParams.get('sort'), 'random');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers['X-NCP-APIGW-API-KEY-ID'], 'test-id-private');
    assert.equal(options.headers['X-NCP-APIGW-API-KEY'], 'test-secret-private');
    assert.equal(options.redirect, 'error');
    return json({ total: 1, items: [item] });
  } });
  const result = await search_places({ region: ' 강릉 ', keyword: '바다 카페 & 디저트' });
  assert.equal(result.places[0].name, '강릉 카페 & 쉼');
  assert.equal(result.places[0].address, item.address);
  assert.equal(result.places[0].roadAddress, item.roadAddress);
  assert.equal(result.places[0].category, item.category);
  assert.equal(result.places[0].coordinates.longitude, 128.9301234);
  assert.equal(result.places[0].coordinates.latitude, 37.7901234);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.deepEqual(Object.keys(result.places[0]).sort(), ['address', 'category', 'coordinates', 'link', 'name', 'roadAddress']);
});

test('coordinates preserve raw strings and distinguish decimal degrees from scaled integers', () => {
  const decimal = normalizePlaceCoordinates('128.9301234', '37.7901234');
  const scaled = normalizePlaceCoordinates('1289301234', '377901234');
  assert.equal(decimal.encoding, 'decimal_degrees');
  assert.equal(scaled.encoding, 'scaled_1e7');
  assert.equal(decimal.longitude, scaled.longitude);
  assert.equal(decimal.latitude, scaled.latitude);
  assert.deepEqual(scaled.raw, { mapx: '1289301234', mapy: '377901234' });
  for (const [x, y] of [['', ''], [null, undefined], ['NaN', '37'], ['310000', '550000'], ['181', '91'], ['0', '0'], ['1289301234', '37.79']]) {
    const result = normalizePlaceCoordinates(x, y);
    assert.equal(result.longitude, null);
    assert.equal(result.latitude, null);
  }
});

test('empty results and missing fields stay empty without fabricated metadata', async () => {
  let body = { total: 0, items: [] };
  const search_places = createPlaceSearch({ getConfig: () => config, fetchImpl: async () => json(body) });
  assert.deepEqual((await search_places({ region: '강릉', keyword: '없는장소' })).places, []);
  body = { items: [{ title: '&#xCE74;&#54168; &quot;쉼&quot;', link: 'javascript:alert(1)' }] };
  const result = await search_places({ region: '강릉', keyword: '카페' });
  assert.equal(result.total, null);
  assert.equal(result.places[0].name, '카페 "쉼"');
  assert.equal(result.places[0].address, '');
  assert.equal(result.places[0].link, null);
  assert.equal(result.places[0].coordinates.longitude, null);
});

test('invalid arguments fail before any authentication or network request', async () => {
  let calls = 0;
  const search_places = createPlaceSearch({ getConfig: () => { calls++; return config; } });
  for (const input of [null, {}, { region: '', keyword: '카페' }, { region: '강릉', keyword: '' }, { region: '강릉', keyword: '카페', display: 6 }, { region: '강릉', keyword: '카페', sort: 'rating' }]) {
    await assert.rejects(search_places(input), (error) => error.code === 'INVALID_PLACE_QUERY');
  }
  assert.equal(calls, 0);
});

test('upstream errors, malformed responses and missing credentials are safe failures', async () => {
  for (const [status, code] of [[401, 'PLACES_AUTH_ERROR'], [403, 'PLACES_AUTH_ERROR'], [429, 'PLACES_RATE_LIMIT'], [500, 'PLACES_UPSTREAM_ERROR']]) {
    const search_places = createPlaceSearch({ getConfig: () => config, fetchImpl: async () => json({ message: 'test-secret-private' }, status) });
    await assert.rejects(search_places({ region: '강릉', keyword: '카페' }), (error) => error.code === code && !error.message.includes('private'));
  }
  for (const body of [{ errorCode: 'SE99', errorMessage: 'private' }, { items: null }, { items: [null] }]) {
    const search_places = createPlaceSearch({ getConfig: () => config, fetchImpl: async () => json(body) });
    await assert.rejects(search_places({ region: '강릉', keyword: '카페' }), (error) => error.code === 'INVALID_PLACES_RESPONSE');
  }
  const malformed = createPlaceSearch({ getConfig: () => config, fetchImpl: async () => new Response('{') });
  await assert.rejects(malformed({ region: '강릉', keyword: '카페' }), (error) => error.code === 'INVALID_PLACES_RESPONSE');
  const missing = createPlaceSearch({ getConfig: () => { throw new PlacesError(503, 'PLACES_NOT_CONFIGURED', '서버 인증 설정이 필요합니다.'); } });
  await assert.rejects(missing({ region: '강릉', keyword: '카페' }), (error) => error.code === 'PLACES_NOT_CONFIGURED');
});

test('timeouts and caller cancellation propagate without leaking native errors', async () => {
  const timeout = createPlaceSearch({ getConfig: () => config, fetchImpl: async () => { throw new DOMException('private', 'TimeoutError'); } });
  await assert.rejects(timeout({ region: '강릉', keyword: '카페' }), (error) => error.code === 'PLACES_TIMEOUT' && !error.message.includes('private'));
  const controller = new AbortController();
  controller.abort();
  const cancelled = createPlaceSearch({ getConfig: () => config, fetchImpl: async (_url, { signal }) => { signal.throwIfAborted(); } });
  await assert.rejects(cancelled({ region: '강릉', keyword: '카페' }, { signal: controller.signal }), (error) => error.name === 'AbortError');
});
