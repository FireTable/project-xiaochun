import { describe, it, expect } from 'vitest';
import { captureViewPrefs, restoreViewPrefs } from '../viewPrefs';
import { BODY_YAW_KEY, CAMERA_PITCH_KEY, CAMERA_Y_OFFSET_KEY } from '@/lib/constants';

function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

describe('view preference snapshot (story tutorial drags must not change the refreshed view)', () => {
  it('restores what was saved before the story, overwriting what the tutorial drags wrote', () => {
    const s = memoryStorage({ [BODY_YAW_KEY]: '0.3', [CAMERA_PITCH_KEY]: '{"pitch":1.5,"distance":2.4}', [CAMERA_Y_OFFSET_KEY]: '0.05', other: 'keep' });
    const snap = captureViewPrefs(s);
    s.setItem(BODY_YAW_KEY, '2.9');
    s.setItem(CAMERA_PITCH_KEY, '{"pitch":0.4}');
    s.setItem(CAMERA_Y_OFFSET_KEY, '-0.2');
    restoreViewPrefs(snap, s);
    expect(s.dump()).toEqual({ [BODY_YAW_KEY]: '0.3', [CAMERA_PITCH_KEY]: '{"pitch":1.5,"distance":2.4}', [CAMERA_Y_OFFSET_KEY]: '0.05', other: 'keep' });
  });

  it('removes keys that did not exist before the story', () => {
    const s = memoryStorage();
    const snap = captureViewPrefs(s);
    s.setItem(BODY_YAW_KEY, '1.2');
    s.setItem(CAMERA_PITCH_KEY, '{"pitch":1}');
    restoreViewPrefs(snap, s);
    expect(s.dump()).toEqual({});
  });

  it('is a no-op without storage', () => {
    expect(() => restoreViewPrefs(captureViewPrefs(null), null)).not.toThrow();
  });
});
