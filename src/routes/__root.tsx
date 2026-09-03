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
      { name: 'description', content: '100% browser-native anime VTuber — local LLM (WebLLM Qwen3) + EMAGE full-body motion + Edge-TTS. Real-time chat with VRM characters, no backend.' },
      { name: 'keywords', content: 'VTuber, AI, VRM, WebLLM, WebGPU, Edge-TTS, EMAGE, anime, character, three.js, browser' },
      { name: 'robots', content: 'index, follow' },
      { name: 'format-detection', content: 'telephone=no' },

      // Open Graph
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: 'Project XiaoChun' },
      { property: 'og:description', content: '100% browser-native anime VTuber — local LLM + EMAGE motion + Edge-TTS.' },
      { property: 'og:url', content: 'https://xiaochun.firetable.tech' },
      { property: 'og:image', content: 'https://xiaochun.firetable.tech/og.jpg' },
      { property: 'og:image:type', content: 'image/jpeg' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: '小蠢 — Project XiaoChun' },
      { property: 'og:locale', content: 'zh_CN' },
      { property: 'og:site_name', content: 'Project XiaoChun' },

      // Twitter
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: 'Project XiaoChun' },
      { name: 'twitter:description', content: '100% browser-native anime VTuber — local LLM + EMAGE motion + Edge-TTS.' },
      { name: 'twitter:image', content: 'https://xiaochun.firetable.tech/og.jpg' },
      { name: 'twitter:image:alt', content: '小蠢 — Project XiaoChun' },

      { title: 'Project XiaoChun' },
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
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body>
        <div id="root">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
