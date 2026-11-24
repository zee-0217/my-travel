import assert from 'node:assert/strict';
import { search_places } from '../src/services/naver-api-hub.js';

// Explicit live integration check. No Express, OpenAI, or browser is involved.
// Keep this filename outside Node's automatic test-file patterns.
const region = process.argv[2] || '강릉';
const keywords = process.argv.slice(3);
if (!keywords.length) keywords.push('관광지', '음식점', '카페');

try {
  for (const keyword of keywords) {
    const result = await search_places({ region, keyword, display: 3 });
    assert.equal(result.source, 'NAVER API HUB');
    assert.ok(result.places.length <= 3);
    for (const place of result.places) {
      assert.equal(typeof place.name, 'string');
      assert.ok(!Object.hasOwn(place, 'rating') && !Object.hasOwn(place, 'price') && !Object.hasOwn(place, 'openingHours'));
      if (place.coordinates.longitude !== null) {
        assert.ok(Math.abs(place.coordinates.longitude) <= 180);
        assert.ok(Math.abs(place.coordinates.latitude) <= 90);
      }
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  // Only the service's safe error message is shown; never print request headers.
  console.error(JSON.stringify({ code: error.code || 'LIVE_SEARCH_FAILED', message: error.code ? error.message : '독립 검색 검사를 완료하지 못했습니다.' }));
  process.exitCode = 1;
}
