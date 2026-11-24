// Test the deployed app through its public origin, never by sending local API keys.
import assert from 'node:assert/strict';

const target = process.argv[2], live = process.argv.includes('--live');
let base;
try { base = new URL(target); if (base.username || base.password || base.search || base.hash || base.pathname !== '/' || base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost','127.0.0.1'].includes(base.hostname))) throw new Error(); }
catch { console.error('사용법: npm run test:deployment -- https://YOUR-PROJECT.vercel.app [--live]'); process.exit(1); }
const report = { origin: base.origin, environment: ['localhost','127.0.0.1'].includes(base.hostname) ? 'local_not_vercel' : 'remote', live, checks: [] };
const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
async function request(path, body) {
  const response = await fetch(new URL(path,base), { method: body ? 'POST' : 'GET', redirect: 'error', headers: { ...headers, ...(body ? { 'Content-Type':'application/json' } : {}) }, ...(body ? { body:JSON.stringify(body) } : {}), signal:AbortSignal.timeout(body && path === '/api/plan' ? 295000 : 35000) });
  if (!response.ok) { let code; try { code = (await response.json()).error?.code; } catch { /* Do not echo login pages or raw errors. */ } throw new Error(`${path}: HTTP ${response.status}${code ? ` ${code}` : ' (배포 보호·서비스 연결 확인)'}`); }
  return response;
}
async function check(name, work) { try { await work(); report.checks.push({name,status:'passed'}); } catch(error) { report.checks.push({name,status:'failed',message:error.message}); process.exitCode=1; } }
await check('frontend and security headers', async()=>{
  const response=await request('/'); assert.ok((await response.text()).includes('여행 한 조각')); assert.ok(response.headers.get('content-security-policy'));
  for(const path of ['/js/bootstrap.js','/css/styles.css','/images/favicon.svg']) assert.equal((await request(path)).status,200);
});
await check('private files excluded',async()=>{
  for(const path of ['/.env','/.env.production','/.git/config','/src/config/env.js','/package.json']) {
    const response=await fetch(new URL(path,base),{redirect:'error',headers,signal:AbortSignal.timeout(10000)}); assert.ok([403,404].includes(response.status),`${path} must not be public`);
  }
});
await check('server health and configuration only',async()=>{
  assert.equal((await(await request('/api/health')).json()).status,'ok');
  const status=await(await request('/api/status')).json(); assert.equal(status.checked,'configuration_only');
  report.configuredServices=status.services.map(({id,configured})=>({id,configured}));
});
if(live){
  let places;
  await check('NAVER API HUB actual search',async()=>{places=await(await request('/api/places?'+new URLSearchParams({region:'부산',keyword:'관광지',display:'5'}))).json();assert.ok(places.places.length>=2);});
  await check('NAVER Directions 5 actual driving route',async()=>{
    const points=places?.places.filter((place)=>Number.isFinite(place.coordinates?.longitude)&&Number.isFinite(place.coordinates?.latitude)).map((place)=>place.coordinates)||[];
    const goal=points.find((point)=>point.longitude!==points[0]?.longitude||point.latitude!==points[0]?.latitude); assert.ok(goal,'서로 다른 실제 검색 좌표가 필요합니다.');
    const {route}=await(await request('/api/routes',{start:points[0],goal,mode:'driving',option:'traoptimal'})).json(); assert.equal(route.available,true); assert.ok(route.durationMs>0); assert.ok(route.distanceMeters>0);
  });
  await check('OpenAI Responses actual plan and server-session place addition',async()=>{
    const startDate=new Date(Date.now()+(7*24+9)*3600000).toISOString().slice(0,10);
    const {plan}=await(await request('/api/plan',{region:'부산',startDate,duration:1,travelers:2,budget:300000,preferences:['관광'],transport:'car',requests:'여유로운 당일 관광을 두 곳 제안해 줘. 숙소는 필요 없어.',lodgingMode:'none',maxPlacesPerDay:4})).json(); assert.ok(plan.planId); assert.equal(plan.isSample,false); assert.equal(plan.days.length,1);
    const day=plan.days[0], index=places.places.findIndex((place)=>!day.stops.some((stop)=>stop.place?.name===place.name && (stop.place.roadAddress||stop.place.address)===(place.roadAddress||place.address)));
    assert.ok(index>=0,'추가할 서로 다른 검색 장소가 필요합니다.');
    const added=await(await request('/api/plan/places',{planId:plan.planId,searchId:places.searchId,index,dayIndex:0,time:'18:00',endTime:'19:00'})).json(); assert.ok(added.plan.days[0].stops.some((stop)=>stop.place?.name===places.places[index].name));
    report.agentTools=plan.trace.map(({tool,status})=>({tool,status}));
  });
}
report.mapsBrowserCheck='Web Dynamic Map의 인증·마커는 등록된 배포 도메인에서 브라우저로 별도 확인해야 합니다.';
console.log(JSON.stringify(report,null,2));
