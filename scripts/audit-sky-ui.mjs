import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createBrowserClient } from './browser-client.mjs';
import { destinations } from '../public/js/travel-inspiration.js';

const browser = await createBrowserClient();
try {
  await browser.command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await browser.command('Page.navigate', { url: 'http://localhost:3000' });
  await browser.until("document.documentElement.dataset.appReady === 'true' && document.querySelector('#hero-destination-image').complete && document.querySelector('#hero-destination-image').naturalWidth > 0");
  assert.equal(await browser.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--sky').trim()"), '#0877b1');
  for (const destination of destinations) {
    const image = await browser.evaluate(`new Promise(resolve=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>resolve(null);img.src=${JSON.stringify(destination.image)}})`);
    assert.ok(image?.width >= 800 && image.height >= 400, `Local photo ${destination.region} loads`);
  }
  const initialTitle = await browser.evaluate("document.querySelector('#results-title').textContent");
  for (let index = 0; index < 5; index++) {
    await browser.click('#hero-photo-next');
    const picturedRegion = await browser.evaluate("document.querySelector('#hero-destination-name').textContent.split(' · ')[0]");
    await browser.click('#random-trip-button');
    assert.equal(await browser.evaluate("document.querySelector('#region').value"), picturedRegion);
    assert.equal(await browser.evaluate("document.querySelector('#region').value === document.querySelector('#region-select').value"), true);
    assert.equal(await browser.evaluate("document.querySelector('#trip-form').checkValidity()"), true);
    assert.equal(await browser.evaluate("document.querySelector('#region-select') === document.activeElement"), true);
    assert.equal(await browser.evaluate("document.querySelector('#results-title').textContent"), initialTitle);
  }
  assert.equal(browser.responses.filter((item) => item.path === '/api/plan').length, 0);
  await browser.evaluate("window.scrollTo({top:0,behavior:'instant'});document.querySelector('#toast').classList.remove('visible')");
  await browser.until("document.querySelector('#hero-destination-image').complete");
  await mkdir(new URL('../.local-preview/', import.meta.url), { recursive: true });
  const desktop = await browser.command('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('../.local-preview/sky-desktop.png', import.meta.url), Buffer.from(desktop.data, 'base64'));
  for (const width of [320,390,540,768,1024]) {
    await browser.command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 540 });
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `No overflow at ${width}`);
    assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('#random-trip-button')).display !== 'none'"), true);
    await browser.click('#random-trip-button');
  }
  await browser.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true });
  await browser.command('Page.navigate', { url: 'http://localhost:3000' });
  await browser.until("document.documentElement.dataset.appReady === 'true' && document.querySelector('#hero-destination-image').complete && document.querySelector('#hero-destination-image').naturalWidth > 0");
  await browser.evaluate("window.scrollTo({top:0,behavior:'instant'});document.querySelector('#toast').classList.remove('visible')");
  const mobile = await browser.command('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('../.local-preview/sky-mobile.png', import.meta.url), Buffer.from(mobile.data, 'base64'));
  await browser.evaluate("document.querySelector('#hero-destination-image').dispatchEvent(new Event('error'))");
  await browser.until("document.querySelector('#hero-destination-image').complete && document.querySelector('#hero-destination-image').naturalWidth > 0");
  assert.match(await browser.evaluate("document.querySelector('#hero-destination-image').src"), /coastal-trip.svg$/);
  assert.deepEqual(browser.errors, []);
  console.log(JSON.stringify({ status: 'passed', checks: ['sky palette', `${destinations.length} local tourist photos`, 'pictured destination settings and focus', 'no automatic AI calls or changes to current itinerary', 'mobile clickable CTA', 'no overflow at five widths', 'photo fallback'], screenshots: ['.local-preview/sky-desktop.png','.local-preview/sky-mobile.png'] }));
} finally { await browser.close(); }
