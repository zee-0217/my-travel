import { mkdir, writeFile } from 'node:fs/promises';
import { destinations } from '../public/js/travel-inspiration.js';

await mkdir(new URL('../public/images/destinations/', import.meta.url), { recursive: true });
for (const destination of destinations) {
  const api = new URL('https://commons.wikimedia.org/w/api.php');
  api.search = new URLSearchParams({ action: 'query', format: 'json', titles: `File:${destination.file}`, prop: 'imageinfo', iiprop: 'url', iiurlwidth: '1280' });
  const response = await fetch(api, { headers: { 'User-Agent': 'TravelPieceLocalDevelopment/1.0' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Photo metadata failed: ${response.status}`);
  const data = await response.json(), info = Object.values(data.query.pages)[0]?.imageinfo?.[0];
  if (!info?.thumburl) throw new Error(`Missing thumbnail: ${destination.region}`);
  const photo = await fetch(info.thumburl, { headers: { 'User-Agent': 'TravelPieceLocalDevelopment/1.0' }, signal: AbortSignal.timeout(20000) });
  if (!photo.ok || !photo.headers.get('content-type')?.startsWith('image/')) throw new Error(`Photo download failed: ${photo.status}`);
  const buffer = Buffer.from(await photo.arrayBuffer());
  await writeFile(new URL(`../public${destination.image}`, import.meta.url), buffer);
  console.log(JSON.stringify({ region: destination.region, bytes: buffer.length }));
}
