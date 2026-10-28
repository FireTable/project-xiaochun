import * as THREE from 'three';

/** 退出故事 / 导演运镜后，镜头回到默认视角的时长 (ms) */
export const VIEW_RETURN_MS = 1000;

export interface ViewPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  /** 镜头滚转 (rad)，荷兰角 dutch_tilt 用 */
  roll: number;
}

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function lerpViewPose(from: ViewPose, to: ViewPose, t: number, out: ViewPose): ViewPose {
  out.position.lerpVectors(from.position, to.position, t);
  out.target.lerpVectors(from.target, to.target, t);
  out.fov = THREE.MathUtils.lerp(from.fov, to.fov, t);
  out.roll = THREE.MathUtils.lerp(from.roll, to.roll, t);
  return out;
}

export interface ViewReturnEnv {
  now: () => number;
  raf: (cb: () => void) => number;
  caf: (id: number) => void;
}

const defaultEnv = (): ViewReturnEnv => ({
  now: () => performance.now(),
  raf: (cb) => requestAnimationFrame(cb),
  caf: (id) => cancelAnimationFrame(id),
});

export interface ViewReturnHandle {
  /** 走完 (含终点帧) 为 true，被 cancel 为 false */
  done: Promise<boolean>;
  cancel: () => void;
}

/**
 * 在 durationMs 内把视角从 from 缓动到 to，每帧调用 apply。终点帧一定会精确写入 `to`。
 */
export function runViewReturn(
  from: ViewPose,
  to: ViewPose,
  durationMs: number,
  apply: (pose: ViewPose) => void,
  env: ViewReturnEnv = defaultEnv(),
): ViewReturnHandle {
  let rafId: number | null = null;
  let finished = false;
  let resolveDone: (v: boolean) => void = () => {};
  const done = new Promise<boolean>((r) => {
    resolveDone = r;
  });
  const frame: ViewPose = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: from.fov, roll: from.roll };
  const finish = (ok: boolean) => {
    if (finished) return;
    finished = true;
    if (rafId !== null) env.caf(rafId);
    rafId = null;
    resolveDone(ok);
  };

  if (durationMs <= 0) {
    apply(to);
    finish(true);
    return { done, cancel: () => {} };
  }

  const t0 = env.now();
  const step = () => {
    rafId = null;
    if (finished) return;
    const p = Math.min(1, (env.now() - t0) / durationMs);
    if (p >= 1) {
      apply(to);
      finish(true);
      return;
    }
    apply(lerpViewPose(from, to, easeInOutCubic(p), frame));
    rafId = env.raf(step);
  };
  rafId = env.raf(step);
  return { done, cancel: () => finish(false) };
}

export interface ViewReturnDeps {
  camera: THREE.PerspectiveCamera;
  controls: { target: THREE.Vector3; enabled: boolean; update: () => unknown } | null;
  director: { release: () => void; reset: () => void; getRoll: () => number; setRoll: (r: number) => void };
  /** 刷新页面后会落到的机位 (无模型 / 无 controls 时 null) */
  computeView: () => Omit<ViewPose, 'roll'> | null;
  /** 缓动结束后，用与刷新时完全相同的取景流程落点 (vrmEngine: fitCamera(true) + 渲染一帧) */
  settle: () => void;
  /** 角色朝向回到默认 (targetYawOffset) */
  restoreFacing: () => void;
  /** 回正期间告诉 bodyTurn “相机方位变化不算转身” */
  setHoldFacing: (hold: boolean) => void;
  /** 取消进行中的开场推镜头 */
  cancelIntro?: () => void;
  env?: ViewReturnEnv;
}

/** 退出故事 / 运镜后，把镜头平滑送回刷新页面后的默认视角。 */
export class ViewReturner {
  private handle: ViewReturnHandle | null = null;
  private readonly deps: () => ViewReturnDeps;

  constructor(deps: () => ViewReturnDeps) {
    this.deps = deps;
  }

  get active(): boolean {
    return this.handle !== null;
  }

  /** 中止进行中的回正，把相机控制权还给用户 */
  cancel(): void {
    const handle = this.handle;
    this.handle = null;
    if (!handle) return;
    const d = this.deps();
    d.setHoldFacing(false);
    handle.cancel();
    if (d.controls) d.controls.enabled = true;
  }

  async run(durationMs: number = VIEW_RETURN_MS): Promise<void> {
    this.cancel();
    const d = this.deps();
    d.director.release();
    d.cancelIntro?.();
    const view = d.controls ? d.computeView() : null;
    const controls = d.controls;
    if (!controls || !view) {
      d.director.reset();
      d.restoreFacing();
      return;
    }
    const camera = d.camera;
    const from: ViewPose = {
      position: camera.position.clone(),
      target: controls.target.clone(),
      fov: camera.fov,
      roll: d.director.getRoll(),
    };
    const to: ViewPose = { ...view, roll: 0 };
    d.setHoldFacing(true);
    controls.enabled = false;
    const handle = runViewReturn(
      from,
      to,
      durationMs,
      (pose) => {
        camera.position.copy(pose.position);
        controls.target.copy(pose.target);
        if (camera.fov !== pose.fov) {
          camera.fov = pose.fov;
          camera.updateProjectionMatrix();
        }
        d.director.setRoll(pose.roll);
        controls.update();
      },
      d.env,
    );
    this.handle = handle;
    const completed = await handle.done;
    if (this.handle !== handle) return; // 已被取消或被新的回正取代
    this.handle = null;
    d.setHoldFacing(false);
    controls.enabled = true;
    if (completed) {
      d.director.reset();
      d.settle();
    }
    d.restoreFacing();
  }
}
