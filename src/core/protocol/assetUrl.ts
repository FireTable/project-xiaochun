/**
 * protocol/assetUrl.ts — 资源 URL 白名单 (embed bridge 与 xiaochun:// 协议处理器共用)。
 */

/** 只放行 https:// 或同源地址, 且扩展名在白名单内; 否则返回 null。 */
export function safeAssetUrl(raw: unknown, exts: string[]): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  let u: URL;
  try { u = new URL(raw, window.location.origin); } catch { return null; }
  const sameOrigin = u.origin === window.location.origin;
  if (!sameOrigin && u.protocol !== 'https:') return null;
  if (!exts.some((e) => u.pathname.toLowerCase().endsWith(e))) return null;
  return u.href;
}
