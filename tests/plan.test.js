import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import OpenAI from 'openai';
import { createApp } from '../src/app.js';
import { createTravelPlanner } from '../src/agents/travel-planner.js';
import { validatePlanInput } from '../src/agents/plan-schema.js';
import { PlanError } from '../src/lib/plan-error.js';

const input = { region: '강릉', startDate: '2026-12-31', duration: 1, travelers: 2, budget: 300000, preferences: ['자연', '맛집'], transport: 'car', requests: '부모님과 함께, 걷는 코스는 짧게' };
const output = {
  title: '강릉에서 보내는 여유로운 하루', summary: '부모님과 짧게 걷고 쉬는 여행입니다.',
  days: [{ title: '바다와 함께 쉬어가기', stops: ['10:00', '12:00', '14:00', '16:00'].map((time, index) => ({ time, category: '휴식', title: `방문 장소 ${index + 1}`, description: '천천히 쉬어가세요.', stay: '약 60분', transfer: index === 3 ? '이날 일정 마무리' : '자동차 약 20분 · 추정' })) }],
  budget: { accommodation: 0, food: 100000, transport: 40000, activities: 20000, note: '전원 기준 추정액입니다. 출발지 왕복 교통비는 별도입니다.' },
  warnings: ['영업 여부와 실제 이동 시간은 확인하지 않았습니다.'],
};

function apiResponse(value = output, status = 'completed') {
  const final = value === output ? { title: output.title, summary: output.summary, warnings: output.warnings, budgetCallId: null, days: output.days.map((day) => ({ ...day, stops: day.stops.map(({ transfer, ...stop }) => ({ ...stop, placeRef: null, routeCallId: null })) })) } : value;
  return { id: 'resp_test', object: 'response', status, output: [{ id: 'msg_test', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(final), annotations: [] }] }] };
}

async function serve(t, generatePlan) {
  const server = createApp({ generatePlan }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}/api/plan`;
}

test('POST /api/plan uses official SDK Responses and returns only normalized plan data', async (t) => {
  let sent;
  const client = new OpenAI({ apiKey: 'test-server-secret', maxRetries: 0, fetch: async (url, options) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify(apiResponse()), { headers: { 'Content-Type': 'application/json' } });
  } });
  const generatePlan = createTravelPlanner({ getClient: () => client, getModel: () => 'test-model' });
  const url = await serve(t, generatePlan);
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, model: 'untrusted-model', tools: ['web_search'], apiKey: 'untrusted-key' }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(sent.model, 'test-model');
  assert.equal(sent.store, false);
  assert.equal(sent.text.format.type, 'json_schema');
  assert.equal(sent.text.format.strict, true);
  assert.deepEqual(sent.tools.map((tool) => tool.name || tool.type), ['get_place_details', 'get_weather', 'search_places', 'get_routes', 'calculate_budget', 'web_search']);
  assert.equal(sent.tool_choice, 'auto');
  assert.deepEqual(JSON.parse(sent.input[0].content), validatePlanInput(input));
  assert.equal(body.plan.title, output.title);
  assert.equal(body.plan.days[0].date, input.startDate);
  assert.equal(body.plan.isSample, false);
  assert.equal(body.plan.total, null);
  assert.equal(body.plan.remaining, null);
  assert.equal(body.plan.budgetCalculation, null);
  assert.ok(body.plan.costs.every((cost) => cost.status === 'unknown'));
  assert.deepEqual(body.plan.trace, []);
  assert.equal(body.plan.validation.status, 'needs_confirmation');
  assert.equal(body.plan.validation.replanCount, 0);
  assert.ok(!JSON.stringify(body).includes('test-server-secret'));
  assert.ok(!JSON.stringify(body).includes('resp_test'));
});

test('HTTP Responses integration repairs overlapping drafts and exposes validation history', async (t) => {
  let rounds = 0;
  const draft = { title: '시간 검증', summary: '여유로운 여행', warnings: [], budgetCallId: null, replanReason: null, days: [{ title: '하루', stops: ['10:00', '11:00'].map((time) => ({ time, endTime: time === '10:00' ? '12:00' : '13:00', title: '장소 유형', category: '휴식', description: '쉬어가기', stay: '계획상 체류', placeRef: null, routeCallId: null })) }] };
  const client = new OpenAI({ apiKey: 'test-server-secret', maxRetries: 0, fetch: async (_url, options) => {
    const sent = JSON.parse(options.body); rounds++;
    if (rounds === 2) {
      assert.equal(sent.tool_choice, 'auto');
      assert.equal(JSON.parse(sent.input.at(-1).content).type, 'itinerary_validation');
      draft.days[0].stops[0].endTime = '11:00';
      draft.replanReason = '체류 시간 중복을 해소했습니다.';
    }
    return new Response(JSON.stringify(apiResponse(draft)), { headers: { 'Content-Type': 'application/json' } });
  } });
  const url = await serve(t, createTravelPlanner({ getClient: () => client, getModel: () => 'test-model' }));
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const { plan } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(rounds, 2);
  assert.equal(plan.validation.replanCount, 1);
  assert.equal(plan.validation.problemCount, 0);
  assert.equal(plan.validation.history[0].issues.filter((issue) => issue.code === 'TIME_OVERLAP').length, 1);
  assert.ok(plan.validation.repairs[0].changes.some((text) => /방문/.test(text)));
});

test('invalid inputs, content types and malformed JSON never invoke OpenAI', async (t) => {
  let calls = 0;
  const url = await serve(t, async () => { calls++; });
  for (const change of [{ region: '' }, { startDate: '2026-02-30' }, { duration: 8 }, { travelers: 0 }, { budget: '300000' }, { requests: 'x'.repeat(501) }, { preferences: '自然' }, { transport: 'plane' }]) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, ...change }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_INPUT');
  }
  const malformed = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_REQUEST');
  const wrongType = await fetch(url, { method: 'POST', body: JSON.stringify(input) });
  assert.equal(wrongType.status, 415);
  assert.equal(calls, 0);
});

test('upstream failures and missing settings produce actionable errors without leaking secrets', async (t) => {
  const cases = [
    [new PlanError(503, 'AI_NOT_CONFIGURED', '서버 .env에 OPENAI_API_KEY와 OPENAI_MODEL을 설정해 주세요.'), 503, 'AI_NOT_CONFIGURED'],
    [Object.assign(new Error('private-test-server-secret'), { status: 401 }), 503, 'AI_AUTH_ERROR'],
    [Object.assign(new Error('private-test-server-secret'), { status: 404 }), 503, 'AI_MODEL_ERROR'],
    [Object.assign(new Error('private-test-server-secret'), { status: 429 }), 429, 'AI_RATE_LIMIT'],
    [Object.assign(new Error('private-test-server-secret'), { name: 'APIConnectionTimeoutError' }), 504, 'AI_TIMEOUT'],
    [new Error('private-test-server-secret'), 502, 'AI_UNAVAILABLE'],
  ];
  for (const [error, status, code] of cases) {
    const url = await serve(t, async () => { throw error; });
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.ok(!JSON.stringify(body).includes('private-test-server-secret'));
  }
});

test('refused, incomplete and malformed AI outputs are rejected', async () => {
  const responses = [
    [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private message' }] }] }, 'AI_REFUSAL'],
    [{ status: 'incomplete', output: [] }, 'AI_INCOMPLETE'],
    [{ status: 'completed', output_text: '{' }, 'INVALID_AI_RESPONSE'],
    [{ status: 'completed', output_text: JSON.stringify({ ...output, days: [] }) }, 'INVALID_AI_RESPONSE'],
  ];
  for (const [response, code] of responses) {
    const generate = createTravelPlanner({ getClient: () => ({ responses: { create: async () => response } }), getModel: () => 'test-model' });
    await assert.rejects(generate(input), (error) => error.code === code);
  }
  assert.equal(validatePlanInput({ ...input, region: ' 강릉 ' }).region, '강릉');
});

test('disconnecting the browser aborts the SDK request', async (t) => {
  let started;
  let aborted;
  const didStart = new Promise((resolve) => { started = resolve; });
  const didAbort = new Promise((resolve) => { aborted = resolve; });
  const url = await serve(t, (_input, { signal }) => new Promise((_resolve, reject) => {
    started();
    signal.addEventListener('abort', () => { aborted(); reject(new Error('aborted')); }, { once: true });
  }));
  const controller = new AbortController();
  const request = fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal }).catch(() => {});
  await didStart;
  controller.abort();
  await request;
  await Promise.race([didAbort, new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('SDK request not aborted')), 2000); timer.unref(); })]);
});

test('Agent failure returns its actual completed trace through HTTP', async (t) => {
  const trace = [{ tool: 'search_places', executed: true, status: 'success', summary: '검색 결과 2개', iteration: 1 }];
  const url = await serve(t, async () => { const error = new PlanError(422, 'AGENT_ITERATION_LIMIT', '최대 반복 횟수에 도달했습니다.'); error.trace = trace; throw error; });
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(response.status, 422);
  assert.deepEqual((await response.json()).trace, trace);
});
