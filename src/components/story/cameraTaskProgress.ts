/**
 * 视角教学卡的任务进度 (纯逻辑)。只吃“用户输入”：
 * - onTurn：手势状态机的 turn 事件 (真实指针拖动，dx 横向 / dy 纵向)；
 * - onZoom：InteractionController.onUserZoom (画布滚轮 / 双指 / 中键拖动)。
 * 不读相机位置、视距或 OrbitControls 的 change，所以导演运镜、fitCamera、回默认视角都不可能打勾。
 */
export const CAMERA_TASK_THRESHOLDS = {
  /** 累计横向拖动 (px) → 环视 */
  orbitPx: 80,
  /** 累计纵向拖动 (px) → 俯仰 */
  pitchPx: 50,
  /** 累计缩放量 (滚轮 |deltaY| 或手指间距 px) → 缩放 */
  zoomAmount: 50,
} as const;

export interface CameraTaskState {
  orbit: boolean;
  pitch: boolean;
  zoom: boolean;
}

export class CameraTaskProgress {
  private dx = 0;
  private dy = 0;
  private zoom = 0;
  public state: CameraTaskState = { orbit: false, pitch: false, zoom: false };

  /** 返回状态是否有变化 */
  public onTurn(dx: number, dy: number): boolean {
    this.dx += Math.abs(dx);
    this.dy += Math.abs(dy);
    return this.sync();
  }

  public onZoom(amount: number): boolean {
    this.zoom += Math.abs(amount);
    return this.sync();
  }

  private sync(): boolean {
    const next: CameraTaskState = {
      orbit: this.state.orbit || this.dx >= CAMERA_TASK_THRESHOLDS.orbitPx,
      pitch: this.state.pitch || this.dy >= CAMERA_TASK_THRESHOLDS.pitchPx,
      zoom: this.state.zoom || this.zoom >= CAMERA_TASK_THRESHOLDS.zoomAmount,
    };
    const changed = next.orbit !== this.state.orbit || next.pitch !== this.state.pitch || next.zoom !== this.state.zoom;
    this.state = next;
    return changed;
  }
}
