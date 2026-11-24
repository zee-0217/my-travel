import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {createStatelessStores} from '../src/services/stateless-sessions.js';
import {rememberPlan} from '../src/agents/plan-context.js';
import {createApp} from '../src/app.js';
import {createAgentPlanner} from '../src/agents/agent-loop.js';
import {exportTrip} from '../public/js/saved-trips.js';

const secret=randomBytes(32).toString('base64');
test('independent instances recover authenticated encrypted contexts without a database',()=>{
  const first=createStatelessStores({secret}),second=createStatelessStores({secret});
  const plan=rememberPlan({title:'비공개 여행',days:[]},{draft:{title:'비공개 여행'},records:new Map([['call',{name:'search_places',result:{places:[{name:'실제 장소'}]}}]]),sources:new Map()});
  const saved=first.planStore.save(plan); assert.ok(saved.sessionToken.startsWith('v1.')); assert.ok(!saved.sessionToken.includes('실제 장소'));
  const loaded=second.planStore.get(saved.planId,saved.sessionToken); assert.ok(loaded.context.records instanceof Map); assert.equal(loaded.context.records.get('call').result.places[0].name,'실제 장소');
  const search=first.placeSelections.save({places:[{name:'실제 장소'}]}); assert.equal(second.placeSelections.get(search.searchId,search.searchToken).places[0].name,'실제 장소');
  assert.throws(()=>second.planStore.get(saved.planId,search.searchToken),error=>error.code==='PLAN_EXPIRED');
});
test('tampering, wrong keys/namespaces, expired tokens and forged IDs are rejected',()=>{
  let now=1000;const stores=createStatelessStores({secret,now:()=>now,ttlMs:100}); const saved=stores.planStore.save({title:'여행'});
  const token=saved.sessionToken; const altered=token.slice(0,40)+(token[40]==='a'?'b':'a')+token.slice(41);
  assert.throws(()=>stores.planStore.get(saved.planId,altered));
  assert.throws(()=>createStatelessStores({secret:randomBytes(32).toString('base64')}).planStore.get(saved.planId,token));
  assert.throws(()=>createStatelessStores({secret,namespace:'different'}).planStore.get(saved.planId,token));
  assert.throws(()=>stores.planStore.get('00000000-0000-4000-8000-000000000000',token));
  now=1100;assert.throws(()=>stores.planStore.get(saved.planId,token),error=>error.code==='PLAN_EXPIRED');
});
test('HTTP plan/search tokens support cross-instance place additions and chat, and are excluded from JSON exports',async(t)=>{
  const point={name:'선택한 장소',address:'부산 테스트',category:'카페',coordinates:{longitude:129.1,latitude:35.1}};
  const generate=createAgentPlanner({getModel:()=> 'test-model',maxReplans:0,getClient:()=>({responses:{create:async()=>({status:'completed',output:[],output_text:JSON.stringify({title:'부산 여행',summary:'여행',warnings:[],budgetCallId:null,replanReason:null,lodgings:[],days:[{title:'하루',stops:[{time:'10:00',endTime:'11:00',category:'관광',title:'자유 관광',description:'관광',stay:'여유',placeRef:null,routeCallId:null}]}]})})}})});
  let edited=false;
  async function serve(){const server=createApp({runtimeStores:createStatelessStores({secret}),generatePlan:generate,searchPlaces:async()=>({query:'부산 카페',returnedCount:1,places:[point]}),revisePlan:async(_input,{edit})=>{edited=true;assert.ok(edit.context.records instanceof Map);return edit.plan;}}).listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));return `http://127.0.0.1:${server.address().port}`;}
  const a=await serve(),b=await serve(),post=(base,path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const input={region:'부산',startDate:'2026-12-01',duration:1,travelers:2,budget:300000,preferences:[],transport:'car',requests:''};
  const {plan}=await(await post(a,'/api/plan',input)).json();assert.ok(plan.sessionToken);
  const search=await(await fetch(b+'/api/places?region=부산&keyword=카페')).json();assert.ok(search.searchToken);
  const response=await post(b,'/api/plan/places',{planId:plan.planId,sessionToken:plan.sessionToken,searchId:search.searchId,searchToken:search.searchToken,index:0,dayIndex:0,time:'12:00',endTime:'13:00'});assert.equal(response.status,200);
  const {plan:updated}=await response.json();assert.equal(updated.days[0].stops[1].title,point.name);
  const json=exportTrip(updated);assert.ok(!json.includes(updated.sessionToken));assert.ok(!json.includes('sessionToken'));
  assert.equal((await post(a,'/api/plan/revise',{planId:updated.planId,sessionToken:updated.sessionToken,request:'현재 일정 유지',targetDay:null})).status,200);assert.equal(edited,true);
});
