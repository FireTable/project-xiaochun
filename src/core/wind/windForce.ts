import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { VRMSpringBoneJoint } from '@pixiv/three-vrm-springbone';
import { APP_CONFIG } from '@/config';

const _ndc = new THREE.Vector2();

/**
 * WindForceConfig — 局部物理风场参数配置
 */
export interface WindForceConfig {
  /** 鼠标周围核心强风半径 (米) */
  mouseRadius: number;
  /** 扩散波及微风半径 (米) — 稍微波及邻近其它位置 */
  wakeRadius: number;
  /** 鼠标快划最大风力 (m/s²) */
  mouseWindStrength: number;
  /** 周边波及微风比例 (0~1) */
  wakeStrengthRatio: number;
  /** 鼠标滑动速度归一化参考 (px/s) */
  mouseSpeedReference: number;
  /** 鼠标速度 EMA 平滑 (0~1) */
  mouseSpeedSmoothing: number;
  /** 裙摆受力增益系数 (克服大腿碰撞体阻力) */
  skirtMultiplier: number;
  /** 飘带/外层饰品受力增益系数 (轻盈飞扬) */
  ribbonMultiplier: number;
  /** 鼠标静止无移动超时 (ms) */
  idleTimeoutMs: number;
  /** 环境阵风基准强度 (m/s²，乘以 (倍率-1))：由剧情运镜的 windMultiplier 触发，与鼠标风叠加 */
  gustStrength: number;
  /** 胸部专属风力动力学配置 */
  bust: {
    sensitivity: number;
    speedExponent: number;
    impulseBonus: number;
  };
}

const DEFAULT_CONFIG: WindForceConfig = {
  mouseRadius: APP_CONFIG.wind.mouseRadius,
  wakeRadius: APP_CONFIG.wind.wakeRadius,
  mouseWindStrength: APP_CONFIG.wind.mouseWindStrength,
  wakeStrengthRatio: APP_CONFIG.wind.wakeStrengthRatio,
  mouseSpeedReference: APP_CONFIG.wind.mouseSpeedReference,
  mouseSpeedSmoothing: APP_CONFIG.wind.mouseSpeedSmoothing,
  skirtMultiplier: APP_CONFIG.wind.skirtMultiplier,
  ribbonMultiplier: APP_CONFIG.wind.ribbonMultiplier,
  idleTimeoutMs: APP_CONFIG.wind.idleTimeoutMs,
  gustStrength: APP_CONFIG.wind.gustStrength,
  bust: {
    sensitivity: APP_CONFIG.wind.bust.sensitivity,
    speedExponent: APP_CONFIG.wind.bust.speedExponent,
    impulseBonus: APP_CONFIG.wind.bust.impulseBonus,
  },
};

/**
 * WindForceController — 鼠标物理风场系统
 *
 * 核心特性：
 * 1. 【3D 切面投影】：构造垂直于相机视线且切过角色身体的平面，鼠标在屏幕上指向何处，风场中心 100% 落在角色身体对应切片（头顶、胸口、短裙、脚底）；
 * 2. 【挥风动量感知】：计算鼠标滑动速度与运动方向，划得越快风越大，风向同时包含“推开”与“挥舞拖曳气流”；
 * 3. 【双层微风扩散波及】：核心半径内强风推拂，扩散半径内（如 1.35m）轻柔微风波及周边邻近部位（胸口划风时发梢与裙摆轻轻拂动）；
 * 4. 【牛顿矢量合力】：F_net = F_gravity + F_wind，绝不粗暴覆盖原重力，停下后立刻重归自然悬垂；
 * 5. 【短裙物理增强】：针对裙摆骨骼提供动力学增益与刚度柔化，轻松拂动短裙；
 * 6. 【零 GC 垃圾回收】：全部数学临时变量预分配复用，60fps 丝滑运行。
 */
export class WindForceController {
  private readonly cfg: WindForceConfig;

  // 鼠标屏幕坐标与状态
  private _mouseX = 0;
  private _mouseY = 0;
  private _hasMousePos = false;
  private _lastMoveTime = 0;

  // 速度与方向计算
  private _prevMouseX = 0;
  private _prevMouseY = 0;
  private _prevT = 0;
  private _rawSpeed = 0;
  private _speedFactor = 0;

  // 预分配复用数学对象 (Zero Alloc on Tick)
  private readonly _mouseWorldPos = new THREE.Vector3();
  private readonly _jointWorldPos = new THREE.Vector3();
  private readonly _windDir = new THREE.Vector3();
  private readonly _pushDir = new THREE.Vector3();
  private readonly _mouseVelocityWorld = new THREE.Vector3();
  private readonly _camDir = new THREE.Vector3();
  private readonly _camRight = new THREE.Vector3();
  private readonly _camUp = new THREE.Vector3();
  private readonly _charCenter = new THREE.Vector3();
  private readonly _plane = new THREE.Plane();
  private readonly _totalForce = new THREE.Vector3();
  private readonly _ray = new THREE.Raycaster();

  // 事件监听器清理句柄
  private _mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private _mouseLeaveHandler: (() => void) | null = null;

  private _isEnabled = true;

  // 缓存每个 joint 原始重力
  private _origGravity = new WeakMap<VRMSpringBoneJoint, { dir: THREE.Vector3; power: number }>();
  private _boundVrm: VRM | null = null;
  private _isWindActive = true;

  // 环境阵风：目标倍率 (1 = 无风) 与平滑后的当前倍率；阵风相位计时
  private _gustTarget = 1;
  private _gustCurrent = 1;
  private _gustPhase = 0;
  private readonly _gustDir = new THREE.Vector3();

  constructor(overrides: Partial<WindForceConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...overrides };
    this.attachMouseListener();
  }

  public setEnabled(on: boolean): void {
    this._isEnabled = on;
    if (!on) {
      this._hasMousePos = false;
      this._speedFactor = 0;
    }
  }

  /**
   * 设置环境阵风倍率 (>1 时角色发丝/裙摆被持续阵风吹动；1 = 关闭)。
   * 由 CameraDirector 在 windMultiplier 运镜期间设置，运镜结束 / 被打断时复位为 1，当前值约 1 秒内平滑回落。
   */
  public setGustMultiplier(mult: number): void {
    this._gustTarget = Number.isFinite(mult) ? Math.max(1, Math.min(4, mult)) : 1;
  }

  /** 当前 (平滑后的) 阵风倍率，仅供测试与调试 */
  public getGustMultiplier(): number {
    return this._gustCurrent;
  }

  /**
   * 清空重力缓存 (在换装或 applySpringBoneTuning 后重新同步)
   */
  public resetGravityCache(): void {
    this._origGravity = new WeakMap();
    this._isWindActive = true;
  }

  /**
   * 随渲染帧循环调用：鼠标 3D 切面投影、速度提取、合力注入
   */
  public applyTo(vrm: VRM, delta: number, camera: THREE.Camera): void {
    const mgr = vrm.springBoneManager;
    if (!mgr) return;

    // VRM 实例发生换装/切换时清空原重力缓存
    if (this._boundVrm !== vrm) {
      this._origGravity = new WeakMap();
      this._boundVrm = vrm;
      this._isWindActive = true;
    }

    if (!this._isEnabled) return;

    // ── 1. 鼠标屏幕坐标 → 3D 角色切面精准投影 ─────────────────────────────
    let mouseActive = false;
    if (this._hasMousePos && camera && typeof window !== 'undefined') {
      const ndcX = (this._mouseX / window.innerWidth) * 2 - 1;
      const ndcY = -(this._mouseY / window.innerHeight) * 2 + 1;
      _ndc.set(ndcX, ndcY);
      this._ray.setFromCamera(_ndc, camera);

      // 构建切过角色中心、法线垂直面向相机的正切空间截面
      // 角色中心取腰腹高度 (y + 0.9m)
      this._charCenter.copy(vrm.scene.position);
      this._charCenter.y += 0.9;
      camera.getWorldDirection(this._camDir);
      // 平面法线朝向相机
      this._plane.setFromNormalAndCoplanarPoint(this._camDir.negate(), this._charCenter);

      if (this._ray.ray.intersectPlane(this._plane, this._mouseWorldPos)) {
        mouseActive = true;
      } else {
        const camDist = camera.position.distanceTo(this._charCenter);
        this._mouseWorldPos.copy(this._ray.ray.origin).addScaledVector(this._ray.ray.direction, camDist);
        mouseActive = true;
      }
    }

    // ── 2. 鼠标运动速度与挥舞方向矢量提取 ─────────────────────────────────
    const now = performance.now();
    const isIdle = (now - this._lastMoveTime) > this.cfg.idleTimeoutMs;

    if (this._hasMousePos && !isIdle && this._prevT > 0) {
      const dt = Math.max((now - this._prevT) / 1000, 1 / 240);
      const dx = this._mouseX - this._prevMouseX;
      const dy = this._mouseY - this._prevMouseY;
      const pxPerSec = Math.hypot(dx, dy) / dt;

      // 速度归一化，通过指数幂曲线使慢移温柔、快挥起劲
      this._rawSpeed = Math.min(pxPerSec / this.cfg.mouseSpeedReference, 1.25);
      const targetFactor = Math.pow(Math.min(this._rawSpeed, 1.0), 1.6);
      this._speedFactor += (targetFactor - this._speedFactor) * this.cfg.mouseSpeedSmoothing;

      // 将屏幕滑动向量 (dx, -dy) 投射为 3D 相机视口世界方向
      this._camRight.setFromMatrixColumn(camera.matrixWorld, 0);
      this._camUp.setFromMatrixColumn(camera.matrixWorld, 1);
      this._mouseVelocityWorld
        .copy(this._camRight).multiplyScalar(dx)
        .addScaledVector(this._camUp, -dy);
      if (this._mouseVelocityWorld.lengthSq() > 0.0001) {
        this._mouseVelocityWorld.normalize();
      }
    } else {
      // 鼠标停止或移出窗口：风力平滑衰减至 0
      this._rawSpeed = 0;
      this._speedFactor += (0 - this._speedFactor) * this.cfg.mouseSpeedSmoothing;
      if (this._speedFactor < 0.001) {
        this._speedFactor = 0;
      }
    }
    this._prevMouseX = this._mouseX;
    this._prevMouseY = this._mouseY;
    this._prevT = now;

    const isMoving = this._speedFactor > 0.005;

    // ── 2.5 环境阵风：倍率平滑 (升 ~0.25s，落 ~0.5s)，叠加缓慢起伏的脉冲 ──────────
    const dt = Math.min(Math.max(delta, 0), 0.1);
    const tau = this._gustTarget > this._gustCurrent ? 0.25 : 0.5;
    this._gustCurrent += (this._gustTarget - this._gustCurrent) * (1 - Math.exp(-dt / tau));
    if (Math.abs(this._gustCurrent - this._gustTarget) < 0.003) this._gustCurrent = this._gustTarget;
    const gustActive = this._gustCurrent > 1.01 && Boolean(camera);
    let gustLevel = 0;
    if (gustActive) {
      this._gustPhase += dt;
      // 两个不同频率的正弦相乘 → 时强时弱的阵风，但永远不低于 35%，避免“风停”的断续感
      const pulse = 0.35 + 0.65 * Math.abs(Math.sin(this._gustPhase * 2.1) * Math.cos(this._gustPhase * 0.8 + 0.6));
      gustLevel = (this._gustCurrent - 1) * this.cfg.gustStrength * pulse;
      this._camRight.setFromMatrixColumn(camera.matrixWorld, 0);
      this._gustDir.copy(this._camRight).multiplyScalar(0.92);
      this._gustDir.y += 0.18;
      this._gustDir.normalize();
    }

    // ── 3. 逐 Joint 动力学计算与牛顿合力注入 ──────────────────────────────
    // 静止或无鼠标状态短路：仅执行单次复位，后续静止帧零循环开销
    const mouseWind = mouseActive && isMoving;
    if (!mouseWind && !gustActive) {
      if (!this._isWindActive) {
        return;
      }
      this._isWindActive = false;
      mgr.joints.forEach((joint) => {
        let orig = this._origGravity.get(joint);
        if (!orig) {
          orig = {
            dir: joint.settings.gravityDir.clone(),
            power: joint.settings.gravityPower,
          };
          this._origGravity.set(joint, orig);
        }
        joint.settings.gravityDir.copy(orig.dir);
        joint.settings.gravityPower = orig.power;
      });
      return;
    }

    this._isWindActive = true;

    mgr.joints.forEach((joint) => {
      // 缓存原始重力
      let orig = this._origGravity.get(joint);
      if (!orig) {
        orig = {
          dir: joint.settings.gravityDir.clone(),
          power: joint.settings.gravityPower,
        };
        this._origGravity.set(joint, orig);
      }

      const bone = joint.bone;
      if (!bone) {
        joint.settings.gravityDir.copy(orig.dir);
        joint.settings.gravityPower = orig.power;
        return;
      }

      bone.getWorldPosition(this._jointWorldPos);
      const dist = this._jointWorldPos.distanceTo(this._mouseWorldPos);

      const isBust = /bust/i.test(bone.name);
      const isLowerClothing = !isBust && (/skirt|coat|ribbon|acc|belt|tie|flap|_02|_03/i.test(bone.name) || joint.colliderGroups.length === 0);

      let jointForceScale = 1.0;
      let jointSpeedFactor = this._speedFactor;

      if (isBust) {
        // ── 胸部动力学响应重塑 ──
        // 1. 采用高阶速度幂律（speedExponent: 1.85）：慢移时由于微速响应极小，彻底消除“稍微划过动作挺大”；
        // 2. 注入快划动量冲量补偿（impulseBonus: 1.85）：快划时在极短的接触时间内释放充沛动量，彻底打破“上限极低”的平缓天花板。
        const bustNormSpeed = Math.min(this._rawSpeed, 1.25);
        const bustDynamicCurve = Math.pow(bustNormSpeed, this.cfg.bust.speedExponent);
        jointSpeedFactor = Math.max(bustDynamicCurve, this._speedFactor * bustDynamicCurve);
        jointForceScale = this.cfg.bust.sensitivity * (1.0 + bustNormSpeed * (this.cfg.bust.impulseBonus - 1.0));
      } else if (isLowerClothing) {
        // 裙摆与依附其上的蝴蝶结配饰共享统一受力比例，杜绝不同步导致的拉扯穿模
        jointForceScale = this.cfg.skirtMultiplier;
      }

      // 阵风按部位缩放：胸部极轻微、裙摆/饰品沿用裙摆倍率、发丝等 1.0
      const gustScale = isBust ? this.cfg.bust.sensitivity : isLowerClothing ? this.cfg.skirtMultiplier : 1.0;
      const gustPower = gustLevel * gustScale;

      let windPower = 0;
      if (mouseWind && dist <= this.cfg.wakeRadius) {
        if (dist <= this.cfg.mouseRadius) {
          // 核心强风场：二次方衰减（中心强劲，外缘平滑过渡）
          const ratio = 1 - dist / this.cfg.mouseRadius;
          const falloff = ratio * ratio;
          windPower = falloff * this.cfg.mouseWindStrength * jointSpeedFactor * jointForceScale;
        } else {
          // 周边波及扩散微风：柔和线性衰减
          const wakeRatio = 1 - (dist - this.cfg.mouseRadius) / (this.cfg.wakeRadius - this.cfg.mouseRadius);
          windPower = wakeRatio * (this.cfg.mouseWindStrength * this.cfg.wakeStrengthRatio) * jointSpeedFactor * jointForceScale;
        }
      }

      if (windPower < 0.001 && gustPower < 0.001) {
        joint.settings.gravityDir.copy(orig.dir);
        joint.settings.gravityPower = orig.power;
        return;
      }

      // ── 牛顿矢量合力：F_total = F_gravity + F_mouseWind + F_gust ───────────
      // 保证重力绝不失重，风力矢量加成后自然表现为“下垂重力 + 被吹扬起”的逼真受力
      this._totalForce.copy(orig.dir).multiplyScalar(orig.power);

      if (windPower >= 0.001) {
        // 风向合成：
        // 1. 径向推开分量 (joint - mouse)
        this._pushDir.copy(this._jointWorldPos).sub(this._mouseWorldPos);
        if (this._pushDir.lengthSq() > 0.0001) {
          this._pushDir.normalize();
        } else {
          this._pushDir.set(0, 0, 1);
        }

        // 2. 挥舞带风分量 (_mouseVelocityWorld)
        // 70% 径向推开 + 30% 挥动手势带风，兼具推开感与顺流气流感
        this._windDir.copy(this._pushDir).multiplyScalar(0.7).addScaledVector(this._mouseVelocityWorld, 0.3);
        if (this._windDir.lengthSq() > 0.0001) {
          this._windDir.normalize();
        } else {
          this._windDir.copy(this._pushDir);
        }

        // 3. 【裙摆与外饰整体自然受风与轻柔升力】
        // 裙子与依附在上面的蝴蝶结、飘带等饰品作为一个物理整体布料系统，必须接收完全相同、统一的方向修正与升力，
        // 严禁将裙子与配饰拆解为两套相互对抗的独立位移算法，彻底杜绝蝴蝶结与裙体穿插凹陷。
        if (isLowerClothing) {
          const dx = this._jointWorldPos.x - vrm.scene.position.x;
          const dz = this._jointWorldPos.z - vrm.scene.position.z;
          const radialLen = Math.hypot(dx, dz);
          if (radialLen > 0.001) {
            this._windDir.x += (dx / radialLen) * 0.15;
            this._windDir.z += (dz / radialLen) * 0.15;
          }
          // 温和自然升力：裙摆与蝴蝶结整体同步轻拂微扬
          this._windDir.y = Math.max(this._windDir.y, 0) + 0.20;
          this._windDir.normalize();
        }
        this._totalForce.addScaledVector(this._windDir, windPower);
      }

      if (gustPower >= 0.001) {
        this._totalForce.addScaledVector(this._gustDir, gustPower);
      }

      const totalPower = this._totalForce.length();
      if (totalPower > 0.0001) {
        joint.settings.gravityDir.copy(this._totalForce).multiplyScalar(1 / totalPower);
        joint.settings.gravityPower = totalPower;
      } else {
        joint.settings.gravityDir.copy(orig.dir);
        joint.settings.gravityPower = orig.power;
      }
    });
  }

  private attachMouseListener(): void {
    if (this._mouseMoveHandler || typeof window === 'undefined') return;

    this._mouseMoveHandler = (e: MouseEvent) => this.onMouseMove(e);
    this._mouseLeaveHandler = () => this.onMouseLeave();

    window.addEventListener('mousemove', this._mouseMoveHandler, { passive: true });
    window.addEventListener('mouseleave', this._mouseLeaveHandler);
    window.addEventListener('blur', this._mouseLeaveHandler);
  }

  private onMouseMove(e: MouseEvent): void {
    this._mouseX = e.clientX;
    this._mouseY = e.clientY;
    this._hasMousePos = true;
    this._lastMoveTime = performance.now();
  }

  private onMouseLeave(): void {
    this._hasMousePos = false;
  }

  public dispose(): void {
    if (typeof window !== 'undefined') {
      if (this._mouseMoveHandler) {
        window.removeEventListener('mousemove', this._mouseMoveHandler);
        this._mouseMoveHandler = null;
      }
      if (this._mouseLeaveHandler) {
        window.removeEventListener('mouseleave', this._mouseLeaveHandler);
        window.removeEventListener('blur', this._mouseLeaveHandler);
        this._mouseLeaveHandler = null;
      }
    }
    this._hasMousePos = false;
    this._speedFactor = 0;
    this._mouseX = 0;
    this._mouseY = 0;
  }
}