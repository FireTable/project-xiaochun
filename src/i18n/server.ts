import { createServerOnlyFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { DEFAULT_LANG, LANG_COOKIE, resolveLang, type Lang } from './index';

/**
 * ponytail: server-only cookie 读取,用 createServerOnlyFn 包裹让 import-protection
 * 把 getCookie 从客户端 bundle 中剔除。客户端调用会抛错,被调用方 try/catch 兜底。
 */
export const readServerLang = createServerOnlyFn((): Lang => {
  const cookie = getCookie(LANG_COOKIE);
  return cookie ? resolveLang(cookie) : DEFAULT_LANG;
});
