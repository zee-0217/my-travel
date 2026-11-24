import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { serviceConfiguration } from '../src/routes/status.js';
import { createApp } from '../src/app.js';
import { publicPlanError } from '../src/lib/plan-error.js';

test('service readiness distinguishes missing weather settings without exposing credential values', () => {
  const config = { openai: { apiKey: 'private-openai-secret', model: 'private-model-name' }, naverApiHub: { clientId: 'private-search-id', clientSecret: 'private-search-secret' }, naverMaps: { clientId: 'private-map-id', clientSecret: 'private-map-secret' }, weather: { apiKey: '', serviceKey: '' } };
  const result = serviceConfiguration(config);
  assert.equal(result.checked, 'configuration_only');
  assert.equal(result.services.find((service) => service.id === 'weather').configured, false);
  assert.equal(result.services.find((service) => service.id === 'openai').configured, true);
  assert.ok(!JSON.stringify(result).includes('private-'));
});

test('HTTP serves a real region selector, recoverable boot status, and uncached frontend assets', async (t) => {
  const server = createApp().listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const htmlResponse = await fetch(base);
  const html = await htmlResponse.text();
  assert.equal(htmlResponse.headers.get('cache-control'), 'no-store');
  assert.match(html, /<select id="region-select"/);
  assert.match(html, /<option value="부산"/); assert.match(html, /<option value="제주도"/);
  assert.match(html, /id="form-feedback"/); assert.match(html, /id="app-startup"/);
  assert.ok(!html.includes('<datalist'));
  const statusResponse = await fetch(base + '/api/status');
  const status = await statusResponse.json();
  assert.equal(statusResponse.headers.get('cache-control'), 'no-store');
  assert.equal(status.services.length, 5);
  for (const path of ['/js/bootstrap.js', '/js/region-picker.js', '/js/service-status.js']) {
    const response = await fetch(base + path); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('blocked external networking has an actionable safe error distinct from model or key failures', () => {
  const denied = Object.assign(new Error('private upstream payload'), { cause: { name: 'TypeError', cause: { code: 'EACCES' } } });
  const error = publicPlanError(denied);
  assert.equal(error.code, 'AI_CONNECTION_BLOCKED'); assert.equal(error.status, 503);
  assert.ok(!error.message.includes('private'));
  assert.equal(publicPlanError({ cause: { code: 'ENOTFOUND' } }).code, 'AI_CONNECTION_ERROR');
});
