import { describe, expect, it } from 'vitest';
import { PoseBuffer } from './pipeline/poseBuffer';
import { ListeningMotionSystem } from './sources/listening';
import { MOTION_CATALOG, getMotionName, getMotionDescription } from './catalog';
import { zhCN } from '@/i18n/zh-CN';
import { en } from '@/i18n/en';
import { ja } from '@/i18n/ja';

describe('ListeningMotionSystem (Mocap-Driven Listening Weight)', () => {
  it('smoothly scales weight up to > 0.8 under 0.75s Quintic curve, then fades out', () => {
    const pose = new PoseBuffer();
    const system = new ListeningMotionSystem();

    // 推进约 0.8 秒 (50 帧 * 0.016s)
    for (let i = 0; i < 50; i++) system.sampleInto(pose, i * 0.016, 0.016, true);
    expect(system.weight).toBeGreaterThan(0.8);
    expect(system.weight).toBeLessThanOrEqual(1.0);

    // 退出倾听后平滑衰减至 0
    for (let i = 0; i < 100; i++) system.sampleInto(pose, 1.0 + i * 0.016, 0.016, false);
    expect(system.weight).toBeLessThan(0.05);
  });

  it('does nothing while disabled', () => {
    const pose = new PoseBuffer();
    const system = new ListeningMotionSystem();
    system.enabled = false;
    for (let i = 0; i < 60; i++) system.sampleInto(pose, i * 0.016, 0.016, true);
    expect(system.weight).toBe(0);
  });

  it('verifies MOTION_CATALOG i18n keys resolve across zh-CN, en, and ja', () => {
    const resolveKey = (dict: Record<string, any>, key: string) => {
      return key.split('.').reduce((acc, part) => acc?.[part], dict);
    };

    for (const item of Object.values(MOTION_CATALOG)) {
      expect(item.nameKey).toBeDefined();
      expect(item.descriptionKey).toBeDefined();

      // zh-CN
      expect(resolveKey(zhCN, item.nameKey)).toBeTruthy();
      expect(resolveKey(zhCN, item.descriptionKey!)).toBeTruthy();

      // en
      expect(resolveKey(en, item.nameKey)).toBeTruthy();
      expect(resolveKey(en, item.descriptionKey!)).toBeTruthy();

      // ja
      expect(resolveKey(ja, item.nameKey)).toBeTruthy();
      expect(resolveKey(ja, item.descriptionKey!)).toBeTruthy();

      // getMotionName / getMotionDescription helpers
      const mockT = (key: string) => resolveKey(zhCN, key);
      expect(getMotionName(item, mockT)).toBe(resolveKey(zhCN, item.nameKey));
      expect(getMotionDescription(item, mockT)).toBe(resolveKey(zhCN, item.descriptionKey!));
    }
  });
});
