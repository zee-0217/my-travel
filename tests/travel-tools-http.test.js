import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';

async function serve(t, options = {}) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return (path, input) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}

test('POST /api/routes returns unavailable intact and passes the cancellation signal', async (t) => {
  const post = await serve(t, { getRoutes: async (input, { signal }) => {
    assert.equal(input.mode, 'driving');
    assert.equal(signal.aborted, false);
    return { available: false, distanceMeters: null, durationMs: null, message: '자동차 경로 확인 불가' };
  } });
  const response = await post('/routes', { mode: 'driving' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).route.available, false);
});

test('POST /api/budget preserves unverified prices and rejects invalid inputs', async (t) => {
  const post = await serve(t);
  const response = await post('/budget', { totalBudget: 500000, items: [{ category: 'food', label: '식비', amount: 100000, status: 'estimated' }] });
  assert.equal(response.status, 200);
  const { budget } = await response.json();
  assert.equal(budget.total, null);
  assert.equal(budget.pricedSubtotal, 100000);
  assert.equal(budget.unknownCount, 3);
  const invalid = await post('/budget', { totalBudget: -1, items: [] });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_BUDGET_INPUT');
});
