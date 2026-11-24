import assert from 'node:assert/strict';
import {createBrowserClient} from './browser-client.mjs';
if(!process.argv.includes('--live')){console.log('사용법: node scripts/audit-browser-deployment.mjs https://실제배포주소 --live (실제 API 사용량 발생)');process.exit(0);}
const base=new URL(process.argv[2]);if(base.protocol!=='https:'||base.username||base.password||base.search)throw new Error('배포 HTTPS 주소만 입력해 주세요.');
const browser=await createBrowserClient();
const report={url:base.origin,checks:[]};
try{
  await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await browser.command('Page.navigate',{url:base.origin});await browser.until("document.documentElement.dataset.appReady==='true'");
  await browser.evaluate("document.querySelector('#region-select').value='부산';document.querySelector('#region-select').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#duration').value='1';document.querySelector('#lodging-mode').value='none';document.querySelectorAll('[name=preferences]').forEach(input=>input.checked=input.value==='관광');document.querySelector('#requests').value='부산의 실제 검색된 관광지 두 곳을 여유롭게 여행하는 당일 일정으로, 두 곳 사이의 자동차 경로도 확인해 줘. 숙박은 필요 없어.'");
  await browser.click('#generate-button');await browser.until("!document.querySelector('#generate-button').disabled",290000);
  if(await browser.evaluate("!document.querySelector('#generation-error').hidden"))throw new Error(await browser.evaluate("document.querySelector('#error-message').textContent"));
  const {plan}=await browser.responseBody('/api/plan');assert.equal(plan.isSample,false);assert.ok(plan.sessionToken);assert.ok(plan.days[0].stops.some(stop=>stop.place));
  report.checks.push({name:'OpenAI Responses and real Agent tools',status:'passed',places:plan.days[0].stops.filter(stop=>stop.place).length,tools:plan.trace.map(({tool,status})=>({tool,status}))});
  await browser.until("['ready','error'].includes(document.querySelector('#naver-map').dataset.state)",35000);
  report.map=await browser.evaluate("({state:document.querySelector('#naver-map').dataset.state,markers:document.querySelector('#naver-map').dataset.markerCount,paths:document.querySelector('#naver-map').dataset.routeCount,message:document.querySelector('#map-status').textContent})");
  await browser.click('[data-place-keyword="관광지"]');await browser.until("!document.querySelector('#place-search-button').disabled");
  const places=await browser.responseBody('/api/places');assert.ok(places.places.length>=2);assert.ok(places.searchToken);
  await browser.click('.place-card:nth-of-type(1) .place-route-actions button:nth-child(1)');await browser.click('.place-card:nth-of-type(2) .place-route-actions button:nth-child(2)');
  await browser.click('#route-search-button');await browser.until("!document.querySelector('#route-search-button').disabled");
  const {route}=await browser.responseBody('/api/routes');assert.equal(route.available,true);report.checks.push({name:'NAVER actual standalone search and Directions 5',status:'passed',distanceMeters:route.distanceMeters,durationMs:route.durationMs});
  const index=places.places.findIndex(place=>!plan.days[0].stops.some(stop=>stop.place?.name===place.name&&(stop.place.roadAddress||stop.place.address)===(place.roadAddress||place.address)));assert.ok(index>=0);
  await browser.click(`.place-card:nth-of-type(${index+1}) .place-add-button`);await browser.until("!document.querySelector('#generate-button').disabled");
  const {plan:added}=await browser.responseBody('/api/plan/places');assert.ok(added.days[0].stops.some(stop=>stop.title===places.places[index].name));report.checks.push({name:'Encrypted cross-request selected-place addition',status:'passed'});
  await browser.evaluate("document.querySelector('#chat-request').value='첫 장소의 추천 이유만 가족과 함께 여행하기 좋은 이유로 구체화해 줘. 장소, 시각, 다른 방문 장소와 여행 조건은 유지해 줘.'");
  await browser.click('#chat-submit');await browser.until("!document.querySelector('#chat-submit').disabled",290000);
  if(await browser.evaluate("!document.querySelector('#chat-error').hidden"))throw new Error(await browser.evaluate("document.querySelector('#chat-error').textContent"));
  const {plan:edited}=await browser.responseBody('/api/plan/revise');assert.ok(edited.sessionToken);assert.equal(edited.days.length,1);
  const count=browser.responses.filter(item=>item.path==='/api/plan/revise').length;await browser.click('#undo-edit');assert.equal(browser.responses.filter(item=>item.path==='/api/plan/revise').length,count);
  report.checks.push({name:'Actual AI chat revision and undo without another API call',status:'passed'});
  await browser.click('#save-trip-button');const hasToken=await browser.evaluate("localStorage.getItem('travel-piece.saved-trips.v1').includes('sessionToken')");assert.equal(hasToken,false);
  await browser.command('Page.reload',{ignoreCache:true});await browser.until("document.documentElement.dataset.appReady==='true'");await browser.click('.saved-trip-open');
  assert.ok((await browser.evaluate("document.querySelector('#timeline').textContent")).includes(places.places[index].name));report.checks.push({name:'Local save, reload and restore without session-token persistence',status:'passed'});
  report.runtimeErrors=browser.errors;report.status=report.map.state==='ready'?'passed':'map_domain_setup_required';
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{console.log(JSON.stringify(report,null,2));await browser.close();}
