import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { VRM } from '@pixiv/three-vrm';
import type { CameraDirective, CameraShotType } from '@/story/schema';

export interface CameraDirectorContext {
  camera: THREE.PerspectiveCamera;
  controls?: OrbitControls | null;
  getControls?: () => OrbitControls | null;
  getVRM: () => VRM | null;
  getSunDirection?: () => THREE.Vector3 | null;
  onApplyGroundClamp?: () => void;
  setWindMultiplier?: (mult: number) => void;
  /** 页面刷新后的默认 FOV (宿主可覆盖)；缺省 30 */
  getDefaultFov?: () => number;
}

export interface ShotPresetConfig {
  distance: number;
  targetYOffset: number; // 相对头骨 (head.y) 的垂直偏移，负值向下
  pitch: number;         // 俯仰极角 (弧度，PI/2 约为平视)
  fov: number;
}

export const SHOT_PRESETS: Record<CameraShotType, ShotPresetConfig> = {
  extreme_close_up: {
    distance: 1.10,
    targetYOffset: -0.08, // 聚焦眼眸与微表情
    pitch: Math.PI * 0.50,
    fov: 22,
  },
  close_up: {
    distance: 1.45,
    targetYOffset: -0.16, // 聚焦下巴与锁骨
    pitch: Math.PI * 0.50,
    fov: 26,
  },
  medium: {
    distance: 2.20,
    targetYOffset: -0.25, // 默认半身交流景 (胸口)
    pitch: Math.PI * 0.49,
    fov: 30,
  },
  full: {
    distance: 2.95,
    targetYOffset: -0.47, // 聚焦骨盆腰腹中心，使角色从发顶至鞋底占据画面约 88% 黄金视高
    pitch: Math.PI * 0.49,
    fov: 30,
  },
  dramatic_low: {
    distance: 1.70,
    targetYOffset: -0.32,
    pitch: 1.74,          // 低机位仰视
    fov: 28,
  },
};

/** 荷兰角滚转弧度 (约 -9°，画面向右倾斜，传达“迟疑 / 不安”) */
export const DUTCH_TILT_RAD = (-9 * Math.PI) / 180;

/** 把角度差折到 (-π, π]，保证环绕走最短弧，不穿过角色 */
function wrapPi(a: number): number {
  const twoPi = Math.PI * 2;
  let r = ((a + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  if (r <= -Math.PI) r += twoPi;
  return r;
}

/** 五次平滑步阶曲线 (首尾导数严格为 0，杜绝机械顿挫) */
function quinticSmootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 悠长电影减速曲线 */
function easeOutDramatic(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

/** 兼容 Node/SSR 与浏览器的零崩溃 requestAnimationFrame 封装 */
function safeRaf(cb: (time: number) => void): number {
  if (typeof requestAnimationFrame !== 'undefined') {
    return requestAnimationFrame(cb);
  }
  return setTimeout(() => cb(performance.now()), 16) as unknown as number;
}

function safeCancelRaf(id: number): void {
  if (typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(id);
  } else {
    clearTimeout(id);
  }
}

export class CameraDirector {
  private ctx: CameraDirectorContext | null = null;
  private currentTweenRaf: number | null = null;
  private isTweening = false;
  /** 当前镜头滚转 (弧度)，由 dutch_tilt 写入，其它运镜会把它缓动回 0 */
  private rollRad = 0;

  // 临时向量复用，零 GC
  private tempHeadPos = new THREE.Vector3();
  private tempTarget = new THREE.Vector3();
  private tempStartPos = new THREE.Vector3();
  private tempEndPos = new THREE.Vector3();
  private tempStartTarget = new THREE.Vector3();
  private tempEndTarget = new THREE.Vector3();

  public bind(ctx: CameraDirectorContext): void {
    this.ctx = ctx;
  }

  public get active(): boolean {
    return this.isTweening;
  }

  /** 当前镜头滚转 (弧度) */
  public getRoll(): number {
    return this.rollRad;
  }

  /** 直接设置镜头滚转 (rad)；退出故事时的回正缓动用 */
  public setRoll(rad: number): void {
    this.rollRad = rad;
  }

  /**
   * 放开导演控制：停掉进行中的运镜、释放阵风倍率。不动相机位置 / 滚转 / FOV，
   * 留给调用方做平滑回正 (见 vrmEngine.returnToDefaultView)。
   */
  public release(): void {
    this.stopTransition();
    this.ctx?.setWindMultiplier?.(1.0);
  }

  /**
   * 在相机朝向被重算 (controls.update → lookAt) 之后调用，把当前滚转叠加回去。
   * vrmEngine 在 controls.update 的包装里调用它，所以任何时刻渲染的画面都带着同一个滚转。
   */
  public applyRoll(): void {
    const camera = this.ctx?.camera;
    if (!camera || Math.abs(this.rollRad) < 1e-5 || typeof camera.rotateZ !== 'function') return;
    camera.rotateZ(this.rollRad);
  }

  private getControls(): OrbitControls | null {
    if (!this.ctx) return null;
    return this.ctx.getControls ? this.ctx.getControls() : this.ctx.controls ?? null;
  }

  /**
   * 中断当前的运镜过渡，摄像机在当前瞬时位置柔和定格
   */
  public stopTransition(): void {
    if (this.currentTweenRaf !== null) {
      safeCancelRaf(this.currentTweenRaf);
      this.currentTweenRaf = null;
    }
    const controls = this.getControls();
    if (controls) {
      controls.enabled = true;
      controls.update();
    }
    if (this.ctx && this.isTweening) {
      this.ctx.setWindMultiplier?.(1.0);
    }
    this.isTweening = false;
  }

  /**
   * 退出故事剧场时彻底重置镜头，恢复自由 OrbitControls 与标准 FOV
   */
  public reset(): void {
    this.release();
    this.rollRad = 0;
    const camera = this.ctx?.camera;
    if (camera) {
      camera.fov = this.ctx?.getDefaultFov?.() ?? 30;
      camera.updateProjectionMatrix();
    }
    const controls = this.getControls();
    if (controls) {
      controls.enabled = true;
      controls.update();
    }
  }

  /**
   * 执行电影运镜调度指令
   */
  public async transitionTo(directive: CameraDirective): Promise<void> {
    if (!this.ctx) return;
    const { camera, getVRM, onApplyGroundClamp, setWindMultiplier } = this.ctx;
    const controls = this.getControls();
    const vrm = getVRM();
    if (!vrm) return;

    this.stopTransition();

    // 1. 获取目标头骨基准点
    const headNode = vrm.humanoid?.getNormalizedBoneNode('head');
    if (!headNode) return;
    headNode.getWorldPosition(this.tempHeadPos);

    // 2. 解算预设参数
    const shot = directive.shot || 'medium';
    const preset = SHOT_PRESETS[shot] || SHOT_PRESETS.medium;
    const targetY = this.tempHeadPos.y + preset.targetYOffset;
    this.tempEndTarget.set(this.tempHeadPos.x, targetY, this.tempHeadPos.z);

    let targetDistance = preset.distance;
    let targetPitch = preset.pitch;
    let targetFov = directive.targetFov ?? preset.fov;

    const trajectory = directive.movement;
    const isBacklightReveal = trajectory === 'hero_backlight_reveal';
    const wantBacklight = Boolean(directive.alignSunBacklight) || isBacklightReveal;

    // 英雄逆光破晓：压低机位 (略仰拍，让人物压在落日轮廓上) 并收窄视角
    if (isBacklightReveal) {
      targetPitch = Math.max(targetPitch, 1.66);
      targetFov = Math.max(15, targetFov - 3);
    }

    // 3. 计算终点摄像机位置 (在当前方位角或逆光方位角基础上推演)
    let currentAzimuth = 0;
    if (controls && typeof controls.getAzimuthalAngle === 'function') {
      try {
        currentAzimuth = controls.getAzimuthalAngle();
      } catch {
        currentAzimuth = Math.atan2(camera.position.x - this.tempEndTarget.x, camera.position.z - this.tempEndTarget.z);
      }
    } else {
      currentAzimuth = Math.atan2(camera.position.x - this.tempEndTarget.x, camera.position.z - this.tempEndTarget.z);
    }

    // 若要求逆光对齐太阳：摄像机移到太阳的反方向，让小蠢挡在太阳与镜头之间。
    // 方位角差折成最短弧、按环绕插值 (而不是起终点直线插值——直线会在两侧差近 180° 时穿过角色身体)。
    const actualAzimuth = currentAzimuth;
    let backlightDeltaRad = 0;
    if (wantBacklight && this.ctx.getSunDirection) {
      const sunDir = this.ctx.getSunDirection();
      if (sunDir && (Math.abs(sunDir.x) > 1e-4 || Math.abs(sunDir.z) > 1e-4)) {
        backlightDeltaRad = wrapPi(Math.atan2(-sunDir.x, -sunDir.z) - actualAzimuth);
      }
    }

    const isHeroOrbit = trajectory === 'hero_spiral_orbit';
    const isPedestalUp = trajectory === 'pedestal_up';
    const isArcSweep = trajectory === 'arc_sweep';
    const isOrbitSubtle = trajectory === 'orbit_subtle';
    const isPushIn = trajectory === 'push_in';
    const isPullOut = trajectory === 'pull_out';
    const hasCustomOrbit = directive.orbitAngleDeg !== undefined;

    // 解析环绕方位角增量
    let orbitDeltaRad = backlightDeltaRad;
    if (hasCustomOrbit) {
      if (Math.abs(directive.orbitAngleDeg!) >= 360) {
        // 大于等于 360° 表示显式多圈/整圈大旋转
        orbitDeltaRad += (directive.orbitAngleDeg! * Math.PI) / 180;
      } else {
        // 将 orbitAngleDeg 视为目标机位相对角色正面的水平朝向角 (0° = 正前方，90° = 正侧方)
        // 通过 wrapPi 计算走最短弧度平滑旋转到指定朝向，避免连续调用导致机位无休止漂移到角色身后
        const targetAzimuth = (directive.orbitAngleDeg! * Math.PI) / 180;
        orbitDeltaRad += wrapPi(targetAzimuth - currentAzimuth);
      }
    } else if (isHeroOrbit) {
      orbitDeltaRad += Math.PI * 2.0; // 360° 英雄全景环绕
    } else if (isArcSweep) {
      orbitDeltaRad += Math.PI * 0.22; // ~40° 侧方弧度横摇
    } else if (isOrbitSubtle) {
      orbitDeltaRad += Math.PI * 0.12; // ~21.6° 微妙环绕微动
    }
    const hasOrbitalMotion = Math.abs(orbitDeltaRad) > 0.001;
    const finalAzimuth = currentAzimuth + orbitDeltaRad;

    // 若动作指定推近/后拉，且未跨景别导致距离无差异时，赋予微动景深
    const currentDistance = camera.position.distanceTo(controls && controls.target ? controls.target : this.tempEndTarget);
    if (isPushIn && Math.abs(currentDistance - targetDistance) < 0.15) {
      targetDistance = Math.max(0.9, targetDistance * 0.82);
    } else if (isPullOut && Math.abs(currentDistance - targetDistance) < 0.15) {
      targetDistance = Math.min(5.0, targetDistance * 1.25);
    }

    // 球坐标计算终点位置 (基于 finalAzimuth 与 targetPitch, targetDistance)
    const sinPitch = Math.sin(targetPitch);
    const cosPitch = Math.cos(targetPitch);
    const endX = this.tempEndTarget.x + targetDistance * sinPitch * Math.sin(finalAzimuth);
    const endY = this.tempEndTarget.y + targetDistance * cosPitch;
    const endZ = this.tempEndTarget.z + targetDistance * sinPitch * Math.cos(finalAzimuth);
    this.tempEndPos.set(endX, endY, endZ);

    // 4. 起点状态捕获 (支持常规起点捕获与垂直升镜专用起点)
    if (isPedestalUp) {
      const startTargetY = this.tempHeadPos.y - 0.70;
      this.tempStartTarget.set(this.tempHeadPos.x, startTargetY, this.tempHeadPos.z);
      // 若当前相机已处于裙摆高度 (如黑屏 panUpReveal 准备阶段)，直接复用
      if (Math.abs(camera.position.y - Math.max(0.50, startTargetY)) > 0.2 && (!controls || !controls.target || Math.abs(controls.target.y - startTargetY) > 0.2)) {
        const startPitch = 1.53;
        const startDist = targetDistance * 1.08;
        const startX = this.tempStartTarget.x + startDist * Math.sin(startPitch) * Math.sin(currentAzimuth);
        const startY = this.tempStartTarget.y + startDist * Math.cos(startPitch);
        const startZ = this.tempStartTarget.z + startDist * Math.sin(startPitch) * Math.cos(currentAzimuth);
        this.tempStartPos.set(startX, Math.max(0.50, startY), startZ);
        camera.position.copy(this.tempStartPos);
      } else {
        this.tempStartPos.copy(camera.position);
      }
      if (controls && controls.target) {
        controls.target.copy(this.tempStartTarget);
        controls.enabled = false;
      }
      camera.lookAt(this.tempStartTarget);
    } else {
      this.tempStartPos.copy(camera.position);
      if (controls && controls.target) {
        this.tempStartTarget.copy(controls.target);
        controls.enabled = false;
      } else {
        this.tempStartTarget.set(this.tempEndTarget.x, this.tempEndTarget.y, this.tempEndTarget.z);
      }
    }
    const startFov = camera.fov;
    // 荷兰角：dutch_tilt 把滚转缓动到 -9°，其它任何运镜把残留滚转缓动回 0
    const startRoll = this.rollRad;
    const targetRoll = trajectory === 'dutch_tilt' ? DUTCH_TILT_RAD : 0;

    // 5. 风力联动
    if (directive.windMultiplier && directive.windMultiplier > 1.0) {
      setWindMultiplier?.(directive.windMultiplier);
    }

    // 6. 曲线调度
    const durationMs = Math.max(200, (directive.durationSec || 1.2) * 1000);
    const startTime = performance.now();
    this.isTweening = true;

    const easingFn =
      directive.easing === 'ease_out_dramatic'
        ? easeOutDramatic
        : directive.easing === 'linear'
        ? (p: number) => p
        : quinticSmootherstep;

    return new Promise<void>((resolve) => {
      const tick = (now: number) => {
        this.currentTweenRaf = null;
        const progress = Math.min(1.0, (now - startTime) / durationMs);
        const eased = easingFn(progress);

        if (hasOrbitalMotion) {
          // 环绕轨迹：方位角旋转，半径与俯仰平滑推移
          const angle = currentAzimuth + eased * orbitDeltaRad;
          const curDist = THREE.MathUtils.lerp(this.tempStartPos.distanceTo(this.tempStartTarget), targetDistance, eased);
          const curPitch = controls && typeof controls.getPolarAngle === 'function'
            ? THREE.MathUtils.lerp(controls.getPolarAngle(), targetPitch, eased)
            : targetPitch;

          this.tempTarget.lerpVectors(this.tempStartTarget, this.tempEndTarget, eased);
          if (controls && controls.target) {
            controls.target.copy(this.tempTarget);
          }

          const sP = Math.sin(curPitch);
          const cP = Math.cos(curPitch);
          camera.position.set(
            this.tempTarget.x + curDist * sP * Math.sin(angle),
            this.tempTarget.y + curDist * cP,
            this.tempTarget.z + curDist * sP * Math.cos(angle)
          );
        } else {
          // 常规运镜插值
          this.tempTarget.lerpVectors(this.tempStartTarget, this.tempEndTarget, eased);
          if (controls && controls.target) {
            controls.target.copy(this.tempTarget);
          }
          camera.position.lerpVectors(this.tempStartPos, this.tempEndPos, eased);
        }

        // FOV 动态插值
        if (Math.abs(camera.fov - targetFov) > 0.01) {
          camera.fov = THREE.MathUtils.lerp(startFov, targetFov, eased);
          camera.updateProjectionMatrix();
        }

        camera.lookAt(controls && controls.target ? controls.target : this.tempTarget);
        onApplyGroundClamp?.();
        if (startRoll !== targetRoll) {
          this.rollRad = THREE.MathUtils.lerp(startRoll, targetRoll, eased);
        }
        this.applyRoll();

        if (progress < 1.0) {
          this.currentTweenRaf = safeRaf(tick);
        } else {
          // 结束复位与收敛
          camera.position.copy(this.tempEndPos);
          this.rollRad = targetRoll;
          if (controls && controls.target) {
            controls.target.copy(this.tempEndTarget);
            controls.enabled = true;
            controls.update();
          } else {
            camera.lookAt(this.tempEndTarget);
            this.applyRoll();
          }
          camera.fov = targetFov;
          camera.updateProjectionMatrix();
          this.isTweening = false;
          setWindMultiplier?.(1.0);
          resolve();
        }
      };

      this.currentTweenRaf = safeRaf(tick);
    });
  }

  /**
   * 预先将摄像机机位与观察目标点对齐至裙摆脚踝低机位 (在黑屏期间调用，避免黑幕揭开时镜头瞬间跳跃)
   */
  /**
   * 预先将摄像机机位与观察目标点对齐至裙摆优雅视高 (在黑屏期间调用，避免黑幕揭开时镜头瞬间跳跃)
   */
  public preparePanUpStart(): void {
    if (!this.ctx) return;
    const { camera, getVRM } = this.ctx;
    const controls = this.getControls();
    const vrm = getVRM();
    if (!vrm) return;

    this.stopTransition();

    const headNode = vrm.humanoid?.getNormalizedBoneNode('head');
    if (!headNode) return;
    headNode.getWorldPosition(this.tempHeadPos);

    // 终点目标：上半身中景 (胸口高度)
    const endTarget = new THREE.Vector3(this.tempHeadPos.x, this.tempHeadPos.y - 0.20, this.tempHeadPos.z);
    // 起点目标：从贴地脚踝(-1.25)上抬至裙摆中下部(-0.70)，构图更加大气典雅
    const startTarget = new THREE.Vector3(this.tempHeadPos.x, this.tempHeadPos.y - 0.70, this.tempHeadPos.z);

    const currentAzimuth = Math.atan2(camera.position.x - endTarget.x, camera.position.z - endTarget.z);

    // 起点机位：上抬至 0.65m 视高 (距离 2.25m, pitch 1.53 rad 接近微仰平视，杜绝贴地扫地面)
    const startPitch = 1.53;
    const startDist = 2.25;
    const startX = startTarget.x + startDist * Math.sin(startPitch) * Math.sin(currentAzimuth);
    const startY = startTarget.y + startDist * Math.cos(startPitch);
    const startZ = startTarget.z + startDist * Math.sin(startPitch) * Math.cos(currentAzimuth);
    const startPos = new THREE.Vector3(startX, Math.max(0.50, startY), startZ);

    camera.position.copy(startPos);
    camera.fov = 30;
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(startTarget);
      controls.enabled = false;
    }
    camera.lookAt(startTarget);
  }

  /**
   * 自下而上打量面前少女的电影级升降运镜 (裙摆腰身 -> 上半身中景聚焦)
   * 完全复用通用 transitionTo({ shot: 'medium', movement: 'pedestal_up' })，AI 剧本生成与程序化调用均可无缝驱动
   */
  public async panUpReveal(durationSec = 2.2): Promise<void> {
    return this.transitionTo({
      shot: 'medium',
      movement: 'pedestal_up',
      durationSec,
      easing: 'quintic_smooth',
    });
  }
}

export const cameraDirector = new CameraDirector();
