import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { buildAgentPlan } from '../src/agents/agent-result.js';
import { rememberPlan } from '../src/agents/plan-context.js';
import { validatePlanInput } from '../src/agents/plan-schema.js';
import { createPlanStore } from '../src/services/plan-store.js';
import { createPlaceSelections } from '../src/services/place-selections.js';
import { appendLocalPlace } from '../public/js/add-place.js';
import { parseMoney } from '../public/js/money-input.js';

const input = validatePlanInput({ region: '부산', startDate: '2026-12-01', duration: 2, travelers: 2, budget: 800000, preferences: [], transport: 'car', requests: '' });
const places = [0,1,2].map((index) => ({ name: `검색 장소 ${index}`, address: `부산 ${index}`, roadAddress: '', category: '관광', coordinates: { longitude: 129.1 + index * .01, latitude: 35.1 }, link: null }));
const draft = { title: '부산 여행', summary: '여행', budgetCallId: null, replanReason: null, lodgings: [], warnings: [], days: [0,1].map(() => ({ title: '여행', stops: [0,1].map((index) => ({ time: index ? '13:00' : '10:00', endTime: index ? '14:00' : '11:00', category: '관광', title: places[index].name, description: '관광', stay: '휴식', placeRef: { callId: 'original', index }, routeCallId: index ? null : 'road' })) })) };
const records = new Map([['original', { name: 'search_places', ok: true, result: { query: '부산 관광', places: places.slice(0,2) } }], ['road', { name: 'get_routes', ok: true, args: { start: places[0].coordinates, goal: places[1].coordinates, mode: 'driving' }, result: { available: true, durationMs: 600000, distanceMeters: 1000, path: [[129.1,35.1],[129.11,35.1]] } }]]);
function makePlan() { return rememberPlan(buildAgentPlan(JSON.stringify(draft), input, records, [], []), { records, sources: new Map(), draft }); }

test('adding a real standalone search result preserves Agent context, invalidates old leg and revalidates without an LLM', async (t) => {
  let revisions = 0;
  const planStore = createPlanStore();
  const app = createApp({ planStore, generatePlan: async () => makePlan(), searchPlaces: async () => ({ query: '부산 관광', places: [places[2]], returnedCount: 1 }), revisePlan: async (_input, { edit }) => {
    revisions++; assert.ok([...edit.context.records.values()].some((record) => record.result.places?.some((place) => place.name === places[2].name))); return edit.plan;
  } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const original = (await (await post('/api/plan', input)).json()).plan;
  const search = await (await fetch(base + '/api/places?region=부산&keyword=관광')).json();
  const addition = { planId: original.planId, searchId: search.searchId, index: 0, dayIndex: 0, time: '11:30', endTime: '12:30', place: { name: '위조 장소', price: 1 } };
  const response = await post('/api/plan/places', addition); assert.equal(response.status, 200);
  const { plan } = await response.json();
  assert.equal(plan.days[0].stops[1].title, places[2].name); assert.equal(plan.days[0].stops[0].route, null);
  assert.deepEqual(plan.days[1], original.days[1]); assert.equal(plan.total, null); assert.equal(plan.validation.stopReason, 'MANUAL_PLACE_ADDED');
  assert.equal(planStore.get(original.planId).plan.days[0].stops.length, 2); assert.notEqual(plan.planId, original.planId);
  assert.equal((await post('/api/plan/places', { ...addition, planId: plan.planId })).status, 400);
  assert.equal((await post('/api/plan/places', { ...addition, searchId: 'forged-search' })).status, 410);
  assert.equal((await post('/api/plan/revise', { planId: plan.planId, request: '추가 장소를 포함해서 동선을 정리해 줘', targetDay: 0 })).status, 200); assert.equal(revisions, 1);
});
test('local saved-plan additions preserve the input, invalidate route and costs, reject duplicates and bad times', () => {
  const plan = makePlan();
  const options = { dayIndex: 0, time: '10:30', endTime: '12:00' };
  const next = appendLocalPlace(plan, places[2], '부산 관광', options);
  assert.equal(plan.days[0].stops.length, 2); assert.equal(next.days[0].stops.length, 3); assert.equal(next.days[0].stops[0].route, null);
  assert.equal(next.days[0].stops[1].place.coordinates.longitude, places[2].coordinates.longitude);
  assert.ok(next.validation.issues.some((issue) => issue.code === 'TIME_OVERLAP')); assert.equal(next.total, null);
  assert.throws(() => appendLocalPlace(next, places[2], '', options), /이미/);
  assert.throws(() => appendLocalPlace(plan, places[2], '', { ...options, endTime: '09:00' }), /시각/);
});
test('selection cache expires and formatted budget remains an integer for the server', () => {
  let time = 0; const store = createPlaceSelections({ now: () => time, ttlMs: 10 }); const id = store.save({ places }); time = 11; assert.throws(() => store.get(id), (error) => error.code === 'SEARCH_EXPIRED');
  assert.equal(parseMoney('1,200,000'), 1200000); assert.equal(parseMoney('800000'), 800000); assert.ok(Number.isNaN(parseMoney('hello')));
});
