import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { MotionPipeline } from './motionPipeline';

describe('Universal Lower-Body Locomotion & BodyTurn Authority', () => {
  let pipeline: MotionPipeline;
  let mockVRM: any;
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    pipeline = new MotionPipeline();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 1.4, 2.0);

    // Minimal mock VRM
    const scene = new THREE.Group();
    const bones = new Map<string, THREE.Object3D>();
    const boneNames = [
      'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
      'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
      'leftFoot', 'rightFoot', 'leftToes', 'rightToes',
    ];
    for (const b of boneNames) {
      const obj = new THREE.Object3D();
      obj.name = b;
      scene.add(obj);
      bones.set(b, obj);
    }

    mockVRM = {
      scene,
      meta: { metaVersion: '1' },
      humanoid: {
        getNormalizedBoneNode: (name: string) => bones.get(name) || null,
        getRawBoneNode: (name: string) => bones.get(name) || null,
      },
    };

    pipeline.bind(mockVRM);
  });

  it('in idle mode: triggers stepping immediately with 0 pre-turn delay at 24° threshold', () => {
    // Active source is idle by default
    expect(pipeline.getActiveSource()).toBe('idle');

    // Camera at moderate yaw angle ~26° (> 24° idle threshold)
    camera.position.set(Math.sin(0.46) * 2.0, 1.4, Math.cos(0.46) * 2.0);

    // Tick 1 frame
    pipeline.tick(mockVRM, {
      camera,
      delta: 0.016,
      time: 0.016,
      enableBodyTurn: true,
      isSpeaking: false,
      isListening: false,
      manualExpression: null,
    });

    // BodyTurn should enter stepping directly without pre_turn delay
    expect(pipeline.bodyTurn.isTurnActive()).toBe(true);
  });

  it('in action mode: lower body is governed by BodyTurn, triggers stepping immediately at 24° with 0 lag', () => {
    vi.spyOn(pipeline.universalMotion, 'isPlaying').mockReturnValue(true);
    vi.spyOn(pipeline.universalMotion, 'getCurrentOptions').mockReturnValue({ mask: 'all', fadeDuration: 0.75 });

    // Camera at ~26° (> 24° standard threshold)
    camera.position.set(Math.sin(0.46) * 2.0, 1.4, Math.cos(0.46) * 2.0);

    // Tick 1 frame
    pipeline.tick(mockVRM, {
      camera,
      delta: 0.016,
      time: 0.016,
      enableBodyTurn: true,
      isSpeaking: false,
      isListening: true,
      manualExpression: null,
    });

    // BodyTurn should trigger stepping immediately with 0 delay (no 38° deadzone or pre_turn freeze)
    expect(pipeline.bodyTurn.isTurnActive()).toBe(true);
  });

  it('stepping completion smoothly settles at target facing angle without twisting back', () => {
    vi.spyOn(pipeline.universalMotion, 'isPlaying').mockReturnValue(true);
    vi.spyOn(pipeline.universalMotion, 'getCurrentOptions').mockReturnValue({ mask: 'all', fadeDuration: 0.75 });

    // Camera at ~45°
    camera.position.set(Math.sin(0.78) * 2.0, 1.4, Math.cos(0.78) * 2.0);

    // 1. Tick to trigger stepping
    pipeline.tick(mockVRM, {
      camera,
      delta: 0.016,
      time: 0.1,
      enableBodyTurn: true,
      isSpeaking: false,
      isListening: true,
      manualExpression: null,
    });
    expect(pipeline.bodyTurn.isTurnActive()).toBe(true);

    // 2. Bring camera back to front (simulating character turning to face camera)
    camera.position.set(0, 1.4, 2.0);

    // Step out remaining phase until IDLE
    for (let i = 0; i < 40; i++) {
      pipeline.tick(mockVRM, {
        camera,
        delta: 0.05,
        time: 0.2 + i * 0.05,
        enableBodyTurn: true,
        isSpeaking: false,
        isListening: true,
        manualExpression: null,
      });
      if (!pipeline.bodyTurn.isTurnActive()) break;
    }

    // BodyTurn completed stepping and settled cleanly without post_turn snapback
    expect(pipeline.bodyTurn.isTurnActive()).toBe(false);
    expect(pipeline.bodyTurn.isStepping()).toBe(false);
  });

  it('un-animated bones fall back to basePose, preventing cross-contamination across motion switches', () => {
    // Mock an upper-body only motion: animated indices contain only neck/head/chest (indices not containing legs)
    const upperOnlyIndices = new Set([0, 1, 2, 3, 4, 5]); // hips, spine, chest, upperChest, neck, head
    vi.spyOn(pipeline.universalMotion, 'isPlaying').mockReturnValue(true);
    vi.spyOn(pipeline.universalMotion, 'getCurrentOptions').mockReturnValue({ mask: 'all', fadeDuration: 0.75 });
    vi.spyOn(pipeline.universalMotion, 'getAnimatedBoneIndices').mockReturnValue(upperOnlyIndices);
    vi.spyOn(pipeline.universalMotion, 'hasHipsPositionTrack').mockReturnValue(false);

    pipeline.tick(mockVRM, {
      camera,
      delta: 0.016,
      time: 0.016,
      enableBodyTurn: false,
      isSpeaking: false,
      isListening: false,
      manualExpression: null,
    });

    // LeftUpperLeg index is 6 in PIPELINE_BONES. Since it is not in upperOnlyIndices, it must match basePose
    expect(pipeline.actionPose.quaternions[6].equals(pipeline.basePose.quaternions[6])).toBe(true);
  });

  it('guarantees identity rest pose in BodyTurn and prevents rest contamination when bound with posed bones', () => {
    // Rotate bones on the VRM humanoid as if an animation or splay is active
    const leftUpperLegNode = mockVRM.humanoid.getNormalizedBoneNode('leftUpperLeg');
    leftUpperLegNode.quaternion.set(0.2, 0.1, 0.3, 0.9).normalize();

    // Re-bind BodyTurn directly with rotated bone
    pipeline.bodyTurn.bind(mockVRM);

    // Copy to locomotion pose buffer and verify rest leg is strictly Identity (0, 0, 0, 1)
    const testPose = new (pipeline.finalPose.constructor as any)();
    pipeline.bodyTurn.copyToLowerBodyBuffer(testPose);
    const legIdx = 6; // leftUpperLeg
    expect(testPose.quaternions[legIdx].x).toBeCloseTo(0, 5);
    expect(testPose.quaternions[legIdx].y).toBeCloseTo(0, 5);
    expect(testPose.quaternions[legIdx].z).toBeCloseTo(0, 5);
    expect(testPose.quaternions[legIdx].w).toBeCloseTo(1, 5);
  });

  it('bind on MotionPipeline is a safe no-op when VRM reference has not changed', () => {
    const origFinalPose = pipeline.finalPose;
    // Modify one buffer property to test whether bind overwrites it
    origFinalPose.quaternions[0].set(0.1, 0.2, 0.3, 0.9);

    pipeline.bind(mockVRM);
    // Since mockVRM === boundVrm, it must not sampleFromVRM or wipe buffers
    expect(pipeline.finalPose.quaternions[0].x).toBeCloseTo(0.1, 5);
  });
});
