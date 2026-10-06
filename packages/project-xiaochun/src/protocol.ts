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
  'xc.setOutfit',
  'xc.setScene',
  'xc.prefetch',
  'xc.setConfig',
  'xc.mic',
  'xc.transport',
  'xc.pause',
  'xc.resume',
  'xc.destroy',
] as const;

/** iframe → 宿主 事件。 */
export const XC_FRAME_TO_HOST = [
  'xc.ready',
  'xc.load.progress',
  'xc.loaded',
  'xc.outfit-changed',
  'xc.scene-changed',
  'xc.lang-changed',
  'xc.prefetched',
  'xc.state',
  'xc.stt',
  'xc.utterance',
  'xc.hit-region',
  'xc.gesture-move',
  'xc.gesture-resize',
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
  'xc.setOutfit',
  'xc.setScene',
  'xc.prefetch',
  'xc.setConfig',
  'xc.mic',
  'xc.transport',
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
  { xc: 'xc.transport', note: '改宿主音频倍速 / 音量, 无 deep link', action: null, url: null },
] as const;

export type XcErrorCode =
  | 'unsupported' // 命令/参数存在但底层暂无能力
  | 'bad_request' // 参数缺失/非法
  | 'not_ready' // 模型尚未加载完成
  | 'busy' // 被同类更新的请求取代 (换装 last-wins: 排队中的旧请求被新请求顶掉); 可忽略, 以最新一次为准
  | 'unknown_id' // outfit / scene id 不在 capabilities 列表里 (含原型键如 constructor)
  | 'origin_denied' // 握手来源不在白名单
  | 'failed'; // 执行期异常

/**
 * outfit / scene id 的统一格式: 小写字母开头, 小写字母/数字/下划线, 最长 64。
 * 所有 id 入口 (xc.setOutfit / xc.setScene / ?outfit= / ?scene=) 都先过这条正则, 再用 hasOwnProperty 查表,
 * 这样 `__proto__` / `constructor` / `toString` 这类原型键永远不会被当成合法 id。
 */
/**
 * iframe 内置界面部件名 (`?ui=chat,outfit,scene,lang,github` / SDK `ui: [...]`)。
 *   chat    底部聊天栏 (ChatBar, 对话走 WebLLM)
 *   bubble  头顶气泡 (说话文本 / 状态)
 *   outfit  换装按钮 (与主站 TopHeader 同款)
 *   scene   换场景(背景)按钮 (与主站 TopHeader 同款)
 *   lang    语言切换按钮 (中文 / English / 日本語; 与主站 TopHeader 同一个组件)
 *   github  GitHub 链接按钮 (新标签页打开项目仓库; 与主站 TopHeader 同一个组件)
 */
/**
 * 窗口圆角半径 (CSS px)。Tauri 桌宠的无框窗口圆角 (src/styles/main.css 的 --xc-window-radius) 与 /embed 非透明场景的默认外壳圆角共用这一个值,
 * 有单测保证两处不漂移。角落弧线 (components/CornerHandle) 的几何就是按这个半径画的。
 */
export const XC_WINDOW_CORNER_RADIUS = 20;

export const XC_UI_PARTS = ['chat', 'bubble', 'outfit', 'scene', 'lang', 'github'] as const;
export type XcUiPart = (typeof XC_UI_PARTS)[number];
const XC_UI_PART_SET: ReadonlySet<string> = new Set(XC_UI_PARTS);
/** 0.1.14 里 `ui=1` / `ui: true` 的含义 = 当时存在的全部部件。 */
export const XC_UI_LEGACY_PARTS: readonly XcUiPart[] = ['chat', 'bubble'];

export interface XcUiParse {
  /** 白名单内的部件 (去重, 保持 XC_UI_PARTS 顺序)。 */
  parts: XcUiPart[];
  /** 被忽略的未知项 (调用方负责 warn)。 */
  unknown: string[];
  /** 用了已弃用的 1 / true 写法 (调用方负责 warn)。 */
  legacy: boolean;
}

/** 规整部件名列表: 非字符串 / 未知名字忽略并记入 unknown, 重复去重。 */
export function parseXcUiList(items: readonly unknown[]): XcUiParse {
  const seen = new Set<string>();
  const unknown: string[] = [];
  for (const it of items) {
    const name = typeof it === 'string' ? it.trim().toLowerCase() : '';
    if (XC_UI_PART_SET.has(name)) seen.add(name);
    else unknown.push(typeof it === 'string' ? it.slice(0, 40) : String(typeof it));
  }
  return { parts: XC_UI_PARTS.filter((p) => seen.has(p)), unknown, legacy: false };
}

/** `?ui=` 参数 / 元素属性: 逗号分隔的部件名; 缺省 / 空 / 0 / false = 全不显示; 1 / true = 旧写法 (弃用, 映射为 chat + bubble)。 */
export function parseXcUiParam(raw: string | null | undefined): XcUiParse {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === '0' || v === 'false') return { parts: [], unknown: [], legacy: false };
  if (v === '1' || v === 'true') return { parts: [...XC_UI_LEGACY_PARTS], unknown: [], legacy: true };
  return parseXcUiList(v.split(',').filter((x) => x.trim() !== ''));
}

/** SDK 选项 `ui` (数组, 或弃用的布尔) → 规整结果。 */
export function normalizeXcUiOption(v: unknown): XcUiParse {
  if (v === true) return { parts: [...XC_UI_LEGACY_PARTS], unknown: [], legacy: true };
  if (Array.isArray(v)) return parseXcUiList(v);
  return { parts: [], unknown: [], legacy: false };
}

/**
 * 内置界面 (顶栏按钮 outfit/scene/lang/github + 聊天栏 chat) 的显示策略, 与 Tauri 桌宠的 "点击角色才出现" 同一套状态机 (src/hooks/usePetUiVisibility.ts):
 *   'transparent' (默认) 与 Tauri 完全一致: 只有透明场景默认隐藏, 单击角色出现 (按住拖动 / 长按拖不算), 再单击角色收起, 单击空白收起, 10 秒无操作自动收起
 *                 (悬停在按钮 / 聊天栏上、菜单或对话框打开、输入框聚焦 / 有输入 / 发送中 时不收); 亮 / 暗场景常显。
 *   true          所有场景都按上面的点击出现规则 (亮 / 暗场景也默认隐藏)。
 *   false         一直显示 (忽略点击规则)。
 */
export type XcUiAutoHide = boolean | 'transparent';
/** 默认值: 'transparent' (与 Tauri 一致: 只有透明场景点击出现)。 */
export const XC_UI_AUTOHIDE_DEFAULT: XcUiAutoHide = 'transparent';
/** `?uiAutoHide=` 参数 / 元素属性: 1|true → true; 0|false → false; transparent → 'transparent'; 缺省 / 非法 → undefined (调用方用默认值)。 */
export function parseXcUiAutoHide(raw: unknown): XcUiAutoHide | undefined {
  if (raw === true || raw === false || raw === 'transparent') return raw;
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  if (v === 'transparent') return 'transparent';
  return undefined;
}
/** 某个 uiAutoHide 取值在当前场景下是否生效 (隐藏 + 点击出现)。 */
export function xcUiAutoHideActive(mode: XcUiAutoHide, sceneTransparent: boolean): boolean {
  return mode === 'transparent' ? sceneTransparent : mode;
}

/* ───────────── 相机 (camera) ───────────── */

/**
 * 宿主可调的相机选项 (SDK `camera` 选项 / `?cameraFov=` 等 URL 参数 / `xc.setConfig{camera}`)。
 *   fov       视野角 (度, 默认 30): 越小越像长焦 (透视压缩、背景虚), 越大越广角。主体取景大小会随 fov 自动补偿 (距离 = 取景范围 / (2·tan(fov/2))), 所以只改 fov 时角色在画面里的大小基本不变
 *   distance  相机到角色的视距 (米, 默认约 2.5): 越小角色越大。显式设置后, 首次取景时忽略 iframe 里保存的视距 / 俯仰 (用户之后滚轮缩放仍可调, 且换装 / 换场景不会被拽回)
 *   height    取景高度偏移 (米, 默认 0): 正值 = 相机连同目标一起上抬 (角色在画面里下移), 负值相反。显式值不写入 iframe 的保存值
 *   intro     是否播放加载完成后的推镜头动画 (默认 true); false = 直接放到终点
 * 缺省 / undefined = 不覆盖 (走 iframe 保存值 / 默认值); `xc.setConfig` 里 null = 清除该项覆盖。
 */
export interface XcCamera {
  fov?: number | null;
  distance?: number | null;
  height?: number | null;
  intro?: boolean | null;
}
/**
 * 各数值项允许的范围 (越界值会被夹到边界)。与主仓库 APP_CONFIG.camera (minFov/maxFov、defaultMin/MaxDistance、hostMaxYOffset)
 * 一致, 主仓库有单测核对。capabilities.camera 也会上报这份范围。
 */
export const XC_CAMERA_RANGES = {
  fov: [15, 60],
  distance: [1, 15],
  height: [-1, 1],
} as const;
const XC_CAMERA_NUM_KEYS = ['fov', 'distance', 'height'] as const;
const XC_CAMERA_KEYS = ['fov', 'distance', 'height', 'intro'] as const;

export type XcCameraNormalized =
  | { ok: true; camera: XcCamera; /** 被夹到范围边界的项 (供告警) */ clamped: string[] }
  | { ok: false; error: string };

/**
 * 校验 + 规整一个 camera 对象 (xc.setConfig / SDK 选项共用)。
 * 数字项必须是有限 number (越界夹到范围内); intro 必须是 boolean; null = 清除; 未知键 / 非对象 → 错误。
 */
export function normalizeXcCamera(raw: unknown): XcCameraNormalized {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'camera must be an object' };
  const src = raw as Record<string, unknown>;
  for (const k of Object.keys(src)) {
    if (!(XC_CAMERA_KEYS as readonly string[]).includes(k)) return { ok: false, error: `unknown camera key: ${k} (expected ${XC_CAMERA_KEYS.join(' | ')})` };
  }
  const out: XcCamera = {};
  const clamped: string[] = [];
  for (const k of XC_CAMERA_NUM_KEYS) {
    const v = src[k];
    if (v === undefined) continue;
    if (v === null) { out[k] = null; continue; }
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: `camera.${k} must be a finite number or null` };
    const [lo, hi] = XC_CAMERA_RANGES[k];
    const c = Math.min(hi, Math.max(lo, v));
    if (c !== v) clamped.push(k);
    out[k] = c;
  }
  if (src.intro !== undefined) {
    if (src.intro !== null && typeof src.intro !== 'boolean') return { ok: false, error: 'camera.intro must be a boolean or null' };
    out.intro = src.intro;
  }
  return { ok: true, camera: out, clamped };
}

/**
 * 解析 URL 参数 cameraFov / cameraDistance / cameraHeight / cameraIntro (SDK 生成 / 手写 iframe 均可)。
 * 数值非法 → 忽略并记 warning; 越界 → 夹到范围并记 warning; cameraIntro 认 0|1|true|false。
 */
export function parseXcCameraParams(get: (name: string) => string | null): { camera: XcCamera; warnings: string[] } {
  const camera: XcCamera = {};
  const warnings: string[] = [];
  const names = { fov: 'cameraFov', distance: 'cameraDistance', height: 'cameraHeight' } as const;
  for (const k of XC_CAMERA_NUM_KEYS) {
    const raw = get(names[k]);
    if (raw === null) continue;
    const t = raw.trim();
    const n = t === '' ? NaN : Number(t);
    if (!Number.isFinite(n)) { warnings.push(`ignoring invalid ?${names[k]}=${raw}`); continue; }
    const [lo, hi] = XC_CAMERA_RANGES[k];
    const c = Math.min(hi, Math.max(lo, n));
    if (c !== n) warnings.push(`?${names[k]}=${raw} is out of range [${lo}, ${hi}], clamped to ${c}`);
    camera[k] = c;
  }
  const intro = get('cameraIntro');
  if (intro !== null) {
    const v = intro.trim().toLowerCase();
    if (v === '1' || v === 'true') camera.intro = true;
    else if (v === '0' || v === 'false') camera.intro = false;
    else warnings.push(`ignoring invalid ?cameraIntro=${intro}`);
  }
  return { camera, warnings };
}

export const XC_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
export const isXcId = (v: unknown): v is string => typeof v === 'string' && XC_ID_RE.test(v);
/** 只认对象自己的属性 (不走原型链); 等价于 Object.hasOwn, 但兼容 ES2020 目标。 */
export const xcHasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** 内置场景 id (以 xc.ready.capabilities.scenes 为准; 目前就这三个主题, 不含真实场景资产)。 */
export type XcSceneId = 'light' | 'dark' | 'transparent';
export type XcLang = 'zh-CN' | 'en' | 'ja';
/** iframe 支持的界面语言 (与主站 SUPPORTED_LANGS 同一份; capabilities.ui.langs)。 */
export const XC_LANGS: readonly XcLang[] = ['zh-CN', 'en', 'ja'];
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
  /**
   * 要显示的 iframe 内置界面部件 (见 XC_UI_PARTS), 例如 ['outfit','scene']; 省略 / 空数组 = 不显示。
   * 传 true/false 是 0.1.14 的旧写法 (true = chat + bubble), 已弃用, 仅为兼容保留。
   */
  ui?: XcUiPart[] | boolean;
  /**
   * 内置界面的显示策略 (见 XcUiAutoHide): 默认 'transparent' = 与 Tauri 一致 (只在透明场景隐藏、单击角色出现, 亮 / 暗场景常显); true = 所有场景都点击出现; false = 一直显示。
   * 仅当 capabilities.ui 存在时才有意义 (旧版 /embed 忽略, 常显)。
   */
  uiAutoHide?: XcUiAutoHide;
  /** 重资源加载策略, 见 XcHeavyMode。 */
  heavy?: XcHeavyMode;
  /**
   * 允许 xc.setModel 加载任意 https URL 的 .vrm/.vrmaddon/.vrmbase。默认 false (关闭): 只能用 capabilities.outfits 里的内置服装。
   * 由宿主 SDK 的 `allowCustomModel` 选项发出 (放在 xc.init 的 config 里)。
   */
  allowCustomModel?: boolean;
  /**
   * 手势开关 (宿主 SDK 的 `draggable` / `resizable` 选项发出; 放在 xc.init 的 config 里, 也可用 xc.setConfig 运行时改)。
   * 默认全 false: iframe 里**不识别**对应手势、也不拦截任何指针事件。仅当 capabilities.gestures 存在时才有意义 (旧版 /embed 忽略)。
   *   move   = 左键在角色上拖动 → 发 xc.gesture-move, 由宿主移动 iframe
   *   resize = 在 iframe 四角热区按下拖动 → 发 xc.gesture-resize, 由宿主缩放 iframe
   */
  gestures?: { move?: boolean; resize?: boolean };
  /**
   * 相机选项 (见 XcCamera); 放在 xc.init 的 config 里或用 xc.setConfig 运行时改 (缺省键 = 不变, null = 恢复默认, 非法值 → xc.error{bad_request})。
   * 运行时改会立刻重新取景并取消进行中的推镜头。仅当 capabilities.camera 存在时才有意义 (旧版 /embed 忽略)。
   */
  camera?: XcCamera;
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
  /**
   * 是否把这段音频送到扬声器。默认 true。
   * false: 仍解码并生成动作和口型, 增益为 0。宿主页面自己播放同一段音频时用来避免叠声。
   */
  audible?: boolean;
  /**
   * 播放倍速, 默认 1, 范围 0.25~3, 越界会夹到范围内。
   * 这段音频和动作时钟一起变快变慢。改正在播的倍速用 xc.transport。
   */
  playbackRate?: number;
  /**
   * 音量 0~1, 默认 1。audible 为 false 时扬声器仍是 0, 这个值先记下。
   * 改正在播的音量用 xc.transport。
   */
  volume?: number;
}

/**
 * xc.audio — 整段音频: iframe 内解码 → 16 kHz → EMAGE 窗口推理 + 同一段音频的时钟 + 口型。
 * xc.utterance start 在第一段时钟起步时发 (思考动作和首窗推理之后), 播完回 end。
 * audible 缺省或 true 时这段音频也送到扬声器; false 时增益为 0, 只留动作和口型。
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
 * xc.audio.chunk — 流式音频分块 (原始 PCM)。信封 `id` = 流 id: 同一个 id 的第一个 chunk 开启一次说话,
 * 声音时钟起步时回 xc.utterance start,
 * 之后的 chunk 追加; 以 xc.audio.end 收尾。每个 chunk 的 `data` 应放进 transfer 列表。
 * 选项 (text/motion/lipsync/audible/playbackRate/volume) 只在第一个 chunk 里生效; sampleRate/format 整条流必须一致。
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
  /** 完整 .vrm / .vrmaddon / .vrmbase URL (需 CORS)。**默认关闭**, 需要 xc.init config.allowCustomModel=true, 否则回 unsupported。 */
  url?: string;
  /** 内置服装 id (capabilities.outfits 里的 id, 如 'xiaochun_maid')。裸模 'base' 不对外开放 (回 unknown_id)。新代码请用 xc.setOutfit。 */
  outfit?: string;
  name?: string;
}

/** xc.setOutfit — 换内置服装 (id 来自 xc.ready.capabilities.outfits)。串行 + last-wins, 见 docs/EMBED.md。 */
export interface XcSetOutfitPayload {
  id: string;
}

/**
 * xc.prefetch — 预取服装资源到 iframe 的 IndexedDB (之后 xc.setOutfit 直接命中缓存, 不走网络)。默认不会自动发生。
 * 全局串行 (并发 1); 开了 heavy:'eager' 时排在 EMAGE 加载之后, 也不会和进行中的换装抢带宽。
 * ids 省略 = 全部内置服装, **除了**体积大的婚纱 (xiaochun_wedding, 13.9MB); 显式点名则照做。
 * 应答 xc.prefetched (带同一个信封 id)。
 */
export interface XcPrefetchPayload {
  ids?: string[];
}

/** xc.prefetched — 预取完成 (逐项成败不影响整体; failed 里的 id 可稍后重试)。 */
export interface XcPrefetchedPayload {
  downloaded: string[];
  cached: string[];
  failed: string[];
  /** 'save-data' = 用户开了省流量模式, 整个请求被跳过。 */
  skipped?: 'save-data';
}

/** xc.setScene — 运行时切场景 (id 来自 xc.ready.capabilities.scenes: light / dark / transparent)。 */
export interface XcSetScenePayload {
  id: string;
}

export interface XcMicPayload {
  enabled: boolean;
}

/** xc.transport — 改当前宿主音频的倍速或音量, 不重开这一次说话。缺省字段保持原值。 */
export interface XcTransportPayload {
  /** 0.25~3。越界夹到范围内。不是数字则忽略。 */
  playbackRate?: number;
  /** 0~1。audible:false 时扬声器仍为 0。 */
  volume?: number;
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
    audio?: {
      formats: XcAudioFormat[];
      streaming: boolean;
      maxSeconds: number;
      /** 倍速范围。旧版没有。 */
      playbackRate?: { min: number; max: number };
      /** 音量范围。旧版没有。 */
      volume?: { min: number; max: number };
    };
    /** iframe 内 `self.crossOriginIsolated` (true = 可用 SharedArrayBuffer / 多线程 wasm)。旧版 /embed 没有这个字段。仅诊断用。 */
    crossOriginIsolated?: boolean;
    /** 可换的内置服装 (不含裸模)。旧版 /embed 没有这个字段 → 宿主应视为"不支持 xc.setOutfit"。 */
    outfits?: XcOutfitInfo[];
    /** 可切的场景。旧版 /embed 没有这个字段 → 视为"不支持 xc.setScene"。 */
    scenes?: XcSceneInfo[];
    /** 支持 xc.prefetch。旧版 /embed 没有这个字段。 */
    prefetch?: boolean;
    /**
     * iframe 内手势 (拖动 / 角落缩放) 支持情况; 旧版 /embed 没有这个字段 → 宿主视为"不支持", draggable / resizable 无效。
     * cornerSize = 四角热区边长 (CSS px, iframe 视口左上/右上/左下/右下各一个正方形), 宿主 UI 可据此提示。
     */
    gestures?: { move: boolean; resize: boolean; cornerSize: number };
    /**
     * 内置界面能力; 旧版 /embed 没有这个字段 → 宿主视为"没有 lang / github 部件、不支持 uiAutoHide (界面常显)"。
     * parts = 可用的部件名; autoHide = 支持 uiAutoHide (点击出现); langs = 语言按钮 / `lang` 选项可用的取值。
     */
    ui?: { parts: XcUiPart[]; autoHide: boolean; langs: XcLang[] };
    /**
     * 相机选项能力 (见 XcCamera); 旧版 /embed 没有这个字段 → 宿主视为"不支持 camera 选项"。
     * fov / distance / height = 各项允许范围 [min, max] (越界会被夹到边界); intro = 支持关闭推镜头。
     */
    camera?: { fov: [number, number]; distance: [number, number]; height: [number, number]; intro: boolean };
  };
}

export interface XcOutfitInfo {
  id: string;
  /** 展示名 (英文, 来自主仓库配置)。 */
  name: string;
  /** 服装文件大小提示 (MB, 十进制, 约值; 公共的裸模 ~5.7MB 不计)。仅供宿主自己的 UI 参考 (内置换装菜单不显示体积); 旧版 /embed 没有这个字段。 */
  sizeMB?: number;
}

export interface XcSceneInfo {
  id: string;
  /** true = 背景透明 (叠在宿主页上, 可开穿透)。 */
  transparent: boolean;
}

export interface XcLoadProgressPayload {
  /**
   * 'model' = 首次加载; 'outfit' = 运行中换装 (id = 目标服装 id, 自定义 URL 时省略);
   * 'prefetch' = 宿主发了 xc.prefetch 后的后台下载 (id = 正在预取的服装)。已有的"model 进度条"逻辑请先判断 phase。
   */
  phase: 'model' | 'outfit' | 'prefetch';
  /** 0~100 */
  progress: number;
  id?: string;
}

export interface XcLoadedPayload {
  model: string;
}

/**
 * xc.outfit-changed — 服装已生效。三种来源: 首次加载 (initial:true)、xc.setOutfit / xc.setModel 的应答 (带同一个信封 id)。
 * noop:true = 目标已经是当前服装 (或与另一个同目标请求合并), 没有重新加载; SDK 只用它 resolve 对应的 Promise, 不再触发事件。
 */
export interface XcOutfitChangedPayload {
  /** 内置服装 id; 自定义 URL 模型为 null。 */
  id: string | null;
  name: string;
  previous?: string | null;
  initial?: boolean;
  noop?: boolean;
}

/** xc.scene-changed — 场景已生效 (首次握手后的当前场景 / xc.setScene 应答 / xc.setConfig{transparent} 引起的切换)。 */
export interface XcSceneChangedPayload {
  id: string;
  transparent: boolean;
  previous?: string | null;
  initial?: boolean;
  noop?: boolean;
}

/**
 * xc.lang-changed — iframe 当前界面语言 (握手后上报一次 initial:true; 之后用户点语言按钮 / xc.setConfig{lang} 引起的变化)。
 * 初始语言优先级: `?lang=` (SDK `lang` 选项) > iframe 自己 localStorage 里记住的用户选择 > 浏览器语言 > zh-CN。
 */
export interface XcLangChangedPayload {
  lang: XcLang;
  previous?: XcLang | null;
  initial?: boolean;
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

/** 手势阶段: start = 按下后确认成手势; move = 增量; end = 结束 (松手 / 取消 / 失焦)。 */
export type XcGesturePhase = 'start' | 'move' | 'end';

/**
 * xc.gesture-move / xc.gesture-resize 的公共字段。单位 CSS px (屏幕坐标差, iframe 被移动时仍稳定)。
 *  - gesture: 手势序号, 每次新手势 +1 (从 1 起); 宿主据此区分手势, 丢弃过期手势的迟到消息。
 *  - seq: 该手势内的消息序号, start = 0, 之后严格递增; 宿主丢弃 seq 不递增的消息。
 *  - dx / dy: 相对上一条消息的增量; totalDx / totalDy: 相对 start 的累计 (宿主以它为准计算, 增量只是参考, 丢包也不漂移)。
 *  - reason: 仅 phase='end' 带: up = 松手, cancel = 指针被系统取消, blur = 窗口失焦。
 */
export interface XcGestureBase {
  gesture: number;
  seq: number;
  phase: XcGesturePhase;
  dx: number;
  dy: number;
  totalDx: number;
  totalDy: number;
  reason?: 'up' | 'cancel' | 'blur';
}
export type XcGestureMovePayload = XcGestureBase;
export type XcGestureCorner = 'NW' | 'NE' | 'SW' | 'SE';
export interface XcGestureResizePayload extends XcGestureBase {
  /** 被拖的角; 对角固定不动。 */
  corner: XcGestureCorner;
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
  'xc.setOutfit': XcSetOutfitPayload;
  'xc.setScene': XcSetScenePayload;
  'xc.prefetch': XcPrefetchPayload;
  'xc.setConfig': XcConfig;
  'xc.mic': XcMicPayload;
  'xc.transport': XcTransportPayload;
  'xc.pause': undefined;
  'xc.resume': undefined;
  'xc.destroy': undefined;
}

export interface XcFramePayloadMap {
  'xc.ready': XcReadyPayload;
  'xc.load.progress': XcLoadProgressPayload;
  'xc.loaded': XcLoadedPayload;
  'xc.outfit-changed': XcOutfitChangedPayload;
  'xc.scene-changed': XcSceneChangedPayload;
  'xc.lang-changed': XcLangChangedPayload;
  'xc.prefetched': XcPrefetchedPayload;
  'xc.state': XcStatePayload;
  'xc.stt': XcSttPayload;
  'xc.utterance': XcUtterancePayload;
  'xc.hit-region': XcHitRegionPayload;
  'xc.gesture-move': XcGestureMovePayload;
  'xc.gesture-resize': XcGestureResizePayload;
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
