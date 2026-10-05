// 换装 / 换场景 SDK 行为测试 (可选, 需要 puppeteer-core + 本机 Chrome):
//   PUPPETEER_MODULE=/path/to/node_modules/puppeteer-core CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     node test/browser/outfit-harness.mjs        (先 pnpm build)
// 不依赖真实 /embed: 用请求拦截返回一个"按协议应答的 stub iframe" (跨源 frame.test), 重点验证 SDK 这一侧:
//   capabilities 协商 (新/旧 iframe) / id 本地校验 / 命令应答 resolve / busy 透传 / persist / 旧 model 选项 / allowCustomModel 门禁 /
//   运行时切 scene 时外壳背景 + 穿透监听 + pointer-events 同步 / <xiaochun-avatar> 属性热更新 / React prop 热更新不重建 iframe。
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '../..');
const dist = path.join(pkgRoot, 'dist');
let puppeteer;
try { puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_MODULE || 'puppeteer-core'); }
catch { console.log('[skip] puppeteer-core 不可用 (设置 PUPPETEER_MODULE=<puppeteer-core 的路径>)'); process.exit(0); }
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(executablePath)) { console.log('[skip] 找不到 Chrome (设置 CHROME_PATH)'); process.exit(0); }

const reactEntry = `
import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Xiaochun } from '@firetable/project-xiaochun/react';
window.__mountReact = () => {
  window.__rlog = [];
  function App() {
    const [outfit, setOutfit] = useState('xiaochun_maid');
    const [scene, setScene] = useState('light');
    const [size, setSize] = useState([200, 300]);
    const [g, setG] = useState({ draggable: false, resizable: false });
    window.__setOutfit = setOutfit; window.__setScene = setScene; window.__setSize = setSize; window.__setG = setG;
    return h(Xiaochun, { src: 'http://frame.test/embed', lazy: false, width: size[0], height: size[1], draggable: g.draggable, resizable: g.resizable, outfit, scene,
      onResize: (p) => window.__rlog.push('resize:' + p.phase), onMove: (p) => window.__rlog.push('move:' + p.phase),
      onOutfitChanged: (p) => window.__rlog.push('outfit:' + p.id), onSceneChanged: (p) => window.__rlog.push('scene:' + p.id) });
  }
  createRoot(document.getElementById('root')).render(h(App));
};`;
const built = await esbuild.build({
  stdin: { contents: reactEntry, resolveDir: pkgRoot, loader: 'js' }, bundle: true, write: false, format: 'iife', target: 'es2020',
  define: { 'process.env.NODE_ENV': '"development"' }, alias: { '@firetable/project-xiaochun/react': path.join(pkgRoot, 'src/react.ts') },
  absWorkingDir: pkgRoot, logLevel: 'error',
});
const reactBundle = built.outputFiles[0].text;

const frameHtml = `<!doctype html><body><script>
const q = new URLSearchParams(location.search);
const received = window.__received = [];
const OUT = { xiaochun_maid: 1, xiaochun_dinner_dress: 1, slow_one: 1, busy_one: 1 };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const caps = q.get('caps') === 'old'
  ? { commands: [], unsupported: [], stt: true, transparent: true }
  : { commands: ['xc.setOutfit', 'xc.setScene'], unsupported: [], stt: true, transparent: true,
      prefetch: true, gestures: { move: true, resize: true, cornerSize: 40 },
      outfits: Object.keys(OUT).map((id) => ({ id, name: id })),
      scenes: [{ id: 'light', transparent: false }, { id: 'dark', transparent: false }, { id: 'transparent', transparent: true }] };
let outfit = own(OUT, q.get('outfit') || '') ? q.get('outfit') : 'xiaochun_dinner_dress';
let scene = ['light', 'dark', 'transparent'].includes(q.get('scene')) ? q.get('scene') : (q.get('transparent') === '1' ? 'transparent' : 'light');
let port = null;
const send = (type, payload, id) => port.postMessage({ type, v: 1, id, payload });
window.__post = (type, payload) => send(type, payload); // 测试用: 让 stub iframe 按需发手势消息 (含伪造的)
const ready = () => { if (!port) parent.postMessage({ type: 'xc.ready', v: 1, payload: { version: 'stub', protocol: 1, capabilities: caps } }, q.get('host')); };
ready(); const t = setInterval(() => { if (port) clearInterval(t); else ready(); }, 150);
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'xc.init' && !port) {
    port = e.ports[0]; received.push({ type: 'xc.init', payload: e.data.payload });
    port.onmessage = (m) => onCmd(m.data);
    send('xc.loaded', { model: outfit });
    send('xc.outfit-changed', { id: outfit, name: outfit, initial: true });
    send('xc.scene-changed', { id: scene, transparent: scene === 'transparent', initial: true });
  }
});
function onCmd(env) {
  received.push(env);
  const p = env.payload || {};
  if (env.type === 'xc.setOutfit') {
    if (p.id === 'busy_one') return send('xc.error', { code: 'busy', message: 'superseded', command: env.type }, env.id);
    if (!own(OUT, p.id)) return send('xc.error', { code: 'unknown_id', message: 'unknown outfit: ' + p.id, command: env.type }, env.id);
    const prev = outfit, noop = prev === p.id; outfit = p.id;
    setTimeout(() => send('xc.outfit-changed', { id: p.id, name: p.id, previous: prev, ...(noop ? { noop: true } : {}) }, env.id), p.id === 'slow_one' ? 250 : 5);
  } else if (env.type === 'xc.prefetch') {
    const ids = p.ids || ['xiaochun_maid', 'xiaochun_dinner_dress'];
    send('xc.prefetched', { downloaded: ids.filter((x) => x !== 'busy_one'), cached: [], failed: ids.filter((x) => x === 'busy_one') }, env.id);
  } else if (env.type === 'xc.setScene') {
    if (!['light', 'dark', 'transparent'].includes(p.id)) return send('xc.error', { code: 'unknown_id', message: 'unknown scene', command: env.type }, env.id);
    const prev = scene; scene = p.id;
    send('xc.scene-changed', { id: p.id, transparent: p.id === 'transparent', previous: prev, ...(prev === p.id ? { noop: true } : {}) }, env.id);
  }
}
</script></body>`;

const hostHtml = `<!doctype html><body style="margin:0"><div id="root"></div><div id="a" style="position:absolute;left:100px;top:100px"></div>
<script type="module">
  import * as XC from '/dist/index.js'; import '/dist/element.js';
  window.XC = XC; window.__ready = true;
</script></body>`;

const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox'] });
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log('ok   -', name); } catch (e) { failed++; console.log('FAIL -', name, '\n  ', e.message); } };

async function newPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700 });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.host === 'host.test') {
      if (u.pathname === '/') return r.respond({ contentType: 'text/html', body: hostHtml });
      if (u.pathname === '/react.js') return r.respond({ contentType: 'text/javascript', body: reactBundle });
      const f = path.join(dist, u.pathname.replace(/^\/dist\//, ''));
      if (u.pathname.startsWith('/dist/') && existsSync(f)) return r.respond({ contentType: 'text/javascript', body: readFileSync(f) });
      return r.respond({ status: 404, body: '' });
    }
    if (u.host === 'frame.test') return r.respond({ contentType: 'text/html', body: frameHtml });
    return r.abort();
  });
  await page.evaluateOnNewDocument(() => {
    window.__pm = 0; window.__warns = [];
    const add = window.addEventListener.bind(window), rem = window.removeEventListener.bind(window);
    window.addEventListener = (t, ...a) => { if (t === 'pointermove') window.__pm++; return add(t, ...a); };
    window.removeEventListener = (t, ...a) => { if (t === 'pointermove') window.__pm--; return rem(t, ...a); };
    const w = console.warn.bind(console); console.warn = (...a) => { window.__warns.push(a.join(' ')); w(...a); };
  });
  await page.goto('http://host.test/');
  await page.waitForFunction(() => window.__ready);
  return page;
}
const frameOf = (page) => page.frames().find((f) => f.url().startsWith('http://frame.test'));
const received = async (page) => (await frameOf(page).evaluate(() => window.__received)).filter((m) => m.type !== 'xc.pause' && m.type !== 'xc.resume');
const cmds = async (page) => (await received(page)).map((m) => m.type);
const mk = (page, opts) => page.evaluate(async (opts) => {
  const xc = window.XC.createXiaochun({ container: '#a', src: 'http://frame.test/embed', lazy: false, width: 200, height: 300, ...opts });
  window.xc = xc; window.events = [];
  for (const ev of ['outfit-changed', 'scene-changed', 'error', 'ready']) xc.on(ev, (p) => window.events.push([ev, p]));
  return true;
}, opts);
const settle = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 120)));
const handshake = (page) => page.waitForFunction(() => window.xc && window.events.some((e) => e[0] === 'scene-changed'));
const msg = (e) => String(e.message || e);
const iframeState = (page) => page.evaluate(() => {
  const w = document.querySelector('[data-xiaochun]'); const f = w.querySelector('iframe');
  return { bg: w.style.background, pe: f.style.pointerEvents, pm: window.__pm, src: f.src };
});

await check('新 iframe: getOutfits / getScenes 取自 capabilities; setOutfit 在 outfit-changed 之后 resolve', async () => {
  const page = await newPage(); await mk(page, {}); await handshake(page);
  const lists = await page.evaluate(async () => ({ o: (await xc.getOutfits()).map((x) => x.id), s: (await xc.getScenes()).map((x) => x.id) }));
  assert.deepEqual(lists.o, ['xiaochun_maid', 'xiaochun_dinner_dress', 'slow_one', 'busy_one']);
  assert.deepEqual(lists.s, ['light', 'dark', 'transparent']);
  assert.equal(await page.evaluate(() => xc.outfit), 'xiaochun_dinner_dress');
  const t = await page.evaluate(async () => { const t0 = performance.now(); await xc.setOutfit('slow_one'); return { dt: performance.now() - t0, outfit: xc.outfit }; });
  assert.ok(t.dt >= 200, `应等到 iframe 应答 (${t.dt}ms)`); assert.equal(t.outfit, 'slow_one');
  const ev = await page.evaluate(() => window.events.filter((e) => e[0] === 'outfit-changed').map((e) => e[1].id + (e[1].initial ? ':initial' : '')));
  assert.deepEqual(ev, ['xiaochun_dinner_dress:initial', 'slow_one']);
  await page.close();
});

await check('noop 应答: resolve 但不重复触发 outfit-changed 事件', async () => {
  const page = await newPage(); await mk(page, { outfit: 'xiaochun_maid' }); await handshake(page);
  await page.evaluate(() => xc.setOutfit('xiaochun_maid'));
  const n = await page.evaluate(() => window.events.filter((e) => e[0] === 'outfit-changed').length);
  assert.equal(n, 1); // 只有 initial
  await page.close();
});

await check('非法 id: 格式不合法本地 reject 且不发给 iframe; 合法格式的原型键 (constructor) 由 iframe 回 unknown_id', async () => {
  const page = await newPage(); await mk(page, {}); await handshake(page);
  const r = await page.evaluate(async () => {
    const out = [];
    for (const id of ['Bad-Id', '__proto__', '', '../x', 'a b', 5, null]) { try { await xc.setOutfit(id); out.push('resolved'); } catch (e) { out.push(String(e.message)); } }
    try { await xc.setScene('Dark'); out.push('resolved'); } catch (e) { out.push(String(e.message)); }
    return out;
  });
  assert.ok(r.every((m) => /^\[bad_request\]/.test(m)), JSON.stringify(r));
  assert.deepEqual((await cmds(page)).filter((t) => t.startsWith('xc.set')), []); // 一条都没发出去
  const e = await page.evaluate(async () => { try { await xc.setOutfit('constructor'); return 'resolved'; } catch (e) { return String(e.message); } });
  assert.match(e, /^\[unknown_id\]/);
  assert.deepEqual((await cmds(page)).filter((t) => t.startsWith('xc.set')), ['xc.setOutfit']);
  await page.close();
});

await check('busy 透传: iframe 回 busy → Promise reject [busy], error 事件也触发', async () => {
  const page = await newPage(); await mk(page, {}); await handshake(page);
  const e = await page.evaluate(async () => { try { await xc.setOutfit('busy_one'); return 'resolved'; } catch (e) { return String(e.message); } });
  assert.match(e, /^\[busy\]/);
  assert.ok(await page.evaluate(() => window.events.some((x) => x[0] === 'error' && x[1].code === 'busy')));
  await page.close();
});

await check('旧 iframe (capabilities 无 outfits/scenes): setOutfit / setScene 本地 reject unsupported, 不发命令; getOutfits=[]', async () => {
  const page = await newPage();
  await page.evaluate(() => { window.__early = null; });
  await mk(page, { src: 'http://frame.test/embed?caps=old' });
  // 握手前就调用 (命令进队列): 握手后按 capabilities 判定
  const early = page.evaluate(async () => { try { await xc.setOutfit('xiaochun_maid'); return 'resolved'; } catch (e) { return String(e.message); } });
  await page.waitForFunction(() => window.events.some((e) => e[0] === 'scene-changed'));
  assert.match(await early, /^\[unsupported\]/);
  const late = await page.evaluate(async () => {
    const out = [];
    for (const f of [() => xc.setOutfit('xiaochun_maid'), () => xc.setScene('dark')]) { try { await f(); out.push('resolved'); } catch (e) { out.push(String(e.message)); } }
    return [...out, (await xc.getOutfits()).length, (await xc.getScenes()).length];
  });
  assert.match(late[0], /^\[unsupported\]/); assert.match(late[1], /^\[unsupported\]/);
  assert.deepEqual(late.slice(2), [0, 0]);
  assert.deepEqual((await cmds(page)).filter((t) => t.startsWith('xc.set')), []);
  await page.close();
});

await check('运行时切 scene: 外壳背景 / 穿透监听 / pointer-events 同步, 并校正 transparent', async () => {
  const page = await newPage(); await mk(page, { transparent: true }); await handshake(page);
  let st = await iframeState(page);
  assert.equal(st.bg, ''); assert.equal(st.pe, 'none'); assert.equal(st.pm, 1);
  await page.evaluate(() => xc.setScene('light'));
  st = await iframeState(page);
  assert.match(st.bg, /var\(--xc-bg/); assert.equal(st.pe, 'auto'); assert.equal(st.pm, 0); // 非透明: 强制 auto, 穿透监听关闭
  // 非透明下 hit-region 不会把 pointer-events 切回 none
  await frameOf(page).evaluate(() => window.parent && 0);
  await page.evaluate(() => xc.setScene('transparent'));
  st = await iframeState(page);
  assert.equal(st.bg, ''); assert.equal(st.pe, 'none'); assert.equal(st.pm, 1);
  // 再切一次相同 scene (noop) 不应改变任何状态, 监听也不会重复叠加
  await page.evaluate(() => xc.setScene('transparent'));
  assert.equal((await iframeState(page)).pm, 1);
  for (let i = 0; i < 5; i++) await page.evaluate(async () => { await xc.setScene('dark'); await xc.setScene('transparent'); });
  assert.equal((await iframeState(page)).pm, 1);
  await page.close();
});

await check('切回透明后宿主 pointermove 重新转发 xc.pointer (穿透恢复工作)', async () => {
  const page = await newPage(); await mk(page, { transparent: true }); await handshake(page);
  await page.evaluate(() => xc.setScene('dark'));
  await page.mouse.move(150, 150); await settle(page);
  assert.ok(!(await cmds(page)).includes('xc.pointer'), '非透明场景不应转发 xc.pointer');
  await page.evaluate(() => xc.setScene('transparent'));
  // 跨站 iframe (OOPIF) 的命中测试数据随渲染帧更新: pointer-events 改完要等一帧, 并把鼠标移出再移入
  await settle(page); await page.mouse.move(5, 5); await settle(page); await page.mouse.move(160, 160); await page.mouse.move(180, 190); await settle(page);
  assert.ok((await cmds(page)).includes('xc.pointer'), '透明场景应转发 xc.pointer');
  await page.close();
});

await check('非透明起步 → 切 transparent 后开启穿透; 显式 passthrough:false 时保持关闭', async () => {
  let page = await newPage(); await mk(page, {}); await handshake(page);
  let st = await iframeState(page); assert.equal(st.pe, 'auto'); assert.equal(st.pm, 0);
  await page.evaluate(() => xc.setScene('transparent'));
  st = await iframeState(page); assert.equal(st.pe, 'none'); assert.equal(st.pm, 1);
  await page.close();
  page = await newPage(); await mk(page, { transparent: true, passthrough: false }); await handshake(page);
  await page.evaluate(() => xc.setScene('dark')); await page.evaluate(() => xc.setScene('transparent'));
  st = await iframeState(page); assert.equal(st.pe, 'auto'); assert.equal(st.pm, 0);
  await page.close();
});

await check('iframe URL: scene / outfit / transparent 参数; 旧 model 选项 = outfit 别名并 warn; URL 型 model 不进 URL', async () => {
  const page = await newPage();
  await mk(page, { scene: 'dark', outfit: 'xiaochun_maid' }); await handshake(page);
  let u = new URL((await iframeState(page)).src);
  assert.equal(u.searchParams.get('scene'), 'dark'); assert.equal(u.searchParams.get('outfit'), 'xiaochun_maid'); assert.equal(u.searchParams.get('transparent'), null);
  await page.evaluate(() => xc.destroy());
  await mk(page, { transparent: true, model: 'xiaochun_maid' }); await handshake(page);
  u = new URL((await iframeState(page)).src);
  assert.equal(u.searchParams.get('transparent'), '1'); assert.equal(u.searchParams.get('scene'), 'transparent'); assert.equal(u.searchParams.get('outfit'), 'xiaochun_maid');
  assert.ok((await page.evaluate(() => window.__warns)).some((w) => /"model" is deprecated/.test(w)));
  await page.evaluate(() => xc.destroy());
  await mk(page, { model: 'https://evil.example/x.vrm' }); await handshake(page);
  u = new URL((await iframeState(page)).src);
  assert.equal(u.searchParams.get('outfit'), null);
  await page.close();
});

await check('allowCustomModel: 默认本地拒绝 setModel({url}); 内置 id 不受限; 打开后 xc.init 带 config 且命令发出', async () => {
  let page = await newPage(); await mk(page, {}); await handshake(page);
  const e = await page.evaluate(async () => { try { await xc.setModel({ url: 'https://a.example/x.vrm' }); return 'resolved'; } catch (e) { return String(e.message); } });
  assert.match(e, /^\[unsupported\]/);
  await page.evaluate(() => xc.setModel('xiaochun_maid')); await settle(page);
  let r = await received(page);
  assert.deepEqual(r.filter((m) => m.type === 'xc.setModel').map((m) => m.payload), [{ outfit: 'xiaochun_maid' }]);
  assert.equal(r.find((m) => m.type === 'xc.init').payload.config, undefined);
  await page.close();
  page = await newPage(); await mk(page, { allowCustomModel: true }); await handshake(page);
  await page.evaluate(() => xc.setModel({ url: 'https://a.example/x.vrm' })); await settle(page);
  r = await received(page);
  assert.deepEqual(r.find((m) => m.type === 'xc.init').payload.config, { allowCustomModel: true });
  assert.deepEqual(r.filter((m) => m.type === 'xc.setModel').map((m) => m.payload), [{ url: 'https://a.example/x.vrm' }]);
  await page.close();
});

await check('ui 选项 = 部件名数组: 进 iframe URL ?ui=; 默认无参数; 未知项忽略并 warn; 布尔 true = 弃用写法 (chat,bubble) 并 warn; 元素 ui 属性同理', async () => {
  const page = await newPage();
  await mk(page, {}); await handshake(page);
  let u = new URL((await iframeState(page)).src);
  assert.equal(u.searchParams.get('ui'), null, '默认不带 ui');
  await page.evaluate(() => xc.destroy());
  await mk(page, { ui: ['scene', 'outfit'] }); await handshake(page);
  u = new URL((await iframeState(page)).src);
  assert.equal(u.searchParams.get('ui'), 'outfit,scene');
  await page.evaluate(() => xc.destroy());
  await mk(page, { ui: ['chat', 'constructor', '__proto__', 'outfit'] }); await handshake(page);
  u = new URL((await iframeState(page)).src);
  assert.equal(u.searchParams.get('ui'), 'chat,outfit');
  assert.ok((await page.evaluate(() => window.__warns)).some((w) => /unknown ui part/.test(w) && /constructor/.test(w)));
  await page.evaluate(() => xc.destroy());
  await page.evaluate(() => { window.__warns.length = 0; });
  await mk(page, { ui: true }); await handshake(page);
  u = new URL((await iframeState(page)).src);
  assert.equal(u.searchParams.get('ui'), 'chat,bubble');
  assert.ok((await page.evaluate(() => window.__warns)).some((w) => /"ui: true" is deprecated/.test(w)));
  await page.evaluate(() => xc.destroy());
  await mk(page, { ui: [] }); await handshake(page);
  assert.equal(new URL((await iframeState(page)).src).searchParams.get('ui'), null);
  await page.evaluate(() => xc.destroy());
  // 元素属性
  const srcOf = (attrs) => page.evaluate((attrs) => {
    const el = document.createElement('xiaochun-avatar');
    el.setAttribute('src', 'http://frame.test/embed'); el.setAttribute('lazy', 'false');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return new Promise((res) => setTimeout(() => { const i = el.shadowRoot.querySelector('iframe'); const r = i && i.src; el.remove(); res(r); }, 300));
  }, attrs);
  assert.equal(new URL(await srcOf({ ui: 'outfit,scene' })).searchParams.get('ui'), 'outfit,scene');
  assert.equal(new URL(await srcOf({})).searchParams.get('ui'), null);
  assert.equal(new URL(await srcOf({ ui: '' })).searchParams.get('ui'), 'chat,bubble');
  await page.close();
});

await check('camera 选项: 进 iframe URL (?cameraFov= 等); 默认不带; 越界夹范围 / 非法整体忽略并 warn; setConfig{camera} 原样发出; 元素 camera-* 属性创建进 URL', async () => {
  const page = await newPage();
  const urlOf = async (opts) => { await mk(page, opts); await handshake(page); const u = new URL((await iframeState(page)).src); await page.evaluate(() => xc.destroy()); return u; };
  const d = await urlOf({});
  for (const k of ['cameraFov', 'cameraDistance', 'cameraHeight', 'cameraIntro']) assert.equal(d.searchParams.get(k), null, '默认不带 ' + k);
  const u = await urlOf({ camera: { fov: 45, distance: 3.5, height: -0.25, intro: false } });
  assert.deepEqual([u.searchParams.get('cameraFov'), u.searchParams.get('cameraDistance'), u.searchParams.get('cameraHeight'), u.searchParams.get('cameraIntro')], ['45', '3.5', '-0.25', '0']);
  assert.equal((await urlOf({ camera: { intro: true } })).searchParams.get('cameraIntro'), '1');
  assert.equal((await urlOf({ camera: { fov: null } })).searchParams.get('cameraFov'), null, 'null 不写进 URL');
  await page.evaluate(() => { window.__warns.length = 0; });
  assert.equal((await urlOf({ camera: { fov: 5, distance: 99 } })).searchParams.get('cameraFov'), '15', '越界夹到下限');
  assert.ok((await page.evaluate(() => window.__warns)).some((w) => /camera\.fov, camera\.distance out of range/.test(w)));
  await page.evaluate(() => { window.__warns.length = 0; });
  assert.equal((await urlOf({ camera: { fov: '30', pitch: 1 } })).searchParams.get('cameraFov'), null, '非法整体忽略');
  assert.ok((await page.evaluate(() => window.__warns)).some((w) => /invalid camera option/.test(w)));
  // 运行时 setConfig{camera} 原样发出
  await mk(page, {}); await handshake(page); await settle(page);
  await page.evaluate(() => xc.setConfig({ camera: { fov: 50, height: null } }));
  await settle(page);
  assert.deepEqual((await received(page)).filter((m) => m.type === 'xc.setConfig').at(-1).payload, { camera: { fov: 50, height: null } });
  await page.evaluate(() => xc.destroy());
  // 元素属性
  const srcOf = (attrs) => page.evaluate((attrs) => {
    const el = document.createElement('xiaochun-avatar');
    el.setAttribute('src', 'http://frame.test/embed'); el.setAttribute('lazy', 'false');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return new Promise((res) => setTimeout(() => { const i = el.shadowRoot.querySelector('iframe'); const r = i && i.src; el.remove(); res(r); }, 300));
  }, attrs);
  const eu = new URL(await srcOf({ 'camera-fov': '40', 'camera-distance': '2', 'camera-height': '0.1', 'camera-intro': 'false' }));
  assert.deepEqual([eu.searchParams.get('cameraFov'), eu.searchParams.get('cameraDistance'), eu.searchParams.get('cameraHeight'), eu.searchParams.get('cameraIntro')], ['40', '2', '0.1', '0']);
  assert.equal(new URL(await srcOf({})).searchParams.get('cameraFov'), null);
  await page.close();
});

await check('lang / github 部件 + uiAutoHide 选项: 进 iframe URL (?ui= / ?uiAutoHide=); 默认不带; 非法值忽略并 warn; 元素 ui-autohide 属性同理', async () => {
  const page = await newPage();
  const urlOf = async (opts) => { await mk(page, opts); await handshake(page); const u = new URL((await iframeState(page)).src); await page.evaluate(() => xc.destroy()); return u; };
  assert.equal((await urlOf({ ui: ['github', 'lang', 'outfit'] })).searchParams.get('ui'), 'outfit,lang,github');
  assert.equal((await urlOf({})).searchParams.get('uiAutoHide'), null, '默认不带 (iframe 用自己的默认 transparent)');
  assert.equal((await urlOf({ uiAutoHide: true })).searchParams.get('uiAutoHide'), 'true');
  assert.equal((await urlOf({ uiAutoHide: false })).searchParams.get('uiAutoHide'), 'false');
  assert.equal((await urlOf({ uiAutoHide: 'transparent' })).searchParams.get('uiAutoHide'), 'transparent');
  await page.evaluate(() => { window.__warns.length = 0; });
  assert.equal((await urlOf({ uiAutoHide: 'hover' })).searchParams.get('uiAutoHide'), null);
  assert.ok((await page.evaluate(() => window.__warns)).some((w) => /invalid uiAutoHide/.test(w)));
  const srcOf = (attrs) => page.evaluate((attrs) => {
    const el = document.createElement('xiaochun-avatar');
    el.setAttribute('src', 'http://frame.test/embed'); el.setAttribute('lazy', 'false');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return new Promise((res) => setTimeout(() => { const i = el.shadowRoot.querySelector('iframe'); const r = i && i.src; el.remove(); res(r); }, 300));
  }, attrs);
  assert.equal(new URL(await srcOf({ 'ui-autohide': 'false' })).searchParams.get('uiAutoHide'), 'false');
  assert.equal(new URL(await srcOf({})).searchParams.get('uiAutoHide'), null);
  assert.equal(new URL(await srcOf({ ui: 'lang,github' })).searchParams.get('ui'), 'lang,github');
  await page.close();
});

await check('不被宿主页文字选区染蓝: 外壳 / 占位图 / iframe 都是 user-select:none (CSSOM 内联样式, 不注入 <style>); 元素 (Shadow DOM) 同理', async () => {
  const page = await newPage();
  await mk(page, {}); await handshake(page);
  const st = await page.evaluate(() => {
    const w = document.querySelector('[data-xiaochun]'); const i = w.querySelector('iframe');
    return { w: getComputedStyle(w).userSelect, i: getComputedStyle(i).userSelect, iw: getComputedStyle(i).webkitUserSelect, styleTags: document.querySelectorAll('style').length };
  });
  assert.deepEqual([st.w, st.i, st.iw], ['none', 'none', 'none']);
  await page.evaluate(() => xc.destroy());
  const el = await page.evaluate(() => {
    const e = document.createElement('xiaochun-avatar'); e.setAttribute('src', 'http://frame.test/embed'); e.setAttribute('lazy', 'false'); document.body.appendChild(e);
    return new Promise((res) => setTimeout(() => { const i = e.shadowRoot.querySelector('iframe'); res({ i: getComputedStyle(i).userSelect, w: getComputedStyle(i.parentElement).userSelect }); e.remove(); }, 300));
  });
  assert.deepEqual([el.i, el.w], ['none', 'none']);
  await page.close();
});

await check('controls: 默认 (滚轮缩放放开) 不带参数; controls:false → ?controls=0; true 不带; 元素属性 controls="false" 同理', async () => {
  const page = await newPage();
  const urlOf = async (opts) => { await mk(page, opts); await handshake(page); const u = new URL((await iframeState(page)).src); await page.evaluate(() => xc.destroy()); return u; };
  assert.equal((await urlOf({})).searchParams.get('controls'), null);
  assert.equal((await urlOf({ controls: true })).searchParams.get('controls'), null);
  assert.equal((await urlOf({ controls: false })).searchParams.get('controls'), '0');
  const srcOf = (attrs) => page.evaluate((attrs) => {
    const el = document.createElement('xiaochun-avatar');
    el.setAttribute('src', 'http://frame.test/embed'); el.setAttribute('lazy', 'false');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return new Promise((res) => setTimeout(() => { const i = el.shadowRoot.querySelector('iframe'); const r = i && i.src; el.remove(); res(r); }, 300));
  }, attrs);
  assert.equal(new URL(await srcOf({})).searchParams.get('controls'), null);
  assert.equal(new URL(await srcOf({ controls: 'false' })).searchParams.get('controls'), '0');
  assert.equal(new URL(await srcOf({ controls: '' })).searchParams.get('controls'), null);
  await page.close();
});

await check('persist: 默认不存; "host" / 自定义 key 只在宿主 localStorage 写 setOutfit/setScene 的结果 (不写 initial); 显式选项优先; 坏数据忽略', async () => {
  let page = await newPage(); await mk(page, {}); await handshake(page);
  await page.evaluate(() => xc.setOutfit('xiaochun_maid')); await page.evaluate(() => xc.setScene('dark'));
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await page.evaluate(() => xc.destroy());
  await mk(page, { persist: 'host' }); await handshake(page);
  assert.equal(await page.evaluate(() => localStorage.getItem('xiaochun:prefs')), null); // initial 不写
  await page.evaluate(() => xc.setOutfit('xiaochun_maid')); await page.evaluate(() => xc.setScene('dark'));
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('xiaochun:prefs'))), { outfit: 'xiaochun_maid', scene: 'dark' });
  await page.evaluate(() => xc.destroy());
  await mk(page, { persist: 'host' }); await handshake(page);
  let u = new URL((await iframeState(page)).src);
  assert.equal(u.searchParams.get('outfit'), 'xiaochun_maid'); assert.equal(u.searchParams.get('scene'), 'dark');
  await page.evaluate(() => xc.destroy());
  await mk(page, { persist: 'host', outfit: 'slow_one', scene: 'transparent' }); await handshake(page);
  u = new URL((await iframeState(page)).src);
  assert.equal(u.searchParams.get('outfit'), 'slow_one'); assert.equal(u.searchParams.get('scene'), 'transparent'); // 显式 > 已保存
  await page.evaluate(() => xc.destroy());
  await page.evaluate(() => localStorage.setItem('k2', JSON.stringify({ outfit: '__proto__', scene: 'X Y', extra: 1 })));
  await mk(page, { persist: 'k2' }); await handshake(page);
  u = new URL((await iframeState(page)).src);
  assert.equal(u.searchParams.get('outfit'), null); assert.equal(u.searchParams.get('scene'), null);
  await page.evaluate(() => xc.setOutfit('slow_one'));
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('k2'))), { outfit: 'slow_one' });
  assert.equal(await page.evaluate(() => localStorage.getItem('xiaochun:prefs')) !== null, true); // 'host' key 未被 k2 实例动过
  await page.close();
});

await check('prefetch: 显式调用可用并返回结果; 非法 ids 本地拒绝; 自动预取只在 heavy:eager 且 prefetch 选项开启时发一次; 旧 iframe 本地 unsupported', async () => {
  let page = await newPage(); await mk(page, {}); await handshake(page);
  const r = await page.evaluate(() => xc.prefetch(['xiaochun_maid', 'busy_one']));
  assert.deepEqual(r, { downloaded: ['xiaochun_maid'], cached: [], failed: ['busy_one'] });
  const bad = await page.evaluate(async () => { try { await xc.prefetch(['Bad Id']); return 'resolved'; } catch (e) { return String(e.message); } });
  assert.match(bad, /^\[bad_request\]/);
  await settle(page);
  assert.equal((await received(page)).filter((m) => m.type === 'xc.prefetch').length, 1); // 只有显式那一次; 默认 lazy + 未开 prefetch 选项 → 无自动预取
  await page.close();
  // 开了 prefetch 但 heavy 是默认 lazy: 不自动预取
  page = await newPage(); await mk(page, { prefetch: true }); await handshake(page); await settle(page);
  assert.equal((await received(page)).filter((m) => m.type === 'xc.prefetch').length, 0);
  await page.close();
  // heavy:eager + prefetch:true → 首次 loaded 后自动发一次 (无 ids = 全部, 婚纱由 iframe 排除); 数组 → 只发这些
  page = await newPage(); await mk(page, { prefetch: true, heavy: 'eager' }); await handshake(page); await settle(page);
  let pf = (await received(page)).filter((m) => m.type === 'xc.prefetch');
  assert.equal(pf.length, 1); assert.deepEqual(pf[0].payload, {});
  await page.close();
  page = await newPage(); await mk(page, { prefetch: ['xiaochun_maid'], heavy: 'eager' }); await handshake(page); await settle(page);
  pf = (await received(page)).filter((m) => m.type === 'xc.prefetch');
  assert.deepEqual(pf.map((m) => m.payload), [{ ids: ['xiaochun_maid'] }]);
  await page.close();
  // 旧 iframe: 自动预取不打扰 (不发、不报错); 显式调用 reject unsupported
  page = await newPage(); await mk(page, { src: 'http://frame.test/embed?caps=old', prefetch: true, heavy: 'eager' }); await page.waitForFunction(() => window.events.some((e) => e[0] === 'scene-changed'));
  await settle(page);
  assert.equal((await received(page)).filter((m) => m.type === 'xc.prefetch').length, 0);
  assert.equal(await page.evaluate(() => window.events.filter((e) => e[0] === 'error').length), 0);
  assert.match(await page.evaluate(async () => { try { await xc.prefetch(); return 'resolved'; } catch (e) { return String(e.message); } }), /^\[unsupported\]/);
  await page.close();
});

await check('<xiaochun-avatar>: outfit / scene 属性热更新 (不重建 iframe), 事件透出', async () => {
  const page = await newPage();
  await page.evaluate(() => {
    const el = document.createElement('xiaochun-avatar');
    el.setAttribute('src', 'http://frame.test/embed'); el.setAttribute('lazy', 'false'); el.setAttribute('size', '200x300');
    el.setAttribute('outfit', 'xiaochun_maid'); el.setAttribute('scene', 'light');
    window.__evs = []; for (const n of ['xc-outfit-changed', 'xc-scene-changed']) el.addEventListener(n, (e) => window.__evs.push(n + ':' + e.detail.id));
    document.body.appendChild(el); window.el = el;
  });
  await page.waitForFunction(() => window.__evs.length >= 2);
  const before = await page.evaluate(() => el.shadowRoot.querySelector('iframe'));
  void before;
  await page.evaluate(() => { window.__if = el.shadowRoot.querySelector('iframe'); el.setAttribute('outfit', 'xiaochun_dinner_dress'); el.setAttribute('scene', 'dark'); });
  await page.waitForFunction(() => window.__evs.includes('xc-outfit-changed:xiaochun_dinner_dress') && window.__evs.includes('xc-scene-changed:dark'));
  assert.equal(await page.evaluate(() => el.shadowRoot.querySelector('iframe') === window.__if), true, 'iframe 不应被重建');
  assert.equal(page.frames().filter((f) => f.url().startsWith('http://frame.test')).length, 1);
  const t = await cmds(page);
  assert.ok(t.includes('xc.setOutfit') && t.includes('xc.setScene'));
  // 旧别名 model 热更新 (无 outfit 属性时)
  await page.evaluate(() => { el.removeAttribute('outfit'); el.setAttribute('model', 'xiaochun_maid'); });
  await page.waitForFunction(() => window.__evs.filter((e) => e.startsWith('xc-outfit-changed:')).length >= 3);
  await page.close();
});

await check('React: outfit / scene prop 变化走 effect 热更新, 不重建 iframe', async () => {
  const page = await newPage();
  await page.addScriptTag({ url: 'http://host.test/react.js' });
  await page.evaluate(() => window.__mountReact());
  await page.waitForFunction(() => window.__rlog.includes('scene:light') && window.__rlog.includes('outfit:xiaochun_maid'));
  const first = await page.evaluate(() => { window.__if = document.querySelector('iframe'); return 1; });
  void first;
  await page.evaluate(() => { window.__setOutfit('xiaochun_dinner_dress'); window.__setScene('dark'); });
  await page.waitForFunction(() => window.__rlog.includes('scene:dark') && window.__rlog.includes('outfit:xiaochun_dinner_dress'));
  assert.equal(await page.evaluate(() => document.querySelector('iframe') === window.__if), true);
  assert.equal(page.frames().filter((f) => f.url().startsWith('http://frame.test')).length, 1);
  await page.close();
});

// ───────────── iframe 手势 (xc.gesture-move / xc.gesture-resize): 宿主侧校验 / 限幅 / 热更新 ─────────────
const boxOf = (page) => page.evaluate(() => { const r = document.querySelector('[data-xiaochun]').getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
const post = (page, type, payload) => frameOf(page).evaluate((t, p) => window.__post(t, p), type, payload);
/** 从 stub iframe 发一个完整手势: start → 每个 total 一条 move → end。 */
async function gesture(page, kind, gestureId, totals, extra = {}) {
  const type = kind === 'move' ? 'xc.gesture-move' : 'xc.gesture-resize';
  const base = { gesture: gestureId, dx: 0, dy: 0, ...extra };
  await post(page, type, { ...base, seq: 0, phase: 'start', totalDx: 0, totalDy: 0 });
  let seq = 0;
  for (const [x, y] of totals) await post(page, type, { ...base, seq: ++seq, phase: 'move', totalDx: x, totalDy: y });
  const [lx, ly] = totals[totals.length - 1] ?? [0, 0];
  await post(page, type, { ...base, seq: ++seq, phase: 'end', totalDx: lx, totalDy: ly, reason: 'up' });
  await settle(page);
}
const evs = (page, n) => page.evaluate((n) => window.events.filter((e) => e[0] === n).map((e) => e[1].phase), n);
const mkG = (page, opts) => page.evaluate(async (opts) => {
  const xc = window.XC.createXiaochun({ container: '#a', src: 'http://frame.test/embed', lazy: false, width: 200, height: 300, ...opts });
  window.xc = xc; window.events = [];
  for (const ev of ['outfit-changed', 'scene-changed', 'error', 'ready', 'move', 'resize']) xc.on(ev, (p) => window.events.push([ev, p]));
  return true;
}, opts);
const cfgOf = async (page) => (await received(page)).filter((m) => m.type === 'xc.setConfig').map((m) => m.payload.gestures);
const initOf = async (page) => (await received(page)).find((m) => m.type === 'xc.init');
const start0 = { dx: 0, dy: 0, totalDx: 0, totalDy: 0 };

await check('手势协议: 默认关闭 — xc.init 不带 gestures 配置, iframe 发来的手势消息一律忽略, 位置 / 尺寸 / 事件都不变', async () => {
  const page = await newPage(); await mkG(page, {}); await handshake(page); await settle(page);
  assert.equal((await initOf(page)).payload.config, undefined);
  const before = await boxOf(page);
  await gesture(page, 'move', 1, [[50, 60]]);
  await gesture(page, 'resize', 1, [[50, 60]], { corner: 'SE' });
  assert.deepEqual(await boxOf(page), before);
  assert.deepEqual(await evs(page, 'move'), []); assert.deepEqual(await evs(page, 'resize'), []);
  await page.close();
});

await check('手势协议: draggable (内联) — 握手带 gestures{move:true}; 跟手、夹在视口内、事件 start/move/end; 伪造 / 重放 / 乱序 / resize 消息被拒', async () => {
  const page = await newPage(); await mkG(page, { draggable: true }); await handshake(page); await settle(page);
  assert.deepEqual((await initOf(page)).payload.config.gestures, { move: true, resize: false });
  assert.deepEqual(await boxOf(page), { l: 100, t: 100, w: 200, h: 300 });
  await gesture(page, 'move', 1, [[10, 10], [30, 40]]);
  assert.deepEqual(await boxOf(page), { l: 130, t: 140, w: 200, h: 300 });
  assert.match(await page.evaluate(() => document.querySelector('[data-xiaochun]').style.translate), /30px 40px/);
  assert.deepEqual(await evs(page, 'move'), ['start', 'move', 'move', 'end']);
  await gesture(page, 'move', 2, [[5000, 5000]]);
  assert.deepEqual(await boxOf(page), { l: 700, t: 400, w: 200, h: 300 }, '往右下拖爆 → 贴视口右 / 下边');
  await gesture(page, 'move', 3, [[-5000, -5000]]);
  assert.deepEqual(await boxOf(page), { l: 0, t: 0, w: 200, h: 300 }, '往左上拖爆 → 贴 0,0');
  // 伪造 / 重放 / 乱序 / 非法: 只有 gesture 5 里 seq 严格递增且合法的那一条 (seq=2, 70,70) 生效
  await post(page, 'xc.gesture-move', { gesture: 4, seq: 3, phase: 'move', dx: 0, dy: 0, totalDx: 50, totalDy: 50 }); // 没有 start
  await post(page, 'xc.gesture-move', { gesture: 3, seq: 0, phase: 'start', ...start0 }); // 旧手势号重放
  await post(page, 'xc.gesture-move', { gesture: 5, seq: 0, phase: 'start', ...start0 });
  await post(page, 'xc.gesture-move', { gesture: 5, seq: 2, phase: 'move', dx: 0, dy: 0, totalDx: 70, totalDy: 70 });
  await post(page, 'xc.gesture-move', { gesture: 5, seq: 1, phase: 'move', dx: 0, dy: 0, totalDx: 90, totalDy: 90 }); // seq 倒退
  await post(page, 'xc.gesture-move', { gesture: 5, seq: 3, phase: 'move', dx: 0, dy: 0, totalDx: 'x', totalDy: 1 }); // 非数字
  await post(page, 'xc.gesture-move', { gesture: 5, seq: 4, phase: 'move', dx: 0, dy: 0, totalDx: 1e9, totalDy: 1 }); // 量级离谱
  await post(page, 'xc.gesture-resize', { gesture: 1, seq: 0, phase: 'start', ...start0, corner: 'SE' }); // resizable 没开
  await post(page, 'xc.gesture-resize', { gesture: 1, seq: 1, phase: 'move', dx: 0, dy: 0, totalDx: 90, totalDy: 90, corner: 'SE' });
  await settle(page);
  assert.deepEqual(await boxOf(page), { l: 70, t: 70, w: 200, h: 300 });
  assert.deepEqual(await evs(page, 'resize'), []);
  await page.close();
});

await check('手势协议: resizable — 对角固定、最小 / 最大 / 视口夹紧、尺寸写成 px、iframe 不重建; 非法 corner 被拒; 自定义限幅', async () => {
  const page = await newPage(); await mkG(page, { resizable: true }); await handshake(page); await settle(page);
  assert.deepEqual((await initOf(page)).payload.config.gestures, { move: false, resize: true });
  await page.evaluate(() => { window.__if = document.querySelector('iframe'); });
  await gesture(page, 'resize', 1, [[30, 20], [60, 40]], { corner: 'SE' });
  assert.deepEqual(await boxOf(page), { l: 100, t: 100, w: 260, h: 340 }, 'SE: 左上固定');
  await gesture(page, 'resize', 2, [[-20, -10]], { corner: 'NW' });
  assert.deepEqual(await boxOf(page), { l: 80, t: 90, w: 280, h: 350 }, 'NW: 右下 (360,440) 固定');
  await gesture(page, 'resize', 3, [[-10, 15]], { corner: 'NE' });
  assert.deepEqual(await boxOf(page), { l: 80, t: 105, w: 270, h: 335 }, 'NE: 左下 (80,440) 固定');
  await gesture(page, 'resize', 4, [[-20, 30]], { corner: 'SW' });
  assert.deepEqual(await boxOf(page), { l: 60, t: 105, w: 290, h: 365 }, 'SW: 右上 (350,105) 固定');
  await gesture(page, 'resize', 5, [[9999, 9999]], { corner: 'SE' });
  assert.deepEqual(await boxOf(page), { l: 60, t: 105, w: 840, h: 595 }, 'SE 拖爆: 不越过视口右 / 下边');
  await gesture(page, 'resize', 6, [[9999, 9999]], { corner: 'NW' });
  assert.deepEqual(await boxOf(page), { l: 780, t: 520, w: 120, h: 180 }, 'NW 拖爆: 最小 120x180, 右下 (900,700) 固定');
  await gesture(page, 'resize', 7, [[-9999, -9999]], { corner: 'NW' });
  assert.deepEqual(await boxOf(page), { l: 0, t: 0, w: 900, h: 700 }, 'NW 往外拖爆: 不越过视口左 / 上边');
  await post(page, 'xc.gesture-resize', { gesture: 8, seq: 0, phase: 'start', ...start0, corner: 'XX' });
  await post(page, 'xc.gesture-resize', { gesture: 8, seq: 1, phase: 'move', dx: 0, dy: 0, totalDx: -300, totalDy: -300, corner: 'XX' });
  await settle(page);
  assert.deepEqual(await boxOf(page), { l: 0, t: 0, w: 900, h: 700 }, '非法 corner 被拒');
  assert.equal(await page.evaluate(() => document.querySelector('iframe') === window.__if), true, 'iframe 没有被重建');
  assert.equal(page.frames().filter((f) => f.url().startsWith('http://frame.test')).length, 1);
  assert.ok((await evs(page, 'resize')).includes('end'));
  await page.close();
  // 自定义限幅
  const p2 = await newPage(); await mkG(p2, { resizable: { minWidth: 150, minHeight: 200, maxWidth: 300, maxHeight: 350 } }); await handshake(p2); await settle(p2);
  await gesture(p2, 'resize', 1, [[500, 500]], { corner: 'SE' });
  assert.deepEqual(await boxOf(p2), { l: 100, t: 100, w: 300, h: 350 });
  await gesture(p2, 'resize', 2, [[-500, -500]], { corner: 'SE' });
  assert.deepEqual(await boxOf(p2), { l: 100, t: 100, w: 150, h: 200 });
  await p2.close();
});

await check('手势协议: 悬浮 (bottom-right) 拖动改 left/top 并清掉 right/bottom; 窗口变小后夹回视口', async () => {
  const page = await newPage(); await mkG(page, { draggable: true, position: 'bottom-right' }); await handshake(page); await settle(page);
  assert.deepEqual(await boxOf(page), { l: 684, t: 384, w: 200, h: 300 });
  await gesture(page, 'move', 1, [[-300, -200]]);
  assert.deepEqual(await boxOf(page), { l: 384, t: 184, w: 200, h: 300 });
  const st = await page.evaluate(() => { const s = document.querySelector('[data-xiaochun]').style; return [s.left, s.top, s.right, s.bottom]; });
  assert.deepEqual(st, ['384px', '184px', 'auto', 'auto']);
  assert.ok(await page.evaluate(() => !document.querySelector('[aria-label="drag"]')), '不再有悬浮拖动手柄');
  await page.setViewport({ width: 500, height: 400 });
  await settle(page);
  const b = await boxOf(page);
  assert.ok(b.l + b.w <= 500 && b.t + b.h <= 400 && b.l >= 0 && b.t >= 0, '窗口变小后仍在视口内 ' + JSON.stringify(b));
  await page.close();
});

await check('手势协议: 运行时开关 setDraggable / setResizable — 发 xc.setConfig{gestures}, 关闭后同一 iframe 的手势被忽略, 不重建 iframe', async () => {
  const page = await newPage(); await mkG(page, {}); await handshake(page); await settle(page);
  await page.evaluate(() => { window.__if = document.querySelector('iframe'); xc.setDraggable(true); });
  await settle(page);
  assert.deepEqual(await cfgOf(page), [{ move: true, resize: false }]);
  await gesture(page, 'move', 1, [[20, 20]]);
  assert.deepEqual(await boxOf(page), { l: 120, t: 120, w: 200, h: 300 });
  await page.evaluate(() => xc.setResizable({ minWidth: 100 }));
  await settle(page);
  assert.deepEqual((await cfgOf(page)).at(-1), { move: true, resize: true });
  await page.evaluate(() => xc.setDraggable(false)); await page.evaluate(() => xc.setResizable(false));
  await settle(page);
  assert.deepEqual((await cfgOf(page)).at(-1), { move: false, resize: false });
  await gesture(page, 'move', 2, [[200, 200]]);
  await gesture(page, 'resize', 1, [[50, 50]], { corner: 'SE' });
  assert.deepEqual(await boxOf(page), { l: 120, t: 120, w: 200, h: 300 }, '关闭后忽略');
  await page.evaluate(() => xc.setDraggable(false)); await settle(page);
  assert.equal((await cfgOf(page)).length, 4, '没有变化不重复发 (开 move、开 resize、关 move、关 resize 各一条)');
  // 手势进行到一半被关闭: 收尾 (emit end), 之后的迟到消息被拒
  await page.evaluate(() => xc.setDraggable(true)); await settle(page);
  await post(page, 'xc.gesture-move', { gesture: 3, seq: 0, phase: 'start', ...start0 });
  await page.evaluate(() => xc.setDraggable(false)); await settle(page);
  await post(page, 'xc.gesture-move', { gesture: 3, seq: 1, phase: 'move', dx: 0, dy: 0, totalDx: 80, totalDy: 80 });
  await settle(page);
  assert.deepEqual(await boxOf(page), { l: 120, t: 120, w: 200, h: 300 });
  assert.equal((await evs(page, 'move')).at(-1), 'end');
  // setSize 不重建
  await page.evaluate(() => xc.setSize(260, '320px'));
  assert.deepEqual(await boxOf(page), { l: 120, t: 120, w: 260, h: 320 });
  assert.equal(await page.evaluate(() => document.querySelector('iframe') === window.__if), true);
  await page.close();
});

await check('手势协议: 旧版 iframe (无 capabilities.gestures) — 握手不带 gestures, resizable / 内联 draggable 触发一次 unsupported, 手势消息被忽略; 悬浮 draggable 同样触发 unsupported', async () => {
  let page = await newPage(); await mkG(page, { src: 'http://frame.test/embed?caps=old', draggable: true, resizable: true });
  await page.waitForFunction(() => window.events.some((e) => e[0] === 'scene-changed')); await settle(page);
  assert.equal((await initOf(page)).payload.config, undefined);
  const errs = await page.evaluate(() => window.events.filter((e) => e[0] === 'error').map((e) => e[1]));
  assert.equal(errs.length, 1); assert.equal(errs[0].code, 'unsupported'); assert.match(errs[0].message, /draggable \/ resizable/);
  await gesture(page, 'move', 1, [[50, 50]]);
  assert.deepEqual(await boxOf(page), { l: 100, t: 100, w: 200, h: 300 });
  await page.close();
  page = await newPage(); await mkG(page, { src: 'http://frame.test/embed?caps=old', draggable: true, position: 'bottom-right' });
  await page.waitForFunction(() => window.events.some((e) => e[0] === 'scene-changed')); await settle(page);
  const errs2 = await page.evaluate(() => window.events.filter((e) => e[0] === 'error').map((e) => e[1]));
  assert.equal(errs2.length, 1); assert.equal(errs2[0].code, 'unsupported');
  assert.ok(await page.evaluate(() => !document.querySelector('[aria-label="drag"]')));
  await page.close();
});

const radiusNow = (page) => page.evaluate(() => { const w = document.querySelector('[data-xiaochun]'); const i = w.querySelector('iframe'); return [getComputedStyle(w).borderTopLeftRadius, i ? getComputedStyle(i).borderTopLeftRadius : null]; });
await check('圆角: 非透明默认 20px (= Tauri 窗口圆角), 透明 0; borderRadius 选项 / setBorderRadius / 场景切换 / --xc-radius; 全部不重建 iframe', async () => {
  let page = await newPage(); await mkG(page, { scene: 'light' }); await handshake(page); await settle(page);
  assert.deepEqual(await radiusNow(page), ['20px', '20px']);
  await page.evaluate(() => { window.__if = document.querySelector('iframe'); xc.setSize(260, 340); });
  assert.deepEqual(await radiusNow(page), ['20px', '20px'], '缩放不改半径');
  await page.evaluate(() => xc.setBorderRadius(32)); assert.deepEqual(await radiusNow(page), ['32px', '32px']);
  await page.evaluate(() => xc.setBorderRadius('12px')); assert.deepEqual(await radiusNow(page), ['12px', '12px']);
  await page.evaluate(() => xc.setBorderRadius(undefined)); assert.deepEqual(await radiusNow(page), ['20px', '20px']);
  await page.evaluate(() => xc.setScene('transparent')); await page.waitForFunction(() => document.querySelector('iframe').style.pointerEvents === 'none' || true);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(await radiusNow(page), ['0px', '0px'], '透明场景不裁角');
  await page.evaluate(() => xc.setScene('dark')); await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(await radiusNow(page), ['20px', '20px']);
  await page.evaluate(() => { document.querySelector('#a').style.setProperty('--xc-radius', '6px'); });
  assert.deepEqual(await radiusNow(page), ['6px', '6px'], '--xc-radius 优先');
  assert.equal(await page.evaluate(() => document.querySelector('iframe') === window.__if), true, 'iframe 没有被重建');
  await page.close();
  page = await newPage(); await mkG(page, { scene: 'light', borderRadius: 0 }); await handshake(page);
  assert.deepEqual(await radiusNow(page), ['0px', '0px'], 'borderRadius:0 = 方角');
  await page.close();
  // <xiaochun-avatar border-radius>: 热更新
  page = await newPage();
  await page.evaluate(() => {
    const el = document.createElement('xiaochun-avatar');
    el.setAttribute('src', 'http://frame.test/embed'); el.setAttribute('lazy', 'false'); el.setAttribute('transparent', 'false'); el.setAttribute('scene', 'light');
    document.body.appendChild(el); window.el = el;
  });
  await page.waitForFunction(() => el.shadowRoot.querySelector('iframe'));
  const rad = () => page.evaluate(() => getComputedStyle(el.shadowRoot.querySelector('iframe')).borderTopLeftRadius);
  assert.equal(await rad(), '20px');
  await page.evaluate(() => { window.__if = el.shadowRoot.querySelector('iframe'); el.setAttribute('border-radius', '9'); });
  assert.equal(await rad(), '9px');
  await page.evaluate(() => el.setAttribute('border-radius', '1.5rem'));
  assert.notEqual(await rad(), '20px');
  await page.evaluate(() => el.removeAttribute('border-radius'));
  assert.equal(await rad(), '20px');
  assert.equal(await page.evaluate(() => el.shadowRoot.querySelector('iframe') === window.__if), true, '属性热更新不重建 iframe');
  await page.close();
});

await check('<xiaochun-avatar>: size / draggable / resizable / min-size 属性热更新 (不重建 iframe); xc-move / xc-resize 事件透出', async () => {
  const page = await newPage();
  await page.evaluate(() => {
    const el = document.createElement('xiaochun-avatar');
    el.setAttribute('src', 'http://frame.test/embed'); el.setAttribute('lazy', 'false'); el.setAttribute('size', '200x300'); el.setAttribute('transparent', 'false');
    window.__evs = []; for (const n of ['xc-move', 'xc-resize']) el.addEventListener(n, (e) => window.__evs.push(n + ':' + e.detail.phase));
    el.style.cssText = 'position:absolute;left:100px;top:100px';
    document.body.appendChild(el); window.el = el;
  });
  await page.waitForFunction(() => el.shadowRoot.querySelector('iframe') && el.shadowRoot.querySelector('[data-xiaochun]'));
  await page.waitForFunction(() => window.__received === undefined); // 宿主页没有 __received (它在 iframe 里)
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => { window.__if = el.shadowRoot.querySelector('iframe'); el.setAttribute('size', '240x360'); });
  assert.deepEqual(await page.evaluate(() => { const r = el.shadowRoot.querySelector('[data-xiaochun]').getBoundingClientRect(); return [r.width, r.height]; }), [240, 360]);
  await page.evaluate(() => { el.setAttribute('draggable', ''); el.setAttribute('resizable', ''); el.setAttribute('min-size', '150x200'); });
  await settle(page);
  const cfgs = await cfgOf(page);
  assert.deepEqual(cfgs.at(-1), { move: true, resize: true });
  await gesture(page, 'move', 1, [[40, 30]]);
  await gesture(page, 'resize', 1, [[-9999, -9999]], { corner: 'SE' });
  const r = await page.evaluate(() => { const b = el.shadowRoot.querySelector('[data-xiaochun]').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
  assert.deepEqual(r, [150, 200], 'min-size 属性生效');
  assert.ok((await page.evaluate(() => window.__evs)).includes('xc-move:end') && (await page.evaluate(() => window.__evs)).includes('xc-resize:end'));
  assert.equal(await page.evaluate(() => el.shadowRoot.querySelector('iframe') === window.__if), true, 'iframe 没有被重建');
  assert.equal(page.frames().filter((f) => f.url().startsWith('http://frame.test')).length, 1);
  await page.evaluate(() => { el.removeAttribute('draggable'); el.removeAttribute('resizable'); });
  await settle(page);
  assert.deepEqual((await cfgOf(page)).at(-1), { move: false, resize: false });
  await page.close();
});

await check('React: width / height / draggable / resizable prop 变化走 effect 热更新, 不重建 iframe; onMove / onResize 回调', async () => {
  const page = await newPage();
  await page.addScriptTag({ url: 'http://host.test/react.js' });
  await page.evaluate(() => window.__mountReact());
  await page.waitForFunction(() => window.__rlog.includes('scene:light'));
  await page.evaluate(() => { window.__if = document.querySelector('iframe'); window.__setSize([260, 340]); window.__setG({ draggable: true, resizable: true }); });
  await settle(page);
  assert.equal(await page.evaluate(() => document.querySelector('iframe') === window.__if), true, 'width/height/手势开关变化不应重建 iframe');
  const r = await page.evaluate(() => { const b = document.querySelector('[data-xiaochun]').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
  assert.deepEqual(r, [260, 340]);
  assert.deepEqual((await cfgOf(page)).at(-1), { move: true, resize: true });
  await gesture(page, 'resize', 1, [[40, 40]], { corner: 'SE' });
  assert.deepEqual(await page.evaluate(() => window.__rlog.filter((x) => x.startsWith('resize:'))), ['resize:start', 'resize:move', 'resize:end']);
  // 宿主把用户缩放后的尺寸写回 props (相同值): 仍不重建, 也不把尺寸改回去
  const grown = await page.evaluate(() => { const b = document.querySelector('[data-xiaochun]').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
  await page.evaluate((g) => window.__setSize(g), grown);
  await settle(page);
  assert.equal(await page.evaluate(() => document.querySelector('iframe') === window.__if), true);
  assert.deepEqual(await page.evaluate(() => { const b = document.querySelector('[data-xiaochun]').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }), grown);
  assert.equal(page.frames().filter((f) => f.url().startsWith('http://frame.test')).length, 1);
  await page.close();
});

// ───────────── persistBox: 记住拖动 / 缩放后的位置和大小 ─────────────
/** 创建实例; sized=true 时带 width:200,height:300 (显式尺寸), 否则不传 (默认尺寸 / 可被已保存的覆盖)。 */
const mkP = (page, opts, sized = false) => page.evaluate(async (opts, sized) => {
  const o = { container: '#a', src: 'http://frame.test/embed', lazy: false, ...(sized ? { width: 200, height: 300 } : {}), ...opts };
  const xc = window.XC.createXiaochun(o);
  window.xc = xc; window.events = [];
  for (const ev of ['outfit-changed', 'scene-changed', 'error', 'ready', 'move', 'resize']) xc.on(ev, (p) => window.events.push([ev, p]));
  return true;
}, opts, sized);
const recreate = async (page, opts, sized = false) => { await page.evaluate(() => { window.xc.destroy(); }); await mkP(page, opts, sized); await handshake(page); await settle(page); };
const stored = (page, key = 'xiaochun:box') => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);

await check('persistBox (悬浮): 拖动 / 缩放结束时写宿主 localStorage; 重建后恢复位置 + 大小 (不传 width/height 时); 显式 width/height 优先, 位置仍恢复', async () => {
  const page = await newPage();
  await page.evaluate(() => localStorage.clear());
  await mkP(page, { draggable: true, resizable: true, position: 'bottom-right', persistBox: true }); await handshake(page); await settle(page);
  assert.equal(await stored(page), null, '没动过不写');
  await gesture(page, 'resize', 1, [[-200, -200]], { corner: 'SE' }); // 缩小
  await gesture(page, 'move', 2, [[-100, -50]]);
  const b1 = await boxOf(page);
  const rec = await stored(page);
  assert.equal(rec.v, 1); assert.equal(rec.mode, 'bottom-right');
  assert.deepEqual([rec.x, rec.y, rec.width, rec.height], [b1.l, b1.t, b1.w, b1.h], '存的是手势结束后的盒子');
  await recreate(page, { draggable: true, resizable: true, position: 'bottom-right', persistBox: true });
  assert.deepEqual(await boxOf(page), b1, '重建后位置 + 大小恢复');
  assert.ok(await page.evaluate(() => { const st = document.querySelector('[data-xiaochun]').style; return st.right === 'auto' && st.bottom === 'auto'; }), '悬浮恢复后用 left/top 定位');
  // 显式 width/height 优先于已保存的大小; 位置仍恢复
  await recreate(page, { draggable: true, resizable: true, position: 'bottom-right', persistBox: true }, true);
  const b2 = await boxOf(page);
  assert.deepEqual([b2.w, b2.h], [200, 300], '显式 width/height 优先');
  assert.deepEqual([b2.l, b2.t], [b1.l, b1.t], '位置仍恢复');
  // 真刷新页面也能恢复
  await page.reload(); await page.waitForFunction(() => window.__ready);
  await mkP(page, { draggable: true, resizable: true, position: 'bottom-right', persistBox: true }); await handshake(page); await settle(page);
  assert.deepEqual(await boxOf(page), b1, '刷新页面后恢复');
  await page.close();
});

await check('persistBox: 命名空间 key; 默认关不写; 没开手势不恢复; 位置模式不同 / 坏数据忽略并清掉; localStorage 抛错不崩', async () => {
  const page = await newPage();
  await page.evaluate(() => localStorage.clear()); // 同一浏览器里各用例共享 host.test 的 localStorage
  // 关: 不写
  await mkP(page, { draggable: true }); await handshake(page); await settle(page);
  await gesture(page, 'move', 1, [[20, 20]]);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('xiaochun:box')).length), 0, '默认不写');
  // 命名空间
  await recreate(page, { draggable: true, persistBox: 'blog-stage' }, true);
  await gesture(page, 'move', 2, [[40, 30]]);
  assert.equal(await stored(page), null); assert.deepEqual((await stored(page, 'xiaochun:box:blog-stage')).mode, 'inline');
  // 没开手势: 不恢复
  await recreate(page, { persistBox: 'blog-stage' }, true);
  assert.deepEqual(await boxOf(page), { l: 100, t: 100, w: 200, h: 300 }, '没开 draggable / resizable 不恢复');
  // 开: 恢复 (内联: 存的是位移)
  await recreate(page, { draggable: true, persistBox: 'blog-stage' }, true);
  assert.deepEqual(await boxOf(page), { l: 140, t: 130, w: 200, h: 300 }, '内联恢复');
  assert.deepEqual([(await stored(page, 'xiaochun:box:blog-stage')).x, (await stored(page, 'xiaochun:box:blog-stage')).y], [40, 30], '内联存相对流内原点的位移');
  // 不同定位模式: 忽略并清掉
  await recreate(page, { draggable: true, persistBox: 'blog-stage', position: 'bottom-right' }, true);
  assert.deepEqual(await boxOf(page), { l: 684, t: 384, w: 200, h: 300 }, '模式不同: 不恢复, 用锚点');
  assert.equal(await stored(page, 'xiaochun:box:blog-stage'), null, '模式不符的旧数据被清掉');
  // 坏数据
  for (const bad of ['not json', '{"v":2}', '{"v":1,"mode":"inline","x":"a","y":0,"width":1,"height":1}', '{"v":1,"mode":"inline","x":1e9,"y":0,"width":100,"height":100}']) {
    await page.evaluate((b) => localStorage.setItem('xiaochun:box:bad', b), bad);
    await recreate(page, { draggable: true, persistBox: 'bad' }, true);
    assert.deepEqual(await boxOf(page), { l: 100, t: 100, w: 200, h: 300 }, '坏数据忽略: ' + bad);
    assert.equal(await page.evaluate(() => localStorage.getItem('xiaochun:box:bad')), null, '坏数据被清掉');
  }
  // localStorage 读写抛错 (隐私模式 / 被禁用): 不崩, 手势照常
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; Storage.prototype.getItem = () => { throw new Error('denied'); }; });
  await recreate(page, { draggable: true, persistBox: true }, true);
  await gesture(page, 'move', 3, [[10, 10]]);
  assert.deepEqual(await boxOf(page), { l: 110, t: 110, w: 200, h: 300 }, '存储报错也不影响手势');
  await page.close();
});

await check('persistBox: 恢复时钳制到当前视口 (窗口变小 / 存的值越界): 大小 ≤ 视口且 ≥ 最小 120x180, 悬浮位置在视口内; 内联横向在视口内', async () => {
  const page = await newPage();
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => localStorage.setItem('xiaochun:box', JSON.stringify({ v: 1, mode: 'bottom-right', x: 5000, y: -300, width: 5000, height: 10 })));
  await mkP(page, { draggable: true, resizable: true, position: 'bottom-right', persistBox: true }); await handshake(page); await settle(page);
  const b = await boxOf(page);
  assert.ok(b.w <= 900 && b.h >= 180 && b.h <= 700 && b.w >= 120, '大小钳在 [最小, 视口]: ' + JSON.stringify(b));
  assert.ok(b.l >= 0 && b.t >= 0 && b.l + b.w <= 900 && b.t + b.h <= 700, '位置在视口内: ' + JSON.stringify(b));
  // 窗口变小后再创建
  await page.setViewport({ width: 360, height: 640 });
  await page.evaluate(() => localStorage.setItem('xiaochun:box', JSON.stringify({ v: 1, mode: 'bottom-right', x: 600, y: 400, width: 500, height: 600 })));
  await recreate(page, { draggable: true, resizable: true, position: 'bottom-right', persistBox: true });
  const c = await boxOf(page);
  assert.ok(c.l >= 0 && c.t >= 0 && c.l + c.w <= 360 && c.t + c.h <= 640, '小窗口下仍在视口内: ' + JSON.stringify(c));
  // 自定义最小尺寸: 夹到 minWidth/minHeight
  await page.setViewport({ width: 900, height: 700 });
  await page.evaluate(() => localStorage.setItem('xiaochun:box', JSON.stringify({ v: 1, mode: 'bottom-right', x: 10, y: 10, width: 50, height: 60 })));
  await recreate(page, { draggable: true, resizable: { minWidth: 160, minHeight: 240 }, position: 'bottom-right', persistBox: true });
  const d = await boxOf(page);
  assert.deepEqual([d.w, d.h], [160, 240], '夹到自定义最小尺寸');
  // 内联: 横向夹进视口
  await page.evaluate(() => localStorage.setItem('xiaochun:box:inl', JSON.stringify({ v: 1, mode: 'inline', x: 5000, y: 20, width: 200, height: 300 })));
  await recreate(page, { draggable: true, persistBox: 'inl' }, true);
  const e = await boxOf(page);
  assert.ok(e.l >= 0 && e.l + e.w <= 900, '内联横向在视口内: ' + JSON.stringify(e));
  await page.close();
});

await check('clearPersistedBox: 删存储; { reset: true } 还原到初始位置 / 大小 (悬浮回锚点, 内联清位移); 没开 persistBox 时空操作; 元素属性 persist-box', async () => {
  const page = await newPage();
  await page.evaluate(() => localStorage.clear());
  await mkP(page, { draggable: true, resizable: true, position: 'bottom-right', persistBox: 'z' }); await handshake(page); await settle(page);
  const init = await boxOf(page);
  await gesture(page, 'move', 1, [[-120, -80]]);
  assert.notDeepEqual(await boxOf(page), init);
  assert.ok(await stored(page, 'xiaochun:box:z'));
  await page.evaluate(() => xc.clearPersistedBox());
  assert.equal(await stored(page, 'xiaochun:box:z'), null, '只删存储');
  assert.notDeepEqual(await boxOf(page), init, '不带 reset 不动当前盒子');
  await gesture(page, 'move', 2, [[10, 10]]);
  await page.evaluate(() => xc.clearPersistedBox({ reset: true }));
  assert.equal(await stored(page, 'xiaochun:box:z'), null);
  assert.deepEqual(await boxOf(page), init, 'reset 回到初始锚点 + 大小');
  await recreate(page, { draggable: true, resizable: true, position: 'bottom-right', persistBox: 'z' });
  assert.deepEqual(await boxOf(page), init, 'reset 后重建不再恢复旧值');
  assert.ok(init.t >= 0 && init.l >= 0 && init.l + init.w <= 900 && init.t + init.h <= 700, '悬浮默认尺寸扣掉边距, 不顶出屏幕: ' + JSON.stringify(init));
  // 内联 reset
  await recreate(page, { draggable: true, persistBox: 'i' }, true);
  await gesture(page, 'move', 3, [[50, 60]]);
  await page.evaluate(() => xc.clearPersistedBox({ reset: true }));
  assert.deepEqual(await boxOf(page), { l: 100, t: 100, w: 200, h: 300 });
  assert.equal(await page.evaluate(() => document.querySelector('[data-xiaochun]').style.translate), '');
  // 没开 persistBox: 空操作不抛
  await recreate(page, { draggable: true }, true);
  await page.evaluate(() => xc.clearPersistedBox());
  await page.evaluate(() => xc.destroy());
  // 元素属性 persist-box
  const el = await page.evaluate(async () => {
    localStorage.setItem('xiaochun:box', JSON.stringify({ v: 1, mode: 'inline', x: 30, y: 20, width: 260, height: 340 }));
    const e = document.createElement('xiaochun-avatar'); e.setAttribute('src', 'http://frame.test/embed'); e.setAttribute('lazy', 'false');
    e.setAttribute('draggable', ''); e.setAttribute('resizable', ''); e.setAttribute('persist-box', '');
    e.style.cssText = 'position:absolute;left:100px;top:100px'; document.body.appendChild(e);
    await new Promise((r) => setTimeout(r, 400));
    const b = e.shadowRoot.querySelector('[data-xiaochun]').getBoundingClientRect();
    const out = [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
    e.clearPersistedBox(); const gone = localStorage.getItem('xiaochun:box') === null; e.remove();
    return { out, gone };
  });
  assert.deepEqual(el.out, [130, 120, 260, 340], '元素 persist-box="" 恢复位置 + 大小');
  assert.equal(el.gone, true, '元素 clearPersistedBox()');
  await page.close();
});

// ───────────── 默认尺寸 600x1080 (受视口限制) ─────────────
const wrapBox = (page) => page.evaluate(() => { const b = document.querySelector('[data-xiaochun]').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
/** 不传 width / height 的创建 (page.evaluate 的参数会丢掉 undefined 键, 所以不能复用 mk)。 */
const mkD = (page, opts = {}) => page.evaluate(async (opts) => {
  window.xc = window.XC.createXiaochun({ container: '#a', src: 'http://frame.test/embed', lazy: false, ...opts }); return true;
}, opts);
const dim = (page) => page.evaluate(() => ({ vw: document.documentElement.clientWidth, vh: window.innerHeight, sw: document.documentElement.scrollWidth }));

await check('默认尺寸 600x1080: 宽屏下原样; 窄视口 (360x640) 钳制到容器宽 / 视口高, 不横向溢出; 显式 width/height 原样; setSize(undefined) 恢复默认', async () => {
  const page = await newPage();
  await page.setViewport({ width: 1400, height: 1200 });
  await mkD(page);
  assert.deepEqual(await wrapBox(page), [600, 1080], '宽屏默认 600x1080');
  await page.evaluate(() => xc.destroy());
  await page.setViewport({ width: 360, height: 640 });
  await mkD(page);
  const [w, h] = await wrapBox(page); const d = await dim(page);
  assert.ok(w <= d.vw && w > 100, `窄屏宽不超过视口: ${w} <= ${d.vw}`);
  assert.ok(h <= d.vh && h > 100, `窄屏高不超过视口: ${h} <= ${d.vh}`);
  // (本用例的容器 #a 是 left:100px 的绝对定位, 自身偏移会产生滚动, 不在此断言; 流内容器的无溢出见下面元素 / React 用例)
  await page.evaluate(() => xc.destroy());
  // 显式值原样 (宽仍受 max-width:100% 约束)
  await page.setViewport({ width: 1400, height: 1200 });
  await mk(page, { width: 320, height: 480 });
  assert.deepEqual(await wrapBox(page), [320, 480]);
  await page.evaluate(() => xc.setSize(undefined, undefined));
  assert.deepEqual(await wrapBox(page), [600, 1080], 'setSize(undefined, undefined) 恢复默认');
  await page.evaluate(() => xc.setSize(260, undefined));
  assert.deepEqual(await wrapBox(page), [260, 1080], '只给宽, 高用默认');
  // 窗口变窄后 (默认值是 CSS min()) 自动跟随
  await page.setViewport({ width: 400, height: 700 });
  const [w2, h2] = await wrapBox(page);
  assert.ok(w2 <= 400 && h2 <= 700, `默认尺寸随视口变窄: ${w2}x${h2}`);
  await page.close();
});

await check('<xiaochun-avatar> 默认 600x1080 (窄屏钳制); size="280" → 280x420 (高 = 宽 x 1.5 的旧规则); 运行时删掉 size 恢复默认', async () => {
  const page = await newPage();
  const make = (vw, vh, attrs) => page.evaluate(async (vw, vh, attrs) => {
    document.querySelectorAll('xiaochun-avatar').forEach((e) => e.remove());
    const e = document.createElement('xiaochun-avatar'); e.id = 'el';
    e.setAttribute('src', 'http://frame.test/embed'); e.setAttribute('lazy', 'false');
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    document.body.appendChild(e);
    await new Promise((r) => setTimeout(r, 300));
    const b = e.shadowRoot.querySelector('[data-xiaochun]').getBoundingClientRect();
    return [Math.round(b.width), Math.round(b.height), document.documentElement.scrollWidth, document.documentElement.clientWidth];
  }, vw, vh, attrs);
  await page.setViewport({ width: 1400, height: 1200 });
  const wide = await make(1400, 1200, {});
  assert.deepEqual(wide.slice(0, 2), [600, 1080], '元素默认 600x1080: ' + wide);
  assert.deepEqual((await make(1400, 1200, { size: '280' })).slice(0, 2), [280, 420]);
  assert.deepEqual((await make(1400, 1200, { size: '320x480' })).slice(0, 2), [320, 480]);
  await page.evaluate(() => { document.querySelector('#el').setAttribute('size', '300x500'); });
  assert.deepEqual(await page.evaluate(() => { const b = document.querySelector('#el').shadowRoot.querySelector('[data-xiaochun]').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }), [300, 500]);
  await page.evaluate(() => document.querySelector('#el').removeAttribute('size'));
  assert.deepEqual(await page.evaluate(() => { const b = document.querySelector('#el').shadowRoot.querySelector('[data-xiaochun]').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }), [600, 1080], '删掉 size 恢复默认');
  await page.setViewport({ width: 360, height: 640 });
  const narrow = await make(360, 640, {});
  assert.ok(narrow[0] <= 360 && narrow[1] <= 640 && narrow[2] <= narrow[3], '元素窄屏不溢出: ' + narrow);
  await page.close();
});

await check('React 默认尺寸 600x1080 (width / height 不传); 窄屏钳制; prop 变回 undefined 也恢复默认', async () => {
  const page = await newPage();
  await page.setViewport({ width: 1400, height: 1200 });
  await page.addScriptTag({ url: 'http://host.test/react.js' });
  await page.evaluate(() => window.__mountReact());
  await page.waitForFunction(() => window.__rlog.includes('scene:light'));
  assert.deepEqual(await wrapBox(page), [200, 300]);
  await page.evaluate(() => window.__setSize([undefined, undefined])); await settle(page);
  assert.deepEqual(await wrapBox(page), [600, 1080], 'prop 变回 undefined → 默认');
  assert.deepEqual(await page.evaluate(() => { const b = document.querySelector('[data-xiaochun-host]').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }), [600, 1080], 'React 容器 div 也是默认尺寸');
  await page.setViewport({ width: 360, height: 640 }); await settle(page);
  const [w, h] = await wrapBox(page); const d = await dim(page);
  assert.ok(w <= d.vw && h <= d.vh && d.sw <= d.vw, `React 窄屏不溢出: ${w}x${h} / ${d.vw}x${d.vh} sw=${d.sw}`);
  await page.close();
});

await browser.close();
if (failed) { console.log(`\n${failed} 项失败`); process.exit(1); }
console.log('\n全部通过');
