#!/usr/bin/env node
/**
 * bump-version.mjs — 统一版本号 + (可选) git tag / commit / push
 *
 * 版本源(必须同步):
 *   - package.json                    "version": "X.Y.Z"
 *   - src-tauri/Cargo.toml           version = "X.Y.Z"
 *   - src-tauri/tauri.conf.json       "version": "X.Y.Z"
 *
 * 非版本源(不动):
 *   - Casks/project-xiaochun.rb      brew 自动 bump (github-actions bot)
 *   - pnpm-lock.yaml                  pnpm 自动同步
 *   - README / docs                   手动写,无强一致要求
 *
 * 用法:
 *   node scripts/bump-version.mjs 0.1.9                ← 显式版本 (默认打 tag)
 *   node scripts/bump-version.mjs patch               ← 自动 bump + 打 tag (默认)
 *   node scripts/bump-version.mjs minor               ← (0.1.8 → 0.2.0) + 打 tag
 *   node scripts/bump-version.mjs major               ← (0.1.8 → 1.0.0) + 打 tag
 *   node scripts/bump-version.mjs 0.1.9 --no-tag     ← 只改文件不打 tag
 *   node scripts/bump-version.mjs 0.1.9 --commit      ← 改文件 + tag + git commit
 *   node scripts/bump-version.mjs 0.1.9 --commit --push ← 改文件 + tag + commit + push (触发 release)
 *   node scripts/bump-version.mjs patch --dry-run     ← 只打印,不落盘
 *
 * 退出码:
 *   0 成功 / 1 失败
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

const SOURCES = [
  { file: 'package.json',         match: /"version":\s*"(\d+\.\d+\.\d+)"/,         replace: (v) => `"version": "${v}"` },
  { file: 'src-tauri/Cargo.toml', match: /^version\s*=\s*"(\d+\.\d+\.\d+)"/m,      replace: (v) => `version = "${v}"` },
  { file: 'src-tauri/tauri.conf.json', match: /"version":\s*"(\d+\.\d+\.\d+)"/,     replace: (v) => `"version": "${v}"` },
];

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.error('usage: node scripts/bump-version.mjs <version|patch|minor|major> [--tag] [--commit] [--push] [--dry-run]');
  console.error('  version     explicit semver e.g. 0.1.9');
  console.error('  patch|minor|major   bump relative to current package.json');
  console.error('  --no-tag    skip git tag creation (default: create vX.Y.Z tag locally)');
  console.error('  --commit    also git commit the three bumped files');
  console.error('  --push      push commits (and tag) to origin main');
  console.error('  --dry-run   print diff, do not write');
  process.exit(0);
}
const flag = (k) => argv.includes(k);
const dryRun = flag('--dry-run');
const doTag = !flag('--no-tag');  // 默认打 tag, --no-tag opt-out
const doCommit = flag('--commit');
const doPush = flag('--push');

const arg = argv.find((a) => !a.startsWith('--'));
if (!arg) { console.error('error: missing version argument'); process.exit(1); }

// --- resolve target version ---
const pkgPath = join(REPO, 'package.json');
const current = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
const currentMatch = current.match(VERSION_RE);
if (!currentMatch) { console.error(`error: current package.json version "${current}" not semver`); process.exit(1); }

let target;
if (VERSION_RE.test(arg)) {
  target = arg;
} else if (['patch', 'minor', 'major'].includes(arg)) {
  const [_, M, m, p] = currentMatch;
  if (arg === 'patch') target = `${M}.${m}.${+p + 1}`;
  if (arg === 'minor') target = `${M}.${+m + 1}.0`;
  if (arg === 'major') target = `${+M + 1}.0.0`;
} else {
  console.error(`error: "${arg}" is not a valid version or bump type`);
  process.exit(1);
}

if (target === current) {
  console.error(`error: target ${target} == current ${current}, nothing to do`);
  process.exit(1);
}

// --- write files ---
console.log(`[bump] ${current} → ${target}${dryRun ? ' (dry-run)' : ''}`);
const diffs = [];
for (const s of SOURCES) {
  const p = join(REPO, s.file);
  const before = readFileSync(p, 'utf8');
  const beforeVersion = (before.match(s.match) || [])[1];
  if (!beforeVersion) { console.error(`error: ${s.file} has no matching version`); process.exit(1); }
  if (beforeVersion === target) {
    console.log(`[bump]   skip ${s.file} (already ${target})`);
    continue;
  }
  const after = before.replace(s.match, s.replace(target));
  diffs.push({ file: s.file, beforeVersion, after });
  if (!dryRun) writeFileSync(p, after, 'utf8');
  console.log(`[bump]   ${s.file}: ${beforeVersion} → ${target}`);
}

if (dryRun) {
  console.log('[bump] dry-run, no files written');
  process.exit(0);
}

// --- git commit / tag / push ---
const runGit = (cmd) => {
  try { return execSync(cmd, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); }
  catch (e) { console.error(`git ${cmd} failed:\n${e.stderr?.toString() || e.message}`); process.exit(1); }
};

if (doCommit || doTag) {
  const modified = diffs.map((d) => d.file);
  if (modified.length > 0) runGit(`git add ${modified.map((f) => `"${f}"`).join(' ')}`);
  if (doCommit) {
    runGit(`git commit -m "chore(release): bump version ${current} → ${target}"`);
    console.log(`[bump] committed: chore(release): bump version ${current} → ${target}`);
  }
}
if (doTag) {
  const tag = `v${target}`;
  const existing = runGit(`git tag -l ${tag}`);
  if (existing) { console.error(`error: tag ${tag} already exists locally`); process.exit(1); }
  runGit(`git tag ${tag}`);
  console.log(`[bump] tagged: ${tag}`);
}
if (doPush) {
  runGit(`git push origin main${doTag ? ' --follow-tags' : ''}`);
  console.log(`[bump] pushed to origin/main${doTag ? ' (with tag)' : ''}`);
}

console.log(`[bump] done. version = ${target}`);