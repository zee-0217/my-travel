import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createBrowserClient } from './browser-client.mjs';
if (!process.argv.includes('--live')) { console.log('실제 유료 API 점검: node scripts/audit-browser-live.mjs --live'); process.exit(0); }

await mkdir('.local-preview', { recursive: true });
const browser = await createBrowserClient();
const report = { url: 'http://localhost:3000', browser: 'Chrome physical mouse events', scenarios: [], errors: [] };
const summarize = (plan) => ({ region: plan.region, duration: plan.duration, days: plan.days.length, searchedStops: plan.days.flatMap((day) => day.stops).filter((stop) => stop.place).length, routes: plan.days.flatMap((day) => day.stops).filter((stop) => stop.route?.available).length, lodgings: plan.lodgings?.candidates.length || 0, lodgingRoutes: plan.lodgings?.candidates.flatMap((stay) => stay.comparisons).filter((item) => item.durationMs !== null).length || 0, tools: plan.trace.map((entry) => ({ tool: entry.tool, status: entry.status })), validation: { status: plan.validation.status, problems: plan.validation.problemCount, confirmations: plan.validation.confirmationCount, replans: plan.validation.replanCount } });
try {
  await browser.command('Page.navigate', { url: report.url });
  await browser.until("document.documentElement.dataset.appReady === 'true'");
  assert.equal(await browser.evaluate("document.querySelector('#region-select').tagName"), 'SELECT');
  assert.ok(await browser.evaluate("document.querySelector('#region-select').options.length >= 30"));
  assert.equal(browser.responses.filter((item) => item.path === '/api/plan').length, 0);
  for (const region of ['부산', '제주도']) {
    console.log(`실제 브라우저 일정 생성 시작: ${region}`);
    await browser.evaluate(`document.querySelector('#region-select').value=${JSON.stringify(region)};document.querySelector('#region-select').dispatchEvent(new Event('change',{bubbles:true}));`);
    if (region === '제주도') await browser.evaluate("document.querySelector('#duration').value='2';document.querySelector('#max-places').value='2';document.querySelector('#lodging-budget').value='300000';document.querySelector('#requests').value='실제 관광지와 숙박업소 후보 두 곳을 검색하고, 같은 주요 관광지까지 숙소별 자동차 이동시간을 비교해 줘. 제공되지 않은 요금과 예약 가능 여부는 미확인으로 두고 필요한 경우 공식 관광 공개 정보를 웹 검색해 줘.'");
    const count = browser.responses.filter((item) => item.path === '/api/plan').length;
    await browser.click('#generate-button');
    await browser.until("document.querySelector('#generation-status').hidden && (!document.querySelector('#generation-error').hidden || document.querySelector('#result-source').textContent === 'AI PLAN')", 280000);
    // Wait for the response event; never mistake the previous visible plan for this request.
    const started = Date.now();
    while (browser.responses.filter((item) => item.path === '/api/plan').length <= count && Date.now() - started < 280000) await new Promise((resolve) => setTimeout(resolve, 500));
    await browser.until("document.querySelector('#generation-status').hidden", 280000);
    if (await browser.evaluate("!document.querySelector('#generation-error').hidden")) throw new Error(await browser.evaluate("document.querySelector('#error-message').textContent"));
    const { plan } = await browser.responseBody('/api/plan');
    assert.equal(plan.region, region); assert.equal(plan.days.length, plan.duration); assert.ok(plan.days.every((day) => day.stops.length <= plan.maxPlacesPerDay));
    const firstVerifiedDay = plan.days.findIndex((day) => day.stops.some((stop) => stop.place?.coordinates));
    if (firstVerifiedDay >= 0) {
      await browser.click(`#day-tab-${firstVerifiedDay}`);
      await browser.until("['ready','error'].includes(document.querySelector('#naver-map').dataset.state)", 35000);
    }
    const map = await browser.evaluate("({state:document.querySelector('#naver-map').dataset.state,markers:Number(document.querySelector('#naver-map').dataset.markerCount||0),paths:Number(document.querySelector('#naver-map').dataset.routeCount||0),message:document.querySelector('#map-status').textContent})");
    report.scenarios.push({ kind: 'generation', ...summarize(plan), map });
    await writeFile(`.local-preview/audit-${region === '부산' ? 'busan' : 'jeju'}.json`, JSON.stringify(plan, null, 2));
    console.log(JSON.stringify(report.scenarios.at(-1)));
    if (region === '부산') {
      await browser.evaluate("document.querySelector('#chat-day').value='1';document.querySelector('#chat-request').value='둘째 날 첫 장소의 추천 이유만 부모님과 함께 여행하기 좋은 이유로 구체적으로 바꿔 줘. 장소·방문 시각·다른 날짜·숙소 후보는 그대로 유지해 줘.'");
      await browser.click('#chat-submit');
      await browser.until("!document.querySelector('#chat-submit').disabled", 280000);
      if (await browser.evaluate("!document.querySelector('#chat-error').hidden")) throw new Error(await browser.evaluate("document.querySelector('#chat-error').textContent"));
      const { plan: edited } = await browser.responseBody('/api/plan/revise');
      for (let index = 0; index < plan.days.length; index++) if (index !== 1) assert.deepEqual(edited.days[index], plan.days[index]);
      assert.ok(edited.edit.changes.length > 0);
      const postCount = browser.responses.filter((item) => item.path === '/api/plan/revise').length;
      await browser.click('#undo-edit');
      assert.equal(await browser.evaluate("document.querySelector('#undo-edit').disabled"), true);
      assert.equal(browser.responses.filter((item) => item.path === '/api/plan/revise').length, postCount);
      report.scenarios.push({ kind: 'chat_and_undo', changedDays: edited.edit.changedDays, changes: edited.edit.changes, otherDaysUnchanged: true, undoWithoutApi: true, validation: edited.validation.status });
      console.log('대화형 수정·다른 날짜 유지·API 없는 되돌리기 확인');
    }
  }
  assert.deepEqual(browser.errors, []);
  report.status = report.scenarios.some((item) => item.map?.state === 'error') ? 'map_connection_required' : 'passed';
} catch (error) { report.status = 'failed'; report.errors.push(error.message); process.exitCode = 1; }
finally { report.runtimeErrors = browser.errors; await writeFile('.local-preview/full-browser-audit.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, errors: report.errors })); await browser.close(); }
