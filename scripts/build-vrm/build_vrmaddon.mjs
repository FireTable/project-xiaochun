#!/usr/bin/env node
/**
 * Build .vrmaddon (delta patch) from old.vrm → new.vrm.
 *
 * Usage:
 *   node scripts/build_vrmaddon.mjs <old.vrm> <new.vrm> [<output.vrmaddon>]
 *
 * 输出文件名自动派生:跟 new.vrm 同目录、同前缀,扩展名换 .vrmaddon。
 * 例: node scripts/build_vrmaddon.mjs v1.vrm v1_1.vrm
 *   → v1_1.vrmaddon (跟 v1_1.vrm 同目录)
 * override 用第三参数。
 *
 * 产物内容 (.vrmaddon zip):
 *   - bin-patch.bin : bsdiff patch of BIN chunks
 *   - target.json   : raw JSON chunk bytes from new.vrm (bsdiff-wasm 对 text input 有 bug,不走 bsdiff)
 *
 * Runtime decode (vrmWorker):
 *   fetch addon → unzip → { bin-patch.bin, target.json } →
 *   bspatch(base.bin, binPatch) → new.bin → packRawGLB(json, bin).
 *   base 由同名 .vrmbase 提供 (compose_outfit 同时 fetch baseUrl)。
 */
import { zipSync } from 'fflate';
// ponytail: 字符串 spec + Function 包装,完全绕过 TS 静态 module-resolution (TS7016)。
// 仅 node CLI 用,Function 构造的 async fn 跑在 module scope。
const { loadBsdiff } = await (new Function('s', 'return import(s)'))('bsdiff-wasm');
import fs from 'fs';
import path from 'path';
import os from 'os';

function extractChunk(buf, lenOffset) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const chunkLen = dv.getUint32(lenOffset, true);
  return buf.subarray(lenOffset + 8, lenOffset + 8 + chunkLen);
}
function extractJson(buf) { return extractChunk(buf, 12); }
function extractBin(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = dv.getUint32(12, true);
  return extractChunk(buf, 20 + jsonLen);
}

function deriveOutputPath(newPath) {
  // foo.vrm → foo.vrmaddon,跟 input 同目录同前缀
  const ext = path.extname(newPath);
  if (ext !== '.vrm') {
    throw new Error(`new input must end in .vrm, got: ${newPath}`);
  }
  return newPath.slice(0, -ext.length) + '.vrmaddon';
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node scripts/build_vrmaddon.mjs <old.vrm> <new.vrm> [<output.vrmaddon>]');
    process.exit(1);
  }
  const oldPath = path.resolve(args[0]);
  const newPath = path.resolve(args[1]);
  const outputPath = path.resolve(args[2] ?? deriveOutputPath(newPath));

  console.log(`[build_vrmaddon]  ${oldPath}  +  ${newPath}  →  ${outputPath}`);

  const oldBuf = fs.readFileSync(oldPath);
  const newBuf = fs.readFileSync(newPath);
  const newJson = extractJson(newBuf);
  const oldBin = extractBin(oldBuf);
  const newBin = extractBin(newBuf);
  console.log(`[build_vrmaddon]  old.bin : ${(oldBin.length/1024/1024).toFixed(2)} MB`);
  console.log(`[build_vrmaddon]  new.bin : ${(newBin.length/1024/1024).toFixed(2)} MB`);
  console.log(`[build_vrmaddon]  new.json: ${(newJson.length/1024).toFixed(1)} KB`);

  // --- bsdiff via wasm (需要 MEMFS,挂 NODEFS 把 tmpDir 暴露给 wasm) ---
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrmaddon-'));
  fs.writeFileSync(path.join(tmpDir, 'old.bin'), Buffer.from(oldBin));
  fs.writeFileSync(path.join(tmpDir, 'new.bin'), Buffer.from(newBin));

  const bsdiff = await loadBsdiff();
  const workdir = '/bsdiff-work';
  try { bsdiff.FS.mkdir(workdir); } catch {}
  try { bsdiff.FS.unmount(workdir); } catch {}
  bsdiff.FS.mount(bsdiff.NODEFS, { root: tmpDir }, workdir);
  bsdiff.FS.chdir(workdir);

  const t0 = Date.now();
  bsdiff.callMain(['old.bin', 'new.bin', 'patch.bin']);
  const dt = Date.now() - t0;
  const binPatch = bsdiff.FS.readFile('patch.bin');
  console.log(`[build_vrmaddon]  bsdiff  : ${(binPatch.length/1024/1024).toFixed(2)} MB  in ${dt}ms`);

  // --- pack into .vrmaddon (zip with fflate, deflate level 9) ---
  // ponytail: 固定 mtime,产物可复现,git diff 不被 DOS 时间字段污染。
  // DOS time 范围 1980-01-01 起,epoch 会被 fflate 拒。
  const fixedMtime = new Date('1980-01-01T00:00:00Z');
  const addonBytes = zipSync({
    'bin-patch.bin': [binPatch, { mtime: fixedMtime }],
    'target.json':   [newJson,   { mtime: fixedMtime }],
  }, { level: 9 });

  // ponytail: sha256 比对 — 同源 bsdiff patch + 固定 mtime → 产物 byte-identical,
  // 跳过 writeFileSync 避免 mtime 漂移触发 git modified。
  const { createHash } = await import('node:crypto');
  const newHash = createHash('sha256').update(addonBytes).digest('hex').slice(0, 8);
  let wrote = true;
  if (fs.existsSync(outputPath)) {
    const oldHash = createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex').slice(0, 8);
    if (oldHash === newHash) {
      console.log(`[build_vrmaddon]  ${outputPath}  unchanged (sha256 ${newHash}…), skipped`);
      wrote = false;
    }
  }
  if (wrote) {
    // ponytail: 父目录不存在 → mkdirSync recursive。git rm 整个 addons/ 后首次跑
    // workflow 会撞到 ENOENT (commit 8e722d6 实际触发过这个 bug)。
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(addonBytes));
    console.log(`[build_vrmaddon]  ${outputPath}  written (sha256 ${newHash}…)`);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`[build_vrmaddon]  size    : ${(addonBytes.length/1024/1024).toFixed(2)} MB  (raw ${(newBuf.length/1024/1024).toFixed(2)} MB → saves ${((1 - addonBytes.length/newBuf.length)*100).toFixed(1)}%)`);
  console.log(`[build_vrmaddon]  done in ${Date.now() - t0}ms`);
  process.exit(0);
}

main().catch((e) => { console.error(`[build_vrmaddon]  ERROR: ${e.message ?? e}`); process.exit(1); });
