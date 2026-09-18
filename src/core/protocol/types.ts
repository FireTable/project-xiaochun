/**
 * 外部唤醒与远程调用协议 (Protocol) 类型定义
 */

export type ProtocolAction = 'speak';

export interface SpeakPayload {
  /**
   * 需要朗读并驱动嘴型和动作的台词文本（若通过 file 传入，Rust 会在原生层自动读取并填充此字段）
   */
  text?: string;
  /**
   * 可选：如果外部传递超长文本或由外部生成文本文件，直接传本地文件路径
   */
  file?: string;
  /**
   * 本地文件读取失败时的错误信息
   */
  fileError?: string;
  /**
   * 预留：音频地址（若已有生成的 TTS 音频）
   */
  audioUrl?: string;
}

export interface ProtocolMessage<T = unknown> {
  /**
   * 消息唯一流水号，用于去重防抖（防止同时由 listen 与 cold-start queue 重复消费）
   */
  id?: string;
  action: ProtocolAction;
  payload: T;
  /**
   * 原始触发的 URL（用于调试）
   */
  rawUrl?: string;
}
