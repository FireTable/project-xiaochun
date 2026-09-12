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
  public hemiLight = new THREE.HemisphereLight(0xfffaf4, 0x6e6268, 0.82);
  public dirLight = new THREE.DirectionalLight(0xfffbf5, 0.85);
  public fillLight = new THREE.DirectionalLight(0xe8edff, 0.70);

  public readonly channels: LightConfig = {
    dir: { ...APP_CONFIG.lights.dir },
    hemi: { ...APP_CONFIG.lights.hemi },
    fill: { ...APP_CONFIG.lights.fill },
    globalMult: APP_CONFIG.lights.globalMult,
  };

  init(scene: THREE.Scene): void {
    scene.add(this.hemiLight);

    // 主方向光 + 2048 阴影相机精准视锥体配置（收紧投影视锥体，成倍提升地面阴影清晰度）
    this.dirLight.position.set(10, 14, -22);
    this.dirLight.target.position.set(0, 1, 0);
    scene.add(this.dirLight.target);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.bias = -0.00015;
    this.dirLight.shadow.radius = 2.0;
    this.dirLight.shadow.camera.left = -2.5;
    this.dirLight.shadow.camera.right = 2.5;
    this.dirLight.shadow.camera.top = 2.8;
    this.dirLight.shadow.camera.bottom = -2.5;
    this.dirLight.shadow.camera.near = 15.0;
    this.dirLight.shadow.camera.far = 38.0;
    scene.add(this.dirLight);

    // 冷色补光 (-1.5, 1.8, -1.2 反方向，精准对准胸口高度，勾勒轮廓微光)
    this.fillLight.position.set(-1.5, 1.8, -1.2);
    this.fillLight.target.position.set(0, 1.2, 0);
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
