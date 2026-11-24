import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { app } from '../src/app.js';

test('scaffold serves public assets and protects server files', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', stage: 'setup' });
  assert.equal(health.headers.get('x-powered-by'), null);
  assert.ok(health.headers.get('content-security-policy'));

  for (const [path, contentType] of [
    ['/', 'text/html'], ['/css/styles.css', 'text/css'],
    ['/js/app.js', 'javascript'], ['/js/api.js', 'javascript'],
    ['/js/sample-data.js', 'javascript'], ['/images/coastal-trip.svg', 'image/svg+xml'],
    ['/js/places.js', 'javascript'],
    ['/js/routes.js', 'javascript'],
    ['/js/trip-map.js', 'javascript'],
    ['/images/sample-map.svg', 'image/svg+xml'],
  ]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').includes(contentType));
  }

  for (const path of ['/.env', '/.env.example', '/package.json', '/src/config/env.js', '/node_modules/openai/package.json', '/%2eenv', '/missing']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'NOT_FOUND' });
  }

  const malformed = await fetch(`${base}/api/health`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: 'INVALID_REQUEST' });
});
