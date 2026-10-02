// <xiaochun-avatar> 的 CSS 自定义属性 / ::part 浏览器测试 (可选, 需要 Playwright):
//   PLAYWRIGHT_MODULE=/path/to/@playwright/test node test/browser/style-harness.mjs
// 不依赖真实 /embed (iframe 用空白页), 只验证外壳样式: --xc-radius / --xc-shadow / --xc-z-index / --xc-offset-x|y / --xc-bg 与 part 名。
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
let chromium;
try { ({ chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || '@playwright/test')); }
catch { console.log('[skip] Playwright 不可用'); process.exit(0); }

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.route('http://host.test/**', (r) => {
  const u = new URL(r.request().url());
  if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0"><div id=inline-host></div></body>' });
  const f = path.join(dist, u.pathname.replace(/^\/dist\//, ''));
  if (existsSync(f)) return r.fulfill({ contentType: 'text/javascript', body: readFileSync(f) });
  return r.fulfill({ status: 404, body: '' });
});
await page.route('http://frame.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
await page.goto('http://host.test/');
await page.addScriptTag({ type: 'module', url: 'http://host.test/dist/element.js' });
await page.waitForFunction(() => customElements.get('xiaochun-avatar'));

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   -', name); } catch (e) { failed++; console.log('FAIL -', name, '\n', e.message); } };

await page.evaluate(() => {
  document.head.insertAdjacentHTML('beforeend', `<style>
    #a { --xc-radius: 24px; --xc-shadow: 0 8px 24px rgba(0,0,0,.18); --xc-bg: rgb(10, 20, 30); }
    #b { --xc-offset-x: 40px; --xc-offset-y: 80px; --xc-z-index: 77; }
    #a::part(iframe) { outline: 2px solid red; }
  </style>`);
  document.body.insertAdjacentHTML('beforeend', `
    <xiaochun-avatar id="a" src="http://frame.test/embed" size="200x300" transparent="false" lazy="false"></xiaochun-avatar>
    <xiaochun-avatar id="b" src="http://frame.test/embed" size="200x300" position="bottom-right" lazy="false"></xiaochun-avatar>
    <xiaochun-avatar id="c" src="http://frame.test/embed" size="200x300" position="bottom-left" lazy="false"></xiaochun-avatar>`);
});
await page.waitForSelector('#a >> iframe', { state: 'attached' }).catch(() => {});
const info = (id) => page.evaluate((id) => {
  const host = document.getElementById(id);
  const root = host.shadowRoot || host;
  const q = (s) => root.querySelector(s);
  const wrapper = q('[part~="wrapper"]'), iframe = q('iframe'), ph = q('[part~="placeholder"]');
  const cs = (e) => e && getComputedStyle(e);
  return {
    parts: [...root.querySelectorAll('[part]')].map((e) => e.getAttribute('part')),
    wrapper: wrapper && { radius: cs(wrapper).borderRadius, shadow: cs(wrapper).boxShadow, bg: cs(wrapper).backgroundColor, z: cs(wrapper).zIndex, right: cs(wrapper).right, left: cs(wrapper).left, bottom: cs(wrapper).bottom, position: cs(wrapper).position },
    iframe: iframe && { radius: cs(iframe).borderRadius },
    placeholder: ph && { radius: cs(ph).borderRadius },
    outline: iframe && cs(iframe).outlineStyle,
  };
}, id);

await check('part 名: mount / wrapper / iframe / placeholder 都存在', async () => {
  const a = await info('a');
  for (const p of ['mount', 'wrapper', 'iframe', 'placeholder']) assert.ok(a.parts.some((x) => x.split(/\s+/).includes(p)), `missing part ${p}: ${JSON.stringify(a.parts)}`);
});
await check('--xc-radius / --xc-shadow / --xc-bg 作用于外壳, iframe 与占位图同步圆角', async () => {
  const a = await info('a');
  assert.equal(a.wrapper.radius, '24px');
  assert.equal(a.iframe.radius, '24px');
  assert.match(a.wrapper.shadow, /rgba\(0, 0, 0, 0\.18\)/);
  assert.equal(a.wrapper.bg, 'rgb(10, 20, 30)');
});
await check('::part(iframe) 宿主样式生效', async () => { assert.equal((await info('a')).outline, 'solid'); });
await check('悬浮: --xc-offset-x/y 与 --xc-z-index', async () => {
  const b = await info('b');
  assert.equal(b.wrapper.position, 'fixed');
  assert.equal(b.wrapper.right, '40px');
  assert.equal(b.wrapper.bottom, '80px');
  assert.equal(b.wrapper.z, '77');
  const c = await info('c');
  assert.equal(c.wrapper.left, '16px'); // 未设置 → 默认 16px
  assert.equal(c.wrapper.bottom, '16px');
  assert.equal(c.wrapper.z, '2147483000');
});
await check('默认值: 无变量时圆角 0 / 无阴影', async () => {
  const c = await info('c');
  assert.equal(c.wrapper.radius, '0px');
  assert.equal(c.wrapper.shadow, 'none');
});
await browser.close();
if (errors.length) { failed++; console.log('pageerrors:', errors); }
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
