/**
 * avatar-element.ts — `<xiaochun-avatar>` Web Component (Shadow DOM 内包 iframe)。
 *
 * 属性: src model lang mic transparent draggable position size lazy paused placeholder heavy ui controls allowed-origins
 *   - 布尔属性: 缺省取默认值; "" / "true" = true; "false" = false。
 *   - size="320x480" 或 size="320" (高 = 宽 × 1.5); 也可写 CSS 长度 "100%x480px"。
 *   - model: 内置服装 key (xiaochun_maid) 或 https .vrm/.vrmaddon/.vrmbase URL。
 * 样式 (CSS 自定义属性, 可写在 <xiaochun-avatar> 上或任意祖先上; 取值范围/效果见 client.ts 里的注释与 docs/EMBED.md §样式):
 *   --xc-radius  --xc-shadow  --xc-z-index  --xc-offset-x  --xc-offset-y  --xc-bg
 * 可用 ::part() 定制外壳: ::part(mount) ::part(wrapper) ::part(iframe) ::part(placeholder)  (iframe 内部不可被宿主 CSS 影响)
 * 事件 (CustomEvent, composed, detail = 协议 payload): xc-ready(模型加载完) xc-progress xc-state xc-stt xc-utterance xc-error
 * 方法: say(text) speakAudio(source, opts) speakAudioStream(opts) motion(m) expression(name) destroy()  (+ client 属性拿到完整 SDK 实例)
 */
import {
  createXiaochun,
  type XiaochunAudioOptions,
  type XiaochunAudioSource,
  type XiaochunAudioStream,
  type XiaochunInstance,
  type XiaochunLazy,
  type XiaochunPosition,
} from './client';
import type { XcExpressionPayload, XcHeavyMode, XcLang, XcMotionPayload } from './protocol';

const OBSERVED = [
  'src', 'model', 'lang', 'mic', 'transparent', 'draggable', 'position', 'size', 'lazy',
  'paused', 'placeholder', 'heavy', 'ui', 'controls', 'allowed-origins',
] as const;
/** 改了这些要重建 iframe; 其余可以热更新。 */
const REBUILD = new Set(['src', 'draggable', 'position', 'size', 'lazy', 'placeholder', 'heavy', 'ui', 'controls', 'allowed-origins', 'transparent']);

function boolAttr(el: Element, name: string, dflt: boolean): boolean {
  const v = el.getAttribute(name);
  if (v === null) return dflt;
  return v !== 'false';
}

function parseSize(v: string | null): { width: string; height: string } {
  if (!v) return { width: '320px', height: '480px' };
  const m = v.trim().split(/x/i);
  const px = (s: string) => (/^\d+(\.\d+)?$/.test(s) ? `${s}px` : s);
  if (m.length >= 2) return { width: px(m[0]), height: px(m[1]) };
  const w = parseFloat(m[0]);
  return Number.isFinite(w) && /^\d+(\.\d+)?$/.test(m[0]) ? { width: `${w}px`, height: `${Math.round(w * 1.5)}px` } : { width: m[0], height: '480px' };
}

/** 公开类型 (类本身在浏览器里才创建, 这样 SSR / Node 下 import 本包不会因 HTMLElement 缺失而抛错)。 */
export interface XiaochunAvatarElement extends HTMLElement {
  client: XiaochunInstance | null;
  say(text: string, opts?: { mode?: 'speak' | 'chat' }): Promise<void>;
  /** 直接播放宿主给的音频 (不走 TTS), 同时由 EMAGE 生成动作 + 口型。 */
  speakAudio(source: XiaochunAudioSource, opts?: XiaochunAudioOptions): Promise<void>;
  speakAudioStream(opts: XiaochunAudioOptions & { sampleRate: number }): XiaochunAudioStream;
  motion(m: XcMotionPayload | string): Promise<void>;
  expression(name: XcExpressionPayload['name']): Promise<void>;
  destroy(): void;
}

function createElementClass(): CustomElementConstructor {
  class XiaochunAvatarElementImpl extends HTMLElement {
    static get observedAttributes() { return [...OBSERVED]; }

    /** 底层 SDK 实例 (连接 DOM 后可用)。 */
    client: XiaochunInstance | null = null;
    private mountEl: HTMLDivElement | null = null;
    private rebuildScheduled = false;

    connectedCallback(): void {
      if (!this.shadowRoot) {
        const root = this.attachShadow({ mode: 'open' });
        // :host 默认 inline-block + max-width:100% (配合 SDK 的固定宽高, 不会撑破窄屏容器)。
        // 悬浮 (position=bottom-right|bottom-left) 时 SDK 内部用 position:fixed, 不受 :host 盒模型影响。
        root.innerHTML = '<style>:host{display:inline-block;max-width:100%}:host([hidden]){display:none}</style><div part="mount"></div>';
      }
      this.mountEl = this.shadowRoot!.querySelector('div');
      this.build();
    }

    disconnectedCallback(): void {
      this.destroy();
    }

    attributeChangedCallback(name: string, oldV: string | null, newV: string | null): void {
      if (!this.client || oldV === newV) return;
      if (REBUILD.has(name)) {
        if (!this.rebuildScheduled) {
          this.rebuildScheduled = true;
          queueMicrotask(() => { this.rebuildScheduled = false; if (this.isConnected) { this.destroy(); this.build(); } });
        }
        return;
      }
      const c = this.client;
      if (name === 'model' && newV) void c.setModel(newV).catch(() => {});
      else if (name === 'lang' && newV) void c.setConfig({ lang: newV as XcLang }).catch(() => {});
      else if (name === 'mic') void c.mic(boolAttr(this, 'mic', false)).catch(() => {});
      else if (name === 'paused') { if (boolAttr(this, 'paused', false)) c.pause(); else c.resume(); }
    }

    private build(): void {
      if (!this.mountEl || this.client) return;
      const { width, height } = parseSize(this.getAttribute('size'));
      const placeholder = this.getAttribute('placeholder');
      const allowed = this.getAttribute('allowed-origins');
      const lazyAttr = this.getAttribute('lazy');
      const lazy: XiaochunLazy = lazyAttr === 'click' ? 'click' : lazyAttr === 'false' ? false : true;
      const c = createXiaochun({
        container: this.mountEl,
        src: this.getAttribute('src') || undefined,
        allowedOrigins: allowed ? allowed.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        lazy,
        placeholder: placeholder === 'none' ? false : placeholder || undefined,
        transparent: boolAttr(this, 'transparent', true), // 悬浮头像默认透明
        width, height,
        position: (this.getAttribute('position') as XiaochunPosition | null) ?? 'inline',
        draggable: boolAttr(this, 'draggable', false),
        lang: (this.getAttribute('lang') as XcLang | null) ?? undefined,
        model: this.getAttribute('model') ?? undefined,
        heavy: (this.getAttribute('heavy') as XcHeavyMode | null) ?? undefined,
        ui: boolAttr(this, 'ui', false),
        controls: boolAttr(this, 'controls', false),
      });
      this.client = c;
      const fwd = (ev: string, name: string) => c.on(ev as 'ready', (detail) =>
        this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })));
      fwd('ready', 'xc-ready');
      fwd('progress', 'xc-progress');
      fwd('state', 'xc-state');
      fwd('stt', 'xc-stt');
      fwd('utterance', 'xc-utterance');
      fwd('error', 'xc-error');
      if (boolAttr(this, 'paused', false)) c.pause();
      if (boolAttr(this, 'mic', false)) void c.ready.then(() => c.mic(true)).catch(() => {});
    }

    say(text: string, opts?: { mode?: 'speak' | 'chat' }): Promise<void> {
      return this.requireClient().say(text, opts);
    }
    speakAudio(source: XiaochunAudioSource, opts?: XiaochunAudioOptions): Promise<void> {
      return this.requireClient().speakAudio(source, opts);
    }
    speakAudioStream(opts: XiaochunAudioOptions & { sampleRate: number }): XiaochunAudioStream {
      return this.requireClient().speakAudioStream(opts);
    }
    motion(m: XcMotionPayload | string): Promise<void> { return this.requireClient().motion(m); }
    expression(name: XcExpressionPayload['name']): Promise<void> { return this.requireClient().expression(name); }

    destroy(): void {
      this.client?.destroy();
      this.client = null;
    }

    private requireClient(): XiaochunInstance {
      if (!this.client) throw new Error('<xiaochun-avatar> is not connected');
      return this.client;
    }
  }

  return XiaochunAvatarElementImpl;
}

export const XIAOCHUN_ELEMENT_TAG = 'xiaochun-avatar';

/** 注册自定义元素 (幂等)。import '@firetable/project-xiaochun/element' 会自动调用。 */
export function defineXiaochunElement(tag: string = XIAOCHUN_ELEMENT_TAG): CustomElementConstructor | null {
  if (typeof customElements === 'undefined' || typeof HTMLElement === 'undefined') return null;
  const existing = customElements.get(tag);
  if (existing) return existing;
  const ctor = createElementClass();
  customElements.define(tag, ctor);
  return ctor;
}
