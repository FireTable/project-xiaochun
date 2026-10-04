/**
 * embed/params.ts — /embed URL 参数解析 (SSR 安全, 无副作用)。
 *
 *   ?transparent=1   透明背景 (叠在宿主页面上)          默认 0
 *   ?ui=chat,bubble,outfit,scene  要显示的内置界面部件 (逗号分隔, 白名单; 未知项忽略并 warn)   默认空 = 无 chrome
 *        chat=聊天栏 bubble=头顶气泡 outfit=换装按钮 scene=换场景按钮
 *        已弃用的旧写法: ?ui=1|true (= chat,bubble, 会 warn)、?bubble=0|1 (单独开关气泡)
 *   ?uiAutoHide=transparent|1|0  内置界面 (ui 里的按钮 + 聊天栏) 的显示策略: transparent(默认) = 与 Tauri 一致, 只在透明场景点击出现、亮/暗常显; 1 = 所有场景点击出现; 0 = 一直显示
 *   ?lang=zh-CN|en|ja                                    默认: iframe 自己 localStorage 里记住的用户选择 > 浏览器语言 > zh-CN (显式 ?lang= 最优先)
 *   ?cameraFov=<15..60> ?cameraDistance=<1..15> ?cameraHeight=<-1..1> ?cameraIntro=0|1  相机: 视野角(度) / 视距(米) / 取景高度偏移(米) / 是否播推镜头
 *        缺省 = 不覆盖 (走 iframe 保存值 / 默认); 越界夹到范围并 warn, 非法值忽略并 warn
 *   ?heavy=lazy|eager  WebLLM / EMAGE 预热策略          默认 lazy
 *   ?outfit=<id>     初始服装 (capabilities.outfits 里的 id, 严格校验: 小写字母/数字/下划线, 且必须是内置服装; 裸模 base 不开放)
 *                    非法或未知 → 回退默认服装并通过 xc.error{unknown_id} 告知宿主     默认 default addon
 *   ?scene=light|dark|transparent|beach  初始场景 (优先于 ?transparent / ?theme; 非法 → 忽略)   默认跟随 ?transparent / 系统
 *   ?theme=light|dark  非透明时的线稿主题                默认跟随系统
 *   ?controls=0      锁定滚轮缩放 (默认开, 与主站一致: 透明场景只在指针落在角色上时缩放, 其余穿透给宿主;
 *                    不透明场景整个 iframe 区域的滚轮 = 缩放, 会吞掉该区域的页面滚动)。controls=1 与缺省等价
 *   ?host=<origin>   宿主页 origin (SDK 自动带上; 手写 iframe 必须自己加)
 *   ?allow=<o1,o2>   额外允许握手的宿主 origin (逗号分隔, 不支持 '*')
 */
import { parseControls } from './registry';
import { isLang, type Lang } from '@/i18n';
import { XC_UI_AUTOHIDE_DEFAULT, normalizeOrigin, parseXcCameraParams, parseXcUiAutoHide, parseXcUiParam, type XcCamera, type XcHeavyMode, type XcUiAutoHide, type XcUiPart } from '@firetable/project-xiaochun/protocol';

export interface EmbedParams {
  transparent: boolean;
  /** 要显示的内置界面部件 (已白名单校验)。 */
  uiParts: XcUiPart[];
  /** 用了弃用写法 ?ui=1 / true / ?bubble=。 */
  uiLegacy: boolean;
  /** ?ui= 里被忽略的未知部件名。 */
  uiUnknown: string[];
  /** 内置界面显示策略 (缺省 'transparent' = 与 Tauri 一致)。 */
  uiAutoHide: XcUiAutoHide;
  lang: Lang | null;
  /** ?cameraFov / cameraDistance / cameraHeight / cameraIntro (已校验 / 夹范围; 只含显式给出的项)。 */
  camera: XcCamera;
  /** 相机参数的告警 (非法 / 越界), 由 EmbedApp 打到 console。 */
  cameraWarnings: string[];
  heavy: XcHeavyMode;
  /** 原样的 ?outfit= (未校验; 校验在 registry.resolveInitialOutfit / bridge 里统一做)。 */
  outfit: string | null;
  /** 原样的 ?scene= (未校验; 校验在 sceneManager 里统一做)。 */
  scene: string | null;
  controls: boolean;
  /** 已规整的宿主 origin 白名单 (host + allow); 空 = 无法握手 (fail closed)。 */
  allowedHostOrigins: string[];
}

export function readEmbedParams(search?: string): EmbedParams {
  const q = new URLSearchParams(
    search ?? (typeof window !== 'undefined' ? window.location.search : ''),
  );
  const uiParse = parseXcUiParam(q.get('ui'));
  const uiSet = new Set<XcUiPart>(uiParse.parts);
  let uiLegacy = uiParse.legacy;
  if (q.has('bubble')) { // 弃用: 单独开关气泡 (旧行为: 缺省跟随 ui)
    uiLegacy = true;
    if (q.get('bubble') === '1') uiSet.add('bubble'); else uiSet.delete('bubble');
  }
  const lang = q.get('lang');
  const cam = parseXcCameraParams((n) => q.get(n));
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
    uiParts: [...uiSet],
    uiLegacy,
    uiUnknown: uiParse.unknown,
    uiAutoHide: parseXcUiAutoHide(q.get('uiAutoHide')) ?? XC_UI_AUTOHIDE_DEFAULT,
    lang: isLang(lang) ? lang : null,
    camera: cam.camera,
    cameraWarnings: cam.warnings,
    heavy: q.get('heavy') === 'eager' ? 'eager' : 'lazy',
    outfit: q.get('outfit'),
    scene: q.get('scene'),
    controls: parseControls(q.get('controls')),
    allowedHostOrigins: [...origins],
  };
}
