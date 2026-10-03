#!/usr/bin/env node
// Per-window latency + session-create time: baseline emage_step_int8 vs slim INT8 vs slim INT8 + conv int8.
// usage: node bench_latency.mjs [--ort-web-dir DIR] [--threads 1] [--windows 10] [--clip out/clips/demo.wav]
import path from 'node:path';
import { PACK, WINDOW_AUDIO, parseArgs, loadOrt, createSession, readWav, identityMotion, makeFeed, mean, median } from './common.mjs';
const a = parseArgs(process.argv.slice(2), {
  exportDir: process.env.EMAGE_EXPORT_DIR || path.resolve(PACK, '../../../emage-onnx-export'),
  outDir: path.join(PACK, 'out'), ortWebDir: process.env.ORT_WEB_DIR || '', threads: '1', windows: '10',
  clip: path.join(PACK, 'out/clips/say_zh.wav'),
});
const { ort, version } = await loadOrt(a.ortWebDir, a.threads);
console.log(`onnxruntime-web ${version}, threads=${a.threads}, windows=${a.windows}`);
const pcm = readWav(a.clip), ident = identityMotion();
const models = {
  'baseline emage_step_int8 (full)': path.join(a.exportDir, 'onnx/emage_step_int8.onnx'),
  'step1 slim int8': path.join(a.outDir, 'emage_step_slim_int8.onnx'),
  'step1+2 slim int8 + conv int8': path.join(a.outDir, 'emage_step_slim_int8_convq.onnx'),
};
const res = {};
for (const [name, file] of Object.entries(models)) {
  const t0 = performance.now(); const s = await createSession(ort, file); const create = performance.now() - t0;
  await s.run(makeFeed(ort, pcm.subarray(0, WINDOW_AUDIO), null, ident)); // warm-up
  const ts = [];
  for (let w = 0; w < Number(a.windows); w++) {
    const seg = pcm.subarray(w * WINDOW_AUDIO, (w + 1) * WINDOW_AUDIO);
    const t = performance.now(); await s.run(makeFeed(ort, seg, null, ident)); ts.push(performance.now() - t);
  }
  res[name] = { createMs: Math.round(create), runMedianMs: Math.round(median(ts)), runMeanMs: Math.round(mean(ts)), runMinMs: Math.round(Math.min(...ts)), runMaxMs: Math.round(Math.max(...ts)) };
  console.log(name.padEnd(36), JSON.stringify(res[name]));
  await s.release?.();
}
