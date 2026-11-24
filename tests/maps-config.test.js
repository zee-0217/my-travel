import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';

test('public map config exposes only the SDK identifier, with new ncpKeyId authentication', async (t) => {
  const server = createApp({ publicMapsClientId: 'public-sdk-identifier' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/maps/config`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, clientId: 'public-sdk-identifier', sdkUrl: 'https://oapi.map.naver.com/openapi/v3/maps.js', authParameter: 'ncpKeyId' });
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(response.headers.get('content-security-policy'), /https:\/\/oapi.map.naver.com/);
});
