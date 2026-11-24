import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
if (!process.argv.includes('--live')) { console.log('실제 NAVER API 점검: node scripts/audit-services.mjs --live'); process.exit(0); }
const base = 'http://localhost:3000';
const report = { url: base, serviceChecks: [] };
async function request(path, body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(35000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${data.error?.code || response.status}`);
  return data;
}
for (const region of ['부산', '제주도']) {
  try {
    const places = await request(`/api/places?${new URLSearchParams({ region, keyword: '관광지', display: '2' })}`);
    assert.ok(places.places.length > 0);
    report.serviceChecks.push({ service: 'NAVER API HUB', region, status: 'passed', count: places.places.length });
    const points = places.places.filter((place) => place.coordinates).map((place) => place.coordinates);
    if (points.length >= 2) {
      const { route } = await request('/api/routes', { start: points[0], goal: points[1], mode: 'driving', option: 'traoptimal' });
      assert.equal(typeof route.available, 'boolean');
      report.serviceChecks.push({ service: 'Directions 5', region, status: route.available ? 'passed' : 'unavailable_route', durationMs: route.durationMs, distanceMeters: route.distanceMeters });
    }
  } catch (error) { report.serviceChecks.push({ service: 'NAVER', region, status: 'failed', message: error.message }); process.exitCode = 1; }
}
try {
  const items = [['food', 40000], ['accommodation', 120000], ['transport', 30000], ['activities', 10000]].map(([category, amount]) => ({ category, amount, label: category, status: 'confirmed', source: '계산 점검용 입력 숫자: 실제 가격 아님' }));
  const { budget } = await request('/api/budget', { totalBudget: 300000, items });
  assert.equal(budget.total, 200000); assert.equal(budget.remainingBudget, 100000);
  const unknown = await request('/api/budget', { totalBudget: 300000, items: [{ ...items[0], amount: null, status: 'unknown' }, ...items.slice(1)] });
  assert.equal(unknown.budget.total, null); assert.equal(unknown.budget.remainingBudget, null);
  report.serviceChecks.push({ service: 'calculate_budget', status: 'passed', evidence: 'HTTP 계산값·미확인 처리. 입력 단가는 테스트용이며 실제 견적 아님.' });
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const { weather } = await request('/api/weather', { region: '부산', date: today, location: null });
  const future = await request('/api/weather', { region: '제주도', date: '2027-12-31', location: null });
  assert.equal(future.weather.available, false); assert.equal(future.weather.reason, 'OUTSIDE_FORECAST_RANGE');
  report.serviceChecks.push({ service: 'get_weather', status: weather.available ? 'passed' : 'connection_required', reason: weather.reason || null, farFuture: future.weather.reason });
} catch (error) { report.serviceChecks.push({ service: 'local_tools', status: 'failed', message: error.message }); process.exitCode = 1; }
await mkdir('.local-preview', { recursive: true });
await writeFile('.local-preview/services-audit.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
