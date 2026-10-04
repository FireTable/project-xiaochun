/**
 * client.ts — 无框架、零运行时依赖的 Project XiaoChun 嵌入 SDK。
 *
 *   const xc = createXiaochun({ container: '#avatar', transparent: true });
 *   await xc.ready;               // 模型加载完成 (xc.loaded)
 *   await xc.say('你好呀');        // 念完 (xc.utterance end) 才 resolve
 *
 * 默认 lazy: 先放固定尺寸的占位 (不产生 CLS), 浏览器空闲 + 进入视口 + (或点击/调用 API) 之后才创建 iframe。
 */
import {
  XC_DEFAULT_SRC,
  isXcEnvelope,
  isXcId,
  normalizeOrigin,
  normalizeXcUiOption,
  XC_UI_PARTS,
  XC_WINDOW_CORNER_RADIUS,
  xcMessage,
  type XcAudioFormat,
  type XcAudioOptions,
  type XcConfig,
  type XcErrorCode,
  type XcExpressionPayload,
  type XcFrameMessage,
  type XcHeavyMode,
  type XcHitRegionPayload,
  type XcHostMessageType,
  type XcLang,
  type XcLoadProgressPayload,
  type XcMotionPayload,
  type XcOutfitChangedPayload,
  type XcOutfitInfo,
  type XcPrefetchedPayload,
  type XcReadyPayload,
  type XcSceneChangedPayload,
  type XcSceneId,
  type XcSceneInfo,
  type XcSttPayload,
  type XcStatePayload,
  type XcUiPart,
  type XcUtterancePayload,
} from './protocol';
import {
  GestureGate, fitBox, moveBox, normalizeResizable, parseGesturePayload, resizeBox,
  type Box, type ResizeLimits, type Viewport, type XiaochunResizeLimits,
} from './gesture-box';

export type { XiaochunResizeLimits } from './gesture-box';
export type XiaochunPosition = 'inline' | 'bottom-right' | 'bottom-left';
/** lazy: false=立即创建; true/'idle'=进入视口且空闲后创建; 'click'=仅点击占位或调用 API 时创建。 */
export type XiaochunLazy = boolean | 'idle' | 'click';

export interface XiaochunOptions {
  /** 挂载容器 (元素或选择器)。 */
  container: HTMLElement | string;
  /** /embed 页面地址, 默认官方部署。自建/本地调试时覆盖。 */
  src?: string;
  /** iframe 的 origin, 默认由 src 推导。所有握手/消息校验都以它为准。 */
  origin?: string;
  /** 额外允许发 xc.ready 的 origin (如 CDN 重定向); 默认只有 origin。不支持 '*'。 */
  allowedOrigins?: string[];
  lazy?: XiaochunLazy;
  /** 距视口多少 px 内就开始加载 (IntersectionObserver rootMargin)。调大=更早加载, 更耗流量; 调小=更省但滚到时可能还没好。默认 200。 */
  lazyMargin?: number;
  /** 占位图 URL / 元素; false = 不要占位。 */
  placeholder?: string | HTMLElement | false;
  /**
   * 背景透明 (叠在宿主页上)。等价于 `scene: 'transparent'`; 同时给了 `scene` 或已保存的偏好时, 以它们为准。
   * 运行中想切换请用 `setScene()`: SDK 会同步外壳背景和穿透。
   */
  transparent?: boolean;
  /** 初始场景: 'light' | 'dark' | 'transparent' (以 getScenes() 为准)。省略 = 跟随 transparent 选项 / 系统亮暗。 */
  scene?: XcSceneId | (string & {});
  /** 固定尺寸, 数字=px, 字符串=CSS 长度。务必给定, 否则无法预留空间 (CLS)。默认 320x480。 */
  width?: number | string;
  height?: number | string;
  position?: XiaochunPosition;
  /**
   * 允许用户拖动头像, 默认 false。**手势拖动**: 在角色上按住左键拖 (触屏: 手指拖) = 移动整个头像 (识别在 iframe 里, 复用 Tauri 桌宠的手势状态机,
   * 宿主执行移动并限幅在视口内); 透明 + 穿透场景下只有点在角色上才接管, 其余位置仍穿透给宿主页。内联 (position: 'inline') 用 CSS translate 位移, 不改变布局流。
   * 悬浮模式 (bottom-right / bottom-left) 同样走手势 (改 left/top)。运行中可用 `setDraggable()` 开关, 不重建 iframe。
   * 需要 /embed 的 capabilities.gestures (旧版没有 → 手势无效, 并触发一次 error{code:'unsupported'})。
   */
  draggable?: boolean;
  /**
   * 外壳圆角 (iframe / 占位图 / 外壳一起裁), 数字 = px, 或任意 CSS 长度。默认: **非透明场景 (light / dark) = 20px** (与 Tauri 桌宠窗口的圆角同值,
   * 见 XC_WINDOW_CORNER_RADIUS), 透明场景 = 0 (没有底色可裁, 角色不被裁角)。`--xc-radius` CSS 变量优先级更高。运行中可用 `setBorderRadius()` 改, 不重建 iframe。
   * 圆角半径是固定 px, 缩放 (resizable) 时不随尺寸变形。传 0 恢复方角。
   */
  borderRadius?: number | string;
  /**
   * 允许用户缩放头像, 默认 false。**角落缩放**: iframe 四个角各有一个 40px 热区 (悬停出现圆弧提示, 光标变成缩放箭头), 按住拖动 = 缩放, 对角固定。
   * true = 默认限幅 (最小 120x180, 最大只受视口限制); 对象可自定义 minWidth / minHeight / maxWidth / maxHeight (px)。
   * 缩放只改外壳尺寸, **不重建 iframe**: 模型 / 动画 / 对话状态都保持。通过 `resize` 事件拿到新尺寸, `getBox()` 随时读取。运行中可用 `setResizable()` 开关。
   * 需要 capabilities.gestures (旧版 /embed 无效, 触发一次 error{code:'unsupported'})。
   */
  resizable?: boolean | XiaochunResizeLimits;
  lang?: XcLang;
  /** 初始服装: 内置服装 id (如 'xiaochun_maid', 见 getOutfits())。未知 id 回退默认服装, 并触发 error{code:'unknown_id'}。 */
  outfit?: string;
  /**
   * @deprecated 请改用 `outfit`。值是内置服装 id 时等价于 `outfit`; https URL 不能再通过创建选项传入
   * (任意 URL 需要 `allowCustomModel: true`, 之后用 `setModel({ url })`)。
   */
  model?: string;
  /**
   * 允许 `setModel({ url })` 加载任意 https .vrm/.vrmaddon/.vrmbase, 默认 false (关闭)。
   * 模型是第三方文件, 会在 iframe 里被解析, 只在你信任该 URL 时打开。内置服装 (`setOutfit`) 不受影响。
   */
  allowCustomModel?: boolean;
  /**
   * 偏好 (服装 + 场景) 在宿主页的额外保存 (可选), 默认 false。保存位置是**宿主页**的 localStorage; 读出来后作为显式值传给 iframe, 所以会盖过 iframe 自己 localStorage 里存的 (iframe 本来就会记住用户的选择, 但它的存储可能被浏览器分区)。
   *   false        不保存
   *   'host'       保存到 localStorage['xiaochun:prefs']
   *   其它字符串   保存到 localStorage[该字符串] (同页多个实例互不覆盖时用)
   * 优先级: 显式的 outfit / scene 选项 > 已保存的偏好 > 默认。只有 setOutfit / setScene 引起的变化会写入。
   */
  persist?: false | 'host' | (string & {});
  /**
   * 要显示的 iframe 内置界面部件 (数组, 默认不写 = 全不显示):
   *   'chat'    底部聊天栏 (对话走 WebLLM, 会多下载一部分代码)
   *   'bubble'  头顶气泡 (说话文本 / 状态)
   *   'outfit'  换装按钮  } 外观/文案/交互与主站 TopHeader 一致; 点按钮走和 setOutfit() / setScene() 同一条白名单 + 串行 (last-wins) 路径,
   *   'scene'   换场景按钮 } 照常触发 outfit-changed / scene-changed, 宿主用 SDK 换装时按钮状态同步。偏好由 iframe 自己的 localStorage 记住 (显式 outfit/scene 优先); 想自己存也可用 persist 或监听事件。
   * 例: `ui: ['outfit', 'scene']`。未知名字忽略并 console.warn。创建期选项: 变化会重建 iframe。
   * 'outfit' / 'scene' 只对新版 /embed 有效 (旧版忽略未知部件名)。
   * @deprecated 布尔写法: `ui: true` (0.1.14 的旧写法) 等价于 `['chat', 'bubble']` 并 console.warn; 不要再用。
   */
  ui?: XcUiPart[] | boolean;
  heavy?: XcHeavyMode;
  /**
   * 自动预取服装资源到 iframe 的 IndexedDB (之后 setOutfit 不走网络), 默认 false。
   * true = 全部内置服装 **除了**婚纱 (13.9MB); string[] = 只预取这些 id。
   * 只在 `heavy: 'eager'` 时自动触发 (模型首次加载完成后发一次 xc.prefetch): 并发 1, 排在 EMAGE 加载之后, 不会和换装抢带宽。
   * heavy 为默认 'lazy' 时本选项不生效 —— 想按需预取请直接调用 `prefetch()`。
   */
  prefetch?: boolean | string[];
  /**
   * iframe 内滚轮缩放, 默认 true (与主站一致)。透明场景只在指针落在角色上时缩放, 其余位置滚轮穿透给宿主页;
   * 不透明场景整个 iframe 区域的滚轮 = 缩放 (会吞掉该区域的页面滚动)。传 false 锁定 (URL controls=0)。
   */
  controls?: boolean;
  /** 视口外自动 xc.pause / 回来 xc.resume, 默认 true。 */
  autoPause?: boolean;
  /** 透明模式下按"是否点在角色上"切换 iframe 的 pointer-events, 默认 = transparent。 */
  passthrough?: boolean;
  /** iframe sandbox 属性; false = 不加。默认允许 scripts/same-origin/popups。 */
  sandbox?: string | false;
  /** 握手超时 (ms), 超时 emit error{code:'timeout'}。调大适合慢网络, 调小反馈更快。默认 20000。 */
  handshakeTimeout?: number;
  /**
   * 给 iframe 的 `allow` 追加 `cross-origin-isolated` (默认 false: allow 仍是 'microphone; autoplay')。
   * 仅当宿主页自己已跨源隔离 (响应头 COOP: same-origin + COEP: credentialless / require-corp) 时才生效;
   * 开启后 iframe 内 crossOriginIsolated=true → EMAGE 的 onnxruntime-web 可用多线程 wasm (SharedArrayBuffer)。
   * 副作用: 宿主页上的第三方资源/iframe 也必须满足 COEP, 见 docs/EMBED.md。宿主未隔离时开了也无害 (浏览器忽略)。
   */
  crossOriginIsolated?: boolean;
  zIndex?: number;
}

/** speakAudio / speakAudioStream 的选项。 */
export interface XiaochunAudioOptions extends XcAudioOptions {
  /** 编码; 省略 = 'encoded' (容器格式)。传 ArrayBuffer 的原始 PCM 时必须写 'pcm16' | 'float32'。 */
  format?: XcAudioFormat;
  /** MIME 提示 (如 'audio/mpeg'); Blob 会自动取 blob.type。 */
  mimeType?: string;
  /** 原始 PCM 的采样率 (8000~96000, 整段默认 16000, 流式必填); 容器格式忽略。 */
  sampleRate?: number;
  /** 原始 PCM 声道数 (交错), 1 或 2。 */
  channels?: 1 | 2;
  /**
   * ArrayBuffer 是否用 transferable 零拷贝发送 (默认 true)。
   * true: 发出后传入的那个 ArrayBuffer 会被 detach (byteLength 变 0), 适合大音频;
   * false: 结构化克隆一份, 原 buffer 仍可用, 但多一次拷贝。TypedArray 视图总是拷贝其范围后再转移。
   */
  transfer?: boolean;
  /** URL 字符串的获取位置: 'host' (默认) = 宿主页 fetch 后转移给 iframe, 不需要 iframe 能访问该 URL; 'frame' = 把 URL 交给 iframe fetch (需 https + CORS)。 */
  fetch?: 'host' | 'frame';
  /** 触发后立即打断这次说话 (发 xc.audio.end{abort:true})。 */
  signal?: AbortSignal;
}

export type XiaochunAudioSource = ArrayBuffer | ArrayBufferView | Blob | string;

/** 流式音频句柄: write 原始 PCM 块, end 收尾, abort 立即打断; done 在说话结束 (或被抢占) 时 resolve。 */
export interface XiaochunAudioStream {
  write(data: Int16Array | Float32Array | ArrayBuffer): void;
  end(): void;
  abort(): void;
  readonly done: Promise<void>;
}

export type XiaochunErrorCode = XcErrorCode | 'timeout';
export interface XiaochunError { code: XiaochunErrorCode; message: string; command?: string }

/** `move` / `resize` 事件载荷: 手势各阶段外壳在视口中的位置与尺寸 (CSS px)。 */
export interface XiaochunBoxEvent { phase: 'start' | 'move' | 'end'; left: number; top: number; width: number; height: number }

export interface XiaochunEvents {
  /** xc.ready 握手成功 (协议层)。 */
  handshake: XcReadyPayload;
  /** 模型加载完成 (= xc.loaded)。 */
  ready: { model: string };
  progress: XcLoadProgressPayload;
  state: XcStatePayload;
  stt: XcSttPayload;
  utterance: XcUtterancePayload;
  'hit-region': XcHitRegionPayload;
  /** 服装已生效 (含首次加载, initial:true)。同目标的重复请求不会再触发。 */
  'outfit-changed': XcOutfitChangedPayload;
  /** 场景已生效 (含握手后上报的当前场景, initial:true)。 */
  'scene-changed': XcSceneChangedPayload;
  /** 用户拖动头像 (draggable): start / move / end 各发一次, 位置已限幅。 */
  move: XiaochunBoxEvent;
  /** 用户缩放头像 (resizable): start / move / end 各发一次, 尺寸已限幅。 */
  resize: XiaochunBoxEvent;
  error: XiaochunError;
  destroy: undefined;
}

export interface XiaochunInstance {
  readonly element: HTMLElement;
  readonly iframe: HTMLIFrameElement | null;
  /** 模型加载完成时 resolve; destroy 时 reject。 */
  readonly ready: Promise<void>;
  /** 手动创建 iframe (lazy 模式下等价于"用户点击")。 */
  activate(): void;
  say(text: string, opts?: { mode?: 'speak' | 'chat' }): Promise<void>;
  /**
   * 直接播放宿主给的音频 (不经过 TTS): iframe 内解码 → EMAGE 生成动作 + 口型, 念完 (xc.utterance end) 才 resolve。
   * 首次调用才加载 EMAGE 模型 (首次会慢); opts.motion=false 则只播放不加载。
   */
  speakAudio(source: XiaochunAudioSource, opts?: XiaochunAudioOptions): Promise<void>;
  /** 流式音频 (原始 PCM 分块)。sampleRate 必填; 首个 write 开启说话。 */
  speakAudioStream(opts: XiaochunAudioOptions & { sampleRate: number }): XiaochunAudioStream;
  motion(m: XcMotionPayload | string): Promise<void>;
  expression(name: XcExpressionPayload['name']): Promise<void>;
  /** TODO: 协议已预留, /embed 暂未实现 → 会收到 error{code:'unsupported'}。 */
  lookAt(x: number, y: number): Promise<void>;
  /**
   * 换内置服装 (id 见 getOutfits())。Promise 在服装**生效后** resolve (xc.outfit-changed)。
   * 并发规则: 串行 + last-wins —— 加载中再次调用会排队, 排队的旧请求被更新的顶掉时 reject `[busy]` (可忽略, 以最新一次为准);
   * 说话不会被打断, 换装在后台完成后才生效。目标已是当前服装则直接 resolve。
   * 旧版 /embed (握手里没有 capabilities.outfits) 会 reject `[unsupported]`。
   */
  setOutfit(id: string): Promise<void>;
  /** 切场景 ('light' | 'dark' | 'transparent', 见 getScenes())。SDK 同步外壳背景、穿透开关与 pointer-events。 */
  setScene(id: XcSceneId | (string & {})): Promise<void>;
  /**
   * 预取内置服装资源到 iframe 的 IndexedDB (只下载, 不解压不合成)。ids 省略 = 全部内置服装, 婚纱 (13.9MB) 除外; 显式点名则照做。
   * 全局串行 (并发 1); resolve 的结果里 failed 非空时可稍后重试。进度见 progress 事件 (payload.phase === 'prefetch')。
   * 旧版 /embed reject `[unsupported]`; 用户开了省流量模式时 resolve 且 skipped:'save-data'。
   */
  prefetch(ids?: string[]): Promise<XcPrefetchedPayload>;
  /** 握手后返回可换的内置服装 (不含裸模); 旧版 /embed 返回 []。会触发 iframe 创建 (lazy 模式)。 */
  getOutfits(): Promise<XcOutfitInfo[]>;
  /** 握手后返回可切的场景; 旧版 /embed 返回 []。 */
  getScenes(): Promise<XcSceneInfo[]>;
  /** 最近一次 xc.outfit-changed 的服装 id (自定义 URL 模型 / 尚未加载 = null)。 */
  readonly outfit: string | null;
  /** 最近一次 xc.scene-changed 的场景 id (握手前 = null)。 */
  readonly scene: string | null;
  /**
   * 旧命令, 保留兼容。内置服装请改用 `setOutfit` (并发更稳、能拿到完成通知)。
   * `{ url }` 默认被拒绝 (reject `[unsupported]`), 需创建选项 `allowCustomModel: true`。
   */
  setModel(m: string | { url?: string; outfit?: string; name?: string }): Promise<void>;
  setConfig(cfg: XcConfig): Promise<void>;
  /** 运行时设置外壳尺寸 (数字 = px, 字符串 = CSS 长度); 不重建 iframe。用户缩放后宿主要同步自己的状态时用 `resize` 事件。 */
  setSize(width: number | string, height: number | string): void;
  /** 外壳当前在视口中的位置与尺寸 (CSS px)。 */
  getBox(): { left: number; top: number; width: number; height: number };
  /** 运行时开关手势拖动 (等价于 `draggable` 选项), 不重建 iframe。 */
  /** 改外壳圆角 (数字 px / CSS 长度); 传 undefined 恢复默认 (非透明 20px / 透明 0)。 */
  setBorderRadius(radius: number | string | undefined): void;
  setDraggable(on: boolean): void;
  /** 运行时开关 / 调整角落缩放 (等价于 `resizable` 选项), 不重建 iframe。false = 关。 */
  setResizable(on: boolean | XiaochunResizeLimits): void;
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  mic(enabled: boolean): Promise<void>;
  pause(): void;
  resume(): void;
  destroy(): void;
  on<K extends keyof XiaochunEvents>(event: K, cb: (payload: XiaochunEvents[K]) => void): () => void;
}

const FALLBACK_PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 180"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6b8ae"/><stop offset="1" stop-color="#ea8377"/></linearGradient></defs><ellipse cx="60" cy="170" rx="34" ry="6" fill="#000" opacity=".12"/><circle cx="60" cy="48" r="26" fill="url(#g)" opacity=".75"/><path d="M26 160c2-40 18-62 34-62s32 22 34 62z" fill="url(#g)" opacity=".6"/></svg>',
  );

const css = (v: number | string | undefined, d: string) =>
  v === undefined ? d : typeof v === 'number' ? `${v}px` : v;

export function createXiaochun(options: XiaochunOptions): XiaochunInstance {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('[project-xiaochun] createXiaochun must run in a browser');
  }
  const container =
    typeof options.container === 'string' ? document.querySelector<HTMLElement>(options.container) : options.container;
  if (!container) throw new Error(`[project-xiaochun] container not found: ${String(options.container)}`);

  // ── 地址 / origin ──
  const src = options.src ?? XC_DEFAULT_SRC;
  let srcUrl: URL;
  try { srcUrl = new URL(src, window.location.href); } catch { throw new Error(`[project-xiaochun] invalid src: ${src}`); }
  const frameOrigin = normalizeOrigin(options.origin ?? srcUrl.origin);
  if (!frameOrigin) throw new Error('[project-xiaochun] invalid origin (wildcards are not allowed)');
  const trusted = new Set<string>([frameOrigin]);
  for (const o of options.allowedOrigins ?? []) {
    const n = normalizeOrigin(o);
    if (!n) throw new Error(`[project-xiaochun] invalid allowedOrigins entry: ${o} (wildcards are not allowed)`);
    trusted.add(n);
  }

  // ── 偏好 (persist, 可选): 宿主 localStorage; iframe 另有自己的存储 ──
  const prefsKey = options.persist === 'host' ? 'xiaochun:prefs' : typeof options.persist === 'string' && options.persist ? options.persist : null;
  type Prefs = { outfit?: string; scene?: string };
  const readPrefs = (): Prefs => {
    if (!prefsKey) return {};
    try {
      const raw = JSON.parse(window.localStorage.getItem(prefsKey) ?? 'null') as Record<string, unknown> | null;
      const out: Prefs = {};
      if (raw && typeof raw === 'object') {
        if (isXcId(raw.outfit)) out.outfit = raw.outfit;
        if (isXcId(raw.scene)) out.scene = raw.scene;
      }
      return out;
    } catch { return {}; }
  };
  const writePrefs = (patch: { [K in keyof Prefs]?: string | null }) => {
    if (!prefsKey) return;
    try {
      const next: Record<string, string> = { ...readPrefs() };
      for (const [k, v] of Object.entries(patch)) { if (v) next[k] = v; else delete next[k]; }
      window.localStorage.setItem(prefsKey, JSON.stringify(next));
    } catch { /* localStorage 不可用 (隐私模式 / 配额): 静默放弃保存 */ }
  };
  const prefs = readPrefs();

  if (options.model !== undefined && options.outfit === undefined) {
    console.warn('[project-xiaochun] option "model" is deprecated, use "outfit" (built-in outfit id).');
  }
  // ui: 部件名数组 (白名单); 布尔 true 是弃用的旧写法 (= chat + bubble)
  const uiParse = normalizeXcUiOption(options.ui);
  const uiParts = uiParse.parts;
  if (uiParse.legacy) console.warn('[project-xiaochun] option "ui: true" is deprecated, use an array of parts, e.g. ui: [\'chat\', \'bubble\', \'outfit\', \'scene\'].');
  if (uiParse.unknown.length) console.warn(`[project-xiaochun] ignoring unknown ui part(s): ${uiParse.unknown.join(', ')} (known: ${XC_UI_PARTS.join(', ')})`);
  const outfitOpt = options.outfit ?? (isXcId(options.model) ? options.model : undefined);
  const initialOutfit = outfitOpt ?? prefs.outfit;
  const initialScene = options.scene ?? prefs.scene ?? (options.transparent ? 'transparent' : undefined);
  // 场景名未知 (旧版/自定义部署) 时退回 transparent 选项; 握手后的 xc.scene-changed 会校正
  let transparent = initialScene === 'transparent' || (initialScene !== 'light' && initialScene !== 'dark' && (options.transparent ?? false));
  let passthrough = options.passthrough ?? transparent;
  const lazy: XiaochunLazy = options.lazy ?? true;
  const position = options.position ?? 'inline';
  const handshakeTimeout = options.handshakeTimeout ?? 20_000;

  // ── DOM: wrapper (固定尺寸, 防 CLS) ──
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-xiaochun', '');
  const ws = wrapper.style;
  ws.position = position === 'inline' ? 'relative' : 'fixed';
  ws.width = css(options.width, '320px');
  ws.height = css(options.height, '480px');
  ws.maxWidth = '100%';
  ws.overflow = 'visible';
  ws.contain = 'layout style';
  // ── 样式 hook: 宿主用 CSS 自定义属性控制外观 (自定义属性会穿透 Shadow DOM, 在容器或任意祖先上设置即可) ──
  // 注意: 只能影响 iframe 的「外壳」(圆角/阴影/位置/层级/背景); iframe 内部 (角色渲染、气泡) 是跨域文档, 宿主 CSS 碰不到。
  //   --xc-radius    圆角, CSS 长度, 默认 0。范围 0 ~ 宽度的一半 (50% = 圆形头像框)。调大 = 更圆; 过大会裁掉角色的头/脚。
  //   --xc-shadow    box-shadow 简写, 默认 none。透明悬浮头像建议保持 none (否则会出现一个方块阴影); 卡片式嵌入可用 '0 8px 24px rgba(0,0,0,.18)'。
  //   --xc-z-index   仅悬浮 (position≠inline) 生效, 默认 2147483000 (接近 int 上限, 盖住绝大多数页面元素)。调小 = 让宿主的弹窗/导航盖在头像上面。
  //   --xc-offset-x  仅悬浮: 距屏幕左/右边的边距, 默认 16px。调大 = 离边缘更远 (移动端注意避开系统手势区, 建议 ≥ 12px)。
  //   --xc-offset-y  仅悬浮: 距屏幕底边的边距, 默认 16px。调大 = 抬高 (避开底部导航栏/Cookie 横幅)。
  //   --xc-bg        非透明模式下 iframe 加载前/圆角外的底色, 默认 transparent。transparent: true 时忽略。
  ws.boxShadow = 'var(--xc-shadow, none)';
  const applyWrapperBg = () => { ws.background = transparent ? '' : 'var(--xc-bg, transparent)'; };
  applyWrapperBg();
  // 圆角: 选项 > (非透明 20px / 透明 0); 宿主的 --xc-radius CSS 变量始终优先
  let radiusOpt: number | string | undefined = options.borderRadius;
  const radiusValue = () => (radiusOpt !== undefined ? css(radiusOpt, '0px') : transparent ? '0px' : `${XC_WINDOW_CORNER_RADIUS}px`);
  const applyRadius = () => {
    const v = `var(--xc-radius, ${radiusValue()})`;
    ws.borderRadius = v;
    if (placeholderEl) placeholderEl.style.borderRadius = v;
    if (iframe) iframe.style.borderRadius = v;
  };
  ws.borderRadius = `var(--xc-radius, ${radiusValue()})`;
  if (position === 'bottom-right') { ws.right = 'var(--xc-offset-x, 16px)'; ws.bottom = 'var(--xc-offset-y, 16px)'; }
  if (position === 'bottom-left') { ws.left = 'var(--xc-offset-x, 16px)'; ws.bottom = 'var(--xc-offset-y, 16px)'; }
  if (position !== 'inline') ws.zIndex = `var(--xc-z-index, ${options.zIndex ?? 2147483000})`;
  ws.pointerEvents = 'none'; // 容器本身不吃事件; 占位/iframe 各自开
  wrapper.setAttribute('part', 'wrapper'); // ::part(wrapper) (仅 <xiaochun-avatar> 的 Shadow DOM 内有意义)
  container.appendChild(wrapper);

  let placeholderEl: HTMLElement | null = null;
  if (options.placeholder !== false) {
    if (options.placeholder instanceof HTMLElement) placeholderEl = options.placeholder;
    else {
      const img = document.createElement('img');
      img.src = options.placeholder || FALLBACK_PLACEHOLDER;
      img.alt = 'Project XiaoChun';
      img.decoding = 'async';
      img.width = 320; img.height = 480; // 有 width/height 属性 + 下面的 100% 样式, 解码前也不抖动
      placeholderEl = img;
    }
    const ps = placeholderEl.style;
    placeholderEl.setAttribute('part', 'placeholder');
    ps.borderRadius = `var(--xc-radius, ${radiusValue()})`;
    ps.position = 'absolute'; ps.inset = '0'; ps.width = '100%'; ps.height = '100%';
    ps.objectFit = 'contain'; ps.transition = 'opacity .25s ease'; ps.pointerEvents = 'auto';
    ps.cursor = lazy === false ? 'default' : 'pointer';
    placeholderEl.addEventListener('click', () => activate());
    wrapper.appendChild(placeholderEl);
  }

  // ── 事件 ──
  const listeners = new Map<string, Set<(p: any) => void>>();
  const emit = <K extends keyof XiaochunEvents>(ev: K, payload: XiaochunEvents[K]) => {
    listeners.get(ev)?.forEach((cb) => { try { cb(payload); } catch (e) { console.error('[project-xiaochun] listener error', e); } });
  };

  // ── ready promise ──
  let resolveReady!: () => void;
  let rejectReady!: (e: Error) => void;
  const ready = new Promise<void>((res, rej) => { resolveReady = res; rejectReady = rej; });
  ready.catch(() => {}); // 避免没人 await 时的 unhandled rejection

  // ── 状态 ──
  let iframe: HTMLIFrameElement | null = null;
  let port: MessagePort | null = null;
  let destroyed = false;
  let userPaused = false;
  let autoPaused = false;
  let loaded = false;
  let lastHit = false;
  let caps: XcReadyPayload['capabilities'] | null = null;
  let currentOutfit: string | null = null;
  let currentScene: string | null = null;
  /** 命令依赖的 capabilities 字段; 握手后若 iframe 没有 (旧版 /embed) 就本地 reject, 不发出去。 */
  type CapKey = 'outfits' | 'scenes' | 'prefetch';
  const queue: Array<{ type: XcHostMessageType; payload?: unknown; id?: string; transfer?: Transferable[]; requires?: CapKey }> = [];
  const pending = new Map<string, { resolve: (v?: unknown) => void; reject: (e: Error) => void; sawEnd: boolean }>();
  let idSeq = 0;
  let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  let io: IntersectionObserver | null = null;
  let idleHandle: number | null = null;
  let resolveHandshake!: () => void;
  const handshaked = new Promise<void>((res) => { resolveHandshake = res; });

  /** 本地拒绝一条命令 (iframe 不支持): reject 对应 Promise + 触发 error 事件。 */
  const failLocal = (type: XcHostMessageType, id: string | undefined, code: XiaochunErrorCode, message: string) => {
    emit('error', { code, message, command: type });
    const p = id ? pending.get(id) : undefined;
    if (p && id) { pending.delete(id); p.reject(new Error(`[${code}] ${message}`)); }
  };
  const unsupportedByFrame = (type: XcHostMessageType, id: string | undefined) =>
    failLocal(type, id, 'unsupported', `${type} is not supported by this /embed deployment (older version; its xc.ready has no capabilities for it)`);

  const postToFrame = (type: XcHostMessageType, payload?: unknown, id?: string, transfer?: Transferable[], requires?: CapKey) => {
    if (!port) { queue.push({ type, payload, id, transfer, requires }); return; }
    if (requires && !caps?.[requires]) { unsupportedByFrame(type, id); return; }
    port.postMessage(xcMessage(type, payload, id), transfer ?? []);
  };

  const send = (type: XcHostMessageType, payload?: unknown, wait = false, transfer?: Transferable[], fixedId?: string, requires?: CapKey): Promise<any> => {
    if (destroyed) return Promise.reject(new Error('[project-xiaochun] instance destroyed'));
    if (!iframe) activate(); // 任何交互 API 都视为"用户意图", 立即创建
    const id = fixedId ?? `c${++idSeq}`;
    // 命令应答可以带一个值 (如 xc.prefetched 的结果); 其它命令 resolve(undefined)
    const p: Promise<any> = wait
      ? new Promise<any>((resolve, reject) => pending.set(id, { resolve, reject, sawEnd: false }))
      : Promise.resolve();
    postToFrame(type, payload, id, transfer, requires);
    return p;
  };

  // ── 宿主音频 ──
  /** TypedArray 视图 → 只含其范围的独立 ArrayBuffer (拷贝); ArrayBuffer 原样返回。 */
  const toBuffer = (d: ArrayBuffer | ArrayBufferView): ArrayBuffer =>
    d instanceof ArrayBuffer ? d : (d.buffer as ArrayBuffer).slice(d.byteOffset, d.byteOffset + d.byteLength);
  const bindAbort = (signal: AbortSignal | undefined, id: string) => {
    if (!signal) return;
    const abort = () => { if (!destroyed) postToFrame('xc.audio.end', { abort: true }, id); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  };
  const speakAudio = async (source: XiaochunAudioSource, opts: XiaochunAudioOptions = {}): Promise<void> => {
    if (destroyed) throw new Error('[project-xiaochun] instance destroyed');
    if (!iframe) activate(); // 先创建 iframe (lazy 模式下与 fetch 并行, 省一点首次延迟)
    const { signal, transfer, fetch: fetchWhere, ...rest } = opts;
    const payload: Record<string, unknown> = { ...rest };
    const list: Transferable[] = [];
    if (typeof source === 'string') {
      if (fetchWhere === 'frame') payload.source = source;
      else {
        const res = await fetch(source);
        if (!res.ok) throw new Error(`[project-xiaochun] audio fetch failed: HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        payload.source = buf; list.push(buf);
        payload.mimeType ??= res.headers.get('content-type') ?? undefined;
      }
    } else if (typeof Blob !== 'undefined' && source instanceof Blob) {
      payload.source = source; // Blob 走结构化克隆 (浏览器内部引用同一份数据, 不整段复制)
      payload.mimeType ??= source.type || undefined;
    } else {
      const buf = toBuffer(source as ArrayBuffer | ArrayBufferView);
      payload.source = buf;
      // 视图总是拷贝后的新 buffer → 转移; 用户传入的 ArrayBuffer 仅在 transfer !== false 时转移 (会被 detach)
      if (!(source instanceof ArrayBuffer) || transfer !== false) list.push(buf);
    }
    if (destroyed) throw new Error('[project-xiaochun] instance destroyed');
    const id = `c${++idSeq}`;
    const done = send('xc.audio', payload, true, list, id);
    bindAbort(signal, id); // 必须在 send 之后 (信号已 aborted 时, abort 消息要排在 xc.audio 后面)
    return done;
  };
  const speakAudioStream = (opts: XiaochunAudioOptions & { sampleRate: number }): XiaochunAudioStream => {
    if (destroyed) throw new Error('[project-xiaochun] instance destroyed');
    const { signal, transfer, fetch: _f, mimeType: _m, ...rest } = opts;
    const id = `c${++idSeq}`;
    let started = false;
    let ended = false;
    let fmt: 'pcm16' | 'float32' | null = rest.format === 'pcm16' || rest.format === 'float32' ? rest.format : null;
    let done: Promise<void> = Promise.resolve();
    const handle: XiaochunAudioStream = {
      write(data) {
        if (ended) throw new Error('[project-xiaochun] audio stream already ended');
        if (destroyed) throw new Error('[project-xiaochun] instance destroyed');
        if (data instanceof Int16Array) fmt ??= 'pcm16';
        else if (data instanceof Float32Array) fmt ??= 'float32';
        if (!fmt) throw new Error('[project-xiaochun] speakAudioStream: set opts.format when writing raw ArrayBuffers');
        const buf = toBuffer(data);
        const body: Record<string, unknown> = { data: buf, format: fmt, sampleRate: rest.sampleRate, channels: rest.channels };
        if (!started) {
          started = true;
          body.text = rest.text; body.motion = rest.motion; body.lipsync = rest.lipsync;
          done = send('xc.audio.chunk', body, true, [buf], id);
          bindAbort(signal, id);
        } else {
          postToFrame('xc.audio.chunk', body, id, !(data instanceof ArrayBuffer) || transfer !== false ? [buf] : []);
        }
      },
      end() {
        if (ended) return;
        ended = true;
        if (started) postToFrame('xc.audio.end', {}, id);
      },
      abort() {
        if (ended && !started) return;
        ended = true;
        if (started) postToFrame('xc.audio.end', { abort: true }, id);
      },
      get done() { return done; },
    };
    return handle;
  };

  // ── iframe 创建 ──
  function buildUrl(): string {
    const u = new URL(srcUrl.href);
    u.searchParams.set('host', window.location.origin); // iframe 端用它做握手白名单
    if (transparent) u.searchParams.set('transparent', '1');
    if (uiParts.length) u.searchParams.set('ui', uiParts.join(','));
    if (options.lang) u.searchParams.set('lang', options.lang);
    if (options.heavy) u.searchParams.set('heavy', options.heavy);
    if (options.controls === false) u.searchParams.set('controls', '0');
    if (initialScene && isXcId(initialScene)) u.searchParams.set('scene', initialScene);
    if (initialOutfit) u.searchParams.set('outfit', initialOutfit);
    return u.href;
  }

  function activate(): void {
    if (destroyed || iframe) return;
    cancelIdle();
    io?.disconnect(); io = null;
    const f = document.createElement('iframe');
    f.title = 'Project XiaoChun';
    f.loading = 'lazy';
    f.allow = options.crossOriginIsolated === true
      ? 'microphone; autoplay; cross-origin-isolated' // 宿主已 COOP/COEP 隔离时, 额外委派跨源隔离 → iframe 内 SharedArrayBuffer / 多线程 wasm
      : 'microphone; autoplay'; // 宿主必须委派: 麦克风 (STT) + 自动播放 (TTS 音频; 缺它则点击宿主页后 iframe 内 AudioContext 仍被拦)
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    if (options.sandbox !== false) {
      f.setAttribute('sandbox', options.sandbox ?? 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    }
    f.setAttribute('allowtransparency', 'true');
    f.setAttribute('scrolling', 'no');
    const s = f.style;
    s.position = 'absolute'; s.inset = '0'; s.width = '100%'; s.height = '100%';
    s.border = '0'; s.background = 'transparent'; s.colorScheme = 'normal';
    s.borderRadius = `var(--xc-radius, ${radiusValue()})`; // 圆角裁剪 iframe 内容 (宿主 CSS 只能改这层外壳, 改不到 iframe 内部)
    f.setAttribute('part', 'iframe');
    s.opacity = '0'; s.transition = 'opacity .25s ease';
    s.pointerEvents = passthrough ? 'none' : 'auto';
    f.src = buildUrl();
    iframe = f;
    wrapper.appendChild(f);
    if (placeholderEl) placeholderEl.style.cursor = 'default';
    handshakeTimer = setTimeout(() => {
      if (!port) emit('error', { code: 'timeout', message: `no xc.ready from ${frameOrigin} within ${handshakeTimeout}ms` });
    }, handshakeTimeout);
    setupAutoPause();
    if (passthrough) enablePassthrough();
  }

  // ── 来自 iframe 的握手 (window message) ──
  const onWindowMessage = (ev: MessageEvent) => {
    if (destroyed || !iframe || ev.source !== iframe.contentWindow) return; // 只认我们这个 iframe
    if (!trusted.has(ev.origin)) {
      emit('error', { code: 'origin_denied', message: `ignored message from untrusted origin ${ev.origin}` });
      return;
    }
    const data = ev.data;
    if (!isXcEnvelope(data) || data.type !== 'xc.ready' || port) return; // 握手只做一次
    const ch = new MessageChannel();
    port = ch.port1;
    port.onmessage = onPortMessage;
    caps = (data.payload as XcReadyPayload | undefined)?.capabilities ?? null;
    // targetOrigin = 已校验的 ev.origin, 绝不用 '*'。allowCustomModel 走 xc.init 的 config (不进 URL), 旧 iframe 会忽略未知字段
    // 手势开关随 xc.init 一起交给 iframe (iframe 默认不识别任何手势); 旧版 /embed 没有 capabilities.gestures → 不发
    const gWant = wantGestures();
    sentGestures = gWant;
    const initConfig: XcConfig = {
      ...(options.allowCustomModel ? { allowCustomModel: true } : {}),
      ...(gWant.move || gWant.resize ? { gestures: gWant } : {}),
    };
    iframe.contentWindow!.postMessage(
      xcMessage('xc.init', { hostOrigin: window.location.origin, ...(Object.keys(initConfig).length ? { config: initConfig } : {}) }),
      ev.origin,
      [ch.port2],
    );
    warnGestureUnsupported();
    if (handshakeTimer) { clearTimeout(handshakeTimer); handshakeTimer = null; }
    emit('handshake', data.payload as XcReadyPayload);
    resolveHandshake();
    for (const m of queue.splice(0)) {
      if (m.requires && !caps?.[m.requires]) unsupportedByFrame(m.type, m.id);
      else port.postMessage(xcMessage(m.type, m.payload, m.id), m.transfer ?? []);
    }
    syncPause();
  };
  window.addEventListener('message', onWindowMessage);

  /** 命令应答: 用同一个信封 id resolve 对应的 Promise (xc.outfit-changed / xc.scene-changed)。 */
  function ack(id: string | undefined, value?: unknown) {
    const p = id ? pending.get(id) : undefined;
    if (p && id) { pending.delete(id); p.resolve(value); }
  }

  // ── 来自 iframe 的端口消息 ──
  function onPortMessage(ev: MessageEvent) {
    const data = ev.data as XcFrameMessage;
    if (!isXcEnvelope(data)) return;
    switch (data.type) {
      case 'xc.load.progress': emit('progress', data.payload); break;
      case 'xc.loaded':
        if (!loaded) {
          loaded = true;
          // 自动预取: 只在 heavy:'eager' 且 iframe 声明支持时; 失败 / 部分失败都不打扰宿主 (显式 prefetch() 才返回结果)
          if (options.prefetch && options.heavy === 'eager' && caps?.prefetch) {
            const ids = Array.isArray(options.prefetch) ? options.prefetch : undefined;
            void api.prefetch(ids).catch(() => {});
          }
          if (iframe) iframe.style.opacity = '1';
          if (placeholderEl) {
            const el = placeholderEl;
            el.style.opacity = '0'; el.style.pointerEvents = 'none';
            setTimeout(() => el.remove(), 300);
            placeholderEl = null;
          }
          resolveReady();
        }
        emit('ready', data.payload);
        break;
      case 'xc.outfit-changed': {
        const pl = data.payload;
        if (!pl.noop) {
          currentOutfit = pl.id;
          emit('outfit-changed', pl);
          if (!pl.initial && pl.id) writePrefs({ outfit: pl.id }); // 只记用户/宿主主动换的, 不记默认服装
        }
        ack(data.id);
        break;
      }
      case 'xc.scene-changed': {
        const pl = data.payload;
        currentScene = pl.id;
        if (pl.transparent !== transparent) applyTransparency(pl.transparent); // iframe 是事实源: 同步外壳背景 / 穿透 / pointer-events
        if (!pl.noop) {
          emit('scene-changed', pl);
          if (!pl.initial) writePrefs({ scene: pl.id });
        }
        ack(data.id);
        break;
      }
      case 'xc.prefetched': ack(data.id, data.payload); break;
      case 'xc.state': emit('state', data.payload); break;
      case 'xc.stt': emit('stt', data.payload); break;
      case 'xc.utterance': {
        emit('utterance', data.payload);
        const p = data.id ? pending.get(data.id) : undefined;
        if (p && data.payload.phase === 'end') { pending.delete(data.id!); p.resolve(); }
        break;
      }
      case 'xc.hit-region': {
        const { hit } = data.payload;
        emit('hit-region', data.payload);
        if (passthrough && iframe && hit !== lastHit) {
          lastHit = hit;
          iframe.style.pointerEvents = hit ? 'auto' : 'none';
        }
        break;
      }
      case 'xc.gesture-move': onGesture('move', data.payload); break;
      case 'xc.gesture-resize': onGesture('resize', data.payload); break;
      case 'xc.error': {
        const { code, message, command } = data.payload;
        emit('error', { code, message, command });
        // 初始 ?outfit= / ?scene= 被 iframe 判为非法: 已保存的偏好是坏的, 清掉免得每次都报
        if (code === 'unknown_id' && (command === 'outfit' || command === 'scene')) writePrefs({ [command]: null });
        const p = data.id ? pending.get(data.id) : undefined;
        if (p && data.id) { pending.delete(data.id); p.reject(new Error(`[${code}] ${message}`)); }
        break;
      }
      default: break;
    }
  }

  // ── 宿主 pointer → iframe (透明穿透模式) ──
  // iframe 处于 pointer-events:none 时, 宿主页的 pointermove 才是唯一线索:
  //  - 指针不在 iframe 范围内时只做一次廉价的矩形比较 (矩形缓存, 不在每帧 getBoundingClientRect 以免强制回流);
  //  - 指针在范围内时每帧最多发一次 xc.pointer, 且移动不足 2px 或距上次不足 32ms 则跳过, 避免 iframe 里每帧一次射线检测。
  const POINTER_MIN_INTERVAL_MS = 32;
  const POINTER_MIN_MOVE_PX = 2;
  let pointerRaf = 0;
  let lastPtr: { x: number; y: number } | null = null;
  let lastPosted: { x: number; y: number; t: number } | null = null;
  let rectCache: DOMRect | null = null;
  let rectRo: ResizeObserver | null = null;
  let rectAt = 0;
  const invalidateRect = () => { rectCache = null; };
  const getRect = (): DOMRect | null => {
    if (!iframe) return null;
    const now = performance.now();
    // 兜底 TTL: 内联布局被页面其它内容推动 (不触发 resize/scroll) 时, 最多 400ms 后自愈
    if (!rectCache || now - rectAt > 400) { rectCache = iframe.getBoundingClientRect(); rectAt = now; }
    return rectCache;
  };
  const onHostPointer = (e: PointerEvent) => {
    if (!iframe || !port || iframe.style.pointerEvents === 'auto') return; // iframe 自己拿到事件时由它上报
    lastPtr = { x: e.clientX, y: e.clientY };
    if (pointerRaf) return;
    pointerRaf = requestAnimationFrame(() => {
      pointerRaf = 0;
      if (!iframe || !port || !lastPtr) return;
      const r = getRect();
      if (!r) return;
      const x = lastPtr.x - r.left, y = lastPtr.y - r.top;
      if (x < 0 || y < 0 || x > r.width || y > r.height) {
        lastPosted = null;
        if (lastHit) { lastHit = false; iframe.style.pointerEvents = 'none'; }
        return;
      }
      const now = performance.now();
      if (lastPosted && now - lastPosted.t < POINTER_MIN_INTERVAL_MS) return;
      if (lastPosted && Math.abs(x - lastPosted.x) < POINTER_MIN_MOVE_PX && Math.abs(y - lastPosted.y) < POINTER_MIN_MOVE_PX) return;
      lastPosted = { x, y, t: now };
      port.postMessage(xcMessage('xc.pointer', { x, y }));
    });
  };
  // 穿透监听可启停 (运行中切 scene 时需要): enable / disable 都幂等。
  let passthroughActive = false;
  function enablePassthrough() {
    if (passthroughActive || !iframe) return;
    passthroughActive = true;
    window.addEventListener('pointermove', onHostPointer, { passive: true });
    // 触屏没有 hover: 点一下 (pointerdown) 也探测一次命中, 命中后 iframe 转 auto, 下一次点击即可落到角色 / 内置按钮上
    window.addEventListener('pointerdown', onHostPointer, { passive: true });
    window.addEventListener('scroll', invalidateRect, { passive: true, capture: true });
    window.addEventListener('resize', invalidateRect, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      rectRo = new ResizeObserver(invalidateRect);
      rectRo.observe(iframe);
    }
  }
  function disablePassthrough() {
    if (!passthroughActive) return;
    passthroughActive = false;
    window.removeEventListener('pointermove', onHostPointer);
    window.removeEventListener('pointerdown', onHostPointer);
    window.removeEventListener('scroll', invalidateRect, true);
    window.removeEventListener('resize', invalidateRect);
    rectRo?.disconnect(); rectRo = null;
    if (pointerRaf) { cancelAnimationFrame(pointerRaf); pointerRaf = 0; }
    lastPtr = null;
  }
  /**
   * 运行中切换透明 ↔ 非透明 (xc.scene-changed 驱动): 同步外壳背景、开关穿透监听、重置命中状态。
   *  - 切到非透明: 强制 iframe pointer-events:auto (整块画布都是角色背景, 不该穿透), 关掉穿透监听;
   *  - 切到透明: passthrough 选项显式给了就按它, 否则打开; iframe 先 none, 等 xc.pointer / xc.hit-region 再切 auto;
   *  - 两种情况都清掉 lastHit / lastPosted / 矩形缓存, 否则 iframe 侧已重置的去重状态会和这里对不上, 导致指针不动时第一次命中被吞。
   */
  function applyTransparency(next: boolean) {
    transparent = next;
    applyWrapperBg();
    applyRadius();
    passthrough = next ? (options.passthrough ?? true) : false;
    lastHit = false; lastPosted = null; rectCache = null;
    if (passthrough) enablePassthrough(); else disablePassthrough();
    if (iframe) iframe.style.pointerEvents = passthrough ? 'none' : 'auto';
  }

  // ── 视口外自动暂停 ──
  let pauseIo: IntersectionObserver | null = null;
  function setupAutoPause() {
    if (options.autoPause === false || typeof IntersectionObserver === 'undefined') return;
    pauseIo = new IntersectionObserver((entries) => {
      const visible = entries[entries.length - 1]?.isIntersecting ?? true;
      autoPaused = !visible;
      syncPause();
    });
    pauseIo.observe(wrapper);
  }
  let sentPaused = false;
  function syncPause() {
    if (!port) return;
    const want = userPaused || autoPaused;
    if (want === sentPaused) return;
    sentPaused = want;
    port.postMessage(xcMessage(want ? 'xc.pause' : 'xc.resume'));
  }

  // ── lazy 调度 ──
  function cancelIdle() {
    if (idleHandle === null) return;
    const w = window as Window & { cancelIdleCallback?: (h: number) => void };
    if (w.cancelIdleCallback) w.cancelIdleCallback(idleHandle); else clearTimeout(idleHandle);
    idleHandle = null;
  }
  function scheduleLazy() {
    if (lazy === false) { activate(); return; }
    if (lazy === 'click') return;
    const go = () => {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      // 空闲回调 timeout 3s: 主线程一直忙也最迟 3s 后创建, 调大更不影响首屏, 调小更快出现
      idleHandle = w.requestIdleCallback ? w.requestIdleCallback(() => { idleHandle = null; activate(); }, { timeout: 3000 }) : (setTimeout(activate, 1200) as unknown as number);
    };
    if (typeof IntersectionObserver === 'undefined') { go(); return; }
    io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io?.disconnect(); io = null; go(); }
    }, { rootMargin: `${options.lazyMargin ?? 200}px` });
    io.observe(wrapper);
  }

  // ── 手势: 拖动 / 缩放 (iframe 里识别, 宿主这里执行 + 限幅) ──
  // 协议: xc.gesture-move / xc.gesture-resize (见 protocol.ts 的 XcGestureBase)。宿主不信任 iframe 发来的任何数:
  //   校验载荷 (parseGesturePayload) → 序号闸门 (GestureGate) → 以"手势开始时的盒子 + 累计位移"夹在视口 / 最小最大尺寸内 (gesture-box.ts)。
  //   宿主没开 draggable / resizable 时, 对应消息一律忽略; 同一时刻只允许一个手势。
  let draggableOn = options.draggable === true;
  let resizeLimits: ResizeLimits | null = normalizeResizable(options.resizable);
  const gates = { move: new GestureGate(), resize: new GestureGate() };
  let activeGesture: { kind: 'move' | 'resize'; start: Box; inlineBase: { left: number; top: number } | null; corner?: 'NW' | 'NE' | 'SW' | 'SE' } | null = null;
  /** 内联模式靠 CSS translate 位移 (不改布局流); 记下当前位移, 才能还原出"流内原点"。 */
  let inlineShift = { x: 0, y: 0 };
  let userMoved = false;
  let sentGestures: { move: boolean; resize: boolean } | null = null;
  let warnedGesture = false;
  const viewport = (): Viewport => ({
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
  });
  const readBox = (): Box => { const r = wrapper.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
  const wantGestures = () => ({ move: draggableOn && caps?.gestures?.move === true, resize: resizeLimits !== null && caps?.gestures?.resize === true });

  function applyBox(b: Box, inlineBase: { left: number; top: number } | null, withSize: boolean): void {
    if (withSize) { ws.width = `${b.width}px`; ws.height = `${b.height}px`; ws.maxWidth = 'none'; } // maxWidth:100% 会把用户拉大的宽度压回容器宽
    if (position === 'inline') {
      const base = inlineBase ?? { left: b.left - inlineShift.x, top: b.top - inlineShift.y };
      inlineShift = { x: b.left - base.left, y: b.top - base.top };
      ws.setProperty('translate', `${inlineShift.x}px ${inlineShift.y}px`);
    } else {
      ws.left = `${b.left}px`; ws.top = `${b.top}px`; ws.right = 'auto'; ws.bottom = 'auto';
    }
    userMoved = true;
    invalidateRect();
  }

  // 拖动期间不出现选中蓝框: 宿主页临时 user-select:none 并清掉已有选区 (iframe 内部另有处理)
  let selectionLock: { us: string; wus: string } | null = null;
  function lockSelection(on: boolean): void {
    const de = document.documentElement;
    if (on && !selectionLock) {
      selectionLock = { us: de.style.getPropertyValue('user-select'), wus: de.style.getPropertyValue('-webkit-user-select') };
      de.style.setProperty('user-select', 'none'); de.style.setProperty('-webkit-user-select', 'none');
      try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    } else if (!on && selectionLock) {
      de.style.setProperty('user-select', selectionLock.us); de.style.setProperty('-webkit-user-select', selectionLock.wus);
      selectionLock = null;
    }
  }
  function endActiveGesture(kind?: 'move' | 'resize'): void {
    if (!activeGesture || (kind && activeGesture.kind !== kind)) return;
    gates[activeGesture.kind].close();
    const b = readBox();
    emit(activeGesture.kind, { phase: 'end', ...b });
    activeGesture = null;
    lockSelection(false);
  }

  function onGesture(kind: 'move' | 'resize', raw: unknown): void {
    if (destroyed || !caps?.gestures) return;
    if (kind === 'move' ? !draggableOn : resizeLimits === null) return; // 宿主没开: 忽略
    const p = parseGesturePayload(kind, raw);
    if (!p) return;
    if (p.phase === 'start' ? activeGesture !== null : activeGesture?.kind !== kind) return; // 同一时刻只允许一个手势
    if (!gates[kind].accept(p)) return;
    if (p.phase === 'start') {
      const start = readBox();
      activeGesture = {
        kind, start, corner: p.corner,
        inlineBase: position === 'inline' ? { left: start.left - inlineShift.x, top: start.top - inlineShift.y } : null,
      };
      lockSelection(true);
      emit(kind, { phase: 'start', ...start });
      return;
    }
    const a = activeGesture!;
    const vp = viewport();
    const next = kind === 'move'
      ? moveBox(a.start, p.totalDx, p.totalDy, vp)
      : resizeBox(a.start, a.corner!, p.totalDx, p.totalDy, resizeLimits!, vp);
    applyBox(next, a.inlineBase, kind === 'resize');
    emit(kind, { phase: p.phase, ...next });
    if (p.phase === 'end') { activeGesture = null; lockSelection(false); }
  }

  /** 把 draggable / resizable 的当前值同步给 iframe (只在变化时发 xc.setConfig{gestures}); 握手时已随 xc.init 发过一次。 */
  function syncGestures(): void {
    if (destroyed) return;
    const want = wantGestures();
    if (!want.move) endActiveGesture('move');
    if (!want.resize) endActiveGesture('resize');
    if (!port || !caps) return;
    warnGestureUnsupported();
    if (sentGestures && sentGestures.move === want.move && sentGestures.resize === want.resize) return;
    sentGestures = want;
    if (caps.gestures) port.postMessage(xcMessage('xc.setConfig', { gestures: want }));
  }
  /** 旧版 /embed (握手里没有 capabilities.gestures) 却开了手势: 告知一次。 */
  function warnGestureUnsupported(): void {
    if (warnedGesture || !caps || caps.gestures) return;
    const needMove = draggableOn;
    if (!needMove && resizeLimits === null) return;
    warnedGesture = true;
    const what = [needMove ? 'draggable' : '', resizeLimits !== null ? 'resizable' : ''].filter(Boolean).join(' / ');
    emit('error', { code: 'unsupported', message: `${what} needs gesture support (capabilities.gestures), which this /embed deployment does not advertise (older version)`, command: 'gestures' });
  }

  // 窗口变小后把用户拖过 / 缩过的头像夹回视口 (没动过就不管, 交给页面自己的布局)
  const onWindowResize = () => {
    if (!userMoved || activeGesture || destroyed) return;
    const cur = readBox();
    const fit = fitBox(cur, viewport());
    if (fit.left === cur.left && fit.top === cur.top && fit.width === cur.width && fit.height === cur.height) return;
    applyBox(fit, position === 'inline' ? { left: cur.left - inlineShift.x, top: cur.top - inlineShift.y } : null, fit.width !== cur.width || fit.height !== cur.height);
  };
  window.addEventListener('resize', onWindowResize, { passive: true });

  scheduleLazy();

  const api: XiaochunInstance = {
    element: wrapper,
    get iframe() { return iframe; },
    ready,
    activate,
    say: (text, opts) => send('xc.say', { text, mode: opts?.mode }, true),
    speakAudio,
    speakAudioStream,
    motion: (m) => send('xc.motion', typeof m === 'string' ? (m.startsWith('http') || m.startsWith('/') ? { url: m } : { name: m }) : m),
    expression: (name) => send('xc.expression', { name }),
    lookAt: (x, y) => send('xc.lookAt', { x, y }),
    setOutfit: (id) => {
      if (!isXcId(id)) return Promise.reject(new Error('[bad_request] invalid outfit id'));
      return send('xc.setOutfit', { id }, true, undefined, undefined, 'outfits');
    },
    setScene: (id) => {
      if (!isXcId(id)) return Promise.reject(new Error('[bad_request] invalid scene id'));
      return send('xc.setScene', { id }, true, undefined, undefined, 'scenes');
    },
    prefetch: (ids) => {
      if (ids !== undefined && (!Array.isArray(ids) || ids.some((x) => !isXcId(x)))) {
        return Promise.reject(new Error('[bad_request] prefetch ids must be an array of outfit ids'));
      }
      return send('xc.prefetch', ids ? { ids } : {}, true, undefined, undefined, 'prefetch');
    },
    getOutfits: async () => { if (!iframe) activate(); await handshaked; return caps?.outfits ? caps.outfits.slice() : []; },
    getScenes: async () => { if (!iframe) activate(); await handshaked; return caps?.scenes ? caps.scenes.slice() : []; },
    get outfit() { return currentOutfit; },
    get scene() { return currentScene; },
    setModel: (m) => {
      const msg = typeof m === 'string' ? (/^(https?:)?\/|\.vrm/i.test(m) ? { url: m } : { outfit: m }) : m;
      if (msg.url !== undefined && msg.outfit === undefined && !options.allowCustomModel) {
        const message = 'custom model URLs are disabled; pass allowCustomModel: true to createXiaochun() (only for URLs you trust) or use setOutfit() with a built-in id';
        emit('error', { code: 'unsupported', message, command: 'xc.setModel' });
        return Promise.reject(new Error(`[unsupported] ${message}`));
      }
      return send('xc.setModel', msg);
    },
    setConfig: (cfg) => send('xc.setConfig', cfg),
    setSize(width, height) {
      if (destroyed) return;
      ws.width = css(width, '320px'); ws.height = css(height, '480px');
      invalidateRect();
    },
    getBox: () => readBox(),
    setBorderRadius(radius) {
      radiusOpt = radius;
      applyRadius();
    },
    setDraggable(on) {
      draggableOn = on === true;
      syncGestures();
    },
    setResizable(on) {
      resizeLimits = normalizeResizable(on);
      syncGestures();
    },
    startListening: () => send('xc.mic', { enabled: true }),
    stopListening: () => send('xc.mic', { enabled: false }),
    mic: (enabled) => send('xc.mic', { enabled }),
    pause() { userPaused = true; syncPause(); },
    resume() { userPaused = false; syncPause(); },
    destroy() {
      if (destroyed) return;
      try { port?.postMessage(xcMessage('xc.destroy')); } catch { /* ignore */ }
      destroyed = true;
      cancelIdle();
      io?.disconnect(); pauseIo?.disconnect();
      if (handshakeTimer) clearTimeout(handshakeTimer);
      if (pointerRaf) cancelAnimationFrame(pointerRaf);
      window.removeEventListener('message', onWindowMessage);
      window.removeEventListener('resize', onWindowResize);
      lockSelection(false);
      disablePassthrough();
      resolveHandshake(); // 还在等 getOutfits() / getScenes() 的调用方拿到 [] 而不是永远挂起
      try { port?.close(); } catch { /* ignore */ }
      port = null;
      for (const p of pending.values()) p.reject(new Error('[project-xiaochun] instance destroyed'));
      pending.clear();
      queue.length = 0;
      if (!loaded) rejectReady(new Error('[project-xiaochun] destroyed before ready'));
      wrapper.remove(); // 同时移除 iframe → 浏览器释放 WebGL 上下文
      iframe = null;
      emit('destroy', undefined);
      listeners.clear();
    },
    on(event, cb) {
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(cb as (p: any) => void);
      return () => { set!.delete(cb as (p: any) => void); };
    },
  };
  return api;
}
