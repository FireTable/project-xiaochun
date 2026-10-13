import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VoidWorld } from '../void/voidWorld';
import { APP_CONFIG } from '@/config';

describe('VoidWorld', () => {
  beforeAll(() => {
    (globalThis as any).document = {
      createElement: () => ({
        width: 1024,
        height: 1024,
        getContext: () => ({
          fillStyle: '',
          fillRect: () => {},
          createRadialGradient: () => ({ addColorStop: () => {} }),
          arc: () => {},
          beginPath: () => {},
          fill: () => {},
          moveTo: () => {},
          lineTo: () => {},
          stroke: () => {},
          getImageData: () => ({ data: new Uint8ClampedArray(64) }),
          putImageData: () => {},
        }),
      }),
    };
  });

  afterAll(() => {
    delete (globalThis as any).document;
  });

  it('has correct scene id and initializes lifecycle cleanly', () => {
    const scene = new THREE.Scene();
    const voidWorld = new VoidWorld();

    expect(voidWorld.id).toBe('void');

    // 挂载至场景
    voidWorld.attach(scene);

    // 默认在未激活前不可见
    expect(voidWorld.group.visible).toBe(false);

    // 激活虚空世界
    voidWorld.setActive(true, scene);
    expect(voidWorld.group.visible).toBe(true);
    expect(scene.background).toBeInstanceOf(THREE.Color);

    // 隐藏虚空世界
    voidWorld.setActive(false, scene);
    expect(voidWorld.group.visible).toBe(false);
  });

  it('guarantees pure background aesthetic with NO ground stage/floor mesh', () => {
    const scene = new THREE.Scene();
    const voidWorld = new VoidWorld();
    voidWorld.attach(scene);

    // 确保没有误加入任何地面网格 (Mesh) 或地台圆环
    let meshCount = 0;
    let pointsCount = 0;

    voidWorld.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (obj.name !== 'VoidSky') meshCount++; // 全屏渐变夜空不算地面
      } else if (obj instanceof THREE.Points) {
        pointsCount++;
      }
    });

    expect(meshCount).toBe(0); // 严格保证零地面/地台
    expect(pointsCount).toBe(1); // 存在 3D 浮游星尘微粒系统
    expect(voidWorld.mesh).not.toBeNull();
  });

  it('builds an opaque full-screen gradient sky that hides with the world', () => {
    const scene = new THREE.Scene();
    const voidWorld = new VoidWorld();
    voidWorld.attach(scene);

    const sky = voidWorld.skyMesh!;
    expect(sky).not.toBeNull();
    expect(sky.parent).toBe(voidWorld.group);
    expect(sky.frustumCulled).toBe(false);
    const mat = sky.material as THREE.ShaderMaterial;
    expect(mat.depthWrite).toBe(false);
    expect(mat.depthTest).toBe(false);
    expect(mat.transparent).toBe(false);
    // 色标与 CSS radial-gradient 一致 (sRGB 0..1)
    expect((mat.uniforms.uInner.value as THREE.Vector3).x).toBeCloseTo(0x3a / 255, 5);
    expect(mat.uniforms.uMidStop.value).toBeCloseTo(APP_CONFIG.voidScene.sky.midStop, 5);
    // 星云强度远低于 Bloom 阈值
    expect(mat.uniforms.uNebula.value).toBeLessThanOrEqual(0.15);

    voidWorld.setActive(true, scene);
    expect(sky.visible && voidWorld.group.visible).toBe(true);
    voidWorld.setActive(false, scene);
    expect(voidWorld.group.visible).toBe(false);

    voidWorld.dispose(scene);
    expect(voidWorld.skyMesh).toBeNull();
  });

  it('updates stardust drift and breathing animation without errors', () => {
    const scene = new THREE.Scene();
    const voidWorld = new VoidWorld();
    voidWorld.attach(scene);
    voidWorld.setActive(true, scene);

    expect(() => {
      voidWorld.update(0.016, 1.0);
      voidWorld.update(0.016, 2.0);
    }).not.toThrow();
  });

  it('disposes resources cleanly', () => {
    const scene = new THREE.Scene();
    const voidWorld = new VoidWorld();
    voidWorld.attach(scene);
    voidWorld.setActive(true, scene);

    voidWorld.dispose(scene);
    expect(scene.background).toBeNull();
    expect(voidWorld.mesh).toBeNull();
  });
});
