#!/usr/bin/env node
/**
 * Losslessly recompress PNG textures inside a .vrm (glTF Binary) file.
 *
 * Reads a .vrm, extracts every image bufferView, runs oxipng on each PNG,
 * rewrites the BIN chunk with the smaller bytes, writes a new .vrm.
 * Byte-identical re-runs are a no-op (oxipng is idempotent).
 *
 * 自定义压缩元数据 — glTF JSON extras.compressedBy:
 *   - 在 glTF JSON 根级 extras.compressedBy 里写压缩元数据
 *   - 内容包含 tool / oxipngLevel / oxipngVersion / timestamp / compressedBinSha256 / per-image stats
 *   - 下次跑这个脚本时,先看 extras.compressedBy:
 *     - compressedBinSha256 === sha256(inputBin 当前) && level 匹配 → 直接 return(几十秒省掉)
 *     - level 不匹配或 sha 变了(input 被改)→ 重新跑 oxipng + 更新 compressedBy
 *   - extras 是 glTF spec 允许的自定义字段,VRoid Studio / three-vrm 都安全忽略未知字段
 *   - 根级 extras 是空的(xiaochun_base.vrm 验证过),不与 VRoid Studio 的 meshes[*].extras.targetNames 冲突
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
import { createHash } from 'node:crypto';
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

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function extractBin(buf) {
  if (buf.toString('utf8', 0, 4) !== 'glTF') throw new Error('not GLB (bad magic)');
  if (buf.readUInt32LE(4) !== 2) throw new Error('not GLB version 2');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binChunkStart = 20 + jsonLen + ((4 - (jsonLen % 4)) % 4);
  const binLen = buf.readUInt32LE(binChunkStart);
  return { json, bin: buf.subarray(binChunkStart + 8, binChunkStart + 8 + binLen) };
}

async function getOxipngVersion() {
  try {
    const { stdout } = await execFile('oxipng', ['--version']);
    const m = stdout.match(/\d+\.\d+\.\d+/);
    return m ? m[0] : stdout.trim();
  } catch {
    return 'unknown';
  }
}

async function main() {
  await whichOxipng();

  const origBuf = await readFile(src);

  // 1. 拆 GLB
  let json, oldBin;
  try {
    ({ json, bin: oldBin } = extractBin(origBuf));
  } catch (e) {
    console.error(`[compress_vrm]   ERROR parsing GLB: ${e.message}`);
    process.exit(1);
  }
  const inputBinHash = sha256(oldBin);

  // 2. 跳过检测 — 看 glTF extras.compressedBy
  const prev = json?.extras?.compressedBy;
  if (prev && prev.oxipngLevel === optLevel && prev.compressedBinSha256 === inputBinHash) {
    console.log(`[compress_vrm]   ${dst}  skip: already compressed at level ${optLevel} (extras.compressedBy sha matches)`);
    return;
  }
  if (prev) {
    const why = prev.compressedBinSha256 === inputBinHash
      ? `level differs (was ${prev.oxipngLevel}, now ${optLevel})`
      : 'input BIN sha changed (source .vrm modified)';
    console.log(`[compress_vrm]   ${dst}  re-compress at level ${optLevel}: ${why}`);
  } else {
    console.log(`[compress_vrm]   ${dst}  first compression at level ${optLevel}`);
  }

  // 3. 跑 oxipng 压缩
  // ponytail: 保留原始输入字节 — 跑完一遍后如果新字节 == 原始字节,完全跳过
  // writeFileSync。compress_vrm 内部 JSON.stringify 会重排 key / 改数字格式
  // (1.0 → 1) 等小变化,跑第一遍时产物 ≠ 原文件,污染 git diff;
  // 跑第二遍时输入已经是"上次的产物",JSON.stringify 输出稳定 → idempotent。
  // 字节相等就跳过,无视中间状态,根因不用查。
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

  // rebuild BIN
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

  // 4. 构造 metadata,塞进 glTF extras
  const oxipngVer = await getOxipngVersion();
  json.extras = {
    ...(json.extras || {}),
    compressedBy: {
      tool: 'compress_vrm.mjs',
      oxipngLevel: optLevel,
      oxipngVersion: oxipngVer,
      timestamp: new Date().toISOString(),
      compressedBinSha256: sha256(newBin),
      bufferViewCount: replacements.size,
      bufferViews: Object.fromEntries(
        rows.map((r) => [r.idx.toString(), { old: r.old, new: r.new, status: r.status }])
      ),
    },
  };

  let newJsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (newJsonBytes.length % 4)) % 4;
  if (jsonPad) newJsonBytes = Buffer.concat([newJsonBytes, Buffer.alloc(jsonPad, 0x20)]);

  // 5. 组装新 GLB
  const totalLen = 12 + 8 + newJsonBytes.length + 8 + newBin.length;
  const out = Buffer.alloc(totalLen);
  out.write('glTF', 0, 'utf8');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(totalLen, 8);
  let p = 12;
  out.writeUInt32LE(newJsonBytes.length, p);
  out.write('JSON', p + 4, 'utf8');
  newJsonBytes.copy(out, p + 8);
  p += 8 + newJsonBytes.length;
  out.writeUInt32LE(newBin.length, p);
  out.write('BIN\0', p + 4, 'utf8');
  newBin.copy(out, p + 8);

  // 6. 字节级相等 → 跳过写盘
  if (out.equals(origBuf)) {
    console.log(`[compress_vrm]   ${dst}  unchanged (${out.length} bytes), skipped`);
  } else {
    await writeFile(dst, out);
  }

  // 输出 stats
  const saved = origImageBytes - newImageBytes;
  console.log(`[compress_vrm]   ${src} → ${dst}  ${inPlace ? '(in-place)' : ''}`);
  console.log(`[compress_vrm]   oxipng -o ${optLevel}`);
  console.log(`[compress_vrm]   vrm size: ${(origBuf.length/1024/1024).toFixed(2)} MB → ${(out.length/1024/1024).toFixed(2)} MB  (saved ${(saved/1024/1024).toFixed(2)} MB image bytes, ${origImageBytes ? ((saved/origImageBytes)*100).toFixed(2) : '0.00'}%)`);
  console.log(`[compress_vrm]   images : ${replacements.size}/${images.length} compressed`);
  console.log(`[compress_vrm]   meta   : level=${optLevel} oxipng=${oxipngVer} binSha=${sha256(newBin).slice(0, 16)}...`);
  for (const r of rows) {
    const before = (r.old / 1024).toFixed(1);
    const after  = (r.new / 1024).toFixed(1);
    const pct    = r.old ? ((1 - r.new / r.old) * 100).toFixed(2) : '0.00';
    console.log(`[compress_vrm]     [${String(r.idx).padStart(3)}] ${r.status.padEnd(11)} ${before.padStart(8)} KB → ${after.padStart(8)} KB  (-${pct}%)`);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });