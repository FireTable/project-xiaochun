#!/usr/bin/env node
// STEP 1 verification (onnxruntime-web, wasm EP, node):
//   A) teacher forced: baseline emage_step_int8 vs slim emage_step_slim_int8 on identical inputs -> cls_* must match
//      and the host-side seed (src/motion/sources/emageSeed.ts) is compared with the in-graph seed.
//   B) free running: baseline loop (in-graph seed) vs slim loop (host seed, jaw identity) over several clips ->
//      argmax agreement per head.
// usage: node verify_slim.mjs [--export-dir DIR] [--slim-dir DIR] [--clips DIR] [--ort-web-dir DIR]
//          [--base-step emage_step_int8.onnx] [--slim-step emage_step_slim_int8.onnx] [--vq-suffix _int8]
//          [--max-windows 14] [--json out/verify_slim.json]
//          [--fp32-step emage_step.onnx]   optional noise floor: baseline FP32 free-running vs baseline INT8 free-running
import fs from 'node:fs';
import path from 'node:path';
import { PACK, WINDOW, SEED_FRAMES, MDIM, CB, WINDOW_AUDIO, parseArgs, loadOrt, createSession, readWav, identityMotion, makeFeed, makeSeedDeps, loadSeedModule, mean, maxAbsDiff } from './common.mjs';
const { computeSeedFromLogits } = await loadSeedModule();

const a = parseArgs(process.argv.slice(2), {
  exportDir: process.env.EMAGE_EXPORT_DIR || path.resolve(PACK, '../../../emage-onnx-export'),
  slimDir: path.join(PACK, 'out'), clips: path.join(PACK, 'out/clips'), ortWebDir: process.env.ORT_WEB_DIR || '',
  baseStep: 'emage_step_int8.onnx', slimStep: 'emage_step_slim_int8.onnx', vqSuffix: '_int8', maxWindows: '14',
  json: path.join(PACK, 'out/verify_slim.json'), threads: '1', fp32Step: '',
});
const { ort, version } = await loadOrt(a.ortWebDir, a.threads);
console.log(`onnxruntime-web ${version}, threads=${a.threads}`);
const bdir = path.join(a.exportDir, 'onnx');
const base = await createSession(ort, path.join(bdir, a.baseStep));
const slim = await createSession(ort, path.join(a.slimDir, a.slimStep));
const fp32 = a.fp32Step ? await createSession(ort, path.join(bdir, a.fp32Step)) : null;
const vq = {
  upper: await createSession(ort, path.join(bdir, `vq_upper_idx${a.vqSuffix}.onnx`)),
  hands: await createSession(ort, path.join(bdir, `vq_hands_idx${a.vqSuffix}.onnx`)),
  lower: await createSession(ort, path.join(bdir, `vq_lower_idx${a.vqSuffix}.onnx`)),
};
const pp = await createSession(ort, path.join(bdir, `postprocess${a.vqSuffix}.onnx`));
const deps = makeSeedDeps(ort, vq, pp);
const ident = identityMotion();
const rd = (o, k) => new Float32Array(o[k].data);
const heads = ['cls_upper', 'cls_hands', 'cls_lower'];
const agree = (x, y) => { let n = 0; const T = x.length / CB; const ax = deps.argmax2d(x, T, CB), ay = deps.argmax2d(y, T, CB); for (let t = 0; t < T; t++) if (ax[t] === ay[t]) n++; return n / T; };
const hasSlimSeed = slim.outputNames.includes('seed');
console.log('slim outputs:', slim.outputNames.join(','), '| baseline outputs:', base.outputNames.join(','));

const clips = fs.readdirSync(a.clips).filter((f) => f.endsWith('.wav')).sort();
const R = { ort: version, clips: {}, totals: {} };
let maxClsDiff = 0, maxSeedNonJaw = 0, maxSeedJaw = 0, nWin = 0;
const agrTf = { cls_upper: [], cls_hands: [], cls_lower: [] }, agrFree = { cls_upper: [], cls_hands: [], cls_lower: [] };
const winAgr = [];
const agrFloor = { cls_upper: [], cls_hands: [], cls_lower: [] };
for (const clip of clips) {
  const pcm = readWav(path.join(a.clips, clip));
  const nW = Math.min(Number(a.maxWindows), Math.floor(pcm.length / WINDOW_AUDIO));
  if (nW < 2) { console.log('skip (too short)', clip); continue; }
  let seedBase = null, seedSlim = null, seed32 = null;
  const per = { windows: nW, clsMaxDiffTF: 0, seedNonJaw: 0, seedJaw: 0, agreeFree: [], };
  for (let w = 0; w < nW; w++) {
    const seg = pcm.subarray(w * WINDOW_AUDIO, (w + 1) * WINDOW_AUDIO);
    const ob = await base.run(makeFeed(ort, seg, seedBase, ident));
    // A) slim, same inputs as baseline (same in-graph seed)
    const os = await slim.run(makeFeed(ort, seg, seedBase, ident));
    for (const h of heads) {
      per.clsMaxDiffTF = Math.max(per.clsMaxDiffTF, maxAbsDiff(rd(ob, h), rd(os, h)));
      agrTf[h].push(agree(rd(ob, h), rd(os, h)));
    }
    // host seed from the BASELINE logits vs baseline in-graph seed
    const js = await computeSeedFromLogits(deps, rd(ob, 'cls_upper'), rd(ob, 'cls_hands'), rd(ob, 'cls_lower'), WINDOW, CB, MDIM, SEED_FRAMES);
    const ref = rd(ob, 'seed');
    for (let f = 0; f < SEED_FRAMES; f++) for (let d = 0; d < MDIM; d++) {
      const diff = Math.abs(js[f * MDIM + d] - ref[f * MDIM + d]);
      if (d >= 132 && d < 138) per.seedJaw = Math.max(per.seedJaw, diff); else per.seedNonJaw = Math.max(per.seedNonJaw, diff);
    }
    // B) slim free running with host seed
    const of = await slim.run(makeFeed(ort, seg, seedSlim, ident));
    const ag = heads.map((h) => { const v = agree(rd(ob, h), rd(of, h)); agrFree[h].push(v); return v; });
    per.agreeFree.push(mean(ag));
    winAgr.push({ w, v: mean(ag) });
    if (fp32) { // noise floor: FP32 baseline free-running with its own in-graph seed
      const o32 = await fp32.run(makeFeed(ort, seg, seed32, ident));
      for (const h of heads) agrFloor[h].push(agree(rd(ob, h), rd(o32, h)));
      seed32 = rd(o32, 'seed');
    }
    seedBase = rd(ob, 'seed');
    seedSlim = hasSlimSeed ? rd(of, 'seed') : await computeSeedFromLogits(deps, rd(of, 'cls_upper'), rd(of, 'cls_hands'), rd(of, 'cls_lower'), WINDOW, CB, MDIM, SEED_FRAMES);
    nWin++;
  }
  maxClsDiff = Math.max(maxClsDiff, per.clsMaxDiffTF); maxSeedNonJaw = Math.max(maxSeedNonJaw, per.seedNonJaw); maxSeedJaw = Math.max(maxSeedJaw, per.seedJaw);
  per.meanAgreeFree = mean(per.agreeFree); per.minAgreeFree = Math.min(...per.agreeFree); delete per.agreeFree;
  R.clips[clip] = per;
  console.log(`${clip.padEnd(30)} windows=${nW} clsMaxDiff(teacher)=${per.clsMaxDiffTF.toExponential(2)} seed|d| nonJaw=${per.seedNonJaw.toExponential(2)} jaw=${per.seedJaw.toFixed(4)} free-running argmax agree mean=${per.meanAgreeFree.toFixed(3)} min=${per.minAgreeFree.toFixed(3)}`);
}
R.totals = {
  windows: nWin, clips: Object.keys(R.clips).length, clsMaxAbsDiffTeacherForced: maxClsDiff,
  teacherForcedArgmaxAgree: Object.fromEntries(heads.map((h) => [h, mean(agrTf[h])])),
  seedMaxAbsDiffNonJaw: maxSeedNonJaw, seedMaxAbsDiffJaw: maxSeedJaw,
  freeRunningArgmaxAgree: Object.fromEntries(heads.map((h) => [h, mean(agrFree[h])])),
  noiseFloorFp32FreeRunningVsInt8FreeRunning: fp32 ? Object.fromEntries(heads.map((h) => [h, mean(agrFloor[h])])) : null,
  freeRunningAgreeFirst4Windows: mean(winAgr.filter((x) => x.w < 4).map((x) => x.v)),
  freeRunningAgreeWindows8plus: mean(winAgr.filter((x) => x.w >= 8).map((x) => x.v)),
};
console.log('\nTOTALS', JSON.stringify(R.totals, null, 2));
fs.mkdirSync(path.dirname(a.json), { recursive: true });
fs.writeFileSync(a.json, JSON.stringify(R, null, 2));
console.log('wrote', a.json);
