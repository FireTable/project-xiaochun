// Shared helpers for the node-side verification / benchmark scripts (no dependencies except onnxruntime-web).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PACK = path.resolve(HERE, '..');
export const REPO = path.resolve(PACK, '..', '..');
export const WINDOW = 64, SEED_FRAMES = 4, MDIM = 337, CB = 256, SPF = 533, WINDOW_AUDIO = WINDOW * SPF;

export function parseArgs(argv, defaults) {
  const o = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      o[k] = v;
    }
  }
  return o;
}

/** Load onnxruntime-web (wasm-only bundle) from a package dir; default = this repo's node_modules. */
export async function loadOrt(ortWebDir, threads = 1) {
  const base = path.resolve(ortWebDir || path.join(REPO, 'node_modules', 'onnxruntime-web')) + '/';
  const ort = await import(base + 'dist/ort.wasm.min.mjs');
  ort.env.wasm.numThreads = Number(threads);
  ort.env.wasm.wasmPaths = base + 'dist/';
  const ver = JSON.parse(fs.readFileSync(base + 'package.json', 'utf8')).version;
  return { ort, version: ver };
}

export async function createSession(ort, file) {
  return ort.InferenceSession.create(new Uint8Array(fs.readFileSync(file)), { executionProviders: ['wasm'] });
}

/** Minimal RIFF/WAVE PCM16 mono reader -> Float32Array. */
export function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12, fmt = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), sz = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') {
      if (!fmt || fmt.bits !== 16 || fmt.ch !== 1 || fmt.sr !== 16000) throw new Error(`${file}: need 16k mono PCM16`);
      const n = Math.floor(Math.min(sz, b.length - p - 8) / 2), out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(p + 8 + i * 2) / 32768;
      return out;
    }
    p += 8 + sz + (sz & 1);
  }
  throw new Error('no data chunk: ' + file);
}

export function identityMotion() {
  const buf = new Float32Array(WINDOW * MDIM);
  for (let t = 0; t < WINDOW; t++) for (let j = 0; j < 55; j++) { buf[t * MDIM + j * 6] = 1; buf[t * MDIM + j * 6 + 4] = 1; }
  return buf;
}

/** Same feed construction as emageWorker.ts runStep. */
export function makeFeed(ort, audio, seed, ident) {
  const mm = new Float32Array(WINDOW * MDIM), mask = new Float32Array(WINDOW * MDIM).fill(1);
  mm.set(ident);
  if (seed) { mm.set(seed); mask.fill(0, 0, SEED_FRAMES * MDIM); }
  return {
    audio: new ort.Tensor('float32', audio, [1, WINDOW_AUDIO]),
    speaker_id: new ort.Tensor('int64', BigInt64Array.from([0n]), [1, 1]),
    masked_motion: new ort.Tensor('float32', mm, [1, WINDOW, MDIM]),
    mask: new ort.Tensor('float32', mask, [1, WINDOW, MDIM]),
  };
}

export function argmax2d(data, T, C) {
  const out = new BigInt64Array(T);
  for (let t = 0; t < T; t++) {
    let best = -Infinity, idx = 0;
    for (let c = 0; c < C; c++) { const v = data[t * C + c]; if (v > best) { best = v; idx = c; } }
    out[t] = BigInt(idx);
  }
  return out;
}

export function makeSeedDeps(ort, vq, pp) {
  return {
    argmax2d,
    async runVq(part, indices, T) {
      const o = await vq[part].run({ indices: new ort.Tensor('int64', indices, [1, T]) });
      return new Float32Array(o.decoded.data);
    },
    async runPostprocess(f, u, h, l, T) {
      const o = await pp.run({
        face_dec: new ort.Tensor('float32', f, [1, T, 106]), upper_dec: new ort.Tensor('float32', u, [1, T, 78]),
        hands_dec: new ort.Tensor('float32', h, [1, T, 180]), lower_dec: new ort.Tensor('float32', l, [1, T, 61]),
      });
      return new Float32Array(o.motion_inference.data);
    },
  };
}

export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
export function maxAbsDiff(a, b) { let m = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; } return m; }
