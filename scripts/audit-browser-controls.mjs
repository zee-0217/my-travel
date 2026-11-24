import assert from 'node:assert/strict';
import { createBrowserClient } from './browser-client.mjs';
const browser = await createBrowserClient();
try {
  await browser.command('Page.navigate', { url: 'http://localhost:3000' });
  await browser.until("document.documentElement.dataset.appReady === 'true'");
  assert.ok(await browser.evaluate("document.querySelector('#region-select').options.length >= 30"));
  for (const region of ['부산', '제주도', '서울']) {
    await browser.evaluate(`document.querySelector('#region-select').value=${JSON.stringify(region)};document.querySelector('#region-select').dispatchEvent(new Event('change',{bubbles:true}));`);
    assert.equal(await browser.evaluate("document.querySelector('#region').value"), region);
    assert.equal(await browser.evaluate("document.querySelector('#place-region-label').textContent"), region);
  }
  await browser.evaluate("document.querySelector('#region-select').value='__custom__';document.querySelector('#region-select').dispatchEvent(new Event('change'));document.querySelector('#region-custom').focus()");
  await browser.command('Input.insertText', { text: '부산' });
  assert.equal(await browser.evaluate("document.querySelector('#region-custom').hidden"), false);
  await browser.command('Input.insertText', { text: ' 해운대' });
  assert.equal(await browser.evaluate("document.querySelector('#region').value"), '부산 해운대');
  await browser.evaluate("document.querySelector('#region-custom').value='';document.querySelector('#region-custom').dispatchEvent(new Event('input'))");
  await browser.click('#generate-button');
  assert.equal(await browser.evaluate("document.querySelector('#form-feedback').hidden"), false);
  assert.equal(browser.responses.filter((item) => item.path === '/api/plan').length, 0);
  await browser.click('#reset-button');
  assert.equal(await browser.evaluate("document.querySelector('#region').value"), '강릉');
  assert.equal(await browser.evaluate("document.querySelector('#region-select').value"), '강릉');
  assert.equal(await browser.evaluate("document.querySelector('#region-custom').hidden"), true);
  assert.match(await browser.evaluate("document.querySelector('#results-title').textContent"), /강릉/);
  assert.equal(await browser.evaluate("document.querySelector('#generate-button').disabled"), false);
  await browser.command('Network.setBlockedURLs', { urls: ['*app.js*'] });
  await browser.command('Page.reload', { ignoreCache: true });
  await browser.until("document.documentElement.dataset.appReady === 'false'");
  assert.equal(await browser.evaluate("document.querySelector('#app-startup').hidden"), false);
  assert.equal(await browser.evaluate("document.querySelector('#generate-button').disabled"), true);
  console.log(JSON.stringify({ status: 'passed', checks: ['34 region choices', 'selection sync', 'custom Korean input with known-city prefix', 'visible invalid-input feedback without API call', 'reset sync', 'visible bootstrap failure'] }));
} finally { await browser.close(); }
