import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WebConsole } from '@/components/WebConsole';
import appCss from '@/styles/main.css?url';
import '@/styles/main.css';
import {
  createI18n,
  DEFAULT_LANG,
  readClientLang,
  type Lang,
} from '@/i18n';
import { readServerLang } from '@/i18n/server';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#ea8377' },
      { name: 'description', content: '100% browser-native anime companion — local on-device LLM (WebLLM Qwen2.5) + EMAGE full-body motion + Edge-TTS. 100% private, real-time chat with VRM anime companion, zero backend.' },
      { name: 'keywords', content: '二次元伴侣, 虚拟伴侣, AI伴侣, anime companion, virtual companion, VRM, WebLLM, WebGPU, Edge-TTS, EMAGE, three.js, browser-native' },
      { name: 'robots', content: 'index, follow' },
      { name: 'format-detection', content: 'telephone=no' },
      { name: 'application-name', content: 'Project XiaoChun' },
      { name: 'geo.region', content: 'GLOBAL' },

      // Open Graph
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: 'Project XiaoChun — 100% 浏览器原生二次元伴侣' },
      { property: 'og:description', content: '100% 浏览器原生二次元伴侣 — 本地端侧大模型 (WebLLM Qwen2.5) + EMAGE 全身动作生成 + Edge-TTS 语音合成。纯本地隐私交互，无需后端。' },
      { property: 'og:url', content: 'https://xiaochun.firetable.tech' },
      { property: 'og:image', content: 'https://xiaochun.firetable.tech/og.jpg' },
      { property: 'og:image:type', content: 'image/jpeg' },
      { property: 'og:image:width', content: '1936' },
      { property: 'og:image:height', content: '1024' },
      { property: 'og:image:alt', content: 'Project XiaoChun — 100% 浏览器原生二次元伴侣' },
      { property: 'og:locale', content: 'zh_CN' },
      { property: 'og:site_name', content: 'Project XiaoChun' },

      // Twitter
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:site', content: 'FireTablePlus' },
      { name: 'twitter:creator', content: 'FireTablePlus' },
      { name: 'twitter:title', content: 'Project XiaoChun — 100% 浏览器原生二次元伴侣' },
      { name: 'twitter:description', content: '100% 浏览器原生二次元伴侣 — 本地端侧大模型 + EMAGE 全身协同动作 + Edge-TTS 语音合成。' },
      { name: 'twitter:image', content: 'https://xiaochun.firetable.tech/og.jpg' },
      { name: 'twitter:image:alt', content: 'Project XiaoChun — 100% 浏览器原生二次元伴侣' },

      { title: 'Project XiaoChun — 100% 浏览器原生二次元伴侣' },
    ],
    links: [
      { rel: 'icon', type: 'image/png', href: '/favicon.png' },
      { rel: 'canonical', href: 'https://xiaochun.firetable.tech/' },
      { rel: 'stylesheet', href: appCss },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=Noto+Sans+SC:wght@300;400;500;700&display=swap',
      },
    ],
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          name: 'Project XiaoChun (小蠢)',
          alternateName: '小蠢二次元伴侣',
          url: 'https://xiaochun.firetable.tech',
          applicationCategory: 'EntertainmentApplication',
          operatingSystem: 'Any (Browser-native WebGPU)',
          description: '100% 浏览器原生二次元伴侣 — 端侧大模型 (WebLLM Qwen2.5) + EMAGE 全身动作生成 + Edge-TTS 语音合成。纯本地隐私交互，无需云端后端。',
          browserRequirements: 'Requires WebGPU or modern WebGL2 browser',
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
          },
          featureList: [
            '100% 浏览器端本地大语言模型推理 (WebLLM)',
            'EMAGE 实时全身协同动作生成',
            'Edge-TTS 自然语音流式合成',
            '端侧持久化多级记忆系统 (IndexedDB)',
            '100% 纯本地隐私保证，零对话数据回传',
            '三语自适应沉浸交互 (中/英/日)',
          ],
        }),
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  // ponytail: useMemo 保证 i18n 实例与 lang 一一对应,SSR/CSR 各自的实例完全等价 → 无 hydration mismatch。
  const i18n = useMemo(() => createI18n(resolveServerLang()), []);

  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider delayDuration={300} skipDelayDuration={500}>
        <RootDocument lang={i18n.language as Lang}>
          <WebConsole />
          <Outlet />
        </RootDocument>
      </TooltipProvider>
    </I18nextProvider>
  );
}

/** ponytail: 客户端走 document.cookie;服务端用 readServerLang(server-only 文件,getCookie 不进客户端 bundle)。 */
function resolveServerLang(): Lang {
  if (typeof document !== 'undefined') return readClientLang();
  try {
    return readServerLang();
  } catch {
    // ponytail: 客户端误入此分支时静默回落(虽然 import-protection 已经隔离,多一层兜底)。
    return DEFAULT_LANG;
  }
}

function RootDocument({ children, lang }: { children: ReactNode; lang: Lang }) {
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <div id="root">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
