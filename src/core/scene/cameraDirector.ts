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
    distance: 3.80,
    targetYOffset: -0.55, // 聚焦腰腹，全身尽收眼底
    pitch: Math.PI * 0.48,
    fov: 35,
  },
  dramatic_low: {
    distance: 1.70,
    targetYOffset: -0.32,
    pitch: 1.74,          // 低机位仰视
    fov: 28,
  },
};

/** 五次平滑步阶曲线 (首尾导数严格为 0，杜绝机械顿挫) */
function quinticSmootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 悠长电影减速曲线 */
function easeOutDramatic(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

export class CameraDirector {
  private ctx: CameraDirectorContext | null = null;
  private currentTweenRaf: number | null = null;
  private isTweening = false;

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

  private getControls(): OrbitControls | null {
    if (!this.ctx) return null;
    return this.ctx.getControls ? this.ctx.getControls() : this.ctx.controls ?? null;
  }

  /**
   * 中断当前的运镜过渡，摄像机在当前瞬时位置柔和定格
   */
  public stopTransition(): void {
    if (this.currentTweenRaf !== null) {
      cancelAnimationFrame(this.currentTweenRaf);
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
    this.stopTransition();
    const camera = this.ctx?.camera;
    if (camera) {
      camera.fov = 30;
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

    const targetDistance = preset.distance;
    const targetPitch = preset.pitch;
    const targetFov = directive.targetFov ?? preset.fov;

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

    // 若要求逆光对齐太阳：
    if (directive.alignSunBacklight && this.ctx.getSunDirection) {
      const sunDir = this.ctx.getSunDirection();
      if (sunDir) {
        // 摄像机移到太阳的反方向，让小蠢挡在太阳与镜头之间
        currentAzimuth = Math.atan2(-sunDir.x, -sunDir.z);
      }
    }

    // 球坐标计算终点位置
    const sinPitch = Math.sin(targetPitch);
    const cosPitch = Math.cos(targetPitch);
    const endX = this.tempEndTarget.x + targetDistance * sinPitch * Math.sin(currentAzimuth);
    const endY = this.tempEndTarget.y + targetDistance * cosPitch;
    const endZ = this.tempEndTarget.z + targetDistance * sinPitch * Math.cos(currentAzimuth);
    this.tempEndPos.set(endX, endY, endZ);

    const trajectory = directive.movement;
    const isHeroOrbit = trajectory === 'hero_spiral_orbit';
    const isPedestalUp = trajectory === 'pedestal_up';

    // 4. 起点状态捕获 (支持常规起点捕获与垂直升镜专用起点)
    if (isPedestalUp) {
      const startTargetY = this.tempHeadPos.y - 0.70;
      this.tempStartTarget.set(this.tempHeadPos.x, startTargetY, this.tempHeadPos.z);
      const startPitch = 1.53;
      const startDist = targetDistance * 1.08;
      const startX = this.tempStartTarget.x + startDist * Math.sin(startPitch) * Math.sin(currentAzimuth);
      const startY = this.tempStartTarget.y + startDist * Math.cos(startPitch);
      const startZ = this.tempStartTarget.z + startDist * Math.sin(startPitch) * Math.cos(currentAzimuth);
      this.tempStartPos.set(startX, Math.max(0.50, startY), startZ);
      camera.position.copy(this.tempStartPos);
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

        if (isHeroOrbit) {
          // 英雄螺旋升空轨迹：方位角旋转 360 度，半径与俯仰平滑推移
          const angle = currentAzimuth + eased * Math.PI * 2.0;
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

        if (progress < 1.0) {
          this.currentTweenRaf = requestAnimationFrame(tick);
        } else {
          // 结束复位与收敛
          camera.position.copy(this.tempEndPos);
          if (controls && controls.target) {
            controls.target.copy(this.tempEndTarget);
            controls.enabled = true;
            controls.update();
          } else {
            camera.lookAt(this.tempEndTarget);
          }
          camera.fov = targetFov;
          camera.updateProjectionMatrix();
          this.isTweening = false;
          setWindMultiplier?.(1.0);
          resolve();
        }
      };

      this.currentTweenRaf = requestAnimationFrame(tick);
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
