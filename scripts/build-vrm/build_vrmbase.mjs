#!/usr/bin/env node
/**
 * Build .vrmbase from a .vrm file.
 *
 * Usage:
 *   node scripts/build_vrmbase.mjs <input.vrm> [<output.vrmbase>]
 *
 * 输出文件名自动派生:foo.vrm → foo.vrmbase。override 用第二参数。
 *
 * 产物内容:
 *   - whole-glb.bin : 整个 BIN chunk
 *   - target.json   : 整个 JSON chunk
 *
 * 跟 build_vrmaddon.mjs 共用 zip+fflate 套路,但不走 bsdiff — 整个 BIN chunk 直接装。
 * runtime (vrmWorker) 收到后 unzip + packGLB 即可 (worker 看到没有 'bin-patch.bin'
 * 就跳过 bspatch,用 'whole-glb.bin' 直接拼装)。
 *
 * 收益: foo.vrm (raw) → foo.vrmbase (zip),典型省 30-45% (PNG/JPEG 纹理重压)。
 * 用途: 冷启动 (走 compose_outfit) + bspatch base (换装路径用同一份)。
 */
import { zipSync } from 'fflate';
import fs from 'fs';
import path from 'path';

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

function deriveOutputPath(inputPath) {
  // foo.vrm → foo.vrmbase;foo/bar.vrm → foo/bar.vrmbase
  const ext = path.extname(inputPath);
  if (ext !== '.vrm') {
    throw new Error(`input must end in .vrm, got: ${inputPath}`);
  }
  return inputPath.slice(0, -ext.length) + '.vrmbase';
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node scripts/build_vrmbase.mjs <input.vrm> [<output.vrmbase>]');
    process.exit(1);
  }
  const inputPath = path.resolve(args[0]);
  const outputPath = path.resolve(args[1] ?? deriveOutputPath(inputPath));

  console.log(`[build_vrmbase]   ${inputPath} → ${outputPath}`);

  const vrmBuf = fs.readFileSync(inputPath);
  const vrmBin = extractBin(vrmBuf);
  const vrmJson = extractJson(vrmBuf);
  console.log(`[build_vrmbase]   bin  : ${(vrmBin.length/1024/1024).toFixed(2)} MB`);
  console.log(`[build_vrmbase]   json : ${(vrmJson.length/1024).toFixed(1)} KB`);

  const t0 = Date.now();
  // ponytail: 固定 mtime — 否则 fflate 默认写当前时间到 DOS time 字段,
  // 同源文件重跑会 byte-different,污染 git diff。DOS time 范围 1980-01-01 起,
  // epoch 会被 fflate 拒,用 1980-01-01 即可。
  const fixedMtime = new Date('1980-01-01T00:00:00Z');
  const addonBytes = zipSync({
    'whole-glb.bin': [vrmBin, { mtime: fixedMtime }],
    'target.json':   [vrmJson, { mtime: fixedMtime }],
  }, { level: 9 });
  // ponytail: 同源文件重跑产物 byte-identical (mtime 已固定),sha256 比对后
  // 跳过 writeFileSync — 避免 git 误以为 mtime 变了 / IDE 弹 modified 提示。
  const { createHash } = await import('node:crypto');
  const newHash = createHash('sha256').update(addonBytes).digest('hex').slice(0, 8);
  let wrote = true;
  if (fs.existsSync(outputPath)) {
    const oldHash = createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex').slice(0, 8);
    if (oldHash === newHash) {
      console.log(`[build_vrmbase]   ${outputPath}  unchanged (sha256 ${newHash}…), skipped`);
      wrote = false;
    }
  }
  if (wrote) {
    // ponytail: 父目录不存在 → mkdirSync recursive。git rm 整个 addons/ 后首次跑
    // workflow 会撞到 ENOENT (commit 8e722d6 实际触发过这个 bug)。
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(addonBytes));
    console.log(`[build_vrmbase]   ${outputPath}  written (sha256 ${newHash}…)`);
  }
  const dt = Date.now() - t0;

  console.log(`[build_vrmbase]   size : ${(addonBytes.length/1024/1024).toFixed(2)} MB  (raw ${(vrmBuf.length/1024/1024).toFixed(2)} MB → saves ${((1 - addonBytes.length/vrmBuf.length)*100).toFixed(1)}%)`);
  console.log(`[build_vrmbase]   done in ${dt}ms`);
  process.exit(0);
}

main().catch((e) => { console.error(`[build_vrmbase]   ERROR: ${e.message ?? e}`); process.exit(1); });
