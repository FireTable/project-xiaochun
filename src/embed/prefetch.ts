/**
 * embed/prefetch.ts — 服装资源预取 (只下载进 IndexedDB 的 raw 缓存, 不解压 / 不合成 / 不创建 GPU 资源)。
 *
 * 约束 (与产品决策一致):
 *   - 默认关闭; 由宿主发 xc.prefetch (SDK 的 `prefetch` 选项只在 heavy:'eager' 时自动发)。
 *   - 并发 1: 全局串行, 一次只下载一个服装 (含它的 base, 如果还没缓存)。
 *   - 排在 EMAGE 之后: 每个条目开始前先等 gate() (bridge 里: heavy=eager 时等 EMAGE 加载完, 且没有换装在进行)。
 *   - 默认不含婚纱 (13.9MB): 见 registry.PREFETCH_EXCLUDED; 宿主显式点名则照做。
 *   - 缓存键与 vrmWorker 一致 (url + sha), 所以之后 xc.setOutfit 会直接命中, 不再走网络。
 *
 * 本文件的 PrefetchScheduler 不依赖 DOM / 引擎 (全部通过注入), 可用 node --test 直接测。
 */

export interface PrefetchResult {
  /** 本次真正下载并写入缓存的 id。 */
  downloaded: string[];
  /** 本来就在缓存里的 id。 */
  cached: string[];
  /** 下载失败的 id (网络 / 配额 / IDB 不可用); 不影响其它 id。 */
  failed: string[];
}

export interface PrefetchDeps {
  /** 处理一个 id: 返回 'cached' (已有) 或 'downloaded'; 失败请 throw。onProgress 0~100。 */
  work: (id: string, onProgress: (pct: number) => void) => Promise<'cached' | 'downloaded'>;
  /** 每个条目开始前调用; 用来"排在 EMAGE 之后 / 避开正在进行的换装"。 */
  gate: () => Promise<void>;
  onProgress?: (id: string, pct: number) => void;
}

export class PrefetchScheduler {
  private readonly deps: PrefetchDeps;
  private tail: Promise<unknown> = Promise.resolve();
  /** 同一个 id 正在排队 / 下载时, 后来的请求共享同一个结果 (不重复下载)。 */
  private readonly inflight = new Map<string, Promise<'cached' | 'downloaded' | 'failed'>>();
  private closed = false;

  constructor(deps: PrefetchDeps) {
    this.deps = deps;
  }

  close(): void { this.closed = true; }

  enqueue(ids: readonly string[]): Promise<PrefetchResult> {
    const unique = [...new Set(ids)];
    const results = unique.map((id) => ({ id, p: this.itemFor(id) }));
    return Promise.all(results.map(async ({ id, p }) => ({ id, r: await p }))).then((all) => ({
      downloaded: all.filter((x) => x.r === 'downloaded').map((x) => x.id),
      cached: all.filter((x) => x.r === 'cached').map((x) => x.id),
      failed: all.filter((x) => x.r === 'failed').map((x) => x.id),
    }));
  }

  private itemFor(id: string): Promise<'cached' | 'downloaded' | 'failed'> {
    const existing = this.inflight.get(id);
    if (existing) return existing;
    const run = async (): Promise<'cached' | 'downloaded' | 'failed'> => {
      if (this.closed) return 'failed';
      try {
        await this.deps.gate();
        if (this.closed) return 'failed';
        return await this.deps.work(id, (pct) => this.deps.onProgress?.(id, pct));
      } catch {
        return 'failed';
      }
    };
    // 全局串行: 接在上一个条目后面 (无论成败)
    const p = this.tail.then(run, run).finally(() => { this.inflight.delete(id); });
    this.tail = p;
    this.inflight.set(id, p);
    return p;
  }
}

/** 拉取一个资源并写进 IDB raw 缓存 (与 vrmWorker.fetchOrCache 同键)。deps 注入以便测试。 */
export interface AssetIo {
  has: (url: string, sha: string) => Promise<boolean>;
  put: (url: string, sha: string, buf: ArrayBuffer) => Promise<void>;
  fetch: (url: string, onBytes: (loaded: number, total: number) => void) => Promise<ArrayBuffer>;
  available: () => boolean;
}

/** 依次确保 [base, addon] 都在缓存里; 返回是否有真正下载。progress 按"已完成字节 / 总字节"折算 (总字节未知时按阶段均分)。 */
export async function ensureAssets(
  assets: ReadonlyArray<{ url: string; sha: string }>,
  io: AssetIo,
  onProgress: (pct: number) => void,
): Promise<'cached' | 'downloaded'> {
  if (!io.available()) throw new Error('indexedDB unavailable');
  const missing: Array<{ url: string; sha: string }> = [];
  for (const a of assets) { if (!(await io.has(a.url, a.sha))) missing.push(a); }
  if (missing.length === 0) return 'cached';
  let done = 0;
  for (const a of missing) {
    const buf = await io.fetch(a.url, (loaded, total) => {
      const within = total > 0 ? loaded / total : 0;
      onProgress(Math.min(99, Math.round(((done + within) / missing.length) * 100)));
    });
    await io.put(a.url, a.sha, buf);
    done++;
    onProgress(Math.round((done / missing.length) * 100));
  }
  return 'downloaded';
}
