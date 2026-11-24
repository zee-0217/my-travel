import { env } from '../src/config/env.js';
import { search_places } from '../src/services/naver-api-hub.js';
import { get_place_details } from '../src/services/tour-api.js';
import { kstDate } from '../src/services/kma-weather.js';

console.log(JSON.stringify({ tourKeySaved: Boolean(env.tourism.serviceKey) }));
if (!env.tourism.serviceKey) process.exit(1);
let successes = 0;
for (const [region, keyword] of [['서울 종로구', '경복궁 고궁'], ['부산', '파라다이스호텔 부산']]) {
  try {
    const search = await search_places({ region, keyword, display: 3, sort: 'random' });
    let matched = false;
    for (const place of search.places.slice(0, 3)) {
      const result = await get_place_details({ place, date: kstDate(new Date()) });
      console.log(JSON.stringify({ place: place.name, available: result.available, reason: result.reason || null, openingHours: result.openingHours, publishedRateCount: result.publishedRates.length, facilities: result.facilities, source: result.source }));
      if (result.available) { matched = true; successes++; break; }
    }
    if (!matched) console.log(JSON.stringify({ region, keyword, matched: false }));
  } catch (error) {
    console.log(JSON.stringify({ region, code: error.code || 'LOOKUP_FAILED', message: error.code ? error.message : '공개정보 조회 실패' }));
  }
}
if (successes !== 2) process.exitCode = 1;
