import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAgentPlanner } from '../src/agents/agent-loop.js';
import { calculate_budget } from '../src/tools/calculate-budget.js';
import { PlacesError } from '../src/lib/places-error.js';
import { safeNarrative } from '../src/agents/agent-result.js';
import { validatePlanInput } from '../src/agents/plan-schema.js';
import { ToolError } from '../src/lib/tool-error.js';

const input = { region: '강릉', startDate: '2026-12-01', duration: 1, travelers: 2, budget: 300000, preferences: ['휴식'], transport: 'car', requests: '' };
const points = [{ longitude: 128.87, latitude: 37.77 }, { longitude: 128.89, latitude: 37.75 }];
const places = { query: '강릉 카페', returnedCount: 2, places: points.map((coordinates, i) => ({ name: `확인 장소 ${i}`, coordinates })) };
const searchArgs = { region: '강릉', keyword: '카페', display: 5, sort: 'random' };
const routeArgs = { start: points[0], goal: points[1], mode: 'driving', option: 'traoptimal' };
const budgetArgs = { totalBudget: 999, items: ['food', 'accommodation', 'transport', 'activities'].map((category) => ({ category, label: category, amount: 10000, status: 'confirmed', source: '모델이 주장한 가격' })) };
const call = (name, args, id = name) => ({ type: 'function_call', id: `item_${id}`, call_id: id, name, arguments: JSON.stringify(args) });
const result = (output) => ({ status: 'completed', output });
const finalObject = () => ({ title: '강릉 여행', summary: '여유로운 일정입니다.', warnings: [], budgetCallId: null, days: [{ title: '쉬어가는 하루', stops: ['10:00', '12:00', '14:00', '16:00'].map((time, index) => ({ time, category: '휴식', title: `장소 유형 ${index}`, description: '천천히 둘러보세요.', stay: '여유롭게 머무르기', placeRef: null, routeCallId: null })) }] });
const final = (value = finalObject()) => ({ status: 'completed', output: [], output_text: JSON.stringify(value) });

function planner(queue, tools = {}, extra = {}) {
  const requests = [];
  const create = async (params, options) => {
    requests.push(structuredClone(params));
    const next = queue.shift();
    assert.ok(next, 'Unexpected extra LLM request');
    return typeof next === 'function' ? next(params, options) : structuredClone(next);
  };
  return { generate: createAgentPlanner({ getClient: () => ({ responses: { create } }), getModel: () => 'test-model', tools, maxReplans: 0, maxIterations: 8, maxToolCalls: 16, timeoutMs: 5000, ...extra }), requests };
}

test('details tool resolves only real searched references and applies official hours to the final validation', async () => {
  const value = finalObject(); value.days[0].stops = value.days[0].stops.slice(0, 1);
  value.days[0].stops[0].placeRef = { callId: 'places', index: 0 };
  value.days[0].stops[0].endTime = '11:00';
  let executed = 0;
  const { generate } = planner([
    result([call('get_place_details', { placeRef: { callId: 'invented', index: 0 }, date: input.startDate }, 'invalid')]),
    result([call('search_places', searchArgs, 'places')]),
    result([call('get_place_details', { placeRef: { callId: 'places', index: 0 }, date: input.startDate }, 'details')]), final(value),
  ], { search_places: async () => places, get_place_details: async (args) => {
    executed++; assert.deepEqual(args.place, places.places[0]);
    return { available: true, placeName: args.place.name, publishedRates: [], openingHours: { status: 'confirmed', date: input.startDate, text: '12:00~18:00', intervals: [{ open: '12:00', close: '18:00' }], sourceUrl: 'https://www.data.go.kr/data/15101578/openapi.do', checkedAt: '2026-11-24T03:00:00Z' } };
  } });
  const plan = await generate(input); assert.equal(executed, 1);
  assert.equal(plan.trace[0].executed, false); assert.equal(plan.trace.at(-1).tool, 'get_place_details');
  assert.equal(plan.days[0].stops[0].openingHours.status, 'confirmed');
  assert.ok(plan.validation.issues.some((issue) => issue.actionable && issue.code.includes('OPENING')));
});

test('model may finish without executing any tool, unknown prices/times remain unknown', async () => {
  const value = finalObject();
  value.summary = '입장료 10000원, 이동 30분';
  const { generate, requests } = planner([final(value)]);
  const plan = await generate(input);
  assert.deepEqual(plan.trace, []);
  assert.equal(plan.total, null);
  assert.equal(plan.remaining, null);
  assert.equal(plan.days[0].stops[0].transfer, '이동 시간 확인 불가');
  assert.ok(!plan.summary.includes('10000'));
  assert.ok(!plan.summary.includes('30분'));
  assert.equal(requests[0].tool_choice, 'auto');
});

test('only selected calculate_budget runs; invented prices are stripped and totalBudget is server controlled', async () => {
  const value = finalObject(); value.budgetCallId = 'budget';
  let executed = 0;
  const { generate, requests } = planner([result([call('calculate_budget', budgetArgs, 'budget')]), final(value)], { calculate_budget: (args) => { executed++; return calculate_budget(args); } });
  const plan = await generate(input);
  assert.equal(executed, 1);
  assert.equal(plan.budgetCalculation.totalBudget, input.budget);
  assert.equal(plan.budgetCalculation.unknownCount, 4);
  assert.equal(plan.total, null);
  assert.deepEqual(plan.trace.map((entry) => entry.tool), ['calculate_budget']);
  const sent = requests[1].input.find((item) => item.type === 'function_call_output');
  assert.equal(sent.call_id, 'budget');
  assert.equal(JSON.parse(sent.output).callId, 'budget');
  assert.equal(JSON.parse(sent.output).ok, true);
});

test('multi-round dependency loop preserves reasoning/output and displays only matching verified route', async () => {
  const value = finalObject();
  value.days[0].stops[0].placeRef = { callId: 'places', index: 0 };
  value.days[0].stops[1].placeRef = { callId: 'places', index: 1 };
  value.days[0].stops[0].routeCallId = 'route';
  value.days[0].stops[2].routeCallId = 'route'; // wrong endpoints must not be reused
  const reasoning = { type: 'reasoning', id: 'rs_test', summary: [] };
  const { generate, requests } = planner([result([reasoning, call('search_places', searchArgs, 'places')]), result([call('get_routes', routeArgs, 'route')]), final(value)], {
    search_places: async () => places,
    get_routes: async () => ({ available: true, distanceMeters: 1234, durationMs: 120000, path: [[128.87, 37.77], [128.89, 37.75]] }),
  });
  const plan = await generate(input);
  assert.deepEqual(requests[1].input[1], reasoning);
  assert.ok(requests[2].input.some((item) => item.type === 'function_call_output' && item.call_id === 'route'));
  assert.equal(plan.days[0].stops[0].title, '확인 장소 0');
  assert.match(plan.days[0].stops[0].transfer, /2분/);
  assert.equal(plan.days[0].stops[0].place.source.name, 'NAVER API HUB 지역 검색');
  assert.equal(plan.days[0].stops[0].route.path.length, 2);
  const routeFeedback = requests[2].input.find((item) => item.type === 'function_call_output' && item.call_id === 'route');
  assert.equal(JSON.parse(routeFeedback.output).result.path, undefined);
  assert.equal(JSON.parse(routeFeedback.output).result.pathPointCount, 2);
  assert.equal(plan.days[0].stops[2].transfer, '이동 시간 확인 불가');
  assert.deepEqual(plan.trace.map((entry) => entry.tool), ['search_places', 'get_routes']);
});

test('tool errors are fed back to model; successful retry is traced separately', async () => {
  let attempts = 0;
  const { generate, requests } = planner([result([call('search_places', searchArgs, 'fail')]), result([call('search_places', searchArgs, 'retry')]), final()], {
    search_places: async () => { if (++attempts === 1) throw new PlacesError(429, 'PLACES_RATE_LIMIT', '검색 한도 초과'); return places; },
  });
  const plan = await generate(input);
  const feedback = requests[1].input.find((item) => item.type === 'function_call_output');
  assert.equal(JSON.parse(feedback.output).error.code, 'PLACES_RATE_LIMIT');
  assert.deepEqual(plan.trace.map((entry) => entry.status), ['error', 'success']);
});

test('missing references recover only unique exact searched names and matching route endpoints', async () => {
  const value = finalObject(); value.days[0].stops[0].title = '확인 장소 0'; value.days[0].stops[1].title = '확인 장소 1';
  const { generate } = planner([result([call('search_places', searchArgs, 'places')]), result([call('get_routes', routeArgs, 'route')]), final(value)], {
    search_places: async () => places,
    get_routes: async () => ({ available: true, distanceMeters: 1000, durationMs: 120000, path: [[128.87, 37.77], [128.89, 37.75]] }),
  });
  const plan = await generate(input);
  assert.equal(plan.days[0].stops[0].place.name, '확인 장소 0');
  assert.equal(plan.days[0].stops[0].route.path.length, 2);
  const ambiguous = { ...places, places: [{ name: '확인 장소 0', coordinates: points[0] }, { name: '확인 장소 0', coordinates: points[1] }] };
  const second = planner([result([call('search_places', searchArgs)]), final(value)], { search_places: async () => ambiguous });
  assert.equal((await second.generate(input)).days[0].stops[0].place, null);
});

test('unknown tools, malformed arguments and invented coordinates never reach real functions', async () => {
  let executed = 0;
  const { generate } = planner([result([call('shell', {}, 'evil'), { ...call('search_places', {}, 'badjson'), arguments: '{' }, call('get_routes', routeArgs, 'unverified')]), final()], {
    search_places: () => { executed++; }, get_routes: () => { executed++; },
  });
  const plan = await generate(input);
  assert.equal(executed, 0);
  assert.ok(plan.trace.every((entry) => entry.status === 'error'));
  assert.equal(plan.trace[0].tool, 'unknown_tool');
});

test('native web_search calls and real source metadata are traced and returned', async () => {
  const { generate } = planner([{ ...final(), output: [{ type: 'web_search_call', id: 'ws', status: 'completed', action: { type: 'search', sources: [{ url: 'https://example.com/tourism', title: '관광 안내' }, { url: 'javascript:alert(1)' }] } }] }]);
  const plan = await generate(input);
  assert.equal(plan.trace[0].tool, 'web_search');
  assert.equal(plan.sources.length, 1);
  assert.equal(plan.sources[0].url, 'https://example.com/tourism');
});

test('iteration/tool limits stop additional execution and preserve completed trace', async () => {
  const repeated = [result([call('search_places', searchArgs, 'first')]), result([call('search_places', searchArgs, 'second')])];
  const oneRound = planner(structuredClone(repeated), { search_places: async () => places }, { maxIterations: 2 });
  await assert.rejects(oneRound.generate(input), (error) => error.code === 'AGENT_ITERATION_LIMIT' && error.trace.length === 1);
  let executed = 0;
  const oneTool = planner(structuredClone(repeated), { search_places: async () => { executed++; return places; } }, { maxToolCalls: 1 });
  await assert.rejects(oneTool.generate(input), (error) => error.code === 'AGENT_TOOL_LIMIT' && error.trace.length === 1);
  assert.equal(executed, 1);
});

test('LLM failures redact raw messages while retaining prior tool trace', async () => {
  const { generate } = planner([result([call('search_places', searchArgs)]), () => { throw Object.assign(new Error('private-api-key'), { status: 429 }); }], { search_places: async () => places });
  await assert.rejects(generate(input), (error) => error.code === 'AI_RATE_LIMIT' && error.trace.length === 1 && !error.message.includes('private-api-key'));
});

test('last iteration finalizes with existing evidence rather than forcing more tool calls', async () => {
  const { generate, requests } = planner([result([call('search_places', searchArgs)]), final()], { search_places: async () => places }, { maxIterations: 2 });
  const plan = await generate(input);
  assert.equal(requests[0].tool_choice, 'auto');
  assert.equal(requests[1].tool_choice, 'none');
  assert.equal(plan.trace.length, 1);
  assert.match(plan.warnings.at(-1), /제한/);
});

test('abort is propagated and no further tools run', async () => {
  const controller = new AbortController();
  controller.abort();
  const { generate, requests } = planner([final()]);
  await assert.rejects(generate(input, { signal: controller.signal }));
  assert.equal(requests.length, 0);
});

test('overall deadline aborts pending LLM request', async () => {
  const { generate } = planner([(_params, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true }))], {}, { timeoutMs: 10 });
  // Keep Node alive while testing AbortSignal.timeout's unref timer.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(generate(input), (error) => error.code === 'AI_TIMEOUT'); }
  finally { clearTimeout(keepAlive); }
});

test('unordered times produce validation problems while invented output price fields are rejected', async () => {
  const unordered = finalObject(); unordered.days[0].stops[1].time = '09:00';
  const invalidPlan = await planner([final(unordered)]).generate(input);
  assert.ok(invalidPlan.validation.issues.some((issue) => issue.code === 'TIME_ORDER'));
  const invented = finalObject(); invented.budget = { food: 10000 };
  await assert.rejects(planner([final(invented)]).generate(input), (error) => error.code === 'INVALID_AI_RESPONSE');
});

test('narrative citations remain readable and never become invented prices or links', () => {
  const text = safeNarrative('관광 안내 [공식 안내](https://example.com/tourism), 10000원, 이동 30분');
  assert.match(text, /공식 안내/);
  assert.ok(!text.includes('https://'));
  assert.ok(!text.includes('10000'));
  assert.ok(!text.includes('30분'));
});

test('rain feedback lets the model select indoor search and replace the outdoor plan within daily cap', async () => {
  const args = { region: input.region, date: input.startDate, location: null };
  const value = finalObject();
  value.days[0].stops = value.days[0].stops.slice(0, 2);
  value.days[0].stops[0].placeRef = { callId: 'indoor', index: 0 };
  const { generate, requests } = planner([
    result([call('get_weather', args, 'weather')]),
    (params) => {
      const feedback = params.input.find((item) => item.type === 'function_call_output');
      assert.equal(JSON.parse(feedback.output).result.rainExpected, true);
      return result([call('search_places', { ...searchArgs, keyword: '실내 박물관' }, 'indoor')]);
    }, final(value),
  ], {
    get_weather: async () => ({ ...args, available: true, rainExpected: true, indoorSuggested: true }),
    search_places: async (args) => ({ ...places, query: args.keyword, places: [{ name: '검색된 실내 박물관', coordinates: points[0] }] }),
  });
  const plan = await generate({ ...input, maxPlacesPerDay: 2, requests: '비가 오면 실내에서 쉬고 싶어요.' });
  assert.deepEqual(plan.trace.map((entry) => entry.tool), ['get_weather', 'search_places']);
  assert.equal(plan.days[0].weather.rainExpected, true);
  assert.equal(plan.days[0].stops[0].title, '검색된 실내 박물관');
  assert.equal(plan.days[0].stops.length, 2);
  assert.equal(requests[0].tool_choice, 'auto');
});

test('weather unavailable or upstream error remains unknown and does not force other tools', async () => {
  for (const weather of [async (args) => ({ date: args.date, available: false, reason: 'OUTSIDE_FORECAST_RANGE', rainExpected: null }), async () => { throw new ToolError(503, 'WEATHER_AUTH_ERROR', '날씨 인증 설정 확인'); }]) {
    const { generate } = planner([result([call('get_weather', { region: input.region, date: input.startDate, location: null })]), final()], { get_weather: weather });
    const plan = await generate(input);
    assert.equal(plan.days[0].weather.available, false);
    assert.equal(plan.days[0].weather.rainExpected, null);
    assert.deepEqual(plan.trace.map((entry) => entry.tool), ['get_weather']);
  }
});

test('weather scope and invented coordinates are rejected before weather execution', async () => {
  let calls = 0;
  const { generate } = planner([result([
    call('get_weather', { region: '부산', date: input.startDate, location: null }, 'wrong-city'),
    call('get_weather', { region: input.region, date: '2027-01-01', location: null }, 'wrong-date'),
    call('get_weather', { region: input.region, date: input.startDate, location: points[0] }, 'invented'),
  ]), final()], { get_weather: () => { calls++; } });
  assert.equal((await generate(input)).trace.length, 3);
  assert.equal(calls, 0);
});

test('legitimate 제주/제주도/제주시 weather aliases use the original input region', async () => {
  const next = { ...input, region: '제주도' };
  const { generate } = planner([result([call('get_weather', { region: '제주시', date: input.startDate, location: null }, 'weather')]), final()], { get_weather: async (args) => {
    assert.equal(args.region, '제주도');
    return { region: args.region, date: args.date, available: false, reason: 'NOT_CONFIGURED' };
  } });
  const plan = await generate(next);
  assert.equal(plan.trace[0].status, 'unavailable');
  assert.equal(plan.days[0].weather.reason, 'NOT_CONFIGURED');
});

test('actual driving time checks flag exceeded limits and unknown legs without inventing durations', async () => {
  const value = finalObject();
  value.days[0].stops[0].placeRef = { callId: 'places', index: 0 };
  value.days[0].stops[1].placeRef = { callId: 'places', index: 1 };
  const { generate, requests } = planner([result([call('search_places', searchArgs, 'places')]), result([call('get_routes', routeArgs, 'route')]), final(value)], {
    search_places: async () => places, get_routes: async () => ({ available: true, distanceMeters: 5000, durationMs: 3600000, path: [] }),
  });
  const plan = await generate({ ...input, maxTravelMinutesPerLeg: 30, maxTravelMinutesPerDay: 45 });
  assert.equal(plan.days[0].travelConstraints.status, 'exceeded');
  assert.equal(plan.days[0].travelConstraints.unknownLegs, 2);
  assert.equal(plan.days[0].travelConstraints.knownDurationMinutes, 60);
  const feedback = requests[2].input.find((item) => item.type === 'function_call_output' && item.call_id === 'route');
  assert.equal(JSON.parse(feedback.output).result.exceedsPerLegLimit, true);
  assert.ok(plan.warnings.some((text) => /제한을 초과/.test(text)));
  const noRoutes = await planner([final()]).generate({ ...input, maxTravelMinutesPerDay: 90 });
  assert.equal(noRoutes.days[0].travelConstraints.status, 'unknown');
});

test('daily visit and travel limits validate input and final stop count', async () => {
  const normalized = validatePlanInput(input);
  assert.equal(normalized.maxPlacesPerDay, 4);
  assert.equal(normalized.maxTravelMinutesPerLeg, null);
  for (const patch of [{ maxPlacesPerDay: 0 }, { maxPlacesPerDay: 7 }, { maxTravelMinutesPerLeg: -1 }, { maxTravelMinutesPerDay: 601 }, { maxTravelMinutesPerDay: '90' }]) assert.throws(() => validatePlanInput({ ...input, ...patch }));
  const invalidPlan = await planner([final()]).generate({ ...input, maxPlacesPerDay: 2 });
  assert.ok(invalidPlan.validation.issues.some((issue) => issue.code === 'TOO_MANY_PLACES'));
});

test('validation feeds problems to LLM, allows selective new tool calls, and records actual edits', async () => {
  const bad = finalObject();
  const fixed = finalObject(); fixed.days[0].stops = fixed.days[0].stops.slice(0, 2);
  fixed.days[0].stops[0].placeRef = { callId: 'replacement', index: 0 };
  fixed.days[0].stops[0].endTime = '11:00'; fixed.days[0].stops[1].endTime = '13:00';
  fixed.replanReason = '방문 수를 줄이고 쉬어갈 장소로 변경했습니다.';
  const { generate, requests } = planner([final(bad), (params) => {
    const feedback = JSON.parse(params.input.at(-1).content);
    assert.equal(feedback.type, 'itinerary_validation');
    assert.ok(feedback.issues.some((issue) => issue.code === 'TOO_MANY_PLACES'));
    assert.equal(params.tool_choice, 'auto');
    return result([call('search_places', searchArgs, 'replacement')]);
  }, final(fixed)], { search_places: async () => places }, { maxReplans: 2 });
  const plan = await generate({ ...input, maxPlacesPerDay: 2 });
  assert.equal(requests.length, 3);
  assert.equal(plan.validation.replanCount, 1);
  assert.equal(plan.validation.problemCount, 0);
  assert.equal(plan.validation.history.length, 2);
  assert.ok(plan.validation.repairs[0].changes.some((text) => /방문 수/.test(text)));
  assert.equal(plan.days[0].stops[0].title, '확인 장소 0');
  assert.deepEqual(plan.trace.map((entry) => entry.tool), ['search_places']);
});

test('overlapping intervals are repaired without forcing any tool; unknown facts do not trigger another loop', async () => {
  const bad = finalObject(); bad.days[0].stops = bad.days[0].stops.slice(0, 2);
  bad.days[0].stops[0].endTime = '13:00'; bad.days[0].stops[1].endTime = '14:00';
  const fixed = structuredClone(bad); fixed.days[0].stops[0].endTime = '11:00';
  const { generate, requests } = planner([final(bad), final(fixed)], {}, { maxReplans: 2 });
  const plan = await generate(input);
  assert.equal(plan.validation.history[0].problemCount, 1);
  assert.equal(plan.validation.problemCount, 0);
  assert.equal(plan.validation.status, 'needs_confirmation');
  assert.equal(requests.length, 2);
  assert.deepEqual(plan.trace, []);
  const unknownOnly = planner([final()], {}, { maxReplans: 2 });
  assert.equal((await unknownOnly.generate(input)).validation.replanCount, 0);
  assert.equal(unknownOnly.requests.length, 1);
});

test('replan and overall iteration limits return unresolved issues rather than claiming success', async () => {
  const bad = finalObject(); bad.days[0].stops[1].time = bad.days[0].stops[0].time;
  const bounded = planner([final(bad), final(bad)], {}, { maxReplans: 1 });
  const plan = await bounded.generate(input);
  assert.equal(bounded.requests.length, 2);
  assert.equal(plan.validation.stopReason, 'REPLAN_LIMIT');
  assert.equal(plan.validation.replanCount, 1);
  assert.ok(plan.validation.issues.some((issue) => issue.code === 'TIME_OVERLAP'));
  assert.equal(plan.validation.repairs[0].changes.length, 0);
  const oneIteration = planner([final(bad)], {}, { maxIterations: 1, maxReplans: 2 });
  assert.equal((await oneIteration.generate(input)).validation.stopReason, 'AGENT_LIMIT');
});

test('replan errors preserve last validated draft and redact private upstream messages', async () => {
  const bad = finalObject(); bad.days[0].stops[1].time = '10:00';
  const { generate } = planner([final(bad), () => { throw Object.assign(new Error('private-api-key'), { status: 429 }); }], {}, { maxReplans: 2 });
  const plan = await generate(input);
  assert.equal(plan.validation.stopReason, 'REPLAN_ERROR');
  assert.ok(plan.validation.problemCount > 0);
  assert.equal(plan.validation.failure.code, 'AI_RATE_LIMIT');
  assert.ok(!JSON.stringify(plan).includes('private-api-key'));
});

test('verified date-specific opening hours cause time repair; LLM cannot inject opening-hours facts', async () => {
  const bad = finalObject(); bad.days[0].stops = [bad.days[0].stops[0]];
  bad.days[0].stops[0].placeRef = { callId: 'place', index: 0 }; bad.days[0].stops[0].endTime = '11:00';
  const fixed = structuredClone(bad); fixed.days[0].stops[0].time = '14:00'; fixed.days[0].stops[0].endTime = '15:00';
  const { generate } = planner([result([call('search_places', searchArgs, 'place')]), final(bad), (params) => {
    const report = JSON.parse(params.input.at(-1).content);
    const conflict = report.issues.find((issue) => issue.code === 'OPENING_HOURS_CONFLICT');
    assert.deepEqual(conflict.intervals, [{ open: '13:00', close: '18:00' }]);
    return final(fixed);
  }], { search_places: async () => places }, { maxReplans: 2, getPlaceFacts: (_place, date) => ({ openingHours: { status: 'confirmed', date, checkedAt: '2026-11-24T00:00:00Z', sourceUrl: 'https://example.com/official', intervals: [{ open: '13:00', close: '18:00' }] } }) });
  const plan = await generate(input);
  assert.equal(plan.validation.problemCount, 0);
  assert.equal(plan.days[0].stops[0].time, '14:00');
  const fake = structuredClone(fixed); fake.days[0].stops[0].openingHours = { open: '00:00' };
  await assert.rejects(planner([final(fake)]).generate(input), (error) => error.code === 'INVALID_AI_RESPONSE');
});

test('rainy beach conflict prompts a selective indoor replacement search and keeps factual route linkage', async () => {
  const bad = finalObject(); bad.days[0].stops = [bad.days[0].stops[0]]; bad.days[0].stops[0].endTime = '11:00'; bad.days[0].stops[0].placeRef = { callId: 'beach', index: 0 };
  const fixed = structuredClone(bad); fixed.days[0].stops[0].placeRef = { callId: 'indoor', index: 0 };
  const { generate } = planner([
    result([call('get_weather', { region: input.region, date: input.startDate, location: null }, 'weather')]),
    result([call('search_places', { ...searchArgs, keyword: '해수욕장' }, 'beach')]), final(bad),
    (params) => { assert.ok(JSON.parse(params.input.at(-1).content).issues.some((issue) => issue.code === 'WEATHER_PLACE_CONFLICT')); return result([call('search_places', { ...searchArgs, keyword: '박물관' }, 'indoor')]); }, final(fixed),
  ], {
    get_weather: async (args) => ({ ...args, available: true, rainExpected: true, indoorSuggested: true }),
    search_places: async (args) => ({ query: args.keyword, returnedCount: 1, places: [{ name: args.keyword === '해수욕장' ? '검색된 해변' : '검색된 박물관', category: args.keyword, coordinates: points[0] }] }),
  }, { maxReplans: 2 });
  const plan = await generate(input);
  assert.equal(plan.validation.replanCount, 1);
  assert.equal(plan.validation.problemCount, 0);
  assert.equal(plan.days[0].stops[0].title, '검색된 박물관');
  assert.ok(plan.validation.issues.some((issue) => issue.code === 'PLACE_TYPE_UNKNOWN'));
  assert.deepEqual(plan.trace.map((entry) => entry.tool), ['get_weather', 'search_places', 'search_places']);
});
