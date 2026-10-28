/**
 * 镜头任务 (cameraTask) 的“用户有没有真的动过视角”检测。纯逻辑，不依赖引擎，方便单测。
 *
 * - 旋转：累计 |Δ相机方位角| + |Δ角色朝向偏移 (水平拖拽转的是角色)| + |Δ俯仰角|，换算成度，达到 orbitDeg 即算完成。
 *   累计而不是净位移：用户来回晃也算“动过了”。
 * - 缩放：视距相对起始视距的最大偏离比例，达到 zoomRatio 即算完成。
 * 两个条件满足任意一个就完成。
 */

export interface ViewSample {
  /** 相机方位角 (rad) */
  azimuth: number;
  /** 相机俯仰角 (rad) */
  polar: number;
  /** 角色朝向偏移 (rad，水平拖拽) */
  yaw: number;
  /** 视距 (m) */
  distance: number;
}

export interface ViewTaskProgress {
  orbitDeg: number;
  zoomRatio: number;
  done: boolean;
}

const TWO_PI = Math.PI * 2;

/** 角度差折到 (-π, π]：方位角越过 ±π 时不会被算成一整圈 */
function wrapDelta(a: number, b: number): number {
  let d = (a - b) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
}

export class ViewTaskTracker {
  private readonly orbitGoalDeg: number;
  private readonly zoomGoalRatio: number;
  private last: ViewSample | null = null;
  private startDistance = 0;
  private orbitRad = 0;
  private zoomPeak = 0;

  constructor(orbitGoalDeg: number, zoomGoalRatio: number) {
    this.orbitGoalDeg = orbitGoalDeg;
    this.zoomGoalRatio = zoomGoalRatio;
  }

  /** 记下起点 (镜头任务开始、导演自己的运镜已经结束之后调用) */
  public begin(sample: ViewSample): void {
    this.last = sample;
    this.startDistance = sample.distance;
    this.orbitRad = 0;
    this.zoomPeak = 0;
  }

  public update(sample: ViewSample): ViewTaskProgress {
    if (!this.last) this.begin(sample);
    const prev = this.last as ViewSample;
    this.orbitRad +=
      Math.abs(wrapDelta(sample.azimuth, prev.azimuth)) +
      Math.abs(wrapDelta(sample.yaw, prev.yaw)) +
      Math.abs(sample.polar - prev.polar);
    if (this.startDistance > 1e-6) {
      this.zoomPeak = Math.max(this.zoomPeak, Math.abs(sample.distance - this.startDistance) / this.startDistance);
    }
    this.last = sample;
    const orbitDeg = (this.orbitRad * 180) / Math.PI;
    return {
      orbitDeg,
      zoomRatio: this.zoomPeak,
      done: orbitDeg >= this.orbitGoalDeg || this.zoomPeak >= this.zoomGoalRatio,
    };
  }
}
