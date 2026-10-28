/**
 * outfit.ts — 换装的唯一入口 (单一事实源)。
 *
 * TopHeader 的换装菜单和序章剧情的试衣卡都走这里，保证同一套行为：
 *   - 同一件已经穿着就不重复换 (不再白跑一遍 IDB 读取 + 解析 + GPU 预热)；
 *   - vrmEngine.swapOutfit 串行 + 最新请求优先 (generation token)，连点不会渲染出多个模型；
 *   - 落地后写 WEARING_OUTFIT_KEY (被更新请求顶掉的不写，免得把旧选择写进去)；
 *   - 引擎换装完成会广播 onOutfitChange，TopHeader 菜单的 ✓ 据此同步。
 */
import { vrmEngine, type SwapOutfitOptions } from '@/core/vrmEngine';
import { APP_CONFIG } from '@/config';
import { WEARING_OUTFIT_KEY } from '@/lib/constants';

export interface OutfitTarget {
  /** addon key；null = 裸模 base */
  key: string | null;
  source: string;
  name: string;
}

/** 'xiaochun_maid' / 'maid' / 'base' / 'default' → 目标；认不出的返回 null */
export function resolveOutfit(keyOrAlias: string): OutfitTarget | null {
  const addons = (APP_CONFIG.model.addons || {}) as Record<string, { source: string; name: string }>;
  if (keyOrAlias === 'base' || keyOrAlias === 'default') {
    return { key: null, source: APP_CONFIG.model.defaultSource, name: APP_CONFIG.model.defaultName };
  }
  const key = addons[keyOrAlias] ? keyOrAlias : addons[`xiaochun_${keyOrAlias}`] ? `xiaochun_${keyOrAlias}` : null;
  return key ? { key, source: addons[key].source, name: addons[key].name } : null;
}

/** 把当前穿的衣服记到 localStorage (null = 裸模 → 清掉)；存储被拦截时忽略 */
export function persistWearingOutfit(key: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (key) localStorage.setItem(WEARING_OUTFIT_KEY, key);
    else localStorage.removeItem(WEARING_OUTFIT_KEY);
  } catch {
    /* 存储被拦截：忽略 */
  }
}

/**
 * 换上目标衣服。返回 true = 已经穿着 / 换装已落地；false = 被更新的换装请求顶掉 (这次什么都没改)。
 * 抛错 = 换装失败，由调用方决定怎么提示。
 */
export async function changeOutfit(target: OutfitTarget, options?: SwapOutfitOptions): Promise<boolean> {
  const alreadyWorn =
    Boolean(vrmEngine.currentVRM) && !vrmEngine.isSwappingOutfit && vrmEngine.currentOutfitKey === target.key;
  if (alreadyWorn) {
    persistWearingOutfit(target.key);
    return true;
  }
  const applied = await vrmEngine.swapOutfit(target.source, target.name, options);
  if (applied === false) return false; // mock / 旧实现返回 undefined 视为已落地
  persistWearingOutfit(target.key);
  return true;
}
