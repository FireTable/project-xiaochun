import { describe, expect, it } from 'vitest';
import { ExpressionController } from '../expressionController';
import type { VRM } from '@pixiv/three-vrm';

function createMockVRM() {
  const expressionValues: Record<string, number> = {};
  return {
    vrm: {
      expressionManager: {
        setValue: (name: string, value: number) => {
          expressionValues[name] = value;
        },
        getValue: (name: string) => expressionValues[name] ?? 0,
        update: () => {},
      },
    } as unknown as VRM,
    expressionValues,
  };
}

describe('ExpressionController Organic Facial Morphing', () => {
  it('starts inactive with neutral weight = 1 and passes through to gaze blinking', () => {
    const controller = new ExpressionController();
    const { vrm } = createMockVRM();

    expect(controller.getIsActive()).toBe(false);
    // When inactive, update does not manipulate expressionManager
    controller.update(0.016, vrm, false);
    expect(controller.getIsActive()).toBe(false);
  });

  it('smoothly ramps happy (gentle_smile) with organic ceiling avoiding deformed eyes', () => {
    const controller = new ExpressionController();
    const { vrm, expressionValues } = createMockVRM();

    controller.setExpression('happy', 1.0);
    expect(controller.getIsActive()).toBe(true);

    // Simulate 0.5s of frame updates (~30 frames at 60fps)
    for (let i = 0; i < 30; i++) {
      controller.update(0.016, vrm, false);
    }

    // Happy value should be gently smiling (~0.14) and strictly <= 0.18 (prevent squinting slits)
    const happyVal = expressionValues['happy'] ?? 0;
    expect(happyVal).toBeGreaterThan(0.10);
    expect(happyVal).toBeLessThanOrEqual(0.18);
  });

  it('smoothly ramps angry with tsundere micro-pout ceiling avoiding demonic distortion', () => {
    const controller = new ExpressionController();
    const { vrm, expressionValues } = createMockVRM();

    controller.setExpression('angry', 1.0);
    expect(controller.getIsActive()).toBe(true);

    // Simulate 0.5s of frame updates
    for (let i = 0; i < 30; i++) {
      controller.update(0.016, vrm, false);
    }

    const angryVal = expressionValues['angry'] ?? 0;
    expect(angryVal).toBeGreaterThan(0.20);
    expect(angryVal).toBeLessThanOrEqual(0.35);
  });

  it('smoothly transitions back to neutral and gracefully deactivates', () => {
    const controller = new ExpressionController();
    const { vrm, expressionValues } = createMockVRM();

    controller.setExpression('happy', 1.0);
    for (let i = 0; i < 30; i++) {
      controller.update(0.016, vrm, false);
    }
    expect(expressionValues['happy']).toBeGreaterThan(0.10);

    // Now command return to neutral
    controller.setExpression('neutral');

    // Simulate 1.0s of smooth dampening back to zero
    for (let i = 0; i < 60; i++) {
      controller.update(0.016, vrm, false);
    }

    // Should have deactivated and zeroed out VRM expressions
    expect(controller.getIsActive()).toBe(false);
    expect(expressionValues['happy'] ?? 0).toBe(0);
    expect(expressionValues['angry'] ?? 0).toBe(0);
  });

  it('ducks smile mouth expression when character is speaking', () => {
    const controller = new ExpressionController();
    const { vrm, expressionValues } = createMockVRM();

    controller.setExpression('happy', 1.0);
    // Update while speaking
    for (let i = 0; i < 30; i++) {
      controller.update(0.016, vrm, true);
    }

    // Mouth is ducked by speechMouthDucking (0.25)
    const duckedHappy = expressionValues['happy'] ?? 0;
    expect(duckedHappy).toBeLessThan(0.06);
  });
});
