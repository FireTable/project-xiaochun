/**
 * runtimeState.ts — 小蠢运行时跨进程状态同步中心
 *
 * 负责管理并向原生层 (Tauri) 及外部（Cindy 插件、Node Worker、CLI 等）
 * 暴露小蠢的实时运行状态，包括：
 * 1. 是否已完成新手引导向导 (onboardingCompleted)
 * 2. 当前是否正在进行新手引导剧情向导 (onboardingActive)
 * 3. 当前所在 3D 场景 (currentScene)
 * 4. 当前身着的 3D 服装 (currentOutfit)
 */

import { ONBOARDING_STORAGE_KEY } from '@/lib/constants';
import { isTauri } from '@/lib/platform';
import { isLoopbackHost } from '@/lib/loopback';

export interface XiaoChunRuntimeState {
  onboardingCompleted: boolean;
  onboardingActive: boolean;
  currentScene: string;
  currentOutfit: string | null;
  updatedAt: number;
}

let cachedState: XiaoChunRuntimeState | null = null;

export function getXiaoChunRuntimeState(): XiaoChunRuntimeState {
  if (typeof window === 'undefined') {
    return {
      onboardingCompleted: false,
      onboardingActive: true,
      currentScene: 'beach3d',
      currentOutfit: null,
      updatedAt: Date.now(),
    };
  }

  let completed = false;
  try {
    completed = typeof localStorage !== 'undefined' && localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1';
  } catch {}

  const active = Boolean(
    (window as any).__IS_ONBOARDING_ACTIVE__ ?? !completed
  );

  return {
    currentScene: 'beach3d',
    currentOutfit: null,
    ...(cachedState || {}),
    onboardingCompleted: completed,
    onboardingActive: active,
    ...((window as any).__CURRENT_SCENE_ID__ ? { currentScene: (window as any).__CURRENT_SCENE_ID__ } : {}),
    ...((window as any).__CURRENT_OUTFIT_KEY__ !== undefined ? { currentOutfit: (window as any).__CURRENT_OUTFIT_KEY__ } : {}),
    updatedAt: Date.now(),
  };
}

export function isXiaoChunOnboardingActive(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as any).__IS_ONBOARDING_ACTIVE__ !== undefined) {
    return Boolean((window as any).__IS_ONBOARDING_ACTIVE__);
  }
  // 在 /embed 纯净内嵌环境中，不挂载新手序章向导，因此引导状态恒为非激活，免除对宿主指令的阻拦
  if (typeof window.location?.pathname === 'string' && window.location.pathname.startsWith('/embed')) {
    return false;
  }
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) !== '1';
  } catch {
    return false;
  }
}

export async function syncXiaoChunRuntimeState(updates: Partial<XiaoChunRuntimeState> = {}): Promise<void> {
  if (typeof window === 'undefined') return;

  const current = getXiaoChunRuntimeState();
  const next: XiaoChunRuntimeState = {
    ...current,
    ...updates,
    updatedAt: Date.now(),
  };

  cachedState = next;
  (window as any).__XIAOCHUN_RUNTIME_STATE__ = next;
  if (updates.onboardingActive !== undefined) {
    (window as any).__IS_ONBOARDING_ACTIVE__ = updates.onboardingActive;
  }
  if (updates.currentScene) {
    (window as any).__CURRENT_SCENE_ID__ = updates.currentScene;
  }
  if (updates.currentOutfit !== undefined) {
    (window as any).__CURRENT_OUTFIT_KEY__ = updates.currentOutfit;
  }

  // 若处于 Tauri 原生桌面端环境中，调用原生命令同步至跨进程状态文件
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('sync_runtime_state', { state: next });
    } catch (err) {
      console.warn('[RuntimeState] 同步原生状态失败:', err);
    }
  } else if (typeof window !== 'undefined' && isLoopbackHost()) {
    // 若处于内嵌伴侣回环服务环境中，向 Node 桥接服务同步状态文件，确保持久化落盘 (SSOT)
    try {
      void fetch('/api/companion-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next)
      }).catch(() => {});
    } catch {
      // 静默忽略
    }
  }
}
