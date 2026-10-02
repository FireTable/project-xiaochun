// React 绑定的浏览器测试 (可选, 需要 Playwright + 可启动的 Chromium):
//   PLAYWRIGHT_MODULE=/path/to/node_modules/@playwright/test node test/browser/react-harness.mjs
// 不依赖真实 /embed: 用 route 拦截返回一个 stub iframe, 按协议完成握手并回应 xc.say / xc.audio。
// 验证: StrictMode 双挂载不泄漏 iframe 与 window 监听 / 回调被调用 / ref 方法可用 / props 热更新不重建 / 卸载干净。
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '../..');
let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || '@playwright/test'));
} catch {
  console.log('[skip] Playwright 不可用 (设置 PLAYWRIGHT_MODULE=<@playwright/test 的路径>)');
  process.exit(0);
}

const entry = `
import { StrictMode, createElement as h, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Xiaochun } from '@firetable/project-xiaochun/react';
const log = (window.__log = []);
// 统计 window message 监听的净增量 (泄漏检测)
let live = 0; const add = window.addEventListener.bind(window), rem = window.removeEventListener.bind(window);
window.addEventListener = (t, ...a) => { if (t === 'message') live++; return add(t, ...a); };
window.removeEventListener = (t, ...a) => { if (t === 'message') live--; return rem(t, ...a); };
window.__live = () => live;
function App() {
  const ref = useRef(null);
  const [lang, setLang] = useState('zh-CN');
  const [paused, setPaused] = useState(false);
  window.__ref = ref; window.__setLang = setLang; window.__setPaused = setPaused;
  return h(Xiaochun, { ref, src: 'http://frame.test/embed', lazy: false, width: 200, height: 300, lang, paused,
    onReady: () => log.push('ready'), onState: (s) => log.push('state'), onUtterance: (u) => log.push('utt:' + u.phase + '/' + u.kind), onError: (e) => log.push('err:' + e.code) });
}
window.__mount = (strict) => { const el = document.getElementById('root'); window.__root = createRoot(el); window.__root.render(strict ? h(StrictMode, null, h(App)) : h(App)); };
window.__unmount = () => window.__root.unmount();
`;
const built = await esbuild.build({
  stdin: { contents: entry, resolveDir: pkgRoot, loader: 'js' },
  bundle: true, write: false, format: 'iife', target: 'es2020', define: { 'process.env.NODE_ENV': '"development"' },
  alias: { '@firetable/project-xiaochun/react': path.join(pkgRoot, 'src/react.ts') },
  absWorkingDir: pkgRoot, logLevel: 'error',
});
const bundle = built.outputFiles[0].text;

const frameHtml = `<!doctype html><script>
console.log('frame loaded');
const v = 1; const caps = { commands: [], unsupported: [], stt: false, transparent: true, audio: { formats: ['pcm16'], streaming: true, maxSeconds: 120 } };
addEventListener('message', (e) => {
  if (e.data && e.data.type === 'xc.init') {
    const port = e.ports[0];
    port.onmessage = (m) => {
      const d = m.data;
      if (d.type === 'xc.say' || d.type === 'xc.audio') {
        const kind = d.type === 'xc.audio' ? 'audio' : 'text';
        port.postMessage({ type: 'xc.utterance', v, id: d.id, payload: { phase: 'start', text: '', kind } });
        setTimeout(() => port.postMessage({ type: 'xc.utterance', v, id: d.id, payload: { phase: 'end', text: '', kind } }), 20);
      }
    };
    port.postMessage({ type: 'xc.loaded', v, payload: { model: 'stub' } });
    port.postMessage({ type: 'xc.state', v, payload: { phase: 'idle', paused: false, heavy: 'lazy' } });
  }
});
parent.postMessage({ type: 'xc.ready', v, payload: { version: 'stub', protocol: v, capabilities: caps } }, '*');
</script>`;

const browser = await chromium.launch({ headless: true });
let failed = 0;
const check = (name, fn) => fn().then(() => console.log('ok   -', name), (e) => { failed++; console.log('FAIL -', name, '\n', e.message); });
try {
  for (const strict of [true, false]) {
    const page = await browser.newPage();
    if (process.env.DEBUG) page.on('console', (m) => console.log('[console]', m.text()));
    page.on('pageerror', (e) => { failed++; console.log('[pageerror]', e.message); });
    await page.route('http://host.test/', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }));
    await page.route('http://frame.test/embed**', (r) => r.fulfill({ contentType: 'text/html', body: frameHtml }));
    await page.goto('http://host.test/');
    await page.addScriptTag({ content: bundle });
    await page.evaluate((s) => window.__mount(s), strict);
    if (process.env.DEBUG) { await page.waitForTimeout(1500); console.log('iframes', await page.locator('iframe').count(), await page.evaluate(() => JSON.stringify(window.__log))); }
    const tag = strict ? 'StrictMode' : 'plain';
    await check(`${tag}: 只有一个 iframe, 握手完成并触发 onReady`, async () => {
      await page.waitForFunction(() => window.__log.includes('ready'), null, { timeout: 10000 });
      assert.equal(await page.locator('iframe').count(), 1);
    });
    await check(`${tag}: window message 监听净增量 = 1 (无泄漏)`, async () => {
      assert.equal(await page.evaluate(() => window.__live()), 1);
    });
    await check(`${tag}: ref.say / ref.speakAudio 走通并回调 onUtterance`, async () => {
      await page.evaluate(() => window.__ref.current.say('hi'));
      await page.evaluate(() => window.__ref.current.speakAudio(new Uint8Array([1, 2, 3]).buffer, { text: 'x' }));
      const log = await page.evaluate(() => window.__log);
      assert.ok(log.includes('utt:end/text') && log.includes('utt:end/audio'), JSON.stringify(log));
    });
    await check(`${tag}: lang/paused 变化不重建 iframe`, async () => {
      const before = await page.evaluate(() => document.querySelector('iframe') && (window.__f = document.querySelector('iframe')) && 1);
      await page.evaluate(() => { window.__setLang('en'); window.__setPaused(true); });
      await page.waitForTimeout(150);
      assert.ok(before && await page.evaluate(() => window.__f === document.querySelector('iframe') && document.querySelectorAll('iframe').length === 1));
    });
    await check(`${tag}: 卸载后 iframe 与监听全部清理, ref 方法 reject`, async () => {
      const ref = await page.evaluate(() => { window.__r = window.__ref; return 1; });
      assert.ok(ref);
      await page.evaluate(() => window.__unmount());
      await page.waitForTimeout(100);
      assert.equal(await page.locator('iframe').count(), 0);
      assert.equal(await page.evaluate(() => window.__live()), 0);
      const err = await page.evaluate(() => window.__r.current === null ? 'ref-null' : window.__r.current.say('x').then(() => 'resolved', (e) => e.message));
      assert.ok(err === 'ref-null' || /not mounted/.test(err), err);
    });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
