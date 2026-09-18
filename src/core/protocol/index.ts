import { isTauri } from '@/lib/platform';
import { executeProtocolMessage } from './handler';
import type { ProtocolMessage } from './types';

let unlistenFn: (() => void) | null = null;
let isInitialized = false;

const executedMessageIds = new Set<string>();

/**
 * 带有流水号去重的指令执行包装器，防止 cold-start queue 与实时 emit 产生竞态重复执行
 */
async function executeProtocolWithDedupe(message: ProtocolMessage): Promise<void> {
  if (message.id) {
    if (executedMessageIds.has(message.id)) {
      console.log('[Protocol] 忽略已执行过的重复协议指令:', message.id);
      return;
    }
    executedMessageIds.add(message.id);
    if (executedMessageIds.size > 100) {
      const oldest = executedMessageIds.values().next().value;
      if (oldest) executedMessageIds.delete(oldest);
    }
  }
  await executeProtocolMessage(message);
}

/**
 * 初始化协议监听器
 * 监听来自 Tauri 原生层通过 deep-link 或 single-instance 发来的 protocol:action 事件，
 * 并自动拉取冷启动阶段（Webview 尚未就绪时）原生层暂存的待处理协议指令。
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
      executeProtocolWithDedupe({
        action: action as any,
        payload,
      });
    };
  }

  if (isTauri()) {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');

      // 1. 注册原生层实时广播监听
      const unlisten = await listen<ProtocolMessage>('protocol:action', (event) => {
        executeProtocolWithDedupe(event.payload);
      });
      unlistenFn = unlisten;
      console.log('[Protocol] Tauri 协议事件监听已就绪 (protocol:action)');

      // 2. 主动拉取冷启动期间暂存于原生层的待处理协议指令（避免 Webview 加载耗时丢失事件）
      try {
        const pending = await invoke<ProtocolMessage[]>('get_pending_protocol_actions');
        if (pending && pending.length > 0) {
          console.log(`[Protocol] 恢复执行 ${pending.length} 个冷启动暂存协议指令:`, pending);
          for (const msg of pending) {
            executeProtocolWithDedupe(msg);
          }
        }
      } catch (invokeErr) {
        console.warn('[Protocol] 拉取冷启动待处理协议指令失败:', invokeErr);
      }
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
