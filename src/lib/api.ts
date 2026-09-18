/**
 * api.ts — 跨端 API 透明网关与客户端调度
 *
 * 核心设计目标：
 * 1. 彻底抹平 Web 与 Tauri 桌面端 (tauri://localhost) 的路径差异；
 * 2. 在 Tauri 桌面环境中透明拦截所有 /api/* 请求，自动重定向到生产 Worker / 服务端；
 * 3. 开发者零心智负担，未来添加任何 /api/* 接口，直接使用原生 fetch() 即可 100% 生效；
 * 4. 提供可选的 apiFetch 与 resolveApiUrl 工具函数，方便统一增加鉴权或拦截。
 */

import { isTauri } from '@/lib/platform';
import { APP_CONFIG } from '@/config';

/**
 * 将相对 API 路径转换为当前运行时环境适用的完整 URL
 */
export function resolveApiUrl(path: string): string {
  if (typeof path === 'string' && path.startsWith('/api/')) {
    const base = isTauri() ? APP_CONFIG.api.baseUrl.replace(/\/+$/, '') : '';
    return `${base}${path}`;
  }
  return path;
}

/**
 * 统一 API Fetch 客户端封装（可选使用）
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let target = input;
  if (typeof target === 'string') {
    target = resolveApiUrl(target);
  } else if (target instanceof URL && target.pathname.startsWith('/api/') && isTauri()) {
    const base = APP_CONFIG.api.baseUrl.replace(/\/+$/, '');
    target = new URL(`${base}${target.pathname}${target.search}`);
  }
  return fetch(target, init);
}

/**
 * 安装全局透明 API 拦截网关（自动执行，零心智负担）
 * 仅在 Tauri 桌面应用环境中介入，Web / 本地开发环境保持原生零开销
 */
export function setupTauriApiGateway(): void {
  if (typeof window === 'undefined') return;
  if (!isTauri()) return;

  const g = globalThis as any;
  if (g.__TAURI_API_GATEWAY_INSTALLED__) return;
  g.__TAURI_API_GATEWAY_INSTALLED__ = true;

  const originalFetch = g.fetch.bind(g);
  const apiBase = APP_CONFIG.api.baseUrl.replace(/\/+$/, '');

  g.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      if (typeof input === 'string') {
        if (input.startsWith('/api/')) {
          input = `${apiBase}${input}`;
        }
      } else if (input instanceof URL) {
        if (input.pathname.startsWith('/api/')) {
          input = new URL(`${apiBase}${input.pathname}${input.search}`);
        }
      } else if (input instanceof Request) {
        const urlStr = input.url;
        if (urlStr.startsWith('/api/')) {
          input = new Request(`${apiBase}${urlStr}`, input);
        } else {
          try {
            const u = new URL(urlStr);
            if (u.pathname.startsWith('/api/') && (u.protocol === 'tauri:' || u.origin === window.location.origin)) {
              input = new Request(`${apiBase}${u.pathname}${u.search}`, input);
            }
          } catch {}
        }
      }
    } catch (e) {
      console.warn('[ApiGateway] Failed to rewrite API URL:', e);
    }

    return originalFetch(input, init);
  };

  console.log(`[ApiGateway] Tauri 透明 API 代理网关已激活 🚀 -> ${apiBase}`);
}

// 模块被引入时自动执行安装
if (typeof window !== 'undefined') {
  setupTauriApiGateway();
}
