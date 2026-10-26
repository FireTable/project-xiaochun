import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyWorldSwing,
  armClearQuaternion,
  armPushDistance,
  bustClearPush,
  fitBustEllipsoid,
  smoothstep01,
} from './bustArmContact';

describe('bust arm contact', () => {
  it('fits an ellipsoid to the outer skin on each axis', () => {
    const points: number[] = [];
    for (let i = 0; i < 12; i++) {
      points.push((i - 6) * 0.01, (i - 6) * 0.004, (i - 6) * 0.002);
    }
    const fit = fitBustEllipsoid(points);
    expect(fit).not.toBeNull();
    expect(fit!.center.x).toBeCloseTo(-0.005);
    expect(fit!.radius.x).toBeGreaterThan(fit!.radius.y);
    expect(fit!.radius.y).toBeGreaterThan(fit!.radius.z);
  });

  it('ignores a side with too few samples', () => {
    expect(fitBustEllipsoid([0, 0, 0, 1, 0, 0])).toBeNull();
  });

  it('pushes an inside point past the surface by the margin', () => {
    const world = new THREE.Matrix4();
    const inverse = new THREE.Matrix4();
    const center = new THREE.Vector3();
    const radius = new THREE.Vector3(0.1, 0.05, 0.04);
    const sample = new THREE.Vector3(0.05, 0, 0);
    const push = new THREE.Vector3();
    expect(bustClearPush(sample, world, inverse, center, radius, 0.01, push)).toBe(true);
    expect(push.x).toBeCloseTo(0.06);
    expect(push.y).toBeCloseTo(0);
    expect(push.z).toBeCloseTo(0);
  });

  it('keeps the push in world space when the chest bone is turned', () => {
    const anchor = new THREE.Object3D();
    anchor.rotation.y = Math.PI / 2;
    anchor.position.set(1, 2, 3);
    anchor.updateMatrixWorld(true);
    const world = anchor.matrixWorld.clone();
    const inverse = world.clone().invert();
    const sample = new THREE.Vector3(0.05, 0, 0).applyMatrix4(world);
    const push = new THREE.Vector3();
    expect(
      bustClearPush(sample, world, inverse, new THREE.Vector3(), new THREE.Vector3(0.1, 0.05, 0.04), 0.01, push),
    ).toBe(true);
    expect(push.x).toBeCloseTo(0);
    expect(push.y).toBeCloseTo(0);
    expect(push.z).toBeCloseTo(-0.06);
  });

  it('leaves a point that is already clear', () => {
    const world = new THREE.Matrix4();
    const inverse = new THREE.Matrix4();
    const push = new THREE.Vector3();
    const hit = bustClearPush(
      new THREE.Vector3(0.12, 0, 0),
      world,
      inverse,
      new THREE.Vector3(),
      new THREE.Vector3(0.1, 0.05, 0.04),
      0.01,
      push,
    );
    expect(hit).toBe(false);
  });

  it('swings the arm toward the push and stops at the cap', () => {
    const arm = new THREE.Vector3(0.4, 0, 0);
    const push = new THREE.Vector3(0, 0, 0.05);
    const swing = new THREE.Quaternion();
    const angle = armClearQuaternion(arm, push, 0.5, swing);
    expect(angle).toBeCloseTo(Math.atan2(0.02, 0.16));
    const moved = arm.clone().applyQuaternion(swing);
    expect(moved.z).toBeGreaterThan(0.03);
    expect(armClearQuaternion(arm, new THREE.Vector3(0, 0, 1), 0.175, swing)).toBeCloseTo(0.175);
    expect(armClearQuaternion(arm, new THREE.Vector3(), 0.175, swing)).toBe(0);
  });

  it('applies the swing in world space when the parent is turned', () => {
    const parent = new THREE.Object3D();
    const bone = new THREE.Object3D();
    const child = new THREE.Object3D();
    parent.add(bone);
    bone.add(child);
    parent.rotation.y = Math.PI / 2;
    child.position.set(0.4, 0, 0);
    parent.updateMatrixWorld(true);
    const sample = new THREE.Vector3();
    const shoulder = new THREE.Vector3();
    child.getWorldPosition(sample);
    bone.getWorldPosition(shoulder);
    const arm = sample.clone().sub(shoulder);
    const push = new THREE.Vector3(0, 0.05, 0);
    const swing = new THREE.Quaternion();
    armClearQuaternion(arm, push, 0.5, swing);
    applyWorldSwing(bone, swing);
    parent.updateMatrixWorld(true);
    const after = new THREE.Vector3();
    child.getWorldPosition(after);
    expect(after.y).toBeGreaterThan(sample.y + 0.02);
  });

  it('eases a shallow push and caps a deep one', () => {
    expect(armPushDistance(0, 1, 0.02)).toBe(0);
    expect(armPushDistance(0.02, 1, 0.02)).toBeCloseTo(0.02);
    expect(armPushDistance(0.05, 1, 0.02)).toBeCloseTo(0.02);
    expect(armPushDistance(0.02, 0.5, 0.02)).toBeCloseTo(0.01);
    expect(armPushDistance(0.01, 1, 0.02)).toBeCloseTo(0.01 * smoothstep01(0, 0.02, 0.01));
  });
});
