import * as THREE from 'three';
import { APP_CONFIG, type LightConfig } from '@/config';

/**
 * StudioLighting — 3 盏灯 (key + fill + ambient,Unity / Three.js 标准配置)。
 *
 * 之前有 6 盏 (front / leg / arm 是额外 SpotLight),调试路径用的,
 * 每个 SpotLight 都在 fragment shader 多算一轮光照叠加,移动端 FPS 受影响。
 * 现删掉,代码也清掉 — 不需要 toggleScene / 动态 add remove 这种 hack。
 */
export class StudioLighting {
  public hemiLight = new THREE.HemisphereLight(0xfffaf8, 0xe2d6e6, 0.85);
  public dirLight = new THREE.DirectionalLight(0xfffdfa, 0.90);
  public fillLight = new THREE.DirectionalLight(0xf2f0ff, 0.65);

  public readonly channels: LightConfig = {
    dir: { ...APP_CONFIG.lights.dir },
    hemi: { ...APP_CONFIG.lights.hemi },
    fill: { ...APP_CONFIG.lights.fill },
    globalMult: APP_CONFIG.lights.globalMult,
  };

  init(scene: THREE.Scene): void {
    scene.add(this.hemiLight);

    // 主方向光：二次元经典立体写真光 (右上方适度仰角，脸颊白净同时发丝优雅投射在胸前与衣服上)
    this.dirLight.position.set(2.4, 5.8, 4.0);
    this.dirLight.target.position.set(0, 1.0, 0);
    scene.add(this.dirLight.target);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.bias = 0.00002;
    this.dirLight.shadow.normalBias = 0.035;
    this.dirLight.shadow.radius = 2.0;
    this.dirLight.shadow.camera.left = -3.0;
    this.dirLight.shadow.camera.right = 3.0;
    this.dirLight.shadow.camera.top = 3.0;
    this.dirLight.shadow.camera.bottom = -3.0;
    this.dirLight.shadow.camera.near = 1.0;
    this.dirLight.shadow.camera.far = 16.0;
    scene.add(this.dirLight);

    // 前侧柔和冷色补光 (左前侧斜上方，柔和提亮背光暗部，避免过度正面冲刷胸前阴影)
    this.fillLight.position.set(-2.0, 2.8, 1.8);
    this.fillLight.target.position.set(0, 1.0, 0);
    scene.add(this.fillLight.target);
    scene.add(this.fillLight);

    this.updateAll();
  }

  updateAll(): void {
    const m = this.channels.globalMult;
    this.dirLight.intensity = this.channels.dir.enabled ? this.channels.dir.base * m : 0;
    this.hemiLight.intensity = this.channels.hemi.enabled ? this.channels.hemi.base * m : 0;
    this.fillLight.intensity = this.channels.fill.enabled ? this.channels.fill.base * m : 0;
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
