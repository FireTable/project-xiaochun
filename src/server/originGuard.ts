/**
 * src/server/originGuard.ts — Origin allowlist shared by /api/tts and /api/stt.
 *
 * Allowed:
 * - https://xiaochun.firetable.tech (production, exact origin)
 * - localhost / 127.0.0.1 / [::1] on any port, http or https
 * - private LAN IPv4 (192.168.x.x, 10.x.x.x, 172.16-31.x.x) on any port, http or https
 *
 * Anything else, including a missing or malformed Origin, is denied.
 */

const PROD_ORIGIN = 'https://xiaochun.firetable.tech';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isPrivateLanIPv4(host: string): boolean {
  const m = IPV4_RE.exec(host);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  // Must be a bare origin: rejects paths, userinfo, trailing slash, "null", non-canonical forms.
  if (url.origin !== origin) return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (origin === PROD_ORIGIN) return true;
  return LOOPBACK_HOSTS.has(url.hostname) || isPrivateLanIPv4(url.hostname);
}

/** Generic 403 for a disallowed or missing Origin. No CORS headers, no detail. */
export function forbiddenResponse(): Response {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', Vary: 'Origin' },
  });
}

/**
 * Returns the CORS headers (echoing only the allowed Origin, never '*') for an allowed request,
 * or null when the request's Origin is not allowed.
 */
export function corsHeadersFor(request: Request): Record<string, string> | null {
  const origin = request.headers.get('Origin');
  if (!isAllowedOrigin(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin as string,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}
