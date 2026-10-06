'use client';
/**
 * react.ts — React 封装 (子路径导出 `@firetable/project-xiaochun/react`, react 是可选 peerDependency)。
 *
 *   import { Xiaochun, useXiaochun } from '@firetable/project-xiaochun/react';
 *   <Xiaochun ref={ref} width={320} height={480} transparent onReady={...} />
 *   ref.current?.say('你好')  /  ref.current?.speakAudio(arrayBuffer)
 *
 * 设计要点:
 *   - 兼容 React 18 / 19 (只用 forwardRef / useImperativeHandle / useEffect / useState / createElement, 不写 JSX → 无需 jsx 运行时)。
 *   - SSR / Next.js 安全: 文件头 'use client'; 服务端只渲染一个**固定尺寸**的空 <div> (不产生 CLS), iframe 只在客户端 effect 里创建。
 *   - StrictMode 双挂载不泄漏: effect cleanup 一定 destroy(); lazy 模式下假挂载根本不会创建 iframe。
 *   - 不改变主入口体积: 主入口 (index) 不引用本文件, 不用 React 的人不会多拉一个字节。
 *   - 创建期选项 (src/lazy/position/…) 变化会重建实例; lang / outfit / scene / paused / mic / width / height / draggable / resizable / borderRadius / camera 变化则热更新
 *     (不重建 iframe, effect 里调 setter)。尤其 width / height: 用户缩放 (resizable) 后宿主把新尺寸写回 props 也不会重建, 模型 / 动画状态都保留。
 */
import { createElement, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, ForwardedRef, ReactElement } from 'react';
import { createXiaochun, defaultHeightCss, defaultWidthCss } from './client';
import type {
  XiaochunAudioOptions,
  XiaochunAudioSource,
  XiaochunAudioStream,
  XiaochunEvents,
  XiaochunInstance,
  XiaochunOptions,
} from './client';
import { isXcId } from './protocol';
import type { XcConfig, XcExpressionPayload, XcMotionPayload, XcOutfitInfo, XcPrefetchedPayload, XcSceneInfo, XcStatePayload } from './protocol';

/** 事件回调 (全部可选)。引用变化不会重建实例 (内部用 ref 持有最新值)。 */
export interface XiaochunCallbacks {
  /** xc.ready 握手成功。 */
  onHandshake?: (p: XiaochunEvents['handshake']) => void;
  /** 模型加载完成 (= xc.loaded)。 */
  onReady?: (p: XiaochunEvents['ready']) => void;
  onProgress?: (p: XiaochunEvents['progress']) => void;
  onState?: (p: XiaochunEvents['state']) => void;
  onStt?: (p: XiaochunEvents['stt']) => void;
  onUtterance?: (p: XiaochunEvents['utterance']) => void;
  onHitRegion?: (p: XiaochunEvents['hit-region']) => void;
  /** 服装已生效 (含首次加载 initial:true)。 */
  onOutfitChanged?: (p: XiaochunEvents['outfit-changed']) => void;
  /** 场景已生效 (含握手后上报的当前场景 initial:true)。 */
  onSceneChanged?: (p: XiaochunEvents['scene-changed']) => void;
  /** iframe 界面语言已生效 (含握手后上报的当前语言 initial:true; 用户点语言按钮 / setConfig({ lang }) 引起的变化)。 */
  onLangChanged?: (p: XiaochunEvents['lang-changed']) => void;
  onError?: (p: XiaochunEvents['error']) => void;
  onDestroy?: () => void;
  /** 用户拖动头像 (draggable): start / move / end, 位置已限幅 (视口坐标)。 */
  onMove?: (p: XiaochunEvents['move']) => void;
  /** 用户缩放头像 (resizable): start / move / end, 尺寸已限幅。想把尺寸同步进自己的状态, 在 phase === 'end' 时写回 width / height 即可 (不会重建 iframe)。 */
  onResize?: (p: XiaochunEvents['resize']) => void;
}

export interface XiaochunHookOptions extends Omit<XiaochunOptions, 'container'>, XiaochunCallbacks {
  /** 受控暂停: true = xc.pause, false = xc.resume。 */
  paused?: boolean;
  /** 受控麦克风: true = 开始听 (首次会加载 STT), false = 停。 */
  mic?: boolean;
}

export interface UseXiaochunResult {
  /** 绑定到你自己的容器: `<div ref={containerRef} style={{ width: 320, height: 480 }} />`。回调 ref, React 18/19 通用。 */
  containerRef: (el: HTMLElement | null) => void;
  /** 底层 SDK 实例; 服务端 / 尚未挂载 / 已卸载时为 null。 */
  client: XiaochunInstance | null;
  /** 模型是否加载完成。 */
  ready: boolean;
  /** 最近一次 xc.state。 */
  state: XcStatePayload | null;
}

const EVENT_MAP: Array<[keyof XiaochunEvents, keyof XiaochunCallbacks]> = [
  ['handshake', 'onHandshake'],
  ['ready', 'onReady'],
  ['progress', 'onProgress'],
  ['state', 'onState'],
  ['stt', 'onStt'],
  ['utterance', 'onUtterance'],
  ['hit-region', 'onHitRegion'],
  ['outfit-changed', 'onOutfitChanged'],
  ['scene-changed', 'onSceneChanged'],
  ['lang-changed', 'onLangChanged'],
  ['error', 'onError'],
  ['move', 'onMove'],
  ['resize', 'onResize'],
  ['destroy', 'onDestroy'],
];

/**
 * 在你自己的容器里创建 / 销毁一个小蠢实例 (客户端 only)。
 * 需要完全自定义布局时用它; 想省事用 <Xiaochun />。
 */
export function useXiaochun(options: XiaochunHookOptions = {}): UseXiaochunResult {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [client, setClient] = useState<XiaochunInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<XcStatePayload | null>(null);

  // 回调与"热更新型"选项放进 ref: 它们变化不应重建 iframe
  const live = useRef(options);
  live.current = options;

  const o = options;
  const originsKey = (o.allowedOrigins ?? []).join(',');

  useEffect(() => {
    if (!el) return;
    const cur = live.current;
    const { onHandshake: _a, onReady: _b, onProgress: _c, onState: _d, onStt: _e, onUtterance: _f, onHitRegion: _g, onError: _h, onDestroy: _i, onOutfitChanged: _j, onSceneChanged: _k, onLangChanged: _l, onMove: _q, onResize: _r, paused: _p, mic: _m, allowedOrigins, ...create } = cur;
    void [_a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _p, _m, _q, _r];
    const inst = createXiaochun({ ...create, allowedOrigins: allowedOrigins?.slice(), container: el });
    const offs: Array<() => void> = [];
    for (const [ev, cbName] of EVENT_MAP) {
      offs.push(inst.on(ev, (p: unknown) => { (live.current[cbName] as ((x: unknown) => void) | undefined)?.(p); }));
    }
    offs.push(inst.on('ready', () => setReady(true)));
    offs.push(inst.on('state', (s) => setState(s)));
    if (cur.paused) inst.pause();
    if (cur.mic) void inst.ready.then(() => inst.mic(true)).catch(() => {});
    setClient(inst);
    return () => {
      // StrictMode 的假卸载 / 真卸载 / 重建 都走这里: 必须销毁, 否则 iframe 与 window 监听泄漏
      offs.forEach((off) => off());
      inst.destroy();
      setClient(null);
      setReady(false);
      setState(null);
    };
    // 只有"创建期选项"变化才重建; lang/outfit/scene/paused/mic/回调走下面的热更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, o.src, o.origin, originsKey, o.lazy, o.lazyMargin, o.placeholder, o.transparent, o.position,
    JSON.stringify(o.ui ?? null), o.uiAutoHide, o.heavy, o.controls, o.autoPause, o.passthrough, o.sandbox, o.handshakeTimeout, o.crossOriginIsolated, o.zIndex,
    o.allowCustomModel, o.persist, o.persistBox, Array.isArray(o.prefetch) ? o.prefetch.join(',') : o.prefetch]);

  // 热更新: lang / outfit (model 是旧别名) / scene (跳过首次: 创建时已经作为初始选项传入)。
  // transparent 是创建期选项 (变化会重建); 想不重建地切透明请用 scene。
  const wantOutfit = o.outfit ?? o.model;
  const cameraKey = JSON.stringify(o.camera ?? null);
  const first = useRef({ lang: o.lang, outfit: wantOutfit, scene: o.scene, width: o.width, height: o.height, camera: cameraKey });
  const resizableKey = JSON.stringify(o.resizable ?? false);
  useEffect(() => {
    if (!client || first.current.lang === o.lang) return;
    first.current.lang = o.lang;
    if (o.lang) void client.setConfig({ lang: o.lang }).catch(() => {});
  }, [client, o.lang]);
  useEffect(() => {
    if (!client || first.current.outfit === wantOutfit) return;
    first.current.outfit = wantOutfit;
    // busy / unknown_id 会走 onError, 这里不重复处理; 旧用法 model="https://…" 仍走 setModel (受 allowCustomModel 约束)
    if (wantOutfit) void (isXcId(wantOutfit) ? client.setOutfit(wantOutfit) : client.setModel(wantOutfit)).catch(() => {});
  }, [client, wantOutfit]);
  // camera: 热更新 (创建时已随 URL 传入; 之后变化走 setConfig, 少写的项 = null 恢复默认; 立刻重新取景并取消进行中的推镜头)
  useEffect(() => {
    if (!client || first.current.camera === cameraKey) return;
    first.current.camera = cameraKey;
    const c = o.camera;
    void client.setConfig({ camera: { fov: c?.fov ?? null, distance: c?.distance ?? null, height: c?.height ?? null, intro: c?.intro ?? null } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, cameraKey]);
  useEffect(() => {
    if (!client || first.current.scene === o.scene) return;
    first.current.scene = o.scene;
    if (o.scene) void client.setScene(o.scene).catch(() => {});
  }, [client, o.scene]);
  // 尺寸 / 手势开关: 热更新, 不重建 iframe (缩放是运行时状态; 只有 props 里的值真的变了才调 setSize, 用户缩放后的尺寸不会被无关的重渲染覆盖)
  useEffect(() => {
    if (!client || (first.current.width === o.width && first.current.height === o.height)) return;
    first.current.width = o.width; first.current.height = o.height;
    client.setSize(o.width, o.height); // undefined = 默认 600x1080 (受视口限制)
  }, [client, o.width, o.height]);
  useEffect(() => { client?.setDraggable(o.draggable === true); }, [client, o.draggable]);
  useEffect(() => { client?.setBorderRadius(o.borderRadius); }, [client, o.borderRadius]);
  useEffect(() => { client?.setResizable(o.resizable ?? false); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, resizableKey]);
  useEffect(() => {
    if (!client || o.paused === undefined) return;
    if (o.paused) client.pause(); else client.resume();
  }, [client, o.paused]);
  const micWanted = useRef(o.mic);
  useEffect(() => {
    if (!client || o.mic === undefined || micWanted.current === o.mic) { micWanted.current = o.mic; return; }
    micWanted.current = o.mic;
    void client.mic(!!o.mic).catch(() => {});
  }, [client, o.mic]);

  const containerRef = useCallback((node: HTMLElement | null) => setEl(node), []);
  return { containerRef, client, ready, state };
}

/** ref 暴露的命令式句柄 (实例尚未创建 / 已销毁时, 返回 Promise 的方法会 reject)。 */
export interface XiaochunHandle {
  say(text: string, opts?: { mode?: 'speak' | 'chat' }): Promise<void>;
  /** 直接播放宿主给的音频 (不走 TTS), 同时由 EMAGE 生成动作 + 口型。 */
  speakAudio(source: XiaochunAudioSource, opts?: XiaochunAudioOptions): Promise<void>;
  speakAudioStream(opts: XiaochunAudioOptions & { sampleRate: number }): XiaochunAudioStream;
  motion(m: XcMotionPayload | string): Promise<void>;
  expression(name: XcExpressionPayload['name']): Promise<void>;
  /** TODO: 协议已预留, /embed 暂未实现 → reject unsupported。 */
  lookAt(x: number, y: number): Promise<void>;
  /** 换内置服装 (串行 + last-wins, 见 XiaochunInstance.setOutfit)。 */
  setOutfit(id: string): Promise<void>;
  setScene(id: string): Promise<void>;
  getOutfits(): Promise<XcOutfitInfo[]>;
  getScenes(): Promise<XcSceneInfo[]>;
  /** 清除 persistBox 保存的位置 / 大小; { reset: true } 同时还原到初始位置和大小。 */
  clearPersistedBox(opts?: { reset?: boolean }): void;
  /** 预取服装资源到 iframe 的 IndexedDB; ids 省略 = 全部 (婚纱除外)。 */
  prefetch(ids?: string[]): Promise<XcPrefetchedPayload>;
  /** 旧命令; 任意 URL 需 allowCustomModel。内置服装请用 setOutfit。 */
  setModel(m: string | { url?: string; outfit?: string; name?: string }): Promise<void>;
  setConfig(cfg: XcConfig): Promise<void>;
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  mic(enabled: boolean): Promise<void>;
  pause(): void;
  resume(): void;
  /** 改正在播的宿主音频倍速 (0.25~3)。见 XiaochunInstance.setPlaybackRate。 */
  setPlaybackRate(rate: number): void;
  /** 改宿主音频音量 (0~1)。见 XiaochunInstance.setVolume。 */
  setVolume(volume: number): void;
  activate(): void;
  destroy(): void;
  /** 模型加载完成时 resolve。 */
  readonly ready: Promise<void>;
  /** 底层 SDK 实例 (服务端 / 未挂载时 null)。 */
  readonly instance: XiaochunInstance | null;
}

export interface XiaochunProps extends XiaochunHookOptions {
  className?: string;
  /** 外层 div 的样式; width/height 由 props 决定 (固定尺寸, 防 CLS), 这里的同名字段会被覆盖。 */
  style?: CSSProperties;
}

const css = (v: number | string | undefined, d: string) => (v === undefined ? d : typeof v === 'number' ? `${v}px` : v);
const NOT_MOUNTED = () => new Error('[project-xiaochun] <Xiaochun /> is not mounted');

function XiaochunInner(props: XiaochunProps, ref: ForwardedRef<XiaochunHandle>): ReactElement {
  const { className, style, ...hookOptions } = props;
  const { containerRef, client } = useXiaochun(hookOptions);
  const clientRef = useRef<XiaochunInstance | null>(null);
  clientRef.current = client;

  useImperativeHandle(ref, () => {
    const c = () => clientRef.current;
    const reject = <T,>(): Promise<T> => Promise.reject(NOT_MOUNTED());
    return {
      say: (t, o) => c()?.say(t, o) ?? reject(),
      speakAudio: (s, o) => c()?.speakAudio(s, o) ?? reject(),
      speakAudioStream: (o) => { const x = c(); if (!x) throw NOT_MOUNTED(); return x.speakAudioStream(o); },
      motion: (m) => c()?.motion(m) ?? reject(),
      expression: (n) => c()?.expression(n) ?? reject(),
      lookAt: (x, y) => c()?.lookAt(x, y) ?? reject(),
      setOutfit: (id) => c()?.setOutfit(id) ?? reject(),
      setScene: (id) => c()?.setScene(id) ?? reject(),
      getOutfits: () => c()?.getOutfits() ?? reject(),
      getScenes: () => c()?.getScenes() ?? reject(),
      clearPersistedBox: (opts) => c()?.clearPersistedBox(opts),
      prefetch: (ids) => c()?.prefetch(ids) ?? reject(),
      setModel: (m) => c()?.setModel(m) ?? reject(),
      setConfig: (cfg) => c()?.setConfig(cfg) ?? reject(),
      startListening: () => c()?.startListening() ?? reject(),
      stopListening: () => c()?.stopListening() ?? reject(),
      mic: (e) => c()?.mic(e) ?? reject(),
      pause: () => c()?.pause(),
      resume: () => c()?.resume(),
      setPlaybackRate: (rate) => c()?.setPlaybackRate(rate),
      setVolume: (volume) => c()?.setVolume(volume),
      activate: () => c()?.activate(),
      destroy: () => c()?.destroy(),
      get ready() { return c()?.ready ?? reject<void>(); },
      get instance() { return c(); },
    };
  }, []);

  // 服务端与首帧客户端渲染完全一致 (hydration 安全): 固定尺寸的空 div
  const box: CSSProperties = {
    ...style,
    width: css(props.width, defaultWidthCss()),
    height: css(props.height, defaultHeightCss()),
    maxWidth: '100%',
    position: style?.position ?? 'relative',
  };
  return createElement('div', { ref: containerRef, className, style: box, 'data-xiaochun-host': '' });
}

/** `<Xiaochun />`: 在客户端创建小蠢 iframe; ref 暴露 say / speakAudio / motion / … 等命令式方法。 */
export const Xiaochun = forwardRef<XiaochunHandle, XiaochunProps>(XiaochunInner);
Xiaochun.displayName = 'Xiaochun';

export type { XiaochunOptions, XiaochunInstance, XiaochunAudioOptions, XiaochunAudioSource, XiaochunAudioStream } from './client';
