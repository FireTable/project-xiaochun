#!/usr/bin/env node
/**
 * Losslessly recompress PNG textures inside a .vrm (glTF Binary) file.
 *
 * Reads a .vrm, extracts every image bufferView, runs oxipng on each PNG,
 * rewrites the BIN chunk with the smaller bytes, writes a new .vrm.
 * Byte-identical re-runs are a no-op (oxipng is idempotent).
 *
 * Usage:
 *   node scripts/compress_vrm.mjs <input.vrm> <output.vrm> [-o level]
 *
 * Requires the `oxipng` binary on PATH (install via `brew install oxipng`).
 * ponytail: no npm deps needed — Node stdlib + external CLI only.
 *           add when: KTX2/BasisU textures, multi-file batch, JSON report.
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const execFile = promisify(execFileCb);

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.error('usage: node compress_vrm.mjs <input.vrm> <output.vrm> [-o level] [--in-place]');
  console.error('       --in-place   rewrite input file in place (workflow-friendly)');
  process.exit(0);
}
if (args.length < 2) {
  console.error('usage: node compress_vrm.mjs <input.vrm> <output.vrm> [-o level] [--in-place]');
  process.exit(1);
}
const inPlace = args.includes('--in-place');
const optIdx = args.indexOf('-o');
const optLevel = optIdx >= 0 ? args[optIdx + 1] : 'max';
// ponytail: --in-place 时 output 必填(原文件),便于 logging 输出明确路径。
// 不允许 input === output (没意义)— 但允许 --in-place 单文件模式(input 自覆盖)。
const [src, dstRaw] = args.filter((a) => !a.startsWith('--') && (a !== '-o' && optLevel !== a));
const dst = inPlace ? src : dstRaw;
if (!dst) {
  console.error('usage: node compress_vrm.mjs <input.vrm> <output.vrm> [-o level] [--in-place]');
  process.exit(1);
}

async function whichOxipng() {
  try {
    await execFile('oxipng', ['--version']);
  } catch {
    throw new Error('oxipng not found on PATH — install via `brew install oxipng`');
  }
}

function extractBin(buf) {
  if (buf.toString('utf8', 0, 4) !== 'glTF') throw new Error('not a GLB/VRM (bad magic)');
  if (buf.readUInt32LE(4) !== 2) throw new Error('not GLB version 2');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binChunkStart = 20 + jsonLen + ((4 - (jsonLen % 4)) % 4);
  const binLen = buf.readUInt32LE(binChunkStart);
  return { json, bin: buf.subarray(binChunkStart + 8, binChunkStart + 8 + binLen) };
}

async function main() {
  await whichOxipng();

  // ponytail: 保留原始输入字节 — 跑完一遍后如果新字节 == 原始字节,完全跳过
  // writeFileSync。compress_vrm 内部 JSON.stringify 会重排 key / 改数字格式
  // (1.0 → 1) 等小变化,跑第一遍时产物 ≠ 原文件,污染 git diff;
  // 跑第二遍时输入已经是"上次的产物",JSON.stringify 输出稳定 → idempotent。
  // 字节相等就跳过,无视中间状态,根因不用查。
  const origBuf = await readFile(src);
  const buf = origBuf;
  const { json, bin: oldBin } = extractBin(buf);
  const bvs = json.bufferViews || [];
  const images = json.images || [];

  const tmp = await mkdtemp(join(tmpdir(), 'vrmoxi-'));
  const replacements = new Map();   // bufferView idx -> compressed bytes
  const rows = [];                  // { idx, status, old, new }
  let origImageBytes = 0, newImageBytes = 0;

  for (const img of images) {
    if (img.bufferView === undefined) continue;
    const idx = img.bufferView;
    if (replacements.has(idx)) continue;
    const bv = bvs[idx];
    if (!bv) continue;
    const start = bv.byteOffset || 0;
    const old = oldBin.subarray(start, start + bv.byteLength);
    if (old.length < 8 || old[0] !== 0x89 || old[1] !== 0x50) {
      rows.push({ idx, status: 'skip', old: old.length, new: old.length });
      continue;
    }

    origImageBytes += old.length;
    const inFile = join(tmp, `${idx}.png`);
    const outFile = join(tmp, `${idx}.opt.png`);
    await writeFile(inFile, old);
    await execFile('oxipng', ['-o', optLevel, '--out', outFile, inFile]);
    const fresh = await readFile(outFile);
    if (fresh.length < old.length) {
      replacements.set(idx, fresh);
      newImageBytes += fresh.length;
      rows.push({ idx, status: 'compressed', old: old.length, new: fresh.length });
    } else {
      newImageBytes += old.length;
      rows.push({ idx, status: 'unchanged', old: old.length, new: fresh.length });
    }
  }
  await rm(tmp, { recursive: true, force: true });

  // rebuild BIN: walk bufferViews in original offset order, place back-to-back
  const ordered = bvs.map((bv, idx) => ({ bv, idx }))
                     .sort((a, b) => (a.bv.byteOffset || 0) - (b.bv.byteOffset || 0));
  const parts = [];
  const newBvMeta = new Array(bvs.length);
  let cursor = 0;
  for (const { bv, idx } of ordered) {
    const start = bv.byteOffset || 0;
    const slice = replacements.has(idx)
      ? replacements.get(idx)
      : oldBin.subarray(start, start + bv.byteLength);
    newBvMeta[idx] = { ...bv, byteOffset: cursor, byteLength: slice.length };
    parts.push(slice);
    cursor += slice.length;
  }
  const newBin = Buffer.concat(parts);
  json.bufferViews = newBvMeta;
  if (json.buffer) json.buffer.byteLength = newBin.length;

  let newJsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (newJsonBytes.length % 4)) % 4;
  if (jsonPad) newJsonBytes = Buffer.concat([newJsonBytes, Buffer.alloc(jsonPad, 0x20)]);

  const totalLen = 12 + 8 + newJsonBytes.length + 8 + newBin.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'utf8');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLen, 8);
  const jsonHdr = Buffer.alloc(8);
  jsonHdr.writeUInt32LE(newJsonBytes.length, 0);
  jsonHdr.write('JSON', 4, 'utf8');
  const binHdr = Buffer.alloc(8);
  binHdr.writeUInt32LE(newBin.length, 0);
  binHdr.write('BIN\0', 4, 'utf8');

  const newVrmBytes = Buffer.concat([header, jsonHdr, newJsonBytes, binHdr, newBin]);
  // ponytail: 字节级相等 → 跳过写盘 (preserve mtime + 内容),跟 build_vrmbase/addon
  // 的 sha256 skip 是同一思路。replacements.size===0 但 JSON.stringify 重排过 key
  // 也会被这一行抓住。
  if (newVrmBytes.equals(origBuf)) {
    console.log(`[compress_vrm]   ${dst}  unchanged (${newVrmBytes.length} bytes), skipped`);
  } else {
    await writeFile(dst, newVrmBytes);
  }

  // ponytail: 输出统一 stage header,人类 + AI 都能 grep 解析。
  // 其它 build_*.mjs 也用相同前缀 ('[stage] xxx')。
  const saved = origImageBytes - newImageBytes;
  console.log(`[compress_vrm]   ${src} → ${dst}  ${inPlace ? '(in-place)' : ''}`);
  console.log(`[compress_vrm]   oxipng -o ${optLevel}`);
  console.log(`[compress_vrm]   vrm size: ${(buf.length/1024/1024).toFixed(2)} MB → ${(totalLen/1024/1024).toFixed(2)} MB  (saved ${(saved/1024/1024).toFixed(2)} MB image bytes, ${origImageBytes ? ((saved/origImageBytes)*100).toFixed(2) : '0.00'}%)`);
  console.log(`[compress_vrm]   images : ${replacements.size}/${images.length} compressed`);
  for (const r of rows) {
    const before = (r.old / 1024).toFixed(1);
    const after  = (r.new / 1024).toFixed(1);
    const pct    = r.old ? ((1 - r.new / r.old) * 100).toFixed(2) : '0.00';
    console.log(`[compress_vrm]     [${String(r.idx).padStart(3)}] ${r.status.padEnd(11)} ${before.padStart(8)} KB → ${after.padStart(8)} KB  (-${pct}%)`);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });