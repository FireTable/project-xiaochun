#!/usr/bin/env node
// STEP 2 verification + latency (onnxruntime-web, wasm EP, node):
//   arm REF  = slim INT8 step + vq_*_idx_int8 + postprocess_int8            (STEP 1 result)
//   arm CONV = slim INT8 step with INT8 Conv weights + vq_*_idx_int8_convq + postprocess_int8
// For every clip window: REF/CONV step on identical inputs (teacher forced) -> cls max|diff| and argmax agreement;
// free-running loops (each arm with its own host-computed seed) -> argmax agreement; decode the SAME REF argmax indices
// through both vq stacks -> motion_inference (6D) max/mean |diff|; per-window latency of step and of vq x3 + postprocess.
// variants: --step-conv FILE (any step file), --cv-vq-dir DIR --cv-vq-suffix none|_convq (which vq stack the CONV arm uses)
// usage: node verify_convq.mjs [--ort-web-dir DIR] [--threads 1] [--max-windows 14] [--json out/verify_convq_<ver>.json]
import fs from 'node:fs';
import path from 'node:path';
import { PACK, WINDOW, SEED_FRAMES, MDIM, CB, WINDOW_AUDIO, parseArgs, loadOrt, createSession, readWav, identityMotion, makeFeed, makeSeedDeps, loadSeedModule, mean, median, maxAbsDiff } from './common.mjs';
const { computeSeedFromLogits } = await loadSeedModule();

const a = parseArgs(process.argv.slice(2), {
  exportDir: process.env.EMAGE_EXPORT_DIR || path.resolve(PACK, '../../../emage-onnx-export'),
  outDir: path.join(PACK, 'out'), clips: path.join(PACK, 'out/clips'), ortWebDir: process.env.ORT_WEB_DIR || '',
  maxWindows: '14', threads: '1', suffix: '_convq', stepConv: '', json: '', cvVqDir: '', cvVqSuffix: '__default__',
});
const { ort, version } = await loadOrt(a.ortWebDir, a.threads);
const jsonPath = a.json || path.join(a.outDir, `verify_convq_${version.replace(/[^0-9a-z.-]/gi, '')}_t${a.threads}.json`);
console.log(`onnxruntime-web ${version}, threads=${a.threads}`);
const bdir = path.join(a.exportDir, 'onnx');
const mkArm = async (stepFile, vqDir, vqSuffix) => ({
  step: await createSession(ort, stepFile),
  vq: {
    upper: await createSession(ort, path.join(vqDir, `vq_upper_idx_int8${vqSuffix}.onnx`)),
    hands: await createSession(ort, path.join(vqDir, `vq_hands_idx_int8${vqSuffix}.onnx`)),
    lower: await createSession(ort, path.join(vqDir, `vq_lower_idx_int8${vqSuffix}.onnx`)),
  },
  pp: await createSession(ort, path.join(bdir, 'postprocess_int8.onnx')),
});
const ref = await mkArm(path.join(a.outDir, 'emage_step_slim_int8.onnx'), bdir, '');
const cv = await mkArm(a.stepConv || path.join(a.outDir, `emage_step_slim_int8${a.suffix}.onnx`), a.cvVqDir || a.outDir, a.cvVqSuffix === '__default__' ? a.suffix : (a.cvVqSuffix === 'none' ? '' : a.cvVqSuffix));
ref.deps = makeSeedDeps(ort, ref.vq, ref.pp); cv.deps = makeSeedDeps(ort, cv.vq, cv.pp);
const ident = identityMotion();
const rd = (o, k) => new Float32Array(o[k].data);
const heads = ['cls_upper', 'cls_hands', 'cls_lower'];
const agree = (x, y) => { let n = 0; const T = x.length / CB; const ax = ref.deps.argmax2d(x, T, CB), ay = ref.deps.argmax2d(y, T, CB); for (let t = 0; t < T; t++) if (ax[t] === ay[t]) n++; return n / T; };
// logit-level metrics (argmax agreement alone is very noisy here: many frames have near-tied logits)
function logitMetrics(x, y) { // x = REF, y = CONV, both [T*CB]
  const T = x.length / CB; let num = 0, den = 0, kl = 0, top3 = 0;
  for (let t = 0; t < T; t++) {
    let mx = -Infinity, my = -Infinity, ax = 0;
    for (let c = 0; c < CB; c++) { const i = t * CB + c; num += (x[i] - y[i]) ** 2; den += x[i] ** 2; if (x[i] > mx) { mx = x[i]; ax = c; } if (y[i] > my) my = y[i]; }
    let zx = 0, zy = 0; for (let c = 0; c < CB; c++) { zx += Math.exp(x[t * CB + c] - mx); zy += Math.exp(y[t * CB + c] - my); }
    for (let c = 0; c < CB; c++) { const px = Math.exp(x[t * CB + c] - mx) / zx, py = Math.exp(y[t * CB + c] - my) / zy; if (px > 1e-9) kl += px * (Math.log(px) - Math.log(Math.max(py, 1e-12))); }
    let rank = 0; const vx = y[t * CB + ax]; for (let c = 0; c < CB; c++) if (y[t * CB + c] > vx) rank++;
    if (rank < 3) top3++;
  }
  return { rel: Math.sqrt(num / den), kl: kl / T, top3: top3 / T };
}
const timed = async (fn) => { const t = performance.now(); const r = await fn(); return [r, performance.now() - t]; };
// warm-up (wasm JIT / first-run allocation) so the first window is not an outlier
{ const seg = new Float32Array(WINDOW_AUDIO); for (const arm of [ref, cv]) await arm.step.run(makeFeed(ort, seg, null, ident)); }

const clips = fs.readdirSync(a.clips).filter((f) => f.endsWith('.wav')).sort();
const R = { ort: version, threads: Number(a.threads), clips: {} };
const stepRef = [], stepCv = [], decRef = [], decCv = [];
const tfM = { rel: [], kl: [], top3: [] };
const tfAg = { cls_upper: [], cls_hands: [], cls_lower: [] }, frAg = { cls_upper: [], cls_hands: [], cls_lower: [] };
let tfMax = 0, miMax = 0; const miMean = []; let nWin = 0;
for (const clip of clips) {
  const pcm = readWav(path.join(a.clips, clip));
  const nW = Math.min(Number(a.maxWindows), Math.floor(pcm.length / WINDOW_AUDIO));
  if (nW < 2) continue;
  let seedRef = null, seedCv = null;
  const per = { windows: nW, tfClsMaxDiff: 0, freeAgree: [] };
  for (let w = 0; w < nW; w++) {
    const seg = pcm.subarray(w * WINDOW_AUDIO, (w + 1) * WINDOW_AUDIO);
    const [oR, tR] = await timed(() => ref.step.run(makeFeed(ort, seg, seedRef, ident)));
    const [oC] = await timed(() => cv.step.run(makeFeed(ort, seg, seedRef, ident)));   // teacher forced: same inputs as REF
    for (const h of heads) { per.tfClsMaxDiff = Math.max(per.tfClsMaxDiff, maxAbsDiff(rd(oR, h), rd(oC, h))); tfAg[h].push(agree(rd(oR, h), rd(oC, h))); const lm = logitMetrics(rd(oR, h), rd(oC, h)); tfM.rel.push(lm.rel); tfM.kl.push(lm.kl); tfM.top3.push(lm.top3); }
    const [oC2, tC] = await timed(() => cv.step.run(makeFeed(ort, seg, seedCv, ident))); // free running with its own seed
    const ag = heads.map((h) => { const v = agree(rd(oR, h), rd(oC2, h)); frAg[h].push(v); return v; });
    per.freeAgree.push(mean(ag));
    stepRef.push(tR); stepCv.push(tC);
    // decode the same REF argmax indices through both vq stacks; time the full seed path (vq x3 + postprocess)
    const idx = { upper: ref.deps.argmax2d(rd(oR, 'cls_upper'), WINDOW, CB), hands: ref.deps.argmax2d(rd(oR, 'cls_hands'), WINDOW, CB), lower: ref.deps.argmax2d(rd(oR, 'cls_lower'), WINDOW, CB) };
    const dec = async (arm) => {
      const u = await arm.deps.runVq('upper', idx.upper, WINDOW), h = await arm.deps.runVq('hands', idx.hands, WINDOW), l = await arm.deps.runVq('lower', idx.lower, WINDOW);
      const f = new Float32Array(WINDOW * 106); for (let t = 0; t < WINDOW; t++) { f[t * 106] = 1; f[t * 106 + 4] = 1; }
      return arm.deps.runPostprocess(f, u, h, l, WINDOW);
    };
    const [miR, dR] = await timed(() => dec(ref)); const [miC, dC] = await timed(() => dec(cv));
    decRef.push(dR); decCv.push(dC);
    miMax = Math.max(miMax, maxAbsDiff(miR, miC));
    let s = 0; for (let i = 0; i < miR.length; i++) s += Math.abs(miR[i] - miC[i]); miMean.push(s / miR.length);
    const step = (arm, o) => computeSeedFromLogits(arm.deps, rd(o, 'cls_upper'), rd(o, 'cls_hands'), rd(o, 'cls_lower'), WINDOW, CB, MDIM, SEED_FRAMES);
    seedRef = await step(ref, oR); seedCv = await step(cv, oC2);
    nWin++;
  }
  tfMax = Math.max(tfMax, per.tfClsMaxDiff); per.meanFreeAgree = mean(per.freeAgree); per.minFreeAgree = Math.min(...per.freeAgree); delete per.freeAgree;
  R.clips[clip] = per;
  console.log(`${clip.padEnd(30)} windows=${nW} teacher cls max|d|=${per.tfClsMaxDiff.toFixed(4)} free-running agree mean=${per.meanFreeAgree.toFixed(3)} min=${per.minFreeAgree.toFixed(3)}`);
}
const r3 = (x) => Math.round(x * 1000) / 1000;
R.totals = {
  windows: nWin, clips: Object.keys(R.clips).length,
  teacherForcedClsMaxAbsDiff: tfMax,
  teacherForcedArgmaxAgree: Object.fromEntries(heads.map((h) => [h, r3(mean(tfAg[h]))])),
  teacherForcedLogits: { relL2: r3(mean(tfM.rel)), klPerFrame: r3(mean(tfM.kl)), refArgmaxInConvTop3: r3(mean(tfM.top3)) },
  freeRunningArgmaxAgree: Object.fromEntries(heads.map((h) => [h, r3(mean(frAg[h]))])),
  motionInference6D_sameIndices: { maxAbsDiff: r3(miMax), meanAbsDiff: Math.round(mean(miMean) * 1e6) / 1e6 },
  latencyMs: {
    stepRef: { median: r3(median(stepRef)), mean: r3(mean(stepRef)) }, stepConv: { median: r3(median(stepCv)), mean: r3(mean(stepCv)) },
    vq3PlusPostprocessRef: { median: r3(median(decRef)) }, vq3PlusPostprocessConv: { median: r3(median(decCv)) },
  },
};
console.log('\nTOTALS', JSON.stringify(R.totals, null, 2));
fs.writeFileSync(jsonPath, JSON.stringify(R, null, 2));
console.log('wrote', jsonPath);
