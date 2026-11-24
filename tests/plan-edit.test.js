import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createAgentPlanner } from '../src/agents/agent-loop.js';
import { getPlanContext } from '../src/agents/plan-context.js';
import { createPlanStore } from '../src/services/plan-store.js';
import { createApp } from '../src/app.js';
import { editPlanSchema, mergePlanEdit } from '../src/agents/edit-plan.js';
import { validatePlanInput } from '../src/agents/plan-schema.js';
import { matchesSchema } from '../src/agents/tool-schemas.js';
import { calculate_budget } from '../src/tools/calculate-budget.js';

const input = validatePlanInput({ region: '부산', startDate: '2027-01-01', duration: 2, travelers: 2, budget: 500000, preferences: ['관광', '휴식'], transport: 'car', maxPlacesPerDay: 3, requests: '' });
const stop = (title = '장소 유형', time = '10:00', endTime = '11:00', ref = null) => ({ time, endTime, title, category: '휴식', description: '천천히 쉬어가는 제안', stay: '여유롭게 머무르기', placeRef: ref, routeCallId: null });
const draft = () => ({ title: '부산 여행', summary: '여유로운 여행입니다.', replanReason: null, warnings: [], budgetCallId: null, days: [{ title: '첫날', stops: [stop()] }, { title: '둘째 날', stops: [stop('전시 공간')] }] });
const conditionChanges = () => ({ budget: null, travelers: null, preferences: null, maxPlacesPerDay: null, maxTravelMinutesPerLeg: null, maxTravelMinutesPerDay: null, transport: null });
const patch = (dayIndex = 1, stops = [stop('다른 전시 공간', '14:00', '15:00')]) => ({ reason: '요청한 날짜의 방문 장소와 시각을 조정했습니다.', conditionChanges: conditionChanges(), budgetCallId: null, days: [{ dayIndex, title: '수정한 날', stops }] });
const final = (value) => ({ status: 'completed', output: [], output_text: JSON.stringify(value) });
const call = (name, args, id) => ({ status: 'completed', output: [{ type: 'function_call', id: `item_${id}`, call_id: id, name, arguments: JSON.stringify(args) }] });
function planner(queue, tools = {}, options = {}) {
  const requests = [];
  const generate = createAgentPlanner({ getClient: () => ({ responses: { create: async (params) => { requests.push(structuredClone(params)); const next = queue.shift(); assert.ok(next, 'unexpected LLM request'); return typeof next === 'function' ? next(params) : structuredClone(next); } } }), getModel: () => 'test-model', tools, maxReplans: 0, ...options });
  return { generate, requests };
}
const editOptions = (plan, request = '둘째 날 오후만 바꿔 줘', targetDay = 1) => ({ edit: { plan, context: getPlanContext(plan), request, targetDay } });

test('same Agent Loop receives current plan/request and preserves every untouched day exactly', async () => {
  const { generate, requests } = planner([final(draft()), final(patch())]);
  const original = await generate(input);
  const before = structuredClone(original);
  const edited = await generate(input, editOptions(original));
  assert.deepEqual(original, before);
  assert.deepEqual(edited.days[0], original.days[0]);
  assert.equal(edited.days[1].stops[0].time, '14:00');
  assert.equal(edited.validation.status, 'needs_confirmation');
  assert.deepEqual(edited.edit.unchangedDays, [0]);
  assert.ok(edited.edit.changes.length > 0);
  const sent = JSON.parse(requests[1].input[1].content);
  assert.equal(sent.request, '둘째 날 오후만 바꿔 줘');
  assert.deepEqual(sent.currentPlan, draft());
  assert.equal(requests[1].text.format.name, 'agent_plan_edit');
  assert.deepEqual(edited.trace, []);
});

test('saved search evidence can be reused for routes; replacing a place invalidates its old road geometry', async () => {
  const points = [{ longitude: 129.1, latitude: 35.1 }, { longitude: 129.2, latitude: 35.2 }, { longitude: 129.3, latitude: 35.3 }];
  const places = points.map((coordinates, index) => ({ name: `장소 ${index}`, address: `주소 ${index}`, category: '카페', coordinates }));
  const first = draft(); first.days[1].stops = [stop('첫 장소', '10:00', '11:00', { callId: 'places', index: 0 }), stop('둘째 장소', '13:00', '14:00', { callId: 'places', index: 1 })];
  first.days[1].stops[0].routeCallId = 'road';
  const replacement = patch(1, structuredClone(first.days[1].stops)); replacement.days[0].stops[1].placeRef.index = 2;
  const routeArgs = { start: points[0], goal: points[1], mode: 'driving', option: 'traoptimal' };
  const nextRouteArgs = { ...routeArgs, goal: points[2] };
  const withRoad = structuredClone(replacement); withRoad.days[0].stops[0].routeCallId = 'newroad';
  const { generate, requests } = planner([
    call('search_places', { region: '부산', keyword: '카페', display: 3, sort: 'random' }, 'places'), call('get_routes', routeArgs, 'road'), final(first),
    final(replacement), call('get_routes', nextRouteArgs, 'newroad'), final(withRoad),
  ], { search_places: async () => ({ query: '부산 카페', returnedCount: 3, places }), get_routes: async () => ({ available: true, distanceMeters: 1000, durationMs: 600000, path: [[129.1, 35.1], [129.2, 35.2]] }) });
  const original = await generate(input);
  const changed = await generate(input, editOptions(original));
  assert.equal(changed.days[1].stops[0].route, null);
  assert.equal(changed.days[0].stops[0].title, original.days[0].stops[0].title);
  const next = await generate(input, editOptions(changed, '새 구간의 경로를 확인해 줘'));
  assert.equal(next.days[1].stops[0].route.available, true);
  assert.deepEqual(next.trace.map((entry) => entry.tool), ['get_routes']);
  const evidence = JSON.parse(requests[3].input[1].content).evidence;
  assert.equal(evidence.find((entry) => entry.name === 'get_routes').result.path, undefined);
  assert.equal(evidence.find((entry) => entry.name === 'get_routes').result.pathPointCount, 2);
});

test('edit candidates are revalidated and repaired without losing another edited day', async () => {
  const initial = draft();
  const bad = patch(1, [stop('첫 방문', '10:00', '12:00'), stop('다음 방문', '11:00', '13:00')]);
  const fixed = patch(1, [stop('첫 방문', '10:00', '11:00'), stop('다음 방문', '12:00', '13:00')]);
  const { generate } = planner([final(initial), final(bad), (params) => { assert.equal(JSON.parse(params.input.at(-1).content).type, 'itinerary_validation'); return final(fixed); }], {}, { maxReplans: 2 });
  const original = await generate(input);
  const edited = await generate(input, editOptions(original));
  assert.equal(edited.validation.replanCount, 1);
  assert.equal(edited.validation.problemCount, 0);
  assert.deepEqual(edited.days[0], original.days[0]);
});

test('duplicate day patches, out-of-scope edits and invented facts never modify saved plans', () => {
  const original = draft();
  const duplicate = patch(); duplicate.days.push(duplicate.days[0]);
  assert.throws(() => mergePlanEdit(JSON.stringify(duplicate), original, input, null));
  assert.throws(() => mergePlanEdit(JSON.stringify(patch(0)), original, input, 1), (error) => error.code === 'EDIT_SCOPE_VIOLATION');
  const injected = patch(); injected.days[0].stops[0].openingHours = { open: '00:00' };
  assert.equal(matchesSchema(injected, editPlanSchema(2)), false);
  assert.deepEqual(original, draft());
});

test('supported condition edits are validated; region and travel dates cannot be changed by model', async () => {
  const change = patch(); change.conditionChanges.budget = 250000; change.conditionChanges.maxPlacesPerDay = 2;
  const { generate } = planner([final(draft()), final(change)]);
  const original = await generate(input);
  const edited = await generate(input, editOptions(original));
  assert.equal(edited.budget, 250000);
  assert.equal(edited.maxPlacesPerDay, 2);
  assert.equal(edited.region, input.region);
  assert.equal(edited.total, null);
  assert.ok(edited.edit.changes.some((text) => /총예산/.test(text)));
  const illegal = patch(); illegal.conditionChanges.region = '제주';
  assert.equal(matchesSchema(illegal, editPlanSchema(2)), false);
  const clear = patch(); clear.conditionChanges.maxTravelMinutesPerLeg = 0; clear.conditionChanges.preferences = ['쇼핑'];
  const merged = mergePlanEdit(JSON.stringify(clear), draft(), { ...input, maxTravelMinutesPerLeg: 30 }, null);
  assert.equal(merged.input.maxTravelMinutesPerLeg, null);
  assert.deepEqual(merged.input.preferences, ['쇼핑']);
});

test('bounded server snapshots expire and old snapshot stays available for edit after browser undo', async () => {
  let now = 0;
  const store = createPlanStore({ now: () => now, ttlMs: 100, maxEntries: 2 });
  const { generate } = planner([final(draft()), final(patch())]);
  const original = await generate(input), savedA = store.save(original);
  const edited = await generate(input, editOptions(original));
  const savedB = store.save(edited);
  assert.deepEqual(store.get(savedA.planId).plan.days, original.days);
  assert.deepEqual(store.get(savedB.planId).plan.days, edited.days);
  const modified = store.get(savedA.planId); modified.plan.days[0].stops[0].title = 'client edit';
  assert.notEqual(store.get(savedA.planId).plan.days[0].stops[0].title, 'client edit');
  now = 101;
  assert.throws(() => store.get(savedA.planId), (error) => error.code === 'PLAN_EXPIRED');
});

test('an inherited whole-trip budget is invalidated when places or conditions are changed', async () => {
  const initial = draft(); initial.budgetCallId = 'oldbudget';
  const update = patch(); update.budgetCallId = 'oldbudget';
  const args = { totalBudget: input.budget, items: ['food', 'accommodation', 'transport', 'activities'].map((category) => ({ category, label: category, amount: null, status: 'unknown', source: null })) };
  const known = calculate_budget({ totalBudget: input.budget, items: args.items.map((item) => ({ ...item, amount: 1000, status: 'confirmed', source: '테스트 전용 가격 근거' })) });
  const { generate } = planner([call('calculate_budget', args, 'oldbudget'), final(initial), final(update)], { calculate_budget: () => known });
  const original = await generate(input);
  assert.equal(original.total, 4000);
  const edited = await generate(input, editOptions(original));
  assert.equal(edited.total, null);
  assert.equal(edited.budgetCalculation, null);
});

test('snapshot capacity evicts oldest versions and invalid configuration fails promptly', () => {
  const store = createPlanStore({ maxEntries: 1 });
  const first = store.save({ title: '이전' });
  const second = store.save({ title: '현재' });
  assert.throws(() => store.get(first.planId), (error) => error.code === 'PLAN_EXPIRED');
  assert.equal(store.get(second.planId).plan.title, '현재');
  assert.throws(() => createPlanStore({ maxEntries: 0 }));
});

test('POST revise trusts only saved server plan, returns new version, and rejects malformed/missing sessions', async (t) => {
  const { generate } = planner([final(draft()), final(patch())]);
  const server = createApp({ generatePlan: generate, revisePlan: generate }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/plan`;
  const post = (path, body) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const { plan: original } = await (await post('', input)).json();
  const response = await post('/revise', { planId: original.planId, request: '둘째 날만 변경해 줘', targetDay: 1, currentPlan: { budget: 1, records: ['forged'] } });
  const { plan: updated } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.notEqual(updated.planId, original.planId);
  assert.equal(updated.budget, input.budget);
  assert.deepEqual(updated.days[0], original.days[0]);
  assert.ok(!Object.hasOwn(updated, 'records'));
  assert.ok(!Object.hasOwn(updated, 'draft'));
  for (const body of [{}, { planId: original.planId, request: ' ' }, { planId: original.planId, request: 'x'.repeat(1001) }, { planId: original.planId, request: '변경', targetDay: 6 }]) assert.equal((await post('/revise', body)).status, 400);
  assert.equal((await post('/revise', { planId: '00000000-0000-0000-0000-000000000000', request: '변경' })).status, 410);
  const invalid = await fetch(url + '/revise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal((await invalid.json()).error.code, 'INVALID_REQUEST');
});
