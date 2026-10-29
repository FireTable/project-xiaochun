import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VRMBodyMorph } from '../vrmBodyMorph';
import { harmonizeTorsoCurvature } from '@/motion/vrmaRetarget';

describe('Torso Decoupling & Harmonization', () => {
  it('preserves strict matrix orthogonality (90.00°) across the torso bone chain under non-uniform scaling', () => {
    // Construct fake VRM rig
    const scene = new THREE.Scene();
    const hips = new THREE.Object3D(); hips.name = 'J_Bip_C_Hips';
    const spine = new THREE.Object3D(); spine.name = 'J_Bip_C_Spine';
    const chest = new THREE.Object3D(); chest.name = 'J_Bip_C_Chest';
    const upperChest = new THREE.Object3D(); upperChest.name = 'J_Bip_C_UpperChest';
    const neck = new THREE.Object3D(); neck.name = 'J_Bip_C_Neck';
    const head = new THREE.Object3D(); head.name = 'J_Bip_C_Head';

    scene.add(hips);
    hips.add(spine);
    spine.add(chest);
    chest.add(upperChest);
    upperChest.add(neck);
    neck.add(head);

    const fakeVRM = {
      scene,
      humanoid: {
        getRawBoneNode: (name: string) => {
          if (name === 'hips') return hips;
          if (name === 'spine') return spine;
          if (name === 'chest') return chest;
          if (name === 'upperChest') return upperChest;
          if (name === 'neck') return neck;
          if (name === 'head') return head;
          return null;
        },
      },
      meta: { metaVersion: '1' },
    } as any;

    const morph = new VRMBodyMorph({
      waist: 0.86,
      torsoThickness: 0.88,
      hips: 1.0,
      buttocks: 1.13,
      buttocksThickness: 1.0,
    });
    morph.bind(fakeVRM);
    morph.apply();

    // Apply severe side-bend rotations (from puppy-paws)
    spine.rotation.set(0, -8.3 * (Math.PI / 180), -16.8 * (Math.PI / 180), 'ZYX');
    chest.rotation.set(0, -1.9 * (Math.PI / 180), 30.5 * (Math.PI / 180), 'ZYX');

    hips.updateMatrixWorld(true);

    const checkBasisOrthogonality = (obj: THREE.Object3D) => {
      const el = obj.matrixWorld.elements;
      const vX = new THREE.Vector3(el[0], el[1], el[2]).normalize();
      const vY = new THREE.Vector3(el[4], el[5], el[6]).normalize();
      const vZ = new THREE.Vector3(el[8], el[9], el[10]).normalize();

      const aXY = THREE.MathUtils.radToDeg(vX.angleTo(vY));
      const aYZ = THREE.MathUtils.radToDeg(vY.angleTo(vZ));
      const aXZ = THREE.MathUtils.radToDeg(vX.angleTo(vZ));

      expect(aXY).toBeCloseTo(90.0, 1);
      expect(aYZ).toBeCloseTo(90.0, 1);
      expect(aXZ).toBeCloseTo(90.0, 1);
    };

    checkBasisOrthogonality(hips);
    checkBasisOrthogonality(spine);
    checkBasisOrthogonality(chest);
    checkBasisOrthogonality(upperChest);
  });

  it('harmonizes extreme counter-bend between spine and chest in AnimationClip', () => {
    const times = new Float32Array([0.0, 0.5, 1.0]);
    // Create an unnatural S-curve: frame 1 has spine -17° and chest +31°
    const qSpine0 = new THREE.Quaternion();
    const qChest0 = new THREE.Quaternion();

    const qSpine1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -17 * (Math.PI / 180), 'YXZ'));
    const qChest1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 31 * (Math.PI / 180), 'YXZ'));

    const qSpine2 = new THREE.Quaternion();
    const qChest2 = new THREE.Quaternion();

    const spineValues = new Float32Array(12);
    qSpine0.toArray(spineValues, 0);
    qSpine1.toArray(spineValues, 4);
    qSpine2.toArray(spineValues, 8);

    const chestValues = new Float32Array(12);
    qChest0.toArray(chestValues, 0);
    qChest1.toArray(chestValues, 4);
    qChest2.toArray(chestValues, 8);

    const spineTrack = new THREE.QuaternionKeyframeTrack('spine.quaternion', times as any, spineValues as any);
    const chestTrack = new THREE.QuaternionKeyframeTrack('chest.quaternion', times as any, chestValues as any);

    const clip = new THREE.AnimationClip('test-counter-bend', 1.0, [spineTrack, chestTrack]);

    const modified = harmonizeTorsoCurvature(clip);
    expect(modified).toBeGreaterThan(0);

    // After harmonization, frame 1 diff should be greatly reduced
    const resSpine = new THREE.Quaternion().fromArray(spineTrack.values, 4);
    const resChest = new THREE.Quaternion().fromArray(chestTrack.values, 4);
    const eSpine = new THREE.Euler().setFromQuaternion(resSpine, 'YXZ');
    const eChest = new THREE.Euler().setFromQuaternion(resChest, 'YXZ');

    const rollDiffDeg = THREE.MathUtils.radToDeg(Math.abs(eChest.z - eSpine.z));
    expect(rollDiffDeg).toBeLessThan(20.0); // reduced from 48° down to < 20°

    // Total world roll is conserved in direction
    const qWorld = resSpine.clone().multiply(resChest);
    const eWorld = new THREE.Euler().setFromQuaternion(qWorld, 'YXZ');
    expect(THREE.MathUtils.radToDeg(eWorld.z)).toBeCloseTo(14.0, 0);
  });
});
