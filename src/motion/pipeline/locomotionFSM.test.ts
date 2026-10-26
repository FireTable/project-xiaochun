import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { MotionPipeline } from './motionPipeline';
import { APP_CONFIG } from '../../config';

describe('Universal Lower-Body Locomotion FSM (Action <-> Idle <-> BodyTurn)', () => {
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

  it('in full-body action mode: ignores small camera movements under 38° threshold', () => {
    vi.spyOn(pipeline.universalMotion, 'isPlaying').mockReturnValue(true);
    vi.spyOn(pipeline.universalMotion, 'getCurrentOptions').mockReturnValue({ mask: 'all', fadeDuration: 0.75 });

    // Camera at ~28° (greater than idle 24°, but less than full-body action 38° threshold)
    camera.position.set(Math.sin(0.48) * 2.0, 1.4, Math.cos(0.48) * 2.0);

    // Tick multiple frames
    for (let i = 0; i < 10; i++) {
      pipeline.tick(mockVRM, {
        camera,
        delta: 0.016,
        time: (i + 1) * 0.016,
        enableBodyTurn: true,
        isSpeaking: false,
        isListening: true,
        manualExpression: null,
      });
    }

    // BodyTurn should NOT be triggered
    expect(pipeline.bodyTurn.isTurnActive()).toBe(false);
    expect(pipeline.bodyTurn.isStepping()).toBe(false);
  });

  it('in full-body action mode: executes PreTurn weight-shift -> Stepping -> Settle -> PostTurn restore sequence', () => {
    vi.spyOn(pipeline.universalMotion, 'isPlaying').mockReturnValue(true);
    vi.spyOn(pipeline.universalMotion, 'getCurrentOptions').mockReturnValue({ mask: 'all', fadeDuration: 0.75 });

    // Camera large angle ~48° (> 38° action threshold)
    camera.position.set(Math.sin(0.84) * 2.0, 1.4, Math.cos(0.84) * 2.0);

    const shiftDur = APP_CONFIG.bodyTurn.preTurnShiftDuration ?? 0.25;

    // 1. Tick for half of pre-turn duration
    pipeline.tick(mockVRM, {
      camera,
      delta: shiftDur * 0.5,
      time: 0.1,
      enableBodyTurn: true,
      isSpeaking: false,
      isListening: true,
      manualExpression: null,
    });

    // Still in pre-turn weight shift: feet should NOT lift yet
    expect(pipeline.bodyTurn.isStepping()).toBe(false);

    // 2. Complete the pre-turn shift to 100% idle legs
    pipeline.tick(mockVRM, {
      camera,
      delta: shiftDur * 0.6,
      time: 0.2,
      enableBodyTurn: true,
      isSpeaking: false,
      isListening: true,
      manualExpression: null,
    });

    // Now stepping should begin from neutral stance
    expect(pipeline.bodyTurn.isTurnActive()).toBe(true);

    // 3. Move camera back to front (simulating character turning to face camera)
    camera.position.set(0, 1.4, 2.0);

    // Step out remaining phase until IDLE
    for (let i = 0; i < 40; i++) {
      pipeline.tick(mockVRM, {
        camera,
        delta: 0.05,
        time: 0.3 + i * 0.05,
        enableBodyTurn: true,
        isSpeaking: false,
        isListening: true,
        manualExpression: null,
      });
      if (!pipeline.bodyTurn.isTurnActive()) break;
    }

    // BodyTurn finished stepping
    expect(pipeline.bodyTurn.isTurnActive()).toBe(false);

    // 4. Advance through post-turn duration
    for (let i = 0; i < 30; i++) {
      pipeline.tick(mockVRM, {
        camera,
        delta: 0.05,
        time: 2.5 + i * 0.05,
        enableBodyTurn: true,
        isSpeaking: false,
        isListening: true,
        manualExpression: null,
      });
    }

    // After settle and post_turn, legs return to 100% action pose
    expect(pipeline.bodyTurn.isStepping()).toBe(false);
  });

  it('in upper-body action mode (mask: upperBody): triggers stepping immediately without pre-turn delay', () => {
    vi.spyOn(pipeline.universalMotion, 'isPlaying').mockReturnValue(true);
    vi.spyOn(pipeline.universalMotion, 'getCurrentOptions').mockReturnValue({ mask: 'upperBody', fadeDuration: 0.75 });

    // Camera at moderate yaw angle ~26° (> 24° threshold)
    camera.position.set(Math.sin(0.46) * 2.0, 1.4, Math.cos(0.46) * 2.0);

    pipeline.tick(mockVRM, {
      camera,
      delta: 0.016,
      time: 0.016,
      enableBodyTurn: true,
      isSpeaking: false,
      isListening: true,
      manualExpression: null,
    });

    // Lower body is already in neutral idle, so BodyTurn should enter stepping directly
    expect(pipeline.bodyTurn.isTurnActive()).toBe(true);
    expect((pipeline as any).lowerLocomotionState).toBe('stepping');
  });
});
