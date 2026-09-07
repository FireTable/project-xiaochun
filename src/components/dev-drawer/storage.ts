/**
 * DevDrawer localStorage 读写。ponytail: 旧 API 完全保留,只是拆文件 —
 * 各段组件直接 import load/save,各自的 setState 各自持久化,不用都堆在壳里。
 */
import type { DevDrawerFullSettings } from './types';
import { DEV_DRAWER_STORAGE_KEY, DEV_DRAWER_COLLAPSED_KEY, BODY_MORPH_KEY } from '@/lib/constants';

// ponytail: 重新导出保持向后兼容 — 老调用方 `import { DEV_DRAWER_STORAGE_KEY } from '../storage'` 还能用。
export { DEV_DRAWER_STORAGE_KEY, DEV_DRAWER_COLLAPSED_KEY };

export function loadDevDrawerSettings(): Partial<DevDrawerFullSettings> | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = localStorage.getItem(DEV_DRAWER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[DevDrawer] Failed to load settings from storage:', e);
    return null;
  }
}

export function saveDevDrawerSettings(settings: Partial<DevDrawerFullSettings>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const existing = loadDevDrawerSettings() || {};
    const merged = { ...existing, ...settings };
    localStorage.setItem(DEV_DRAWER_STORAGE_KEY, JSON.stringify(merged));
  } catch (e) {
    console.warn('[DevDrawer] Failed to save settings to storage:', e);
  }
}

export function clearAllDevDrawerStorage(): void {
  try {
    localStorage.removeItem(DEV_DRAWER_STORAGE_KEY);
    localStorage.removeItem(BODY_MORPH_KEY);
  } catch {}
}