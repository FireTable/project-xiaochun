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
 *   - 创建期选项 (src/lazy/width/…) 变化会重建实例; lang / model / paused / mic 变化则热更新 (不重建 iframe)。
 */
import { createElement, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, ForwardedRef, ReactElement } from 'react';
import { createXiaochun } from './client';
import type {
  XiaochunAudioOptions,
  XiaochunAudioSource,
  XiaochunAudioStream,
  XiaochunEvents,
  XiaochunInstance,
  XiaochunOptions,
} from './client';
import type { XcConfig, XcExpressionPayload, XcMotionPayload, XcStatePayload } from './protocol';

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
  onError?: (p: XiaochunEvents['error']) => void;
  onDestroy?: () => void;
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
  ['error', 'onError'],
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
    const { onHandshake: _a, onReady: _b, onProgress: _c, onState: _d, onStt: _e, onUtterance: _f, onHitRegion: _g, onError: _h, onDestroy: _i, paused: _p, mic: _m, allowedOrigins, ...create } = cur;
    void [_a, _b, _c, _d, _e, _f, _g, _h, _i, _p, _m];
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
    // 只有"创建期选项"变化才重建; lang/model/paused/mic/回调走下面的热更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, o.src, o.origin, originsKey, o.lazy, o.lazyMargin, o.placeholder, o.transparent, o.width, o.height, o.position,
    o.draggable, o.ui, o.heavy, o.controls, o.autoPause, o.passthrough, o.sandbox, o.handshakeTimeout, o.zIndex]);

  // 热更新: lang / model (跳过首次: 创建时已经作为初始选项传入)
  const first = useRef({ lang: o.lang, model: o.model });
  useEffect(() => {
    if (!client || first.current.lang === o.lang) return;
    first.current.lang = o.lang;
    if (o.lang) void client.setConfig({ lang: o.lang }).catch(() => {});
  }, [client, o.lang]);
  useEffect(() => {
    if (!client || first.current.model === o.model) return;
    first.current.model = o.model;
    if (o.model) void client.setModel(o.model).catch(() => {});
  }, [client, o.model]);
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
  setModel(m: string | { url?: string; outfit?: string; name?: string }): Promise<void>;
  setConfig(cfg: XcConfig): Promise<void>;
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  mic(enabled: boolean): Promise<void>;
  pause(): void;
  resume(): void;
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
      setModel: (m) => c()?.setModel(m) ?? reject(),
      setConfig: (cfg) => c()?.setConfig(cfg) ?? reject(),
      startListening: () => c()?.startListening() ?? reject(),
      stopListening: () => c()?.stopListening() ?? reject(),
      mic: (e) => c()?.mic(e) ?? reject(),
      pause: () => c()?.pause(),
      resume: () => c()?.resume(),
      activate: () => c()?.activate(),
      destroy: () => c()?.destroy(),
      get ready() { return c()?.ready ?? reject<void>(); },
      get instance() { return c(); },
    };
  }, []);

  // 服务端与首帧客户端渲染完全一致 (hydration 安全): 固定尺寸的空 div
  const box: CSSProperties = {
    ...style,
    width: css(props.width, '320px'),
    height: css(props.height, '480px'),
    maxWidth: '100%',
    position: style?.position ?? 'relative',
  };
  return createElement('div', { ref: containerRef, className, style: box, 'data-xiaochun-host': '' });
}

/** `<Xiaochun />`: 在客户端创建小蠢 iframe; ref 暴露 say / speakAudio / motion / … 等命令式方法。 */
export const Xiaochun = forwardRef<XiaochunHandle, XiaochunProps>(XiaochunInner);
Xiaochun.displayName = 'Xiaochun';

export type { XiaochunOptions, XiaochunInstance, XiaochunAudioOptions, XiaochunAudioSource, XiaochunAudioStream } from './client';
