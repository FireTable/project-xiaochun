/**
 * embed/params.ts — /embed URL 参数解析 (SSR 安全, 无副作用)。
 *
 *   ?transparent=1   透明背景 (叠在宿主页面上)          默认 0
 *   ?ui=1            显示 ChatBar 等内置 UI              默认 0 (无 chrome)
 *   ?bubble=1        显示头顶气泡 (说话文本)             默认跟随 ui
 *   ?lang=zh-CN|en|ja                                    默认跟随 cookie/默认语言
 *   ?heavy=lazy|eager  WebLLM / EMAGE 预热策略          默认 lazy
 *   ?outfit=<addonKey> 初始服装 (APP_CONFIG.model.addons) 默认 default addon
 *   ?theme=light|dark  非透明时的线稿主题                默认跟随系统
 *   ?controls=1      放开滚轮缩放 (默认锁, 防止吞宿主滚动)
 *   ?host=<origin>   宿主页 origin (SDK 自动带上; 手写 iframe 必须自己加)
 *   ?allow=<o1,o2>   额外允许握手的宿主 origin (逗号分隔, 不支持 '*')
 */
import { isLang, type Lang } from '@/i18n';
import { normalizeOrigin, type XcHeavyMode } from '@firetable/project-xiaochun/protocol';

export interface EmbedParams {
  transparent: boolean;
  ui: boolean;
  bubble: boolean;
  lang: Lang | null;
  heavy: XcHeavyMode;
  outfit: string | null;
  controls: boolean;
  /** 已规整的宿主 origin 白名单 (host + allow); 空 = 无法握手 (fail closed)。 */
  allowedHostOrigins: string[];
}

export function readEmbedParams(search?: string): EmbedParams {
  const q = new URLSearchParams(
    search ?? (typeof window !== 'undefined' ? window.location.search : ''),
  );
  const ui = q.get('ui') === '1';
  const lang = q.get('lang');
  const origins = new Set<string>();

  const host = normalizeOrigin(q.get('host'));
  if (host) origins.add(host);
  for (const raw of (q.get('allow') ?? '').split(',')) {
    const o = normalizeOrigin(raw.trim());
    if (o) origins.add(o);
  }
  // 兜底: 浏览器自己报告的祖先 origin (Chromium/Safari 有; Firefox 无)。
  // 只作为"declared host 缺失"时的候选, 且仍需 event.origin 与其一致才放行。
  if (origins.size === 0 && typeof window !== 'undefined') {
    const anc = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    const top = normalizeOrigin(anc?.[0]);
    if (top) origins.add(top);
    else {
      try {
        const ref = normalizeOrigin(document.referrer);
        if (ref) origins.add(ref);
      } catch { /* ignore */ }
    }
  }

  return {
    transparent: q.get('transparent') === '1',
    ui,
    bubble: q.has('bubble') ? q.get('bubble') === '1' : ui,
    lang: isLang(lang) ? lang : null,
    heavy: q.get('heavy') === 'eager' ? 'eager' : 'lazy',
    outfit: q.get('outfit'),
    controls: q.get('controls') === '1',
    allowedHostOrigins: [...origins],
  };
}
