import { isTauri } from '@/lib/platform';
import { executeProtocolMessage } from './handler';
import type { ProtocolMessage } from './types';

let unlistenFn: (() => void) | null = null;
let isInitialized = false;

/**
 * 初始化协议监听器
 * 监听来自 Tauri 原生层通过 deep-link 或 single-instance 发来的 protocol:action 事件
 */
export async function initProtocolListener(): Promise<() => void> {
  if (isInitialized) {
    return () => {};
  }
  isInitialized = true;

  // 开发调试辅助：挂载到 window，方便在 DevTools 控制台直接测试协议
  if (typeof window !== 'undefined') {
    (window as any).__triggerXiaoChunProtocol = (action: string, payload: any) => {
      console.log('[Protocol:Debug] 手动触发协议:', action, payload);
      executeProtocolMessage({
        action: action as any,
        payload,
      });
    };
  }

  if (isTauri()) {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ProtocolMessage>('protocol:action', (event) => {
        executeProtocolMessage(event.payload);
      });
      unlistenFn = unlisten;
      console.log('[Protocol] Tauri 协议事件监听已就绪 (protocol:action)');
    } catch (err) {
      console.error('[Protocol] 初始化 Tauri 协议监听失败:', err);
    }
  }

  return () => {
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
    isInitialized = false;
  };
}

export * from './types';
export * from './handler';
