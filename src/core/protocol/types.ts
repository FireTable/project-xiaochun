/**
 * 外部唤醒与远程调用协议 (Protocol) 类型定义
 *
 * 同一套 action 对象 / 同一个 handler (handler.ts) 服务两个传输层:
 *   1. `xiaochun://` OS 级 deep link  (Tauri 壳: Rust → `protocol:action` 事件 → index.ts)
 *   2. iframe `xc.*` postMessage      (/embed: src/embed/bridge.ts 把 xc.say / xc.audio 转成这里的 action)
 * 对照表见 docs/PROTOCOL.md §6 与 docs/EMBED.md; 音频选项类型来自 npm 包的 protocol.ts (单一来源)。
 */
import type { XcAudioFormat, XcAudioOptions } from '@firetable/project-xiaochun/protocol';
import type { HostAudioInput } from '@/director/hostAudio';

/**
 * speak = 念一段文字 (TTS), 若带 audioUrl 则改为直接播放这段音频 (不走 TTS);
 * audio = 宿主给的音频本体 (ArrayBuffer / Blob / URL / 已解码的流), 只能经 postMessage 传入, 无 URL 形态;
 * motion = 播放指定动作 (按名称或 URL);
 * group = 从指定动作组随机抽取播放 (如 greeting, praiseCute, dancePerformance);
 * expression = 触发指定面部表情 (如 happy, gentle_smile, playful);
 * camera = 执行电影级镜头调度 (运镜、景别切换、环绕旋转、升降展示等);
 * stop = 立即停止当前语音与动作。
 */
export type ProtocolAction = 'speak' | 'audio' | 'motion' | 'expression' | 'group' | 'camera' | 'stop';

export interface CameraPayload {
  /** 镜头景别 ('extreme_close_up' | 'close_up' | 'medium' | 'full' | 'dramatic_low' 等) */
  shot?: string;
  /** 运镜轨迹动势 ('none' | 'push_in' | 'pull_out' | 'hero_spiral_orbit' | 'hero_backlight_reveal' | 'dutch_tilt' | 'arc_sweep' | 'orbit_subtle' | 'pedestal_up' 等) */
  movement?: string;
  /** 运镜持续时间 (秒，默认 1.2s) */
  durationSec?: number | string;
  /** 插值缓动曲线 ('quintic_smooth' | 'ease_out_dramatic' | 'linear') */
  easing?: 'quintic_smooth' | 'ease_out_dramatic' | 'linear';
  /** 目标视野角 (15 ~ 65) */
  targetFov?: number | string;
  /** 水平环绕旋转角度 (度数，例如 +45, -90, 180, 360) */
  orbitAngleDeg?: number | string;
  /** 风速配合倍率 */
  windMultiplier?: number | string;
  /** 是否重置为默认自由机位 */
  reset?: boolean | string;
  /** 是否执行自下而上缓缓打量人物的电影级升降运镜 */
  panUp?: boolean | string;
}

export interface MotionPayload {
  /** 动作标识符 (如 waving, joyfulJump, handHeart 等) */
  name?: string;
  /** .vrma 文件路径或外部 URL */
  url?: string;
  /** 动作组名 (若指定则从该组随机抽选) */
  group?: string;
  /** 是否循环播放 */
  loop?: boolean | string;
  /** 五次平滑淡入淡出秒数 (默认 0.75s) */
  fadeDuration?: number | string;
  /** 播放速率倍率 (默认 1.0) */
  timeScale?: number | string;
  /** 动作骨骼遮罩 ('all' | 'upperBody') */
  mask?: 'all' | 'upperBody';
  /** 是否立即平滑停止当前动作 */
  stop?: boolean | string;
}

export interface ExpressionPayload {
  /** 表情标识符 (如 happy, gentle_smile, playful, surprised, hesitant 等) */
  name: string;
  /** 表情强度 (0.0 ~ 1.0) */
  intensity?: number | string;
}

export interface MotionGroupPayload {
  /** 动作组标识符 (如 greeting, idleFlavor, listening, thinking, praiseCute, playfulSulking, dancePerformance, outfitShowcase) */
  name?: string;
  group?: string;
  loop?: boolean | string;
  fadeDuration?: number | string;
  timeScale?: number | string;
}

export interface SpeakPayload {
  /**
   * 需要朗读并驱动嘴型和动作的台词文本（若通过 file 传入，Rust 会在原生层自动读取并填充此字段）。
   * 与 audioUrl 同时出现时: 作为气泡文字显示, 不再做 TTS。
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
   * 预合成音频地址 (https 或同源, 需 CORS)。给了就跳过 TTS: 音频 → EMAGE 动作 + 口型 + 播放
   * (与 xc.audio 的 URL 形式完全等价, 走同一条 speakAudio 链路)。
   */
  audioUrl?: string;
}

/** action = 'audio' 的 payload (xc.audio / xc.audio.chunk 转换而来)。选项字段与 npm 包协议同源。 */
export interface AudioPayload extends XcAudioOptions {
  /** 整段音频: ArrayBuffer / Blob / URL。与 stream 二选一。 */
  source?: ArrayBuffer | Blob | string;
  format?: XcAudioFormat;
  mimeType?: string;
  sampleRate?: number;
  channels?: 1 | 2;
  /** 传输层已经解码好的单声道 PCM 流 (xc.audio.chunk 用)。不可序列化, 不会出现在 deep link 里。 */
  stream?: HostAudioInput;
}

export interface ProtocolMessage<T = unknown> {
  /**
   * 消息唯一流水号，用于去重防抖（防止同时由 listen 与 cold-start queue 重复消费）
   */
  id?: string;
  action: ProtocolAction;
  payload?: T;
  /**
   * 原始触发的 URL（用于调试）
   */
  rawUrl?: string;
}

/** handler 抛出的错误; code 与 xc.error 的 code 取值一致 (iframe 传输层原样映射)。 */
export type ProtocolErrorCode = 'bad_request' | 'not_ready' | 'unsupported' | 'failed' | 'busy' | 'unknown_id';
export class ProtocolError extends Error {
  code: ProtocolErrorCode;
  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

/** 传输层可以挂的回调 (deep link 不需要; iframe 用它发 xc.utterance start)。 */
export interface ProtocolRunHooks {
  /**
   * 调用一次。文本: 模型就绪、即将开口。
   * 音频: 思考动作和 EMAGE 首窗之后, 第一段 AudioBuffer 的时钟起步时。
   */
  onStart?: (info: { kind: 'text' | 'audio'; text: string }) => void;
}
