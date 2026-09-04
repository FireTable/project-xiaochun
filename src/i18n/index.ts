/**
 * i18n bootstrap — 每语言独立 .ts 文件,这里统一注册到 i18next。
 * ponytail: 加新语言 = 新建 <code>.ts`,把字面量填上 → `Trans` 类型不匹配 TS 立刻报错。
 */
import i18next, { type i18n as I18nInstance, type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { zhCN } from './zh-CN';
import { en } from './en';
import { ja } from './ja';

export type { Trans } from './zh-CN';

export type Lang = 'zh-CN' | 'en' | 'ja';
export const SUPPORTED_LANGS: readonly Lang[] = ['zh-CN', 'en', 'ja'] as const;
export const DEFAULT_LANG: Lang = 'zh-CN';
export const LANG_COOKIE = 'lang';

export const RESOURCES: Resource = {
  'zh-CN': { translation: zhCN },
  en: { translation: en },
  ja: { translation: ja },
};

/** ponytail: 语言菜单里显示的母语名 — 跨语言不变,所以放这里而不是 translations 里。 */
export const LANG_LABELS: Record<Lang, string> = {
  'zh-CN': '中文',
  en: 'English',
  ja: '日本語',
};

const NS = 'translation';
const liveInstances = new Set<I18nInstance>();

function putBundles(
  inst: I18nInstance,
  bundles: { 'zh-CN': typeof zhCN; en: typeof en; ja: typeof ja },
) {
  inst.addResourceBundle('zh-CN', NS, bundles['zh-CN'], true, true);
  inst.addResourceBundle('en', NS, bundles.en, true, true);
  inst.addResourceBundle('ja', NS, bundles.ja, true, true);
}

export function isLang(value: string | null | undefined): value is Lang {
  return !!value && (SUPPORTED_LANGS as readonly string[]).includes(value);
}

export function resolveLang(raw: string | null | undefined): Lang {
  return isLang(raw) ? raw : DEFAULT_LANG;
}

/**
 * 服务端用:从请求头解析语言 (cookie 优先,Accept-Language 兜底)。
 * 在 SSR RootDocument 内同步调用,结果用来初始化 i18n 实例。
 */
export function detectLangFromHeaders(
  cookieHeader: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Lang {
  if (cookieHeader) {
    const match = cookieHeader
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${LANG_COOKIE}=`));
    if (match) return resolveLang(decodeURIComponent(match.slice(LANG_COOKIE.length + 1)));
  }
  if (acceptLanguage) {
    // ponytail: 简单包含判断,够用;升级到 q-value 排序时再说。
    if (acceptLanguage.includes('ja')) return 'ja';
    if (acceptLanguage.includes('zh')) return 'zh-CN';
    if (acceptLanguage.includes('en')) return 'en';
  }
  return DEFAULT_LANG;
}

/**
 * 客户端用:从 document.cookie 取 lang。
 */
export function readClientLang(): Lang {
  if (typeof document === 'undefined') return DEFAULT_LANG;
  const match = document.cookie
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${LANG_COOKIE}=`));
  if (!match) return DEFAULT_LANG;
  return resolveLang(decodeURIComponent(match.slice(LANG_COOKIE.length + 1)));
}

/**
 * 创建一个全新的 i18n 实例。SSR / CSR 各自调一次,资源完全一致 → 无 hydration mismatch。
 */
export function createI18n(lang: Lang): I18nInstance {
  const inst = i18next.createInstance();
  inst.use(initReactI18next).init({
    lng: lang,
    fallbackLng: DEFAULT_LANG,
    ns: [NS],
    defaultNS: NS,
    resources: RESOURCES,
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });
  liveInstances.add(inst);
  return inst;
}

if (import.meta.hot) {
  import.meta.hot.accept(['./zh-CN', './en', './ja'], (mods) => {
    const nextZh = mods?.[0]?.zhCN as typeof zhCN | undefined;
    const nextEn = mods?.[1]?.en as typeof en | undefined;
    const nextJa = mods?.[2]?.ja as typeof ja | undefined;
    if (!nextZh || !nextEn || !nextJa) return;
    for (const inst of liveInstances) {
      putBundles(inst, { 'zh-CN': nextZh, en: nextEn, ja: nextJa });
      void inst.changeLanguage(inst.language);
    }
  });
}

/**
 * 客户端运行时切语言,顺便写 cookie 让下次 SSR 跟上。
 */
export function changeLang(inst: I18nInstance, next: Lang) {
  if (!isLang(next)) return;
  inst.changeLanguage(next);
  if (typeof document !== 'undefined') {
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
  }
}
