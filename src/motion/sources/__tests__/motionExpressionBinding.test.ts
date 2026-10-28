import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { UniversalMotionController } from '../clip';
import { expressionController, PRESET_EMOTION_MAP } from '../../../core/morph/expressionController';
import { MOTION_CATALOG, MOTION_GROUPS } from '../../catalog';
import type { VRM } from '@pixiv/three-vrm';

function createMockVRM() {
  const scene = new THREE.Group();
  const mockHips = new THREE.Object3D();
  mockHips.name = 'hips';
  scene.add(mockHips);
  const mockHead = new THREE.Object3D();
  mockHead.name = 'head';
  scene.add(mockHead);

  const mockVrm = {
    scene,
    humanoid: {
      getNormalizedBoneNode: (name: string) => (name === 'hips' ? mockHips : name === 'head' ? mockHead : null),
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
  beforeEach(() => {
    expressionController.reset();
  });
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

    // SleepyNod has gentle_smile and disableGaze (杜绝默认瞇眯眼)
    expect(MOTION_CATALOG.sleepyNod.expression).toBe('gentle_smile');
    expect(MOTION_CATALOG.sleepyNod.expressionIntensity).toBe(0.6);
    expect(MOTION_CATALOG.sleepyNod.disableGaze).toBe(true);

    // GazeObserve has gentle_smile (杜绝默认瞇眯眼)
    expect(MOTION_CATALOG.gazeObserve.expression).toBe('gentle_smile');

    // ShhLean has playful
    expect(MOTION_CATALOG.shhLean.expression).toBe('playful');
    expect(MOTION_CATALOG.shhLean.expressionIntensity).toBe(0.7);
  });

  it('ExpressionController dynamically links sleepyBlink to head nod pitch without permanent squint', () => {
    const vrm = createMockVRM();
    const values: Record<string, number> = {};
    (vrm.expressionManager!.setValue as any).mockImplementation((key: string, val: number) => {
      values[key] = val;
    });

    const head = vrm.humanoid!.getNormalizedBoneNode('head')!;

    expressionController.setExpression('relaxed', 0.7);

    // Simulated head nod down (pitch = 0.20 rad)
    head.rotation.x = 0.20;
    for (let i = 0; i < 25; i++) {
      expressionController.update(0.05, vrm, false, 0, 0.2);
    }
    // Blink dynamically closes deeper into nod (around ~0.65 - 0.85)
    expect(values.blink).toBeGreaterThan(0.60);
    expect(values.blink).toBeLessThan(0.85);

    // Deep nod (pitch = 0.30 rad) -> deep slumber closing (> 0.80)
    head.rotation.x = 0.30;
    for (let i = 0; i < 15; i++) {
      expressionController.update(0.05, vrm, false, 0, 0.2);
    }
    expect(values.blink).toBeGreaterThan(0.80);

    // Head lifts back upright (pitch = 0 rad) -> flutters completely open (blink <= 0.05, 杜绝瞇眯眼)
    head.rotation.x = 0.0;
    for (let i = 0; i < 30; i++) {
      expressionController.update(0.05, vrm, false, 0, 0);
    }
    expect(values.blink).toBeLessThanOrEqual(0.05);

    // Clear expression back to neutral
    expressionController.setExpression('neutral', 1.0);
    for (let i = 0; i < 20; i++) {
      expressionController.update(0.1, vrm, false, 0, 0);
    }
    expect(values.blink).toBe(0);
  });

  it('ExpressionController enables expressive lively weights and playful wink', () => {
    const vrm = createMockVRM();
    const values: Record<string, number> = {};
    (vrm.expressionManager!.setValue as any).mockImplementation((key: string, val: number) => {
      values[key] = val;
    });

    // Test playful: triggers left-eye wink pulse at peak (around ~0.45s) and reopens, while happy smile holds
    expressionController.setExpression('playful', 0.85);
    for (let i = 0; i < 11; i++) {
      expressionController.update(0.05, vrm); // ~0.55s, peak of wink pulse
    }
    expect(values.blinkLeft).toBeGreaterThan(0.65);
    expect(values.happy).toBeGreaterThan(0.40);

    // After wink pulse finishes (~1.2s), eye reopens to 0 while happy smile continues
    for (let i = 0; i < 15; i++) {
      expressionController.update(0.05, vrm);
    }
    expect(values.blinkLeft).toBe(0);
    expect(values.happy).toBeGreaterThan(0.40);

    // Test happy: triggers full radiant joyful smile
    expressionController.setExpression('happy', 0.85);
    for (let i = 0; i < 15; i++) {
      expressionController.update(0.05, vrm);
    }
    expect(values.happy).toBeGreaterThan(0.55);
    expect(values.blinkLeft).toBe(0);

    // Reset back to neutral
    expressionController.setExpression('neutral', 1.0);
    for (let i = 0; i < 20; i++) {
      expressionController.update(0.1, vrm);
    }
    expect(values.happy).toBe(0);
  });

  it('supports dynamic MotionExpressionFn with context and Zero-GC buffers', () => {
    const controller = new UniversalMotionController();
    const vrm = createMockVRM();
    controller.bind(vrm);

    const values: Record<string, number> = {};
    (vrm.expressionManager!.setValue as any).mockImplementation((key: string, val: number) => {
      values[key] = val;
    });

    let receivedElapsed = -1;
    let receivedProgress = -1;
    let receivedHeadPitch = -1;

    const clip = createDummyClip(4.0);
    controller.play(clip, {
      expressionFn: (ctx, out) => {
        receivedElapsed = ctx.elapsed;
        receivedProgress = ctx.progress;
        receivedHeadPitch = ctx.headPitch;
        out.happy = 0.77;
        out.blink = ctx.elapsed > 1.0 ? 0.90 : 0.0;
      },
    });

    // Tick controller and smooth facial dampening
    controller.update(0.5);
    for (let i = 0; i < 8; i++) {
      expressionController.update(0.05, vrm);
    }

    expect(receivedElapsed).toBeCloseTo(0.5, 1);
    expect(receivedProgress).toBeCloseTo(0.5 / 4.0, 2);
    expect(receivedHeadPitch).toBeCloseTo(0, 2);
    expect(values.happy).toBeCloseTo(0.77, 1);
    expect(values.blink).toBe(0);

    // Advance past 1.0s
    controller.update(0.8);
    for (let i = 0; i < 10; i++) {
      expressionController.update(0.05, vrm);
    }

    expect(values.happy).toBeCloseTo(0.77, 1);
    expect(values.blink).toBeCloseTo(0.90, 1);

    // Stopping motion clears dynamic expression
    controller.stop();
    expressionController.update(0.05, vrm);
    expect(expressionController.getExpressionFn()).toBeNull();
  });

  it('shhLean executes a temporary wink pulse at 0.8s~1.5s and reopens eye for rest of motion', () => {
    const vrm = createMockVRM();
    const values: Record<string, number> = {};
    (vrm.expressionManager!.setValue as any).mockImplementation((key: string, val: number) => {
      values[key] = val;
    });

    const shhItem = MOTION_CATALOG.shhLean;
    expect(shhItem.expressionFn).toBeDefined();

    let fakeElapsed = 0;
    expressionController.setExpressionFn(shhItem.expressionFn!, () => ({
      elapsed: fakeElapsed,
      duration: 8.08,
    }));

    // At start (t = 0.2s): no wink, sweet smile
    fakeElapsed = 0.2;
    for (let i = 0; i < 5; i++) {
      expressionController.update(0.05, vrm);
    }
    expect(values.blinkLeft).toBe(0);
    expect(values.happy).toBeGreaterThanOrEqual(0.45);

    // At climax peak (t = 1.15s, midway between 0.8s and 1.5s): smooth wink peak!
    for (let t = 0.25; t <= 1.15; t += 0.05) {
      fakeElapsed = t;
      expressionController.update(0.05, vrm);
    }
    expect(values.blinkLeft).toBeGreaterThan(0.70);
    expect(values.happy).toBeGreaterThan(0.55);

    // After wink completes (t = 2.0s): eye fully reopens, smile remains!
    for (let t = 1.20; t <= 2.0; t += 0.05) {
      fakeElapsed = t;
      expressionController.update(0.05, vrm);
    }
    expect(values.blinkLeft).toBe(0);
    expect(values.happy).toBeGreaterThanOrEqual(0.45);

    // Later in hold (t = 5.0s): eye still open, no frozen wink!
    fakeElapsed = 5.0;
    for (let i = 0; i < 5; i++) {
      expressionController.update(0.05, vrm);
    }
    expect(values.blinkLeft).toBe(0);

    expressionController.setExpressionFn(null);
  });

  it('guarantees listening and thinking groups have zero permanent squinting (杜绝瞇眯眼)', () => {
    const vrm = createMockVRM();
    const values: Record<string, number> = {};
    (vrm.expressionManager!.setValue as any).mockImplementation((key: string, val: number) => {
      values[key] = val;
    });

    // Check listening group: listening & gazeObserve
    const listeningIds = MOTION_GROUPS.listening.map((item) => item.id);
    for (const id of listeningIds) {
      const motion = MOTION_CATALOG[id];
      expect(motion.expression, `Listening motion ${id} should be gentle_smile`).toBe('gentle_smile');
      expressionController.setExpression(motion.expression!, motion.expressionIntensity);
      for (let i = 0; i < 20; i++) {
        expressionController.update(0.05, vrm);
      }
      expect(values.blink, `Motion ${id} must not have eye squinting`).toBe(0);
      expect(values.relaxed ?? 0, `Motion ${id} must not have relaxed eyelid droop`).toBeLessThanOrEqual(0.05);
    }

    // Check thinking group: thinking & pokeFingers
    const thinkingIds = MOTION_GROUPS.thinking.map((item) => item.id);
    for (const id of thinkingIds) {
      const motion = MOTION_CATALOG[id];
      if ('expressionFn' in motion && motion.expressionFn) {
        expressionController.setExpressionFn(motion.expressionFn as any, () => ({ elapsed: 1.0, duration: 4.0 }));
      } else {
        expressionController.setExpression(motion.expression!, motion.expressionIntensity);
      }
      for (let i = 0; i < 20; i++) {
        expressionController.update(0.05, vrm);
      }
      expect(values.blink, `Thinking motion ${id} must not have eye squinting`).toBe(0);
      expect(values.relaxed ?? 0, `Thinking motion ${id} must not have relaxed eyelid droop`).toBeLessThanOrEqual(0.05);
    }

    // Check sleepyNod starts with eyes fully open at t=0
    const sleepyNod = MOTION_CATALOG.sleepyNod;
    expressionController.setExpressionFn(sleepyNod.expressionFn!, () => ({ elapsed: 0.1, duration: 4.17 }));
    for (let i = 0; i < 10; i++) {
      expressionController.update(0.05, vrm);
    }
    expect(values.blink, 'SleepyNod must start with eyes completely open at t=0').toBe(0);
    expect(values.relaxed ?? 0, 'SleepyNod must start without relaxed eyelid droop at t=0').toBe(0);
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
