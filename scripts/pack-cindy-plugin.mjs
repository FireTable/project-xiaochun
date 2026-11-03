#!/usr/bin/env node
/**
 * pack-cindy-plugin.mjs — 通用 Cindy 插件全量打包工具
 *
 * 核心特性：
 * 1. 跨平台纯 Node.js 实现 (依赖 fflate)，无需系统 zip 命令，完美适配 macOS / Windows / Linux；
 * 2. 动态自适应：递归扫描 packages/cindy-plugin 目录，后续无论新增任何文件、资源、多语言或代码，均自动纳入；
 * 3. 智能黑名单过滤：自动排除 *.cindy 产物、测试脚本、系统临时文件 (.DS_Store / Thumbs.db)、开发环境缓存；
 * 4. 自动版本派发：自动读取 ghost.json 内的 id 与 version 生成标准命名 (如 xiaochun-companion-1.0.0.cindy)；
 * 5. 打包前置核验：自动执行规范与 Schema 检查，确保产物 100% 合规可用；
 * 6. 本地开发同步：若检测到系统已安装 Cindy，自动热同步最新代码至本地插件运行目录。
 *
 * Usage:
 *   pnpm pack:cindy
 *   pnpm pack:cindy --no-verify  # 跳过自动化测试，快速打包
 *   pnpm pack:cindy --no-sync    # 不自动同步到本地 Cindy 目录
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { zipSync } from 'fflate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const PLUGIN_DIR = path.resolve(REPO_ROOT, 'packages/cindy-plugin');
const GHOST_JSON_PATH = path.join(PLUGIN_DIR, 'ghost.json');

const args = process.argv.slice(2);
const skipVerify = args.includes('--no-verify') || args.includes('--fast');
const skipSync = args.includes('--no-sync');

// 黑名单规则 (相对于 PLUGIN_DIR 的相对路径匹配)
const IGNORE_PATTERNS = [
  /\.cindy$/i,                     // 排除已生成的 cindy 安装包
  /^test-[^/]+\.mjs$/i,            // 排除根目录测试脚本
  /\.test\.[a-z0-9]+$/i,           // 排除测试代码
  /(?:^|\/)__tests__(?:\/|$)/,     // 排除测试目录
  /(?:^|\/)\.DS_Store$/,           // macOS 系统文件
  /(?:^|\/)Thumbs\.db$/i,          // Windows 缩略图缓存
  /(?:^|\/)desktop\.ini$/i,        // Windows 桌面配置
  /(?:^|\/)\.git/,                 // Git 目录及文件
  /(?:^|\/)node_modules(?:\/|$)/,  // 依赖缓存
  /(?:^|\/)\.cindy-trust\.json$/,  // 本地临时签名元数据
  /\.(?:tmp|log|bak)$/i            // 临时与日志文件
];

function shouldIgnore(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  return IGNORE_PATTERNS.some(pattern => pattern.test(normalized));
}

function walkDir(dir, baseDir = dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (shouldIgnore(relPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, baseDir));
    } else if (entry.isFile()) {
      results.push({ fullPath, relPath });
    }
  }

  return results;
}

function findCindyLocalInstallDirs(pluginId) {
  const dirs = [];
  let baseOwnersDir = null;

  if (process.platform === 'darwin') {
    baseOwnersDir = path.join(os.homedir(), 'Library/Application Support/Cindy/owners');
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    baseOwnersDir = path.join(appData, 'Cindy', 'owners');
  }

  if (baseOwnersDir && fs.existsSync(baseOwnersDir)) {
    try {
      const owners = fs.readdirSync(baseOwnersDir);
      for (const owner of owners) {
        const candidate1 = path.join(baseOwnersDir, owner, 'cindy-brain', pluginId);
        if (fs.existsSync(candidate1) && fs.statSync(candidate1).isDirectory()) {
          dirs.push(candidate1);
        }
        const candidate2 = path.join(baseOwnersDir, owner, 'cindy-brain/_ns/_root', pluginId);
        if (fs.existsSync(path.join(baseOwnersDir, owner, 'cindy-brain/_ns/_root'))) {
          dirs.push(candidate2);
        } else if (fs.existsSync(candidate2) && fs.statSync(candidate2).isDirectory()) {
          dirs.push(candidate2);
        }
      }
    } catch {}
  }

  return dirs;
}

async function main() {
  console.log('📦 [Cindy Plugin Packager] 准备构建 Cindy 插件包...\n');

  if (!fs.existsSync(GHOST_JSON_PATH)) {
    console.error(`❌ 未找到插件配置文件: ${GHOST_JSON_PATH}`);
    process.exit(1);
  }

  // 1. 读取 ghost.json 元数据
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(GHOST_JSON_PATH, 'utf-8'));
  } catch (err) {
    console.error(`❌ 解析 ghost.json 失败: ${err.message}`);
    process.exit(1);
  }

  const pluginId = manifest.id || 'xiaochun-companion';
  const version = manifest.version || '1.0.0';
  const pluginName = manifest.name || '小蠢 AI 伴侣';
  const outputFileName = `${pluginId}-${version}.cindy`;
  const outputPath = path.join(PLUGIN_DIR, outputFileName);

  console.log(`📌 插件标识: ${pluginId}`);
  console.log(`🏷️  插件名称: ${pluginName}`);
  console.log(`🔢 版本编号: v${version}`);
  console.log(`📂 源码目录: ${PLUGIN_DIR}\n`);

  // 2. 前置测试验证
  if (!skipVerify) {
    const testScript = path.join(PLUGIN_DIR, 'test-plugin.mjs');
    if (fs.existsSync(testScript)) {
      console.log('🧪 正在执行打包前置规格自检 (test-plugin.mjs)...');
      try {
        execSync(`node "${testScript}"`, { stdio: 'inherit', cwd: REPO_ROOT });
        console.log('');
      } catch (err) {
        console.error('❌ 前置规范测试未通过，已终止打包流程以防产出异常包。');
        process.exit(1);
      }
    }
  } else {
    console.log('⚡ 跳过前置自动化自检 (--no-verify)\n');
  }

  // 3. 递归检索全部文件
  console.log('🔍 正在检索插件包内的所有有效文件...');
  const files = walkDir(PLUGIN_DIR);
  if (files.length === 0) {
    console.error('❌ 未在 packages/cindy-plugin 中找到任何有效文件！');
    process.exit(1);
  }

  // 4. 构建压缩结构对象
  const zipEntries = {};
  let totalRawBytes = 0;
  console.log(`📋 包含文件列表 (共 ${files.length} 个):`);

  // 按字母序排序，保证打包二进制跨构建幂等
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));

  for (const { fullPath, relPath } of files) {
    let content = fs.readFileSync(fullPath);
    // 确保打进包内的 bridge-port.json 始终是标准预留端口 23518，防止测试时的临时端口泄露到安装包
    if (relPath === 'bridge-port.json') {
      content = Buffer.from(JSON.stringify({ port: 23518, timestamp: 1793630000000 }, null, 2));
    }
    totalRawBytes += content.length;
    zipEntries[relPath] = new Uint8Array(content);
    console.log(`   + ${relPath} (${(content.length / 1024).toFixed(1)} KB)`);
  }

  // 5. 执行高效压缩打包 (fflate level 9)
  console.log('\n🗜️  正在压缩并生成 .cindy 归档...');
  const zippedBuffer = zipSync(zipEntries, { level: 9 });
  fs.writeFileSync(outputPath, Buffer.from(zippedBuffer));

  const compressedBytes = zippedBuffer.byteLength;
  const ratio = ((1 - compressedBytes / totalRawBytes) * 100).toFixed(1);

  console.log(`\n🎉 [Success] 打包完成！`);
  console.log(`📁 产物文件: ${outputPath}`);
  console.log(`📊 产物体积: ${(compressedBytes / 1024).toFixed(1)} KB (原始: ${(totalRawBytes / 1024).toFixed(1)} KB，压缩率: ${ratio}%)`);

  // 6. 若本地已安装 Cindy，自动同步更新到开发目录
  if (!skipSync) {
    const localInstallDirs = findCindyLocalInstallDirs(pluginId);
    if (localInstallDirs.length > 0) {
      console.log('\n🔄 检测到本地 Cindy 插件安装目录，正在同步最新源码...');
      for (const destDir of localInstallDirs) {
        try {
          for (const { fullPath, relPath } of files) {
            const destPath = path.join(destDir, relPath);
            const destParent = path.dirname(destPath);
            if (!fs.existsSync(destParent)) fs.mkdirSync(destParent, { recursive: true });
            fs.copyFileSync(fullPath, destPath);
          }
          console.log(`   ✅ 成功同步到: ${destDir}`);
        } catch (syncErr) {
          console.warn(`   ⚠️ 同步至 ${destDir} 失败 (非致命): ${syncErr.message}`);
        }
      }
    }
  }

  console.log('\n💡 提示: 可以在 Cindy 中直接拖拽该 .cindy 文件，或双击导入以安装最新版本。\n');
}

main().catch(err => {
  console.error('❌ 打包过程遇到异常:', err);
  process.exit(1);
});
