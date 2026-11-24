import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRedisRest } from '../src/services/redis-rest.js';
import { createSharedStores, createRuntimeStores } from '../src/services/runtime-stores.js';
import { createApiLimits } from '../src/middleware/api-limits.js';
import app, { app as namedApp, createApp } from '../src/app.js';
import { rememberPlan } from '../src/agents/plan-context.js';
import { createAgentPlanner } from '../src/agents/agent-loop.js';

function fakeRedis() {
  const data = new Map(), commands = [];
  return { data, commands, assertConfigured() {}, async command(args) {
    commands.push(args);
    if (args[0] === 'SET') { data.set(args[1], args[2]); return 'OK'; }
    if (args[0] === 'GET') return data.get(args[1]) ?? null;
    if (args[0] === 'EVAL') { const count = Number(data.get(args[3]) || 0) + 1; data.set(args[3], count); return count; }
    throw new Error('Unknown command');
  } };
}
async function serve(t, app) { const server = app.listen(0,'127.0.0.1'); await once(server,'listening'); t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); })); return `http://127.0.0.1:${server.address().port}`; }
test('Vercel default export and CDN security configuration preserve a private backend and a public frontend', async () => {
  assert.equal(app, namedApp);
  const config = JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.equal(config.framework,'express'); assert.equal(config.functions['src/app.js'].maxDuration,300);
  const csp = config.headers[0].headers.find((header) => header.key === 'Content-Security-Policy').value;
  assert.ok(csp.includes('https://oapi.map.naver.com')); assert.ok(!csp.includes('http:')); assert.ok(!Object.hasOwn(config,'env'));
  assert.ok(config.headers.some((rule) => rule.source === '/api/(.*)' && rule.headers[0].value === 'no-store'));
});
test('independent server instances recover private Map contexts and actual search evidence through TTL-bound Redis', async () => {
  const redis = fakeRedis(), first = createSharedStores(redis), second = createSharedStores(redis);
  const plan = rememberPlan({ title: '부산', days: [] }, { draft: { title: '부산' }, records: new Map([['search',{ name:'search_places', result:{ places:[{name:'확인 장소'}] } }]]), sources:new Map([['source',{url:'https://example.com'}]]) });
  const saved = await first.planStore.save(plan), loaded = await second.planStore.get(saved.planId);
  assert.ok(loaded.context.records instanceof Map); assert.ok(loaded.context.sources instanceof Map); assert.equal(loaded.context.records.get('search').result.places[0].name,'확인 장소');
  assert.equal(Object.hasOwn(saved,'context'),false);
  const id = await first.placeSelections.save({places:[{name:'실제 검색'}]}); assert.equal((await second.placeSelections.get(id)).places[0].name,'실제 검색');
  assert.ok(redis.commands.filter((command) => command[0] === 'SET').every((command) => command[3] === 'EX' && command[4] === 1800));
  redis.data.clear(); await assert.rejects(second.planStore.get(saved.planId),(error) => error.code === 'PLAN_EXPIRED');
});
test('Redis credentials stay in server Authorization headers; failures never disclose tokens or URLs', async () => {
  const redis = createRedisRest({ url:'https://private-endpoint.upstash.io', token:'private-redis-token', fetchImpl:async (url, options) => { assert.equal(options.headers.Authorization,'Bearer private-redis-token'); assert.deepEqual(JSON.parse(options.body),['GET','session']); return Response.json({result:null}); } });
  assert.equal(await redis.command(['GET','session']),null);
  for (const status of [401,403,429,500]) await assert.rejects(createRedisRest({url:'https://private-endpoint.upstash.io',token:'secret',fetchImpl:async()=>new Response('private token',{status})}).command(['GET','session']),(error) => error.code === 'SESSION_STORE_UNAVAILABLE' && !/private|secret/.test(error.message));
  const missing = createRuntimeStores({deployment:{vercel:true},redis:{url:'',token:'',namespace:'test'}}); assert.throws(()=>missing.assertReady(),(error)=>error.code==='SESSION_STORE_NOT_CONFIGURED');
});
test('production global request counters work across app instances and reject excess calls with Retry-After', async (t) => {
  const redis = fakeRedis(), options = {redis,enabled:true,aiLimit:1,apiLimit:2,namespace:'test',now:()=>10000};
  let calls=0;
  const baseA = await serve(t,createApp({apiLimits:createApiLimits(options),generatePlan:async()=>{calls++;return {title:'여행'};}}));
  const baseB = await serve(t,createApp({apiLimits:createApiLimits(options),generatePlan:async()=>{calls++;return {title:'여행'};}}));
  const input={region:'부산',startDate:'2026-12-01',duration:1,travelers:2,budget:300000,preferences:[],transport:'car',requests:''};
  const request=(base)=>fetch(base+'/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal((await request(baseA)).status,200); const limited=await request(baseB); assert.equal(limited.status,429); assert.ok(Number(limited.headers.get('retry-after'))>0); assert.equal((await limited.json()).error.code,'APP_RATE_LIMIT'); assert.equal(calls,1);
});
test('a plan generated on one instance is editable on another without exposing its context to the browser', async (t) => {
  const redis=fakeRedis();
  const generate=createAgentPlanner({getModel:()=> 'test-model',maxReplans:0,getClient:()=>({responses:{create:async()=>({status:'completed',output:[],output_text:JSON.stringify({title:'부산',summary:'여행',warnings:[],budgetCallId:null,replanReason:null,lodgings:[],days:[{title:'하루',stops:[{time:'10:00',endTime:'11:00',category:'관광',title:'관광 제안',description:'여행',stay:'휴식',placeRef:null,routeCallId:null}]}]})})}})});
  const baseA=await serve(t,createApp({runtimeStores:createSharedStores(redis),generatePlan:generate}));
  let edited=false;
  const baseB=await serve(t,createApp({runtimeStores:createSharedStores(redis),revisePlan:async(_input,{edit})=>{edited=true;assert.ok(edit.context.records instanceof Map);assert.equal(edit.context.draft.title,'부산');return edit.plan;}}));
  const input={region:'부산',startDate:'2026-12-01',duration:1,travelers:2,budget:300000,preferences:[],transport:'car',requests:''};
  const post=(base,path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const {plan}=await(await post(baseA,'/api/plan',input)).json(); assert.ok(plan.planId); assert.equal(Object.hasOwn(plan,'context'),false);
  assert.equal((await post(baseB,'/api/plan/revise',{planId:plan.planId,request:'현재 일정 유지',targetDay:null})).status,200); assert.equal(edited,true);
});
