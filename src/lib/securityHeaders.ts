/**
 * securityHeaders.ts — 响应安全头策略 (纯函数, Worker / vite 中间件共用, 无任何运行时依赖)。
 *
 * 主站: 禁止被任何页面 iframe (X-Frame-Options: DENY), COOP/COEP 保持跨源隔离给 ORT wasm 多线程。
 * /embed: 去掉 X-Frame-Options, 改用 CSP `frame-ancestors` 白名单 (默认 `*`, 可用 env 收紧)。
 *
 * 另有静态版本在 public/_headers (Cloudflare Pages / Workers Assets 直出静态资源时不经过 Worker),
 * 两处必须保持一致 —— 改这里时同步改 _headers 与 docs/EMBED.md。
 */

export interface SecurityEnv {
  /** 空格或逗号分隔的 frame-ancestors 来源; 缺省 `*` (任何站点都可嵌入)。例: "https://a.com https://*.b.com" */
  EMBED_FRAME_ANCESTORS?: string;
}

const SOURCE_RE = /^(\*|'self'|'none'|(https?:\/\/)?(\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:(\d{1,5}|\*))?)$/i;

export function isEmbedPath(pathname: string): boolean {
  return pathname === '/embed' || pathname.startsWith('/embed/');
}

/** 白名单清洗: 丢弃不合法 token (防头注入 / 误配), 全丢光则回落 'none' (fail closed, 而不是悄悄放开)。 */
export function resolveFrameAncestors(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') return '*';
  const tokens = raw.split(/[\s,]+/).filter((t) => t && SOURCE_RE.test(t));
  return tokens.length ? tokens.join(' ') : "'none'";
}

export function applySecurityHeaders(headers: Headers, pathname: string, env: SecurityEnv = {}): Headers {
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  // SenseVoice STT 需要 getUserMedia; camera/geolocation 一律关闭。
  // /embed 同样 microphone=(self): 宿主还必须在 <iframe allow="microphone"> 里委派, 缺一不可。
  headers.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), interest-cohort=()');
  if (isEmbedPath(pathname)) {
    headers.delete('X-Frame-Options');
    headers.set('Content-Security-Policy', `frame-ancestors ${resolveFrameAncestors(env.EMBED_FRAME_ANCESTORS)}`);
    // 宿主若自己开了 COEP: require-corp, 子 iframe 文档必须带 CORP 才能被嵌入。
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin'); // iframe 内被忽略; 直接打开 /embed 时仍保持隔离
  } else {
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('X-Frame-Options', 'DENY');
  }
  return headers;
}
