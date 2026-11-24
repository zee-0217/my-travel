import assert from 'node:assert/strict';
import { kstDate } from '../src/services/kma-weather.js';

const results = [];
for (const region of ['부산', '제주도']) {
  const response = await fetch('http://localhost:3000/api/weather', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ region, date: kstDate(new Date()), location: null }), signal: AbortSignal.timeout(35000) });
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.weather.available, true); assert.ok(body.weather.hourly.length > 0);
  results.push({ region, provider: body.weather.source.name, hours: body.weather.hourly.length, fallback: body.weather.fallback?.reason || null });
}
console.log(JSON.stringify({ status: 'passed', results }));
