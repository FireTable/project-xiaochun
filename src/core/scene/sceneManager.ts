/**
 * sceneManager.ts — 全局场景管理器与状态调度中心
 *
 * 作为场景配置 (APP_CONFIG.scenes) 的运行时控制器：
 * 1. 负责当前场景状态的读取、切换、持久化；
 * 2. 联动 3D 引擎 (vrmEngine)、DOM 根样式 (scene-transparent) 与 Tauri 窗口属性；
 * 3. 向外提供响应式 React Hook: useCurrentScene()。
 */

import { useSyncExternalStore } from 'react';
import { APP_CONFIG, type SceneItemConfig } from '@/config';
import { SCENE_THEME_KEY } from '@/lib/constants';
import { isEmbed, isTauri } from '@/lib/platform';

/** 透明场景: Tauri 桌宠 或 /embed (宿主页叠加透明 iframe) 才允许; 普通网页保持原限制。 */
function isTransparentSceneAllowed(): boolean {
  return isTauri() || isEmbed();
}

function resolveInitialSceneId(): string {
  if (typeof window === 'undefined') {
    return APP_CONFIG.scenes.defaultSceneId;
  }

  // /embed: URL 参数优先于 localStorage (iframe 的存储可能被分区, 且宿主需要确定性外观)。
  if (isEmbed()) {
    const q = new URLSearchParams(window.location.search);
    if (q.get('transparent') === '1') return 'transparent';
    const theme = q.get('theme');
    if (theme && theme in APP_CONFIG.scenes.items && theme !== 'transparent') return theme;
  }

  try {
    const stored = localStorage.getItem(SCENE_THEME_KEY);
    if (stored && stored in APP_CONFIG.scenes.items) {
      if (stored === 'transparent' && !isTransparentSceneAllowed()) {
        return APP_CONFIG.scenes.defaultSceneId;
      }
      return stored;
    }
  } catch {}

  try {
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches &&
      'dark' in APP_CONFIG.scenes.items
    ) {
      return 'dark';
    }
  } catch {}

  return APP_CONFIG.scenes.defaultSceneId;
}

class SceneManager {
  private currentSceneId: string;
  private listeners = new Set<(scene: SceneItemConfig) => void>();

  constructor() {
    this.currentSceneId = resolveInitialSceneId();
    // 初始化时同步 DOM 类名
    if (typeof document !== 'undefined') {
      const scene = this.getCurrentScene();
      document.documentElement.classList.toggle('scene-transparent', Boolean(scene.isTransparent));
    }

    // 监听系统亮暗模式变化（仅当用户未显式存储偏好时跟随系统）
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', (e) => {
          if (localStorage.getItem(SCENE_THEME_KEY) === null) {
            const autoSceneId = e.matches ? 'dark' : 'light';
            if (autoSceneId in APP_CONFIG.scenes.items) {
              void this.setScene(autoSceneId, false);
            }
          }
        });
      } catch {}
    }
  }

  public getCurrentScene(): SceneItemConfig {
    return (
      APP_CONFIG.scenes.items[this.currentSceneId] ||
      APP_CONFIG.scenes.items[APP_CONFIG.scenes.defaultSceneId]
    );
  }

  public getCurrentSceneId(): string {
    return this.currentSceneId;
  }

  public async setScene(sceneId: string, persist: boolean = true): Promise<void> {
    const targetScene = APP_CONFIG.scenes.items[sceneId];
    if (!targetScene) {
      console.warn(`[SceneManager] Scene "${sceneId}" not found in APP_CONFIG.scenes.items`);
      return;
    }
    if (targetScene.isTransparent && !isTransparentSceneAllowed()) {
      console.warn(`[SceneManager] Transparent scene is only available in desktop host or /embed`);
      return;
    }

    this.currentSceneId = sceneId;

    if (persist && typeof window !== 'undefined') {
      try {
        localStorage.setItem(SCENE_THEME_KEY, sceneId);
      } catch {}
    }

    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('scene-transparent', Boolean(targetScene.isTransparent));
    }

    try {
      const { vrmEngine } = await import('@/core/vrmEngine');
      vrmEngine.setLineworkTheme(targetScene.lineworkTheme, persist);
    } catch (err) {
      console.warn('[SceneManager] Failed to sync theme with vrmEngine:', err);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('scene-changed', { detail: targetScene }));
    }

    this.listeners.forEach((listener) => {
      try {
        listener(targetScene);
      } catch (err) {
        console.error('[SceneManager] Listener error:', err);
      }
    });
  }

  public nextScene(): SceneItemConfig {
    const sceneKeys = Object.keys(APP_CONFIG.scenes.items);
    if (sceneKeys.length === 0) return this.getCurrentScene();

    const currentIndex = sceneKeys.indexOf(this.currentSceneId);
    const nextIndex = (currentIndex + 1) % sceneKeys.length;
    const nextKey = sceneKeys[nextIndex];

    void this.setScene(nextKey, true);
    return APP_CONFIG.scenes.items[nextKey];
  }

  public subscribe(listener: (scene: SceneItemConfig) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const sceneManager = new SceneManager();

/**
 * 响应式获取当前激活场景配置
 */
export function useCurrentScene(): SceneItemConfig {
  return useSyncExternalStore(
    (onStoreChange) => sceneManager.subscribe(() => onStoreChange()),
    () => sceneManager.getCurrentScene(),
    () => APP_CONFIG.scenes.items[APP_CONFIG.scenes.defaultSceneId]
  );
}
