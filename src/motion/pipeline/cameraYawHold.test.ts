import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { MotionPipeline } from './motionPipeline';

function makeVrm() {
  const scene = new THREE.Group();
  const bones = new Map<string, THREE.Object3D>();
  for (const b of [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
    'leftFoot', 'rightFoot', 'leftToes', 'rightToes',
  ]) {
    const o = new THREE.Object3D();
    o.name = b;
    scene.add(o);
    bones.set(b, o);
  }
  return {
    scene,
    meta: { metaVersion: '1' },
    humanoid: {
      getNormalizedBoneNode: (n: string) => bones.get(n) ?? null,
      getRawBoneNode: (n: string) => bones.get(n) ?? null,
    },
  } as any;
}

describe('camera azimuth vs character facing (bodyTurn)', () => {
  let pipeline: MotionPipeline;
  let vrm: any;
  let camera: THREE.PerspectiveCamera;

  const orbitTo = (azimuth: number) => {
    camera.position.set(Math.sin(azimuth) * 2, 1.4, Math.cos(azimuth) * 2);
  };
  const tick = (holdWorldFacing: boolean, frames = 1) => {
    for (let i = 0; i < frames; i++) {
      pipeline.tick(vrm, {
        camera, delta: 1 / 60, time: 0, enableBodyTurn: true, holdWorldFacing,
        isSpeaking: false, manualExpression: null,
      });
    }
  };

  beforeEach(() => {
    pipeline = new MotionPipeline();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    vrm = makeVrm();
    pipeline.bind(vrm);
    orbitTo(0);
    tick(false);
  });

  it('turns the character when the camera azimuth changes without a hold (the old behaviour)', () => {
    orbitTo(1.0);
    tick(false, 3);
    expect(pipeline.bodyTurn.isTurnActive()).toBe(true);
  });

  it('does not turn the character while the camera director orbits', () => {
    for (let a = 0.05; a <= 1.2; a += 0.05) {
      orbitTo(a);
      tick(true);
    }
    tick(false, 30);
    expect(pipeline.bodyTurn.isTurnActive()).toBe(false);
    expect(vrm.scene.rotation.y).toBeCloseTo(0, 2);
  });

  it('absorbs the final jump of a move through the grace frames', () => {
    tick(true);
    orbitTo(1.5);
    tick(false, 1);
    orbitTo(1.5);
    tick(false, 30);
    expect(pipeline.bodyTurn.isTurnActive()).toBe(false);
  });

  it('still turns when the user drags (targetYawOffset) during or after a move', () => {
    orbitTo(0.6);
    tick(true, 5);
    pipeline.targetYawOffset += 1.0;
    tick(false, 3);
    expect(pipeline.bodyTurn.isTurnActive()).toBe(true);
  });

  it('keeps the shortest arc across the ±π seam', () => {
    orbitTo(Math.PI - 0.1);
    tick(true);
    const before = pipeline.targetYawOffset;
    orbitTo(-Math.PI + 0.1);
    tick(true);
    expect(Math.abs(pipeline.targetYawOffset - before)).toBeLessThan(0.3);
  });

  it('Act 0 beats 1 → 2: the camera is put behind her (she keeps her world front), then orbits to azimuth 0 = her front with no step', () => {
    // 第 1 拍：相机搬到她正后方 (方位角 π)，她保持世界正前方朝向 (yaw 0)
    pipeline.setFacingBackwards(vrm, camera);
    expect(vrm.scene.rotation.y).toBeCloseTo(0, 6);
    expect(Math.abs(Math.atan2(camera.position.x, camera.position.z))).toBeCloseTo(Math.PI, 5);
    expect(camera.position.y).toBeCloseTo(1.4, 6); // 高度与半径不变
    expect(Math.hypot(camera.position.x, camera.position.z)).toBeCloseTo(2, 6);
    tick(false, 30);
    expect(pipeline.bodyTurn.isTurnActive()).toBe(false);
    // 相机在斜后方缓推 (导演运镜 = hold)：她不动
    for (let k = 0; k <= 20; k++) {
      orbitTo(Math.PI + 0.4 * (1 - k / 20));
      tick(true);
    }
    tick(false, 30);
    expect(vrm.scene.rotation.y).toBeCloseTo(0, 2);
    expect(pipeline.bodyTurn.isTurnActive()).toBe(false);
    // 第 2 拍：相机沿 +π 环绕到方位角 0 (她的正面)，没有任何 triggerBodyTurnToFront
    for (let k = 1; k <= 60; k++) {
      orbitTo(Math.PI + Math.PI * (k / 60));
      tick(true);
    }
    tick(false, 30);
    expect(pipeline.bodyTurn.isTurnActive()).toBe(false);
    expect(vrm.scene.rotation.y).toBeCloseTo(0, 2);
    // 终点方位角 = 0，与 fitCamera 的默认方位一致：之后重新取景 (setScene → fitCamera) 相机方位不变，她不会被翻面
    const camAz = Math.atan2(camera.position.x, camera.position.z);
    expect(Math.abs(camAz)).toBeLessThan(0.05);
    expect(Math.abs(pipeline.targetYawOffset)).toBeLessThan(0.05);
    orbitTo(0);
    tick(false, 60);
    expect(pipeline.bodyTurn.isTurnActive()).toBe(false);
    expect(vrm.scene.rotation.y).toBeCloseTo(0, 2);
  });
});
