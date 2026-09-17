/**
 * 外部唤醒与远程调用协议 (Protocol) 类型定义
 */

export type ProtocolAction = 'speak';

export interface SpeakPayload {
  /**
   * 需要朗读并驱动嘴型和动作的台词文本
   */
  text: string;
  /**
   * 可选：如果外部传递超长文本或由外部生成文本文件，直接传本地文件路径
   */
  file?: string;
  /**
   * 预留：音频地址（若已有生成的 TTS 音频）
   */
  audioUrl?: string;
}

export interface ProtocolMessage<T = unknown> {
  action: ProtocolAction;
  payload: T;
  /**
   * 原始触发的 URL（用于调试）
   */
  rawUrl?: string;
}
