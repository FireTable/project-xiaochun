/**
 * embed/swapQueue.ts — 换装请求的串行队列 (纯逻辑, 无 DOM / 无引擎依赖)。
 *
 * 规则 (docs/EMBED.md §换装并发):
 *   1. 同一时刻只跑一个 swap (引擎的 swapOutfit 不可重入)。
 *   2. last-wins: 有 swap 在跑时, 新请求进入"等待位"; 等待位只留一个, 更新的请求会顶掉旧的,
 *      被顶掉的请求以 BusyError('busy') reject (没开始过, 不会有半截状态)。
 *   3. 与"正在跑的"或"等待位里的"同目标 (same(a,b)) 的请求直接合并到它的结果上 (shared=true), 不重复加载。
 *   4. 正在跑的不会被打断 (模型加载中途取消会留下半截状态), 跑完才轮到等待位。
 *   5. 一个任务失败只影响它自己, 队列继续处理等待位。
 */
export class BusyError extends Error {
  readonly code = 'busy' as const;
  constructor(message = 'superseded by a newer request') {
    super(message);
    this.name = 'BusyError';
  }
}

interface Slot<J, R> {
  job: J;
  promise: Promise<R>;
  resolve: (r: R) => void;
  reject: (e: unknown) => void;
}

export class SwapQueue<J, R> {
  private running: Slot<J, R> | null = null;
  private waiting: Slot<J, R> | null = null;
  private closed = false;

  private readonly run: (job: J) => Promise<R>;
  private readonly same: (a: J, b: J) => boolean;

  constructor(run: (job: J) => Promise<R>, same: (a: J, b: J) => boolean = (a, b) => a === b) {
    this.run = run;
    this.same = same;
  }

  private idleWaiters: Array<() => void> = [];

  /** 正在跑或有人在等。 */
  get busy(): boolean { return this.running !== null; }

  /** 没有任务在跑也没人在等时 resolve (预取据此避开换装)。 */
  idle(): Promise<void> {
    if (!this.running) return Promise.resolve();
    return new Promise<void>((resolve) => { this.idleWaiters.push(resolve); });
  }

  enqueue(job: J): { promise: Promise<R>; shared: boolean } {
    if (this.closed) return { promise: Promise.reject(new BusyError('queue closed')), shared: false };
    if (this.running && this.same(this.running.job, job) && !this.waiting) {
      return { promise: this.running.promise, shared: true };
    }
    if (this.waiting && this.same(this.waiting.job, job)) {
      return { promise: this.waiting.promise, shared: true };
    }
    const slot = this.makeSlot(job);
    if (!this.running) {
      this.start(slot);
      return { promise: slot.promise, shared: false };
    }
    if (this.waiting) this.waiting.reject(new BusyError());
    this.waiting = slot;
    return { promise: slot.promise, shared: false };
  }

  /** 丢弃等待位 (以 busy reject); 正在跑的让它跑完。之后不再接受新请求。 */
  close(): void {
    this.closed = true;
    if (this.waiting) { this.waiting.reject(new BusyError('queue closed')); this.waiting = null; }
  }

  private makeSlot(job: J): Slot<J, R> {
    let resolve!: (r: R) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<R>((res, rej) => { resolve = res; reject = rej; });
    promise.catch(() => {}); // 被顶掉的请求如果没人 await 也不报 unhandled
    return { job, promise, resolve, reject };
  }

  private start(slot: Slot<J, R>): void {
    this.running = slot;
    let p: Promise<R>;
    try { p = this.run(slot.job); } catch (e) { p = Promise.reject(e); }
    p.then(slot.resolve, slot.reject).finally(() => {
      this.running = null;
      const next = this.waiting;
      this.waiting = null;
      if (next && !this.closed) this.start(next);
      else if (next) next.reject(new BusyError('queue closed'));
      if (!this.running) { const w = this.idleWaiters; this.idleWaiters = []; w.forEach((f) => f()); }
    });
  }
}
