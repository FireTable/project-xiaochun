// 内置界面 (lang / github 部件、uiAutoHide 显示策略、xc.lang-changed) 的构建产物测试 (node --test, 不需要浏览器): 先 `pnpm build` 再跑。
// 行为级 (iframe 里真的隐藏 / 点击出现 / 语言切换) 见 test/browser/embed-e2e.mjs;
// SDK 把选项写进 iframe URL 见 test/browser/outfit-harness.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esm = await import('../dist/index.js');
const cjs = require('../dist/index.cjs');
const protocol = await import('../dist/protocol.js');

test('ui 部件白名单含 lang / github, 顺序固定, ESM / CJS 一致', () => {
  assert.deepEqual([...esm.XC_UI_PARTS], ['chat', 'bubble', 'outfit', 'scene', 'lang', 'github']);
  assert.deepEqual([...cjs.XC_UI_PARTS], [...esm.XC_UI_PARTS]);
  assert.deepEqual(esm.normalizeXcUiOption(['github', 'lang', 'outfit', 'nope']).parts, ['outfit', 'lang', 'github']);
  assert.deepEqual(esm.normalizeXcUiOption(['github', 'nope']).unknown, ['nope']);
  assert.deepEqual(esm.parseXcUiParam('lang,github').parts, ['lang', 'github']);
  // 旧写法 ui=1 的含义不变 (只有 chat + bubble, 不会自动多出 lang / github)
  assert.deepEqual(esm.parseXcUiParam('1').parts, ['chat', 'bubble']);
});

test('uiAutoHide: 默认 transparent (与 Tauri 一致); 解析 1/true/0/false/transparent, 非法 → undefined', () => {
  assert.equal(esm.XC_UI_AUTOHIDE_DEFAULT, 'transparent');
  for (const [raw, want] of [['1', true], ['true', true], [' TRUE ', true], ['0', false], ['false', false], ['transparent', 'transparent'], [true, true], [false, false]]) {
    assert.equal(esm.parseXcUiAutoHide(raw), want, String(raw));
  }
  for (const bad of [undefined, null, '', 'yes', 'hover', 2, {}, []]) assert.equal(esm.parseXcUiAutoHide(bad), undefined, String(bad));
});

test('uiAutoHide 在场景里是否生效: transparent 只管透明场景; true 全部; false 都不', () => {
  assert.equal(esm.xcUiAutoHideActive('transparent', true), true);
  assert.equal(esm.xcUiAutoHideActive('transparent', false), false);
  assert.equal(esm.xcUiAutoHideActive(true, false), true);
  assert.equal(esm.xcUiAutoHideActive(true, true), true);
  assert.equal(esm.xcUiAutoHideActive(false, true), false);
  assert.equal(esm.xcUiAutoHideActive(false, false), false);
});

test('xc.lang-changed 已声明; 语言白名单 = zh-CN / en / ja', () => {
  assert.ok(esm.XC_FRAME_TO_HOST.includes('xc.lang-changed'));
  assert.ok(!esm.XC_HOST_TO_FRAME.includes('xc.lang-changed'));
  assert.deepEqual([...esm.XC_LANGS], ['zh-CN', 'en', 'ja']);
  assert.deepEqual([...protocol.XC_LANGS], [...esm.XC_LANGS]);
});
