import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTourDetails, matchTourPlace, normalizeOpeningHours } from '../src/services/tour-api.js';
import { buildAgentPlan } from '../src/agents/agent-result.js';
import { validatePlanInput } from '../src/agents/plan-schema.js';

const date = '2026-11-24';
const place = { name: '부산 호텔', address: '부산광역시 해운대구 해운대로 1', category: '숙박>호텔', coordinates: { longitude: 129.16, latitude: 35.16 } };
const candidate = { title: place.name, addr1: place.address, mapx: '129.16', mapy: '35.16', contentid: '123', contenttypeid: '32' };
const source = 'https://www.data.go.kr/data/15101578/openapi.do';
const now = () => new Date('2026-11-24T03:00:00Z');
const response = (items) => new Response(JSON.stringify({ response: { header: { resultCode: '0000' }, body: { items: { item: items } } } }));

test('official hours only validate simple regular schedules; holidays and seasonal/overnight hours stay unconfirmed', () => {
  assert.equal(normalizeOpeningHours('09:00~18:00', '연중무휴', date, source, now().toISOString()).status, 'confirmed');
  assert.deepEqual(normalizeOpeningHours('09:00~18:00', '매주 화요일 휴무', date, source, now().toISOString()).intervals, []);
  for (const [hours, rest] of [['09:00~18:00','공휴일 휴무'], ['동절기 09:00~17:00','연중무휴'], ['22:00~02:00','연중무휴'], ['09:00~18:00','']]) assert.equal(normalizeOpeningHours(hours, rest, date, source, now().toISOString()).status, 'published');
});

test('TourAPI match requires unique same-name place plus real address or nearby coordinates', () => {
  assert.equal(matchTourPlace(place, [candidate]), candidate);
  assert.equal(matchTourPlace(place, [candidate, candidate]), null);
  assert.equal(matchTourPlace(place, [{ ...candidate, title: '다른 호텔' }]), null);
  assert.equal(matchTourPlace(place, [{ ...candidate, addr1: '제주도', mapx: '126.5', mapy: '33.5' }]), null);
});

test('free TourAPI exposes reference prices and facility count without inventing dated offers or inventory', async () => {
  const calls = [];
  const lookup = createTourDetails({ getKey: () => 'private%2Bkey', now, fetchImpl: async (url) => {
    calls.push(url.pathname); assert.equal(url.hostname, 'apis.data.go.kr'); assert.equal(url.searchParams.get('serviceKey'), 'private+key');
    if (url.pathname.endsWith('searchKeyword2')) return response([candidate]);
    if (url.pathname.endsWith('detailIntro2')) return response([{ roomcount: '80', checkintime: '15:00', checkouttime: '11:00' }]);
    return response([{ roomtitle: '트윈', roomoffseasonminfee1: '100,000', roomoffseasonminfee2: '0', roompeakseasonminfee1: '' }]);
  } });
  const details = await lookup({ place, date });
  assert.equal(details.available, true); assert.equal(calls.length, 3);
  assert.equal(details.publishedRates.length, 1); assert.equal(details.publishedRates[0].amount, 100000);
  assert.equal(details.publishedRates[0].status, 'published_reference'); assert.equal(details.facilities.roomCountText, '80');
  const input = validatePlanInput({ region: '부산', startDate: date, duration: 2, travelers: 2, budget: 500000, preferences: [], transport: 'car', requests: '' });
  const ref = { callId: 'search', index: 0 };
  const records = new Map([['search', { name: 'search_places', ok: true, result: { places: [place], query: '부산 호텔' } }], ['details', { name: 'get_place_details', ok: true, args: { place, date }, result: details }]]);
  const draft = { title: '부산', summary: '여행', budgetCallId: null, replanReason: null, warnings: [], lodgings: [{ placeRef: ref, nightIndexes: [0], reason: '관광지 주변', webSourceUrls: [] }], days: [0,1].map(() => ({ title: '여행', stops: [{ time: '10:00', endTime: '11:00', category: '휴식', title: place.name, description: '쉬기', stay: '체류', placeRef: ref, routeCallId: null }] })) };
  const plan = buildAgentPlan(JSON.stringify(draft), input, records, [], []);
  assert.equal(plan.lodgings.candidates[0].price.status, 'unknown'); assert.equal(plan.lodgings.candidates[0].availability.status, 'unknown');
  assert.equal(plan.lodgings.candidates[0].publishedRates[0].amount, 100000); assert.equal(plan.total, null);
  assert.ok(!JSON.stringify(details).includes('private'));
});

test('unconfigured key and ambiguous entity never fabricate facts; raw upstream errors stay private', async () => {
  const missing = await createTourDetails({ getKey: () => '', fetchImpl: () => { throw new Error('must not call'); } })({ place, date });
  assert.equal(missing.reason, 'TOUR_NOT_CONFIGURED');
  const ambiguous = await createTourDetails({ getKey: () => 'key', fetchImpl: async () => response([candidate,candidate]) })({ place, date });
  assert.equal(ambiguous.available, false);
  await assert.rejects(createTourDetails({ getKey: () => 'secret', fetchImpl: async () => { throw new Error('secret URL'); } })({ place, date }), (error) => error.code === 'TOUR_UNAVAILABLE' && !error.message.includes('secret'));
});
