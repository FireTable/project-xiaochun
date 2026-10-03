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
  normalizeOrigin,
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
  type XcReadyPayload,
  type XcSttPayload,
  type XcStatePayload,
  type XcUtterancePayload,
} from './protocol';

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
  transparent?: boolean;
  /** 固定尺寸, 数字=px, 字符串=CSS 长度。务必给定, 否则无法预留空间 (CLS)。默认 320x480。 */
  width?: number | string;
  height?: number | string;
  position?: XiaochunPosition;
  /** 悬浮模式下允许拖动 (左上角手柄)。 */
  draggable?: boolean;
  lang?: XcLang;
  /** 初始服装: 内置 key (如 'xiaochun_maid') 或 https .vrm/.vrmaddon URL。 */
  model?: string;
  /** 显示 iframe 内置 ChatBar (默认 false)。 */
  ui?: boolean;
  heavy?: XcHeavyMode;
  /** 放开 iframe 内滚轮缩放 (默认锁, 防止吞宿主滚动)。 */
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
  setModel(m: string | { url?: string; outfit?: string; name?: string }): Promise<void>;
  setConfig(cfg: XcConfig): Promise<void>;
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

  const transparent = options.transparent ?? false;
  const passthrough = options.passthrough ?? transparent;
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
  ws.borderRadius = 'var(--xc-radius, 0)';
  ws.boxShadow = 'var(--xc-shadow, none)';
  if (!transparent) ws.background = 'var(--xc-bg, transparent)';
  if (position === 'bottom-right') { ws.right = 'var(--xc-offset-x, 16px)'; ws.bottom = 'var(--xc-offset-y, 16px)'; }
  if (position === 'bottom-left') { ws.left = 'var(--xc-offset-x, 16px)'; ws.bottom = 'var(--xc-offset-y, 16px)'; }
  if (position !== 'inline') ws.zIndex = `var(--xc-z-index, ${options.zIndex ?? 2147483000})`;
  ws.pointerEvents = 'none'; // 容器本身不吃事件; 占位/iframe/手柄各自开
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
    ps.borderRadius = 'var(--xc-radius, 0)';
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
  const queue: Array<{ type: XcHostMessageType; payload?: unknown; id?: string; transfer?: Transferable[] }> = [];
  const pending = new Map<string, { resolve: () => void; reject: (e: Error) => void; sawEnd: boolean }>();
  let idSeq = 0;
  let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  let io: IntersectionObserver | null = null;
  let idleHandle: number | null = null;

  const postToFrame = (type: XcHostMessageType, payload?: unknown, id?: string, transfer?: Transferable[]) => {
    if (!port) { queue.push({ type, payload, id, transfer }); return; }
    port.postMessage(xcMessage(type, payload, id), transfer ?? []);
  };

  const send = (type: XcHostMessageType, payload?: unknown, wait = false, transfer?: Transferable[], fixedId?: string): Promise<void> => {
    if (destroyed) return Promise.reject(new Error('[project-xiaochun] instance destroyed'));
    if (!iframe) activate(); // 任何交互 API 都视为"用户意图", 立即创建
    const id = fixedId ?? `c${++idSeq}`;
    const p = wait
      ? new Promise<void>((resolve, reject) => pending.set(id, { resolve, reject, sawEnd: false }))
      : Promise.resolve();
    postToFrame(type, payload, id, transfer);
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
    if (options.ui) u.searchParams.set('ui', '1');
    if (options.lang) u.searchParams.set('lang', options.lang);
    if (options.heavy) u.searchParams.set('heavy', options.heavy);
    if (options.controls) u.searchParams.set('controls', '1');
    if (options.model) u.searchParams.set('outfit', options.model);
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
    s.borderRadius = 'var(--xc-radius, 0)'; // 圆角裁剪 iframe 内容 (宿主 CSS 只能改这层外壳, 改不到 iframe 内部)
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
    setupPassthrough();
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
    // targetOrigin = 已校验的 ev.origin, 绝不用 '*'
    iframe.contentWindow!.postMessage(
      xcMessage('xc.init', { hostOrigin: window.location.origin }),
      ev.origin,
      [ch.port2],
    );
    if (handshakeTimer) { clearTimeout(handshakeTimer); handshakeTimer = null; }
    emit('handshake', data.payload as XcReadyPayload);
    for (const m of queue.splice(0)) port.postMessage(xcMessage(m.type, m.payload, m.id), m.transfer ?? []);
    syncPause();
  };
  window.addEventListener('message', onWindowMessage);

  // ── 来自 iframe 的端口消息 ──
  function onPortMessage(ev: MessageEvent) {
    const data = ev.data as XcFrameMessage;
    if (!isXcEnvelope(data)) return;
    switch (data.type) {
      case 'xc.load.progress': emit('progress', data.payload); break;
      case 'xc.loaded':
        if (!loaded) {
          loaded = true;
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
      case 'xc.error': {
        const { code, message, command } = data.payload;
        emit('error', { code, message, command });
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
  function setupPassthrough() {
    if (!passthrough) return;
    window.addEventListener('pointermove', onHostPointer, { passive: true });
    window.addEventListener('scroll', invalidateRect, { passive: true, capture: true });
    window.addEventListener('resize', invalidateRect, { passive: true });
    if (typeof ResizeObserver !== 'undefined' && iframe) {
      rectRo = new ResizeObserver(invalidateRect);
      rectRo.observe(iframe);
    }
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

  // ── 可拖动手柄 (仅悬浮) ──
  let handle: HTMLElement | null = null;
  if (options.draggable && position !== 'inline') {
    handle = document.createElement('div');
    handle.setAttribute('aria-label', 'drag');
    Object.assign(handle.style, {
      position: 'absolute', left: '0', top: '0', width: '28px', height: '28px', cursor: 'grab',
      pointerEvents: 'auto', borderRadius: '8px', background: 'rgba(0,0,0,.25)', color: '#fff',
      font: '14px/28px system-ui', textAlign: 'center', userSelect: 'none', touchAction: 'none', zIndex: '2',
      opacity: '0.5',
    });
    handle.textContent = '⠿';
    let drag: { dx: number; dy: number } | null = null;
    handle.addEventListener('pointerdown', (e) => {
      const r = wrapper.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      handle!.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!drag) return;
      ws.left = `${Math.min(Math.max(0, e.clientX - drag.dx), window.innerWidth - 40)}px`;
      ws.top = `${Math.min(Math.max(0, e.clientY - drag.dy), window.innerHeight - 40)}px`;
      ws.right = 'auto'; ws.bottom = 'auto';
      invalidateRect();
    });
    const end = () => { drag = null; };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    wrapper.appendChild(handle);
  }

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
    setModel: (m) => send('xc.setModel', typeof m === 'string' ? (/^(https?:)?\/|\.vrm/i.test(m) ? { url: m } : { outfit: m }) : m),
    setConfig: (cfg) => send('xc.setConfig', cfg),
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
      window.removeEventListener('pointermove', onHostPointer);
      window.removeEventListener('scroll', invalidateRect, true);
      window.removeEventListener('resize', invalidateRect);
      rectRo?.disconnect();
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
