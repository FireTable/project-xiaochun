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
});
