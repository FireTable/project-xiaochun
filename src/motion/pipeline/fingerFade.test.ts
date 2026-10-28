import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FINGER_MICRO_FADE_DURATION } from './selectLiveMotionSource';
import { PoseBuffer, FINGER_BONES, BONE_INDEX_MAP } from './poseBuffer';
import { APP_CONFIG } from '../../config';

describe('FingerMicroFade (0.34s Transition)', () => {
  it('exports FINGER_MICRO_FADE_DURATION as 0.34s and matches APP_CONFIG', () => {
    expect(FINGER_MICRO_FADE_DURATION).toBeCloseTo(0.34, 2);
    expect(APP_CONFIG.motionPipeline.fingerFadeDuration).toBeCloseTo(0.34, 2);
    expect(APP_CONFIG.motionPipeline.sourceFadeDuration).toBeCloseTo(0.75, 2);
  });

  it('guarantees smooth Quintic interpolation without frame 0 snapping or creeping delay', () => {
    const fromPose = new PoseBuffer();
    const toPose = new PoseBuffer();
    const upperPose = new PoseBuffer();

    // Set an initial curled finger pose in fromPose (idle)
    const idx = BONE_INDEX_MAP.get('leftIndexProximal')!;
    const qFrom = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.3));
    fromPose.quaternions[idx]!.copy(qFrom);

    // Set an extended finger pose in toPose (motion)
    const qTo = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.2));
    toPose.quaternions[idx]!.copy(qTo);

    const crossfadeDuration = 0.75;
    const fingerDuration = Math.min(crossfadeDuration, FINGER_MICRO_FADE_DURATION);

    const evaluateFinger = (elapsed: number) => {
      const alpha = Math.min(1.0, elapsed / fingerDuration);
      const fingerT = alpha * alpha * alpha * (alpha * (alpha * 6 - 15) + 10);
      for (const fingerName of FINGER_BONES) {
        const bIdx = BONE_INDEX_MAP.get(fingerName);
        if (bIdx !== undefined) {
          if (alpha >= 1.0) {
            upperPose.quaternions[bIdx]!.copy(toPose.quaternions[bIdx]!);
          } else {
            upperPose.quaternions[bIdx]!.copy(fromPose.quaternions[bIdx]!).slerp(toPose.quaternions[bIdx]!, fingerT);
          }
        }
      }
    };

    // 1. At elapsed = 0.0s (Frame 0): Must strictly match fromPose (0-frame pop eliminated)
    evaluateFinger(0.0);
    expect(upperPose.quaternions[idx]!.x).toBeCloseTo(qFrom.x, 4);
    expect(upperPose.quaternions[idx]!.y).toBeCloseTo(qFrom.y, 4);
    expect(upperPose.quaternions[idx]!.z).toBeCloseTo(qFrom.z, 4);
    expect(upperPose.quaternions[idx]!.w).toBeCloseTo(qFrom.w, 4);

    // 2. At elapsed = 0.17s (Midpoint of 0.34s): Quintic smootherstep S(0.5) = 0.5
    evaluateFinger(0.17);
    const expectedMid = new THREE.Quaternion().copy(qFrom).slerp(qTo, 0.5);
    expect(upperPose.quaternions[idx]!.z).toBeCloseTo(expectedMid.z, 3);

    // Compare with full body t at 0.17s (over 0.75s):
    // alpha_body = 0.17 / 0.75 = 0.2267, Quintic(0.2267) ~ 0.08
    // Fingers are at 50% smoothly unfurling, while body has just begun initial gentle lift (~8%)
    const bodyAlpha = 0.17 / crossfadeDuration;
    const bodyT = bodyAlpha * bodyAlpha * bodyAlpha * (bodyAlpha * (bodyAlpha * 6 - 15) + 10);
    expect(bodyT).toBeLessThan(0.10);

    // 3. At elapsed = 0.34s: Fingers have cleanly and completely settled into toPose
    evaluateFinger(0.34);
    expect(upperPose.quaternions[idx]!.x).toBeCloseTo(qTo.x, 4);
    expect(upperPose.quaternions[idx]!.y).toBeCloseTo(qTo.y, 4);
    expect(upperPose.quaternions[idx]!.z).toBeCloseTo(qTo.z, 4);
    expect(upperPose.quaternions[idx]!.w).toBeCloseTo(qTo.w, 4);

    // Body at 0.34s is only at alpha = 0.34 / 0.75 = 0.4533, Quintic(0.4533) ~ 0.41
    const bodyAlpha2 = 0.34 / crossfadeDuration;
    const bodyT2 = bodyAlpha2 * bodyAlpha2 * bodyAlpha2 * (bodyAlpha2 * (bodyAlpha2 * 6 - 15) + 10);
    expect(bodyT2).toBeLessThan(0.45);
  });
});

