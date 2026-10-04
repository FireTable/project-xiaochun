// 宿主侧手势纯逻辑 (校验 / 序号闸门 / 几何限幅): node --test test/gesture.test.mjs (Node >= 22.18 直接 import .ts)
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RESIZE_LIMITS, GestureGate, MAX_GESTURE_DELTA, fitBox, moveBox, normalizeResizable, parseGesturePayload, resizeBox } from '../src/gesture-box.ts';

const VP = { width: 1000, height: 800 };
const box = { left: 100, top: 100, width: 320, height: 480 };
const L = normalizeResizable(true);

test('normalizeResizable: false/undefined 关闭, true 默认限幅, 对象覆盖且非法值回默认, min 不超 max', () => {
  assert.equal(normalizeResizable(false), null);
  assert.equal(normalizeResizable(undefined), null);
  assert.deepEqual(normalizeResizable(true), { minWidth: 120, minHeight: 180, maxWidth: Infinity, maxHeight: Infinity });
  assert.deepEqual(normalizeResizable({ minWidth: 200, maxWidth: 600 }), { minWidth: 200, minHeight: 180, maxWidth: 600, maxHeight: Infinity });
  assert.equal(normalizeResizable({ minWidth: -5, maxWidth: NaN }).minWidth, 120);
  assert.equal(normalizeResizable({ minWidth: 300, maxWidth: 100 }).maxWidth, 300);
  assert.ok(Object.isFrozen(DEFAULT_RESIZE_LIMITS));
});

test('moveBox: 跟手移动, 夹在视口内 (四个方向), 盒子比视口大时贴左上', () => {
  assert.deepEqual(moveBox(box, 50, -30, VP), { left: 150, top: 70, width: 320, height: 480 });
  assert.equal(moveBox(box, -9999, 0, VP).left, 0);
  assert.equal(moveBox(box, 0, -9999, VP).top, 0);
  assert.equal(moveBox(box, 9999, 0, VP).left, 1000 - 320);
  assert.equal(moveBox(box, 0, 9999, VP).top, 800 - 480);
  assert.deepEqual(moveBox({ left: 10, top: 10, width: 2000, height: 900 }, 100, 100, VP), { left: 0, top: 0, width: 2000, height: 900 });
});

test('resizeBox SE: 左上固定, 宽高跟手; 夹在 [min, 视口剩余空间]', () => {
  assert.deepEqual(resizeBox(box, 'SE', 40, 60, L, VP), { left: 100, top: 100, width: 360, height: 540 });
  const small = resizeBox(box, 'SE', -9999, -9999, L, VP);
  assert.deepEqual([small.width, small.height, small.left, small.top], [120, 180, 100, 100]);
  const big = resizeBox(box, 'SE', 9999, 9999, L, VP);
  assert.deepEqual([big.width, big.height], [1000 - 100, 800 - 100]); // 不越过视口右 / 下边
});

test('resizeBox NW: 右下固定, 拖动改 left/top; 不越过视口左 / 上边, 也不小于 min', () => {
  assert.deepEqual(resizeBox(box, 'NW', -30, -20, L, VP), { left: 70, top: 80, width: 350, height: 500 });
  const big = resizeBox(box, 'NW', -9999, -9999, L, VP);
  assert.deepEqual([big.left, big.top, big.width, big.height], [0, 0, 420, 580]); // 右 420 / 下 580 固定
  const small = resizeBox(box, 'NW', 9999, 9999, L, VP);
  assert.deepEqual([small.width, small.height, small.left + small.width, small.top + small.height], [120, 180, 420, 580]);
});

test('resizeBox NE / SW: 各自固定对角', () => {
  const ne = resizeBox(box, 'NE', 20, -20, L, VP);
  assert.deepEqual(ne, { left: 100, top: 80, width: 340, height: 500 }); // 左下固定
  const sw = resizeBox(box, 'SW', -20, 20, L, VP);
  assert.deepEqual(sw, { left: 80, top: 100, width: 340, height: 500 }); // 右上固定
});

test('resizeBox: 自定义 max / min', () => {
  const lim = normalizeResizable({ minWidth: 200, minHeight: 300, maxWidth: 400, maxHeight: 600 });
  const r = resizeBox(box, 'SE', 9999, 9999, lim, VP);
  assert.deepEqual([r.width, r.height], [400, 600]);
  const s = resizeBox(box, 'SE', -9999, -9999, lim, VP);
  assert.deepEqual([s.width, s.height], [200, 300]);
});

test('resizeBox: 起点已部分在视口外也不抛、不出现 NaN', () => {
  const r = resizeBox({ left: 950, top: 790, width: 320, height: 480 }, 'SE', 50, 50, L, VP);
  assert.ok([r.left, r.top, r.width, r.height].every(Number.isFinite));
  assert.ok(r.width >= 120 && r.height >= 180);
});

test('fitBox: 视口缩小后夹回 (尺寸与位置)', () => {
  assert.deepEqual(fitBox({ left: 900, top: 700, width: 320, height: 480 }, { width: 600, height: 500 }), { left: 280, top: 20, width: 320, height: 480 });
  assert.deepEqual(fitBox({ left: 10, top: 10, width: 800, height: 900 }, { width: 600, height: 500 }), { left: 0, top: 0, width: 600, height: 500 });
});

const good = { gesture: 1, seq: 0, phase: 'start', dx: 0, dy: 0, totalDx: 0, totalDy: 0 };
test('parseGesturePayload: 合法通过; 缺字段 / 非有限数 / 超量级 / 非法 phase / 非法 reason 拒绝', () => {
  assert.ok(parseGesturePayload('move', good));
  assert.ok(parseGesturePayload('move', { ...good, phase: 'end', reason: 'up', seq: 3 }));
  for (const bad of [null, 'x', 1, {}, { ...good, gesture: -1 }, { ...good, gesture: 1.5 }, { ...good, seq: '0' }, { ...good, phase: 'drag' },
    { ...good, dx: NaN }, { ...good, totalDx: Infinity }, { ...good, totalDy: MAX_GESTURE_DELTA + 1 }, { ...good, reason: 'because' }, { ...good, dy: null }]) {
    assert.equal(parseGesturePayload('move', bad), null, JSON.stringify(bad));
  }
});

test('parseGesturePayload(resize): 必须带合法 corner; 原型键 / 小写 / 非字符串拒绝', () => {
  assert.equal(parseGesturePayload('resize', good), null);
  assert.equal(parseGesturePayload('resize', { ...good, corner: 'se' }), null);
  assert.equal(parseGesturePayload('resize', { ...good, corner: '__proto__' }), null);
  assert.equal(parseGesturePayload('resize', { ...good, corner: 1 }), null);
  assert.equal(parseGesturePayload('resize', { ...good, corner: 'SE' }).corner, 'SE');
});

test('GestureGate: start → move* → end 放行; 迟到 / 重放 / 乱序 / 无 start 拒绝', () => {
  const g = new GestureGate();
  assert.equal(g.accept({ gesture: 1, seq: 1, phase: 'move' }), false, '没有 start');
  assert.equal(g.accept({ gesture: 1, seq: 0, phase: 'start' }), true);
  assert.equal(g.accept({ gesture: 1, seq: 2, phase: 'move' }), true);
  assert.equal(g.accept({ gesture: 1, seq: 2, phase: 'move' }), false, '重放');
  assert.equal(g.accept({ gesture: 1, seq: 1, phase: 'move' }), false, '乱序');
  assert.equal(g.accept({ gesture: 2, seq: 3, phase: 'move' }), false, '别的手势');
  assert.equal(g.accept({ gesture: 1, seq: 5, phase: 'end' }), true);
  assert.equal(g.active, false);
  assert.equal(g.accept({ gesture: 1, seq: 6, phase: 'move' }), false, 'end 之后的迟到消息');
  assert.equal(g.accept({ gesture: 1, seq: 0, phase: 'start' }), false, '不能用旧的手势序号重新开始');
  assert.equal(g.accept({ gesture: 2, seq: 1, phase: 'start' }), false, 'start 的 seq 必须是 0');
  assert.equal(g.accept({ gesture: 2, seq: 0, phase: 'start' }), true);
  g.close();
  assert.equal(g.accept({ gesture: 2, seq: 1, phase: 'move' }), false, '宿主关闭后拒绝');
});
