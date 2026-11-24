import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLodgings, isLodging, straightLineMeters } from '../src/agents/lodging-result.js';
import { buildAgentPlan } from '../src/agents/agent-result.js';
import { validatePlanInput } from '../src/agents/plan-schema.js';
import { createAgentPlanner } from '../src/agents/agent-loop.js';
import { getPlanContext } from '../src/agents/plan-context.js';

const input = validatePlanInput({ region: '부산', startDate: '2027-01-01', duration: 2, travelers: 2, budget: 600000, lodgingBudget: 250000, lodgingType: 'hotel', preferences: ['관광'], transport: 'car' });
const hotelA = { name: '테스트 호텔 A', category: '숙박>호텔', roadAddress: '부산 A로 1', coordinates: { longitude: 129.10, latitude: 35.16 }, link: 'https://hotel-a.example/booking' };
const hotelB = { name: '테스트 호텔 B', category: '숙박>관광호텔', roadAddress: '부산 B로 1', coordinates: { longitude: 129.12, latitude: 35.17 } };
const poi = { name: '검색된 박물관', category: '관광>박물관', roadAddress: '부산 관광로 1', coordinates: { longitude: 129.11, latitude: 35.16 } };
const days = [{ date: input.startDate, stops: [{ title: poi.name, place: poi }] }, { date: '2027-01-02', stops: [{ title: poi.name, place: poi }] }];
const lodging = (index = 0, reason = '방문 장소와의 위치를 비교하기 좋은 후보입니다.') => ({ placeRef: { callId: 'hotels', index }, nightIndexes: [0], reason, webSourceUrls: [] });
const records = () => new Map([['hotels', { name: 'search_places', ok: true, result: { query: '부산 호텔', returnedCount: 2, places: structuredClone([hotelA, hotelB]) } }]]);
const routeRecord = (start, goal, minutes, available = true) => ({ name: 'get_routes', ok: true, args: { start, goal, mode: 'driving', option: 'traoptimal' }, result: { available, durationMs: available ? minutes * 60000 : null, distanceMeters: available ? minutes * 500 : null, path: available ? [[start.longitude, start.latitude], [goal.longitude, goal.latitude]] : [] } });
const build = (items = [lodging(), lodging(1)], options = {}) => buildLodgings(items, options.input || input, options.days || days, options.records || records(), options.sources || [], options.getFacts || (() => null), (value) => value);
const quote = (changes = {}) => ({ status: 'confirmed', currency: 'KRW', scope: 'entire_party_entire_stay', checkInDate: '2027-01-01', checkOutDate: '2027-01-02', travelers: 2, totalAmount: 200000, sourceUrl: 'https://official.example/rates', checkedAt: '2026-11-24T00:00:00Z', ...changes });

test('only actual lodging categories qualify; straight-line distance is computed from coordinates', () => {
  assert.equal(isLodging(hotelA), true);
  assert.equal(isLodging({ name: '호텔A', category: '호텔>레스토랑' }), false);
  assert.equal(isLodging({ name: '호텔A', category: '' }), false);
  assert.equal(straightLineMeters(hotelA.coordinates, hotelA.coordinates), 0);
  assert.ok(Math.abs(straightLineMeters({ longitude: 129, latitude: 35 }, { longitude: 129, latitude: 35.01 }) - 1112) < 3);
  assert.equal(straightLineMeters(null, poi.coordinates), null);
});

test('hotel to attraction driving comparisons use matching directional routes; missing values never become zero', () => {
  const actual = records();
  actual.set('forward', routeRecord(hotelA.coordinates, poi.coordinates, 15));
  actual.set('reverse', routeRecord(poi.coordinates, hotelB.coordinates, 2));
  const result = build(undefined, { records: actual });
  const a = result.candidates.find((stay) => stay.name === hotelA.name), b = result.candidates.find((stay) => stay.name === hotelB.name);
  assert.equal(a.comparisons[0].durationMs, 900000);
  assert.equal(b.comparisons[0].durationMs, null);
  assert.equal(b.comparisons[0].distanceMeters, null);
  assert.equal(a.comparisons[0].name, poi.name);
  assert.equal(a.price.totalAmount, null);
  assert.equal(a.bookingLink, null, 'NAVER detail URL is not a verified booking link');
  assert.equal(a.availability.status, 'unknown');
  const transit = build(undefined, { records: actual, input: { ...input, transport: 'transit' } });
  assert.ok(transit.candidates.every((stay) => stay.comparisons.every((row) => row.durationMs === null)));
});

test('unavailable routes, missing coordinates, invalid references and nonlodging results remain unconfirmed', () => {
  const actual = records(); actual.set('road', routeRecord(hotelA.coordinates, poi.coordinates, 0, false));
  actual.get('hotels').result.places.push(poi);
  const result = build([lodging(), lodging(2), { ...lodging(), placeRef: { callId: 'invented', index: 0 } }], { records: actual });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].comparisons[0].durationMs, null);
  assert.equal(result.candidates[0].comparisons[0].route.available, false);
  assert.ok(result.warnings.length > 0);
  const missing = records(); delete missing.get('hotels').result.places[0].coordinates;
  assert.equal(build([lodging()], { records: missing }).candidates[0].meanStraightLineMeters, null);
});

test('confirmed rates require exact dates, entire-party scope, party size and provenance', () => {
  const known = build([lodging()], { getFacts: () => ({ lodgingPrice: quote() }) }).candidates[0];
  assert.equal(known.price.totalAmount, 200000);
  assert.equal(known.budgetFit, 'within_lodging_cap');
  assert.equal(known.availability.status, 'unknown');
  for (const change of [{ travelers: 1 }, { checkInDate: '2027-01-02' }, { scope: 'per_room_per_night' }, { sourceUrl: 'javascript:alert(1)' }, { checkedAt: '' }]) assert.equal(build([lodging()], { getFacts: () => ({ lodgingPrice: quote(change) }) }).candidates[0].price.status, 'unknown');
  const over = build([lodging()], { getFacts: () => ({ lodgingPrice: quote({ totalAmount: 300000 }) }) }).candidates[0];
  assert.equal(over.budgetFit, 'over_lodging_cap');
});

test('only server-verified official booking records produce a booking link, never model or search URLs', () => {
  const booking = { status: 'confirmed', kind: 'official_booking', url: 'https://official.example/reservations', sourceUrl: 'https://official.example/about', checkedAt: '2026-11-24T00:00:00Z' };
  assert.equal(build([lodging()], { getFacts: () => ({ officialBooking: booking }) }).candidates[0].bookingLink.url, booking.url);
  for (const change of [{ kind: 'search_guess' }, { status: 'unknown' }, { url: 'javascript:alert(1)' }, { sourceUrl: '' }]) assert.equal(build([lodging()], { getFacts: () => ({ officialBooking: { ...booking, ...change } }) }).candidates[0].bookingLink, null);
});

test('booking promises and unverified price claims in model recommendation reasons are discarded', () => {
  const result = build([lodging(0, '예약 가능하며 최저가 50000원으로 예산 이내입니다.')]);
  assert.ok(!result.candidates[0].reason.includes('50000'));
  assert.ok(!result.candidates[0].reason.includes('예약 가능'));
  assert.equal(result.candidates[0].price.status, 'unknown');
});

test('web references must be actual native source URLs and match the lodging entity', () => {
  const item = lodging(); item.webSourceUrls = ['https://source.example/hotel-a', 'https://invented.example/price'];
  const sources = [{ url: item.webSourceUrls[0], title: '테스트 호텔 A 공식 시설 안내' }];
  const result = build([item], { sources });
  assert.equal(result.candidates[0].publicSources.length, 1);
  assert.equal(result.candidates[0].bookingLink, null);
});

test('day trips and disabled recommendations skip lodging; dates and budget controls validate', () => {
  assert.equal(build(undefined, { input: { ...input, duration: 1 } }).status, 'not_needed');
  assert.equal(build(undefined, { input: { ...input, lodgingMode: 'none' } }).candidates.length, 0);
  assert.equal(build([{ ...lodging(), nightIndexes: [1] }]).candidates.length, 0);
  assert.equal(build([lodging(), lodging()]).candidates.length, 1);
  for (const change of [{ lodgingBudget: -1 }, { lodgingBudget: 700000 }, { lodgingBudget: '100000' }, { lodgingType: 'invented' }, { lodgingMode: true }]) assert.throws(() => validatePlanInput({ ...input, ...change }));
});

test('Agent selects real NAVER search and two driving calls to compare lodging alternatives', async () => {
  const output = { title: '부산 여행', summary: '일정과 숙소를 비교합니다.', warnings: [], replanReason: null, budgetCallId: null, lodgings: [lodging(), lodging(1)], days: [0, 1].map(() => ({ title: '관광하는 날', stops: [{ time: '10:00', endTime: '11:00', category: '관광', title: poi.name, description: '관람 계획', stay: '여유롭게', placeRef: { callId: 'poi', index: 0 }, routeCallId: null }] })) };
  const call = (name, args, call_id) => ({ status: 'completed', output: [{ type: 'function_call', id: `item-${call_id}`, name, arguments: JSON.stringify(args), call_id }] });
  const queue = [call('search_places', { region: '부산', keyword: '박물관', display: 1, sort: 'random' }, 'poi'), call('search_places', { region: '부산', keyword: '호텔', display: 2, sort: 'random' }, 'hotels'), ...[hotelA, hotelB].map((hotel, i) => call('get_routes', { start: hotel.coordinates, goal: poi.coordinates, mode: 'driving', option: 'traoptimal' }, `road-${i}`)), { status: 'completed', output: [], output_text: JSON.stringify(output) }];
  const generate = createAgentPlanner({ getClient: () => ({ responses: { create: async () => { const next = queue.shift(); assert.ok(next); return next; } } }), getModel: () => 'test-model', maxReplans: 0, tools: {
    search_places: async (args) => ({ query: `부산 ${args.keyword}`, returnedCount: args.display, places: args.keyword === '호텔' ? [hotelA, hotelB] : [poi] }),
    get_routes: async (args) => routeRecord(args.start, args.goal, args.start.longitude === hotelA.coordinates.longitude ? 10 : 20).result,
  } });
  const result = await generate(input);
  assert.equal(result.lodgings.candidates.length, 2);
  assert.deepEqual(result.trace.map((entry) => entry.tool), ['search_places', 'search_places', 'get_routes', 'get_routes']);
  assert.equal(result.lodgings.candidates.find((stay) => stay.name === hotelA.name).comparisons[0].durationMs, 600000);
  assert.equal(result.total, null, 'alternative quotes are not added to the budget');
  assert.equal(result.days[0].stops.length, 1, 'hotels are not injected into daily visit counts');
  const context = getPlanContext(result);
  assert.equal(context.draft.lodgings.length, 2);
  const malformed = structuredClone(output); malformed.lodgings[0].price = 10000;
  assert.throws(() => buildAgentPlan(JSON.stringify(malformed), input, context.records, [], []));
});
