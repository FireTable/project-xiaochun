/**
 * latestWinsQueue.ts — 串行 + 最新请求优先 (generation token) 的任务队列，纯逻辑。
 *
 * 用于 vrmEngine.swapOutfit：换装会往场景里挂新模型并销毁旧模型，两个换装并发会各自把自己的新模型挂上去、
 * 后一个覆盖 currentVRM 指针，先挂上的那个就成了没人管的“幽灵模型” (手机上连点两下出现多个模型)。
 *
 *   1. 同一时刻只跑一个任务，其余按顺序排队；
 *   2. 每次 run() 领一个递增 token，轮到它时如果已经有更新的 run() 进来 (token 过期) → 直接跳过，不执行；
 *   3. 正在跑的任务不会被打断 (半途取消会留下半截状态)，但任务可以用 isLatest(token) 在安全点自己放弃；
 *   4. 一个任务抛错只影响它自己，队列继续往下走。
 */
export const SUPERSEDED: unique symbol = Symbol('superseded');

export class LatestWinsQueue {
  private generation = 0;
  private pendingCount = 0;
  private chain: Promise<unknown> = Promise.resolve();

  /** 有任务在跑或在排队 */
  get busy(): boolean {
    return this.pendingCount > 0;
  }

  /** token 是否仍是最新的一次 run() */
  isLatest(token: number): boolean {
    return token === this.generation;
  }

  run<T>(task: (token: number) => Promise<T>): Promise<T | typeof SUPERSEDED> {
    const token = ++this.generation;
    this.pendingCount++;
    const result = this.chain.then(async (): Promise<T | typeof SUPERSEDED> => {
      try {
        if (token !== this.generation) return SUPERSEDED; // 排队时被更新的请求顶掉
        return await task(token);
      } finally {
        this.pendingCount--;
      }
    });
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }
}
