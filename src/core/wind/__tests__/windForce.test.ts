import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WindForceController } from '../windForce';

function makeVrm() {
  const joints = ['hair_01', 'skirt_02', 'bust_L'].map((name) => {
    const bone = new THREE.Object3D();
    bone.name = name;
    bone.position.set(0, 1, 0);
    return {
      bone,
      colliderGroups: name === 'skirt_02' ? [] : [{}],
      settings: { gravityDir: new THREE.Vector3(0, -1, 0), gravityPower: 0.1 },
    };
  });
  const vrm: any = { scene: new THREE.Object3D(), springBoneManager: { joints: new Set(joints) } };
  return { vrm, joints };
}

describe('WindForceController ambient gusts (camera windMultiplier)', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.updateMatrixWorld(true);

  it('blows hair and skirt sideways while the multiplier is raised, then settles back to the original gravity', () => {
    const wind = new WindForceController();
    const { vrm, joints } = makeVrm();

    wind.applyTo(vrm, 0.016, camera); // 无风：缓存原重力
    wind.setGustMultiplier(2.4);
    for (let i = 0; i < 60; i++) wind.applyTo(vrm, 0.016, camera);

    const [hair, skirt, bust] = joints;
    expect(wind.getGustMultiplier()).toBeGreaterThan(2);
    // 重力方向被侧向风偏转，总力变大
    expect(Math.abs(hair.settings.gravityDir.x)).toBeGreaterThan(0.05);
    expect(hair.settings.gravityPower).toBeGreaterThan(0.1);
    expect(Math.abs(skirt.settings.gravityDir.x)).toBeGreaterThan(0.02);
    // 胸部只受到极轻的影响
    expect(Math.abs(bust.settings.gravityDir.x)).toBeLessThan(Math.abs(hair.settings.gravityDir.x));

    wind.setGustMultiplier(1);
    for (let i = 0; i < 300; i++) wind.applyTo(vrm, 0.016, camera);
    for (const j of joints) {
      expect(j.settings.gravityPower).toBeCloseTo(0.1, 6);
      expect(j.settings.gravityDir.x).toBeCloseTo(0, 6);
      expect(j.settings.gravityDir.y).toBeCloseTo(-1, 6);
    }
    wind.dispose();
  });

  it('clamps nonsense multipliers', () => {
    const wind = new WindForceController();
    wind.setGustMultiplier(Number.NaN);
    wind.setGustMultiplier(99);
    const { vrm } = makeVrm();
    for (let i = 0; i < 400; i++) wind.applyTo(vrm, 0.05, camera);
    expect(wind.getGustMultiplier()).toBeLessThanOrEqual(4);
    wind.dispose();
  });

  it('story ambient wind level 0..3 maps to a gust multiplier and coexists with camera gusts (the larger wins)', () => {
    const wind = new WindForceController();
    const { vrm } = makeVrm();
    const settle = () => { for (let i = 0; i < 400; i++) wind.applyTo(vrm, 0.05, camera); return wind.getGustMultiplier(); };

    wind.setAmbientWindLevel(0);
    expect(settle()).toBeCloseTo(1, 3);
    wind.setAmbientWindLevel(1);
    expect(settle()).toBeCloseTo(1.5, 3);
    wind.setAmbientWindLevel(3);
    expect(settle()).toBeCloseTo(2.5, 3);

    // 运镜阵风比环境风小：环境风保持；运镜结束复位为 1：环境风也保持
    wind.setGustMultiplier(2);
    expect(settle()).toBeCloseTo(2.5, 3);
    wind.setGustMultiplier(1);
    expect(settle()).toBeCloseTo(2.5, 3);
    // 运镜阵风更大时取运镜的
    wind.setGustMultiplier(3.5);
    expect(settle()).toBeCloseTo(3.5, 3);
    wind.setGustMultiplier(1);
    wind.setAmbientWindLevel(Number.NaN);
    expect(settle()).toBeCloseTo(1, 3);
    wind.setAmbientWindLevel(99);
    expect(settle()).toBeCloseTo(2.5, 3);
    wind.dispose();
  });
});
