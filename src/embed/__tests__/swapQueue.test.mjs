import test from 'node:test';
import assert from 'node:assert/strict';
import { BusyError, SwapQueue } from '../swapQueue.ts';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));

function makeQueue() {
  const started = [];
  const gates = new Map();
  let concurrent = 0; let maxConcurrent = 0;
  const q = new SwapQueue(async (job) => {
    started.push(job);
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    const g = deferred(); gates.set(job, g);
    try { await g.promise; return `done:${job}`; } finally { concurrent--; }
  });
  return { q, started, gates, max: () => maxConcurrent };
}

test('串行: 同一时刻只跑一个, 后来的排队', async () => {
  const { q, started, gates, max } = makeQueue();
  const a = q.enqueue('a').promise;
  const b = q.enqueue('b').promise;
  await tick();
  assert.deepEqual(started, ['a']);
  gates.get('a').resolve();
  assert.equal(await a, 'done:a');
  await tick();
  assert.deepEqual(started, ['a', 'b']);
  gates.get('b').resolve();
  assert.equal(await b, 'done:b');
  assert.equal(max(), 1);
});

test('last-wins: 等待位只留最新一个, 被顶掉的以 busy reject', async () => {
  const { q, started, gates } = makeQueue();
  const a = q.enqueue('a').promise;
  const b = q.enqueue('b').promise;
  const c = q.enqueue('c').promise;
  const d = q.enqueue('d').promise;
  await assert.rejects(b, (e) => e instanceof BusyError && e.code === 'busy');
  await assert.rejects(c, (e) => e instanceof BusyError);
  gates.get('a').resolve();
  await a;
  await tick();
  assert.deepEqual(started, ['a', 'd']); // b / c 从未开始
  gates.get('d').resolve();
  assert.equal(await d, 'done:d');
});

test('快速连点 20 次: 只会跑第一个和最后一个', async () => {
  const { q, started, gates } = makeQueue();
  const ps = Array.from({ length: 20 }, (_, i) => q.enqueue(`j${i}`).promise);
  const settled = ps.map((p) => p.then(() => 'ok', (e) => (e instanceof BusyError ? 'busy' : 'err')));
  await tick();
  gates.get('j0').resolve();
  await tick();
  gates.get('j19').resolve();
  const r = await Promise.all(settled);
  assert.deepEqual(started, ['j0', 'j19']);
  assert.equal(r[0], 'ok'); assert.equal(r[19], 'ok');
  assert.equal(r.filter((x) => x === 'busy').length, 18);
});

test('同目标合并: 与正在跑 / 等待中的相同目标共享结果, shared=true', async () => {
  const { q, started, gates } = makeQueue();
  const a1 = q.enqueue('a');
  const a2 = q.enqueue('a');
  assert.equal(a1.shared, false); assert.equal(a2.shared, true);
  assert.equal(a1.promise, a2.promise);
  const b1 = q.enqueue('b');
  const b2 = q.enqueue('b');
  assert.equal(b2.shared, true); assert.equal(b1.promise, b2.promise);
  gates.get('a').resolve();
  await a1.promise; await tick();
  gates.get('b').resolve();
  await b1.promise;
  assert.deepEqual(started, ['a', 'b']);
});

test('正在跑的不会被打断; 失败只影响自己, 等待位照常执行', async () => {
  const { q, started, gates } = makeQueue();
  const a = q.enqueue('a').promise;
  const b = q.enqueue('b').promise;
  await tick();
  gates.get('a').reject(new Error('compose failed'));
  await assert.rejects(a, /compose failed/);
  await tick();
  assert.deepEqual(started, ['a', 'b']);
  gates.get('b').resolve();
  assert.equal(await b, 'done:b');
  await tick();
  assert.equal(q.busy, false);
});

test('run 同步抛错也只 reject 自己', async () => {
  const q = new SwapQueue(() => { throw new Error('sync boom'); });
  await assert.rejects(q.enqueue('x').promise, /sync boom/);
  await tick();
  assert.equal(q.busy, false);
});

test('close: 丢弃等待位, 之后拒绝新请求', async () => {
  const { q, gates } = makeQueue();
  const a = q.enqueue('a').promise;
  const b = q.enqueue('b').promise;
  q.close();
  await assert.rejects(b, BusyError);
  await assert.rejects(q.enqueue('c').promise, BusyError);
  gates.get('a').resolve();
  assert.equal(await a, 'done:a');
});
