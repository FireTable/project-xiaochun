/**
 * loopback.ts — 判断当前页面是否由"本地回环代理服务"托管（需走 /emage、/wasm/、/stt/、/api/companion-state 等本地路由）。
 *
 * 规则：
 *  1. Vite dev（import.meta.env.DEV）永远 false：dev 服务器没有这些代理路由，走了会 404。
 *  2. URL 带 loopback=1 → true（主线程读 window.location.search，并写入 sessionStorage，SPA 内跳转丢参数后仍保持）。
 *  3. 否则非 DEV 构建回退旧规则 hostname === 127.0.0.1 || localhost（兼容未发送该参数的已安装旧版插件）。
 *
 * Worker 看不到页面 URL：请在主线程调用本函数，再通过消息把结果传给 worker；
 * worker 内直接调用时无参数、无 sessionStorage，只会走第 1、3 条（安全默认）。
 */
const STORAGE_KEY = 'xc_loopback';

export function isLoopbackHost(): boolean {
  if (import.meta.env?.DEV) return false;
  const loc = (globalThis as { location?: Location }).location;
  if (!loc) return false;

  let flagged = false;
  try {
    flagged = new URLSearchParams(loc.search).get('loopback') === '1';
  } catch {
    /* ignore */
  }
  try {
    const ss = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    if (ss) {
      if (flagged) ss.setItem(STORAGE_KEY, '1');
      else if (ss.getItem(STORAGE_KEY) === '1') flagged = true;
    }
  } catch {
    /* sessionStorage 可能被禁用 */
  }
  if (flagged) return true;

  return loc.hostname === '127.0.0.1' || loc.hostname === 'localhost';
}
