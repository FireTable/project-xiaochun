import * as THREE from 'three';
import { APP_CONFIG, type LightConfig, type LineworkTheme } from '@/config';
import type { EnvironmentLightState } from '@/core/scene/environmentTime';

/**
 * StudioLighting — 3 盏灯 (key + fill + ambient,Unity / Three.js 标准配置)。
 *
 * 之前有 6 盏 (front / leg / arm 是额外 SpotLight),调试路径用的,
 * 每个 SpotLight 都在 fragment shader 多算一轮光照叠加,移动端 FPS 受影响。
 * 现删掉,代码也清掉 — 不需要 toggleScene / 动态 add remove 这种 hack。
 *
 * 场景可以"接管"这套灯: 支持时间流转的场景 (如 beach3d) 通过 applyEnvironmentLight 覆盖
 * 主光的方向 / 颜色 / 强度, 让角色受光与角色脚下落影跟场景的太阳对齐 ——
 * 否则角色的影子会和场景里椅子、棕榈、沙堡的影子指向不同的方向。
 * 场景退场时 clearEnvironmentLight 恢复默认。
 */
export class StudioLighting {
  public hemiLight = new THREE.HemisphereLight(0xfffaf8, 0xe2d6e6, 0.85);
  public dirLight = new THREE.DirectionalLight(0xfffdfa, 0.90);
  public fillLight = new THREE.DirectionalLight(0xf2f0ff, 0.65);

  /** 场景接管灯光时的状态 (null = 使用默认灯色)。 */
  private envOverride: EnvironmentLightState | null = null;

  /** 主光目标点 (角色胸口高度)。 */
  private static readonly KEY_TARGET = new THREE.Vector3(0, 1.0, 0);
  /** 主光与目标点的距离: 平行光只关心方向, 距离只影响阴影相机的近远裁剪。 */
  private static readonly KEY_DISTANCE = 8.0;

  public readonly channels: LightConfig = {
    dir: { ...APP_CONFIG.lights.dir },
    hemi: { ...APP_CONFIG.lights.hemi },
    fill: { ...APP_CONFIG.lights.fill },
    globalMult: APP_CONFIG.lights.globalMult,
  };

  init(scene: THREE.Scene): void {
    // 性能优化：静态环境光源矩阵冻结 (Static Matrix Freezing)
    // 摄影棚灯光与追踪目标位置固定，显式关闭 matrixAutoUpdate 并预先计算一次矩阵，
    // 彻底消灭 Three.js 在每帧主循环 scene.updateMatrixWorld() 中重复进行的位置分解与矩阵乘法开销
    this.hemiLight.matrixAutoUpdate = false;
    this.hemiLight.updateMatrix();
    scene.add(this.hemiLight);

    // 主方向光：二次元经典立体写真光 (右上方适度仰角，脸颊白净同时发丝优雅投射在胸前与衣服上)
    this.dirLight.position.set(2.4, 5.8, 4.0);
    this.dirLight.matrixAutoUpdate = false;
    this.dirLight.updateMatrix();

    this.dirLight.target.position.set(0, 1.0, 0);
    this.dirLight.target.matrixAutoUpdate = false;
    this.dirLight.target.updateMatrix();
    scene.add(this.dirLight.target);

    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    this.dirLight.shadow.bias = 0.00002;
    this.dirLight.shadow.normalBias = 0.035;
    this.dirLight.shadow.radius = 2.0;
    // 对称标准正交视锥：保持 6m×6m ([-3.0, 3.0])，完全保证人物与全身地面头影完整投影，绝不发生偏移与裁切
    // 6m 见方: 黄昏低角度下 1.6m 的角色会拉出 5m 以上的长影, 3m 的视锥会把影子从中间直角切断
    this.dirLight.shadow.camera.left = -6.0;
    this.dirLight.shadow.camera.right = 6.0;
    this.dirLight.shadow.camera.top = 6.0;
    this.dirLight.shadow.camera.bottom = -6.0;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 40.0;
    this.dirLight.shadow.camera.updateProjectionMatrix();
    scene.add(this.dirLight);

    // 前侧柔和冷色补光 (左前侧斜上方，柔和提亮背光暗部，避免过度正面冲刷胸前阴影)
    this.fillLight.position.set(-2.0, 2.8, 1.8);
    this.fillLight.matrixAutoUpdate = false;
    this.fillLight.updateMatrix();

    this.fillLight.target.position.set(0, 1.0, 0);
    this.fillLight.target.matrixAutoUpdate = false;
    this.fillLight.target.updateMatrix();
    scene.add(this.fillLight.target);
    scene.add(this.fillLight);

    this.updateAll();
  }

  updateAll(): void {
    const m = this.channels.globalMult;
    const o = this.envOverride;
    this.dirLight.intensity = this.channels.dir.enabled ? this.channels.dir.base * m * (o?.keyScale ?? 1) : 0;
    this.hemiLight.intensity = this.channels.hemi.enabled ? this.channels.hemi.base * m * (o?.hemiScale ?? 1) : 0;
    this.fillLight.intensity = this.channels.fill.enabled ? this.channels.fill.base * m * (o?.fillScale ?? 1) : 0;
  }

  /**
   * 场景接管灯光: 主光方向 / 颜色 / 强度按场景当前的太阳 (或月亮) 设置。
   * 角色的受光与角色脚下落影因此和场景里的道具落影指向同一边。
   */
  public applyEnvironmentLight(state: EnvironmentLightState): void {
    this.envOverride = state;
    this.dirLight.color.copy(state.color);
    this.hemiLight.color.copy(state.hemiSky);
    this.hemiLight.groundColor.copy(state.hemiGround);
    this.fillLight.color.copy(state.fillColor);
    // 平行光只看方向: 位置 = 目标点 + 方向 × 距离 (距离只影响阴影相机的裁剪范围)
    this.dirLight.position.copy(state.direction).multiplyScalar(StudioLighting.KEY_DISTANCE).add(StudioLighting.KEY_TARGET);
    this.dirLight.updateMatrix();
    this.updateAll();
  }

  /**
   * 场景退场: 恢复默认灯色 (与 applyTheme 一致) 与默认主光方向。
   */
  public clearEnvironmentLight(): void {
    if (!this.envOverride) return;
    this.envOverride = null;
    this.applyTheme('light');
    this.dirLight.position.set(2.4, 5.8, 4.0);
    this.dirLight.updateMatrix();
    this.updateAll();
  }

  /**
   * 切场景时重置灯色 (统一所有场景包含 void 虚空使用同一套明亮通透的灯色，避免角色暗部发灰)。
   */
  applyTheme(_theme: LineworkTheme): void {
    this.hemiLight.color.setHex(0xfffaf8);
    this.hemiLight.groundColor.setHex(0xe2d6e6);
    this.dirLight.color.setHex(0xfffdfa);
    this.fillLight.color.setHex(0xf2f0ff);
  }

  setLight(key: string, enabled: boolean, value: number): void {
    if (key in this.channels) {
      (this.channels as any)[key].enabled = enabled;
      (this.channels as any)[key].base = value;
      this.updateAll();
    }
  }

  setGlobalMult(mult: number): void {
    this.channels.globalMult = mult;
    this.updateAll();
  }
}
