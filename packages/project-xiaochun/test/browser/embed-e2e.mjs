// 真实 /embed 端到端 (可选; 需要 puppeteer-core + 本机 Chrome + 一个正在服务 /embed 的站点):
//   1) 仓库根: pnpm build && npx vite preview --port 5291     (或 pnpm dev, 把 EMBED_URL 指过去)
//   2) 本包:   pnpm build
//   3) PUPPETEER_MODULE=/path/to/puppeteer-core EMBED_URL=https://localhost:5291/embed \
//        CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node test/browser/embed-e2e.mjs
// 宿主页由请求拦截伪造成回环地址上的 HOST_ORIGIN (与 iframe 跨源), 用真实 SDK dist + 真实 iframe。
// 覆盖: 换装 / 换场景 / 透明<->不透明穿透切换 / 非法 id (SDK 与 iframe 两侧) / 快速连点 / 说话中换装 / ?outfit= ?scene= / allowCustomModel 门禁 / 预取。
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../dist');
let puppeteer;
try { puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_MODULE || 'puppeteer-core'); }
catch { console.log('[skip] puppeteer-core 不可用 (设置 PUPPETEER_MODULE)'); process.exit(0); }
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(executablePath)) { console.log('[skip] 找不到 Chrome (设置 CHROME_PATH)'); process.exit(0); }
const EMBED_URL = process.env.EMBED_URL || 'https://localhost:5291/embed';
const EMBED_ORIGIN = new URL(EMBED_URL).origin;
// Chrome 的本地网络访问 (LNA) 会拦截 "公网宿主 -> localhost iframe", 所以宿主页也放在回环地址上 (仍与 iframe 跨源/跨站)
const HOST_ORIGIN = 'http://127.0.0.1:5299';
const W = 400, H = 560, LEFT = 100, TOP = 60;

const hostHtml = `<!doctype html><body style="margin:0;background:rgb(255,0,255)"><div id="a" style="position:absolute;left:${LEFT}px;top:${TOP}px"></div>
<script type="module">import * as XC from '/dist/index.js'; import '/dist/element.js'; window.XC = XC; window.__ready = true;</script></body>`;

// ---- 极简 PNG 解码 (RGBA8 非交错; puppeteer 截图就是这种) ----
function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 6; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, px: (x, y) => { const i = y * stride + x * bpp; return [out[i], out[i + 1], out[i + 2]]; } };
}
const shot = async (page) => decodePng(await page.screenshot({ type: 'png' }));
const isMagenta = ([r, g, b]) => r > 240 && g < 15 && b > 240;
const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 真实的回环宿主站 (请求拦截伪造的 origin 会被 Chrome 当成"公网", 访问 localhost iframe 触发 LNA 拦截)
import http from 'node:http';
const hostServer = http.createServer((req, res) => {
  const u = new URL(req.url, HOST_ORIGIN);
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); return res.end(hostHtml); }
  const f = path.join(dist, u.pathname.replace(/^\/dist\//, ''));
  if (u.pathname.startsWith('/dist/') && existsSync(f)) { res.setHeader('content-type', 'text/javascript'); return res.end(readFileSync(f)); }
  res.statusCode = 404; res.end();
});
await new Promise((r) => hostServer.listen(5299, '127.0.0.1', r));
let browser = await puppeteer.launch({
  executablePath, headless: process.env.HEADED ? false : 'new', protocolTimeout: 300000,
  args: ['--no-sandbox', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'],
});
const timings = {};
let failed = 0;
const ONLY = process.env.ONLY, SKIP = process.env.SKIP;
const check = async (name, fn) => {
  if (SKIP && SKIP.split('|').some((k) => name.includes(k))) return;
  if (ONLY && !ONLY.split('|').some((k) => name.includes(k))) return;
  const t = Date.now();
  try { await fn(); console.log(`ok   - ${name}  (${Date.now() - t} ms)`); } catch (e) { failed++; console.log('FAIL -', name, '\n  ', e.stack?.split('\n').slice(0, 4).join('\n   ') || e.message); }
};

const requests = []; // 全部 /vrm 请求 (含 iframe 内)
const consoleErrors = [];
async function newPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700 });
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/vrm/')) requests.push(u.pathname); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('dialog', async (d) => { consoleErrors.push('DIALOG: ' + d.message().slice(0, 200)); await d.dismiss(); });
  await page.bringToFront();
  // 同一个浏览器配置里, iframe 源的 localStorage 会在测试之间共享: 上一个用例的拖拽 / 滚轮会把相机俯仰/距离存进去, 下一个用例的画面就变了
  // (iframe 本身对相机的记忆是主站既有行为)。每个新页面前清掉它 (只清 localStorage; IndexedDB 里的预取缓存保留)。
  const cdp = await page.createCDPSession();
  await cdp.send('Storage.clearDataForOrigin', { origin: EMBED_ORIGIN, storageTypes: 'local_storage' });
  // iframe 在跨站宿主下用的是 "分区" 存储 (key = iframe 源 + 顶层站点), 上面清不到, 再按分区 key 清一次
  await cdp.send('Storage.clearDataForStorageKey', { storageKey: `${EMBED_ORIGIN}/^0${new URL(HOST_ORIGIN).protocol}//${new URL(HOST_ORIGIN).hostname}`, storageTypes: 'local_storage' }).catch((e) => console.log('   [clear storage key]', e.message));
  await cdp.detach();
  await page.goto(HOST_ORIGIN + '/');
  await page.waitForFunction(() => window.__ready);
  return page;
}
const frameOf = (page) => page.frames().find((f) => f.url().startsWith(EMBED_ORIGIN));

// 在宿主页创建实例; 事件全部记入 window.__ev
const mk = (page, opts = {}, wait = true) => page.evaluate(async (opts, EMBED_URL, W, H, wait) => {
  window.__ev = [];
  const xc = window.xc = window.XC.createXiaochun({ container: '#a', src: EMBED_URL, lazy: false, width: W, height: H, handshakeTimeout: 60000, ...opts });
  for (const n of ['handshake', 'ready', 'progress', 'outfit-changed', 'scene-changed', 'error', 'utterance', 'hit-region'])
    xc.on(n, (p) => window.__ev.push({ n, p, t: performance.now() }));
  if (wait) await Promise.race([xc.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('ready 超时 150s')), 150000))]);
  return true;
}, opts, EMBED_URL, W, H, wait);
const ev = (page, n) => page.evaluate((n) => window.__ev.filter((e) => e.n === n), n);
const settle = (page, fn, ...args) => page.evaluate(async (fn, args) => {
  try { return { ok: true, v: await (0, eval)(fn)(window.xc, ...args) }; } catch (e) { return { ok: false, msg: String(e && e.message || e) }; }
}, fn.toString(), args);
const iframeState = (page) => page.evaluate(() => { const i = document.querySelector('iframe'); const w = document.querySelector('#a'); return { pe: i.style.pointerEvents || getComputedStyle(i).pointerEvents, bg: w.style.background || w.style.backgroundColor || '' }; });
const idbKeys = (page) => frameOf(page).evaluate(async () => {
  const dbs = await indexedDB.databases();
  const out = [];
  for (const d of dbs) {
    const db = await new Promise((res, rej) => { const r = indexedDB.open(d.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    for (const s of Array.from(db.objectStoreNames)) {
      const keys = await new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      out.push(...keys.map((k) => `${d.name}/${s}/${String(k)}`));
    }
    db.close();
  }
  return out;
});
const count = (name) => requests.filter((p) => p.includes(name)).length;

// 模型主体大致位置 (用于鼠标命中): iframe 水平居中、纵向中偏上
const MODEL = { x: LEFT + W / 2, y: TOP + H * 0.5 };
const CORNER = { x: LEFT + 8, y: TOP + 8 };
// 不透明场景的取色点: 离角 28px, 在 20px 圆角之内 (CORNER 在圆角外, 非透明场景那里是被裁掉的 → 透出宿主)
const PROBE = { x: LEFT + 28, y: TOP + 28 };

let page = await newPage();

await check('首次加载: 握手 capabilities (outfits 不含 base, scenes=3, prefetch) + 初始事件', async () => {
  const t0 = Date.now();
  await mk(page, { scene: 'light' });
  timings.firstLoadMs = Date.now() - t0;
  const hs = (await ev(page, 'handshake'))[0].p;
  const ids = hs.capabilities.outfits.map((o) => o.id);
  console.log('   outfits:', ids.join(','));
  assert.ok(ids.length >= 8 && !ids.includes('base') && ids.includes('xiaochun_dinner_dress'));
  assert.deepEqual(hs.capabilities.scenes.map((s) => s.id).sort(), ['dark', 'light', 'transparent']);
  assert.equal(hs.capabilities.prefetch, true);
  assert.ok(hs.capabilities.commands.includes('xc.setOutfit') && hs.capabilities.commands.includes('xc.setScene'));
  const oc = (await ev(page, 'outfit-changed')).map((e) => e.p);
  assert.ok(oc.some((p) => p.initial && p.id === 'xiaochun_dinner_dress'), JSON.stringify(oc));
  const mp = (await ev(page, 'progress')).map((e) => e.p).filter((p) => p.phase === 'model').map((p) => p.progress);
  assert.ok(mp.length > 3 && mp.every((v, i) => i === 0 || v !== mp[i - 1]), '首次加载进度不应连续重复: ' + mp.join(','));
  const sc = (await ev(page, 'scene-changed')).map((e) => e.p);
  assert.ok(sc.some((p) => p.initial && p.id === 'light'), JSON.stringify(sc));
  console.log(`   首次加载到 ready: ${timings.firstLoadMs} ms`);
});

await check('渲染: light 场景不是洋红(宿主背景), 有内容', async () => {
  await sleep(1500);
  const s = await shot(page);
  assert.ok(!isMagenta(s.px(PROBE.x, PROBE.y)), 'light 场景角落不应透出宿主洋红');
});

await check('换装: setOutfit 逐个切, 事件 + 进度(outfit 阶段) + 画面变化 + 耗时', async () => {
  const before = await page.screenshot({ type: 'png' });
  const list = ['xiaochun_maid', 'xiaochun_cheongsam'];
  const avail = (await ev(page, 'handshake'))[0].p.capabilities.outfits.map((o) => o.id);
  for (const id of list) assert.ok(avail.includes(id), id + ' 不在白名单');
  timings.swap = {};
  for (const id of list) {
    const t = Date.now();
    const r = await settle(page, (xc, id) => xc.setOutfit(id), id);
    assert.ok(r.ok, JSON.stringify(r));
    timings.swap[id] = Date.now() - t;
    assert.equal(await page.evaluate(() => window.xc.outfit), id);
  }
  console.log('   换装耗时(ms):', JSON.stringify(timings.swap));
  await sleep(800);
  const after = await page.screenshot({ type: 'png' });
  assert.ok(!before.equals(after), '换装后画面应变化');
  const prog = (await ev(page, 'progress')).map((e) => e.p).filter((p) => p.phase === 'outfit');
  assert.ok(prog.length > 0 && prog.every((p) => typeof p.id === 'string'), 'outfit 阶段进度: ' + JSON.stringify(prog.slice(0, 2)));
  const oc = (await ev(page, 'outfit-changed')).map((e) => e.p).filter((p) => !p.initial);
  assert.deepEqual(oc.map((p) => p.id), list);
  assert.equal(oc[0].previous, 'xiaochun_dinner_dress');
});

await check('同 id 重复换装: noop, 不重载', async () => {
  const n0 = requests.length;
  const r = await settle(page, (xc) => xc.setOutfit('xiaochun_cheongsam'));
  assert.ok(r.ok);
  assert.equal(requests.length, n0, 'noop 不应发 /vrm 请求');
  const n1 = (await ev(page, 'outfit-changed')).length;
  await sleep(300);
  assert.equal((await ev(page, 'outfit-changed')).length, n1, 'noop 不再触发 outfit-changed 事件');
});

await check('非法 id: SDK 本地拦截 (bad_request) 与 iframe 侧 (unknown_id), 状态不变', async () => {
  const cur = await page.evaluate(() => window.xc.outfit);
  for (const bad of ['__proto__', 'Constructor', '../etc', 'a b', '', 'x'.repeat(80)]) {
    const r = await settle(page, (xc, id) => xc.setOutfit(id), bad);
    assert.ok(!r.ok && /bad_request/.test(r.msg), `${JSON.stringify(bad)} -> ${r.msg}`);
  }
  for (const bad of ['toString', 'hasOwnProperty', 'valueOf']) { // 大写: 格式校验先拦
    const r = await settle(page, (xc, id) => xc.setOutfit(id), bad);
    assert.ok(!r.ok && /bad_request/.test(r.msg), `${bad} -> ${r.msg}`);
  }
  for (const bad of ['constructor', 'base', 'no_such_outfit']) { // 格式合法但不在白名单
    const r = await settle(page, (xc, id) => xc.setOutfit(id), bad);
    assert.ok(!r.ok && /unknown_id/.test(r.msg), `${bad} -> ${r.msg}`);
  }
  for (const bad of ['constructor', '__proto__', 'toString']) {
    const r = await settle(page, (xc, id) => xc.setScene(id), bad);
    assert.ok(!r.ok && /(unknown_id|bad_request)/.test(r.msg), `scene ${bad} -> ${r.msg}`);
  }
  assert.equal(await page.evaluate(() => window.xc.outfit), cur);
  assert.equal(await page.evaluate(() => window.xc.scene), 'light');
});

await check('iframe 侧原始协议 (绕过 SDK 本地校验): 原型键/非字符串 id/base/自定义 URL 门禁', async () => {
  const p2 = await newPage();
  const res = await p2.evaluate(async (EMBED_URL) => {
    const ifr = document.createElement('iframe');
    ifr.src = EMBED_URL + '?host=' + encodeURIComponent(location.origin) + '&lazy=0';
    ifr.style.cssText = 'width:300px;height:300px'; document.body.appendChild(ifr);
    const mc = new MessageChannel(); const log = []; let n = 0;
    mc.port1.onmessage = (e) => log.push(e.data);
    await new Promise((res) => {
      window.addEventListener('message', (e) => { if (e.data && e.data.type === 'xc.ready' && e.source === ifr.contentWindow) {
        ifr.contentWindow.postMessage({ type: 'xc.init', v: 1, payload: {} }, new URL(EMBED_URL).origin, [mc.port2]); res(); } });
    });
    const waitFor = (pred, ms = 60000) => new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { const f = log.find(pred); if (f) { clearInterval(i); res(f); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('timeout')); } }, 50); });
    await waitFor((m) => m.type === 'xc.loaded');
    const call = async (type, payload) => { const id = 'r' + (++n); mc.port1.postMessage({ type, v: 1, id, payload }); const m = await waitFor((m) => m.id === id && (m.type === 'xc.error' || m.type.endsWith('-changed'))); return { type: m.type, code: m.payload.code, id: m.payload.id }; };
    const out = {};
    for (const [k, id] of Object.entries({ proto: '__proto__', ctor: 'constructor', base: 'base', num: 123, obj: {}, nul: null, long: 'a'.repeat(100) }))
      out['outfit_' + k] = await call('xc.setOutfit', { id });
    out.scene_ctor = await call('xc.setScene', { id: 'constructor' });
    out.scene_proto = await call('xc.setScene', { id: '__proto__' });
    out.model_base = await call('xc.setModel', { outfit: 'base' });
    out.model_ctor = await call('xc.setModel', { outfit: 'constructor' });
    out.model_url_closed = await call('xc.setModel', { url: 'https://example.com/x.vrm' });
    out.noPayload = await call('xc.setOutfit', undefined);
    return out;
  }, EMBED_URL);
  console.log('   ', JSON.stringify(res));
  for (const k of ['outfit_proto', 'outfit_ctor', 'outfit_base', 'scene_ctor', 'scene_proto', 'model_base', 'model_ctor']) assert.ok(['unknown_id', 'bad_request'].includes(res[k].code) && res[k].type === 'xc.error', k + ' ' + JSON.stringify(res[k]));
  for (const k of ['outfit_num', 'outfit_obj', 'outfit_nul', 'outfit_long', 'noPayload']) assert.equal(res[k].code, 'bad_request', k);
  assert.equal(res.model_url_closed.code, 'unsupported');
  await p2.close();
});

await check('快速连点: 5 连发, 先到的跑, 中间 busy, 最后一个赢, 无其他错误', async () => {
  const ids = ['xiaochun_maid', 'xiaochun_swimsuit', 'xiaochun_bikini', 'xiaochun_techwear', 'xiaochun_cheongsam'];
  const avail = (await ev(page, 'handshake'))[0].p.capabilities.outfits.map((o) => o.id);
  const use = ids.filter((i) => avail.includes(i));
  while (use.length < 5) use.push(avail.find((a) => !use.includes(a) && a !== 'xiaochun_wedding'));
  const t = Date.now();
  const out = await page.evaluate(async (use) => {
    const rs = await Promise.allSettled(use.map((id) => window.xc.setOutfit(id)));
    return rs.map((r, i) => ({ id: use[i], ok: r.status === 'fulfilled', msg: r.reason && String(r.reason.message) }));
  }, use);
  timings.rapidMs = Date.now() - t;
  console.log('   ', out.map((o) => `${o.id}:${o.ok ? 'ok' : (/busy/.test(o.msg) ? 'busy' : o.msg)}`).join(' '), `${timings.rapidMs}ms`);
  assert.ok(out[out.length - 1].ok, '最后一个必须成功');
  assert.ok(out.every((o) => o.ok || /busy/.test(o.msg)), '失败只能是 busy');
  assert.ok(out.filter((o) => !o.ok).length >= 2, '中间的应被 busy 顶掉');
  assert.equal(await page.evaluate(() => window.xc.outfit), use[use.length - 1]);
  await sleep(500);
  const st = await frameOf(page).evaluate(() => document.querySelectorAll('canvas').length);
  assert.ok(st >= 1);
});

await check('快速连点 (同一 id 反复): 合并为一次加载', async () => {
  const id = 'xiaochun_maid';
  const n0 = count('xiaochun_maid.vrmaddon');
  const out = await page.evaluate(async (id) => (await Promise.allSettled([1, 2, 3, 4].map(() => window.xc.setOutfit(id)))).map((r) => r.status), id);
  assert.ok(out.every((s) => s === 'fulfilled'), JSON.stringify(out));
  assert.ok(count('xiaochun_maid.vrmaddon') - n0 <= 1);
});

await check('换场景: dark / light, 外壳背景同步, 画面亮度变化', async () => {
  let r = await settle(page, (xc) => xc.setScene('dark')); assert.ok(r.ok, JSON.stringify(r));
  await sleep(600);
  const dark = lum((await shot(page)).px(PROBE.x, PROBE.y));
  r = await settle(page, (xc) => xc.setScene('light')); assert.ok(r.ok, JSON.stringify(r));
  await sleep(600);
  const light = lum((await shot(page)).px(PROBE.x, PROBE.y));
  console.log(`   角落亮度 dark=${dark.toFixed(0)} light=${light.toFixed(0)}`);
  assert.ok(light - dark > 60, '亮度应明显不同');
  const sc = (await ev(page, 'scene-changed')).map((e) => e.p).filter((p) => !p.initial);
  assert.deepEqual(sc.map((p) => p.id), ['dark', 'light']);
  assert.deepEqual(await iframeState(page).then((s) => s.pe), 'auto');
});

await check('透明 <-> 不透明: 背景透出宿主, 穿透监听/pointer-events/hit-region 随之切换', async () => {
  let r = await settle(page, (xc) => xc.setScene('transparent')); assert.ok(r.ok, JSON.stringify(r));
  await sleep(1200);
  const s1 = await shot(page);
  assert.ok(isMagenta(s1.px(CORNER.x, CORNER.y)), '透明场景角落应透出宿主洋红: ' + s1.px(CORNER.x, CORNER.y));
  // 鼠标在空白处: 穿透 => iframe pointer-events none
  await page.mouse.move(CORNER.x, CORNER.y); await page.mouse.move(CORNER.x + 3, CORNER.y + 3);
  await sleep(500);
  let st = await iframeState(page);
  console.log('   透明/空白处:', JSON.stringify(st));
  assert.equal(st.pe, 'none', '空白处应穿透');
  // 移到角色上: 命中后应转 auto
  await page.mouse.move(MODEL.x - 5, MODEL.y); await page.mouse.move(MODEL.x, MODEL.y);
  await sleep(700);
  st = await iframeState(page);
  const regions = (await ev(page, 'hit-region')).length;
  console.log('   透明/角色上:', JSON.stringify(st), 'hit-region 事件数', regions);
  assert.equal(st.pe, 'auto', '角色上应接收事件');
  // 切不透明: 强制 auto, 即使在空白处
  r = await settle(page, (xc) => xc.setScene('light')); assert.ok(r.ok);
  await page.mouse.move(CORNER.x, CORNER.y); await page.mouse.move(CORNER.x + 2, CORNER.y + 2);
  await sleep(600);
  st = await iframeState(page);
  console.log('   不透明/空白处:', JSON.stringify(st));
  assert.equal(st.pe, 'auto', '不透明场景必须强制 auto');
  assert.ok(!isMagenta((await shot(page)).px(PROBE.x, PROBE.y)));
  // 再切回透明: lastHit 已重置 => 在空白处重新穿透
  r = await settle(page, (xc) => xc.setScene('transparent')); assert.ok(r.ok);
  await sleep(1000);
  await page.mouse.move(CORNER.x, CORNER.y); await page.mouse.move(CORNER.x + 4, CORNER.y + 1);
  await sleep(600);
  st = await iframeState(page);
  console.log('   再回透明/空白处:', JSON.stringify(st));
  assert.equal(st.pe, 'none', '回到透明后空白处应重新穿透 (lastHit 已重置)');
  await page.mouse.move(MODEL.x, MODEL.y); await page.mouse.move(MODEL.x + 2, MODEL.y);
  await sleep(700);
  assert.equal((await iframeState(page)).pe, 'auto');
});

await check('场景快速来回切 12 次: 最终状态一致', async () => {
  const out = await page.evaluate(async () => {
    const seq = ['dark', 'transparent', 'light', 'transparent', 'dark', 'transparent', 'light', 'dark', 'transparent', 'light', 'transparent', 'dark'];
    const rs = await Promise.allSettled(seq.map((s) => window.xc.setScene(s)));
    return rs.map((r) => r.status);
  });
  assert.ok(out.every((s) => s === 'fulfilled'), JSON.stringify(out));
  await sleep(800);
  assert.equal(await page.evaluate(() => window.xc.scene), 'dark');
  await page.mouse.move(CORNER.x, CORNER.y); await page.mouse.move(CORNER.x + 1, CORNER.y + 1);
  await sleep(400);
  assert.equal((await iframeState(page)).pe, 'auto');
  assert.ok(!isMagenta((await shot(page)).px(PROBE.x, PROBE.y)));
  // 然后以透明收尾, 再检查一次穿透
  await settle(page, (xc) => xc.setScene('transparent'));
  await sleep(800);
  await page.mouse.move(CORNER.x, CORNER.y); await page.mouse.move(CORNER.x + 2, CORNER.y);
  await sleep(500);
  assert.equal((await iframeState(page)).pe, 'none');
});

await check('说话中换装: 说话不被打断, 换装在说话期间/之后完成', async () => {
  await settle(page, (xc) => xc.setScene('light'));
  const out = await page.evaluate(async () => {
    const sr = 16000, secs = 4, n = sr * secs, pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) pcm[i] = Math.sin(i / 12) * 9000 * (0.6 + 0.4 * Math.sin(i / 3000));
    window.__ev.length = 0;
    const t0 = performance.now();
    const speak = window.xc.speakAudio(pcm.buffer, { format: 'pcm16', sampleRate: sr, motion: false }).then(() => ({ ok: true, at: performance.now() - t0 }), (e) => ({ ok: false, msg: String(e.message), at: performance.now() - t0 }));
    await new Promise((r) => setTimeout(r, 1000));
    const t1 = performance.now();
    const swap = await window.xc.setOutfit('xiaochun_swimsuit').then(() => ({ ok: true, at: performance.now() - t0, took: performance.now() - t1 }), (e) => ({ ok: false, msg: String(e.message) }));
    const sp = await speak;
    return { sp, swap, events: window.__ev.filter((e) => e.n === 'utterance' || e.n === 'error').map((e) => ({ n: e.n, ph: e.p.phase, code: e.p.code, at: Math.round(e.t - t0) })) };
  });
  console.log('   ', JSON.stringify(out));
  assert.ok(out.swap.ok, '换装应成功 ' + JSON.stringify(out.swap));
  assert.ok(out.sp.ok && out.sp.at > 3000, '说话应完整播完 (~4s): ' + JSON.stringify(out.sp));
  assert.ok(!out.events.some((e) => e.n === 'error'), '不应有 error');
  assert.ok(out.events.some((e) => e.n === 'utterance' && e.ph === 'end'));
  assert.equal(await page.evaluate(() => window.xc.outfit), 'xiaochun_swimsuit');
  timings.swapWhileSpeaking = out;
});

await check('allowCustomModel 门禁 (SDK 层): 默认拒绝 (iframe 侧门禁见上面的原始协议用例)', async () => {
  let r = await settle(page, (xc) => xc.setModel({ url: 'https://example.com/x.vrm' }));
  assert.ok(!r.ok && /unsupported|allowCustomModel/.test(r.msg), r.msg);
});

await check('预取: 单个 outfit 只下载进 IDB, 之后换装不再请求网络; 默认列表不含婚纱', async () => {
  await page.close();
  requests.length = 0;
  page = await newPage();
  await mk(page, { scene: 'light' });
  const target = 'xiaochun_office_lady';
  const avail = (await ev(page, 'handshake'))[0].p.capabilities.outfits.map((o) => o.id);
  const id = avail.includes(target) ? target : avail.find((a) => !['xiaochun_dinner_dress', 'xiaochun_wedding'].includes(a));
  const n0 = count(id + '.vrmaddon');
  const t = Date.now();
  const r1 = await settle(page, (xc, id) => xc.prefetch([id]), id);
  assert.ok(r1.ok, JSON.stringify(r1));
  console.log(`   prefetch(${id}) ->`, JSON.stringify(r1.v), `${Date.now() - t}ms`);
  assert.deepEqual(r1.v.failed, []);
  const keys = await idbKeys(page);
  assert.ok(keys.some((k) => k.includes(id)), 'IDB 中应有 ' + id + ': ' + keys.join('\n'));
  const n1 = count(id + '.vrmaddon');
  assert.equal(n1 - n0, 1, '预取只下载一次');
  const t2 = Date.now();
  const r2 = await settle(page, (xc, id) => xc.setOutfit(id), id); assert.ok(r2.ok, JSON.stringify(r2));
  timings.swapAfterPrefetchMs = Date.now() - t2;
  assert.equal(count(id + '.vrmaddon'), n1, '预取后换装不应再走网络 (IDB 命中)');
  // 再次预取: 全部 cached
  const r3 = await settle(page, (xc, id) => xc.prefetch([id]), id);
  assert.ok(r3.ok && r3.v.downloaded.length === 0 && r3.v.cached.includes(id), JSON.stringify(r3));
  // 默认全量 (不含婚纱)
  const t3 = Date.now();
  const r4 = await settle(page, (xc) => xc.prefetch());
  assert.ok(r4.ok, JSON.stringify(r4));
  timings.prefetchAllMs = Date.now() - t3;
  console.log('   prefetch() 全量 ->', JSON.stringify(r4.v), `${timings.prefetchAllMs}ms`);
  assert.ok(![...r4.v.downloaded, ...r4.v.cached, ...r4.v.failed].includes('xiaochun_wedding'));
  assert.equal(count('xiaochun_wedding'), 0, '默认预取不应请求婚纱');
  // 显式点名婚纱可以
  const prog = (await ev(page, 'progress')).map((e) => e.p).filter((p) => p.phase === 'prefetch');
  assert.ok(prog.length > 0, '应有 prefetch 阶段进度');
});

await check('?outfit= / ?scene= 初始值: 合法生效; 原型键/未知 id 回退默认并上报 unknown_id', async () => {
  await page.close(); page = await newPage();
  await mk(page, { outfit: 'xiaochun_maid', scene: 'dark' });
  assert.equal(await page.evaluate(() => window.xc.outfit), 'xiaochun_maid');
  assert.equal(await page.evaluate(() => window.xc.scene), 'dark');
  await page.close(); page = await newPage();
  await mk(page, { outfit: 'constructor', scene: 'constructor' }); // 通过 SDK 格式校验, 但不在白名单
  const errs = (await ev(page, 'error')).map((e) => e.p);
  console.log('   启动告警:', JSON.stringify(errs));
  assert.ok(errs.some((e) => e.code === 'unknown_id' && e.command === 'outfit'));
  assert.ok(errs.some((e) => e.code === 'unknown_id' && e.command === 'scene'));
  assert.equal(await page.evaluate(() => window.xc.outfit), 'xiaochun_dinner_dress');
  // 直接改 iframe URL 参数 (绕过 SDK) 同样安全
  await page.close(); page = await newPage();
  const res = await page.evaluate(async (EMBED_URL) => {
    const f = document.createElement('iframe');
    f.src = EMBED_URL + '?host=' + encodeURIComponent(location.origin) + '&lazy=0&outfit=__proto__&scene=constructor';
    f.style.cssText = 'width:300px;height:300px'; document.body.appendChild(f);
    const mc = new MessageChannel(); const log = [];
    mc.port1.onmessage = (e) => log.push(e.data);
    window.addEventListener('message', (e) => { if (e.data && e.data.type === 'xc.ready' && e.source === f.contentWindow) f.contentWindow.postMessage({ type: 'xc.init', v: 1, payload: {} }, new URL(EMBED_URL).origin, [mc.port2]); });
    for (let i = 0; i < 1200 && !log.some((m) => m.type === 'xc.loaded'); i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 500));
    return log.filter((m) => /outfit-changed|scene-changed|xc.error|xc.loaded/.test(m.type)).map((m) => ({ t: m.type, p: m.payload }));
  }, EMBED_URL);
  console.log('   ', JSON.stringify(res));
  assert.ok(res.some((m) => m.t === 'xc.outfit-changed' && m.p.id === 'xiaochun_dinner_dress'));
  assert.ok(res.some((m) => m.t === 'xc.error' && m.p.code === 'unknown_id'));
});

// ───────────────────────── 内置换装 / 换场景按钮 (ui: ['outfit','scene']) ─────────────────────────
const SHOT_DIR = process.env.SHOT_DIR; // 设置后保存几张截图 (桌面/窄屏, 透明/深色)
if (SHOT_DIR) (await import('node:fs')).mkdirSync(SHOT_DIR, { recursive: true });
const shotTo = async (pg, name) => { if (SHOT_DIR) await pg.screenshot({ path: path.join(SHOT_DIR, name) }); };
const OUTFIT_BTN = '#xc-btn-switch-outfit', SCENE_BTN = '#xc-btn-switch-scene';
const fr = (pg) => frameOf(pg);
const clickIn = async (pg, sel) => { const h = await fr(pg).waitForSelector(sel, { timeout: 15000 }); await h.click(); };
const menuItems = (pg) => fr(pg).$$eval('[role="menu"] [data-outfit-id]', (els) => els.map((e) => ({ id: e.getAttribute('data-outfit-id'), text: e.textContent, checked: !!e.querySelector('svg.lucide-check'), spin: !!e.querySelector('svg.animate-spin') })));
const closeMenu = async (pg) => { await pg.keyboard.press('Escape'); await sleep(250); };
const evNames = (pg, n) => pg.evaluate((n) => window.__ev.filter((e) => e.n === n).map((e) => e.p), n);

await check('ui 默认空: 没有内置按钮 (也没有 data-xc-ui 元素); ui:[] 同样', async () => {
  await page.close(); page = await newPage();
  await mk(page, { scene: 'light' });
  await sleep(800);
  assert.equal(await fr(page).evaluate(() => document.querySelectorAll('[data-xc-ui], #xc-btn-switch-outfit, #xc-btn-switch-scene').length), 0);
  await page.close(); page = await newPage();
  await mk(page, { scene: 'light', ui: [] });
  await sleep(500);
  assert.equal(await fr(page).evaluate(() => document.querySelectorAll('[data-xc-ui]').length), 0);
});

await check("ui:['outfit'] / ['scene'] 分别开关", async () => {
  await page.close(); page = await newPage();
  await mk(page, { scene: 'light', ui: ['outfit'] });
  await fr(page).waitForSelector(OUTFIT_BTN, { timeout: 15000 });
  assert.equal(await fr(page).evaluate((s) => !!document.querySelector(s), SCENE_BTN), false);
  await page.close(); page = await newPage();
  await mk(page, { scene: 'light', ui: ['scene'] });
  await fr(page).waitForSelector(SCENE_BTN, { timeout: 15000 });
  assert.equal(await fr(page).evaluate((s) => !!document.querySelector(s), OUTFIT_BTN), false);
});

// ---- 初始场景只靠 ?scene= (无 ?transparent= / ?theme=) 时, 引擎的线稿世界 / 背景必须和场景标记一致 ----
// 回归: ?scene=transparent 曾只被 sceneManager 识别 (菜单勾"透明背景"), vrmEngine 初始主题却读不到它,
// 于是按系统亮暗 / localStorage 建出线稿柱子世界; ?scene=light 在深色系统下同理变成 dark。
const engineScene = (pg, fr_) => (fr_ || pg).evaluate(() => { const e = window.vrmEngine; return e && { theme: e.getLineworkTheme(), world: e.lineworkWorld.rootGroup.visible, bg: !!e.scene.background, cls: document.documentElement.classList.contains('scene-transparent') }; });
await check('?scene= 单独指定: 顶层直开 (无宿主) 时线稿世界 / 背景 / 场景标记一致 (系统深色与浅色各一遍)', async () => {
  for (const [scheme, scene, want] of [['dark', 'transparent', { theme: 'transparent', world: false, bg: false, cls: true }], ['light', 'transparent', { theme: 'transparent', world: false, bg: false, cls: true }],
    ['dark', 'light', { theme: 'light', world: true, bg: true, cls: false }], ['light', 'dark', { theme: 'dark', world: true, bg: true, cls: false }]]) {
    const pg = await browser.newPage();
    await pg.setViewport({ width: 700, height: 560 });
    await pg.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await pg.goto(`${EMBED_URL}?ui=chat,outfit,scene&scene=${scene}&controls=1`, { waitUntil: 'load' });
    await pg.waitForFunction(() => window.vrmEngine && window.vrmEngine.lineworkWorld && document.querySelector('#vrm-canvas'), { timeout: 60000 });
    await sleep(2500);
    assert.deepEqual(await engineScene(pg), want, `系统 ${scheme} + ?scene=${scene}`);
    if (SHOT_DIR && scene === 'transparent' && scheme === 'light') await pg.screenshot({ path: path.join(SHOT_DIR, 'top-level-scene-transparent.png') });
    await pg.close();
  }
  // 旧参数 ?transparent=1 与 ?scene=transparent 一致
  const pg = await browser.newPage();
  await pg.goto(`${EMBED_URL}?transparent=1`, { waitUntil: 'load' });
  await pg.waitForFunction(() => window.vrmEngine && window.vrmEngine.lineworkWorld, { timeout: 60000 });
  await sleep(1500);
  assert.deepEqual(await engineScene(pg), { theme: 'transparent', world: false, bg: false, cls: true });
  await pg.close();
});

await check('?scene=transparent 手写 iframe (不带 transparent=1): 嵌在洋红宿主页里, 角落透出宿主, 线稿世界不存在', async () => {
  await page.close(); page = await newPage();
  await page.evaluate((EMBED_URL, W, H) => {
    const i = document.createElement('iframe');
    i.id = 'raw'; i.allow = 'autoplay'; i.style.cssText = `position:absolute;left:100px;top:60px;width:${W}px;height:${H}px;border:0;background:transparent`;
    i.src = `${EMBED_URL}?host=${encodeURIComponent(location.origin)}&scene=transparent&ui=outfit,scene`;
    document.body.appendChild(i);
  }, EMBED_URL, W, H);
  const f = () => page.frames().find((x) => x.url().startsWith(EMBED_ORIGIN));
  await page.waitForFunction(() => true);
  for (let i = 0; i < 60 && !f(); i++) await sleep(500);
  await f().waitForFunction(() => window.vrmEngine && window.vrmEngine.lineworkWorld && document.querySelector('#vrm-canvas'), { timeout: 60000 });
  await sleep(3000);
  assert.deepEqual(await engineScene(page, f()), { theme: 'transparent', world: false, bg: false, cls: true });
  const q = await shot(page);
  for (const [x, y] of [[LEFT + 6, TOP + 6], [LEFT + W - 6, TOP + H - 6], [LEFT + 6, TOP + H - 6]]) assert.ok(isMagenta(q.px(x, y)), `角落 (${x},${y}) 应透出宿主洋红, 实际 ${q.px(x, y)}`);
  if (SHOT_DIR) await shotTo(page, 'iframe-scene-transparent-magenta-host.png');
});

// ---- iframe 手势: 拖动 (draggable) / 角落缩放 (resizable) ----
// 宿主页是 900x700 视口, #a 在 (100, 60), 尺寸 W x H。位置 / 尺寸都以宿主上的 wrapper ([data-xiaochun]) 为准。
const wbox = (pg) => pg.evaluate(() => { const r = document.querySelector('[data-xiaochun]').getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
const assertBox = (got, want, msg) => assert.ok(['l', 't', 'w', 'h'].every((k) => near(got[k], want[k])), `${msg}: 期望 ${JSON.stringify(want)} 实际 ${JSON.stringify(got)}`);
/** 真鼠标拖: 先移到起点 (两步, 让穿透命中检测有机会把 iframe 切成 auto), 按下, 分步移动, 松开。 */
async function dragMouse(pg, from, to, { steps = 14, settleMs = 700 } = {}) {
  await pg.mouse.move(from.x - 3, from.y); await pg.mouse.move(from.x, from.y); await sleep(settleMs);
  await pg.mouse.down();
  for (let i = 1; i <= steps; i++) { await pg.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps); await sleep(16); }
  // 真人松手前指针会停一下: 在原地再补两次 move, 让 "正在移动的 iframe" 的屏幕原点 (screenX 用) 追上最新位置
  for (let i = 0; i < 2; i++) { await sleep(70); await pg.mouse.move(to.x, to.y); }
  await pg.mouse.up(); await sleep(400);
}
const watchBox = (pg) => pg.evaluate(() => { window.__box = []; for (const n of ['move', 'resize']) xc.on(n, (p) => window.__box.push(n + ':' + p.phase)); });
const boxEvents = (pg) => pg.evaluate(() => window.__box);
const gesturesClass = (pg) => frameOf(pg).evaluate(() => document.documentElement.classList.contains('xc-gestures'));
const selectionOf = async (pg) => ({ host: await pg.evaluate(() => String(window.getSelection())), frame: await frameOf(pg).evaluate(() => String(window.getSelection())) });
const mark = (pg) => frameOf(pg).evaluate(() => { window.__marker = 'same-document'; });
const marked = (pg) => frameOf(pg).evaluate(() => window.__marker);

/**
 * 手势用例里"指针拖到 iframe 外面" (向外拉大 / 拖到视口边) 依赖浏览器的 "鼠标捕获": 按下发生在 iframe 内, 之后的 move 要继续送给该 iframe。
 * 真实 Chrome 对跨进程 iframe 会这样做, 但 CDP 合成的鼠标事件不走这条路由 (move 会落到宿主页), 所以这类用例改在一个关掉站点隔离的 Chrome 里跑 (iframe 与宿主同进程, pointer capture 按规范工作)。
 * 只在 iframe 内部移动的手势用例仍然在默认 (跨进程 iframe) 浏览器里跑。
 */
async function withInProcessIframes(fn) {
  const main = browser;
  await page.close().catch(() => {});
  browser = await puppeteer.launch({
    executablePath, headless: 'new', protocolTimeout: 300000,
    args: ['--no-sandbox', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process'],
  });
  try { page = await newPage(); await fn(); } finally { await browser.close().catch(() => {}); browser = main; page = await newPage(); }
}

await check('手势: 默认关闭 (draggable / resizable 都不设) — 拖角色、拖角落都没有任何效果, iframe 不识别手势也不拦截 pointerdown', async () => {
  await page.close(); page = await newPage();
  await mk(page, { scene: 'light' }); await watchBox(page); await mark(page);
  await frameOf(page).evaluate(() => { window.__dp = []; document.addEventListener('pointerdown', (e) => window.__dp.push(e.defaultPrevented)); });
  const before = await wbox(page);
  await dragMouse(page, MODEL, { x: MODEL.x + 90, y: MODEL.y + 60 });
  await dragMouse(page, { x: LEFT + W - 10, y: TOP + H - 10 }, { x: LEFT + W + 60, y: TOP + H + 40 });
  assertBox(await wbox(page), before, '默认关闭: 位置 / 尺寸不变');
  assert.deepEqual(await boxEvents(page), []);
  assert.equal(await gesturesClass(page), false, 'iframe 没有挂手势监听 / 样式');
  assert.deepEqual(await frameOf(page).evaluate(() => window.__dp), [false, false], 'pointerdown 没有被 preventDefault');
  assert.equal(await frameOf(page).evaluate(() => document.querySelector('[data-xc-corners]') === null), true, '没有角落弧线');
  assert.equal(await marked(page), 'same-document');
});

await check('手势: draggable (不透明场景) — 左键拖角色 = 移动 iframe; 夹在视口内; 点一下不算拖; 拖动期间没有选中蓝框; 不重建', async () => {
  await page.close(); page = await newPage();
  await mk(page, { scene: 'light', draggable: true }); await watchBox(page); await mark(page);
  assert.equal(await gesturesClass(page), true);
  assertBox(await wbox(page), { l: LEFT, t: TOP, w: W, h: H }, '初始');
  await dragMouse(page, MODEL, { x: MODEL.x + 80, y: MODEL.y + 60 });
  assertBox(await wbox(page), { l: LEFT + 80, t: TOP + 60, w: W, h: H }, '拖 +80,+60');
  const ev1 = await boxEvents(page);
  assert.equal(ev1[0], 'move:start'); assert.equal(ev1.at(-1), 'move:end'); assert.ok(ev1.length >= 3, ev1.join());
  // 点一下 (没动) 不是拖动
  const n0 = (await boxEvents(page)).length;
  const c = { x: MODEL.x + 80, y: MODEL.y + 60 };
  await page.mouse.move(c.x, c.y); await sleep(300); await page.mouse.down(); await page.mouse.up(); await sleep(300);
  assert.equal((await boxEvents(page)).length, n0, '点一下不触发 move');
  // 限幅: 往右下拖爆 → 右 / 下边贴视口; 往左上拖爆 → 贴 0,0
  await dragMouse(page, c, { x: 895, y: 695 });
  assertBox(await wbox(page), { l: 900 - W, t: 700 - H, w: W, h: H }, '右下限幅');
  await dragMouse(page, { x: 900 - W / 2, y: 700 - H / 2 }, { x: 3, y: 3 });
  assertBox(await wbox(page), { l: 0, t: 0, w: W, h: H }, '左上限幅');
  // 选中蓝框: 宿主与 iframe 都没有选区, iframe 里 user-select:none
  const sel = await selectionOf(page);
  assert.deepEqual(sel, { host: '', frame: '' });
  assert.equal(await frameOf(page).evaluate(() => getComputedStyle(document.body).userSelect), 'none');
  assert.equal(await marked(page), 'same-document', 'iframe 没有被重建');
  assert.equal(page.frames().filter((f) => f.url().startsWith(EMBED_ORIGIN)).length, 1);
  // 运行时关闭: 同一个 iframe 立刻不再识别
  await page.evaluate(() => xc.setDraggable(false)); await sleep(300);
  assert.equal(await gesturesClass(page), false);
  await dragMouse(page, { x: W / 2, y: H / 2 }, { x: W / 2 + 100, y: H / 2 + 100 });
  assertBox(await wbox(page), { l: 0, t: 0, w: W, h: H }, '关闭后不再移动');
  assert.equal(await marked(page), 'same-document');
});

await check('手势: resizable — 悬停角落出现弧线 + 缩放光标; 拖四角缩放 (对角固定), 夹在最小 / 视口内; 只开 resizable 时拖角色不移动; iframe 不重建', () => withInProcessIframes(async () => {
  await mk(page, { scene: 'light', resizable: true }); await watchBox(page); await mark(page);
  assert.equal(await frameOf(page).evaluate(() => document.querySelector('[data-xc-corners]') !== null), true, '开了才渲染弧线容器');
  const arcsVisible = () => frameOf(page).evaluate(() => [...document.querySelectorAll('[data-xc-corners] svg')].map((e) => getComputedStyle(e).opacity));
  assert.ok((await arcsVisible()).every((o) => Number(o) > 0.9), '刚开启 resizable 时四角先亮一下 (提示可缩放)');
  await sleep(3400); // 闪现 2.5s + 淡出 0.5s
  assert.deepEqual((await arcsVisible()).map((o) => Number(o)), [0, 0, 0, 0], '没悬停时弧线不显示');
  const SE = { x: LEFT + W - 10, y: TOP + H - 10 };
  await page.mouse.move(SE.x - 4, SE.y); await page.mouse.move(SE.x, SE.y); await sleep(900);
  assert.equal(await frameOf(page).evaluate(() => document.documentElement.style.cursor), 'nwse-resize');
  assert.ok((await arcsVisible()).every((o) => Number(o) > 0.5), '悬停在角上, 四个弧线都亮');
  await page.mouse.move(MODEL.x, MODEL.y); await sleep(600);
  assert.equal(await frameOf(page).evaluate(() => document.documentElement.style.cursor), '', '离开角落恢复光标');
  // 拖角色不移动 (没开 draggable)
  await dragMouse(page, MODEL, { x: MODEL.x + 60, y: MODEL.y + 40 });
  assertBox(await wbox(page), { l: LEFT, t: TOP, w: W, h: H }, '只开 resizable: 拖角色不移动');
  // SE: 左上固定
  await dragMouse(page, SE, { x: SE.x + 60, y: SE.y + 40 });
  assertBox(await wbox(page), { l: LEFT, t: TOP, w: W + 60, h: H + 40 }, 'SE +60,+40');
  const ev = await boxEvents(page);
  assert.equal(ev[0], 'resize:start'); assert.equal(ev.at(-1), 'resize:end');
  // 画布跟着变大 (iframe 内视口), 但文档没重载
  const fsize = await frameOf(page).evaluate(() => [innerWidth, innerHeight]);
  assert.deepEqual(fsize, [W + 60, H + 40]);
  assert.equal(await marked(page), 'same-document');
  // SE 往外拖爆: 不越过视口右 / 下边
  const b1 = await wbox(page);
  await dragMouse(page, { x: b1.l + b1.w - 10, y: b1.t + b1.h - 10 }, { x: 895, y: 695 });
  assertBox(await wbox(page), { l: LEFT, t: TOP, w: 900 - LEFT, h: 700 - TOP }, 'SE 限幅到视口');
  // NW 往里拖爆: 最小 120x180, 右下固定
  const b2 = await wbox(page);
  await dragMouse(page, { x: b2.l + 10, y: b2.t + 10 }, { x: b2.l + b2.w - 5, y: b2.t + b2.h - 5 });
  assertBox(await wbox(page), { l: 900 - 120, t: 700 - 180, w: 120, h: 180 }, 'NW 最小尺寸, 右下固定');
  assert.equal(await marked(page), 'same-document', '缩放期间 iframe 没有重建 (模型 / 动画状态保留)');
  assert.equal(page.frames().filter((f) => f.url().startsWith(EMBED_ORIGIN)).length, 1);
}));

await check('手势: 四个角都能缩放 (NE / SW), 自定义最小 / 最大限幅', () => withInProcessIframes(async () => {
  await mk(page, { scene: 'light', resizable: { minWidth: 250, minHeight: 300, maxWidth: 450, maxHeight: 600 } });
  const NE = { x: LEFT + W - 10, y: TOP + 10 }, SW = { x: LEFT + 10, y: TOP + H - 10 };
  await dragMouse(page, NE, { x: NE.x + 30, y: NE.y - 20 }); // NE: 左下固定 -> 宽 +30, 高 +20 (向上长)
  assertBox(await wbox(page), { l: LEFT, t: TOP - 20, w: W + 30, h: H + 20 }, 'NE');
  const b = await wbox(page);
  await dragMouse(page, { x: b.l + 10, y: b.t + b.h - 10 }, { x: b.l + 10 - 200, y: b.t + b.h - 10 + 0 }); // SW 往左拖: 宽超 max 450 -> 夹到 450, 右上固定
  assertBox(await wbox(page), { l: b.l + b.w - 450, t: b.t, w: 450, h: b.h }, 'SW 夹到 maxWidth');
  void SW;
  const c = await wbox(page);
  await dragMouse(page, { x: c.l + c.w - 10, y: c.t + c.h - 10 }, { x: c.l + 20, y: c.t + 20 }); // SE 往里拖爆 -> 250x300
  assertBox(await wbox(page), { l: c.l, t: c.t, w: 250, h: 300 }, '夹到 minWidth/minHeight');
}));

await check('手势: 透明场景 + 穿透 — 只有点在角色 / 角落热区上才接管; 空白处仍穿透给宿主页 (拖不动); 只开 draggable 时角落不算热区', async () => {
  await page.close(); page = await newPage();
  await mk(page, { scene: 'transparent', draggable: true, resizable: true }); await watchBox(page);
  await sleep(3000);
  const BLANK = { x: LEFT + 30, y: TOP + H / 2 }; // 左边缘中段: 不在角色上, 也不在四角热区
  for (let i = 0, t0 = Date.now(); i < 12; i++) {
    await page.mouse.move(BLANK.x - 3, BLANK.y); await page.mouse.move(BLANK.x, BLANK.y); await sleep(350);
    if ((await iframeState(page)).pe === 'none' || Date.now() - t0 > 4000) break;
  }
  assert.equal((await iframeState(page)).pe, 'none', '空白处穿透');
  await dragMouse(page, BLANK, { x: BLANK.x + 120, y: BLANK.y + 80 }, { settleMs: 300 });
  assertBox(await wbox(page), { l: LEFT, t: TOP, w: W, h: H }, '空白处按下拖动: 事件落在宿主页, iframe 不动');
  assert.deepEqual(await boxEvents(page), []);
  // 角色上: 命中 -> iframe 接管 -> 拖动
  await page.mouse.move(MODEL.x - 4, MODEL.y); await page.mouse.move(MODEL.x, MODEL.y); await sleep(900);
  assert.equal((await iframeState(page)).pe, 'auto', '角色上接收事件');
  await dragMouse(page, MODEL, { x: MODEL.x + 70, y: MODEL.y + 50 }, { settleMs: 200 });
  assertBox(await wbox(page), { l: LEFT + 70, t: TOP + 50, w: W, h: H }, '角色上拖动 = 移动');
  // 角落热区: 指针移到右下角 (空白处) => 命中 => auto; 拖动 = 缩放
  const b = await wbox(page);
  const SE = { x: b.l + b.w - 10, y: b.t + b.h - 10 };
  await page.mouse.move(SE.x - 4, SE.y); await page.mouse.move(SE.x, SE.y); await sleep(900);
  assert.equal((await iframeState(page)).pe, 'auto', '角落热区算命中, 不穿透');
  await dragMouse(page, SE, { x: SE.x - 50, y: SE.y - 40 }, { settleMs: 200 });
  assertBox(await wbox(page), { l: b.l, t: b.t, w: W - 50, h: H - 40 }, '角落拖动 = 缩放');
  // 拖完把指针移回空白: 重新穿透
  await page.mouse.move(BLANK.x + 70, BLANK.y + 50); await page.mouse.move(BLANK.x + 72, BLANK.y + 50); await sleep(1200);
  assert.equal((await iframeState(page)).pe, 'none', '回到空白处又穿透');
  // 只开 draggable: 角落不是热区 (仍穿透)
  await page.close(); page = await newPage();
  await mk(page, { scene: 'transparent', draggable: true }); await sleep(3000);
  const C = { x: LEFT + W - 10, y: TOP + H - 10 };
  for (let i = 0, t0 = Date.now(); i < 12; i++) {
    await page.mouse.move(C.x - 3, C.y); await page.mouse.move(C.x, C.y); await sleep(350);
    if ((await iframeState(page)).pe === 'none' || Date.now() - t0 > 4000) break;
  }
  assert.equal((await iframeState(page)).pe, 'none', '只开 draggable: 角落不算热区');
});

await check('手势: 悬停四角 — 四个角的弧线都在 iframe 视口内且可见 (亮 / 暗 / 透明场景), 光标 nwse / nesw, 截图', async () => {
  const CURSOR = { NW: 'nwse-resize', SE: 'nwse-resize', NE: 'nesw-resize', SW: 'nesw-resize' };
  for (const scene of ['light', 'dark', 'transparent']) {
    await page.close(); page = await newPage();
    await mk(page, { scene, resizable: true }); await sleep(scene === 'transparent' ? 3000 : 800);
    const spots = { NW: { x: LEFT + 12, y: TOP + 12 }, NE: { x: LEFT + W - 12, y: TOP + 12 }, SW: { x: LEFT + 12, y: TOP + H - 12 }, SE: { x: LEFT + W - 12, y: TOP + H - 12 } };
    for (const [corner, pt] of Object.entries(spots)) {
      // 先移到别处 (淡出), 再移到角上
      await page.mouse.move(MODEL.x, MODEL.y); await sleep(3400); // 弧线淡出 (500ms 过渡) + 触屏闪现 / 进入闪现的 2.5s 计时都结束
      const beforeShot = await shot(page);
      for (let i = 0; i < 6; i++) { await page.mouse.move(pt.x - 3 + (i % 2), pt.y); await page.mouse.move(pt.x, pt.y); await sleep(350); if ((await iframeState(page)).pe === 'auto') break; }
      await sleep(900); // 弧线淡入 (500ms 过渡)
      const afterShot = await shot(page);
      // 像素级: 悬停后角落 34x34 里要有足够多的像素和悬停前明显不同 (弧线在亮 / 暗 / 透明背景上都看得见; 白色半透明弧线在亮场景上会"隐形")
      const bx = corner.endsWith('W') ? LEFT : LEFT + W - 34, by = corner.startsWith('N') ? TOP : TOP + H - 34;
      let strong = 0;
      for (let yy = 0; yy < 34; yy++) for (let xx = 0; xx < 34; xx++) if (Math.abs(lum(afterShot.px(bx + xx, by + yy)) - lum(beforeShot.px(bx + xx, by + yy))) >= 12) strong++;
      console.log(`   [${scene}/${corner}] 弧线明显像素数 = ${strong}`);
      assert.ok(strong >= 40, `${scene}/${corner}: 悬停后角落里应有足够对比度的弧线像素 (实际 ${strong})`);
      const info = await frameOf(page).evaluate(() => {
        const vw = innerWidth, vh = innerHeight;
        const svgs = [...document.querySelectorAll('[data-xc-corners] svg')].map((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), op: Number(cs.opacity) }; });
        return { vw, vh, svgs, cursor: document.documentElement.style.cursor };
      });
      if (SHOT_DIR) { const c = pt; await page.screenshot({ path: path.join(SHOT_DIR, `corner-hover-${scene}-${corner}.png`), clip: { x: Math.max(0, c.x - 70), y: Math.max(0, c.y - 70), width: 140, height: 140 }, captureBeyondViewport: false }); }
      assert.equal(info.cursor, CURSOR[corner], `${scene}/${corner}: 光标`);
      assert.equal(info.svgs.length, 4);
      for (const g of info.svgs) {
        // 容差 2px: 悬停放大 (scale-105) 只让 svg 盒子溢出 1px 透明边, 弧线本身内收 4px、阴影在盒子内, 不会被裁
        assert.ok(g.l >= -2 && g.t >= -2 && g.r <= info.vw + 2 && g.b <= info.vh + 2, `${scene}/${corner}: 弧线必须完全在 iframe 视口内 ${JSON.stringify(g)} vs ${info.vw}x${info.vh}`);
        assert.ok(g.op > 0.9, `${scene}/${corner}: 悬停时四个弧线都应显示 (opacity=${g.op})`);
      }
    }
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `corner-hover-${scene}-full.png`) });
  }
});

await check('手势: 运行时开启 resizable (创建时没开; 示例页复选框路径) — 悬停角落同样出现弧线和光标', async () => {
  for (const scene of ['light', 'transparent']) {
    await page.close(); page = await newPage();
    await mk(page, { scene }); await sleep(scene === 'transparent' ? 3000 : 800);
    assert.equal(await frameOf(page).evaluate(() => document.querySelector('[data-xc-corners]') === null), true, '关着时没有弧线容器');
    await page.evaluate(() => xc.setResizable(true)); await sleep(500);
    const pt = { x: LEFT + W - 12, y: TOP + H - 12 };
    await page.mouse.move(MODEL.x, MODEL.y); await sleep(600);
    for (let i = 0; i < 6; i++) { await page.mouse.move(pt.x - 3 + (i % 2), pt.y); await page.mouse.move(pt.x, pt.y); await sleep(350); if ((await iframeState(page)).pe === 'auto') break; }
    await sleep(900);
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `corner-hover-runtime-${scene}-SE.png`), clip: { x: pt.x - 70, y: pt.y - 70, width: 140, height: 140 }, captureBeyondViewport: false });
    const info = await frameOf(page).evaluate(() => ({ cursor: document.documentElement.style.cursor, ops: [...document.querySelectorAll('[data-xc-corners] svg')].map((e) => Number(getComputedStyle(e).opacity)) }));
    assert.equal(info.cursor, 'nwse-resize', `${scene}: 光标`);
    assert.ok(info.ops.length === 4 && info.ops.every((o) => o > 0.9), `${scene}: 弧线显示 ${JSON.stringify(info.ops)}`);
  }
});

await check('手势: 拖动在 light / dark / transparent 三种场景都能用 (创建时指定 + 运行时 setScene 切换): 不透明场景拖空白 / 角色都移动, 透明场景只有角色移动', async () => {
  const BLANKS = { left: { x: LEFT + 30, y: TOP + H / 2 }, top: { x: LEFT + W / 2, y: TOP + 24 }, bottom: { x: LEFT + 60, y: TOP + H - 60 } };
  for (const via of ['create', 'switch', 'runtime', 'runtime-switch']) {
    for (const scene of ['light', 'dark', 'transparent']) {
      await page.close(); page = await newPage();
      if (via === 'create') await mk(page, { scene, draggable: true });
      else if (via === 'switch') { await mk(page, { scene: scene === 'transparent' ? 'light' : 'transparent', draggable: true }); await page.evaluate((sc) => xc.setScene(sc), scene); }
      else if (via === 'runtime') { await mk(page, { scene }); await page.evaluate(() => xc.setDraggable(true)); await sleep(500); }
      else { await mk(page, { scene: scene === 'transparent' ? 'light' : 'transparent' }); await page.evaluate(() => xc.setDraggable(true)); await sleep(500); await page.evaluate((sc) => xc.setScene(sc), scene); }
      await watchBox(page); await sleep(scene === 'transparent' ? 3000 : 1200);
      const spots = { character: MODEL, ...BLANKS };
      let k = 0;
      for (const [name, from] of Object.entries(spots)) {
        const sg = k++ % 2 ? -1 : 1; // 交替方向: 别撞视口边界 (限幅另有用例)
        const start = await wbox(page);
        const f = { x: from.x + (start.l - LEFT), y: from.y + (start.t - TOP) };
        await dragMouse(page, f, { x: f.x + 40 * sg, y: f.y + 30 * sg }, { settleMs: scene === 'transparent' ? 900 : 300 });
        const end = await wbox(page);
        const moved = near(end.l - start.l, 40 * sg) && near(end.t - start.t, 30 * sg);
        const expectMove = scene !== 'transparent' || name === 'character';
        assert.equal(moved, expectMove, `${via}/${scene}/${name}: 期望${expectMove ? '移动' : '不动'} 实际 ${JSON.stringify(start)} -> ${JSON.stringify(end)}`);
        if (!expectMove) assert.deepEqual(end, start);
      }
    }
  }
});

await check('手势: 悬浮模式 (position: bottom-right, SDK 与 <xiaochun-avatar>) 在 light / dark / transparent 下拖空白 / 角色都移动', async () => {
  for (const kind of ['sdk', 'element']) {
    for (const scene of ['light', 'dark', 'transparent']) {
      await page.close(); page = await newPage();
      if (kind === 'sdk') {
        await mk(page, { scene: scene === 'transparent' ? 'light' : 'transparent', draggable: true, position: 'bottom-right', width: 300, height: 420 });
        await page.evaluate((sc) => xc.setScene(sc), scene);
      } else {
        await page.evaluate(async (EMBED_URL) => {
          const el = document.createElement('xiaochun-avatar');
          el.setAttribute('src', EMBED_URL); el.setAttribute('position', 'bottom-right'); el.setAttribute('size', '300x420'); el.setAttribute('draggable', ''); el.setAttribute('scene', 'transparent'); el.setAttribute('lazy', 'false');
          document.body.appendChild(el); window.el = el;
          await new Promise((r) => el.addEventListener('xc-ready', r, { once: true }));
        }, EMBED_URL);
        await page.evaluate((sc) => window.el.setAttribute('scene', sc), scene);
      }
      await sleep(scene === 'transparent' ? 3000 : 1500);
      const spots = (b) => ({ character: { x: b.l + b.w / 2, y: b.t + b.h * 0.5 }, blankLeft: { x: b.l + 24, y: b.t + b.h / 2 }, blankTop: { x: b.l + b.w / 2, y: b.t + 20 } });
      let k = 0;
      for (const name of ['character', 'blankLeft', 'blankTop']) {
        const sg = k++ % 2 ? 1 : -1; // 悬浮在右下角: 先往左上
        const start = await page.evaluate(() => { const r = document.querySelector('[data-xiaochun]')?.getBoundingClientRect() || document.querySelector('xiaochun-avatar').shadowRoot?.querySelector('[data-xiaochun]')?.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
        const f = spots(start)[name];
        await dragMouse(page, f, { x: f.x + 40 * sg, y: f.y + 30 * sg }, { settleMs: scene === 'transparent' ? 900 : 300 });
        const end = await page.evaluate(() => { const r = document.querySelector('[data-xiaochun]')?.getBoundingClientRect() || document.querySelector('xiaochun-avatar').shadowRoot?.querySelector('[data-xiaochun]')?.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
        const moved = near(end.l - start.l, 40 * sg) && near(end.t - start.t, 30 * sg);
        const expectMove = scene !== 'transparent' || name === 'character';
        console.log(`   [${kind}/${scene}/${name}] ${JSON.stringify(start)} -> ${JSON.stringify(end)} moved=${moved}`);
        assert.equal(moved, expectMove, `${kind}/${scene}/${name}`);
      }
    }
  }
});

const radiusOf = (pg) => pg.evaluate(() => { const i = document.querySelector('iframe'); const w = document.querySelector('[data-xiaochun]'); return { iframe: getComputedStyle(i).borderTopLeftRadius, wrapper: getComputedStyle(w).borderTopLeftRadius, br: getComputedStyle(i).borderBottomRightRadius }; });

await check('圆角: 非透明场景默认 20px (与 Tauri 窗口圆角同值), 角被裁掉透出宿主; 透明场景 0; 缩放 / setBorderRadius 不重建 iframe, 半径不随尺寸变形; borderRadius / --xc-radius 可覆盖', async () => {
  await page.close(); page = await newPage();
  await mk(page, { scene: 'light', resizable: true, draggable: true }); await mark(page); await sleep(1200);
  assert.deepEqual(await radiusOf(page), { iframe: '20px', wrapper: '20px', br: '20px' });
  const cornersClipped = async (w, h, msg) => {
    const sh = await shot(page);
    for (const [x, y] of [[LEFT + 2, TOP + 2], [LEFT + w - 3, TOP + 2], [LEFT + 2, TOP + h - 3], [LEFT + w - 3, TOP + h - 3]]) assert.ok(isMagenta(sh.px(x, y)), `${msg}: (${x},${y}) 应被圆角裁掉 (透出宿主洋红) ${sh.px(x, y)}`);
    for (const [x, y] of [[LEFT + 28, TOP + 28], [LEFT + w - 29, TOP + 28], [LEFT + 28, TOP + h - 29], [LEFT + w - 29, TOP + h - 29]]) assert.ok(!isMagenta(sh.px(x, y)), `${msg}: (${x},${y}) 在圆角内应有画面`);
  };
  await cornersClipped(W, H, '默认');
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, 'rounded-light.png') });
  // 缩放 (真实角落拖拽): 半径仍是 20px, 不随尺寸变形; iframe 没重建
  await page.evaluate(() => xc.setSize(300, 420)); await sleep(500);
  assert.deepEqual(await radiusOf(page), { iframe: '20px', wrapper: '20px', br: '20px' });
  await cornersClipped(300, 420, '缩放后');
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, 'rounded-light-resized.png') });
  await page.evaluate(() => xc.setSize(400, 560));
  // 热改
  await page.evaluate(() => xc.setBorderRadius(40)); await sleep(300);
  assert.equal((await radiusOf(page)).iframe, '40px');
  await page.evaluate(() => xc.setBorderRadius(undefined)); await sleep(300);
  assert.equal((await radiusOf(page)).iframe, '20px');
  // 场景切换: 透明 0 -> 非透明 20
  await page.evaluate(() => xc.setScene('transparent')); await sleep(800);
  assert.equal((await radiusOf(page)).iframe, '0px');
  await page.evaluate(() => xc.setScene('dark')); await sleep(800);
  assert.equal((await radiusOf(page)).iframe, '20px');
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, 'rounded-dark.png') });
  assert.equal(await marked(page), 'same-document', 'iframe 没有被重建');
  // 宿主 CSS 变量优先
  await page.evaluate(() => { document.querySelector('#a').style.setProperty('--xc-radius', '8px'); }); await sleep(200);
  assert.equal((await radiusOf(page)).iframe, '8px');
  // 选项 borderRadius: 0 -> 方角; 透明场景默认 0
  await page.close(); page = await newPage();
  await mk(page, { scene: 'light', borderRadius: 0 }); await sleep(1200);
  assert.equal((await radiusOf(page)).iframe, '0px');
  assert.ok(!isMagenta((await shot(page)).px(LEFT + 2, TOP + 2)), 'borderRadius:0: 方角, 角上有画面');
  await page.close(); page = await newPage();
  await mk(page, { scene: 'transparent' }); await sleep(1200);
  assert.equal((await radiusOf(page)).iframe, '0px');
});

await check('手势一致性: 短拖 = 移动; 长按 (> 武装时间) 后拖 = 转身 / 相机, 不移动 iframe; 平台主修饰键 (mac Cmd / 其它 Ctrl) 按住拖 = 立即 3D, 不移动 iframe (与 Tauri 同一台状态机)', async () => {
  const fresh = async () => { await page.close(); page = await newPage(); await mk(page, { scene: 'light', draggable: true }); await watchBox(page); await sleep(1200); return wbox(page); };
  // 1) 短拖 = 移动
  let base = await fresh();
  await dragMouse(page, MODEL, { x: MODEL.x + 50, y: MODEL.y + 30 }, { settleMs: 200 });
  assertBox(await wbox(page), { ...base, l: base.l + 50, t: base.t + 30 }, '短拖移动');
  // 2) 平台主修饰键: 立即 3D (iframe 看不到宿主页的 keydown, 靠指针事件上的修饰键标志)
  base = await fresh();
  const key = (await page.evaluate(() => /Mac/.test(navigator.platform))) ? 'Meta' : 'Control';
  await page.keyboard.down(key);
  await dragMouse(page, MODEL, { x: MODEL.x + 60, y: MODEL.y + 40 }, { settleMs: 200 });
  await page.keyboard.up(key);
  assertBox(await wbox(page), base, `${key} 按住拖: iframe 不动`);
  assert.deepEqual(await boxEvents(page), [], `${key} 按住拖: 不发 move`);
  // 3) 长按 700ms 再拖 (武装后进入转身 / 相机调整模式, 与 Tauri 一致 —— 此后一段时间内再拖也是转身)
  base = await fresh();
  await page.mouse.move(MODEL.x - 3, MODEL.y); await page.mouse.move(MODEL.x, MODEL.y); await sleep(200);
  await page.mouse.down(); await sleep(700);
  for (let i = 1; i <= 10; i++) { await page.mouse.move(MODEL.x + 6 * i, MODEL.y + 3 * i); await sleep(16); }
  await page.mouse.up(); await sleep(400);
  assertBox(await wbox(page), base, '长按后拖: iframe 不动');
  assert.deepEqual(await boxEvents(page), [], '长按后拖: 不发 move');
});

await check('引导: 3D 调整提示 (平台修饰键按住拖 / 长按后拖) 在 light / dark / transparent 下可辨, 带柔和深色阴影 (截图)', async () => {
  const key = (await page.evaluate(() => /Mac/.test(navigator.platform))) ? 'Meta' : 'Control';
  for (const scene of ['light', 'dark', 'transparent']) {
    for (const mode of ['modifier', 'longpress']) {
      await page.close(); page = await newPage();
      await mk(page, { scene, draggable: true }); await sleep(scene === 'transparent' ? 3000 : 1200);
      await page.mouse.move(LEFT + 5, TOP + 5); await sleep(500);
      const before = await shot(page);
      await page.mouse.move(MODEL.x - 3, MODEL.y); await page.mouse.move(MODEL.x, MODEL.y); await sleep(200);
      if (mode === 'modifier') await page.keyboard.down(key);
      await page.mouse.down();
      if (mode === 'longpress') await sleep(700);
      for (let i = 1; i <= 8; i++) { await page.mouse.move(MODEL.x + 4 * i, MODEL.y + 2 * i); await sleep(16); }
      await sleep(700); // 引导淡入
      const during = await shot(page);
      if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `guide-shadow-${scene}-${mode}.png`) });
      await page.mouse.up(); if (mode === 'modifier') await page.keyboard.up(key);
      // 比较整个 iframe 区域: 有明显"变暗"的像素 (阴影) 且有明显"变亮"的像素 (白色主体)
      let darker = 0, brighter = 0;
      for (let yy = TOP; yy < TOP + H; yy += 2) for (let xx = LEFT; xx < LEFT + W; xx += 2) {
        const d = lum(during.px(xx, yy)) - lum(before.px(xx, yy));
        if (d <= -12) darker++; else if (d >= 12) brighter++;
      }
      console.log(`   [guide ${scene}/${mode}] darker=${darker} brighter=${brighter}`);
      if (scene === 'light') assert.ok(darker >= 30, `light/${mode}: 浅色背景上引导必须有深色阴影才看得清 (变暗像素 ${darker})`);
    }
  }
});

// (放在会真点按钮 / 开菜单的用例之前: 实测在那之后同一浏览器里紧接着新开的透明页偶发整页渲染成黑色 (命中检测因此恒为命中)。
// 单独跑或放在前面都稳定通过, 原因未查明, 怀疑是无头 Chrome / SwiftShader 的页面切换状态, 没有在产品代码里发现问题。)
await check('透明场景: 按钮参与穿透命中 (按钮上接收事件, 空白处仍穿透), 菜单打开期间不穿透, 关闭后恢复', async () => {
  await page.close(); page = await newPage();
  await mk(page, { scene: 'transparent', ui: ['outfit', 'scene'] });
  await sleep(3000); // 等入场动画等视觉效果结束 (命中检测读的是渲染像素)
  await fr(page).waitForSelector(OUTFIT_BTN);
  const b = await (await fr(page).$(OUTFIT_BTN)).boundingBox();
  const bx = b.x + b.width / 2, by = b.y + b.height / 2;
  // 1) 空白处 (左上角, 不在按钮/角色上) => none
  // (首帧渲染刚结束时命中检测偶有一次读到残留像素, 所以允许在 4 秒内稳定到 none)
  for (let i = 0, t0 = Date.now(); i < 12; i++) {
    await page.mouse.move(LEFT + 6, TOP + 6); await page.mouse.move(LEFT + 10 + (i % 3), TOP + 10); await sleep(350);
    if ((await iframeState(page)).pe === 'none' || Date.now() - t0 > 4000) break;
  }
  assert.equal((await iframeState(page)).pe, 'none', '空白处穿透 ' + JSON.stringify((await ev(page, 'hit-region')).map((e) => e.p)));
  assert.notEqual(await page.evaluate((x, y) => document.elementFromPoint(x, y)?.tagName, LEFT + 10, TOP + 10), 'IFRAME');
  // 2) 按钮上 => auto
  await page.mouse.move(bx - 4, by); await page.mouse.move(bx, by); await sleep(700);
  assert.equal((await iframeState(page)).pe, 'auto', '按钮上应接收事件');
  // 3) 真点击 -> 菜单打开
  await page.mouse.click(bx, by);
  await fr(page).waitForSelector('[role="menu"] [data-outfit-id]', { timeout: 5000 });
  // 4) 菜单打开时指针移到空白处, 仍然 auto (点菜单外面才能关菜单)
  await page.mouse.move(LEFT + 6, TOP + 6); await page.mouse.move(LEFT + 10, TOP + 10); await sleep(500);
  assert.equal((await iframeState(page)).pe, 'auto', '菜单打开期间不穿透');
  if (SHOT_DIR) {
    await page.evaluate(() => { document.body.style.background = 'linear-gradient(160deg,#fff1f0,#efe7ff 55%,#e3fbf1)'; });
    await page.mouse.move(bx, by + 4); await sleep(300);
    await shotTo(page, 'desktop-transparent-outfit-menu.png');
  }
  // 5) 选一个服装 => 菜单关闭; 指针在空白处 => 恢复穿透
  await fr(page).click('[role="menu"] [data-outfit-id="xiaochun_office_lady"]');
  await page.mouse.move(LEFT + 8, TOP + 8); await sleep(900);
  assert.equal((await iframeState(page)).pe, 'none', '菜单关闭后空白处恢复穿透');
  await page.waitForFunction(() => window.xc.outfit === 'xiaochun_office_lady', { timeout: 30000 });
  // 6) 角色身上仍然接收事件
  await page.mouse.move(MODEL.x - 4, MODEL.y); await page.mouse.move(MODEL.x, MODEL.y); await sleep(700);
  assert.equal((await iframeState(page)).pe, 'auto');
  // 7) 切到不透明 => 强制 auto (行为同之前)
  await settle(page, (xc) => xc.setScene('dark')); await sleep(400);
  await page.mouse.move(LEFT + 6, TOP + 6); await page.mouse.move(LEFT + 10, TOP + 10); await sleep(500);
  assert.equal((await iframeState(page)).pe, 'auto');
  if (SHOT_DIR) {
    await clickIn(page, SCENE_BTN); await fr(page).waitForSelector('[role="menu"] [data-scene-id]'); await sleep(300);
    await shotTo(page, 'desktop-dark-scene-menu.png');
    await closeMenu(page);
  }
});

await check('按钮点选换装: 列表 = capabilities (无 base, 只有服装名, 不显示体积) → 点选后 outfit-changed 到宿主, 当前项 ✓, 再点同一项无事发生', async () => {
  await page.close(); page = await newPage();
  await mk(page, { scene: 'light', ui: ['outfit', 'scene'] });
  const caps = (await ev(page, 'handshake'))[0].p.capabilities.outfits;
  assert.ok(caps.every((o) => typeof o.sizeMB === 'number'), 'capabilities.outfits 带 sizeMB');
  await clickIn(page, OUTFIT_BTN);
  await fr(page).waitForSelector('[role="menu"] [data-outfit-id]');
  const items = await menuItems(page);
  assert.deepEqual(items.map((i) => i.id).sort(), caps.map((o) => o.id).sort(), '菜单 = capabilities.outfits');
  assert.ok(!items.some((i) => i.id === 'base'));
  assert.ok(items.every((i) => !/MB/i.test(i.text) && !/\d\.\d/.test(i.text)), '菜单里不显示体积: ' + items.map((i) => i.text).join(' | '));
  assert.deepEqual(items.map((i) => i.text.trim()).sort(), caps.map((o) => o.name).sort(), '每行只有服装名');
  assert.equal(await fr(page).$$eval('[role="menu"] .text-amber-300', (e) => e.length), 0, '没有金色高亮');
  assert.equal(items.filter((i) => i.checked).map((i) => i.id).join(), 'xiaochun_dinner_dress');
  const n0 = (await evNames(page, 'outfit-changed')).length;
  await fr(page).click('[role="menu"] [data-outfit-id="xiaochun_maid"]');
  await page.waitForFunction(() => window.xc.outfit === 'xiaochun_maid', { timeout: 30000 });
  const oc = (await evNames(page, 'outfit-changed')).slice(n0);
  assert.equal(oc.length, 1); assert.equal(oc[0].id, 'xiaochun_maid'); assert.equal(oc[0].previous, 'xiaochun_dinner_dress');
  await clickIn(page, OUTFIT_BTN);
  await fr(page).waitForSelector('[role="menu"] [data-outfit-id]');
  assert.equal((await menuItems(page)).filter((i) => i.checked).map((i) => i.id).join(), 'xiaochun_maid');
  const reqs = count('xiaochun_maid.vrmaddon');
  await fr(page).click('[role="menu"] [data-outfit-id="xiaochun_maid"]'); // 已穿着: 什么都不发生
  await sleep(500);
  assert.equal(count('xiaochun_maid.vrmaddon'), reqs);
  assert.equal((await evNames(page, 'outfit-changed')).length, n0 + 1);
});

await check('按钮点选换场景: scene-changed 到宿主, 外壳/穿透同步', async () => {
  const n0 = (await evNames(page, 'scene-changed')).length;
  await clickIn(page, SCENE_BTN);
  await fr(page).waitForSelector('[role="menu"] [data-scene-id="dark"]');
  await fr(page).click('[role="menu"] [data-scene-id="dark"]');
  await page.waitForFunction(() => window.xc.scene === 'dark');
  const sc = (await evNames(page, 'scene-changed')).slice(n0);
  assert.equal(sc.length, 1); assert.equal(sc[0].id, 'dark'); assert.equal(sc[0].previous, 'light');
  await sleep(500);
  assert.ok(lum((await shot(page)).px(PROBE.x, PROBE.y)) < 60, '深色场景');
  await clickIn(page, SCENE_BTN);
  await fr(page).waitForSelector('[role="menu"] [data-scene-id]');
  const rows = await fr(page).$$eval('[role="menu"] [data-scene-id]', (els) => els.map((e) => [e.getAttribute('data-scene-id'), !!e.querySelector('svg.lucide-check')]));
  assert.deepEqual(rows.filter((r) => r[1]).map((r) => r[0]), ['dark']);
  assert.deepEqual(rows.map((r) => r[0]), ['light', 'dark', 'transparent']);
  await closeMenu(page);
});

await check('SDK 调用换装/换场景后, 按钮状态同步 (✓ 与加载中 spinner)', async () => {
  // 加载中: 宿主发起的换装也会让按钮转圈
  const p = page.evaluate(() => window.xc.setOutfit('xiaochun_techwear'));
  let sawSpin = false;
  for (let i = 0; i < 40 && !sawSpin; i++) { sawSpin = await fr(page).evaluate((s) => document.querySelector(s)?.getAttribute('data-loading') === '1', OUTFIT_BTN); if (!sawSpin) await sleep(25); }
  await p;
  assert.ok(sawSpin, '宿主发起的换装期间按钮应显示 loading');
  await sleep(200);
  assert.equal(await fr(page).evaluate((s) => document.querySelector(s)?.getAttribute('data-loading'), OUTFIT_BTN), null);
  await clickIn(page, OUTFIT_BTN);
  await fr(page).waitForSelector('[role="menu"] [data-outfit-id]');
  assert.equal((await menuItems(page)).filter((i) => i.checked).map((i) => i.id).join(), 'xiaochun_techwear');
  await closeMenu(page);
  await settle(page, (xc) => xc.setScene('light'));
  await clickIn(page, SCENE_BTN);
  await fr(page).waitForSelector('[role="menu"] [data-scene-id]');
  const cur = await fr(page).$$eval('[role="menu"] [data-scene-id]', (els) => els.filter((e) => e.querySelector('svg.lucide-check')).map((e) => e.getAttribute('data-scene-id')));
  assert.deepEqual(cur, ['light']);
  await closeMenu(page);
});

await check('按钮的指针事件不会冒到 canvas (不触发转身/拖动手势); 点画布本身会', async () => {
  await fr(page).evaluate(() => { window.__cdown = 0; document.querySelector('canvas').addEventListener('pointerdown', () => { window.__cdown++; }); });
  await clickIn(page, OUTFIT_BTN); await sleep(200); await closeMenu(page);
  await clickIn(page, SCENE_BTN); await sleep(200); await closeMenu(page);
  // 在按钮上按下并拖动
  const b = await (await fr(page).$(OUTFIT_BTN)).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x - 120, b.y + 60, { steps: 6 }); await page.mouse.up();
  await sleep(200); await closeMenu(page);
  assert.equal(await fr(page).evaluate(() => window.__cdown), 0, '按钮上的 pointerdown 不应到达 canvas');
  await page.mouse.click(LEFT + 40, TOP + H - 60); // 空白处点画布
  await sleep(100);
  assert.ok((await fr(page).evaluate(() => window.__cdown)) >= 1, '画布上的点击仍然正常到达 canvas');
});

await check('连点换装: 先到的跑, 中间被顶掉 → 轻提示 busy, 最后一次生效; 宿主按序收到事件', async () => {
  await settle(page, (xc) => xc.setOutfit('xiaochun_dinner_dress'));
  const n0 = (await evNames(page, 'outfit-changed')).length;
  // 在 iframe 内用 DOM 事件连点 (真鼠标点击每次要 100~300ms, 达不到"换装进行中又点了别的"的节奏)
  await fr(page).evaluate(async (ids, btn) => {
    const until = async (f) => { for (let i = 0; i < 100; i++) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); } throw new Error('timeout'); };
    for (const id of ids) {
      document.querySelector(btn).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      const item = await until(() => document.querySelector(`[role="menu"] [data-outfit-id="${id}"]`));
      item.click();
      await new Promise((r) => setTimeout(r, 30));
    }
  }, ['xiaochun_maid', 'xiaochun_swimsuit', 'xiaochun_bikini', 'xiaochun_cheongsam'], OUTFIT_BTN);
  const toast = await fr(page).evaluate(() => document.querySelector('[role="status"]')?.textContent || '');
  console.log('   轻提示文案:', JSON.stringify(toast));
  assert.ok(toast.length > 3, '应出现 busy 轻提示');
  await page.waitForFunction(() => window.xc.outfit === 'xiaochun_cheongsam', { timeout: 30000 });
  const ids = (await evNames(page, 'outfit-changed')).slice(n0).filter((p) => !p.noop).map((p) => p.id);
  console.log('   宿主收到的 outfit-changed 序列:', ids.join(' -> '));
  assert.equal(ids[ids.length - 1], 'xiaochun_cheongsam');
  assert.ok(ids.length <= 3 && ids[0] === 'xiaochun_maid', '先到的先跑, 中间的被顶掉, 不会全部加载: ' + ids.join());
  await sleep(2500);
  assert.equal(await fr(page).evaluate(() => document.querySelector('[role="status"]')), null, '轻提示自动消失');
});

await check('窄屏 (360x640 触屏, 深色场景): 按钮 ≥40px、不遮挡角色、在 iframe 内, 点触可开菜单并换装', async () => {
  await page.close(); page = await newPage();
  await page.setViewport({ width: 360, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await mk(page, { scene: 'dark', ui: ['outfit', 'scene'], width: 320, height: 520 });
  await page.evaluate(() => { document.querySelector('#a').style.left = '20px'; document.querySelector('#a').style.top = '40px'; });
  await sleep(1500);
  const ob = await (await fr(page).$(OUTFIT_BTN)).boundingBox(), sb = await (await fr(page).$(SCENE_BTN)).boundingBox();
  const fb = await (await page.$('iframe')).boundingBox();
  console.log('   窄屏按钮尺寸:', Math.round(ob.width) + 'x' + Math.round(ob.height), '位置(相对 iframe 左上):', Math.round(ob.x - fb.x), Math.round(ob.y - fb.y));
  assert.ok(ob.width >= 40 && ob.height >= 40, '触控目标 >= 40px');
  assert.ok(ob.x + ob.width <= fb.x + fb.width + 1 && sb.x >= fb.x && sb.x + sb.width <= ob.x, '两个按钮并排在 iframe 内');
  assert.ok(ob.y - fb.y < 20, '贴顶部, 不压在角色中部');
  await page.touchscreen.tap(ob.x + ob.width / 2, ob.y + ob.height / 2);
  await fr(page).waitForSelector('[role="menu"] [data-outfit-id]', { timeout: 8000 });
  const menuBox = await (await fr(page).$('[role="menu"]')).boundingBox();
  assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 360 + 1, '菜单在视口内');
  await sleep(300);
  await shotTo(page, 'mobile-dark-outfit-menu.png');
  const it = await (await fr(page).$('[role="menu"] [data-outfit-id="xiaochun_shroud"]')).boundingBox();
  await page.touchscreen.tap(it.x + it.width / 2, it.y + it.height / 2);
  await page.waitForFunction(() => window.xc.outfit === 'xiaochun_shroud', { timeout: 30000 });
  await sleep(600);
  await shotTo(page, 'mobile-dark-after-swap.png');
});

await check('触屏 + 透明场景: 第一次点击唤醒命中检测 (落在宿主上), 第二次点击落到内置按钮上', async () => {
  await page.close(); page = await newPage();
  await page.setViewport({ width: 360, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await mk(page, { scene: 'transparent', ui: ['outfit'], width: 320, height: 520 });
  await page.evaluate(() => { document.querySelector('#a').style.left = '20px'; document.querySelector('#a').style.top = '40px'; });
  await sleep(1500);
  const ob = await (await fr(page).$(OUTFIT_BTN)).boundingBox();
  const cx = ob.x + ob.width / 2, cy = ob.y + ob.height / 2;
  assert.equal((await iframeState(page)).pe, 'none');
  await page.touchscreen.tap(cx, cy); await sleep(700);
  assert.equal((await iframeState(page)).pe, 'auto', '第一次点击后 iframe 应转为接收事件');
  await page.touchscreen.tap(cx, cy);
  await fr(page).waitForSelector('[role="menu"] [data-outfit-id]', { timeout: 8000 });
  await closeMenu(page);
});

// ---- iframe 自己的 localStorage 偏好: 服装 xiaochun_wearing_outfit / 场景 xiaochun_scene_theme ----
const KEY_OUTFIT = 'xiaochun_wearing_outfit', KEY_SCENE = 'xiaochun_scene_theme';
const lsGet = (pg, k) => frameOf(pg).evaluate((k) => localStorage.getItem(k), k);
const reMk = async (pg, opts = {}) => { await pg.evaluate(() => window.xc.destroy()); await mk(pg, opts); };
await check('iframe 偏好: xc.setOutfit / xc.setScene 写回 iframe 自己的存储, 重新加载能恢复; 显式参数优先; 坏数据忽略并清掉', async () => {
  await page.close(); page = await newPage();
  await mk(page, { scene: undefined });
  const def = await page.evaluate(() => window.xc.outfit);
  assert.equal(def, 'xiaochun_dinner_dress', '没存过偏好 => 默认服装');
  assert.equal(await lsGet(page, KEY_OUTFIT), null, '初始加载不写存储');
  // 1) 宿主 SDK 调用 -> 写回
  await settle(page, (xc) => xc.setOutfit('xiaochun_maid'));
  await settle(page, (xc) => xc.setScene('dark'));
  assert.equal(await lsGet(page, KEY_OUTFIT), 'xiaochun_maid');
  assert.equal(await lsGet(page, KEY_SCENE), 'dark', 'setScene 写回场景存储');
  // 2) 重新加载 (不带任何显式参数) -> 恢复
  await reMk(page, {});
  assert.equal(await page.evaluate(() => window.xc.outfit), 'xiaochun_maid', 'reload 后恢复服装');
  assert.equal(await page.evaluate(() => window.xc.scene), 'dark', 'reload 后恢复场景');
  // 3) 显式参数 > 存的 (且显式的初始值不会覆盖存的)
  await reMk(page, { outfit: 'xiaochun_bikini', scene: 'light' });
  assert.equal(await page.evaluate(() => window.xc.outfit), 'xiaochun_bikini');
  assert.equal(await page.evaluate(() => window.xc.scene), 'light');
  assert.equal(await lsGet(page, KEY_OUTFIT), 'xiaochun_maid', '显式初始值不写存储');
  await reMk(page, {});
  assert.equal(await page.evaluate(() => window.xc.outfit), 'xiaochun_maid', '去掉显式参数后又回到存的');
  // 4) 坏数据: 不在白名单 -> 忽略并清掉, 回默认
  await frameOf(page).evaluate((a, b) => { localStorage.setItem(a, 'constructor'); localStorage.setItem(b, 'pink'); }, KEY_OUTFIT, KEY_SCENE);
  await reMk(page, {});
  assert.equal(await page.evaluate(() => window.xc.outfit), 'xiaochun_dinner_dress', '坏服装 id => 默认');
  assert.ok(['light', 'dark'].includes(await page.evaluate(() => window.xc.scene)), '坏场景 id => 回退 (不是 pink)');
  assert.equal(await lsGet(page, KEY_OUTFIT), null, '坏服装偏好被清掉');
  assert.equal(await lsGet(page, KEY_SCENE), null, '坏场景偏好被清掉');
  await frameOf(page).evaluate((a) => localStorage.setItem(a, 'xiaochun_gone_outfit'), KEY_OUTFIT);
  await reMk(page, {});
  assert.equal(await page.evaluate(() => window.xc.outfit), 'xiaochun_dinner_dress', '已下线的服装 id => 默认');
  // 5) 内置按钮换装 / 换场景同样写回
  await reMk(page, { ui: ['outfit', 'scene'] });
  await clickIn(page, OUTFIT_BTN);
  await fr(page).waitForSelector('[role="menu"] [data-outfit-id]');
  await fr(page).click('[role="menu"] [data-outfit-id="xiaochun_swimsuit"]');
  await page.waitForFunction(() => window.xc.outfit === 'xiaochun_swimsuit', { timeout: 30000 });
  const cur = await page.evaluate(() => window.xc.scene);
  const pick = cur === 'dark' ? 'light' : 'dark'; // 选一个和当前不同的 (无头 Chrome 的系统亮暗不固定)
  await clickIn(page, SCENE_BTN);
  await fr(page).waitForSelector('[role="menu"] [data-scene-id]');
  await fr(page).click(`[role="menu"] [data-scene-id="${pick}"]`);
  await page.waitForFunction((x) => window.xc.scene === x, { timeout: 10000 }, pick);
  assert.equal(await lsGet(page, KEY_OUTFIT), 'xiaochun_swimsuit');
  assert.equal(await lsGet(page, KEY_SCENE), pick, '按钮换场景写回场景存储');
  await reMk(page, {});
  assert.equal(await page.evaluate(() => window.xc.outfit), 'xiaochun_swimsuit', '按钮换的装 reload 后恢复');
  assert.equal(await page.evaluate(() => window.xc.scene), pick, '按钮换的场景 reload 后恢复');
});

// ---- 滚轮缩放 (controls): 默认放开; controls:false 才锁 ----
// 用截图差异判断"画面有没有缩放"; 宿主页被撑高以便观察宿主 scrollY
const regionDiff = (A, B) => { // iframe 区域内 RGB 差异超阈值的像素数
  let n = 0;
  for (let y = TOP; y < TOP + H; y += 2) for (let x = LEFT; x < LEFT + W; x += 2) {
    const a = A.px(x, y), b = B.px(x, y);
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 60) n++;
  }
  return n;
};
const tall = (pg) => pg.evaluate(() => { document.documentElement.style.height = '4000px'; document.body.style.minHeight = '4000px'; window.scrollTo(0, 0); });
const watchWheel = (pg) => fr(pg).evaluate(() => { window.__wheel = []; document.addEventListener('wheel', (e) => window.__wheel.push(e.defaultPrevented), { passive: true }); });
const wheelLog = (pg) => fr(pg).evaluate(() => window.__wheel);
const scrollYOf = (pg) => pg.evaluate(() => Math.round(window.scrollY));

await check('滚轮 (默认 controls 放开): 透明场景 - 指针在角色上滚轮缩放且宿主不滚动; 在空白处滚轮穿透给宿主页滚动', async () => {
  await page.close(); page = await newPage();
  await mk(page, { scene: 'transparent' });
  await tall(page);
  await sleep(3000);
  // 角色上: 先把指针移上去 (触发命中 -> iframe 接收事件)
  await page.mouse.move(MODEL.x - 4, MODEL.y); await page.mouse.move(MODEL.x, MODEL.y); await sleep(700);
  assert.equal((await iframeState(page)).pe, 'auto', '指针在角色上, iframe 应接收事件');
  const A = await shot(page);
  await watchWheel(page);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel({ deltaY: -240 }); await sleep(60); }
  await sleep(1500);
  const B = await shot(page);
  { const w = await wheelLog(page); assert.ok(w.length >= 1 && w.every(Boolean), `角色上的滚轮应被缩放逻辑接管 (preventDefault) ${JSON.stringify(w)}`); }
  const d1 = regionDiff(A, B);
  assert.ok(d1 > 800, `滚轮向上应放大画面 (差异像素 ${d1})`);
  assert.equal(await scrollYOf(page), 0, '角色上滚轮不应同时滚动宿主页');
  for (let i = 0; i < 8; i++) { await page.mouse.wheel({ deltaY: 240 }); await sleep(60); }
  await sleep(1500);
  assert.equal(await scrollYOf(page), 0, '缩小时同样不滚动宿主页');
  const C = await shot(page);
  assert.ok(regionDiff(B, C) > 800, '反向滚轮应缩小画面');
  // 缩放范围有上下限: 再大量放大, 画面应已到位 (继续滚不再变化)
  for (let i = 0; i < 40; i++) { await page.mouse.wheel({ deltaY: -400 }); await sleep(20); }
  await sleep(1800);
  const D = await shot(page);
  for (let i = 0; i < 20; i++) { await page.mouse.wheel({ deltaY: -400 }); await sleep(20); }
  await sleep(1500);
  const E = await shot(page);
  const dLimit = regionDiff(D, E);
  console.log(`   滚轮缩放差异像素: 放大 ${d1}, 到极限后继续放大 ${dLimit}`);
  assert.ok(dLimit < d1 / 3, `到达 minDistance 后不再继续缩放 (差异 ${dLimit} vs 首次 ${d1})`);
  assert.equal(await scrollYOf(page), 0);
  // 空白处 (左上角): 穿透, 滚轮归宿主
  await page.mouse.move(CORNER.x - 4, CORNER.y); await page.mouse.move(CORNER.x, CORNER.y); await sleep(700);
  assert.equal((await iframeState(page)).pe, 'none');
  await page.mouse.wheel({ deltaY: 300 }); await sleep(800);
  const sy = await scrollYOf(page);
  assert.ok(sy > 100, `空白处滚轮应滚动宿主页 (scrollY=${sy})`);
});

await check('滚轮 (默认 controls 放开): 不透明场景 - iframe 区域内滚轮 = 缩放, 宿主不滚动', async () => {
  await page.close(); page = await newPage();
  await mk(page, { scene: 'dark' });
  await tall(page);
  await sleep(2500);
  await page.mouse.move(LEFT + 20, TOP + 20); await sleep(300);
  const A = await shot(page);
  await watchWheel(page);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel({ deltaY: -240 }); await sleep(60); }
  await sleep(1500);
  const B = await shot(page);
  { const w = await wheelLog(page); assert.ok(w.length >= 1 && w.every(Boolean), `不透明场景滚轮应被缩放逻辑接管 ${JSON.stringify(w)}`); }
  assert.ok(regionDiff(A, B) > 800, `不透明场景滚轮应缩放 (差异 ${regionDiff(A, B)})`);
  assert.equal(await scrollYOf(page), 0, 'iframe 区域内滚轮被吞, 宿主不滚动');
  // iframe 之外仍是宿主自己的滚动
  await page.mouse.move(LEFT + W + 150, TOP + 20); await page.mouse.wheel({ deltaY: 300 }); await sleep(600);
  assert.ok(await scrollYOf(page) > 100, 'iframe 外的区域滚动宿主页');
});

await check('滚轮 (controls:false): 锁定缩放 - 滚轮不被缩放接管, 落回宿主页滚动 (透明与不透明)', async () => {
  for (const scene of ['transparent', 'dark']) {
    await page.close(); page = await newPage();
    await mk(page, { scene, controls: false });
    const u = new URL((await page.evaluate(() => document.querySelector('iframe').src)));
    assert.equal(u.searchParams.get('controls'), '0');
    await tall(page);
    await sleep(2500);
    const x = scene === 'transparent' ? MODEL.x : LEFT + 20, y = scene === 'transparent' ? MODEL.y : TOP + 20;
    await page.mouse.move(x - 4, y); await page.mouse.move(x, y); await sleep(700);
    // 待机动画本身会造成大量像素变化, 所以不用画面对比; 改看滚轮事件是否被 OrbitControls 处理 (处理了就会 preventDefault)
    await watchWheel(page);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel({ deltaY: -240 }); await sleep(80); }
    await sleep(500);
    const w = await wheelLog(page);
    assert.ok(w.length >= 1, `${scene}: 滚轮事件应到达 iframe (有 ${w.length} 个)`);
    assert.ok(w.every((x) => x === false), `${scene}: 锁定时滚轮不应被缩放逻辑 preventDefault ${JSON.stringify(w)}`);
    assert.equal(await scrollYOf(page), 0);
    // 滚轮没被 iframe 吞: 宿主页滚动
    await page.mouse.wheel({ deltaY: 300 }); await sleep(800);
    assert.ok(await scrollYOf(page) > 100, `${scene}: 锁定时滚轮应落回宿主页 (scrollY=${await scrollYOf(page)})`);
  }
});

await check('控制台: 无未捕获异常 / alert', async () => {
  const bad = consoleErrors.filter((e) => /pageerror|DIALOG/.test(e));
  if (consoleErrors.length) console.log('   console.error 条数:', consoleErrors.length, '\n    ' + [...new Set(consoleErrors)].slice(0, 6).join('\n    '));
  assert.deepEqual(bad, []);
});

console.log('\n数据:', JSON.stringify(timings));
await browser.close(); hostServer.close();
console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
