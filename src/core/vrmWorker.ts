/**
 * vrmWorker.ts — VRM 二进制处理 Dedicated Web Worker
 *
 * 核心目标:
 * 1. 把 outfit-swap 的整条重活(fetch + unzip + bspatch + packGLB)从主线程剥离,
 *    让 Three.js 渲染循环在 swap 期间保持 60 FPS,体感"卡顿消失"。
 * 2. 通过 Transferable ArrayBuffer 零拷贝传 16+ MB base / 6 MB patch,
 *    主线程发完消息立刻继续,worker 算完回传最终 GLB(也是 transferable)。
 *
 * 消息协议 (request id 严格匹配,多请求并发安全):
 *   主 → worker: { id, type: 'compose_outfit', addonUrl, v1Bin }
 *     - addonUrl: 'https://.../xiaochun_v1.vrmaddon' (zip 容器,含 bin-patch + target.json)
 *     - baseUrl : 'https://.../xiaochun_base.vrmbase' (zip 容器,含 whole-glb.bin,做 bspatch base)
 *     - v1Bin   : GLB 的 BIN chunk Uint8Array(主线程 extractBinFromGLB 后 transfer 进来)
 *   worker → 主: { id, type: 'compose_ok', composedGLB, elapsedMs }
 *   worker → 主: { id, type: 'compose_err', error }
 *
 * 为什么整个 pipeline 在 worker:
 *   - 6.6 MB addon download + 6.6 MB unzip + 16 MB bspatch 全是 CPU/IO 重活,
 *     全部在主线程会被分块冻结渲染循环。
 *   - Worker 内 fetch 走 main-thread network 代理,下载期间主线程仍可渲染。
 *
 * 为什么 bspatch 单独暴露:
 *   - 后续若有人想直接喂 patch(已下载过 addon),走 'bspatch' 复用同一 wasm 实例。
 */
import { unzipSync } from 'fflate';
import { loadBspatch } from 'bsdiff-wasm';
import { idbGet, idbPut, idbGetComposed, idbPutComposed } from '@/lib/idb-vrm-cache';

type ComposeRequest = {
  id: number;
  type: 'compose_outfit';
  /** Base .bin URL — 换装路径用 (addon 含 bin-patch.bin,worker fetch base bin + bspatch)。
   *  是裸 BIN chunk 字节流(不是 GLB 容器,bsdiff 直接吃),由 build_v1_addon.mjs 产出。
   *  冷启动路径不传 — addon 自带 whole-glb.bin,worker 直接用。 */
  baseUrl?: string;
  /** Base 产物 sha256 — IDB cache key 的一部分。不传 → 跳过 cache,走纯 fetch。 */
  baseSha?: string;
  /** .vrmaddon (zip) — 必传 */
  addonUrl: string;
  /** Addon 产物 sha256 — 同 baseSha。 */
  addonSha?: string;
};

type BspatchRequest = {
  id: number;
  type: 'bspatch';
  old: ArrayBuffer;
  patch: ArrayBuffer;
};

type Request = ComposeRequest | BspatchRequest;

type ComposeOk    = { id: number; type: 'compose_ok'; composedGLB: ArrayBuffer; elapsedMs: number };
type ComposeErr   = { id: number; type: 'compose_err'; error: string };
type ComposeProgress = { id: number; type: 'compose_progress'; phase: ComposePhase; loaded?: number; total?: number; pct: number };
type BspatchOk    = { id: number; type: 'bspatch_ok'; newBin: ArrayBuffer; elapsedMs: number };
type BspatchErr   = { id: number; type: 'bspatch_err'; error: string };
type Response     = ComposeOk | ComposeErr | ComposeProgress | BspatchOk | BspatchErr;

/** ponytail: compose 阶段名 — engine 收到 progress 时按 phase 走对应 callback。
 *  fetch_addon / fetch_base 用 byte progress;unzip/bspatch/pack 一次性 emit(没有 partial)。 */
type ComposePhase = 'fetch_addon' | 'fetch_base' | 'unzip' | 'bspatch' | 'pack';

const ctx = self as unknown as Worker;
const reply = (msg: Response, transfer?: Transferable[]) =>
  ctx.postMessage(msg, transfer ?? []);

// ponytail: worker 内的 console.log/error 默认只在 worker 自己的 console 出现,
// DevTools 主线程 console 看不到。加 proxy 后主线程能看见所有 worker 日志,
// 调试 addon / base fetch / bspatch 失败时方便 — 直接看 DevTools Console。
const origLog = console.log.bind(console);
const origErr = console.error.bind(console);
console.log = (...args) => {
  ctx.postMessage({ id: -1, type: 'log', level: 'log', args: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))) });
  origLog(...args);
};
console.error = (...args) => {
  ctx.postMessage({ id: -1, type: 'log', level: 'error', args: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))) });
  origErr(...args);
};

/** Pack raw json text + bin into a GLB ArrayBuffer. Byte-exact preservation of JSON.
 *
 *  ponytail: **不**给 chunk 加 4-byte padding!GLB 规范说 SHOULD,但 three.js 的
 *  GLTFBinaryExtension walker 只 chunkIndex += chunkLength,跳过 padding 字节。
 *  如果 BIN 后面有 padding (binPad > 0),walker 会把 padding 字节当成下一个 chunk
 *  的 length 字段去读 4 字节,越界 → RangeError(实测 binPad=2 时炸,确认)。
 *  原 .vrm 文件也不 pad (VRM exporter 都不 pad),保持一致即可。
 *  关键:totalLen / chunkLength 都按 unpadded 写,three.js 走到 chunkIndex == chunkContentsLength 时自然停。 */
function packRawGLB(jsonBytes: Uint8Array, bin: Uint8Array): Uint8Array {
  const totalLen = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(totalLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, totalLen, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  const binChunkOffset = 20 + jsonBytes.length;
  dv.setUint32(binChunkOffset, bin.length, true);
  dv.setUint32(binChunkOffset + 4, 0x004e4942, true); // 'BIN\0'
  out.set(bin, binChunkOffset + 8);
  return out;
}

async function bspatch(old: ArrayBuffer, patch: ArrayBuffer): Promise<Uint8Array> {
  const bspatch = await loadBspatch({
    print: () => {},
    printErr: (m: unknown) => console.error('[vrmWorker bspatch]', m),
  });
  const oldPath = '/old.bin';
  const outPath = '/out.bin';
  const patchPath = '/patch.bsdiff';
  bspatch.FS.writeFile(oldPath, new Uint8Array(old));
  bspatch.FS.writeFile(patchPath, new Uint8Array(patch));
  try { bspatch.FS.unlink(outPath); } catch { /* may not exist */ }
  const rc = bspatch.callMain([oldPath, outPath, patchPath]);
  if (rc !== 0) throw new Error(`bspatch exit code ${rc}`);
  const out = bspatch.FS.readFile(outPath);
  try { bspatch.FS.unlink(oldPath); } catch {}
  try { bspatch.FS.unlink(outPath); } catch {}
  try { bspatch.FS.unlink(patchPath); } catch {}
  // ponytail: 拷到独立 ArrayBuffer(buffer 指向 wasm 内存,要断开)
  const newBin = new Uint8Array(out.length);
  newBin.set(out);
  return newBin;
}

async function composeOutfit(req: ComposeRequest): Promise<void> {
  const t0 = performance.now();

  // ponytail: 第二层 cache — compose 后的 GLB 字节。命中即跳过整个 pipeline,
  // 直接 reply composed_ok。cache key 含 addon + base 两个 URL+sha,任一变
  // 自动 miss (build 改了产物 → user 更新 config sha → 旧条目自然失效)。
  // ponytail: 冷启动时 engine 把 addonUrl 和 baseUrl 都传同一个 .vrmbase 路径,
  // composed cache key 自然对称,re-cold-start 也走 cache。
  const composedCached = await idbGetComposed(
    req.addonUrl, req.addonSha ?? '',
    req.baseUrl ?? req.addonUrl, req.baseSha ?? '',
  );
  if (composedCached) {
    console.log(`cache HIT (composed)  ${req.addonUrl}`);
    ctx.postMessage({ id: req.id, type: 'compose_progress', phase: 'pack', pct: 100 });
    reply(
      { id: req.id, type: 'compose_ok', composedGLB: composedCached, elapsedMs: performance.now() - t0 },
      [composedCached],
    );
    return;
  }
  console.log(`cache MISS (composed) ${req.addonUrl} → full pipeline`);


  // ponytail: 阶段权重表 — worker 端算 pct,engine 直接 forward。
  // .vrmaddon swap 路径: fetch_addon(40%) + fetch_base(35%) + bspatch(20%) + pack(5%)
  // .vrmbase cold-start 路径 (addon 自带 whole BIN): fetch_addon(95%) + pack(5%)
  // 提前读 addon 第一字节 peek 太麻烦 — 等 fetch 完后看 entries 决定走哪条路径,
  // 所以先用 swap 权重,peek 出 whole BIN 后再覆盖。
  let phaseWeights: Record<ComposePhase, [number, number]> = {
    fetch_addon: [0, 40],
    fetch_base:  [40, 75],
    unzip:       [75, 78],
    bspatch:     [78, 95],
    pack:        [95, 100],
  };
  const emitProgress = (phase: ComposePhase, loaded?: number, total?: number) => {
    const [start, end] = phaseWeights[phase];
    const pct = (loaded !== undefined && total && total > 0)
      ? Math.min(end, Math.round(start + (loaded / total) * (end - start)))
      : start;
    ctx.postMessage({ id: req.id, type: 'compose_progress', phase, loaded, total, pct });
  };

  const addonBuf = await fetchOrCache(req.addonUrl, req.addonSha, emitProgress);
  emitProgress('unzip');
  const entries = unzipSync(new Uint8Array(addonBuf));
  const targetJson = entries['target.json'];
  if (!targetJson) throw new Error("[vrmWorker] addon missing 'target.json'");

  // ponytail: 看完 entries 才知道是 cold-start 还是 swap,覆盖 phaseWeights。
  if (!entries['bin-patch.bin'] && entries['whole-glb.bin']) {
    // cold-start .vrmbase 路径 — 没有 base fetch / bspatch。
    phaseWeights = {
      fetch_addon: [0, 95],
      fetch_base:  [0, 0],
      unzip:       [95, 97],
      bspatch:     [0, 0],
      pack:        [97, 100],
    };
  }

  let newBin: Uint8Array;
  if (entries['bin-patch.bin']) {
    if (!req.baseUrl) {
      throw new Error("[vrmWorker] addon has bin-patch.bin but request missing baseUrl");
    }
    const baseBuf = await fetchOrCache(req.baseUrl, req.baseSha, emitProgress, 'fetch_base');
    const baseEntries = unzipSync(new Uint8Array(baseBuf));
    const v1Bin = baseEntries['whole-glb.bin'];
    if (!v1Bin) throw new Error(`[vrmWorker] base ${req.baseUrl} missing 'whole-glb.bin'`);
    emitProgress('bspatch');
    const binPatch = entries['bin-patch.bin'];
    newBin = await bspatch(
      (v1Bin.buffer as ArrayBuffer).slice(v1Bin.byteOffset, v1Bin.byteOffset + v1Bin.byteLength),
      (binPatch.buffer as ArrayBuffer).slice(binPatch.byteOffset, binPatch.byteOffset + binPatch.byteLength),
    );
  } else if (entries['whole-glb.bin']) {
    newBin = entries['whole-glb.bin'];
  } else {
    throw new Error("[vrmWorker] addon missing both 'bin-patch.bin' and 'whole-glb.bin'");
  }

  emitProgress('pack');
  const composed = packRawGLB(targetJson, newBin);

  const dt = performance.now() - t0;
  const composedBuf = new Uint8Array(composed.length);
  composedBuf.set(composed);
  // ponytail: 第二层 cache 写入 — 下次同 (addon, base) 组合直接命中,跳过整个 pipeline。
  // 同样任一 sha 变 → 自动 key 变 → 旧条目孤立但无害。
  await idbPutComposed(
    req.addonUrl, req.addonSha ?? '',
    req.baseUrl ?? req.addonUrl, req.baseSha ?? '',
    composedBuf.buffer,
  );
  console.log(`cache STORED (composed) ${req.addonUrl}  ${composedBuf.buffer.byteLength}B`);
  reply(
    { id: req.id, type: 'compose_ok', composedGLB: composedBuf.buffer, elapsedMs: dt },
    [composedBuf.buffer],
  );
}

/** ponytail: IDB cache + fetch with progress。
 *  cache key = url + sha (sha 变了 → key 变 → 自动 miss → 重 fetch)。
 *  命中直接 emit 一次 phaseStart + 完整 phaseEnd,UI 进度条立刻跳到阶段末,体感即时。
 *  sha 没传 / IDB 失败 → 退化到纯 fetch,不影响功能。 */
async function fetchOrCache(
  url: string,
  sha: string | undefined,
  emit: (phase: ComposePhase, loaded?: number, total?: number) => void,
  phase: ComposePhase = 'fetch_addon',
): Promise<ArrayBuffer> {
  if (sha) {
    const cached = await idbGet(url, sha);
    if (cached) {
      console.log(`cache HIT (raw)  ${phase}  ${url}  ${cached.byteLength}B`);
      // ponytail: 命中 → emit 一次 phaseStart (loaded=0, total=byteLength 让 UI 立刻看到)
      // 再 emit phaseEnd (loaded=total)。一次 swap 周期内只有 1-2 个 fetch,
      // 偶尔 emit 两次不会造成 setState 风暴。
      emit(phase, 0, cached.byteLength);
      emit(phase, cached.byteLength, cached.byteLength);
      return cached;
    }
    console.log(`cache MISS (raw) ${phase}  ${url}  → fetch + store`);
  }
  const buf = await fetchWithProgress(url, emit, phase);
  if (sha) {
    await idbPut(url, sha, buf);
    console.log(`cache STORED (raw) ${phase} ${url}  ${buf.byteLength}B`);
  }
  return buf;
}

/** ponytail: fetch + 字节级 progress 回调。phaseStart..phaseEnd 由 emitProgress 的 phaseWeights 决定。
 *  没有 body / content-length 时,fallback 到一次 emit (pct = phaseStart)。 */
async function fetchWithProgress(
  url: string,
  emit: (phase: ComposePhase, loaded?: number, total?: number) => void,
  phase: ComposePhase = 'fetch_addon',
): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${url}: HTTP ${resp.status}`);
  const total = Number(resp.headers.get('content-length') ?? 0);
  if (!resp.body || !total) {
    emit(phase);
    const buf = await resp.arrayBuffer();
    emit(phase, buf.byteLength, buf.byteLength);
    return buf;
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  // ponytail: 第一次 emit 触发 phaseStart,让 UI 立刻看到 bar 起步,不等第一个 chunk。
  emit(phase, 0, total);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    emit(phase, loaded, total);
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out.buffer;
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  try {
    if (req.type === 'compose_outfit') {
      await composeOutfit(req);
      return;
    }
    if (req.type === 'bspatch') {
      const t0 = performance.now();
      const out = await bspatch(req.old, req.patch);
      const outBuf = new Uint8Array(out.length);
      outBuf.set(out);
      const dt = performance.now() - t0;
      reply(
        { id: req.id, type: 'bspatch_ok', newBin: outBuf.buffer, elapsedMs: dt },
        [outBuf.buffer],
      );
      return;
    }
  } catch (err) {
    reply({
      id: req.id,
      type: req.type === 'compose_outfit' ? 'compose_err' : 'bspatch_err',
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

// ponytail: 暴露 wire format 给主线程用
export type VrmWorkerRequest = Request;
export type VrmWorkerResponse = Response;
