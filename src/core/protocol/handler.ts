import { vrmEngine } from '@/core/vrmEngine';
import type { ProtocolMessage, SpeakPayload } from './types';

/**
 * 等待 VRM 模型加载完毕（应对应用刚冷启动时立即收到协议调用的场景）
 */
async function waitForVRMReady(timeoutMs = 15000): Promise<boolean> {
  if (vrmEngine.currentVRM) return true;
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (vrmEngine.currentVRM) {
      return true;
    }
  }
  return false;
}

/**
 * 协议指令路由执行器
 */
export async function executeProtocolMessage(message: ProtocolMessage): Promise<void> {
  console.log('[Protocol] 收到协议指令:', message);

  switch (message.action) {
    case 'speak': {
      const payload = message.payload as SpeakPayload;
      if (!payload || !payload.text) {
        console.warn('[Protocol] speak 指令缺少 text 内容:', message);
        return;
      }

      // 等待模型就绪
      const ready = await waitForVRMReady();
      if (!ready) {
        console.error('[Protocol] 等待 VRM 加载超时，无法播放 speakText');
        return;
      }

      console.log(`[Protocol] 执行 speakText (字数: ${payload.text.length}):`, payload.text);
      try {
        await vrmEngine.speakText(payload.text);
      } catch (err) {
        console.error('[Protocol] speakText 执行失败:', err);
      }
      break;
    }

    default:
      console.warn('[Protocol] 未知协议动作:', (message as any).action);
  }
}
