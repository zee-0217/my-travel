import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { createPlaceSearch } from '../src/services/naver-api-hub.js';
import { PlacesError } from '../src/lib/places-error.js';

async function serve(t, searchPlaces) {
  const server = createApp({ searchPlaces }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}/api/places`;
}

test('GET /api/places exposes normalized provider results without credentials or fabricated fields', async (t) => {
  const searchPlaces = createPlaceSearch({
    getConfig: () => ({ url: 'https://naverapihub.apigw.ntruss.com/search/v1/local', headers: { 'X-NCP-APIGW-API-KEY': 'private-test-secret' } }),
    fetchImpl: async () => new Response(JSON.stringify({ total: 1, items: [{ title: '<b>카페</b>', category: '음식점>카페', address: '강릉', roadAddress: '', mapx: '1289475239', mapy: '377724092', rating: 5 }] })),
  });
  const url = await serve(t, searchPlaces);
  const response = await fetch(`${url}?${new URLSearchParams({ region: '강릉', keyword: '카페' })}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.equal(result.places[0].name, '카페');
  assert.equal(result.places[0].coordinates.longitude, 128.9475239);
  assert.equal(result.places[0].coordinates.latitude, 37.7724092);
  assert.ok(!JSON.stringify(result).includes('private-test-secret'));
  assert.equal(Object.hasOwn(result.places[0], 'rating'), false);
  for (const query of ['region=강릉', 'region=강릉&keyword=카페&display=6', 'region=강릉&region=부산&keyword=카페']) {
    const invalid = await fetch(`${url}?${query}`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'INVALID_PLACE_QUERY');
  }
});

test('GET /api/places returns safe errors instead of upstream details', async (t) => {
  const url = await serve(t, async () => { throw new PlacesError(503, 'PLACES_NOT_CONFIGURED', '서버에 NAVER API HUB 인증 정보를 설정해 주세요.'); });
  const response = await fetch(`${url}?region=강릉&keyword=카페`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'PLACES_NOT_CONFIGURED');
});
