import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { APP_CONFIG } from '@/config';
import { POSTFX_STORAGE_KEY, SCENE_THEME_KEY } from '@/lib/constants';
import type { LineworkTheme } from '@/core/scene/lineworkWorld';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 统一获取渲染像素比 (VRMEngine / PostFX 通用)：
 * 严格限制在物理 devicePixelRatio 与 APP_CONFIG.renderer.maxPixelRatio 之间，
 * 杜绝无节制的超采样 (supersampling) 造成 GPU 显存与填充率浪费。
 */
export function getRenderPixelRatio(maxRatio: number = APP_CONFIG.renderer.maxPixelRatio): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, maxRatio);
}

/**
 * ponytail: postFX 总开关从 localStorage 读取。DevDrawer 折叠时 PostFxSection
 * 不 mount,React useEffect 不跑,vrmEngine init 仍要读到用户上次的选择,
 * 否则 refresh 后总是回到默认 enabled=true。
 */
export function loadPostFxEnabledFromStorage(): boolean | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = localStorage.getItem(POSTFX_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const enabled = parsed?.postfx?.enabled;
    return typeof enabled === 'boolean' ? enabled : null;
  } catch {
    return null;
  }
}

/**
 * 解析场景线稿主题（light / dark）：
 * 1. 优先读取用户在 localStorage 中显式选择的持久化偏好 (SCENE_THEME_KEY)；
 * 2. 初次访问（localStorage 无记录）时，自适应探测用户设备系统的亮暗模式 (prefers-color-scheme: dark)；
 *    若设备处于深色模式，则默认切到极夜深蓝线稿 ('dark')，杜绝首屏白光刺眼；
 * 3. 兜底使用 APP_CONFIG.scene.theme（默认 'light'）。
 */
export function resolveInitialSceneTheme(): LineworkTheme {
  if (typeof window === 'undefined') return APP_CONFIG.scene?.theme ?? 'light';
  try {
    const stored = localStorage.getItem(SCENE_THEME_KEY) as LineworkTheme | null;
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {}

  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {}

  return APP_CONFIG.scene?.theme ?? 'light';
}


