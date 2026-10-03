/**
 * embed/bridge.ts — /embed 侧 postMessage 协议实现 (iframe 内运行)。
 *
 * 协议常量/类型来自 packages/project-xiaochun/src/protocol.ts (单一事实源, 包名 @firetable/project-xiaochun)。
 * 安全模型:
 *   1. 仅 `window.parent` 发来的 `xc.init`, 且 event.origin ∈ 白名单 才接受; 其余一律忽略。
 *   2. `xc.ready` 的 targetOrigin 是宿主 origin (绝不用 '*'), 握手后全部走 MessageChannel 端口。
 *   3. 只接受一次 `xc.init` (防重放换端口)。
 *   4. 所有 URL 参数 (motion / setModel) 只允许 https:// 或同源, 且限定扩展名。
 */
import { vrmEngine, type LoadingState } from '@/core/vrmEngine';
import { APP_CONFIG } from '@/config';
import { sceneManager } from '@/core/scene/sceneManager';
import { setHeavyPreloadOverride } from '@/lib/heavyPreload';
import { isLang } from '@/i18n';
import type { SttClient } from '@/stt/sttClient';
import { HOST_AUDIO, AsyncChunkQueue } from '@/director/hostAudio';
import { checkSampleRate, rawPcmToMono } from '@/core/protocol/audio';
import { runProtocolAction } from '@/core/protocol/handler';
import { ProtocolError as CmdError, type ProtocolMessage } from '@/core/protocol/types';
import {
  XC_IMPLEMENTED_COMMANDS,
  XC_UNSUPPORTED_COMMANDS,
  XC_PROTOCOL_VERSION,
  isXcEnvelope,
  xcMessage,
  type XcAudioChunkPayload,
  type XcAudioPayload,
  type XcConfig,
  type XcErrorCode,
  type XcEnvelope,
  type XcFrameMessageType,
  type XcHeavyMode,
  type XcPhase,
} from '@firetable/project-xiaochun/protocol';
import type { EmbedParams } from './params';

/** say 文本上限 (字符)。调大: 允许更长一口气念完, 但 TTS/EMAGE 耗时和显存占用线性上涨; 调小: 更安全但长文被拒。 */
const MAX_SAY_CHARS = 2000;
/** 等模型就绪的最长时间 (ms)。调大: 慢网络下命令更不容易 not_ready; 调小: 失败反馈更快。 */
const READY_TIMEOUT_MS = 60_000;
/** xc.ready 握手重发次数 / 间隔 (ms)。宿主监听器晚于 iframe 就绪时靠它兜底; 调大只增加无用广播。 */
const READY_RETRY_TIMES = 10;
const READY_RETRY_INTERVAL_MS = 1000;
/** 动作淡入淡出范围 (秒): 下限由管线决定 (0.26), 上限调大会让切换更"飘"。 */
const FADE_RANGE: [number, number] = [0.26, 3];
/** 动作倍速范围: <0.25 几乎静止, >3 肢体抖动。 */
const TIMESCALE_RANGE: [number, number] = [0.25, 3];

const EXPRESSIONS = new Set(['neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised']);
const BUILTIN_MOTIONS: Record<string, string> = { thinking: '/vrm/motion/thinking.vrma' };

// ── 极简 UI 状态仓 (给 React useSyncExternalStore) ──
type UiState = { ui: boolean; bubble: boolean };
let uiState: UiState = { ui: false, bubble: false };
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
  /** xc.setConfig{lang} 回调 (由 React 层持有 i18n)。 */
  onLang: (lang: 'zh-CN' | 'en' | 'ja') => void;
}

export interface EmbedBridge {
  dispose: () => void;
  /** 供 React 层上报模型加载进度 / 完成。 */
  reportProgress: (state: LoadingState) => void;
  reportLoaded: (model: string) => void;
}

export function startEmbedBridge(opts: EmbedBridgeOptions): EmbedBridge {
  const { params } = opts;
  const noop: EmbedBridge = { dispose() {}, reportProgress() {}, reportLoaded() {} };
  if (typeof window === 'undefined' || window.parent === window) return noop; // 直接打开 /embed: 无宿主
  const allowed = new Set(params.allowedHostOrigins);

  let port: MessagePort | null = null;
  let disposed = false;
  let heavy: XcHeavyMode = params.heavy;
  let paused = false;
  let loadedModel: string | null = null;
  let lastProgress = 0;
  let speakingToken = 0;
  let speakingCount = 0;
  let thinking = false;
  let sttState: 'idle' | 'loading' | 'listening' | 'recognizing' | 'error' = 'idle';
  let stt: SttClient | null = null;
  let sttOff: (() => void) | null = null;
  let lastSttPercent = -1;
  let lastPhase: XcPhase | null = null;
  let lastHit: boolean | null = null;
  let readyTimer: ReturnType<typeof setInterval> | null = null;
  /** 流式音频会话 (xc.audio.chunk 的 id → 队列)。 */
  const audioStreams = new Map<string, { q: AsyncChunkQueue; sampleRate: number; format: 'pcm16' | 'float32'; channels: 1 | 2; samples: number }>();
  /** 已结束/被抢占的流 id: 之后到达的 chunk 只报一次错, 不会"复活"一次说话。 */
  const endedStreams = new Set<string>();
  let currentAudioId: string | null = null;

  const send = (type: XcFrameMessageType, payload?: unknown, id?: string) => {
    port?.postMessage(xcMessage(type, payload, id));
  };
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
          audio: { formats: ['encoded', 'pcm16', 'float32'], streaming: true, maxSeconds: HOST_AUDIO.maxSec },
          crossOriginIsolated: typeof self !== 'undefined' && self.crossOriginIsolated === true,
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
    if (loadedModel !== null) send('xc.loaded', { model: loadedModel });
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
      if (isLang(cfg.lang)) opts.onLang(cfg.lang);
      else throw new CmdError('bad_request', `invalid lang: ${String(cfg.lang)}`);
    }
    if (typeof cfg.ui === 'boolean') setUiState({ ui: cfg.ui, bubble: cfg.ui });
    if (typeof cfg.transparent === 'boolean') {
      const id = cfg.transparent ? 'transparent' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      await sceneManager.setScene(id, false); // persist=false: 不写 iframe 的 localStorage
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

  // ── 命中检测 (透明穿透) ──
  // 原先每个 pointermove 都同步做一次 SkinnedMesh 射线检测, 并且 hit 一变就立刻回报,
  // 指针沿轮廓走时会让宿主的 iframe pointer-events 在 auto/none 间来回抖动。现在:
  //  0) 检测改为读渲染画面指针处的 1 个像素 alpha (vrmEngine.hitTest), 不再逐三角形射线检测 (单次 10~25ms);
  //  1) 每帧最多检测一次 (rAF 合并, 取最新坐标); 指针几乎没动 (<1px) 且不是宿主发起时跳过;
  //  2) 命中 → 立刻回报 (保证第一下就能点到角色); 未命中 → 延迟 HIT_RELEASE_MS 才回报,
  //     期间再次命中就取消 (迟滞, 消除轮廓/动作造成的抖动);
  //  3) 按住鼠标 (拖动旋转) 时不回报"离开", 避免拖动中途被切断;
  //  4) 宿主发起的 xc.pointer 命中时总是回报 (宿主可能自行把 iframe 切回 none, 不能只靠去重)。
  const HIT_RELEASE_MS = 160;
  let hitRaf = 0;
  let hitDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let hitReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingHit: { x: number; y: number; fromHost: boolean; buttons: number } | null = null;
  let lastTested: { x: number; y: number } | null = null;

  function sendHit(hit: boolean, x: number, y: number) {
    if (hit === lastHit) return;
    lastHit = hit;
    send('xc.hit-region', { hit, x, y });
  }

  let hitSeq = 0;
  function processHit() {
    hitRaf = 0;
    const q = pendingHit;
    pendingHit = null;
    if (!q || disposed) return;
    if (!q.fromHost && lastTested && Math.abs(q.x - lastTested.x) < 1 && Math.abs(q.y - lastTested.y) < 1) return;
    lastTested = { x: q.x, y: q.y };
    lastHitTestAt = performance.now();
    const seq = ++hitSeq;
    // 像素级检测: 结果在这一帧渲染完后给出 (见 vrmEngine.hitTest); 更新的检测已发出则丢弃旧结果
    void vrmEngine.hitTest(q.x, q.y).then((hit) => {
      if (disposed || seq !== hitSeq) return;
      applyHitResult(q, hit);
    });
  }

  function applyHitResult(q: { x: number; y: number; fromHost: boolean; buttons: number }, hit: boolean) {
    if (hit) {
      if (hitReleaseTimer) { clearTimeout(hitReleaseTimer); hitReleaseTimer = null; }
      if (lastHit !== true) sendHit(true, q.x, q.y);
      else if (q.fromHost) send('xc.hit-region', { hit: true, x: q.x, y: q.y }); // 宿主侧可能已切回 none, 重发以对齐
      return;
    }
    if (lastHit !== true || hitReleaseTimer) return; // 本来就没命中 / 已在倒计时
    if (q.buttons !== 0) return; // 拖动中不松手
    hitReleaseTimer = setTimeout(() => {
      hitReleaseTimer = null;
      sendHit(false, q.x, q.y);
    }, HIT_RELEASE_MS);
  }

  // 每次检测会触发一次 1×1 readPixels (GPU 同步): 再加一道最小间隔 (HIT_MIN_INTERVAL_MS), 距上次检测太近就等到间隔满再处理最新坐标
  const HIT_MIN_INTERVAL_MS = 33;
  let lastHitTestAt = 0;
  function reportHit(x: number, y: number, fromHost = false, buttons = 0) {
    pendingHit = { x, y, fromHost, buttons };
    if (hitRaf || hitDelayTimer) return;
    const wait = HIT_MIN_INTERVAL_MS - (performance.now() - lastHitTestAt);
    if (wait > 0) {
      hitDelayTimer = setTimeout(() => { hitDelayTimer = null; hitRaf = requestAnimationFrame(processHit); }, wait);
    } else {
      hitRaf = requestAnimationFrame(processHit);
    }
  }

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
    const shown = text.slice(0, MAX_SAY_CHARS);
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
          send('xc.utterance', { phase: 'start', text: shown, kind }, id);
        },
      });
      finish();
      if (!disposed) send('xc.utterance', { phase: 'end', text: shown, kind }, id);
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
          if (text.length > MAX_SAY_CHARS) throw new CmdError('bad_request', `text exceeds ${MAX_SAY_CHARS} chars`);
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
            payload: { source: ap.source, format: ap.format, mimeType: ap.mimeType, sampleRate: ap.sampleRate, channels: ap.channels, text, motion: ap.motion, lipsync: ap.lipsync },
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
              payload: { text, motion: cp.motion, lipsync: cp.lipsync, stream: { sampleRate, chunks: q } },
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
          let url: string | null = null;
          let name = typeof p.name === 'string' ? p.name.slice(0, 64) : 'custom';
          if (typeof p.outfit === 'string') {
            const addons = APP_CONFIG.model.addons as Record<string, { source: string; name: string }>;
            if (p.outfit === 'base') { url = APP_CONFIG.model.defaultSource; name = APP_CONFIG.model.defaultName; }
            else if (p.outfit in addons) { url = addons[p.outfit].source; name = addons[p.outfit].name; }
            else throw new CmdError('bad_request', `unknown outfit: ${p.outfit}`);
          } else {
            url = safeAssetUrl(p.url, ['.vrm', '.vrmaddon', '.vrmbase']);
            if (!url) throw new CmdError('bad_request', 'setModel needs outfit or an https/same-origin .vrm/.vrmaddon/.vrmbase url');
          }
          await waitModelReady().catch(() => { throw new CmdError('not_ready', 'model not ready'); });
          await vrmEngine.swapOutfit(url, name);
          loadedModel = name;
          send('xc.loaded', { model: name });
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
      else sendError('failed', e instanceof Error ? e.message : String(e), type, id);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('message', onWindowMessage);
    if (readyTimer) clearInterval(readyTimer);
    sttOff?.();
    void stt?.stop(false).catch(() => {});
    stt?.dispose();
    try { vrmEngine.releaseHeavyResources(); } catch { /* ignore */ }
    try { vrmEngine.dispose(); } catch { /* ignore */ }
    try { port?.close(); } catch { /* ignore */ }
    port = null;
    window.removeEventListener('pointermove', onLocalPointer);
    document.documentElement.removeEventListener('mouseleave', onLocalLeave);
  }

  // 本地点击/移动: iframe 自己拿到 pointer 事件时, 也上报 hit-region (SDK 据此在离开角色时切回 pointer-events:none)
  const onLocalPointer = (e: PointerEvent) => reportHit(e.clientX, e.clientY, false, e.buttons);
  const onLocalLeave = () => {
    if (hitReleaseTimer) { clearTimeout(hitReleaseTimer); hitReleaseTimer = null; }
    pendingHit = null;
    hitSeq++;
    if (lastHit === false) return;
    lastHit = false;
    send('xc.hit-region', { hit: false, x: -1, y: -1 });
  };
  window.addEventListener('pointermove', onLocalPointer, { passive: true });
  document.documentElement.addEventListener('mouseleave', onLocalLeave);

  const readyOff = vrmEngine.onReadyChange(() => publishState());

  return {
    // React 卸载 (含 StrictMode 的假卸载) 只摘监听, 不销毁引擎; 引擎只在宿主 xc.destroy 时释放。
    dispose: () => {
      disposed = true;
      if (hitRaf) cancelAnimationFrame(hitRaf);
      if (hitDelayTimer) clearTimeout(hitDelayTimer);
      if (hitReleaseTimer) clearTimeout(hitReleaseTimer);
      readyOff();
      window.removeEventListener('message', onWindowMessage);
      window.removeEventListener('pointermove', onLocalPointer);
      document.documentElement.removeEventListener('mouseleave', onLocalLeave);
      if (readyTimer) clearInterval(readyTimer);
      try { port?.close(); } catch { /* ignore */ }
      port = null;
    },
    reportProgress(state) {
      if (!state.active) return;
      lastProgress = Math.round(state.progress);
      send('xc.load.progress', { phase: 'model', progress: lastProgress });
    },
    reportLoaded(model) {
      loadedModel = model;
      send('xc.loaded', { model });
      publishState(true);
    },
  };
}

export { setUiState as setEmbedUiState };
