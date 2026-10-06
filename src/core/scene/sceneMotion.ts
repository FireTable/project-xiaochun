/**
 * sceneMotion.ts — 场景"局部动态"的统一降级逻辑 (海滩 beach3d 使用)。
 *
 * 动态 (海面波光 / 云漂移 / 花瓣 / 树叶摆动 ...) 生效的条件:
 *   cfg.enabled && !(cfg.respectReducedMotion && 系统开启了"减少动态效果") && !本次会话已因低帧率降级。
 * 低帧率降级: 只在动态开启时统计帧间隔, 每 max(30, windowFrames) 帧算一次平均帧率, 低于 minFps 就把动态关掉,
 * 直到下一次 reset() (引擎在重新进入该场景时调用, 即切走再切回会重新评估)。
 * 动画时钟 time() = staticTime + 动态生效期间累计的秒数: 一开始就静止 → 停在 staticTime (调用方挑的好看时刻);
 * 中途关掉 (降级 / reduced-motion) → 停在当时的画面, 不会跳回 staticTime (以前会: 云 "走着走着突然复位不动")。
 * 环境漂移时钟 driftTime() (云 / 卷云这类极慢的漂移): 只看总开关和 reduced-motion, 不受低帧率降级影响 ——
 * 漂移只是一个 uniform, 降级省不下任何开销, 冻住反而像卡死。两个时钟都只累加、从不取模或复位。
 */

export interface SceneMotionConfig {
  enabled: boolean;
  respectReducedMotion: boolean;
  autoDowngrade: { enabled: boolean; minFps: number; windowFrames: number };
}

export class SceneMotionGovernor {
  /** 本次会话是否已因低帧率关闭动态 (截图 / 调试脚本可直接改写)。 */
  public downgraded = false;

  private reducedMotion = false;
  private mql: MediaQueryList | null = null;
  private mqlHandler: (() => void) | null = null;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private lastNow = 0;
  private clockT = 0;
  private driftT = 0;
  private lastDt = 0;

  private readonly getConfig: () => SceneMotionConfig;

  constructor(getConfig: () => SceneMotionConfig) {
    this.getConfig = getConfig;
  }

  /** 监听 prefers-reduced-motion (重复调用无副作用)。 */
  public watchReducedMotion(): void {
    if (this.mql || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    try {
      this.mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = this.mql.matches;
      this.mqlHandler = () => { this.reducedMotion = Boolean(this.mql?.matches); };
      this.mql.addEventListener('change', this.mqlHandler);
    } catch { /* 老浏览器: 当作未开启 */ }
  }

  /** 重新进入场景时调用: 清空帧率统计, 撤销上次的降级。 */
  public reset(): void {
    this.downgraded = false;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.lastNow = 0;
  }

  public isReducedMotion(): boolean {
    return this.reducedMotion;
  }

  /** 环境漂移 (云 / 卷云) 是否在走: 总开关 + reduced-motion, 不看低帧率降级。 */
  public isDriftOn(): boolean {
    const c = this.getConfig();
    return c.enabled && !(c.respectReducedMotion && this.reducedMotion);
  }

  /** 动态当前是否生效。 */
  public isOn(): boolean {
    const c = this.getConfig();
    return c.enabled && !(c.respectReducedMotion && this.reducedMotion) && !this.downgraded;
  }

  /**
   * 每帧调用一次 (渲染前)。返回本帧动态是否生效; 之后用 time() / dt() 取动画时钟。
   * now: performance.now() 毫秒。
   */
  public tick(now: number): boolean {
    const c = this.getConfig();
    // 同一帧内被调用多次 (例如后期管线在一帧里渲染了两次场景): 不重复计帧, 否则平均帧率会被低估
    if (this.lastNow > 0 && now - this.lastNow < 2) { this.lastDt = 0; return this.isOn(); }
    const dt = this.lastNow > 0 ? Math.min(0.25, Math.max(0, (now - this.lastNow) / 1000)) : 0;
    this.lastNow = now;
    const ad = c.autoDowngrade;
    if (ad.enabled && c.enabled && !this.downgraded && dt > 0) {
      this.fpsAcc += dt;
      this.fpsFrames++;
      if (this.fpsFrames >= Math.max(30, ad.windowFrames)) {
        const avgFps = this.fpsFrames / this.fpsAcc;
        if (avgFps < ad.minFps) this.downgraded = true;
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
    }
    const on = this.isOn();
    this.lastDt = dt;
    if (on) this.clockT += dt;
    if (this.isDriftOn()) this.driftT += dt;
    return on;
  }

  /** 本帧的真实帧间隔 (秒, 已夹到 0.25)。 */
  public dt(): number {
    return this.lastDt;
  }

  /** 动画时钟 (秒) = staticTime + 动态生效期间的累计时长: 生效时持续前进, 关闭时停在当前值 (从未生效过 = staticTime)。 */
  public time(staticTime: number): number {
    return staticTime + this.clockT;
  }

  /** 环境漂移时钟 (秒) = staticTime + 漂移生效期间的累计时长 (低帧率降级时照常前进, 见 isDriftOn)。 */
  public driftTime(staticTime: number): number {
    return staticTime + this.driftT;
  }

  public dispose(): void {
    if (this.mql && this.mqlHandler) {
      try { this.mql.removeEventListener('change', this.mqlHandler); } catch { /* ignore */ }
    }
    this.mql = null;
    this.mqlHandler = null;
  }
}
