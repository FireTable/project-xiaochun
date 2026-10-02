// 构建产物冒烟测试 (node --test): 先 `pnpm build` 再跑。不需要浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const esm = await import('../dist/index.js');
const cjs = require('../dist/index.cjs');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('ESM / CJS 导出一致', () => {
  assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
  for (const k of ['createXiaochun', 'defineXiaochunElement', 'XC_PROTOCOL_VERSION', 'normalizeOrigin']) {
    assert.ok(k in esm, `missing export ${k}`);
  }
});

test('协议: 所有消息名以 xc. 开头且无重复', () => {
  const all = [...esm.XC_HOST_TO_FRAME, ...esm.XC_FRAME_TO_HOST];
  assert.ok(all.every((t) => t.startsWith('xc.')));
  assert.equal(new Set(all).size, all.length);
});

test('协议: implemented ∪ unsupported ⊆ host→frame, 且互斥', () => {
  const host = new Set(esm.XC_HOST_TO_FRAME);
  for (const c of [...esm.XC_IMPLEMENTED_COMMANDS, ...esm.XC_UNSUPPORTED_COMMANDS]) assert.ok(host.has(c), c);
  const impl = new Set(esm.XC_IMPLEMENTED_COMMANDS);
  for (const c of esm.XC_UNSUPPORTED_COMMANDS) assert.ok(!impl.has(c), c);
});

test('normalizeOrigin: 拒绝通配 / 非 http(s), 去掉路径', () => {
  assert.equal(esm.normalizeOrigin('*'), null);
  assert.equal(esm.normalizeOrigin('null'), null);
  assert.equal(esm.normalizeOrigin('javascript:alert(1)'), null);
  assert.equal(esm.normalizeOrigin('https://a.com/x?y=1'), 'https://a.com');
  assert.equal(esm.normalizeOrigin('http://localhost:5173'), 'http://localhost:5173');
});

test('isXcEnvelope / xcMessage', () => {
  const m = esm.xcMessage('xc.say', { text: 'hi' }, 'c1');
  assert.ok(esm.isXcEnvelope(m));
  assert.ok(!esm.isXcEnvelope({ type: 'say', v: 1 }));
  assert.ok(!esm.isXcEnvelope({ type: 'xc.say', v: 999 }));
});

test('SSR 安全: 无 DOM 时 import 不抛, createXiaochun 给出明确错误', () => {
  assert.equal(esm.defineXiaochunElement(), null);
  assert.throws(() => esm.createXiaochun({ container: '#x' }), /browser/);
});

test('包元数据', () => {
  assert.equal(pkg.publishConfig.access, 'public');
  assert.ok(pkg.exports['.'].types && pkg.exports['.'].import && pkg.exports['.'].require);
  assert.match(pkg.version, /^\d+\.\d+\.\d+/);
});

test('toProtocolUrl / parseProtocolUrl: speak 往返 + audioUrl 校验', () => {
  const u = esm.toProtocolUrl({ action: 'speak', text: '你好 世界&=', audioUrl: 'https://a.com/x.mp3?k=1' });
  assert.ok(u.startsWith('xiaochun://speak?'));
  assert.ok(!u.includes('+'));
  assert.deepEqual(esm.parseProtocolUrl(u), { action: 'speak', text: '你好 世界&=', audioUrl: 'https://a.com/x.mp3?k=1' });
  assert.deepEqual(esm.parseProtocolUrl('xiaochun://action?action=speak&text=hi'), { action: 'speak', text: 'hi' });
  assert.deepEqual(esm.parseProtocolUrl('xiaochun:///speak?text=hi'), { action: 'speak', text: 'hi' });
  assert.equal(esm.parseProtocolUrl('https://a.com'), null);
  assert.equal(esm.parseProtocolUrl('xiaochun://dance?x=1'), null);
  assert.throws(() => esm.toProtocolUrl({ action: 'speak' }));
  assert.throws(() => esm.toProtocolUrl({ action: 'speak', audioUrl: 'file:///etc/passwd' }));
});

test('协议: xc.audio 命令已声明且实现; 映射表只引用已声明命令', () => {
  for (const c of ['xc.audio', 'xc.audio.chunk', 'xc.audio.end']) {
    assert.ok(esm.XC_HOST_TO_FRAME.includes(c), c);
    assert.ok(esm.XC_IMPLEMENTED_COMMANDS.includes(c), c);
  }
  for (const m of esm.XC_PROTOCOL_MAPPING) assert.ok(esm.XC_HOST_TO_FRAME.includes(m.xc.split(' ')[0]), m.xc);
});
