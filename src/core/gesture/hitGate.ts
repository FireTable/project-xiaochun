/**
 * HitGate — 命中检测的节流 / 迟滞闸门 (纯 TS, 宿主无关)。
 *
 * 原样抽自 src/embed/bridge.ts (commit 36805ce 修复指针卡顿的那套逻辑), 常量与行为不变:
 *
 * 原先每个 pointermove 都同步做一次 SkinnedMesh 射线检测, 并且 hit 一变就立刻回报,
 * 指针沿轮廓走时会让宿主的 iframe pointer-events 在 auto/none 间来回抖动。现在:
 *  0) 检测由 deps.test 完成 (embed 里是 vrmEngine.hitTest: 读渲染画面指针处 1 个像素的 alpha);
 *  1) 每帧最多检测一次 (rAF 合并, 取最新坐标); 指针几乎没动 (<1px) 且不是宿主发起时跳过;
 *  2) 命中 → 立刻回报 (保证第一下就能点到角色); 未命中 → 延迟 HIT_RELEASE_MS 才回报,
 *     期间再次命中就取消 (迟滞, 消除轮廓/动作造成的抖动);
 *  3) 按住鼠标 (拖动旋转) 时不回报"离开", 避免拖动中途被切断;
 *  4) 宿主发起的命中总是回报 (宿主可能自行把 iframe 切回 none, 不能只靠去重);
 *  5) 每次检测会触发一次 1×1 readPixels (GPU 同步): 再加一道最小间隔 HIT_MIN_INTERVAL_MS,
 *     距上次检测太近就等到间隔满再处理最新坐标;
 *  6) 更新的检测已发出时丢弃旧结果 (hitSeq)。
 */
import type { HitChangedEvent } from './types';

/** 未命中后延迟这么久才上报"离开" (迟滞)。 */
export const HIT_RELEASE_MS = 160;
/** 两次检测的最小间隔。 */
export const HIT_MIN_INTERVAL_MS = 33;

export interface HitGateClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  requestAnimationFrame(fn: () => void): unknown;
  cancelAnimationFrame(handle: unknown): void;
}

export interface HitGateDeps {
  /** 真正的命中检测 (异步: 结果在下一帧渲染完后给出)。 */
  test(x: number, y: number): Promise<boolean>;
  /** 命中状态变化 (或宿主发起时的对齐重发) 时调用。 */
  emit(ev: HitChangedEvent): void;
  /** 宿主已销毁 → 丢弃一切后续结果。 */
  isDisposed(): boolean;
  /** 默认用全局 performance / setTimeout / requestAnimationFrame (调用时才取, import 阶段不碰 DOM)。 */
  clock?: HitGateClock;
}

const defaultClock: HitGateClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  requestAnimationFrame: (fn) => requestAnimationFrame(fn),
  cancelAnimationFrame: (h) => cancelAnimationFrame(h as number),
};

interface Query { x: number; y: number; fromHost: boolean; buttons: number }

export class HitGate {
  private deps: HitGateDeps;
  private clock: HitGateClock;

  /** null = 还没报告过任何状态。 */
  private lastHit: boolean | null = null;
  private hitRaf: unknown = 0;
  private hitDelayTimer: unknown = null;
  private hitReleaseTimer: unknown = null;
  private pendingHit: Query | null = null;
  private lastTested: { x: number; y: number } | null = null;
  private lastHitTestAt = 0;
  private hitSeq = 0;

  constructor(deps: HitGateDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? defaultClock;
  }

  /** 报告一个待检测的坐标 (pointermove / 宿主 xc.pointer)。 */
  report(x: number, y: number, fromHost = false, buttons = 0): void {
    this.pendingHit = { x, y, fromHost, buttons };
    if (this.hitRaf || this.hitDelayTimer) return;
    const wait = HIT_MIN_INTERVAL_MS - (this.clock.now() - this.lastHitTestAt);
    if (wait > 0) {
      this.hitDelayTimer = this.clock.setTimeout(() => {
        this.hitDelayTimer = null;
        this.hitRaf = this.clock.requestAnimationFrame(() => this.process());
      }, wait);
    } else {
      this.hitRaf = this.clock.requestAnimationFrame(() => this.process());
    }
  }

  /** 指针离开文档 (mouseleave): 立刻报告"没命中", 并作废在途检测。 */
  leave(): void {
    if (this.hitReleaseTimer) { this.clock.clearTimeout(this.hitReleaseTimer); this.hitReleaseTimer = null; }
    this.pendingHit = null;
    this.hitSeq++;
    if (this.lastHit === false) return;
    this.lastHit = false;
    this.deps.emit({ type: 'hit-changed', hit: false, x: -1, y: -1 });
  }

  /**
   * 作废"上次已报告的命中状态"和"上次检测的坐标"。场景透明 ↔ 非透明切换后, 宿主侧的 pointer-events 已被重置,
   * 去重状态不作废的话, 指针不动时第一次命中会被当成"没变化"吞掉。
   */
  reset(): void {
    this.lastHit = null;
    this.lastTested = null;
  }

  /** 只作废"上次检测的坐标" (保留命中状态与迟滞): 让同一坐标可以被重新检测, 例如菜单关闭后按最后指针位置重判。 */
  forgetTested(): void {
    this.lastTested = null;
  }

  dispose(): void {
    if (this.hitRaf) this.clock.cancelAnimationFrame(this.hitRaf);
    if (this.hitDelayTimer) this.clock.clearTimeout(this.hitDelayTimer);
    if (this.hitReleaseTimer) this.clock.clearTimeout(this.hitReleaseTimer);
  }

  private sendHit(hit: boolean, x: number, y: number): void {
    if (hit === this.lastHit) return;
    this.lastHit = hit;
    this.deps.emit({ type: 'hit-changed', hit, x, y });
  }

  private process(): void {
    this.hitRaf = 0;
    const q = this.pendingHit;
    this.pendingHit = null;
    if (!q || this.deps.isDisposed()) return;
    if (!q.fromHost && this.lastTested && Math.abs(q.x - this.lastTested.x) < 1 && Math.abs(q.y - this.lastTested.y) < 1) return;
    this.lastTested = { x: q.x, y: q.y };
    this.lastHitTestAt = this.clock.now();
    const seq = ++this.hitSeq;
    // 像素级检测: 结果在这一帧渲染完后给出; 更新的检测已发出则丢弃旧结果
    void this.deps.test(q.x, q.y).then((hit) => {
      if (this.deps.isDisposed() || seq !== this.hitSeq) return;
      this.apply(q, hit);
    });
  }

  private apply(q: Query, hit: boolean): void {
    if (hit) {
      if (this.hitReleaseTimer) { this.clock.clearTimeout(this.hitReleaseTimer); this.hitReleaseTimer = null; }
      if (this.lastHit !== true) this.sendHit(true, q.x, q.y);
      else if (q.fromHost) this.deps.emit({ type: 'hit-changed', hit: true, x: q.x, y: q.y, resend: true }); // 宿主侧可能已切回 none, 重发以对齐
      return;
    }
    if (this.lastHit !== true || this.hitReleaseTimer) return; // 本来就没命中 / 已在倒计时
    if (q.buttons !== 0) return; // 拖动中不松手
    this.hitReleaseTimer = this.clock.setTimeout(() => {
      this.hitReleaseTimer = null;
      this.sendHit(false, q.x, q.y);
    }, HIT_RELEASE_MS);
  }
}
