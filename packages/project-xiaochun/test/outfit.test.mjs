// 换装 / 换场景协议的构建产物测试 (node --test, 不需要浏览器): 先 `pnpm build` 再跑。
// 覆盖: 命令/事件声明与实现一致 (capabilities 协商的基础)、id 白名单格式、原型键。
// 行为级 (握手协商 / 串行 / 穿透同步 / persist) 见 test/browser/outfit-harness.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esm = await import('../dist/index.js');
const cjs = require('../dist/index.cjs');

test('协议仍是 v1 (新增走 capabilities 协商, 不升版本)', () => {
  assert.equal(esm.XC_PROTOCOL_VERSION, 1);
  assert.ok(esm.isXcEnvelope(esm.xcMessage('xc.setOutfit', { id: 'xiaochun_maid' }, 'c1')));
});

test('新命令 / 新事件: 已声明, 命令已实现, 名字无重复', () => {
  for (const c of ['xc.setOutfit', 'xc.setScene', 'xc.prefetch']) {
    assert.ok(esm.XC_HOST_TO_FRAME.includes(c), c);
    assert.ok(esm.XC_IMPLEMENTED_COMMANDS.includes(c), c);
    assert.ok(!esm.XC_UNSUPPORTED_COMMANDS.includes(c), c);
  }
  for (const e of ['xc.outfit-changed', 'xc.scene-changed', 'xc.prefetched']) assert.ok(esm.XC_FRAME_TO_HOST.includes(e), e);
  const all = [...esm.XC_HOST_TO_FRAME, ...esm.XC_FRAME_TO_HOST];
  assert.equal(new Set(all).size, all.length);
});

test('旧命令不受影响 (向后兼容: 老 SDK / 老 iframe 的命令集是新集合的子集)', () => {
  const legacy = ['xc.init', 'xc.say', 'xc.audio', 'xc.audio.chunk', 'xc.audio.end', 'xc.motion', 'xc.expression', 'xc.lookAt',
    'xc.pointer', 'xc.setModel', 'xc.setConfig', 'xc.mic', 'xc.pause', 'xc.resume', 'xc.destroy'];
  for (const c of legacy) assert.ok(esm.XC_HOST_TO_FRAME.includes(c), c);
  for (const e of ['xc.ready', 'xc.load.progress', 'xc.loaded', 'xc.state', 'xc.stt', 'xc.utterance', 'xc.hit-region', 'xc.error']) {
    assert.ok(esm.XC_FRAME_TO_HOST.includes(e), e);
  }
});

test('isXcId: 只放行 /^[a-z][a-z0-9_]{0,63}$/', () => {
  for (const ok of ['xiaochun_maid', 'light', 'dark', 'transparent', 'a', 'a1_b2', 'x'.repeat(64)]) assert.equal(esm.isXcId(ok), true, ok);
  for (const bad of ['', 'X', 'Light', '1abc', '_a', 'a-b', 'a b', 'a.b', '../etc', 'a/b', '__proto__', 'x'.repeat(65), 'é', 'a\n', ' a', 'a ']) {
    assert.equal(esm.isXcId(bad), false, JSON.stringify(bad));
  }
  for (const bad of [null, undefined, 1, true, {}, [], ['light'], () => 'light']) assert.equal(esm.isXcId(bad), false);
});

test('xcHasOwn: 原型键不是自有键 (constructor / toString / hasOwnProperty 等)', () => {
  const table = { light: 1, dark: 2 };
  assert.equal(esm.xcHasOwn(table, 'light'), true);
  for (const k of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__', 'isPrototypeOf', 'nope']) {
    assert.equal(esm.xcHasOwn(table, k), false, k);
  }
  // 经典陷阱: 表里有自己的 hasOwnProperty 键时也不被劫持
  assert.equal(esm.xcHasOwn({ hasOwnProperty: 1 }, 'hasOwnProperty'), true);
  // 合法 id 里的原型键名 (constructor 符合正则) 必须被查表挡掉
  assert.equal(esm.isXcId('constructor') && !esm.xcHasOwn(table, 'constructor'), true);
});

test('ESM / CJS 导出仍一致', () => {
  assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
  for (const k of ['isXcId', 'xcHasOwn', 'XC_ID_RE']) assert.ok(k in esm, k);
});
