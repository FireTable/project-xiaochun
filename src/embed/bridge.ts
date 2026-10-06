/**
 * embed/bridge.ts — /embed 侧 postMessage 协议实现 (iframe 内运行)。
 *
 * 协议常量/类型来自 packages/project-xiaochun/src/protocol.ts (单一事实源, 包名 @firetable/project-xiaochun)。
 * 安全模型:
 *   1. 仅 `window.parent` 发来的 `xc.init`, 且 event.origin ∈ 白名单 才接受; 其余一律忽略。
 *   2. `xc.ready` 的 targetOrigin 是宿主 origin (绝不用 '*'), 握手后全部走 MessageChannel 端口。
 *   3. 只接受一次 `xc.init` (防重放换端口)。
 *   4. 所有 URL 参数 (motion / setModel) 只允许 https:// 或同源, 且限定扩展名;
 *      xc.setModel 的任意 URL 默认关闭 (需宿主在 xc.init config 里 opt-in allowCustomModel)。
 *   5. outfit / scene id 一律先过 isXcId 正则再 hasOwnProperty 查表 (registry.ts), 原型键不可达;
 *      裸模 base 不在服装表里, 不对外开放。
 */
import { vrmEngine, type LoadingState } from '@/core/vrmEngine';
import { idbGet, idbPut } from '@/lib/idb-vrm-cache';
import { APP_CONFIG } from '@/config';
import { sceneManager } from '@/core/scene/sceneManager';
import { setHeavyPreloadOverride } from '@/lib/heavyPreload';
import { isLang } from '@/i18n';
import { defaultPrefetchIds, listOutfits, listScenes, ownEntry, safeLocalStorage, writeLangPref, writeOutfitPref } from './registry';
import { EMBED_LANG_KEY, SCENE_THEME_KEY, WEARING_OUTFIT_KEY } from '@/lib/constants';
import { BusyError, SwapQueue } from './swapQueue';
import { PrefetchScheduler, ensureAssets, type AssetIo } from './prefetch';
import type { SttClient } from '@/stt/sttClient';
import { HOST_AUDIO, AsyncChunkQueue } from '@/director/hostAudio';
import { checkSampleRate, rawPcmToMono } from '@/core/protocol/audio';
import { runProtocolAction } from '@/core/protocol/handler';
import { CORNER_HIT_SIZE, HitGate, cornerAt } from '@/core/gesture';
import { EmbedGestures } from './gestures';
import { ProtocolError as CmdError, type ProtocolMessage } from '@/core/protocol/types';
import {
  XC_IMPLEMENTED_COMMANDS,
  XC_UNSUPPORTED_COMMANDS,
  XC_PROTOCOL_VERSION,
  XC_UI_PARTS,
  XC_UI_AUTOHIDE_DEFAULT,
  XC_LANGS,
  XC_CAMERA_RANGES,
  normalizeXcCamera,
  parseXcUiAutoHide,
  isXcEnvelope,
  isXcId,
  parseXcUiList,
  xcMessage,
  type XcAudioChunkPayload,
  type XcAudioPayload,
  type XcConfig,
  type XcTransportPayload,
  type XcErrorCode,
  type XcEnvelope,
  type XcFrameMessageType,
  type XcHeavyMode,
  type XcLang,
  type XcUiAutoHide,
  type XcPhase,
  type XcPrefetchedPayload,
} from '@firetable/project-xiaochun/protocol';
import type { EmbedParams } from './params';

/** 等模型就绪的最长时间 (ms)。调大: 慢网络下命令更不容易 not_ready; 调小: 失败反馈更快。 */
const READY_TIMEOUT_MS = 60_000;
/** xc.ready 握手重发次数 / 间隔 (ms)。宿主监听器晚于 iframe 就绪时靠它兜底; 调大只增加无用广播。 */
const READY_RETRY_TIMES = 10;
const READY_RETRY_INTERVAL_MS = 1000;
/** 动作淡入淡出范围 (秒): 下限由管线决定 (0.26), 上限调大会让切换更"飘"。 */
const FADE_RANGE: [number, number] = [0.26, 3];
/** 动作倍速范围: <0.25 几乎静止, >3 肢体抖动。 */
const TIMESCALE_RANGE: [number, number] = [0.25, 3];

/** 一次换装的目标; key 相同 = 同目标 (队列据此合并)。id=null 表示自定义 URL。 */
interface SwapJob { key: string; id: string | null; url: string; name: string }
interface SwapResult { changed: boolean; id: string | null; name: string; previous: string | null }

const EXPRESSIONS = new Set(['neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised']);
const BUILTIN_MOTIONS: Record<string, string> = { thinking: '/vrm/motion/thinking.vrma' };

// ── 极简 UI 状态仓 (给 React useSyncExternalStore) ──
/** 内置界面部件开关 (对应 ?ui= 的部件名): ui = chat 聊天栏; autoHide = uiAutoHide 显示策略 (见 protocol XcUiAutoHide)。 */
export type UiState = { ui: boolean; bubble: boolean; outfit: boolean; scene: boolean; lang: boolean; github: boolean; autoHide: XcUiAutoHide };
let uiState: UiState = { ui: false, bubble: false, outfit: false, scene: false, lang: false, github: false, autoHide: XC_UI_AUTOHIDE_DEFAULT };
/** 部件名数组 → UiState 里的部件开关 (不含 autoHide, 它单独设置)。 */
export function uiStateFromParts(parts: readonly string[]): Omit<UiState, 'autoHide'> {
  return {
    ui: parts.includes('chat'), bubble: parts.includes('bubble'), outfit: parts.includes('outfit'),
    scene: parts.includes('scene'), lang: parts.includes('lang'), github: parts.includes('github'),
  };
}
const uiListeners = new Set<() => void>();
export function getEmbedUiState(): UiState { return uiState; }
export function subscribeEmbedUi(cb: () => void): () => void {
  uiListeners.add(cb);
  return () => { uiListeners.delete(cb); };
}
function setUiState(next: Partial<UiState>): void {
  uiState = { ...uiState, ...next };
  uiListeners.forEach((l) => l());
}

// ── 内置换装 / 换场景按钮 (?ui=outfit,scene) 的状态仓: 与宿主通过 xc.setOutfit / xc.setScene 发起的变化共用同一份真相 ──
export interface PickerState {
  /** 当前已生效的内置服装 id (自定义 URL / 还没加载完 = null)。 */
  outfit: string | null;
  /** 正在加载的服装 id (初始加载 / 换装, 不论是按钮还是宿主发起的); 没有 = null。 */
  loading: string | null;
  /** 轻提示: n 每变一次就弹一次 (busy = 有换装在进行, 已记下最新选择 / 被更新的请求顶掉; failed = 加载失败)。 */
  notice: { kind: 'busy' | 'failed'; n: number } | null;
}
let pickerState: PickerState = { outfit: null, loading: null, notice: null };
const pickerListeners = new Set<() => void>();
export function getEmbedPickerState(): PickerState { return pickerState; }
export function subscribeEmbedPicker(cb: () => void): () => void {
  pickerListeners.add(cb);
  return () => { pickerListeners.delete(cb); };
}
function setPickerState(next: Partial<PickerState>): void {
  pickerState = { ...pickerState, ...next };
  pickerListeners.forEach((l) => l());
}
let noticeSeq = 0;
function pickerNotice(kind: 'busy' | 'failed'): void {
  setPickerState({ notice: { kind, n: ++noticeSeq } });
}

// ── 按钮区参与穿透命中 ──
// 透明场景下 iframe 的 pointer-events 由宿主按 xc.hit-region 切换。按钮 (带 data-xc-ui) 与打开的菜单 (role=menu, Radix 渲染在 body 下)
// 也算"命中", 否则宿主会把指针穿透过去, 按钮点不到。菜单打开期间整个 iframe 视为命中 (点菜单外面要能关菜单)。
let menuOpenCount = 0;
let onMenuOpenChange: (() => void) | null = null;
/** EmbedPicker 的菜单开合时调用 (成对)。 */
export function notifyEmbedMenuOpen(open: boolean): void {
  menuOpenCount = Math.max(0, menuOpenCount + (open ? 1 : -1));
  onMenuOpenChange?.();
}
function isOverEmbedUi(x: number, y: number): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.elementFromPoint(x, y);
  return Boolean(el && el.closest('[data-xc-ui],[role="menu"]'));
}

const clamp = (v: unknown, [lo, hi]: [number, number], fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
};

/** 只放行 https:// 或同源地址, 且扩展名在白名单内; 否则返回 null。 */
function safeAssetUrl(raw: unknown, exts: string[]): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  let u: URL;
  try { u = new URL(raw, window.location.origin); } catch { return null; }
  const sameOrigin = u.origin === window.location.origin;
  if (!sameOrigin && u.protocol !== 'https:') return null;
  if (!exts.some((e) => u.pathname.toLowerCase().endsWith(e))) return null;
  return u.href;
}

function waitModelReady(): Promise<void> {
  if (vrmEngine.isReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('model not ready')); }, READY_TIMEOUT_MS);
    const off = vrmEngine.onReadyChange((ready) => {
      if (!ready) return;
      clearTimeout(timer);
      queueMicrotask(() => off());
      resolve();
    });
  });
}

export interface EmbedBridgeOptions {
  params: EmbedParams;
  /** /embed 页面版本号 (随主仓库 package.json)。 */
  version: string;
  /** 切换界面语言 (由 React 层持有 i18n)。 */
  onLang: (lang: XcLang) => void;
  /** 当前界面语言 (握手后上报 xc.lang-changed{initial} 用)。 */
  getLang: () => XcLang;
  /** 正在加载的初始服装 id (EmbedApp 解析 ?outfit= 的结果); 用于"初始加载未完成时收到同目标 xc.setOutfit"不重复加载。 */
  initialOutfit?: string | null;
}

export interface EmbedBridge {
  /** 内置按钮点选服装: 和 xc.setOutfit 同一个白名单 / 串行队列 / busy 规则, 并向宿主发 xc.outfit-changed。永不 reject (失败走轻提示)。 */
  pickOutfit: (id: string) => Promise<void>;
  /** 内置按钮点选场景: 和 xc.setScene 同一路径, 并向宿主发 xc.scene-changed。 */
  pickScene: (id: string) => Promise<void>;
  /** 内置语言按钮选语言: 切换 + 存进 iframe 自己的 localStorage + 向宿主发 xc.lang-changed。 */
  pickLang: (lang: XcLang) => void;
  dispose: () => void;
  /** 供 React 层上报模型加载进度 / 完成。 */
  reportProgress: (state: LoadingState) => void;
  /** model = 展示名; outfitId = 内置服装 id (自定义 URL 传 null)。 */
  reportLoaded: (model: string, outfitId?: string | null) => void;
}

export function startEmbedBridge(opts: EmbedBridgeOptions): EmbedBridge {
  const { params } = opts;
  // 直接打开 /embed (没有宿主): 按钮仍可用, 直接驱动引擎 (没有消息可发)
  const noop: EmbedBridge = {
    async pickOutfit(id) {
      const e = ownEntry(APP_CONFIG.model.addons as Record<string, { source: string; name: string }>, id);
      if (!e) return;
      setPickerState({ loading: id });
      try { await vrmEngine.swapOutfit(e.source, e.name); writeOutfitPref(safeLocalStorage(), WEARING_OUTFIT_KEY, id); setPickerState({ outfit: id }); } catch { pickerNotice('failed'); } finally { setPickerState({ loading: null }); }
    },
    async pickScene(id) { if (ownEntry(APP_CONFIG.scenes.items, id)) await sceneManager.setScene(id, true); },
    pickLang(lang) { opts.onLang(lang); writeLangPref(safeLocalStorage(), EMBED_LANG_KEY, lang); },
    dispose() {}, reportProgress() {}, reportLoaded(_m, id = null) { setPickerState({ outfit: id, loading: null }); },
  };
  if (typeof window === 'undefined' || window.parent === window) return noop; // 直接打开 /embed: 无宿主
  const allowed = new Set(params.allowedHostOrigins);

  let port: MessagePort | null = null;
  let disposed = false;
  let heavy: XcHeavyMode = params.heavy;
  let paused = false;
  let loadedModel: string | null = null;
  let lastProgress = 0;
  /** 首次加载阶段上次已发的整数百分比 (引擎会对同一进度回调两次, 这里去重)。 */
  let lastModelSent = -1;
  let speakingToken = 0;
  let speakingCount = 0;
  let thinking = false;
  let sttState: 'idle' | 'loading' | 'listening' | 'recognizing' | 'error' = 'idle';
  let stt: SttClient | null = null;
  let sttOff: (() => void) | null = null;
  let lastSttPercent = -1;
  let lastPhase: XcPhase | null = null;
  /** xc.init config.allowCustomModel: 默认 false。 */
  let allowCustomModel = false;
  /** 当前已生效的内置服装 id (自定义 URL / 未加载完 = null)。 */
  let currentOutfit: string | null = null;
  /** 正在换的目标 id, 用于 xc.load.progress{phase:'outfit', id}。 */
  let swapTarget: string | null = null;
  let lastProgressKey = '';
  const addons = APP_CONFIG.model.addons as Record<string, { source: string; name: string }>;
  /** ?outfit= / ?scene= 非法时: 回退默认, 握手后告知宿主一次 (xc.error 无信封 id)。 */
  const startupWarnings: Array<{ code: XcErrorCode; message: string; command: string }> = [];
  const shown = (v: string) => JSON.stringify(v.slice(0, 40));
  if (params.outfit !== null && !ownEntry(addons, params.outfit)) {
    startupWarnings.push({ code: 'unknown_id', message: `?outfit=${shown(params.outfit)} is not a built-in outfit; using the default`, command: 'outfit' });
  }
  if (params.scene !== null && !ownEntry(APP_CONFIG.scenes.items, params.scene)) {
    startupWarnings.push({ code: 'unknown_id', message: `?scene=${shown(params.scene)} is not a known scene; ignored`, command: 'scene' });
  }
  setPickerState({ outfit: null, loading: opts.initialOutfit ?? null }); // 初始加载中: 按钮显示 spinner
  let readyTimer: ReturnType<typeof setInterval> | null = null;
  /** 流式音频会话 (xc.audio.chunk 的 id → 队列)。 */
  const audioStreams = new Map<string, { q: AsyncChunkQueue; sampleRate: number; format: 'pcm16' | 'float32'; channels: 1 | 2; samples: number }>();
  /** 已结束/被抢占的流 id: 之后到达的 chunk 只报一次错, 不会"复活"一次说话。 */
  const endedStreams = new Set<string>();
  let currentAudioId: string | null = null;

  const send = (type: XcFrameMessageType, payload?: unknown, id?: string) => {
    port?.postMessage(xcMessage(type, payload, id));
  };
  // ── iframe 手势 (拖动 / 角落缩放): 识别复用 core/gesture, 这里只是把增量发给宿主 SDK 执行; 宿主不开 (默认) 就什么都不监听 ──
  const gestures = new EmbedGestures({
    sendMove: (p) => send('xc.gesture-move', p),
    sendResize: (p) => send('xc.gesture-resize', p),
    isOverUi: isOverEmbedUi,
    interaction: vrmEngine.interaction,
  });
  const sendError = (code: XcErrorCode, message: string, command?: string, id?: string) =>
    send('xc.error', { code, message, command }, id);

  const phase = (): XcPhase => {
    if (paused) return 'paused';
    if (sttState === 'listening' || sttState === 'recognizing') return 'listening';
    if (speakingCount > 0) return thinking ? 'thinking' : 'speaking';
    if (!vrmEngine.isReady()) return 'loading';
    return 'idle';
  };
  const publishState = (force = false) => {
    const p = phase();
    if (!force && p === lastPhase) return;
    lastPhase = p;
    send('xc.state', { phase: p, paused, heavy });
  };

  // ── 握手 ──
  const hostOrigin = params.allowedHostOrigins[0];
  const postReady = () => {
    if (!hostOrigin) return;
    window.parent.postMessage(
      xcMessage('xc.ready', {
        version: opts.version,
        protocol: XC_PROTOCOL_VERSION,
        capabilities: {
          commands: [...XC_IMPLEMENTED_COMMANDS],
          unsupported: [...XC_UNSUPPORTED_COMMANDS],
          stt: true,
          transparent: true,
          audio: {
            formats: ['encoded', 'pcm16', 'float32'],
            streaming: true,
            maxSeconds: HOST_AUDIO.maxSec,
            playbackRate: { min: HOST_AUDIO.minPlaybackRate, max: HOST_AUDIO.maxPlaybackRate },
            volume: { min: HOST_AUDIO.minVolume, max: HOST_AUDIO.maxVolume },
          },
          crossOriginIsolated: typeof self !== 'undefined' && self.crossOriginIsolated === true,
          outfits: listOutfits(addons),
          scenes: listScenes(APP_CONFIG.scenes.items),
          prefetch: true,
          gestures: { move: true, resize: true, cornerSize: CORNER_HIT_SIZE }, // 宿主在 xc.init / xc.setConfig 里开了才识别 (默认关)
          ui: { parts: [...XC_UI_PARTS], autoHide: true, langs: [...XC_LANGS] }, // 内置界面: 部件 / uiAutoHide (点击出现) / 可选语言
          camera: { fov: [...XC_CAMERA_RANGES.fov], distance: [...XC_CAMERA_RANGES.distance], height: [...XC_CAMERA_RANGES.height], intro: true }, // 相机选项 (camera): 各项范围, 越界夹到边界
        },
      }),
      hostOrigin, // 严格 targetOrigin, 永不 '*'
    );
  };

  const onWindowMessage = (ev: MessageEvent) => {
    if (disposed || port) return; // 只接受一次 init
    if (ev.source !== window.parent) return;
    if (!allowed.has(ev.origin)) return;
    const data = ev.data;
    if (!isXcEnvelope(data) || data.type !== 'xc.init') return;
    const p = ev.ports[0];
    if (!p) return;
    port = p;
    port.onmessage = (e) => { void handleCommand(e.data); };
    if (readyTimer) { clearInterval(readyTimer); readyTimer = null; }
    const cfg = (data.payload as { config?: XcConfig } | undefined)?.config;
    if (cfg) void applyConfig(cfg, 'xc.init');
    // 补发握手前已发生的事件
    if (loadedModel === null && lastProgress > 0) send('xc.load.progress', { phase: 'model', progress: lastProgress });
    if (loadedModel !== null) {
      send('xc.loaded', { model: loadedModel });
      send('xc.outfit-changed', { id: currentOutfit, name: loadedModel, initial: true });
    }
    send('xc.scene-changed', sceneSnapshot(true));
    send('xc.lang-changed', { lang: opts.getLang(), initial: true });
    for (const w of startupWarnings.splice(0)) sendError(w.code, w.message, w.command);
    publishState(true);
  };
  window.addEventListener('message', onWindowMessage);

  postReady();
  let tries = 0;
  readyTimer = setInterval(() => {
    if (port || disposed || ++tries > READY_RETRY_TIMES) {
      if (readyTimer) clearInterval(readyTimer);
      readyTimer = null;
      return;
    }
    postReady();
  }, READY_RETRY_INTERVAL_MS);

  // ── 命令 ──
  async function applyConfig(cfg: XcConfig, command: string): Promise<void> {
    if (cfg.lang !== undefined) {
      if (isLang(cfg.lang)) setLang(cfg.lang, false); // 宿主显式设置: 生效但不写 iframe 的偏好存储 (偏好只记用户自己点的)
      else throw new CmdError('bad_request', `invalid lang: ${String(cfg.lang)}`);
    }
    if (cfg.uiAutoHide !== undefined) {
      const mode = parseXcUiAutoHide(cfg.uiAutoHide);
      if (mode === undefined) throw new CmdError('bad_request', `invalid uiAutoHide: ${String(cfg.uiAutoHide)} (expected true | false | 'transparent')`);
      setUiState({ autoHide: mode });
    }
    if (Array.isArray(cfg.ui)) {
      const r = parseXcUiList(cfg.ui);
      if (r.unknown.length) throw new CmdError('bad_request', `unknown ui part(s): ${r.unknown.join(', ')}`);
      setUiState(uiStateFromParts(r.parts));
    } else if (typeof cfg.ui === 'boolean') {
      setUiState({ ui: cfg.ui, bubble: cfg.ui }); // 弃用的旧写法: 只管 chat + bubble
    }
    if (typeof cfg.allowCustomModel === 'boolean') allowCustomModel = cfg.allowCustomModel;
    if (cfg.camera !== undefined) {
      const r = normalizeXcCamera(cfg.camera);
      if (!r.ok) throw new CmdError('bad_request', `invalid camera: ${r.error}`);
      if (r.clamped.length) console.warn(`[xiaochun] camera.${r.clamped.join(', camera.')} out of range, clamped`);
      vrmEngine.setCameraConfig(r.camera); // 立刻重新取景并取消进行中的推镜头 (引擎里统一处理)
    }
    if (cfg.gestures !== undefined) {
      const g = cfg.gestures as unknown;
      const isBoolOrUndef = (v: unknown) => v === undefined || typeof v === 'boolean';
      if (g === null || typeof g !== 'object' || Array.isArray(g) || !isBoolOrUndef((g as { move?: unknown }).move) || !isBoolOrUndef((g as { resize?: unknown }).resize)) {
        throw new CmdError('bad_request', 'invalid gestures: expected { move?: boolean, resize?: boolean }');
      }
      gestures.setEnabled({ move: (g as { move?: boolean }).move, resize: (g as { resize?: boolean }).resize });
      hitGate.reset(); // 角落热区算不算"命中"变了: 作废去重状态, 指针不动时也按新规则重判
    }
    if (typeof cfg.transparent === 'boolean') {
      // true → transparent; false → 已经是非透明场景就保持 (别把宿主选的 dark 重置回系统色), 否则按系统亮暗
      const cur = sceneManager.getCurrentScene();
      if (cfg.transparent !== Boolean(cur.isTransparent)) {
        const id = cfg.transparent ? 'transparent' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        await applyScene(id);
      }
    }
    if (cfg.heavy !== undefined) {
      if (cfg.heavy !== 'lazy' && cfg.heavy !== 'eager') throw new CmdError('bad_request', `invalid heavy: ${String(cfg.heavy)}`);
      heavy = cfg.heavy;
      setHeavyPreloadOverride(heavy === 'eager');
      if (heavy === 'eager') vrmEngine.preloadHeavyResources(true);
    }
    void command;
    publishState(true);
  }

  /** 切界面语言: 变了才切并向宿主发 xc.lang-changed; persist=true (用户在按钮里选) 才写 iframe 自己的 localStorage。 */
  function setLang(lang: XcLang, persist: boolean): void {
    const previous = opts.getLang();
    if (persist) writeLangPref(safeLocalStorage(), EMBED_LANG_KEY, lang);
    if (lang === previous) return;
    opts.onLang(lang);
    send('xc.lang-changed', { lang, previous });
  }

  // ── 场景 / 服装 ──
  function sceneSnapshot(initial = false) {
    const cur = sceneManager.getCurrentScene();
    return { id: cur.id, transparent: Boolean(cur.isTransparent), ...(initial ? { initial: true } : {}) };
  }

  /** 切场景 (persist=true: 写 iframe 自己的 localStorage; 默认 false = 内部切换不写)。replyId = 触发它的命令信封 id (xc.setScene), 内部触发 (setConfig) 不带。 */
  async function applyScene(sceneId: string, replyId?: string, persist = false): Promise<void> {
    const previous = sceneManager.getCurrentSceneId();
    if (previous === sceneId) {
      if (persist) { try { safeLocalStorage()?.setItem(SCENE_THEME_KEY, sceneId); } catch { /* 存储被拦截: 静默 */ } } // 重选当前场景 (例如系统本来就是深色) 也算明确选择, 存下来
      if (replyId) send('xc.scene-changed', { ...sceneSnapshot(), noop: true }, replyId);
      return;
    }
    await sceneManager.setScene(sceneId, persist); // persist: 用户 / 宿主明确选的场景写回 iframe 自己的 localStorage (SCENE_THEME_KEY); setConfig 的内部切换不写
    hitGate.reset(); // 透明 ↔ 非透明切换后, 宿主侧的 pointer-events 已被 SDK 重置, 这里的命中去重状态也要作废, 否则指针不动时第一次命中会被当成"没变化"吞掉
    send('xc.scene-changed', { ...sceneSnapshot(), previous }, replyId);
  }

  /** 换装: 串行 + last-wins (见 swapQueue.ts / docs/EMBED.md)。说话不会被打断, 换装在后台完成后才生效。 */
  const swapQueue = new SwapQueue<SwapJob, SwapResult>(async (job) => {
    await waitModelReady().catch(() => { throw new CmdError('not_ready', 'model not ready'); });
    const previous = currentOutfit ?? opts.initialOutfit ?? null;
    if (job.id !== null && job.id === previous) {
      writeOutfitPref(safeLocalStorage(), WEARING_OUTFIT_KEY, job.id); // 重选当前这件也算明确选择: 把偏好存下来 (否则默认服装永远存不进去)
      return { changed: false, id: job.id, name: job.name, previous };
    }
    swapTarget = job.id;
    setPickerState({ loading: job.id });
    try { await vrmEngine.swapOutfit(job.url, job.name); } finally { swapTarget = null; setPickerState({ loading: null }); }
    currentOutfit = job.id;
    if (job.id !== null) writeOutfitPref(safeLocalStorage(), WEARING_OUTFIT_KEY, job.id); // 按钮 / xc.setOutfit / xc.setModel{outfit} 都走这里: 写回 iframe 自己的存储
    setPickerState({ outfit: job.id });
    loadedModel = job.name;
    return { changed: true, id: job.id, name: job.name, previous };
  }, (a, b) => a.key === b.key);

  // ── 预取 (xc.prefetch): 只下载进 IndexedDB, 并发 1, 排在 EMAGE 之后, 避开进行中的换装 ──
  const assetIo: AssetIo = {
    available: () => typeof indexedDB !== 'undefined',
    has: async (url, sha) => (await idbGet(url, sha)) !== null,
    put: (url, sha, buf) => idbPut(url, sha, buf),
    fetch: async (url, onBytes) => {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`fetch ${url}: HTTP ${resp.status}`);
      const total = Number(resp.headers.get('content-length') ?? 0);
      if (!resp.body) return resp.arrayBuffer();
      const reader = resp.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); loaded += value.byteLength; onBytes(loaded, total);
      }
      const out = new Uint8Array(loaded);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.byteLength; }
      return out.buffer;
    },
  };
  const prefetchLastKey = new Map<string, number>();
  const prefetcher = new PrefetchScheduler({
    gate: async () => {
      if (heavy === 'eager') { try { await vrmEngine.emagePlayer.ensureLoaded(); } catch { /* EMAGE 加载失败不该卡住预取 */ } }
      await swapQueue.idle();
    },
    work: (id, onProgress) => {
      const entry = APP_CONFIG.model.addons[id as keyof typeof APP_CONFIG.model.addons] as { source: string; sha?: string };
      return ensureAssets(
        [{ url: APP_CONFIG.model.defaultSource, sha: APP_CONFIG.model.defaultSha }, { url: entry.source, sha: entry.sha ?? '' }],
        assetIo,
        onProgress,
      );
    },
    onProgress: (id, pct) => {
      if (prefetchLastKey.get(id) === pct) return;
      prefetchLastKey.set(id, pct);
      send('xc.load.progress', { phase: 'prefetch', progress: pct, id });
    },
  });

  async function runPrefetch(raw: unknown, replyId: string | undefined): Promise<void> {
    let ids: string[];
    if (raw === undefined || raw === null) ids = defaultPrefetchIds(addons);
    else {
      if (!Array.isArray(raw) || raw.length > 32) throw new CmdError('bad_request', 'prefetch ids must be an array of at most 32 outfit ids');
      ids = [];
      for (const v of raw) {
        if (!isXcId(v)) throw new CmdError('bad_request', 'invalid outfit id in prefetch ids');
        if (!ownEntry(addons, v)) throw new CmdError('unknown_id', `unknown outfit: ${v}`);
        ids.push(v);
      }
    }
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    const result: XcPrefetchedPayload = saveData
      ? { downloaded: [], cached: [], failed: [], skipped: 'save-data' }
      : await prefetcher.enqueue(ids);
    send('xc.prefetched', result, replyId);
  }

  function outfitJob(raw: unknown): SwapJob {
    if (!isXcId(raw)) throw new CmdError('bad_request', 'invalid outfit id');
    const entry = ownEntry(addons, raw);
    if (!entry) throw new CmdError('unknown_id', `unknown outfit: ${raw}`);
    return { key: `id:${raw}`, id: raw, url: entry.source, name: entry.name };
  }

  /** 内置按钮的换装入口: 走 runSwap (同一队列 / 同一事件), 错误转成轻提示而不是 reject。 */
  async function pickOutfit(id: string): Promise<void> {
    let job: SwapJob;
    try { job = outfitJob(id); } catch { return; }
    if (job.id === (currentOutfit ?? opts.initialOutfit ?? null) && swapTarget === null) return; // 已经穿着
    if (swapTarget !== null && swapTarget !== job.id) pickerNotice('busy'); // 有换装在跑: 提示"已记下最新选择"
    try {
      await runSwap(job, undefined, false);
    } catch (e) {
      if (e instanceof BusyError) pickerNotice('busy');
      else pickerNotice('failed');
    }
  }

  async function pickScene(id: string): Promise<void> {
    if (!isXcId(id) || !ownEntry(APP_CONFIG.scenes.items, id)) return;
    try { await applyScene(id, undefined, true); } catch { /* 场景切换失败: sceneManager 内部已有日志 */ }
  }

  async function runSwap(job: SwapJob, replyId: string | undefined, legacyLoaded: boolean): Promise<void> {
    const { promise, shared } = swapQueue.enqueue(job);
    const r = await promise;
    const noop = !r.changed || shared;
    send('xc.outfit-changed', { id: r.id, name: r.name, previous: r.previous, ...(noop ? { noop: true } : {}) }, replyId);
    if (legacyLoaded && !noop) send('xc.loaded', { model: r.name }); // 旧 SDK 靠 xc.loaded 知道换装完成
  }

  // ── 命中检测 (透明穿透) ──
  // 节流 / 迟滞 / rAF 合并 / buttons 锁 / hitSeq 丢弃过期结果 全部在 HitGate (src/core/gesture/hitGate.ts),
  // 常量 (HIT_RELEASE_MS=160, HIT_MIN_INTERVAL_MS=33) 与行为同 commit 36805ce, 这里只负责:
  //  - 命中检测本身: vrmEngine.hitTest (渲染完一帧后读指针处 1 个像素的 alpha);
  //    内置按钮 / 菜单 (ui=outfit,scene) 上或菜单展开期间不读像素, 直接算命中 (按钮点击不能穿透);
  //  - 命中变化 → xc.hit-region 消息。
  //  - 宿主开了 resizable 时, 四角热区 (core/gesture/corners.ts, 与 Tauri 同一个 40px) 也直接算命中: 否则透明场景下指针在角落会穿透给宿主页, 缩放抓不到。
  //    只开 draggable 时不加角落: 透明场景只有点在角色上才接管拖动, 其余仍穿透。
  const hitGate = new HitGate({
    test: (x, y) => (menuOpenCount > 0 || isOverEmbedUi(x, y) || (gestures.enabled.resize && cornerAt(x, y, window.innerWidth, window.innerHeight) !== null)
      ? Promise.resolve(true) : vrmEngine.hitTest(x, y)),
    isDisposed: () => disposed,
    emit: (ev) => send('xc.hit-region', { hit: ev.hit, x: ev.x, y: ev.y }),
  });
  let lastPointer: { x: number; y: number } | null = null;
  const reportHit = (x: number, y: number, fromHost = false, buttons = 0) => {
    lastPointer = { x, y };
    hitGate.report(x, y, fromHost, buttons);
  };

  // 菜单关闭后按最后一次指针位置重新判定 (指针若已在空白处, 要让宿主把 iframe 切回穿透)
  onMenuOpenChange = () => {
    if (menuOpenCount > 0 || !lastPointer) return;
    hitGate.forgetTested();
    reportHit(lastPointer.x, lastPointer.y);
  };

  async function ensureStt(): Promise<SttClient> {
    if (stt) return stt;
    const { SttClient } = await import('@/stt/sttClient'); // 懒加载: 不开麦就不下载 STT 代码
    stt = new SttClient();
    sttOff = stt.on((e) => {
      if (e.type === 'state') {
        sttState = e.state;
        send('xc.stt', { kind: 'state', state: e.state });
        publishState();
      } else if (e.type === 'progress') {
        // 下载进度会高频重复回调: 只在整数百分比变化时转发, 避免刷屏宿主
        const pct = Math.round(e.percent);
        if (pct !== lastSttPercent) { lastSttPercent = pct; send('xc.stt', { kind: 'progress', percent: pct }); }
      }
      else if (e.type === 'text') send('xc.stt', { kind: 'text', text: e.text });
      else if (e.type === 'error' && e.message !== 'empty_transcript') sendError('failed', `stt: ${e.message}`, 'xc.mic');
    });
    return stt;
  }

  /**
   * xc.say(speak) / xc.audio / xc.audio.chunk 共用: 把命令转成 protocol action 交给同一个 handler
   * (core/protocol/handler.ts, 与 xiaochun:// deep link 共用), 并在 onStart / 结束时发 xc.utterance。
   * handler 抛 ProtocolError → xc.error (带同一个 id, SDK 据此 reject); 出错不发 end。
   */
  async function dispatchSpeech(id: string | undefined, message: ProtocolMessage, text: string, command: string): Promise<void> {
    const kind = message.action === 'audio' ? 'audio' : 'text';
    let started = false;
    const finish = () => {
      if (!started) return;
      started = false;
      speakingCount = Math.max(0, speakingCount - 1);
      if (currentAudioId === (id ?? null)) currentAudioId = null;
      publishState();
    };
    try {
      await runProtocolAction(message, {
        onStart: () => {
          started = true;
          speakingCount++;
          thinking = false;
          currentAudioId = kind === 'audio' ? (id ?? null) : null;
          publishState();
          send('xc.utterance', { phase: 'start', text, kind }, id);
        },
      });
      finish();
      if (!disposed) send('xc.utterance', { phase: 'end', text, kind }, id);
    } catch (e) {
      finish();
      if (disposed) return;
      if (e instanceof CmdError) sendError(e.code, e.message, command, id);
      else sendError('failed', e instanceof Error ? e.message : String(e), command, id);
    }
  }

  async function handleCommand(raw: unknown): Promise<void> {
    if (disposed) return;
    if (!isXcEnvelope(raw)) return;
    const env = raw as XcEnvelope<string, any>;
    const { type, id } = env;
    const p = (env.payload ?? {}) as Record<string, any>;
    try {
      switch (type) {
        case 'xc.say': {
          const text = typeof p.text === 'string' ? p.text.trim() : '';
          if (!text) throw new CmdError('bad_request', 'text is required');
          const mode = p.mode === 'chat' ? 'chat' : 'speak';
          if (mode === 'speak') {
            // 与 xiaochun://speak?text=… 同一个 action / handler (core/protocol/handler.ts)
            await dispatchSpeech(id, { action: 'speak', payload: { text } }, text, 'xc.say');
            break;
          }
          await waitModelReady().catch(() => { throw new CmdError('not_ready', 'model not ready'); });
          const token = ++speakingToken;
          speakingCount++;
          thinking = true; // chat 模式 (LLM) 没有 xiaochun:// 对应 action, 直接走引擎
          publishState();
          send('xc.utterance', { phase: 'start', text, kind: 'text' }, id);
          try {
            await vrmEngine.sendMessage(text);
          } finally {
            speakingCount = Math.max(0, speakingCount - 1);
            if (token === speakingToken) thinking = false;
            publishState();
          }
          send('xc.utterance', { phase: 'end', text, kind: 'text' }, id);
          break;
        }
        case 'xc.audio': {
          // 与 xiaochun://speak?audioUrl=… 同一个 handler: 输入解析/校验/EMAGE+口型链路全在 core/protocol
          const ap = p as unknown as XcAudioPayload;
          const text = typeof ap.text === 'string' ? ap.text : '';
          // 只挑白名单字段: 不信任宿主发来的任何内部字段 (如 stream)
          await dispatchSpeech(id, {
            action: 'audio',
            payload: {
              source: ap.source, format: ap.format, mimeType: ap.mimeType, sampleRate: ap.sampleRate, channels: ap.channels,
              text, motion: ap.motion, lipsync: ap.lipsync, audible: ap.audible, playbackRate: ap.playbackRate, volume: ap.volume,
            },
          }, text, 'xc.audio');
          break;
        }
        case 'xc.audio.chunk': {
          const cp = p as unknown as XcAudioChunkPayload;
          if (!id) throw new CmdError('bad_request', 'xc.audio.chunk needs an envelope id (stream id)');
          if (endedStreams.has(id)) {
            endedStreams.delete(id); // 只报一次
            throw new CmdError('bad_request', 'audio stream already ended or was preempted');
          }
          if (cp.format !== 'pcm16' && cp.format !== 'float32') throw new CmdError('bad_request', 'chunk format must be pcm16 or float32');
          let st = audioStreams.get(id);
          if (st && (cp.sampleRate !== st.sampleRate || cp.format !== st.format)) {
            throw new CmdError('bad_request', 'sampleRate/format must stay constant within one stream');
          }
          const sampleRate = st ? st.sampleRate : checkSampleRate(cp.sampleRate);
          const channels: 1 | 2 = st ? st.channels : (cp.channels === 2 ? 2 : 1);
          // 先校验/转换数据, 再建流: 第一个 chunk 就非法时不会留下一条空流
          const mono = rawPcmToMono(cp.data, cp.format, st ? st.channels : cp.channels);
          if (!st) {
            const q = new AsyncChunkQueue();
            st = { q, sampleRate, format: cp.format, channels, samples: 0 };
            audioStreams.set(id, st);
            const streamId = id;
            const text = typeof cp.text === 'string' ? cp.text : '';
            void dispatchSpeech(streamId, {
              action: 'audio',
              payload: {
                text, motion: cp.motion, lipsync: cp.lipsync, audible: cp.audible,
                playbackRate: cp.playbackRate, volume: cp.volume,
                stream: { sampleRate, chunks: q },
              },
            }, text, 'xc.audio.chunk').finally(() => {
              const cur = audioStreams.get(streamId);
              if (cur) { cur.q.abort(); audioStreams.delete(streamId); }
              endedStreams.add(streamId);
              if (endedStreams.size > 64) endedStreams.delete(endedStreams.values().next().value as string);
            });
          }
          st.samples += mono.length;
          if (st.samples / st.sampleRate > HOST_AUDIO.maxSec) {
            st.q.abort();
            throw new CmdError('bad_request', `audio stream exceeds ${HOST_AUDIO.maxSec}s`);
          }
          st.q.push(mono);
          break;
        }
        case 'xc.audio.end': {
          if (!id) throw new CmdError('bad_request', 'xc.audio.end needs the stream id');
          const st = audioStreams.get(id);
          if (!st) {
            // 整段 xc.audio 也可以用同一个 id 打断 (SDK 的 AbortSignal)
            if (p.abort === true && currentAudioId === id) { vrmEngine.stopSpeaking(); break; }
            if (endedStreams.has(id) || p.abort === true) break; // 已结束 / 还没开始: 无事可做
            throw new CmdError('bad_request', 'unknown audio stream');
          }
          if (p.abort === true) {
            st.q.abort();
            if (currentAudioId === id) vrmEngine.stopSpeaking(); // 立刻停播, 不等已排队的片段播完
          } else {
            st.q.close();
          }
          break;
        }
        case 'xc.motion': {
          await waitModelReady().catch(() => { throw new CmdError('not_ready', 'model not ready'); });
          if (p.stop === true) { vrmEngine.stopMotion(clamp(p.fadeDuration, FADE_RANGE, 0.75)); break; }
          const url = p.name !== undefined
            ? safeAssetUrl(BUILTIN_MOTIONS[String(p.name)], ['.vrma'])
            : safeAssetUrl(p.url, ['.vrma']);
          if (!url) throw new CmdError('bad_request', 'motion needs a built-in name or an https/same-origin .vrma url');
          await vrmEngine.playMotion(url, {
            loop: p.loop === true,
            fadeDuration: clamp(p.fadeDuration, FADE_RANGE, 0.75),
            timeScale: clamp(p.timeScale, TIMESCALE_RANGE, 1),
            mask: p.mask === 'upperBody' ? 'upperBody' : 'all',
          });
          break;
        }
        case 'xc.expression': {
          if (typeof p.name !== 'string' || !EXPRESSIONS.has(p.name)) throw new CmdError('bad_request', 'invalid expression name');
          await waitModelReady().catch(() => { throw new CmdError('not_ready', 'model not ready'); });
          vrmEngine.setExpression(p.name);
          break;
        }
        case 'xc.pointer': {
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new CmdError('bad_request', 'x/y must be numbers');
          reportHit(p.x, p.y, true);
          break;
        }
        case 'xc.setModel': {
          // 旧命令, 保留兼容: outfit 走与 xc.setOutfit 相同的白名单 + 串行队列 (并多发一条 xc.loaded 给旧 SDK); url 默认关闭。
          if (typeof p.outfit === 'string') {
            await runSwap(outfitJob(p.outfit), id, true);
            break;
          }
          if (!allowCustomModel) {
            throw new CmdError('unsupported', 'custom model URLs are disabled; the host must opt in (SDK option allowCustomModel) or use xc.setOutfit with a built-in id');
          }
          const url = safeAssetUrl(p.url, ['.vrm', '.vrmaddon', '.vrmbase']);
          if (!url) throw new CmdError('bad_request', 'setModel needs outfit or an https/same-origin .vrm/.vrmaddon/.vrmbase url');
          const name = typeof p.name === 'string' ? p.name.slice(0, 64) : 'custom';
          await runSwap({ key: `url:${url}`, id: null, url, name }, id, true);
          break;
        }
        case 'xc.setOutfit':
          await runSwap(outfitJob(p.id), id, false);
          break;
        case 'xc.prefetch':
          await runPrefetch(p.ids, id);
          break;
        case 'xc.setScene': {
          if (!isXcId(p.id)) throw new CmdError('bad_request', 'invalid scene id');
          if (!ownEntry(APP_CONFIG.scenes.items, p.id)) throw new CmdError('unknown_id', `unknown scene: ${p.id}`);
          await applyScene(p.id, id, true);
          break;
        }
        case 'xc.setConfig':
          await applyConfig(p as XcConfig, type);
          break;
        case 'xc.mic': {
          const client = await ensureStt();
          if (p.enabled === true) await client.start();
          else await client.stop();
          break;
        }
        case 'xc.transport': {
          const tp = p as unknown as XcTransportPayload;
          vrmEngine.setTransport({ playbackRate: tp.playbackRate, volume: tp.volume });
          break;
        }
        case 'xc.pause':
          paused = true;
          vrmEngine.hostPaused = true;
          vrmEngine.suspendRendering();
          publishState();
          break;
        case 'xc.resume':
          paused = false;
          vrmEngine.hostPaused = false;
          vrmEngine.resumeRendering();
          publishState();
          break;
        case 'xc.destroy':
          dispose();
          break;
        case 'xc.lookAt':
          // TODO(xc.lookAt): GazeController 目前由相机 + 随机扫视驱动, 没有外部注视点入口。
          throw new CmdError('unsupported', 'xc.lookAt is not supported yet');
        case 'xc.init':
          break; // 端口通道上的重复 init: 忽略
        default:
          throw new CmdError('unsupported', `unknown command: ${type}`);
      }
    } catch (e) {
      if (disposed) return;
      if (e instanceof CmdError) sendError(e.code, e.message, type, id);
      else if (e instanceof BusyError) sendError('busy', e.message, type, id);
      else sendError('failed', e instanceof Error ? e.message : String(e), type, id);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    swapQueue.close();
    prefetcher.close();
    window.removeEventListener('message', onWindowMessage);
    if (readyTimer) clearInterval(readyTimer);
    gestures.dispose();
    sttOff?.();
    void stt?.stop(false).catch(() => {});
    stt?.dispose();
    try { vrmEngine.releaseHeavyResources(); } catch { /* ignore */ }
    try { vrmEngine.dispose(); } catch { /* ignore */ }
    try { port?.close(); } catch { /* ignore */ }
    port = null;
    window.removeEventListener('pointermove', onLocalPointer);
    window.removeEventListener('pointerdown', onLocalDown);
    document.documentElement.removeEventListener('mouseleave', onLocalLeave);
  }

  // 本地点击/移动: iframe 自己拿到 pointer 事件时, 也上报 hit-region (SDK 据此在离开角色时切回 pointer-events:none)
  const onLocalPointer = (e: PointerEvent) => reportHit(e.clientX, e.clientY, false, e.buttons);
  const onLocalLeave = () => hitGate.leave();
  window.addEventListener('pointermove', onLocalPointer, { passive: true });
  // 触屏没有 move: 点在空白处时也要上报"离开", 让宿主切回穿透 (触屏 pointerdown 的 buttons=1 会被当成"拖动中", 这里按 0 处理)
  const onLocalDown = (e: PointerEvent) => reportHit(e.clientX, e.clientY, false, e.pointerType === 'touch' ? 0 : e.buttons);
  window.addEventListener('pointerdown', onLocalDown, { passive: true });
  document.documentElement.addEventListener('mouseleave', onLocalLeave);

  const readyOff = vrmEngine.onReadyChange(() => publishState());

  return {
    pickOutfit, pickScene,
    pickLang: (lang) => { if (isLang(lang)) setLang(lang, true); },
    // React 卸载 (含 StrictMode 的假卸载) 只摘监听, 不销毁引擎; 引擎只在宿主 xc.destroy 时释放。
    dispose: () => {
      disposed = true;
      swapQueue.close();
      prefetcher.close();
      hitGate.dispose();
      gestures.dispose();
      readyOff();
      window.removeEventListener('message', onWindowMessage);
      window.removeEventListener('pointermove', onLocalPointer);
      window.removeEventListener('pointerdown', onLocalDown);
      document.documentElement.removeEventListener('mouseleave', onLocalLeave);
      if (readyTimer) clearInterval(readyTimer);
      onMenuOpenChange = null;
      try { port?.close(); } catch { /* ignore */ }
      port = null;
    },
    reportProgress(state) {
      if (!state.active) return;
      const pct = Math.round(state.progress);
      if (loadedModel === null) {
        // 首次加载 (phase:'model'); 握手前的最新进度留着, 握手后补发
        lastProgress = pct;
        if (pct === lastModelSent) return;
        lastModelSent = pct;
        send('xc.load.progress', { phase: 'model', progress: pct });
        return;
      }
      // 运行中换装 (phase:'outfit'): 连续相同的进度不重复发
      const key = `${swapTarget ?? ''}:${pct}`;
      if (key === lastProgressKey) return;
      lastProgressKey = key;
      send('xc.load.progress', { phase: 'outfit', progress: pct, ...(swapTarget ? { id: swapTarget } : {}) });
    },
    reportLoaded(model, outfitId = null) {
      loadedModel = model;
      currentOutfit = outfitId;
      setPickerState({ outfit: outfitId, loading: null });
      send('xc.loaded', { model });
      send('xc.outfit-changed', { id: outfitId, name: model, initial: true });
      publishState(true);
    },
  };
}

export { setUiState as setEmbedUiState };
