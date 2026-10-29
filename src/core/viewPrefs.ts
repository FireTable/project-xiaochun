import { BODY_YAW_KEY, CAMERA_PITCH_KEY, CAMERA_Y_OFFSET_KEY } from '@/lib/constants';

/**
 * 用户的“刷新后默认视角”由三个 localStorage 偏好决定：角色自转偏角、镜头俯仰 / 视距、相机 Y 偏移。
 * 故事模式里用户会拖拽镜头 / 转身 (教学)，拖完会写回这三项；退出故事时按进入前的快照还原，
 * 这样“退出后的视角”与“刷新页面后的视角”才是同一个。
 */
const VIEW_PREF_KEYS = [BODY_YAW_KEY, CAMERA_PITCH_KEY, CAMERA_Y_OFFSET_KEY] as const;

export type ViewPrefsSnapshot = Record<string, string | null>;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function captureViewPrefs(storage: StorageLike | null = defaultStorage()): ViewPrefsSnapshot {
  const snap: ViewPrefsSnapshot = {};
  for (const k of VIEW_PREF_KEYS) {
    try {
      snap[k] = storage ? storage.getItem(k) : null;
    } catch {
      snap[k] = null;
    }
  }
  return snap;
}

export function restoreViewPrefs(snap: ViewPrefsSnapshot, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  for (const k of VIEW_PREF_KEYS) {
    try {
      const v = snap[k];
      if (v === null || v === undefined) storage.removeItem(k);
      else storage.setItem(k, v);
    } catch {
      /* 存储不可用时忽略 */
    }
  }
}
