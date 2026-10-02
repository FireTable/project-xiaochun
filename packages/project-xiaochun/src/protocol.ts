/**
 * protocol.ts — Project XiaoChun `<iframe>` 嵌入协议 (常量 + 类型, 零运行时依赖)。
 *
 * 单一事实源: SDK (本包) 与 `/embed` 页面 (主仓库 src/embed/) 共用这一份。
 * 所有消息名统一 `xc.` 前缀; 信封 `{ type, v, id?, payload? }`。
 *
 * 通道:
 *   1. 握手: iframe → 宿主 `xc.ready` (window.postMessage, targetOrigin = 宿主 origin)
 *            宿主 → iframe `xc.init`  (window.postMessage, targetOrigin = iframe origin, 转移 MessagePort)
 *   2. 握手后全部走 MessageChannel 端口 (端口本身即凭证, 不再依赖 `*`)
 */

/** 协议版本; 不兼容变更时 +1。 */
export const XC_PROTOCOL_VERSION = 1 as const;

/** 官方部署的 origin / embed 入口。 */
export const XC_DEFAULT_ORIGIN = 'https://xiaochun.firetable.tech';
export const XC_DEFAULT_SRC = `${XC_DEFAULT_ORIGIN}/embed`;

/** 宿主 → iframe 命令。 */
export const XC_HOST_TO_FRAME = [
  'xc.init',
  'xc.say',
  'xc.audio',
  'xc.audio.chunk',
  'xc.audio.end',
  'xc.motion',
  'xc.expression',
  'xc.lookAt',
  'xc.pointer',
  'xc.setModel',
  'xc.setConfig',
  'xc.mic',
  'xc.pause',
  'xc.resume',
  'xc.destroy',
] as const;

/** iframe → 宿主 事件。 */
export const XC_FRAME_TO_HOST = [
  'xc.ready',
  'xc.load.progress',
  'xc.loaded',
  'xc.state',
  'xc.stt',
  'xc.utterance',
  'xc.hit-region',
  'xc.error',
] as const;

export type XcHostMessageType = (typeof XC_HOST_TO_FRAME)[number];
export type XcFrameMessageType = (typeof XC_FRAME_TO_HOST)[number];

/** 当前 /embed 已实现的命令 (xc.init 是握手, 不计入)。 */
export const XC_IMPLEMENTED_COMMANDS = [
  'xc.say',
  'xc.audio',
  'xc.audio.chunk',
  'xc.audio.end',
  'xc.motion',
  'xc.expression',
  'xc.pointer',
  'xc.setModel',
  'xc.setConfig',
  'xc.mic',
  'xc.pause',
  'xc.resume',
  'xc.destroy',
] as const satisfies readonly XcHostMessageType[];

/**
 * 暂不支持 (底层无对应能力), /embed 回 `xc.error{code:'unsupported'}`。
 * TODO(xc.lookAt): 视线目前由相机 + 随机扫视驱动 (GazeController), 没有"外部指定注视点"的入口;
 *                  需要先在 gaze 层加 overrideTarget 再开放。
 */
export const XC_UNSUPPORTED_COMMANDS = ['xc.lookAt'] as const satisfies readonly XcHostMessageType[];

/**
 * xc.* ↔ xiaochun:// 对照表 (同一语义的两个传输层, 主应用内走同一个 handler: src/core/protocol/handler.ts)。
 * - `action`: 内部 protocol action 对象 (src/core/protocol/types.ts); null = 没有 deep link 对应物。
 * - `url`: 对应的 deep link 形式 (OS 级, 只在 Tauri 壳生效; iframe 不会响应 xiaochun://)。
 */
export const XC_PROTOCOL_MAPPING = [
  { xc: 'xc.say', note: 'mode:"speak" (默认)', action: 'speak', url: 'xiaochun://speak?text=…' },
  { xc: 'xc.say', note: 'mode:"chat" (走 LLM)', action: null, url: null },
  { xc: 'xc.audio', note: 'source 为 URL 字符串', action: 'speak', url: 'xiaochun://speak?audioUrl=…[&text=…]' },
  { xc: 'xc.audio', note: 'source 为 ArrayBuffer / Blob', action: 'audio', url: null },
  { xc: 'xc.audio.chunk / xc.audio.end', note: '流式 PCM', action: 'audio', url: null },
] as const;

export type XcErrorCode =
  | 'unsupported' // 命令/参数存在但底层暂无能力
  | 'bad_request' // 参数缺失/非法
  | 'not_ready' // 模型尚未加载完成
  | 'origin_denied' // 握手来源不在白名单
  | 'failed'; // 执行期异常

export type XcLang = 'zh-CN' | 'en' | 'ja';
export type XcPhase = 'idle' | 'loading' | 'thinking' | 'speaking' | 'listening' | 'paused';
/** lazy = 不预热 WebLLM / EMAGE, 首次互动再加载 (默认); eager = 立即预热。 */
export type XcHeavyMode = 'lazy' | 'eager';

export interface XcEnvelope<T extends string = string, P = unknown> {
  type: T;
  v: typeof XC_PROTOCOL_VERSION;
  /** 宿主命令可带 id; 对应的 xc.error / xc.utterance 会回带同一个 id。 */
  id?: string;
  payload: P;
}

/* ───────────── 宿主 → iframe payload ───────────── */

export interface XcConfig {
  lang?: XcLang;
  /** 背景透明 (叠在宿主页面上)。 */
  transparent?: boolean;
  /** 是否显示 iframe 内置 UI (ChatBar)。默认 false。 */
  ui?: boolean;
  /** 重资源加载策略, 见 XcHeavyMode。 */
  heavy?: XcHeavyMode;
}

export interface XcInitPayload {
  /** 宿主声明的自身 origin (iframe 会与 event.origin 交叉校验)。 */
  hostOrigin: string;
  config?: XcConfig;
}

export interface XcSayPayload {
  text: string;
  /**
   * 'speak' (默认): 直接 TTS + 动作, 不经过 LLM。
   * 'chat': 当作用户输入走 WebLLM / 自定义 provider (会触发大模型加载)。
   */
  mode?: 'speak' | 'chat';
}

/** 宿主音频的编码: encoded = 容器格式 (mp3/wav/ogg/aac/webm… 由浏览器 decodeAudioData 决定); pcm16 / float32 = 无头原始 PCM (小端, 交错)。 */
export type XcAudioFormat = 'encoded' | 'pcm16' | 'float32';

export interface XcAudioOptions {
  /** 气泡里显示的文字 (可选; 不影响音频与动作)。 */
  text?: string;
  /** 是否由 EMAGE 根据这段音频生成全身动作, 默认 true。false = 只播放音频 (此时完全不加载 EMAGE)。 */
  motion?: boolean;
  /** 是否驱动口型 (音量 RMS → 'aa'), 默认 true。 */
  lipsync?: boolean;
}

/**
 * xc.audio — 整段音频: iframe 内解码 → 16 kHz → EMAGE 窗口推理 + 同一段音频播放 + 口型, 播完回 xc.utterance{phase:'end'}。
 * 信封 `id` 用于关联 xc.utterance / xc.error。大 ArrayBuffer 请放进 postMessage 的 transfer 列表 (SDK 默认这么做)。
 */
export interface XcAudioPayload extends XcAudioOptions {
  /** ArrayBuffer / Blob (structured clone) 或 URL 字符串 (iframe 内 fetch, 仅 https 或同源, 需 CORS)。 */
  source: ArrayBuffer | Blob | string;
  /** MIME 提示, 如 'audio/mpeg'。仅作信息, 解码以浏览器嗅探为准。 */
  mimeType?: string;
  /** 默认 'encoded'。 */
  format?: XcAudioFormat;
  /** 仅原始 PCM 需要 (默认 16000); 容器格式忽略 (以文件内的采样率为准)。范围 8000~96000。 */
  sampleRate?: number;
  /** 原始 PCM 的声道数 (交错), 1 或 2, 默认 1; 内部下混为单声道。 */
  channels?: 1 | 2;
}

/**
 * xc.audio.chunk — 流式音频分块 (原始 PCM)。信封 `id` = 流 id: 同一个 id 的第一个 chunk 开启一次说话 (回 xc.utterance start),
 * 之后的 chunk 追加; 以 xc.audio.end 收尾。每个 chunk 的 `data` 应放进 transfer 列表。
 * 选项 (text/motion/lipsync) 只在第一个 chunk 里生效; sampleRate/format 整条流必须一致。
 */
export interface XcAudioChunkPayload extends XcAudioOptions {
  data: ArrayBuffer;
  format: Exclude<XcAudioFormat, 'encoded'>;
  /** 8000~96000。 */
  sampleRate: number;
  channels?: 1 | 2;
}

export interface XcAudioEndPayload {
  /** true = 立即打断 (丢弃未播放的音频); 默认 false = 播完已收到的音频后结束。 */
  abort?: boolean;
}

export interface XcMotionPayload {
  /** .vrma URL (https:// 或同源路径)。与 stop 二选一。 */
  url?: string;
  /** 内置动作名, 目前仅 'thinking'。 */
  name?: 'thinking';
  stop?: boolean;
  loop?: boolean;
  /** 淡入淡出秒数, 范围 0.26~3, 调大更柔和但响应更慢。 */
  fadeDuration?: number;
  /** 播放倍速, 范围 0.25~3。 */
  timeScale?: number;
  mask?: 'all' | 'upperBody';
}

export interface XcExpressionPayload {
  name: 'neutral' | 'happy' | 'angry' | 'sad' | 'relaxed' | 'surprised';
}

/** xc.lookAt — TODO: 暂不支持, 收到会返回 unsupported。 */
export interface XcLookAtPayload {
  /** 归一化 (-1..1), 相对 iframe 中心。 */
  x: number;
  y: number;
}

export interface XcPointerPayload {
  /** iframe 内 client 坐标 (px)。SDK 会把宿主 pointer 事件换算好再发。 */
  x: number;
  y: number;
}

export interface XcSetModelPayload {
  /** 完整 .vrm / .vrmaddon / .vrmbase URL (需 CORS)。 */
  url?: string;
  /** 内置服装 key, 见主仓库 APP_CONFIG.model.addons, 如 'xiaochun_maid'。 */
  outfit?: string;
  name?: string;
}

export interface XcMicPayload {
  enabled: boolean;
}

/* ───────────── iframe → 宿主 payload ───────────── */

export interface XcReadyPayload {
  version: string;
  protocol: typeof XC_PROTOCOL_VERSION;
  capabilities: {
    commands: string[];
    unsupported: string[];
    stt: boolean;
    transparent: boolean;
    /** 宿主音频能力 (xc.audio / xc.audio.chunk)。旧版 /embed 没有这个字段。 */
    audio?: { formats: XcAudioFormat[]; streaming: boolean; maxSeconds: number };
  };
}

export interface XcLoadProgressPayload {
  phase: 'model';
  /** 0~100 */
  progress: number;
}

export interface XcLoadedPayload {
  model: string;
}

export interface XcStatePayload {
  phase: XcPhase;
  paused: boolean;
  heavy: XcHeavyMode;
}

export type XcSttPayload =
  | { kind: 'state'; state: 'idle' | 'loading' | 'listening' | 'recognizing' | 'error' }
  | { kind: 'progress'; percent: number }
  | { kind: 'text'; text: string };

export interface XcUtterancePayload {
  phase: 'start' | 'end';
  text: string;
  /** 'text' = xc.say (TTS); 'audio' = xc.audio / xc.audio.chunk (宿主音频, 没有走 TTS)。旧版 /embed 没有这个字段。 */
  kind?: 'text' | 'audio';
}

export interface XcHitRegionPayload {
  hit: boolean;
  x: number;
  y: number;
}

export interface XcErrorPayload {
  code: XcErrorCode;
  message: string;
  /** 触发错误的命令名 (如 'xc.lookAt')。 */
  command?: string;
}

/* ───────────── 类型映射 ───────────── */

export interface XcHostPayloadMap {
  'xc.init': XcInitPayload;
  'xc.say': XcSayPayload;
  'xc.audio': XcAudioPayload;
  'xc.audio.chunk': XcAudioChunkPayload;
  'xc.audio.end': XcAudioEndPayload;
  'xc.motion': XcMotionPayload;
  'xc.expression': XcExpressionPayload;
  'xc.lookAt': XcLookAtPayload;
  'xc.pointer': XcPointerPayload;
  'xc.setModel': XcSetModelPayload;
  'xc.setConfig': XcConfig;
  'xc.mic': XcMicPayload;
  'xc.pause': undefined;
  'xc.resume': undefined;
  'xc.destroy': undefined;
}

export interface XcFramePayloadMap {
  'xc.ready': XcReadyPayload;
  'xc.load.progress': XcLoadProgressPayload;
  'xc.loaded': XcLoadedPayload;
  'xc.state': XcStatePayload;
  'xc.stt': XcSttPayload;
  'xc.utterance': XcUtterancePayload;
  'xc.hit-region': XcHitRegionPayload;
  'xc.error': XcErrorPayload;
}

export type XcHostMessage = {
  [K in XcHostMessageType]: XcEnvelope<K, XcHostPayloadMap[K]>;
}[XcHostMessageType];

export type XcFrameMessage = {
  [K in XcFrameMessageType]: XcEnvelope<K, XcFramePayloadMap[K]>;
}[XcFrameMessageType];

/* ───────────── 小工具 (SDK 与 /embed 共用) ───────────── */

export function xcMessage<K extends XcHostMessageType | XcFrameMessageType>(
  type: K,
  payload?: unknown,
  id?: string,
): XcEnvelope<K, any> {
  const m: XcEnvelope<K, any> = { type, v: XC_PROTOCOL_VERSION, payload };
  if (id !== undefined) m.id = id;
  return m;
}

/** 是否为合法 xc 信封 (只检查结构, 不检查 payload)。 */
export function isXcEnvelope(data: unknown): data is XcEnvelope {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return typeof d.type === 'string' && d.type.startsWith('xc.') && d.v === XC_PROTOCOL_VERSION;
}

/**
 * 把用户给的 origin 规整成严格的 `scheme://host[:port]`。
 * 拒绝 '*' / 通配 / 非 http(s) / 带路径的字符串 → 返回 null。
 */
export function normalizeOrigin(input: string | null | undefined): string | null {
  if (!input || input === '*' || input === 'null') return null;
  try {
    const u = new URL(input);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}
