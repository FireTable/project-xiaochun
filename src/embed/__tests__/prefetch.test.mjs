// node --test: pnpm test:embed  (预取调度: 并发 1 / 排在 gate 之后 / 同 id 合并 / 失败隔离 / 默认不含婚纱)
import test from 'node:test';
import assert from 'node:assert/strict';
import { PrefetchScheduler, ensureAssets } from '../prefetch.ts';
import { defaultPrefetchIds, PREFETCH_EXCLUDED } from '../registry.ts';
import { SwapQueue } from '../swapQueue.ts';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));

test('默认预取列表不含婚纱; 其余服装都在; 显式点名不受限 (由 bridge 校验后原样传入)', () => {
  const addons = { a_one: {}, xiaochun_wedding: {}, b_two: {} };
  assert.deepEqual(defaultPrefetchIds(addons), ['a_one', 'b_two']);
  assert.ok(PREFETCH_EXCLUDED.has('xiaochun_wedding'));
});

test('并发 1: 多个 id 逐个下载, 绝不并行', async () => {
  let active = 0; let max = 0; const order = [];
  const gates = new Map();
  const s = new PrefetchScheduler({
    gate: async () => {},
    work: async (id) => {
      active++; max = Math.max(max, active); order.push(id);
      const g = deferred(); gates.set(id, g);
      try { await g.promise; return 'downloaded'; } finally { active--; }
    },
  });
  const p = s.enqueue(['a', 'b', 'c']);
  await tick();
  assert.deepEqual(order, ['a']);
  gates.get('a').resolve(); await tick();
  assert.deepEqual(order, ['a', 'b']);
  gates.get('b').resolve(); await tick();
  gates.get('c').resolve();
  const r = await p;
  assert.deepEqual(r, { downloaded: ['a', 'b', 'c'], cached: [], failed: [] });
  assert.equal(max, 1);
});

test('两个并发请求也共享同一条串行链; 相同 id 只下载一次', async () => {
  let active = 0; let max = 0; const calls = [];
  const s = new PrefetchScheduler({
    gate: async () => {},
    work: async (id) => { active++; max = Math.max(max, active); calls.push(id); await tick(); active--; return 'downloaded'; },
  });
  const [r1, r2] = await Promise.all([s.enqueue(['a', 'b']), s.enqueue(['b', 'c'])]);
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.equal(max, 1);
  assert.deepEqual(r1.downloaded, ['a', 'b']); assert.deepEqual(r2.downloaded, ['b', 'c']);
});

test('排在 gate 之后: gate 不放行就不开始下载 (EMAGE 加载 / 换装进行中)', async () => {
  const gate = deferred(); let started = false;
  const s = new PrefetchScheduler({ gate: () => gate.promise, work: async () => { started = true; return 'downloaded'; } });
  const p = s.enqueue(['a']);
  await tick(); await tick();
  assert.equal(started, false);
  gate.resolve();
  assert.deepEqual((await p).downloaded, ['a']);
});

test('排在换装之后: 用 SwapQueue.idle() 作 gate, 换装结束才下载', async () => {
  const swapGate = deferred();
  const q = new SwapQueue(async () => { await swapGate.promise; return 1; });
  void q.enqueue('x').promise;
  let started = false;
  const s = new PrefetchScheduler({ gate: () => q.idle(), work: async () => { started = true; return 'cached'; } });
  const p = s.enqueue(['a']);
  await tick();
  assert.equal(started, false);
  swapGate.resolve();
  assert.deepEqual((await p).cached, ['a']);
  assert.equal(started, true);
});

test('失败隔离: 一个 id 失败 (work 抛错) 只进 failed, 不影响后面的', async () => {
  const s = new PrefetchScheduler({
    gate: async () => {},
    work: async (id) => { if (id === 'bad') throw new Error('HTTP 500'); return id === 'hit' ? 'cached' : 'downloaded'; },
  });
  assert.deepEqual(await s.enqueue(['a', 'bad', 'hit', 'z']), { downloaded: ['a', 'z'], cached: ['hit'], failed: ['bad'] });
});

test('close 后排队中的条目返回 failed (不再下载)', async () => {
  const g = deferred(); let n = 0;
  const s = new PrefetchScheduler({ gate: () => g.promise, work: async () => { n++; return 'downloaded'; } });
  const p = s.enqueue(['a', 'b']);
  s.close(); g.resolve();
  assert.deepEqual((await p).failed, ['a', 'b']);
  assert.equal(n, 0);
});

test('ensureAssets: 都已缓存 → cached, 不 fetch', async () => {
  let fetched = 0;
  const io = { available: () => true, has: async () => true, put: async () => {}, fetch: async () => { fetched++; return new ArrayBuffer(1); } };
  assert.equal(await ensureAssets([{ url: '/b', sha: 's1' }, { url: '/a', sha: 's2' }], io, () => {}), 'cached');
  assert.equal(fetched, 0);
});

test('ensureAssets: 只下载缺的 (base 已缓存只拉 addon), 写入 url+sha 键, 进度单调到 100', async () => {
  const store = new Map([['/b@s1', new ArrayBuffer(1)]]);
  const puts = []; const pcts = [];
  const io = {
    available: () => true,
    has: async (u, s) => store.has(`${u}@${s}`),
    put: async (u, s, b) => { store.set(`${u}@${s}`, b); puts.push(`${u}@${s}`); },
    fetch: async (u, onBytes) => { onBytes(50, 100); onBytes(100, 100); return new ArrayBuffer(100); },
  };
  assert.equal(await ensureAssets([{ url: '/b', sha: 's1' }, { url: '/a', sha: 's2' }], io, (p) => pcts.push(p)), 'downloaded');
  assert.deepEqual(puts, ['/a@s2']);
  assert.equal(pcts.at(-1), 100);
  assert.deepEqual(pcts, [...pcts].sort((x, y) => x - y));
});

test('ensureAssets: IndexedDB 不可用直接抛错 (调度器记 failed, 不白下载)', async () => {
  const io = { available: () => false, has: async () => false, put: async () => {}, fetch: async () => { throw new Error('should not fetch'); } };
  await assert.rejects(ensureAssets([{ url: '/a', sha: 's' }], io, () => {}), /indexedDB/);
});
