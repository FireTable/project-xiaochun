// 窗口圆角半径: Tauri (main.css 的 --xc-window-radius) 与 /embed SDK 默认外壳圆角 (XC_WINDOW_CORNER_RADIUS) 必须是同一个值。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const css = read('../../styles/main.css');
const proto = read('../../../packages/project-xiaochun/src/protocol.ts');

test('main.css 的 --xc-window-radius 等于 SDK 的 XC_WINDOW_CORNER_RADIUS', () => {
  const c = css.match(/--xc-window-radius:\s*(\d+)px/);
  const p = proto.match(/XC_WINDOW_CORNER_RADIUS\s*=\s*(\d+)/);
  assert.ok(c && p, '两处常量都要存在');
  assert.equal(Number(c[1]), Number(p[1]));
});

test('is-tauri 的圆角规则都引用这个变量 (没有残留的 20px 字面量)', () => {
  assert.doesNotMatch(css, /border-radius:\s*20px\s*!important/);
});
