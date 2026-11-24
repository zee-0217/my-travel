// Generate CDN headers from the same production Express/Helmet configuration.
import { writeFile } from 'node:fs/promises';
import { once } from 'node:events';
process.env.NODE_ENV = 'production';
const { createApp } = await import('../src/app.js');
const server = createApp().listen(0, '127.0.0.1'); await once(server, 'listening');
try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  const keys = ['Content-Security-Policy','Referrer-Policy','X-Content-Type-Options','X-Frame-Options','Cross-Origin-Opener-Policy','Cross-Origin-Resource-Policy'];
  const config = { $schema: 'https://openapi.vercel.sh/vercel.json', framework: 'express', fluid: true, installCommand: 'npm ci', buildCommand: 'npm run check', functions: { 'src/app.js': { maxDuration: 300, includeFiles: 'public/js/{add-place,itinerary-validation}.js' } },
    headers: [{ source: '/(.*)', headers: keys.map((key) => ({ key, value: response.headers.get(key) })).filter((item) => item.value) }, { source: '/api/(.*)', headers: [{ key: 'Cache-Control', value: 'no-store' }] }, { source: '/js/(.*)', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }, { source: '/css/(.*)', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }] };
  await writeFile(new URL('../vercel.json', import.meta.url), JSON.stringify(config, null, 2) + '\n');
  console.log('Vercel configuration generated without environment values.');
} finally { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); }
