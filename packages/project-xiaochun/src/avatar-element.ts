/**
 * avatar-element.ts — `<xiaochun-avatar>` Web Component (Shadow DOM 内包 iframe)。
 *
 * 属性: src outfit scene model(deprecated) lang mic transparent draggable resizable min-size max-size border-radius position size lazy paused placeholder heavy ui ui-autohide controls allowed-origins cross-origin-isolated persist allow-custom-model
 *   - 布尔属性: 缺省取默认值; "" / "true" = true; "false" = false。
 *   - size="320x480" 或 size="320" (高 = 宽 × 1.5); 也可写 CSS 长度 "100%x480px"。缺省 = 600x1080 (宽不超过容器、高不超过视口)。改 size **热更新** (setSize, 不重建 iframe)。
 *   - draggable: 手势拖动 (角色上按住拖, 内联 / 悬浮都行); resizable: 四角缩放热区 (对角固定, 不重建 iframe); 两者默认关, 改属性热更新。
 *     min-size / max-size="120x180": resizable 的最小 / 最大尺寸 (px, 缺省最小 120x180、最大只受视口限制)。
 *   - border-radius: 外壳圆角 (数字 = px 或 CSS 长度); 缺省: 非透明场景 20px (与 Tauri 桌宠窗口同值) / 透明 0; 改属性热更新 (setBorderRadius)。
 *   - outfit: 内置服装 id (xiaochun_maid); 改属性**热更新** (setOutfit, 不重建 iframe)。model 是 outfit 的旧别名 (deprecated)。
 *   - scene: light | dark | transparent | beach3d; 改属性**热更新** (setScene, 不重建 iframe)。
 *   - ui: 要显示的 iframe 内置界面部件, 逗号分隔: chat,bubble,outfit,scene,lang,github (例 ui="outfit,scene,lang,github"); 缺省 = 都不显示; 改它会重建。
 *     旧写法 ui / ui="true" 已弃用 (= chat,bubble, 会 console.warn)。
 *   - ui-autohide: 内置界面的显示策略: 缺省 / "transparent" = 与 Tauri 一致 (只在透明场景点击出现, 亮暗场景常显); "true" = 所有场景点击出现; "false" = 一直显示。改它会重建。
 *   - persist-box: 记住用户拖动 / 缩放后的位置和大小 (宿主 localStorage): "" / "true" = 默认 key, 其它字符串 = 命名空间 (xiaochun:box:<名字>); 需配合 draggable / resizable; 显式 size 优先于已保存的大小。改它会重建。
 *   - persist: "host" 或自定义 localStorage key; 另把服装/场景偏好存在宿主页 (可选; 默认不存, iframe 自己的 localStorage 仍会记住)。
 *   - prefetch: "" / "true" = 预取全部内置服装 (婚纱除外), 或逗号分隔的 id 列表; 只在 heavy="eager" 时自动触发 (默认关)。
 *   - allow-custom-model: 允许 setModel({url}) 加载任意 https 模型 (默认关闭)。
 * 样式 (CSS 自定义属性, 可写在 <xiaochun-avatar> 上或任意祖先上; 取值范围/效果见 client.ts 里的注释与 docs/EMBED.md §样式):
 *   --xc-radius  --xc-shadow  --xc-z-index  --xc-offset-x  --xc-offset-y  --xc-bg
 * 可用 ::part() 定制外壳: ::part(mount) ::part(wrapper) ::part(iframe) ::part(placeholder)  (iframe 内部不可被宿主 CSS 影响)
 * 事件 (CustomEvent, composed, detail = 协议 payload): xc-ready(模型加载完) xc-progress xc-state xc-stt xc-utterance xc-error xc-outfit-changed xc-scene-changed xc-lang-changed
 *   xc-move / xc-resize (用户拖动 / 缩放, detail = {phase, left, top, width, height})
 * 方法: say(text) speakAudio(source, opts) speakAudioStream(opts) setPlaybackRate(rate) setVolume(volume) motion(m) expression(name) setOutfit(id) setScene(id) getOutfits() getScenes() destroy()  (+ client 属性拿到完整 SDK 实例)
 */
import {
  createXiaochun,
  type XiaochunAudioOptions,
  type XiaochunAudioSource,
  type XiaochunAudioStream,
  type XiaochunInstance,
  type XiaochunLazy,
  type XiaochunPosition,
  type XiaochunResizeLimits,
} from './client';
import { isXcId, parseXcUiAutoHide } from './protocol';
import type { XcCamera, XcUiPart, XcExpressionPayload, XcHeavyMode, XcLang, XcMotionPayload, XcOutfitInfo, XcPrefetchedPayload, XcSceneInfo } from './protocol';

const OBSERVED = [
  'src', 'outfit', 'scene', 'model', 'lang', 'mic', 'transparent', 'draggable', 'resizable', 'min-size', 'max-size', 'border-radius', 'position', 'size', 'lazy',
  'paused', 'placeholder', 'heavy', 'ui', 'ui-autohide', 'camera-fov', 'camera-distance', 'camera-height', 'camera-intro', 'controls', 'allowed-origins', 'cross-origin-isolated', 'persist', 'persist-box', 'allow-custom-model', 'prefetch',
] as const;
/** 改了这些要重建 iframe; 其余 (outfit / scene / model / lang / mic / paused / size / draggable / resizable / min-size / max-size / border-radius / camera-*) 可以热更新。 */
const REBUILD = new Set(['src', 'position', 'lazy', 'placeholder', 'heavy', 'ui', 'ui-autohide', 'controls', 'allowed-origins', 'transparent', 'cross-origin-isolated', 'persist', 'persist-box', 'allow-custom-model', 'prefetch']);

/** border-radius 属性: 纯数字 = px, 其余当 CSS 长度; 缺省 = undefined (走 SDK 默认: 非透明 20px / 透明 0)。 */
function radiusAttr(v: string | null): number | string | undefined {
  if (v === null || v.trim() === '') return undefined;
  const t = v.trim();
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}

function boolAttr(el: Element, name: string, dflt: boolean): boolean {
  const v = el.getAttribute(name);
  if (v === null) return dflt;
  return v !== 'false';
}

/** prefetch 属性: 缺省/false = 关; "" / "true" = 全部 (婚纱除外); 其它 = 逗号分隔的 id 列表。 */
function prefetchAttr(v: string | null): boolean | string[] {
  if (v === null || v === 'false') return false;
  if (v === '' || v === 'true') return true;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/** persist-box 属性: "" / "true" → true; "false" / 缺省 → 不记; 其它字符串 = 命名空间。 */
function persistBoxAttr(v: string | null): boolean | string | undefined {
  if (v === null || v === 'false' || v === '0') return undefined;
  if (v === '' || v === 'true' || v === '1') return true;
  return v;
}

/** ui 属性: 缺省 / "false" / "0" = 不显示; 逗号分隔的部件名 (chat,bubble,outfit,scene,lang,github); "" / "true" / "1" = 弃用的旧写法 (client 里 warn)。 */
function uiAttr(v: string | null): XcUiPart[] | boolean | undefined {
  if (v === null || v === 'false' || v === '0') return undefined;
  if (v === '' || v === 'true' || v === '1') return true;
  return v.split(',').map((s) => s.trim()).filter(Boolean) as XcUiPart[];
}

/** camera-fov / camera-distance / camera-height / camera-intro 属性 → XcCamera; 没写 / 非法的项 = null (创建时忽略, 热更新时 = 恢复默认)。 */
function cameraAttrs(el: Element): XcCamera {
  const num = (name: string): number | null => {
    const v = el.getAttribute(name);
    if (v === null || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const i = el.getAttribute('camera-intro');
  return { fov: num('camera-fov'), distance: num('camera-distance'), height: num('camera-height'), intro: i === null ? null : i !== 'false' && i !== '0' };
}

/** "120x180" → {w,h} (px 数字); 非法 → undefined。 */
function parsePx(v: string | null): { w: number; h: number } | undefined {
  const m = v?.trim().match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : undefined;
}

/** size 属性 → 宽高; 没写的维度返回 undefined = 用 SDK 默认 (600x1080, 受视口限制)。 */
function parseSize(v: string | null): { width: string | undefined; height: string | undefined } {
  if (!v) return { width: undefined, height: undefined };
  const m = v.trim().split(/x/i);
  const px = (s: string) => (/^\d+(\.\d+)?$/.test(s) ? `${s}px` : s);
  if (m.length >= 2) return { width: px(m[0]), height: px(m[1]) };
  const w = parseFloat(m[0]);
  return Number.isFinite(w) && /^\d+(\.\d+)?$/.test(m[0]) ? { width: `${w}px`, height: `${Math.round(w * 1.5)}px` } : { width: m[0], height: undefined };
}

/** 公开类型 (类本身在浏览器里才创建, 这样 SSR / Node 下 import 本包不会因 HTMLElement 缺失而抛错)。 */
export interface XiaochunAvatarElement extends HTMLElement {
  client: XiaochunInstance | null;
  say(text: string, opts?: { mode?: 'speak' | 'chat' }): Promise<void>;
  /** 直接播放宿主给的音频 (不走 TTS), 同时由 EMAGE 生成动作 + 口型。 */
  speakAudio(source: XiaochunAudioSource, opts?: XiaochunAudioOptions): Promise<void>;
  speakAudioStream(opts: XiaochunAudioOptions & { sampleRate: number }): XiaochunAudioStream;
  setPlaybackRate(rate: number): void;
  setVolume(volume: number): void;
  motion(m: XcMotionPayload | string): Promise<void>;
  expression(name: XcExpressionPayload['name']): Promise<void>;
  /** 换内置服装 (串行 + last-wins, 见 XiaochunInstance.setOutfit)。 */
  setOutfit(id: string): Promise<void>;
  setScene(id: string): Promise<void>;
  getOutfits(): Promise<XcOutfitInfo[]>;
  getScenes(): Promise<XcSceneInfo[]>;
  /** 清除 persist-box 保存的位置 / 大小; { reset: true } 同时还原到初始位置和大小。 */
  clearPersistedBox(opts?: { reset?: boolean }): void;
  /** 预取服装资源到 iframe 的 IndexedDB; ids 省略 = 全部 (婚纱除外)。 */
  prefetch(ids?: string[]): Promise<XcPrefetchedPayload>;
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
      // 热更新: 失败 (busy / unknown_id / unsupported) 都会作为 xc-error 事件抛给宿主, 这里不重复处理
      if ((name === 'outfit' || name === 'model') && newV) {
        // outfit 与 model(旧别名) 同时存在时 outfit 优先
        const want = name === 'model' && this.hasAttribute('outfit') ? null : newV;
        if (want) void (isXcId(want) ? c.setOutfit(want) : c.setModel(want)).catch(() => {}); // 旧用法 model="https://…" 仍走 setModel
      }
      else if (name === 'scene' && newV) void c.setScene(newV).catch(() => {});
      else if (name === 'lang' && newV) void c.setConfig({ lang: newV as XcLang }).catch(() => {});
      else if (name === 'size') { const { width, height } = parseSize(newV); c.setSize(width, height); }
      else if (name === 'border-radius') c.setBorderRadius(radiusAttr(newV));
      else if (name === 'draggable') c.setDraggable(boolAttr(this, 'draggable', false));
      else if (name === 'resizable' || name === 'min-size' || name === 'max-size') c.setResizable(this.resizableOption());
      else if (name.startsWith('camera-')) void c.setConfig({ camera: cameraAttrs(this) }).catch(() => {});
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
        resizable: this.resizableOption(),
        borderRadius: radiusAttr(this.getAttribute('border-radius')),
        lang: (this.getAttribute('lang') as XcLang | null) ?? undefined,
        outfit: this.getAttribute('outfit') ?? this.getAttribute('model') ?? undefined,
        scene: this.getAttribute('scene') ?? undefined,
        persist: this.getAttribute('persist') || undefined,
        persistBox: persistBoxAttr(this.getAttribute('persist-box')),
        allowCustomModel: boolAttr(this, 'allow-custom-model', false),
        prefetch: prefetchAttr(this.getAttribute('prefetch')),
        heavy: (this.getAttribute('heavy') as XcHeavyMode | null) ?? undefined,
        ui: uiAttr(this.getAttribute('ui')),
        uiAutoHide: parseXcUiAutoHide(this.getAttribute('ui-autohide')),
        camera: cameraAttrs(this),
        controls: boolAttr(this, 'controls', true),
        crossOriginIsolated: boolAttr(this, 'cross-origin-isolated', false),
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
      fwd('outfit-changed', 'xc-outfit-changed');
      fwd('scene-changed', 'xc-scene-changed');
      fwd('lang-changed', 'xc-lang-changed');
      fwd('move', 'xc-move');
      fwd('resize', 'xc-resize');
      if (boolAttr(this, 'paused', false)) c.pause();
      if (boolAttr(this, 'mic', false)) void c.ready.then(() => c.mic(true)).catch(() => {});
    }

    /** resizable / min-size / max-size 属性 → SDK 的 resizable 选项 (缺省 / "false" = 关)。 */
    private resizableOption(): false | XiaochunResizeLimits {
      if (!boolAttr(this, 'resizable', false)) return false;
      const min = parsePx(this.getAttribute('min-size')), max = parsePx(this.getAttribute('max-size'));
      return { minWidth: min?.w, minHeight: min?.h, maxWidth: max?.w, maxHeight: max?.h };
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
    setPlaybackRate(rate: number): void { this.client?.setPlaybackRate(rate); }
    setVolume(volume: number): void { this.client?.setVolume(volume); }
    motion(m: XcMotionPayload | string): Promise<void> { return this.requireClient().motion(m); }
    expression(name: XcExpressionPayload['name']): Promise<void> { return this.requireClient().expression(name); }
    setOutfit(id: string): Promise<void> { return this.requireClient().setOutfit(id); }
    setScene(id: string): Promise<void> { return this.requireClient().setScene(id); }
    getOutfits(): Promise<XcOutfitInfo[]> { return this.requireClient().getOutfits(); }
    getScenes(): Promise<XcSceneInfo[]> { return this.requireClient().getScenes(); }
    clearPersistedBox(opts?: { reset?: boolean }): void { this.client?.clearPersistedBox(opts); }
    prefetch(ids?: string[]): Promise<XcPrefetchedPayload> { return this.requireClient().prefetch(ids); }

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
