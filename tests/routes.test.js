import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRouteLookup } from '../src/services/naver-maps.js';
import { ToolError } from '../src/lib/tool-error.js';

const input = { start: { longitude: 128.8785, latitude: 37.7782 }, goal: { longitude: 128.8986, latitude: 37.754 } };
const config = { directions5Url: 'https://maps.apigw.ntruss.com/map-direction/v1/driving', headers: { 'x-ncp-apigw-api-key-id': 'private-maps-id', 'x-ncp-apigw-api-key': 'private-maps-secret' } };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('get_routes uses NEW Maps driving URL with longitude/latitude and converts meters/milliseconds', async () => {
  const get_routes = createRouteLookup({ getConfig: () => config, fetchImpl: async (url, options) => {
    assert.equal(url.origin + url.pathname, config.directions5Url);
    assert.equal(url.searchParams.get('start'), '128.8785,37.7782');
    assert.equal(url.searchParams.get('goal'), '128.8986,37.754');
    assert.equal(url.searchParams.get('option'), 'traoptimal');
    assert.equal(options.headers['x-ncp-apigw-api-key-id'], 'private-maps-id');
    assert.equal(options.headers['x-ncp-apigw-api-key'], 'private-maps-secret');
    assert.equal(options.redirect, 'error');
    return response({ code: 0, route: { traoptimal: [{ summary: { distance: 4321, duration: 750000 }, path: [[128.8785, 37.7782], [128.8986, 37.754]] }] } });
  } });
  const result = await get_routes(input);
  assert.equal(result.available, true);
  assert.equal(result.distanceMeters, 4321);
  assert.equal(result.distanceKm, 4.321);
  assert.equal(result.durationMs, 750000);
  assert.equal(result.durationMinutes, 12.5);
  assert.deepEqual(result.path, [[128.8785, 37.7782], [128.8986, 37.754]]);
  assert.ok(!JSON.stringify(result).includes('private-maps'));
});

test('API business failures, including HTTP 400, return unavailable without inventing a route', async () => {
  for (const code of [1, 2, 3, 4, 5]) {
    const get_routes = createRouteLookup({ getConfig: () => config, fetchImpl: async () => response({ code, message: 'private upstream message' }, 400) });
    const result = await get_routes(input);
    assert.equal(result.available, false);
    assert.equal(result.providerCode, code);
    assert.equal(result.distanceMeters, null);
    assert.equal(result.durationMs, null);
    assert.match(result.message, /확인 불가/);
    assert.ok(!result.message.includes('private'));
  }
  const empty = createRouteLookup({ getConfig: () => config, fetchImpl: async () => response({ code: 0, route: { traoptimal: [] } }) });
  assert.equal((await empty(input)).available, false);
});

test('walking, public transit and identical points never call Maps', async () => {
  let calls = 0;
  const get_routes = createRouteLookup({ getConfig: () => { calls++; return config; } });
  for (const mode of ['walking', 'transit']) {
    const result = await get_routes({ ...input, mode });
    assert.equal(result.available, false);
    assert.equal(result.reason, 'UNSUPPORTED_MODE');
    assert.equal(result.durationMs, null);
  }
  assert.equal((await get_routes({ start: input.start, goal: input.start })).reason, 'SAME_LOCATION');
  assert.equal(calls, 0);
});

test('invalid, swapped, missing and API HUB integer coordinates are rejected', async () => {
  let calls = 0;
  const get_routes = createRouteLookup({ getConfig: () => { calls++; return config; } });
  for (const start of [null, { longitude: null, latitude: null }, { longitude: 1288785000, latitude: 377782000 }, { longitude: 37.77, latitude: 128.87 }, { longitude: '128.87', latitude: 37.77 }, { longitude: 0, latitude: 0 }]) {
    await assert.rejects(get_routes({ ...input, start }), (error) => error.code === 'INVALID_ROUTE_COORDINATES');
  }
  assert.equal(calls, 0);
});

test('bad responses, authentication, quotas, missing settings and timeouts produce safe errors', async () => {
  for (const [status, code] of [[401, 'MAPS_AUTH_ERROR'], [403, 'MAPS_AUTH_ERROR'], [429, 'MAPS_QUOTA_ERROR'], [500, 'MAPS_UPSTREAM_ERROR']]) {
    const get_routes = createRouteLookup({ getConfig: () => config, fetchImpl: async () => response({ message: 'private-maps-secret' }, status) });
    await assert.rejects(get_routes(input), (error) => error.code === code && !error.message.includes('private-maps-secret'));
  }
  for (const body of [{ code: 0 }, { code: 0, route: { traoptimal: [{ summary: { distance: -1, duration: 100 } }] } }, { code: 0, route: { traoptimal: [{ summary: { distance: 100, duration: null } }] } }]) {
    const get_routes = createRouteLookup({ getConfig: () => config, fetchImpl: async () => response(body) });
    await assert.rejects(get_routes(input), (error) => error.code === 'INVALID_ROUTE_RESPONSE');
  }
  const missing = createRouteLookup({ getConfig: () => { throw new ToolError(503, 'MAPS_NOT_CONFIGURED', '인증 설정이 필요합니다.'); } });
  await assert.rejects(missing(input), (error) => error.code === 'MAPS_NOT_CONFIGURED');
  const timeout = createRouteLookup({ getConfig: () => config, fetchImpl: async () => { throw new DOMException('private', 'TimeoutError'); } });
  await assert.rejects(timeout(input), (error) => error.code === 'ROUTES_TIMEOUT');
});

test('caller abort is propagated', async () => {
  const controller = new AbortController();
  controller.abort();
  const get_routes = createRouteLookup({ getConfig: () => config, fetchImpl: async (_url, { signal }) => { signal.throwIfAborted(); } });
  await assert.rejects(get_routes(input, { signal: controller.signal }), (error) => error.name === 'AbortError');
});
