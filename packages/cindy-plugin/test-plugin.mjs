// test-plugin.mjs - 严格核验 Cindy 官方插件规范与功能完整性
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = __dirname;

console.log('🚀 [Cindy Plugin Check] 开始对 packages/cindy-plugin 进行规范核验...\n');

// 1. 读取并校验 ghost.json
const manifestPath = path.join(pluginDir, 'ghost.json');
assert.ok(fs.existsSync(manifestPath), 'ghost.json 必须存在');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

console.log('1️⃣ 校验 manifest 基础字段与 Schema v3:');
assert.equal(manifest.schemaVersion, 3, 'schemaVersion 必须为 3');
assert.ok(/^[a-z0-9-]+$/.test(manifest.id), 'id 必须为小写字母、数字或连字符');
assert.ok(manifest.name && manifest.name.length <= 64, 'name 长度不能超过 64 字符');
assert.ok(manifest.description && manifest.description.length <= 300, 'description 长度不能超过 300 字符');
assert.ok(manifest.whenToUse && manifest.whenToUse.length <= 300, 'whenToUse 长度不能超过 300 字符');
assert.ok(manifest.version, '必须有 version 字段');
assert.ok(manifest.minCindyVersion, '必须有 minCindyVersion 字段');
assert.ok(manifest.entry, '必须有 entry 字段');
assert.ok(manifest.icon, '必须有 icon 字段');
assert.ok(manifest.node && manifest.node.entry, '必须有 node.entry 声明');
console.log('   ✅ 基础元信息合规 (id, name, version, minCindyVersion, node)');

// 2. 校验文件存在性与大小
console.log('2️⃣ 校验引用的物理文件与体积约束:');
const entryPath = path.join(pluginDir, manifest.entry);
assert.ok(fs.existsSync(entryPath), `entry 入口文件不存在: ${manifest.entry}`);

const nodeEntryPath = path.join(pluginDir, manifest.node.entry);
assert.ok(fs.existsSync(nodeEntryPath), `node.entry 入口文件不存在: ${manifest.node.entry}`);

const iconPath = path.join(pluginDir, manifest.icon);
assert.ok(fs.existsSync(iconPath), `icon 图标不存在: ${manifest.icon}`);
const iconSize = fs.statSync(iconPath).size;
assert.ok(iconSize <= 512 * 1024, `icon 大小超过 512KB (当前: ${(iconSize / 1024).toFixed(1)}KB)`);
console.log(`   ✅ 核心文件均存在，图标体积合规 (${(iconSize / 1024).toFixed(1)}KB)`);

if (manifest.panel) {
  const panelRel = typeof manifest.panel === 'string'
    ? manifest.panel
    : (manifest.panel.html || manifest.panel.entry || manifest.panel.path);
  assert.ok(panelRel, 'manifest.panel 必须指定 html 或 entry 文件路径');
  const panelPath = path.join(pluginDir, panelRel);
  assert.ok(fs.existsSync(panelPath), `panel 入口文件不存在: ${panelRel}`);
  assert.ok(manifest.panel.title, 'manifest.panel 必须包含 title');
  if (manifest.panel.position) {
    assert.ok(['left', 'right', 'top', 'bottom', 'tab'].includes(manifest.panel.position), `panel.position 必须是 left, right, top, bottom 或 tab (当前: ${manifest.panel.position})`);
  }
  console.log(`   ✅ panel 内嵌视窗入口存在且合规 (${panelRel}, 标题: ${manifest.panel.title}, 停靠方向: ${manifest.panel.position || 'left'})`);
}

if (manifest.mainView) {
  assert.ok(manifest.mainView.html, 'manifest.mainView 必须指定 html 路径');
  const mainViewPath = path.join(pluginDir, manifest.mainView.html);
  assert.ok(fs.existsSync(mainViewPath), `mainView 文件不存在: ${manifest.mainView.html}`);
  const validIcons = ['puzzle', 'globe', 'code', 'folder', 'database', 'chart-column', 'image', 'message-circle', 'calendar-days'];
  if (manifest.mainView.icon) {
    assert.ok(validIcons.includes(manifest.mainView.icon), `mainView.icon 必须是 Cindy 官方图标之一: ${validIcons.join(', ')}`);
  }
  if (manifest.mainView.open === 'sidebar') {
    assert.ok(['left', 'right', 'top', 'bottom'].includes(manifest.mainView.side), 'mainView.side 必须是 left, right, top 或 bottom');
    console.log(`   ✅ mainView 声明右侧分屏伴读模式 (open: sidebar, side: ${manifest.mainView.side})`);
  }
  console.log(`   ✅ mainView 一级主视图入口存在且合规 (${manifest.mainView.html}, 图标: ${manifest.mainView.icon || 'puzzle'})`);
}

if (manifest.agent) {
  assert.equal(typeof manifest.agent.tasks, 'boolean', 'agent.tasks 必须为布尔值');
  if (manifest.agent.targets) {
    assert.equal(manifest.agent.tasks, true, 'agent.targets: true 时 agent.tasks 必须同时为 true');
  }
  console.log(`   ✅ agent 权限声明合规 (tasks: ${manifest.agent.tasks}, targets: ${manifest.agent.targets})`);
}

if (manifest.manual) {
  assert.ok(Array.isArray(manifest.manual.items), 'manual.items 必须是数组');
  for (const item of manifest.manual.items) {
    assert.ok(item.dir, 'manual item 必须包含 dir');
    assert.ok(item.name, 'manual item 必须包含 name');
    assert.ok(item.description, 'manual item 必须包含 description');
    const manualFile = path.join(pluginDir, item.dir, 'MANUAL.md');
    assert.ok(fs.existsSync(manualFile), `manual 必须包含 MANUAL.md 入口: ${manualFile}`);
  }
  console.log(`   ✅ manual 随包手册声明合规 (${manifest.manual.items.length} 篇手册完整)`);
}

if (manifest.preview) {
  assert.ok(Array.isArray(manifest.preview.hosts), 'manifest.preview.hosts 必须是数组');
  assert.ok(manifest.preview.hosts.includes('127.0.0.1'), 'preview.hosts 必须包含 127.0.0.1 以支持内嵌视窗安全 loopback');
  console.log('   ✅ preview 安全域名白名单声明合规:', manifest.preview.hosts);
}

// 3. 校验多语言国际化对齐 (zh-CN, en, ja, ko)
console.log('3️⃣ 校验四语国际化 (zh-CN, en, ja, ko) 字段对齐:');
const requiredLocales = ['zh-CN', 'en', 'ja', 'ko'];
assert.ok(manifest.locales, 'locales 声明必须存在');

const toolsInManifest = (manifest.tools || []).map(t => t.name);

for (const loc of requiredLocales) {
  const locRelPath = manifest.locales[loc];
  assert.ok(locRelPath, `locales 缺少语言映射: ${loc}`);
  const locAbsPath = path.join(pluginDir, locRelPath);
  assert.ok(fs.existsSync(locAbsPath), `语言文件不存在: ${locRelPath}`);
  
  const locData = JSON.parse(fs.readFileSync(locAbsPath, 'utf8'));
  assert.ok(locData.name, `${loc} 必须包含 name`);
  assert.ok(locData.description, `${loc} 必须包含 description`);
  assert.ok(locData.whenToUse, `${loc} 必须包含 whenToUse`);
  if (manifest.panel && manifest.panel.title) {
    assert.ok(locData.panel && locData.panel.title, `${loc} 必须包含 panel.title 国际化`);
  }
  if (manifest.mainView && manifest.mainView.title) {
    assert.ok(locData.mainView && locData.mainView.title, `${loc} 必须包含 mainView.title 国际化`);
  }
  assert.ok(locData.tools, `${loc} 必须包含 tools 对象`);

  for (const tName of toolsInManifest) {
    assert.ok(locData.tools[tName], `${loc} 缺少工具 ${tName} 的翻译`);
    assert.ok(locData.tools[tName].description, `${loc} 缺少工具 ${tName} 的 description`);
  }
  console.log(`   ✅ 语言包对齐通过: ${loc} (${toolsInManifest.length} 个工具完整对齐)`);
}

// 4. 测试 Node Worker 的 JSON-RPC stdio 管道响应
console.log('4️⃣ 测试 Node Worker 进程的通信与状态指令:');

async function testWorker() {
  const worker = spawn(process.execPath, [nodeEntryPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, XIAOCHUN_TEST_MODE: '1' }
  });

  let resolveResponse;
  let buffer = '';

  worker.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) {
        const json = JSON.parse(line.trim());
        if (resolveResponse) resolveResponse(json);
      }
    }
  });

  function sendReq(id, method, params) {
    return new Promise((resolve) => {
      resolveResponse = resolve;
      worker.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  // 4.1 测试 status 方法
  const statusRes = await sendReq(1, 'status', {});
  assert.equal(statusRes.id, 1);
  assert.ok(statusRes.result);
  console.log('   ✅ Node Worker 成功响应 status 方法:', statusRes.result);

  // 4.2 测试 stop 方法
  const stopRes = await sendReq(2, 'stop', {});
  assert.equal(stopRes.id, 2);
  assert.equal(stopRes.result.success, true);
  console.log('   ✅ Node Worker 成功响应 stop 方法');

  // 4.3 测试 scene 参数校验
  const sceneErr = await sendReq(3, 'scene', {});
  assert.equal(sceneErr.id, 3);
  assert.equal(sceneErr.error.code, -32602);
  console.log('   ✅ Node Worker 成功拦截非法 scene 参数');

  // 4.4 测试 outfit 参数校验
  const outfitErr = await sendReq(4, 'outfit', {});
  assert.equal(outfitErr.id, 4);
  assert.equal(outfitErr.error.code, -32602);
  console.log('   ✅ Node Worker 成功拦截非法 outfit 参数');

  // 4.5 测试 update 检查响应
  const updateRes = await sendReq(5, 'update', { mode: 'check' });
  assert.equal(updateRes.id, 5);
  assert.ok(updateRes.result);
  console.log('   ✅ Node Worker 成功响应 update 检查方法');

  // 4.6 测试形态切换与内嵌视窗派发
  const switchEmbedRes = await sendReq(6, 'bootstrap', { action: 'switch_mode', mode: 'embed' });
  assert.equal(switchEmbedRes.id, 6);
  assert.equal(switchEmbedRes.result.mode, 'embed');
  console.log('   ✅ Node Worker 成功切换至 embed 内嵌视窗模式');

  const embedMotionRes = await sendReq(7, 'motion', { name: 'greeting' });
  assert.equal(embedMotionRes.id, 7);
  assert.equal(embedMotionRes.result.mode, 'embed');
  assert.equal(embedMotionRes.result.target, 'panel');
  console.log('   ✅ Node Worker 在内嵌模式下成功将指令定向至 panel 桥接通道');

  const switchDesktopRes = await sendReq(8, 'bootstrap', { action: 'switch_mode', mode: 'desktop' });
  assert.equal(switchDesktopRes.id, 8);
  assert.equal(switchDesktopRes.result.mode, 'desktop');
  console.log('   ✅ Node Worker 成功切换回 desktop 桌面桌宠模式');

  worker.kill();
  console.log('\n🎉 [Success] packages/cindy-plugin 所有官方规范与自动化自测全部通过！');
}

testWorker().catch((err) => {
  console.error('\n❌ 校验失败:', err);
  process.exit(1);
});
