import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';
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
      { title: 'Project XiaoChun' },
    ],
    links: [
      { rel: 'icon', type: 'image/png', href: '/favicon.png' },
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
      <RootDocument lang={i18n.language as Lang}>
        <Outlet />
      </RootDocument>
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
