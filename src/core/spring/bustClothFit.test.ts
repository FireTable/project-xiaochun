import { describe, expect, it } from 'vitest';
import {
  bustFalloff,
  bustJointHitRadius,
  clothScaleGap,
  isClothSpringName,
  scaledBustColliderRadius,
  shouldConsiderCloth,
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

  it('does not push a vertex the bust bone already carries', () => {
    expect(clothScaleGap(1, 1, 1.5)).toBeCloseTo(0);
    expect(clothScaleGap(0, 1, 1.5)).toBeCloseTo(0.5);
    expect(clothScaleGap(0, 1, 1)).toBeCloseTo(0);
    expect(clothScaleGap(0.5, 0.5, 1.4)).toBeCloseTo(0.4 * 0.5 * 0.5);
  });
});
