// React 绑定的服务端 / 构建产物测试 (node --test, 不需要浏览器): 先 `pnpm build` 再跑。
// 重点: SSR 安全 —— 在没有 window / document 的 Node 里渲染不能抛错, 且服务端输出是固定尺寸的空 div。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

const require = createRequire(import.meta.url);
assert.equal(typeof window, 'undefined', 'this test must run without a DOM');
const esm = await import('../dist/react.js');
const cjs = require('../dist/react.cjs');

test('react 入口: ESM / CJS 导出一致', () => {
  assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
  assert.ok(esm.Xiaochun && esm.useXiaochun);
});

test("react 入口保留 'use client' 指令, 且不把 react 打进包里", () => {
  for (const f of ['react.js', 'react.cjs']) {
    const src = readFileSync(new URL(`../dist/${f}`, import.meta.url), 'utf8');
    assert.match(src, /^(\/\*[\s\S]*?\*\/\s*)?(["']use strict["'];\s*)?["']use client["']/, `${f} 开头缺少 'use client'`);
    assert.ok(!/__SECRET_INTERNALS|react\.element|react-jsx/.test(src), `${f} 疑似内联了 react`);
  }
});

test('SSR: 无 window 时渲染固定尺寸的空 div (无 CLS, 无 hydration 差异)', () => {
  const html = renderToString(createElement(esm.Xiaochun, { width: 300, height: '40vh', className: 'x', style: { border: '1px solid red' }, onReady() {} }));
  assert.match(html, /^<div /);
  assert.match(html, /width:300px/);
  assert.match(html, /height:40vh/);
  assert.match(html, /class="x"/);
  assert.match(html, /data-xiaochun-host/);
  assert.ok(!html.includes('<iframe'), '服务端不应渲染 iframe');
  // 默认尺寸
  assert.match(renderToString(createElement(esm.Xiaochun)), /width:320px;height:480px/);
});

test('SSR: useXiaochun 在服务端返回空状态', () => {
  let seen;
  function C() { seen = esm.useXiaochun({ width: 100, height: 100 }); return null; }
  renderToString(createElement(C));
  assert.equal(seen.client, null);
  assert.equal(seen.ready, false);
  assert.equal(seen.state, null);
  assert.equal(typeof seen.containerRef, 'function');
});
