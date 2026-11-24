import assert from 'node:assert/strict';
import { get_routes } from '../src/services/naver-maps.js';

// Fixed decimal-degree points near roads: Ojukheon -> Gangneung Central Market.
const start = { longitude: 128.8785, latitude: 37.7782 };
const goal = { longitude: 128.8986, latitude: 37.7540 };
try {
  const result = await get_routes({ start, goal });
  assert.equal(result.mode, 'driving');
  if (result.available) {
    assert.ok(result.distanceMeters > 0);
    assert.ok(result.durationMs > 0);
    assert.equal(result.distanceKm, result.distanceMeters / 1000);
    assert.equal(result.durationMinutes, result.durationMs / 60000);
  } else {
    assert.equal(result.distanceMeters, null);
    assert.equal(result.durationMs, null);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ code: error.code || 'ROUTES_LIVE_FAILED', message: error.code ? error.message : '자동차 경로 확인 불가' }));
  process.exitCode = 1;
}
