/**
 * embed/registry.ts — 服装 / 场景 id 的查表与校验 (纯函数, 无 DOM / 无 three 依赖, 可直接用 node --test 跑)。
 *
 * 为什么单独成文件:
 *   原先 `p.outfit in addons` / `addons[params.outfit]` / `theme in scenes.items` 都走原型链,
 *   `?outfit=constructor`、`xc.setModel{outfit:'toString'}` 会命中 Object.prototype 上的函数, 然后 `.source` 为 undefined 才在更深处炸掉。
 *   现在所有入口统一: 先过 isXcId 正则 (挡掉 `__proto__` 等), 再 hasOwnProperty (挡掉 `constructor` 等), 命中才返回条目。
 */
import { isXcId, xcHasOwn } from '../../packages/project-xiaochun/src/protocol.ts';
import { XC_LANGS } from '../../packages/project-xiaochun/src/protocol.ts';
import type { XcLang, XcOutfitInfo, XcSceneInfo } from '../../packages/project-xiaochun/src/protocol.ts';

export interface AddonLike {
  source: string;
  name: string;
  default?: boolean;
}

export interface SceneLike {
  isTransparent?: boolean;
}

/** 自己的、且 id 格式合法的条目; 否则 null。 */
export function ownEntry<T>(registry: Readonly<Record<string, T>>, id: unknown): T | null {
  if (!isXcId(id)) return null;
  return xcHasOwn(registry, id) ? registry[id] : null;
}

/** 未指定 / 非法时用的默认服装 id (配置里 default:true 的那个; 没有则取第一个)。裸模 base 永远不会被返回。 */
export function defaultOutfitId(addons: Readonly<Record<string, AddonLike>>): string | null {
  const keys = Object.keys(addons);
  return keys.find((k) => addons[k].default) ?? keys[0] ?? null;
}

/** 解析初始服装: 请求的 id 合法就用它, 否则回退默认。 */
export function resolveInitialOutfit(
  addons: Readonly<Record<string, AddonLike>>,
  requested: unknown,
): { id: string; entry: AddonLike } | null {
  const hit = requested == null ? null : ownEntry(addons, requested);
  if (hit && isXcId(requested)) return { id: requested, entry: hit };
  const d = defaultOutfitId(addons);
  return d ? { id: d, entry: addons[d] } : null;
}

/** 默认预取列表里排除的服装 (体积大: 婚纱 13.9MB)。宿主显式点名 xc.prefetch{ids} 时不受此限。 */
export const PREFETCH_EXCLUDED: ReadonlySet<string> = new Set(['xiaochun_wedding']);

export function defaultPrefetchIds(addons: Readonly<Record<string, AddonLike>>): string[] {
  return Object.keys(addons).filter((id) => !PREFETCH_EXCLUDED.has(id));
}

/**
 * 服装文件体积提示 (MB, 十进制, public/vrm/addons/*.vrmaddon 的实际大小, 四舍五入到 0.1)。
 * 只是 UI / 宿主的提示, 不参与任何逻辑; registry.test.mjs 会对照磁盘文件校验, 文件变了测试会提醒更新。
 */
export const OUTFIT_SIZE_MB: Readonly<Record<string, number>> = {
  xiaochun_techwear: 3.9,
  xiaochun_cheongsam: 4.7,
  xiaochun_bikini: 1.7,
  xiaochun_maid: 4.2,
  xiaochun_swimsuit: 2.4,
  xiaochun_shroud: 5.3,
  xiaochun_dinner_dress: 4.3,
  xiaochun_office_lady: 4.2,
  xiaochun_wedding: 13.9,
};

export function listOutfits(addons: Readonly<Record<string, AddonLike>>): XcOutfitInfo[] {
  return Object.keys(addons).map((id) => {
    const sizeMB = xcHasOwn(OUTFIT_SIZE_MB, id) ? OUTFIT_SIZE_MB[id] : undefined;
    return { id, name: addons[id].name, ...(sizeMB !== undefined ? { sizeMB } : {}) };
  });
}


export function listScenes(items: Readonly<Record<string, SceneLike>>): XcSceneInfo[] {
  return Object.keys(items).map((id) => ({ id, transparent: Boolean(items[id].isTransparent) }));
}

/**
 * ?controls= 解析 (滚轮缩放)。默认开 (与主站一致); 只有 0 / false 才锁住。controls=1 与缺省等价。
 * 注意: 开启意味着 iframe 里指针在画布 (透明场景: 在角色) 上滚轮会缩放, 并吞掉该区域的页面滚动。
 */
export function parseControls(raw: string | null | undefined): boolean {
  return !(raw === '0' || raw === 'false');
}

export type EmbedSceneId = 'light' | 'dark' | 'transparent' | 'beach';

/**
 * /embed URL 里指定的初始场景 (纯函数)。优先级: ?scene=light|dark|transparent|beach > ?transparent=1 (旧参数) > ?theme=light|dark (旧参数)。
 * 没指定 / 非法 → null (调用方再回退 localStorage / 系统亮暗)。
 * sceneManager (场景标记 / 菜单勾选 / scene-transparent 类) 与 vrmEngine (线稿世界 / 背景 / alpha) 必须读同一份结果,
 * 否则会出现"菜单显示透明, 画面还是线稿柱子"的分裂 (?scene=transparent 曾只被前者识别)。
 */
export function embedSceneFromSearch(search: string): EmbedSceneId | null {
  const q = new URLSearchParams(search);
  const scene = q.get('scene');
  if (scene === 'light' || scene === 'dark' || scene === 'transparent' || scene === 'beach') return scene;
  if (q.get('transparent') === '1') return 'transparent';
  const theme = q.get('theme');
  if (theme === 'light' || theme === 'dark') return theme;
  return null;
}

// ── iframe 自己的偏好存储 (localStorage; 键沿用主站的 WEARING_OUTFIT_KEY / SCENE_THEME_KEY) ──
// 全部 try/catch: 第三方存储被分区 / 拦截 / 配额满时静默回退到默认, 不抛错。storage 作参数传入, 方便单测。

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 取浏览器 localStorage; 访问本身就可能抛 (被拦截 / 沙箱), 拿不到返回 null。 */
export function safeLocalStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 读已保存的服装 id: 必须是现有的内置服装 (白名单), 否则当作坏数据忽略并顺手清掉。 */
export function readOutfitPref(storage: StorageLike | null, key: string, addons: Readonly<Record<string, AddonLike>>): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    if (ownEntry(addons, raw)) return raw;
    storage.removeItem(key); // 过期 / 被改坏的 id (例如服装已下线): 清掉, 下次回默认
  } catch { /* 存储被拦截: 当没有 */ }
  return null;
}

export function writeOutfitPref(storage: StorageLike | null, key: string, id: string): void {
  if (!storage) return;
  try { storage.setItem(key, id); } catch { /* 配额满 / 被拦截: 忽略 */ }
}

/**
 * 初始服装, 优先级: URL / SDK 显式的 ?outfit= > iframe 自己存的 > 默认。
 * 显式值只要出现 (哪怕非法) 就按显式处理 (非法 → 默认 + 另行上报 unknown_id), 不会再回头用存的。
 */
export function resolveInitialOutfitWithPref(
  addons: Readonly<Record<string, AddonLike>>,
  requested: unknown,
  stored: string | null,
): { id: string; entry: AddonLike } | null {
  if (requested != null) return resolveInitialOutfit(addons, requested);
  return resolveInitialOutfit(addons, stored);
}

// ── 界面语言 (iframe 自己的偏好) ──
// 优先级: URL / SDK 显式的 ?lang= > iframe 自己 localStorage 里记住的用户选择 > 浏览器语言 > zh-CN。

export const EMBED_DEFAULT_LANG: XcLang = 'zh-CN';

const isXcLang = (v: unknown): v is XcLang => typeof v === 'string' && (XC_LANGS as readonly string[]).includes(v);

/** 浏览器语言列表 (navigator.languages) → 第一个能映射的界面语言: zh* → zh-CN, ja* → ja, en* → en; 都不认识 → null。 */
export function langFromNavigator(languages: readonly string[] | null | undefined): XcLang | null {
  for (const raw of languages ?? []) {
    const tag = String(raw).toLowerCase();
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-CN';
    if (tag === 'ja' || tag.startsWith('ja-')) return 'ja';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
  }
  return null;
}

/** 读已保存的语言: 必须在白名单里, 否则当作坏数据忽略并清掉。 */
export function readLangPref(storage: StorageLike | null, key: string): XcLang | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    if (isXcLang(raw)) return raw;
    storage.removeItem(key);
  } catch { /* 存储被拦截: 当没有 */ }
  return null;
}

export function writeLangPref(storage: StorageLike | null, key: string, lang: XcLang): void {
  if (!storage) return;
  try { storage.setItem(key, lang); } catch { /* 配额满 / 被拦截: 忽略 */ }
}

/** 初始界面语言: 显式 (URL / SDK) > 存储 > 浏览器语言 > 默认。显式值非法 (不在白名单) 视为没给。 */
export function resolveEmbedLang(explicit: unknown, stored: XcLang | null, navigatorLanguages: readonly string[] | null | undefined): XcLang {
  if (isXcLang(explicit)) return explicit;
  return stored ?? langFromNavigator(navigatorLanguages) ?? EMBED_DEFAULT_LANG;
}
