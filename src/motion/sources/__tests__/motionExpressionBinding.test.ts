import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { UniversalMotionController } from '../clip';
import { expressionController, PRESET_EMOTION_MAP } from '../../../core/morph/expressionController';
import { MOTION_CATALOG } from '../../catalog';
import type { VRM } from '@pixiv/three-vrm';

function createMockVRM() {
  const scene = new THREE.Group();
  const mockHips = new THREE.Object3D();
  mockHips.name = 'hips';
  scene.add(mockHips);

  const mockVrm = {
    scene,
    humanoid: {
      getNormalizedBoneNode: (name: string) => (name === 'hips' ? mockHips : null),
      getRawBoneNode: () => null,
    },
    expressionManager: {
      setValue: vi.fn(),
      getValue: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as VRM;

  return mockVrm;
}

function createDummyClip(duration = 2.0): THREE.AnimationClip {
  const track = new THREE.VectorKeyframeTrack('hips.position', [0, duration], [0, 0, 0, 0, 0, 0]);
  return new THREE.AnimationClip('dummyClip', duration, [track]);
}

describe('UniversalMotionController Motion-Native Expression Binding', () => {
  it('automatically binds expression on play() and smoothly returns to neutral on stop()', () => {
    const controller = new UniversalMotionController();
    const vrm = createMockVRM();
    controller.bind(vrm);

    const setExprSpy = vi.spyOn(expressionController, 'setExpression');

    const clip = createDummyClip(3.0);
    controller.play(clip, {
      expression: 'happy',
      expressionIntensity: 0.85,
    });

    expect(setExprSpy).toHaveBeenCalledWith('happy', 0.85);

    controller.stop();
    expect(setExprSpy).toHaveBeenCalledWith('neutral');

    setExprSpy.mockRestore();
  });

  it('triggers neutral return when expressionDuration timer expires', () => {
    const controller = new UniversalMotionController();
    const vrm = createMockVRM();
    controller.bind(vrm);

    const setExprSpy = vi.spyOn(expressionController, 'setExpression');

    const clip = createDummyClip(5.0);
    controller.play(clip, {
      expression: 'playful',
      expressionIntensity: 0.75,
      expressionDuration: 1.0,
      loop: true,
    });

    expect(setExprSpy).toHaveBeenCalledWith('playful', 0.75);
    setExprSpy.mockClear();

    // Tick 0.6s (remaining: 0.4s) -> should not trigger neutral yet
    controller.update(0.6);
    expect(setExprSpy).not.toHaveBeenCalledWith('neutral');

    // Tick another 0.5s (total 1.1s > 1.0s) -> should trigger neutral return
    controller.update(0.5);
    expect(setExprSpy).toHaveBeenCalledWith('neutral');

    setExprSpy.mockRestore();
  });

  it('triggers neutral return when non-looping motion finishes naturally', () => {
    const controller = new UniversalMotionController();
    const vrm = createMockVRM();
    controller.bind(vrm);

    const setExprSpy = vi.spyOn(expressionController, 'setExpression');

    const clip = createDummyClip(1.0);
    controller.play(clip, {
      expression: 'angry',
      expressionIntensity: 0.85,
      loop: false,
    });

    expect(setExprSpy).toHaveBeenCalledWith('angry', 0.85);
    setExprSpy.mockClear();

    // Advance to end of clip
    controller.update(1.1);

    expect(setExprSpy).toHaveBeenCalledWith('neutral');

    setExprSpy.mockRestore();
  });

  it('fades to neutral when replacing an active action with an action that has no expression', () => {
    const controller = new UniversalMotionController();
    const vrm = createMockVRM();
    controller.bind(vrm);

    const setExprSpy = vi.spyOn(expressionController, 'setExpression');

    const clip1 = createDummyClip(2.0);
    controller.play(clip1, {
      expression: 'shy',
      expressionIntensity: 0.7,
    });
    expect(setExprSpy).toHaveBeenCalledWith('shy', 0.7);
    setExprSpy.mockClear();

    // Play clip2 without any expression
    const clip2 = createDummyClip(2.0);
    controller.play(clip2, {});

    // Must reset to neutral to prevent previous expression from sticking forever
    expect(setExprSpy).toHaveBeenCalledWith('neutral');

    setExprSpy.mockRestore();
  });

  it('guarantees intrinsic facial emotions are configured on core MOTION_CATALOG items', () => {
    // Listening has gentle_smile
    expect(MOTION_CATALOG.listening.expression).toBe('gentle_smile');
    expect(MOTION_CATALOG.listening.expressionIntensity).toBe(0.6);

    // Thinking has hesitant
    expect(MOTION_CATALOG.thinking.expression).toBe('hesitant');
    expect(MOTION_CATALOG.thinking.expressionIntensity).toBe(0.7);

    // HandHeart has happy
    expect(MOTION_CATALOG.handHeart.expression).toBe('happy');
    expect(MOTION_CATALOG.handHeart.expressionIntensity).toBe(0.85);

    // AngryJump has angry
    expect(MOTION_CATALOG.angryJump.expression).toBe('angry');
    expect(MOTION_CATALOG.angryJump.expressionIntensity).toBe(0.85);

    // SleepyNod has relaxed and disableGaze
    expect(MOTION_CATALOG.sleepyNod.expression).toBe('relaxed');
    expect(MOTION_CATALOG.sleepyNod.expressionIntensity).toBe(0.7);
    expect(MOTION_CATALOG.sleepyNod.disableGaze).toBe(true);

    // ShhLean has playful
    expect(MOTION_CATALOG.shhLean.expression).toBe('playful');
    expect(MOTION_CATALOG.shhLean.expressionIntensity).toBe(0.7);
  });

  it('ExpressionController combines sleepyBlink and gazeBlink without compounding', () => {
    const vrm = createMockVRM();
    const values: Record<string, number> = {};
    (vrm.expressionManager!.setValue as any).mockImplementation((key: string, val: number) => {
      values[key] = val;
    });

    expressionController.setExpression('relaxed', 0.7);

    // Run 15 consecutive frames with delta = 0.05
    for (let i = 0; i < 15; i++) {
      expressionController.update(0.05, vrm, false, 0, 0.2);
    }

    // Blink should be clamped and bounded around Math.max(0.2, 0.7 * 0.65) ~ 0.45
    expect(values.blink).toBeGreaterThan(0.35);
    expect(values.blink).toBeLessThan(0.55);

    // Clear expression back to neutral
    expressionController.setExpression('neutral', 1.0);
    for (let i = 0; i < 20; i++) {
      expressionController.update(0.1, vrm, false, 0, 0);
    }
    expect(values.blink).toBe(0);
  });

  it('enforces type safety so all configured motion expressions exist in PRESET_EMOTION_MAP', () => {
    const validKeys = Object.keys(PRESET_EMOTION_MAP);
    for (const [id, item] of Object.entries(MOTION_CATALOG)) {
      if (item.expression) {
        expect(validKeys, `Motion [${id}] references unregistered expression '${item.expression}'`).toContain(
          item.expression,
        );
      }
    }
  });
});
