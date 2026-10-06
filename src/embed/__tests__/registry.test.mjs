// node --test (Node >= 22.18 / 24 直接 import .ts): pnpm test:embed
// 用 .mjs 而不是 .ts: 主仓库 tsconfig 覆盖 src 且没有 @types/node, 测试文件放进去会让 tsc 报错。
import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OUTFIT_SIZE_MB, defaultOutfitId, listOutfits, listScenes, embedSceneFromSearch, ownEntry, parseControls, readOutfitPref, resolveInitialOutfit, resolveInitialOutfitWithPref, safeLocalStorage, writeOutfitPref } from '../registry.ts';

const addons = {
  xiaochun_maid: { source: '/a', name: 'Maid' },
  xiaochun_dinner_dress: { source: '/b', name: 'Dinner', default: true },
};
const scenes = { light: { isTransparent: false }, dark: { isTransparent: false }, transparent: { isTransparent: true }, beach3d: { isTransparent: false } };

test('ownEntry: 合法 id 命中', () => {
  assert.equal(ownEntry(addons, 'xiaochun_maid')?.name, 'Maid');
  assert.equal(ownEntry(scenes, 'transparent')?.isTransparent, true);
});

test('ownEntry: 原型键 / 非法格式 / 非字符串一律 null', () => {
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype', 'isPrototypeOf',
    '', 'Xiaochun_maid', 'xiaochun-maid', 'a b', '../x', 'x'.repeat(65), 'base', 'unknown', 1, null, undefined, {}, ['xiaochun_maid']]) {
    assert.equal(ownEntry(addons, bad), null, String(bad));
    assert.equal(ownEntry(scenes, bad), null, String(bad));
  }
});

test('ownEntry: 对象以 null 原型 / 带自有 __proto__ 键也不误判', () => {
  const evil = JSON.parse('{"__proto__":{"source":"x","name":"x"},"ok_one":{"source":"/o","name":"O"}}');
  assert.equal(ownEntry(evil, '__proto__'), null); // 正则先挡
  assert.equal(ownEntry(evil, 'ok_one')?.name, 'O');
});

test('裸模 base 不在服装表里, 任何入口都拿不到', () => {
  assert.equal(ownEntry(addons, 'base'), null);
  assert.deepEqual(listOutfits(addons).map((o) => o.id), ['xiaochun_maid', 'xiaochun_dinner_dress']);
  assert.ok(!listOutfits(addons).some((o) => o.id === 'base'));
});

test('defaultOutfitId / resolveInitialOutfit: 非法或缺省回退默认', () => {
  assert.equal(defaultOutfitId(addons), 'xiaochun_dinner_dress');
  assert.equal(defaultOutfitId({ a_x: { source: '/', name: 'x' } }), 'a_x');
  assert.equal(defaultOutfitId({}), null);
  assert.equal(resolveInitialOutfit(addons, 'xiaochun_maid')?.id, 'xiaochun_maid');
  for (const bad of [null, undefined, '', 'constructor', '__proto__', 'base', 'nope', 'XIAOCHUN_MAID']) {
    assert.equal(resolveInitialOutfit(addons, bad)?.id, 'xiaochun_dinner_dress', String(bad));
  }
  assert.equal(resolveInitialOutfit({}, 'x'), null);
});

test('listScenes: transparent 标志', () => {
  assert.deepEqual(listScenes(scenes), [
    { id: 'light', transparent: false },
    { id: 'dark', transparent: false },
    { id: 'transparent', transparent: true },
    { id: 'beach3d', transparent: false },
  ]);
});

test('?ui= 解析: 部件名白名单; 默认空; 旧 1/true 映射为 chat+bubble 并标 legacy; 未知项/原型键忽略', async () => {
  const { parseXcUiParam, parseXcUiList, normalizeXcUiOption, XC_UI_PARTS } = await import('../../../packages/project-xiaochun/src/protocol.ts');
  assert.deepEqual([...XC_UI_PARTS], ['chat', 'bubble', 'outfit', 'scene', 'lang', 'github']);
  for (const v of [null, undefined, '', '0', 'false', ' ']) assert.deepEqual(parseXcUiParam(v), { parts: [], unknown: [], legacy: false }, String(v));
  for (const v of ['1', 'true', 'TRUE']) assert.deepEqual(parseXcUiParam(v), { parts: ['chat', 'bubble'], unknown: [], legacy: true }, v);
  assert.deepEqual(parseXcUiParam('outfit,scene').parts, ['outfit', 'scene']);
  assert.deepEqual(parseXcUiParam('scene,outfit,chat').parts, ['chat', 'outfit', 'scene']); // 固定顺序
  assert.deepEqual(parseXcUiParam(' Chat , OUTFIT ,, outfit').parts, ['chat', 'outfit']); // 大小写/空格/重复
  const r = parseXcUiParam('outfit,constructor,__proto__,toString,x'.concat(',', 'a'.repeat(100)));
  assert.deepEqual(r.parts, ['outfit']);
  assert.equal(r.unknown.length, 5);
  assert.ok(r.unknown.every((u) => u.length <= 40));
  assert.equal(r.legacy, false);
  assert.deepEqual(parseXcUiList(['scene', 7, null, {}, 'nope']).parts, ['scene']);
  assert.deepEqual(parseXcUiList(['scene', 7, null, {}, 'nope']).unknown, ['number', 'object', 'object', 'nope']);
  assert.deepEqual(normalizeXcUiOption(true), { parts: ['chat', 'bubble'], unknown: [], legacy: true });
  assert.deepEqual(normalizeXcUiOption(false).parts, []);
  assert.deepEqual(normalizeXcUiOption(undefined).parts, []);
  assert.deepEqual(normalizeXcUiOption(['outfit']).parts, ['outfit']);
  assert.deepEqual(normalizeXcUiOption('outfit').parts, []); // 字符串不是合法选项形态
});

test('listOutfits: 带 sizeMB 提示 (未知服装没有该字段, 不含 base)', () => {
  const list = listOutfits({ xiaochun_wedding: { source: '/w', name: 'W' }, mystery: { source: '/m', name: 'M' } });
  assert.deepEqual(list, [{ id: 'xiaochun_wedding', name: 'W', sizeMB: 13.9 }, { id: 'mystery', name: 'M' }]);
  assert.ok(!list.some((o) => o.id === 'base'));
});

test('OUTFIT_SIZE_MB 与磁盘上的 vrmaddon 文件大小一致 (±0.1MB); 文件变了请更新常量', () => {
  for (const [id, mb] of Object.entries(OUTFIT_SIZE_MB)) {
    const f = fileURLToPath(new URL(`../../../public/vrm/addons/${id}.vrmaddon`, import.meta.url));
    const real = statSync(f).size / 1e6;
    assert.ok(Math.abs(real - mb) <= 0.1, `${id}: 常量 ${mb} vs 实际 ${real.toFixed(2)}`);
  }
});

test('parseControls: 默认放开滚轮缩放, 只有 0 / false 才锁', () => {
  assert.equal(parseControls(null), true);
  assert.equal(parseControls(undefined), true);
  assert.equal(parseControls(''), true);
  assert.equal(parseControls('1'), true);
  assert.equal(parseControls('true'), true);
  assert.equal(parseControls('0'), false);
  assert.equal(parseControls('false'), false);
});

test('embedSceneFromSearch: scene > transparent=1 > theme; 非法 / 缺省 → null (vrmEngine 与 sceneManager 共用)', () => {
  assert.equal(embedSceneFromSearch('?scene=transparent'), 'transparent');
  assert.equal(embedSceneFromSearch('?ui=chat,outfit,scene&scene=transparent&controls=1'), 'transparent');
  assert.equal(embedSceneFromSearch('?scene=light'), 'light');
  assert.equal(embedSceneFromSearch('?scene=beach'), null); // 2D beach 已移除
  assert.equal(embedSceneFromSearch('?scene=beach3d'), 'beach3d');
  assert.equal(embedSceneFromSearch('?scene=beach3d&transparent=1'), 'beach3d'); // scene 优先; beach3d 不透明
  assert.equal(embedSceneFromSearch('?scene=Beach3D'), null); // 严格小写
  assert.equal(embedSceneFromSearch('?scene=dark&transparent=1'), 'dark'); // scene 优先
  assert.equal(embedSceneFromSearch('?transparent=1'), 'transparent');
  assert.equal(embedSceneFromSearch('?transparent=1&theme=dark'), 'transparent');
  assert.equal(embedSceneFromSearch('?theme=dark'), 'dark');
  assert.equal(embedSceneFromSearch('?theme=transparent'), null); // 旧 theme 参数不接受 transparent
  for (const bad of ['', '?scene=', '?scene=constructor', '?scene=__proto__', '?scene=Dark', '?scene=pink', '?transparent=0', '?theme=x']) assert.equal(embedSceneFromSearch(bad), null, bad);
});

// ── iframe 自己的偏好存储 ──
const ADDONS = { xiaochun_dinner_dress: { source: '/d', name: 'D', default: true }, xiaochun_maid: { source: '/m', name: 'M' }, xiaochun_bikini: { source: '/b', name: 'B' } };
const fakeStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), _m: m };
};
const KEY = 'xiaochun_wearing_outfit';

test('readOutfitPref: 白名单里的 id 才认; 坏数据 (原型键 / 未知 / 非法格式 / base) 忽略并清掉', () => {
  assert.equal(readOutfitPref(fakeStorage({ [KEY]: 'xiaochun_maid' }), KEY, ADDONS), 'xiaochun_maid');
  assert.equal(readOutfitPref(fakeStorage(), KEY, ADDONS), null);
  assert.equal(readOutfitPref(null, KEY, ADDONS), null);
  for (const bad of ['constructor', '__proto__', 'toString', 'xiaochun_gone', 'base', '', 'A B', 'x'.repeat(100)]) {
    const st = fakeStorage({ [KEY]: bad });
    assert.equal(readOutfitPref(st, KEY, ADDONS), null, bad);
    assert.equal(st.getItem(KEY), null, `坏数据应被清掉: ${bad}`);
  }
});

test('readOutfitPref / writeOutfitPref: 存储抛错 (被分区 / 拦截 / 配额满) 时静默回退, 不抛', () => {
  const boom = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); }, removeItem() { throw new Error('x'); } };
  assert.equal(readOutfitPref(boom, KEY, ADDONS), null);
  assert.doesNotThrow(() => writeOutfitPref(boom, KEY, 'xiaochun_maid'));
  assert.doesNotThrow(() => writeOutfitPref(null, KEY, 'xiaochun_maid'));
});

test('safeLocalStorage: 访问 localStorage 本身抛错 / 不存在时返回 null', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    delete globalThis.localStorage;
    assert.equal(safeLocalStorage(), null); // 不存在
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError: denied'); } });
    assert.equal(safeLocalStorage(), null); // 访问就抛
  } finally {
    delete globalThis.localStorage;
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
  }
});

test('resolveInitialOutfitWithPref: 显式 > 存的 > 默认; 显式非法不回头用存的; 存的非法 (已被 readOutfitPref 过滤) 退回默认', () => {
  assert.equal(resolveInitialOutfitWithPref(ADDONS, 'xiaochun_bikini', 'xiaochun_maid').id, 'xiaochun_bikini');
  assert.equal(resolveInitialOutfitWithPref(ADDONS, null, 'xiaochun_maid').id, 'xiaochun_maid');
  assert.equal(resolveInitialOutfitWithPref(ADDONS, null, null).id, 'xiaochun_dinner_dress');
  assert.equal(resolveInitialOutfitWithPref(ADDONS, 'constructor', 'xiaochun_maid').id, 'xiaochun_dinner_dress'); // 显式非法 => 默认
  assert.equal(resolveInitialOutfitWithPref(ADDONS, undefined, 'xiaochun_maid').id, 'xiaochun_maid');
  assert.equal(resolveInitialOutfitWithPref(ADDONS, null, 'nope').id, 'xiaochun_dinner_dress');
});

test('写回再读回', () => {
  const st = fakeStorage();
  writeOutfitPref(st, KEY, 'xiaochun_bikini');
  assert.equal(readOutfitPref(st, KEY, ADDONS), 'xiaochun_bikini');
});
