// 宿主音频起步延迟 / hostClock 端到端测量 (可选; 需要 puppeteer-core + 本机 Chrome + 正在服务 /embed 的站点, 见 embed-e2e.mjs 的前置步骤):
//   EMBED_URL=https://localhost:5291/embed node test/browser/hostclock-latency.mjs
// 测: speakAudio 调用 → xc.utterance start (= 宿主可以开始出声 / 小蠢开口) 的耗时, 旧路径 vs hostClock:true;
//     以及 hostClock 下 syncClock seek 不会重开这一句 (没有新的 utterance start, 没有 error)。
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../dist');
let puppeteer;
try { puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_MODULE || 'puppeteer-core'); }
catch { console.log('[skip] puppeteer-core 不可用'); process.exit(0); }
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(executablePath)) { console.log('[skip] 找不到 Chrome'); process.exit(0); }
const EMBED_URL = process.env.EMBED_URL || 'https://localhost:5291/embed';
const HOST_ORIGIN = 'http://127.0.0.1:5298';
const RUNS = Number(process.env.RUNS || 3);

const hostHtml = `<!doctype html><body><div id="a"></div>
<script type="module">import * as XC from '/dist/index.js'; window.XC = XC; window.__ready = true;</script></body>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, HOST_ORIGIN);
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); return res.end(hostHtml); }
  const f = path.join(dist, u.pathname.replace(/^\/dist\//, ''));
  if (u.pathname.startsWith('/dist/') && existsSync(f)) { res.setHeader('content-type', 'text/javascript'); return res.end(readFileSync(f)); }
  res.statusCode = 404; res.end();
});
await new Promise((r) => server.listen(5298, '127.0.0.1', r));
const browser = await puppeteer.launch({
  executablePath, headless: process.env.HEADED ? false : 'new', protocolTimeout: 600000,
  args: ['--no-sandbox', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 160)); });
  await page.goto(HOST_ORIGIN + '/');
  await page.waitForFunction(() => window.__ready);
  const out = await page.evaluate(async (EMBED_URL, RUNS) => {
    const ev = window.__ev = [];
    const xc = window.XC.createXiaochun({ container: '#a', src: EMBED_URL, lazy: false, width: 360, height: 480, handshakeTimeout: 60000 });
    for (const n of ['utterance', 'error']) xc.on(n, (p) => ev.push({ n, p, t: performance.now() }));
    await Promise.race([xc.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('ready timeout')), 180000))]);
    // 类语音的测试信号: 4 Hz 起伏的 180 Hz 谐波 + 噪声, 16 kHz
    const mkPcm = (sec) => {
      const sr = 16000, n = sec * sr, a = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr, env = Math.max(0, Math.sin(2 * Math.PI * 4 * t)) ** 2;
        const v = env * (0.5 * Math.sin(2 * Math.PI * 180 * t) + 0.25 * Math.sin(2 * Math.PI * 360 * t) + 0.1 * (Math.random() * 2 - 1));
        a[i] = Math.max(-1, Math.min(1, v)) * 32767;
      }
      return a;
    };
    const startOnce = async (opts) => {
      const ac = new AbortController();
      const before = ev.length;
      const t0 = performance.now();
      const done = xc.speakAudio(mkPcm(12), { format: 'pcm16', sampleRate: 16000, audible: false, signal: ac.signal, ...opts }).catch((e) => String(e.message));
      while (!ev.slice(before).some((e) => e.n === 'utterance' && e.p.phase === 'start') && performance.now() - t0 < 120000) {
        if (ev.slice(before).some((e) => e.n === 'error')) break;
        await new Promise((r) => setTimeout(r, 5));
      }
      const st = ev.slice(before).find((e) => e.n === 'utterance' && e.p.phase === 'start');
      return { ms: st ? Math.round(st.t - t0) : null, ac, done, before };
    };
    const res = { hostClockCap: xc.supportsHostClock?.() ?? 'n/a', warm: null, old: [], host: [], seek: null };
    // 预热: 第一次会下载 + 初始化 EMAGE
    const w = await startOnce({});
    res.warm = w.ms; w.ac.abort(); await w.done;
    for (let i = 0; i < RUNS; i++) {
      const o = await startOnce({}); res.old.push(o.ms); o.ac.abort(); await o.done;
      await new Promise((r) => setTimeout(r, 300));
      const h = await startOnce({ hostClock: true }); res.host.push(h.ms);
      if (i === RUNS - 1) {
        // 段内 seek / 暂停 / 继续: 只发时钟, 不应重开这一句
        const mark = ev.length;
        const t1 = performance.now();
        const sent = [
          xc.syncClock?.({ time: 6, playing: true, seek: true }),
          xc.syncClock?.({ time: 6.5, playing: false }),
          xc.syncClock?.({ time: 6.5, playing: true }),
          xc.syncClock?.({ time: 2, playing: true, seek: true }),
        ];
        await new Promise((r) => setTimeout(r, 1500));
        const after = ev.slice(mark).map((e) => `${e.n}:${e.p.phase ?? e.p.code}`);
        res.seek = { sent, callMs: Math.round((performance.now() - t1 - 1500) * 10) / 10, eventsAfter: after };
      }
      h.ac.abort(); await h.done;
      await new Promise((r) => setTimeout(r, 300));
    }
    return res;
  }, EMBED_URL, RUNS);
  const avg = (a) => Math.round(a.filter((x) => x != null).reduce((s, x) => s + x, 0) / Math.max(1, a.filter((x) => x != null).length));
  console.log(JSON.stringify(out));
  console.log(`warm-up (EMAGE load) start: ${out.warm} ms`);
  console.log(`old path  speakAudio → utterance start: ${out.old.join(', ')} ms (avg ${avg(out.old)})`);
  console.log(`hostClock speakAudio → utterance start: ${out.host.join(', ')} ms (avg ${avg(out.host)})`);
  console.log('hostClock seek/pause/resume within segment →', JSON.stringify(out.seek));
} finally {
  await browser.close();
  server.close();
}
