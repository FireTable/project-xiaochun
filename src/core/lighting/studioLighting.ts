import * as THREE from 'three';
import { APP_CONFIG, type LightConfig } from '@/config';

/**
 * StudioLighting — 专业影棚 6 通道灯光系统
 * 
 * 管理：
 * 1. 半球环境光 (hemi)
 * 2. 太阳主方向光 (dir，带 2048 PCFSoft 阴影相机)
 * 3. 补光 (fill)
 * 4. 脸部正面补光 (front)
 * 5. 腿部轮廓光 (leg)
 * 6. 左右手臂高光 (arm)
 */
export class StudioLighting {
  public hemiLight = new THREE.HemisphereLight(0xfffaf4, 0x6e6268, 0.60);
  public dirLight = new THREE.DirectionalLight(0xfffbf5, 1.00);
  public fillLight = new THREE.DirectionalLight(0xe8edff, 0.80);
  public frontFill = new THREE.SpotLight(0xfff8f2, 0.70, 2.5, Math.PI / 7.5, 0.45, 1.2);
  public legLight = new THREE.SpotLight(0xfff8f2, 0.45, 4.0, Math.PI / 4.0, 0.85, 1.0);
  public leftArmLight = new THREE.SpotLight(0xfffbf7, 0.50, 1.5, Math.PI / 11, 0.4, 1.5);
  public rightArmLight = new THREE.SpotLight(0xfffbf7, 0.50, 1.5, Math.PI / 11, 0.4, 1.5);

  public readonly channels: LightConfig = {
    dir: { ...APP_CONFIG.lights.dir },
    hemi: { ...APP_CONFIG.lights.hemi },
    front: { ...APP_CONFIG.lights.front },
    fill: { ...APP_CONFIG.lights.fill },
    leg: { ...APP_CONFIG.lights.leg },
    arm: { ...APP_CONFIG.lights.arm },
    globalMult: APP_CONFIG.lights.globalMult,
  };

  init(scene: THREE.Scene): void {
    scene.add(this.hemiLight);

    // 主方向光 + 2048 阴影相机配置
    this.dirLight.position.set(10, 14, -22);
    this.dirLight.target.position.set(0, 1, 0);
    scene.add(this.dirLight.target);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.bias = -0.00015;
    this.dirLight.shadow.radius = 2.5;
    this.dirLight.shadow.camera.left = -8;
    this.dirLight.shadow.camera.right = 8;
    this.dirLight.shadow.camera.top = 8;
    this.dirLight.shadow.camera.bottom = -8;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 40.0;
    scene.add(this.dirLight);

    // 侧面补光
    this.fillLight.position.set(-1.5, 1.8, -1.2);
    scene.add(this.fillLight);

    // 脸部高光
    this.frontFill.position.set(0.0, 1.65, 1.3);
    const faceTarget = new THREE.Object3D();
    faceTarget.position.set(0.0, 1.50, 0.0);
    scene.add(faceTarget);
    this.frontFill.target = faceTarget;
    scene.add(this.frontFill);

    // 腿部立体光
    this.legLight.position.set(0.15, 0.65, 1.6);
    const legTarget = new THREE.Object3D();
    legTarget.position.set(0.0, 0.35, 0.0);
    scene.add(legTarget);
    this.legLight.target = legTarget;
    scene.add(this.legLight);

    // 双臂轮廓光
    this.leftArmLight.position.set(-0.95, 1.10, 0.45);
    const leftArmTarget = new THREE.Object3D();
    leftArmTarget.position.set(-0.40, 1.00, 0.0);
    scene.add(leftArmTarget);
    this.leftArmLight.target = leftArmTarget;
    scene.add(this.leftArmLight);

    this.rightArmLight.position.set(0.95, 1.10, 0.45);
    const rightArmTarget = new THREE.Object3D();
    rightArmTarget.position.set(0.40, 1.00, 0.0);
    scene.add(rightArmTarget);
    this.rightArmLight.target = rightArmTarget;
    scene.add(this.rightArmLight);

    this.updateAll();
  }

  updateAll(): void {
    const m = this.channels.globalMult;
    this.dirLight.intensity = this.channels.dir.enabled ? this.channels.dir.base * m : 0;
    this.hemiLight.intensity = this.channels.hemi.enabled ? this.channels.hemi.base * m : 0;
    this.frontFill.intensity = this.channels.front.enabled ? this.channels.front.base * m : 0;
    this.fillLight.intensity = this.channels.fill.enabled ? this.channels.fill.base * m : 0;
    this.legLight.intensity = this.channels.leg.enabled ? this.channels.leg.base * m : 0;
    this.leftArmLight.intensity = this.channels.arm.enabled ? this.channels.arm.base * m : 0;
    this.rightArmLight.intensity = this.channels.arm.enabled ? this.channels.arm.base * m : 0;
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
