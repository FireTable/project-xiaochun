import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

function skinPoint(
  boneWorld: THREE.Matrix4,
  boneInverse: THREE.Matrix4,
  bind: THREE.Matrix4,
  bindInverse: THREE.Matrix4,
  point: THREE.Vector3,
): THREE.Vector3 {
  const bone = new THREE.Matrix4().multiplyMatrices(boneWorld, boneInverse);
  const world = new THREE.Matrix4().multiplyMatrices(bone, bind);
  const skin = new THREE.Matrix4().multiplyMatrices(bindInverse, world);
  return point.clone().applyMatrix4(skin);
}
import {
  blendClothRestInto,
  bustFalloff,
  bustJointHitRadius,
  clothFollowAmount,
  composeClothFollowMatrix,
  isClothSpringName,
  scaledBustColliderRadius,
  shouldConsiderCloth,
  springStableWorldMatrix,
} from './bustClothFit';

describe('bust cloth fit', () => {
  it('scales joint hit radius with the bust and does not add cloth clearance', () => {
    expect(bustJointHitRadius(0.02, 1)).toBeCloseTo(0.02);
    expect(bustJointHitRadius(0.02, 1.5)).toBeCloseTo(0.03);
  });

  it('keeps collider radius at the bind size until the bust grows', () => {
    expect(scaledBustColliderRadius(0.05, 1, 0.003)).toBeCloseTo(0.05);
    expect(scaledBustColliderRadius(0.05, 1.5, 0.003)).toBeCloseTo(0.05 * 1.5 + 0.003);
  });

  it('treats cloth by name and leaves body skin and hair alone', () => {
    expect(shouldConsiderCloth('Body', 'N00_010_01_Onepiece_00_CLOTH')).toBe(true);
    expect(shouldConsiderCloth('Dress', 'Material')).toBe(true);
    expect(shouldConsiderCloth('Costume', '')).toBe(true);
    expect(shouldConsiderCloth('Body', 'N00_000_00_Body_00_SKIN')).toBe(false);
    expect(shouldConsiderCloth('Hair001', 'HairBack')).toBe(false);
  });

  it('selects cloth springs and skips bust and hair', () => {
    expect(isClothSpringName('J_Sec_L_SkirtFront1_01')).toBe(true);
    expect(isClothSpringName('J_Sec_L_CoatSkirtBack_01')).toBe(true);
    expect(isClothSpringName('J_Sec_C_Ribbon_01')).toBe(true);
    expect(isClothSpringName('J_Sec_L_Bust1')).toBe(false);
    expect(isClothSpringName('J_Sec_HairBack_01')).toBe(false);
  });

  it('fades the cloth push to nothing outside the bust', () => {
    expect(bustFalloff(0.02, 0.06, 0.15)).toBe(1);
    expect(bustFalloff(0.15, 0.06, 0.15)).toBe(0);
    expect(bustFalloff(0.105, 0.06, 0.15)).toBeCloseTo(0.5);
  });

  it('does not follow a vertex the bust bone already carries', () => {
    expect(clothFollowAmount(1, 1)).toBeCloseTo(0);
    expect(clothFollowAmount(0, 1)).toBeCloseTo(1);
    expect(clothFollowAmount(0.5, 0.5)).toBeCloseTo(0.25);
  });

  it('follows non-uniform bust scale, pitch, and spread from the bone origin', () => {
    const identity = new THREE.Matrix4();
    const point = new THREE.Vector3(0.02, -0.03, 0.08);

    const scaled = new THREE.Matrix4().makeScale(1.12, 1.28, 1.65);
    const scaleOut = new THREE.Matrix4();
    composeClothFollowMatrix(scaleOut, identity, identity, scaled, identity, null, null);
    const scaledPoint = point.clone().applyMatrix4(scaleOut);
    expect(scaledPoint.x).toBeCloseTo(0.02 * 1.12);
    expect(scaledPoint.y).toBeCloseTo(-0.03 * 1.28);
    expect(scaledPoint.z).toBeCloseTo(0.08 * 1.65);

    const pitched = new THREE.Matrix4().makeRotationX(-0.09);
    const pitchOut = new THREE.Matrix4();
    composeClothFollowMatrix(pitchOut, identity, identity, pitched, identity, null, null);
    expect(point.clone().applyMatrix4(pitchOut).distanceTo(point.clone().applyMatrix4(pitched))).toBeLessThan(1e-6);

    const spread = new THREE.Matrix4().makeTranslation(0.02, 0.003, 0);
    const spreadOut = new THREE.Matrix4();
    composeClothFollowMatrix(spreadOut, identity, identity, spread, identity, null, null);
    const spreadPoint = point.clone().applyMatrix4(spreadOut);
    expect(spreadPoint.x).toBeCloseTo(0.04);
    expect(spreadPoint.y).toBeCloseTo(-0.027);
    expect(spreadPoint.z).toBeCloseTo(0.08);
  });

  it('takes chest motion back out so skinning does not apply it twice', () => {
    const identity = new THREE.Matrix4();
    const carrierWorld = new THREE.Matrix4().makeScale(2, 2, 2);
    const bustWorld = new THREE.Matrix4().makeScale(3, 2.2, 3.6);
    const follow = new THREE.Matrix4();
    composeClothFollowMatrix(follow, identity, identity, bustWorld, identity, carrierWorld, identity);

    const rest = new THREE.Vector3(0.01, -0.02, 0.04);
    const restPrime = rest.clone().applyMatrix4(follow);
    // Carrier scale 2 removed: bust world / carrier = (1.5, 1.1, 1.8).
    expect(restPrime.x).toBeCloseTo(0.01 * 1.5);
    expect(restPrime.y).toBeCloseTo(-0.02 * 1.1);
    expect(restPrime.z).toBeCloseTo(0.04 * 1.8);

    const skinnedCloth = restPrime.clone().applyMatrix4(carrierWorld);
    const skinnedBust = rest.clone().applyMatrix4(bustWorld);
    expect(skinnedCloth.distanceTo(skinnedBust)).toBeLessThan(1e-6);

    // Translation then a rotated non-uniform scale does not commute. Bind is offset too.
    const bind = new THREE.Matrix4().makeTranslation(0, 0.4, 0);
    const bindInverse = bind.clone().invert();
    const carrier = new THREE.Matrix4().makeTranslation(0.1, 1.2, 0.05);
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(0.08, 0.02, 0.04),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.4),
      new THREE.Vector3(1.1, 1.25, 1.6),
    );
    const bust = new THREE.Matrix4().multiplyMatrices(carrier, local);
    const posed = new THREE.Matrix4();
    composeClothFollowMatrix(posed, bind, bindInverse, bust, identity, carrier, identity);
    const posedRest = rest.clone().applyMatrix4(posed);
    const clothSkinned = skinPoint(carrier, identity, bind, bindInverse, posedRest);
    const bustSkinned = skinPoint(bust, identity, bind, bindInverse, rest);
    expect(clothSkinned.distanceTo(bustSkinned)).toBeLessThan(1e-5);
  });

  it('reads the slider scale while keeping the spring orientation', () => {
    const parent = new THREE.Object3D();
    const bone = new THREE.Object3D();
    parent.add(bone);
    parent.position.set(0, 1.2, 0.1);
    bone.matrixAutoUpdate = false;
    bone.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
    bone.position.set(0.08, 0.02, 0.03);
    bone.updateMatrix();
    bone.updateMatrixWorld(true);

    const springQuat = bone.quaternion.clone();
    bone.scale.set(1.12, 1.28, 1.65);
    bone.position.set(0.1, 0.03, 0.03);
    bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.5));

    const stable = new THREE.Matrix4();
    springStableWorldMatrix(stable, bone);
    const expectedLocal = new THREE.Matrix4().compose(bone.position, springQuat, bone.scale);
    const expected = new THREE.Matrix4().multiplyMatrices(parent.matrixWorld, expectedLocal);
    const probe = new THREE.Vector3(0.02, -0.01, 0.05);
    expect(probe.clone().applyMatrix4(stable).distanceTo(probe.clone().applyMatrix4(expected))).toBeLessThan(1e-5);
    // The temporary pitch multiply is not what the next spring tick keeps.
    const pitched = new THREE.Matrix4().compose(bone.position, bone.quaternion, bone.scale);
    const pitchedWorld = new THREE.Matrix4().multiplyMatrices(parent.matrixWorld, pitched);
    expect(probe.clone().applyMatrix4(stable).distanceTo(probe.clone().applyMatrix4(pitchedWorld))).toBeGreaterThan(1e-3);
  });

  it('meets in the middle when both breasts pull the neckline', () => {
    const out = new THREE.Vector3();
    const base = new THREE.Vector3(0, 0, 0.05);
    const left = new THREE.Vector3(0.04, 0, 0.08);
    const right = new THREE.Vector3(-0.04, 0, 0.08);
    blendClothRestInto(out, base, [left, right], [1, 1], 2);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(0.08);

    blendClothRestInto(out, base, [left, right], [0.5, 0], 2);
    expect(out.x).toBeCloseTo(0.02);
    expect(out.z).toBeCloseTo(0.065);

    blendClothRestInto(out, base, [left, right], [0, 0], 2);
    expect(out.distanceTo(base)).toBeLessThan(1e-8);
  });
});
