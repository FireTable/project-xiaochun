#!/usr/bin/env node
/**
 * 纯函数自测: node scripts/test-host-audio.mjs  (需要 Node >= 22.6 直接跑 .ts)
 * 覆盖 hostAudio.ts 的 降采样 / 切片 / 下混 / PCM16 / 异步队列。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  StreamResampler16k, PcmSlicer, downmixToMono, pcm16ToFloat32, AsyncChunkQueue, HOST_AUDIO,
} from '../src/director/hostAudio.ts';

const sine = (n, sr, f) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * f * i) / sr));

test('resampler: 48k → 16k 长度 = 1/3, 分块与整段一致', () => {
  const x = sine(48000, 48000, 440);
  const whole = new StreamResampler16k(48000).push(x);
  assert.equal(whole.length, 16000);
  const r = new StreamResampler16k(48000);
  const parts = [];
  for (let i = 0; i < x.length; i += 997) parts.push(r.push(x.subarray(i, Math.min(x.length, i + 997))));
  const cat = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { cat.set(p, o); o += p.length; }
  assert.ok(Math.abs(cat.length - whole.length) <= 1);
  for (let i = 0; i < cat.length - 1; i++) assert.ok(Math.abs(cat[i] - whole[i]) < 1e-5, `i=${i}`);
});

test('resampler: 16k 直通 (且返回新数组可 transfer)', () => {
  const x = sine(160, 16000, 100);
  const y = new StreamResampler16k(16000).push(x);
  assert.deepEqual(Array.from(y), Array.from(x));
  assert.notEqual(y.buffer, x.buffer);
});

test('resampler: 24k 非整数比也保持能量', () => {
  const x = sine(24000, 24000, 300);
  const y = new StreamResampler16k(24000).push(x);
  assert.ok(Math.abs(y.length - 16000) <= 1);
  const rms = Math.sqrt(y.reduce((a, v) => a + v * v, 0) / y.length);
  assert.ok(rms > 0.65 && rms < 0.75, `rms=${rms}`);
});

test('slicer: 首片 2s 其后 4s, 尾巴 flush', () => {
  const sr = 16000;
  const s = new PcmSlicer(sr, 2, 4);
  const out = [];
  for (let i = 0; i < 10; i++) out.push(...s.push(new Float32Array(sr))); // 10 s 分 1 s 块
  const tail = s.flush();
  assert.deepEqual(out.map((a) => a.length / sr), [2, 4, 4]);
  assert.equal(tail, null);
  const s2 = new PcmSlicer(sr, 2, 4);
  const o2 = s2.push(new Float32Array(sr * 7)); // 一次性 7 s
  assert.deepEqual(o2.map((a) => a.length / sr), [2, 4]);
  assert.equal(s2.flush().length / sr, 1);
});

test('downmix / pcm16', () => {
  assert.deepEqual(Array.from(downmixToMono(Float32Array.of(1, -1, 0.5, 0.5), 2)), [0, 0.5]);
  const f = pcm16ToFloat32(Int16Array.of(0, 16384, -32768));
  assert.deepEqual(Array.from(f), [0, 0.5, -1]);
});

test('queue: push/close/abort', async () => {
  const q = new AsyncChunkQueue();
  q.push(Float32Array.of(1));
  setTimeout(() => { q.push(Float32Array.of(2)); q.close(); }, 5);
  const got = [];
  for await (const c of q) got.push(c[0]);
  assert.deepEqual(got, [1, 2]);
  const q2 = new AsyncChunkQueue();
  const p = (async () => { let n = 0; for await (const _ of q2) n++; return n; })();
  q2.abort();
  assert.equal(await p, 0);
});

test('constants sane', () => {
  assert.equal(HOST_AUDIO.emageSampleRate, 16000);
  assert.ok(HOST_AUDIO.firstSliceSec <= HOST_AUDIO.sliceSec);
});
