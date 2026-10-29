import { describe, it, expect } from 'vitest';
import { LatestWinsQueue, SUPERSEDED } from '../latestWinsQueue';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('LatestWinsQueue (outfit swap race: fast double tap must not mount two models)', () => {
  it('never runs two tasks at the same time', async () => {
    const q = new LatestWinsQueue();
    let running = 0;
    let maxRunning = 0;
    const gate = deferred();
    const task = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await gate.promise;
      running--;
      return 'ok';
    };
    const a = q.run(task);
    const b = q.run(task);
    gate.resolve();
    await Promise.all([a, b]);
    expect(maxRunning).toBe(1);
  });

  it('latest wins: the running task finishes, queued middle requests are skipped, the last one runs', async () => {
    const q = new LatestWinsQueue();
    const ran: string[] = [];
    const gate = deferred();
    const a = q.run(async () => { await gate.promise; ran.push('A'); return 'A'; });
    await tick(); // A is now running
    const b = q.run(async () => { ran.push('B'); return 'B'; });
    const c = q.run(async () => { ran.push('C'); return 'C'; });
    gate.resolve();
    expect(await a).toBe('A');
    expect(await b).toBe(SUPERSEDED);
    expect(await c).toBe('C');
    expect(ran).toEqual(['A', 'C']);
  });

  it('a running task can see it was superseded (isLatest) and bail out before touching the scene', async () => {
    const q = new LatestWinsQueue();
    const gate = deferred();
    let mounted = 0;
    const a = q.run(async (token) => {
      await gate.promise; // "compose" in the worker
      if (!q.isLatest(token)) return false;
      mounted++;
      return true;
    });
    await tick(); // A is now composing
    const b = q.run(async (token) => {
      if (!q.isLatest(token)) return false;
      mounted++;
      return true;
    });
    gate.resolve();
    expect(await a).toBe(false);
    expect(await b).toBe(true);
    expect(mounted).toBe(1);
  });

  it('a failed task does not block the queue, and busy tracks running + queued tasks', async () => {
    const q = new LatestWinsQueue();
    expect(q.busy).toBe(false);
    const a = q.run(async () => { throw new Error('boom'); });
    expect(q.busy).toBe(true);
    await expect(a).rejects.toThrow('boom');
    expect(await q.run(async () => 'next')).toBe('next');
    expect(q.busy).toBe(false);
  });
});

describe('LatestWinsQueue same-tick double tap', () => {
  it('two requests in the same tick: only the second runs', async () => {
    const q = new LatestWinsQueue();
    const ran: string[] = [];
    const a = q.run(async () => { ran.push('A'); });
    const b = q.run(async () => { ran.push('B'); });
    expect(await a).toBe(SUPERSEDED);
    await b;
    expect(ran).toEqual(['B']);
  });
});
