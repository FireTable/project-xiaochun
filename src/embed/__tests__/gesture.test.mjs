// iframe 手势载荷的序号 / 阶段规则 (纯逻辑): pnpm test:embed
import test from 'node:test';
import assert from 'node:assert/strict';
import { GestureSequencer } from '../gesturePayload.ts';

test('GestureSequencer: start(seq 0) → move(seq 递增) → end(带 reason), 手势号 +1', () => {
  const s = new GestureSequencer();
  assert.equal(s.running, false);
  assert.equal(s.step(1, 1, 1, 1), null, '没有 start 不出 move');
  assert.equal(s.end('up'), null, '没有 start 不出 end');
  const a = s.begin();
  assert.deepEqual(a, { gesture: 1, seq: 0, phase: 'start', dx: 0, dy: 0, totalDx: 0, totalDy: 0 });
  assert.equal(s.running, true);
  assert.deepEqual(s.step(3, 4, 3, 4), { gesture: 1, seq: 1, phase: 'move', dx: 3, dy: 4, totalDx: 3, totalDy: 4 });
  assert.deepEqual(s.step(2, 0, 5, 4), { gesture: 1, seq: 2, phase: 'move', dx: 2, dy: 0, totalDx: 5, totalDy: 4 });
  assert.deepEqual(s.end('up', 5, 4), { gesture: 1, seq: 3, phase: 'end', dx: 0, dy: 0, totalDx: 5, totalDy: 4, reason: 'up' });
  assert.equal(s.running, false);
  assert.equal(s.step(1, 1, 6, 5), null, 'end 之后不再出 move');
  assert.equal(s.end('cancel'), null, '不重复 end');
  assert.equal(s.begin().gesture, 2, '下一个手势号 +1, seq 重新从 0');
});

test('GestureSequencer: end 的 reason 原样带出 (cancel / blur)', () => {
  const s = new GestureSequencer();
  s.begin();
  assert.equal(s.end('blur').reason, 'blur');
  s.begin();
  assert.equal(s.end('cancel').reason, 'cancel');
});
