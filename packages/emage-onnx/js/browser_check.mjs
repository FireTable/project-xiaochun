#!/usr/bin/env node
// Real-browser check of the STEP 3 files (headless Chrome, onnxruntime-web wasm EP, cross-origin isolated => threads).
// For every ort-web build (installed one and, if present, the one pinned by emageWorker.ts) and every format
// (optimized .onnx in out/final, ORT format in out/final_ort) it
//   * creates the step / vq_* / postprocess sessions from an ArrayBuffer (like emageWorker.ts) and times session creation,
//   * runs the step on N windows of a clip and compares cls_* with the NOT optimized step (emage_step_drop0123_int8_convq.onnx)
//     loaded by the same ort build (max|diff|, relL2, argmax agreement), reports median run latency,
//   * runs vq_* and postprocess on deterministic inputs and compares with the not optimized files.
// usage: node js/browser_check.mjs [--ort-web-dir DIR] [--pinned-dir DIR] [--threads 4] [--windows 6]
//          [--formats onnx,ort] [--chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"] [--json out/reports/browser_check.json]
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PACK, REPO, parseArgs } from './common.mjs';

const a = parseArgs(process.argv.slice(2), {
  ortWebDir: '', pinnedDir: path.join(PACK, 'out/ort-pinned/node_modules/onnxruntime-web'), threads: '4', windows: '6', formats: 'onnx,ort',
  exportDir: process.env.EMAGE_EXPORT_DIR || path.resolve(PACK, '../../../emage-onnx-export'),
  chrome: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  clip: path.join(PACK, 'out/clips/say_zh.wav'), json: path.join(PACK, 'out/reports/browser_check.json'),
});
const own = path.join(PACK, 'node_modules/onnxruntime-web');
const builds = [];
const inst = path.resolve(a.ortWebDir || (fs.existsSync(own) ? own : path.join(REPO, 'node_modules/onnxruntime-web')));
builds.push({ label: 'installed', dir: inst });
if (fs.existsSync(a.pinnedDir)) builds.push({ label: 'pinned', dir: path.resolve(a.pinnedDir) });
for (const b of builds) b.version = JSON.parse(fs.readFileSync(path.join(b.dir, 'package.json'), 'utf8')).version;

const roots = {
  '/m/final/': path.join(PACK, 'out/final'), '/m/ort/': path.join(PACK, 'out/final_ort'), '/m/out/': path.join(PACK, 'out'),
  '/m/exp/': path.join(a.exportDir, 'onnx'), '/m/clip.wav': a.clip,
};
const PAGE = `<!doctype html><meta charset=utf-8><body>check<script type=module>
const q = new URLSearchParams(location.search); const ob = q.get('ob'), fmt = q.get('fmt'), threads = Number(q.get('threads')), nWin = Number(q.get('n'));
const post = (o) => fetch('/result', { method: 'POST', body: JSON.stringify(o) });
const buf = async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer());
try {
  const ort = await import(ob + 'ort.wasm.min.mjs');
  ort.env.wasm.wasmPaths = ob; ort.env.wasm.numThreads = threads; ort.env.wasm.simd = true;
  const mk = async (b) => { const t = performance.now(); const s = await ort.InferenceSession.create(b, { executionProviders: ['wasm'] }); return [s, performance.now() - t]; };
  const dir = fmt === 'ort' ? '/m/ort/' : '/m/final/', ext = fmt === 'ort' ? '.ort' : '.onnx';
  const wav = new DataView((await buf('/m/clip.wav')).buffer); let p = 12, pcm;
  while (p + 8 <= wav.byteLength) { const id = String.fromCharCode(wav.getUint8(p), wav.getUint8(p + 1), wav.getUint8(p + 2), wav.getUint8(p + 3)), sz = wav.getUint32(p + 4, true);
    if (id === 'data') { const n = Math.floor(Math.min(sz, wav.byteLength - p - 8) / 2); pcm = new Float32Array(n); for (let i = 0; i < n; i++) pcm[i] = wav.getInt16(p + 8 + 2 * i, true) / 32768; break; } p += 8 + sz + (sz & 1); }
  const A = 64 * 533, nw = Math.min(nWin, Math.floor(pcm.length / A));
  const mm = new Float32Array(64 * 337); for (let t = 0; t < 64; t++) for (let j = 0; j < 55; j++) { mm[t * 337 + j * 6] = 1; mm[t * 337 + j * 6 + 4] = 1; }
  const feed = (w) => ({ audio: new ort.Tensor('float32', pcm.slice(w * A, (w + 1) * A), [1, A]), speaker_id: new ort.Tensor('int64', BigInt64Array.from([0n]), [1, 1]),
    masked_motion: new ort.Tensor('float32', mm, [1, 64, 337]), mask: new ort.Tensor('float32', new Float32Array(64 * 337).fill(1), [1, 64, 337]) });
  const cmp = (x, r) => { let m = 0, d = 0, n = 0; for (let i = 0; i < x.length; i++) { const e = Math.abs(x[i] - r[i]); if (e > m) m = e; d += e * e; n += r[i] * r[i]; } return [m, Math.sqrt(d / (n || 1))]; };
  const argm = (x, off) => { let bi = 0, bv = -1e30; for (let c = 0; c < 256; c++) if (x[off + c] > bv) { bv = x[off + c]; bi = c; } return bi; };
  const R = { ort: ort.env.versions?.common, fmt, threads, isolated: self.crossOriginIsolated };
  const [, warm] = await mk(await buf('/m/exp/vq_upper_idx_int8.onnx')); R.warmupCreateMs = Math.round(warm);
  const [ref, refCreate] = await mk(await buf('/m/out/emage_step_drop0123_int8_convq.onnx'));
  const [cand, createMs] = await mk(await buf(dir + 'emage_step_int8' + ext));
  const heads = ['cls_upper', 'cls_hands', 'cls_lower']; let mx = 0, rel = 0, agree = 0, cnt = 0; const ts = [];
  await cand.run(feed(0));
  for (let w = 0; w < nw; w++) {
    const o0 = await ref.run(feed(w)); const t = performance.now(); const o1 = await cand.run(feed(w)); ts.push(performance.now() - t);
    for (const h of heads) { const x = o1[h].data, r = o0[h].data; const [m, rl] = cmp(x, r); mx = Math.max(mx, m); rel += rl; let ag = 0; for (let f = 0; f < 64; f++) if (argm(x, f * 256) === argm(r, f * 256)) ag++; agree += ag / 64; cnt++; }
  }
  ts.sort((x, y) => x - y);
  R.step = { createMs: Math.round(createMs), refCreateMs_notOptimized: Math.round(refCreate), windows: nw, medianRunMs: Math.round(ts[Math.floor(ts.length / 2)]), clsMaxAbsDiff: mx, clsRelL2Mean: rel / cnt, argmaxAgree: agree / cnt };
  // vq + postprocess
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  R.vq = {}; 
  for (const part of ['upper', 'hands', 'lower']) {
    const n = 'vq_' + part + '_idx_int8';
    const [r0, rc] = await mk(await buf('/m/out/' + n + '_convq.onnx')); const [c1, cm] = await mk(await buf(dir + n + ext));
    const idx = BigInt64Array.from({ length: 64 }, () => BigInt(Math.floor(rnd() * 256)));
    const o0 = await r0.run({ indices: new ort.Tensor('int64', idx, [1, 64]) }), o1 = await c1.run({ indices: new ort.Tensor('int64', idx, [1, 64]) });
    R.vq[part] = { createMs: Math.round(cm), refCreateMs_notOptimized: Math.round(rc), maxAbsDiff: cmp(o1.decoded.data, o0.decoded.data)[0] };
  }
  const [p0, pc] = await mk(await buf('/m/exp/postprocess_int8.onnx')); const [p1, pm] = await mk(await buf(dir + 'postprocess_int8' + ext));
  const f = (n, k) => new ort.Tensor('float32', Float32Array.from({ length: 64 * n }, () => (rnd() - 0.5) * k), [1, 64, n]);
  const pin = { face_dec: f(106, 0.5), upper_dec: f(78, 2), hands_dec: f(180, 2), lower_dec: f(61, 2) };
  const q0 = await p0.run(pin), q1 = await p1.run(pin);
  R.postprocess = { createMs: Math.round(pm), refCreateMs_notOptimized: Math.round(pc), maxAbsDiff: cmp(q1.motion_inference.data, q0.motion_inference.data)[0] };
  await post(R);
} catch (e) { await post({ error: String((e && e.stack) || e), fmt, ob }); }
</script>`;

let resolveResult;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const h = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' };
  if (req.method === 'POST' && u.pathname === '/result') { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { res.writeHead(200, h); res.end('ok'); resolveResult(JSON.parse(b)); }); return; }
  if (u.pathname === '/') { res.writeHead(200, { ...h, 'Content-Type': 'text/html' }); res.end(PAGE); return; }
  let f = null;
  const ob = builds.find((b) => u.pathname.startsWith(`/ort-${b.label}/`));
  if (ob) f = path.join(ob.dir, 'dist', u.pathname.slice(`/ort-${ob.label}/`.length));
  for (const [pre, dir] of Object.entries(roots)) if (!f && u.pathname.startsWith(pre)) f = pre.endsWith('/') ? path.join(dir, u.pathname.slice(pre.length)) : dir;
  if (!f || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, h); res.end('nf'); return; }
  const type = f.endsWith('.mjs') || f.endsWith('.js') ? 'text/javascript' : f.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
  res.writeHead(200, { ...h, 'Content-Type': type, 'Content-Length': fs.statSync(f).size });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const results = [];
for (const b of builds) for (const fmt of a.formats.split(',')) {
  if (!fs.existsSync(roots[fmt === 'ort' ? '/m/ort/' : '/m/final/'])) { console.log(`skip ${fmt}: directory missing`); continue; }
  const result = new Promise((r) => (resolveResult = r));
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'emage-chrome-'));
  const chrome = spawn(a.chrome, ['--headless=new', `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', `http://localhost:${port}/?ob=/ort-${b.label}/&fmt=${fmt}&threads=${a.threads}&n=${a.windows}`], { stdio: 'ignore' });
  const to = setTimeout(() => resolveResult({ error: 'timeout 300 s' }), 300000);
  const r = await result; clearTimeout(to); chrome.kill('SIGKILL'); fs.rmSync(prof, { recursive: true, force: true });
  r.ortWeb = `${b.label} ${b.version}`; results.push(r);
  console.log(JSON.stringify(r));
}
server.close();
fs.mkdirSync(path.dirname(a.json), { recursive: true });
fs.writeFileSync(a.json, JSON.stringify(results, null, 2));
console.log('wrote', a.json);
process.exit(results.some((r) => r.error) ? 1 : 0);
