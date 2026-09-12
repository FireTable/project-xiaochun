#!/usr/bin/env node
/**
 * handle-vrm-workflow.mjs — 一键重建整套 VRM 资产 (base + addons),并校对 config。
 *
 * 设计:
 *   public/vrm/.vroid/base/<name>.vrm    ← 原始 base (git ignore)
 *   public/vrm/.vroid/addons/<name>.vrm   ← 原始 addon (git ignore)
 *   public/vrm/.vroid/base / .vroid/addons 整体被 .gitignore,不入仓。
 *
 *   1) compress_vrm.mjs  对每个 .vrm 跑 oxipng 原地重压(写回 .vroid/)
 *   2) build_vrmbase.mjs 从 .vroid/base/ 第一个 .vrm 产 public/vrm/<name>.vrmbase
 *   3) build_vrmaddon.mjs 对每个 .vroid/addons/<name>.vrm 跟 base bsdiff → public/vrm/addons/<name>.vrmaddon
 *
 *   Usage: node scripts/build-vrm/workflow.mjs <base-name>
 *     - base-name: .vroid/base/<base-name>.vrm 的 base 名字(无扩展名)
 *     - example:   node scripts/build-vrm/workflow.mjs xiaochun_base
 *
 *   完成后会:
 *     - 对比 .vroid/ 里发现的所有 .vrm 跟 src/config.ts model.addons / model.defaultSource
 *     - 列出"未在 config.ts 注册"的新 addon / 新 base,标记 [REQUEST_USER_HELP] 提示
 *     - AI agent 看到这个标记会询问用户是否帮忙写入 config.ts
 *
 *   .vroid/base/ 多个 .vrm 时报错 — 必须只一个 base,避免歧义。
 *
 *   ponytail: stdout 用统一 stage prefix [handle-vrm] / [stage_name] —
 *   人类 + AI 都能 grep / parse 进度。[REQUEST_USER_HELP] 标记给 AI 读。
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// ponytail: 用 spawn 不用 execFile + promisify — Node 24 的 execFile('node', ..., { stdio: 'inherit' })
// 静默不继承子 stdout (实测 console.log 不出现),但 spawn OK。换 spawn 顺手包个
// Promise,失败 throw 非零退出码让 runStage catch。
function runChild(args) {
  return new Promise((res, rej) => {
    const child = spawn('node', args, { cwd: REPO, stdio: 'inherit' });
    child.on('exit', (code) => code === 0 ? res() : rej(new Error(`exit ${code}`)));
    child.on('error', rej);
  });
}

// ponytail: REPO = repo root。脚本在 scripts/build-vrm/workflow.mjs,
// 从文件名往回 3 段:workflow.mjs → build-vrm → scripts → <repo root>。
const REPO = resolve(fileURLToPath(import.meta.url), '../../..');
const VROID_DIR = join(REPO, 'public/vrm/.vroid');
const BASE_DIR = join(VROID_DIR, 'base');
const ADDONS_DIR = join(VROID_DIR, 'addons');
const OUT_DIR = join(REPO, 'public/vrm');
const OUT_ADDONS_DIR = join(OUT_DIR, 'addons');
const CONFIG_PATH = join(REPO, 'src/config.ts');

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.error('usage: node scripts/build-vrm/workflow.mjs [<base-name>]');
  console.error('  base-name: filename (no .vrm) of the .vrm in public/vrm/.vroid/base/');
  console.error('             可选 — .vroid/base/ 只有一个 .vrm 时自动用它');
  process.exit(0);
}
// ponytail: <base-name> 可选 — .vroid/base/ 只有一个 .vrm 时自动取那个;
// 0 个报错,>1 个报错并列出候选项让用户指定。baseName 在 main() 里根据扫描结果决定。
let baseName = argv[0] ?? null;

function listVrm(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.vrm'))
    .sort();
}

const stages = ['compress all .vrm', 'build .vrmbase', 'build .vrmaddon'];

function stage(label) {
  const total = stages.length;
  const idx = stages.indexOf(label) + 1;
  console.log(`\n[handle-vrm] === ${idx}/${total}: ${label} ===`);
}


async function runStage(label, body) {
  stage(label);
  const t0 = Date.now();
  try {
    await body();
  } catch (e) {
    console.error(`[handle-vrm] FAILED at stage '${label}': ${e.message ?? e}`);
    process.exit(1);
  }
  console.log(`[handle-vrm] stage '${label}' done in ${Date.now() - t0}ms`);
}

async function compressVrmInPlace(vrmPath) {
  await runChild([resolve(REPO, 'scripts/build-vrm/compress_vrm.mjs'), vrmPath, vrmPath, '--in-place']);
}

async function buildBase(baseVrm, baseOut) {
  await runChild([resolve(REPO, 'scripts/build-vrm/build_vrmbase.mjs'), baseVrm, baseOut]);
}

async function buildAddon(baseVrm, addonVrm, addonOut) {
  await runChild([resolve(REPO, 'scripts/build-vrm/build_vrmaddon.mjs'), baseVrm, addonVrm, addonOut]);
}

/**
 * 读 src/config.ts,正则抽取 model.defaultSource / model.addons key / defaultName。
 * 跟 base 实际路径 + addon 列表对比,输出缺失项,要求用户/agent 帮忙写回 config。
 *
 * 顺手比对 .vrmbase / .vrmaddon 产物 sha256 vs config.ts 里的 defaultSha / addon.sha:
 * - 不一致 → 提示 [REQUEST_USER_HELP] 让用户更新 config
 * - 用户更新后,runtime IDB cache 命中 → 自动 invalidate(sha 进 cache key)
 */
function checkConfigVsVroid(baseName, addonNames) {
  let src;
  try {
    src = readFileSync(CONFIG_PATH, 'utf8');
  } catch (e) {
    console.log(`[handle-vrm] WARN: cannot read ${CONFIG_PATH}: ${e.message}`);
    return;
  }
  // config 期望的 base / addons:
  //   defaultSource: '/vrm/xiaochun_base.vrmbase',
  //   defaultName:   '...',
  //   addons: { 'v1_1': { source: '/vrm/addons/v1_1.vrmaddon', name: '...' }, ... }
  const expectedBasePath = `/vrm/${baseName}.vrmbase`;
  const baseMatch = src.match(/defaultSource:\s*['"`]([^'"`]+)['"`]/);
  const nameMatch = src.match(/defaultName:\s*['"`]([^'"`]+)['"`]/);
  const actualBasePath = baseMatch ? baseMatch[1] : null;
  const actualDefaultName = nameMatch ? nameMatch[1] : null;
  // addons: 抓 addons: { ... } 块里所有 'vN': { source: '/vrm/addons/...vrmaddon' }
  const addonBlock = src.match(/addons:\s*\{([\s\S]*?)\}\s*as\s+Record/);
  const configuredAddons = new Set();
  // ponytail: 同时记录标 default: true 的 addon — 多个 default 会让 runtime 拿第一个,
  // workflow 应该警告让用户选一个作为 canonical default。
  const defaultAddons = [];
  if (addonBlock) {
    const entryRe = /['"`]([^'"`]+)['"`]\s*:\s*\{([\s\S]*?)\n\s*\}/g;
    for (const m of addonBlock[1].matchAll(entryRe)) {
      configuredAddons.add(m[1]);
      if (/\bdefault:\s*true\b/.test(m[2])) defaultAddons.push(m[1]);
    }
  }
  // 实际 .vrm 文件 (去掉 .vrm) 既是 addon key,也是 addon 的名字(去掉 _vN 后缀?)
  // 约定: addon 文件名 = config key,例如 xiaochun_v1.vrm → key 'xiaochun_v1'
  const actualAddons = new Set(addonNames);

  // 找差异
  const missingAddons = [...actualAddons].filter((a) => !configuredAddons.has(a));
  const staleAddons = [...configuredAddons].filter((a) => !actualAddons.has(a));
  const baseOk = actualBasePath === expectedBasePath;

  // ponytail: 没有 default addon 时,prod 用户冷启会落到 base 裸模 — 体验差。
  // 警告一下让 agent/用户决定是否要加 default:true。
  const defaultWarnings = [];
  if (defaultAddons.length === 0 && configuredAddons.size > 0) {
    defaultWarnings.push('config.ts 没有 default:true 的 addon — 普通用户冷启会落在裸模');
  }
  if (defaultAddons.length > 1) {
    defaultWarnings.push(`多个 addon 标 default:true (${defaultAddons.join(', ')}) — runtime 只取第一个,建议只留一个`);
  }

  console.log(`\n[handle-vrm] === config check ===`);
  console.log(`[handle-vrm]   base expected:   defaultSource = '${expectedBasePath}'`);
  console.log(`[handle-vrm]   base actual:     defaultSource = '${actualBasePath ?? '(not set)'}'  ${baseOk ? '✓' : '✗'}`);
  console.log(`[handle-vrm]   defaultName:     '${actualDefaultName ?? '(not set)'}'`);

  // ponytail: sha 比对放在早期 return 之前 — 即使 addons 全部 synced 也要跑,
  // 这是 IDB cache 失效源,改了产物但 config 没跟上 runtime 会一直 miss。
  const configShas = extractConfigShas(src);
  const actualShas = computeActualShas(baseName, addonNames);
  const baseShaActual = actualShas.base;
  const baseShaConfig = configShas.base;
  const baseShaOk = baseShaActual === baseShaConfig;
  console.log(`\n[handle-vrm] === sha256 check ===`);
  console.log(`[handle-vrm]   ${baseName}.vrmbase`);
  console.log(`[handle-vrm]     actual:    ${baseShaActual ?? '(文件不存在)'}  ${baseShaOk ? '✓' : '✗'}`);
  console.log(`[handle-vrm]     config.ts: ${baseShaConfig ?? '(未设)'}`);

  const addonShaMismatches = [];
  for (const a of addonNames) {
    const actual = actualShas.addons[a];
    const config = configShas.addons[a];
    const ok = actual === config;
    console.log(`[handle-vrm]   ${a}.vrmaddon`);
    console.log(`[handle-vrm]     actual:    ${actual ?? '(文件不存在)'}  ${ok ? '✓' : '✗'}`);
    console.log(`[handle-vrm]     config.ts: ${config ?? '(未设)'}`);
    if (!ok) addonShaMismatches.push({ addon: a, actual, config });
  }

  if (!baseShaOk || addonShaMismatches.length > 0) {
    console.log(`\n[handle-vrm] [REQUEST_USER_HELP] config.ts 的 sha 字段落后于产物:`);
    if (!baseShaOk && baseShaActual) {
      console.log(`[handle-vrm]   src/config.ts APP_CONFIG.model:`);
      console.log(`[handle-vrm]     defaultSha: '${baseShaActual.slice(0, 16)}',`);
    }
    for (const m of addonShaMismatches) {
      if (!m.actual) continue;
      console.log(`[handle-vrm]     addons.${m.addon}.sha: '${m.actual.slice(0, 16)}',`);
    }
    console.log(`[handle-vrm]   (复制上面的 sha 到 config.ts 即可;runtime 会自动用新 sha 当 cache key,旧条目失效)`);
  }

  if (missingAddons.length === 0 && staleAddons.length === 0 && baseOk) {
    console.log(`[handle-vrm]   addons:          ${actualAddons.size} configured  ✓ all synced`);
    return;
  }
  console.log(`[handle-vrm]   addons configured (${configuredAddons.size}): ${[...configuredAddons].sort().join(', ') || '(none)'}`);
  console.log(`[handle-vrm]   addons on disk    (${actualAddons.size}): ${[...actualAddons].sort().join(', ') || '(none)'}`);

  // 缺 / 多 → 提示 + 标记 [REQUEST_USER_HELP]
  const suggestions = [];
  if (!baseOk) {
    suggestions.push(
      `建议在 src/config.ts 的 model 块修改:`,
      `  defaultSource: '${expectedBasePath}',`,
      `  defaultName:   '${baseName}',`,
    );
  }
  for (const a of missingAddons) {
    const displayName = a.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    suggestions.push(
      `  '${a}': { source: '/vrm/addons/${a}.vrmaddon', name: '${displayName}' },`,
    );
  }
  if (staleAddons.length > 0) {
    suggestions.push(`  // 提示: 配置文件里残留 addon 但磁盘已删: ${staleAddons.join(', ')}`);
  }

  if (suggestions.length > 0) {
    console.log(`\n[handle-vrm] [REQUEST_USER_HELP] config.ts 需要更新:`);
    console.log(`[handle-vrm]   src/config.ts APP_CONFIG.model:`);
    console.log(`[handle-vrm]     defaultSource: '${expectedBasePath}'`);
    console.log(`[handle-vrm]     defaultName:   '<人类可读名字>'`);
    console.log(`[handle-vrm]     addons: {`);
    for (const a of actualAddons) {
      const displayName = a.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      console.log(`[handle-vrm]       '${a}': { source: '/vrm/addons/${a}.vrmaddon', name: '${displayName}' },`);
    }
    console.log(`[handle-vrm]     }`);
    if (staleAddons.length > 0) {
      console.log(`[handle-vrm]   ⚠ stale entries (disk 删了但 config 还有): ${staleAddons.join(', ')}`);
    }
  }

  // ponytail: default addon 警告 — 独立 [REQUEST_USER_HELP] 块,跟 missingAddons 不混。
  if (defaultWarnings.length > 0) {
    console.log(`\n[handle-vrm] [REQUEST_USER_HELP] default addon 配置异常:`);
    for (const w of defaultWarnings) console.log(`[handle-vrm]   ⚠ ${w}`);
  }

  // ponytail: 重复 section 移到上面早期 return 之前 (line 152-184),这里保留为空以避免重声明。
}

/** ponytail: 从 config.ts 抓 defaultSha 和 addons[k].sha。正则匹配,ts 编译复杂不值。 */
function extractConfigShas(src) {
  const baseMatch = src.match(/defaultSha:\s*['"`]([0-9a-f]+)['"`]/i);
  const addons = {};
  // 抓 addons 块里每个 'key': { ... sha: 'xxx' ... }
  const block = src.match(/addons:\s*\{([\s\S]*?)\}\s*as\s+Record/);
  if (block) {
    // 每个 entry 从 key 到下一个 entry 或块结尾
    const entryRe = /['"`]([^'"`]+)['"`]\s*:\s*\{([\s\S]*?)\}/g;
    for (const m of block[1].matchAll(entryRe)) {
      const key = m[1];
      const body = m[2];
      const shaMatch = body.match(/sha:\s*['"`]([0-9a-f]+)['"`]/i);
      if (shaMatch) addons[key] = shaMatch[1];
    }
  }
  return { base: baseMatch?.[1] ?? null, addons };
}

/** ponytail: 算产物文件 sha256(全量,只显示前 16 字符给用户;runtime 也只对比短截)。 */
function computeActualShas(baseName, addonNames) {
  const shaShort = (file) => {
    try {
      const buf = readFileSync(file);
      return createHash('sha256').update(buf).digest('hex').slice(0, 16);
    } catch {
      return null;
    }
  };
  const baseFile = join(OUT_DIR, `${baseName}.vrmbase`);
  const addons = {};
  for (const a of addonNames) {
    addons[a] = shaShort(join(OUT_ADDONS_DIR, `${a}.vrmaddon`));
  }
  return { base: shaShort(baseFile), addons };
}

async function main() {
  console.log(`[handle-vrm] repo   ${REPO}`);

  const bases = listVrm(BASE_DIR);
  // ponytail: 自动模式 — 没传 baseName 但只有一个 .vrm 时直接用,省一次 argv。
  if (baseName === null) {
    if (bases.length === 0) {
      console.error(`[handle-vrm] FAILED: no .vrm in ${BASE_DIR}`);
      console.error(`  hint: place a .vrm file in .vroid/base/, or pass <base-name> as argv`);
      process.exit(1);
    }
    if (bases.length > 1) {
      console.error(`[handle-vrm] FAILED: ${bases.length} .vrm files in ${BASE_DIR}, pass <base-name> to pick one:`);
      for (const b of bases) console.error(`  - ${basename(b, '.vrm')}    (${b})`);
      console.error(`  example: node scripts/build-vrm/workflow.mjs ${basename(bases[0], '.vrm')}`);
      process.exit(1);
    }
    baseName = basename(bases[0], '.vrm');
    console.log(`[handle-vrm] start  base=${baseName}  (auto-detected, single .vrm in .vroid/base/)`);
  } else {
    // ponytail: 显式传了 argv — 必须跟磁盘上的 .vrm 文件名对上,避免打错路径生成幽灵产物。
    if (!bases.includes(`${baseName}.vrm`)) {
      console.error(`[handle-vrm] FAILED: '${baseName}.vrm' not in ${BASE_DIR}`);
      if (bases.length > 0) {
        console.error(`  found:`);
        for (const b of bases) console.error(`    - ${b}`);
      }
      process.exit(1);
    }
    console.log(`[handle-vrm] start  base=${baseName}`);
  }

  const baseVrm = join(BASE_DIR, `${baseName}.vrm`);
  const baseOut = join(OUT_DIR, `${baseName}.vrmbase`);
  console.log(`[handle-vrm] base   ${baseVrm}`);

  const addonFiles = listVrm(ADDONS_DIR);
  if (addonFiles.length === 0) {
    console.log(`[handle-vrm] warn: no .vrm in ${ADDONS_DIR} — only base will be built`);
  } else {
    for (const a of addonFiles) console.log(`[handle-vrm] addon  ${join(ADDONS_DIR, a)}`);
  }

  await runStage(stages[0], async () => {
    await compressVrmInPlace(baseVrm);
    for (const a of addonFiles) {
      await compressVrmInPlace(join(ADDONS_DIR, a));
    }
  });

  await runStage(stages[1], async () => {
    await buildBase(baseVrm, baseOut);
  });

  await runStage(stages[2], async () => {
    for (const a of addonFiles) {
      const addonVrm = join(ADDONS_DIR, a);
      const addonName = basename(a, '.vrm');
      const addonOut = join(OUT_ADDONS_DIR, `${addonName}.vrmaddon`);
      await buildAddon(baseVrm, addonVrm, addonOut);
    }
  });

  console.log(`\n[handle-vrm] all done.`);
  console.log(`[handle-vrm] base:   ${baseOut}`);
  for (const a of addonFiles) {
    const addonName = basename(a, '.vrm');
    console.log(`[handle-vrm] addon:  ${join(OUT_ADDONS_DIR, `${addonName}.vrmaddon`)}`);
  }

  // 跟 src/config.ts 核对 — 标记需要更新
  const addonNames = addonFiles.map((f) => basename(f, '.vrm'));
  checkConfigVsVroid(baseName, addonNames);
}

main().catch((e) => { console.error(`[handle-vrm] ERROR: ${e.message ?? e}`); process.exit(1); });
