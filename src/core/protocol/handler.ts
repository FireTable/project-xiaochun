import { vrmEngine } from '@/core/vrmEngine';
import { resolveWholeAudio } from './audio';
import {
  ProtocolError,
  type AudioPayload,
  type ProtocolMessage,
  type ProtocolRunHooks,
  type SpeakPayload,
} from './types';

/**
 * 等待 VRM 模型加载完毕（应对应用刚冷启动时立即收到协议调用的场景）
 */
async function waitForVRMReady(timeoutMs = 60000): Promise<boolean> {
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

async function requireVRM(): Promise<void> {
  if (!(await waitForVRMReady())) {
    throw new ProtocolError('not_ready', '等待 VRM 加载超时 (60s)，无法开始说话。冷启动较慢时请确认模型已加载后再重试。');
  }
}

/** 播放宿主音频: 解析输入 (与等模型就绪并行) → vrmEngine.speakAudio。speak+audioUrl 与 xc.audio 都走这里。 */
async function runAudio(payload: AudioPayload, hooks?: ProtocolRunHooks): Promise<void> {
  const [input] = await Promise.all([
    payload.stream ? Promise.resolve(payload.stream) : resolveWholeAudio(payload),
    requireVRM(),
  ]);
  const text = typeof payload.text === 'string' ? payload.text : '';
  // start 等到声音时钟起步再发。思考动作和 EMAGE 首窗都在那之前, 宿主才能把自家播放对齐。
  await vrmEngine.speakAudio(input, {
    motion: payload.motion !== false,
    lipsync: payload.lipsync !== false,
    audible: payload.audible !== false,
    playbackRate: payload.playbackRate,
    volume: payload.volume,
    text: text || undefined,
    onAudibleStart: () => hooks?.onStart?.({ kind: 'audio', text }),
  });
}

/**
 * 协议指令执行器 (抛错版): 两个传输层共用。
 * - xiaochun:// deep link 通过 executeProtocolMessage (吞错 + 打日志)。
 * - iframe xc.say / xc.audio 通过 bridge 调用本函数, 把 ProtocolError 映射成 xc.error。
 */
export async function runProtocolAction(message: ProtocolMessage, hooks?: ProtocolRunHooks): Promise<void> {
  switch (message.action) {
    case 'speak': {
      const payload = message.payload as SpeakPayload;
      // 预合成音频: 绕过 TTS, 走和 xc.audio 同一条链路 (text 只作气泡文字)
      if (payload && typeof payload.audioUrl === 'string' && payload.audioUrl) {
        await runAudio({ source: payload.audioUrl, text: payload.text }, hooks);
        return;
      }
      if (!payload || !payload.text) {
        if (payload?.fileError) throw new ProtocolError('bad_request', `speak 指令读取文件失败: ${payload.fileError}`);
        if (payload?.file) throw new ProtocolError('bad_request', `speak 指令文件路径未解析出有效文本 (文件为空或路径不存在): ${payload.file}`);
        throw new ProtocolError('bad_request', 'speak 指令缺少 text 内容');
      }
      await requireVRM();
      hooks?.onStart?.({ kind: 'text', text: payload.text });
      console.log(`[Protocol] 执行 speakText (字数: ${payload.text.length}):`, payload.text);
      await vrmEngine.speakText(payload.text);
      return;
    }
    case 'audio': {
      await runAudio(message.payload as AudioPayload, hooks);
      return;
    }
    default:
      throw new ProtocolError('unsupported', `未知协议动作: ${String((message as { action?: unknown }).action)}`);
  }
}

/**
 * 协议指令路由执行器 (deep link 入口, 行为与改动前一致: 出错只打日志, 不抛)
 */
export async function executeProtocolMessage(message: ProtocolMessage): Promise<void> {
  console.log('[Protocol] 收到协议指令:', message);
  try {
    await runProtocolAction(message);
  } catch (err) {
    if (err instanceof ProtocolError && err.code === 'bad_request') console.warn(`[Protocol] ${err.message}`, message);
    else console.error('[Protocol] 协议指令执行失败:', err);
  }
}
