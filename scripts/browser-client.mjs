import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function createBrowserClient() {
  const profile = await mkdtemp(join(tmpdir(), 'travel-browser-'));
  const browser = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket;
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) { try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); } }
    if (!port) throw new Error('Chrome remote debugging unavailable.');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    socket = new WebSocket(pages.find((page) => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
    let nextId = 0; const pending = new Map(); const responses = []; const errors = [];
    const redact = (value) => String(value).replace(/https?:\/\/[^\s"']+/g, (raw) => { try { const url = new URL(raw); return url.origin + url.pathname; } catch { return '[URL]'; } });
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (pending.has(message.id)) { const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); }
      if (message.method === 'Runtime.exceptionThrown') errors.push(redact(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text));
      if (message.method === 'Network.responseReceived') { const { response, requestId } = message.params; const url = new URL(response.url); if (url.pathname.startsWith('/api/')) responses.push({ path: url.pathname, status: response.status, requestId }); }
    });
    const command = (method, params = {}, timeout = 15000) => new Promise((resolve, reject) => { const id = ++nextId; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser timeout: ${method}`)); }, timeout); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expression) => { const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(redact(result.exceptionDetails.exception?.description || result.exceptionDetails.text)); return result.result.value; };
    const until = async (expression, timeout = 30000) => { const started = Date.now(); while (Date.now() - started < timeout) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 250)); } throw new Error(`Browser condition timed out: ${expression}`); };
    const click = async (selector) => {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
      const point = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),disabled:el.disabled}})()`);
      if (!point.hit || point.disabled) throw new Error(`Cannot click ${selector}: covered or disabled.`);
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 }); await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    };
    await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable');
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    return { command, evaluate, until, click, responses, errors,
      async responseBody(path) { const response = responses.filter((item) => item.path === path).at(-1); if (!response) throw new Error(`No response for ${path}`); const data = await command('Network.getResponseBody', { requestId: response.requestId }); return JSON.parse(data.base64Encoded ? Buffer.from(data.body, 'base64').toString('utf8') : data.body); },
      async close() { try { await command('Browser.close', {}, 3000); } catch { /* Process may already be closed. */ } socket.close(); browser.kill(); },
    };
  } catch (error) { socket?.close(); browser.kill(); throw error; }
}
