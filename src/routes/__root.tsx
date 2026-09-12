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
      { name: 'description', content: '100% browser-native anime companion — WebLLM (WebGPU) + EMAGE full-body motion (ONNX wasm + INT8) + Edge-TTS. Features 0-pop outfit swapping, cinematic Bloom post-processing, 28-parameter body morphing, and zero-backend local privacy.' },
      { name: 'keywords', content: 'Project XiaoChun, 二次元伴侣, 虚拟伴侣, AI伴侣, 二次元换装, 角色穿脱, 后期处理, Bloom辉光, 线稿主题, 骨骼微调, anime companion, virtual companion, outfit swap, postfx, anime bloom, VRM, VRM morph, WebLLM, WebGPU, ONNX Runtime Web, wasm, INT8, Edge-TTS, EMAGE, streaming motion, three.js, browser-native, リアルタイムAI, バーチャルコンパニオン, 3Dアバター' },
      { name: 'robots', content: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1' },
      { name: 'format-detection', content: 'telephone=no' },
      { name: 'application-name', content: 'Project XiaoChun' },

      // GEO & Dublin Core
      { name: 'geo.region', content: 'GLOBAL' },
      { name: 'geo.placename', content: 'Global' },
      { name: 'DC.title', content: 'Project XiaoChun — 100% 浏览器原生二次元伴侣' },
      { name: 'DC.creator', content: 'FireTable' },
      { name: 'DC.subject', content: '3D Anime Companion, WebLLM, WebGPU LLM, EMAGE ONNX wasm INT8, VRM, Outfit Swap, Post-processing' },
      { name: 'DC.language', content: 'zh-CN, ja, en' },
      { name: 'DC.coverage', content: 'World' },

      // Open Graph
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: 'Project XiaoChun — 100% 浏览器原生二次元伴侣' },
      { property: 'og:description', content: '100% 浏览器原生二次元伴侣 — WebLLM + EMAGE 全身动作 + Edge-TTS。内置无缝原子换装、电影级辉光后期、28项形体微调与双主题线稿世界，纯本地隐私零后端。' },
      { property: 'og:url', content: 'https://xiaochun.firetable.tech' },
      { property: 'og:image', content: 'https://xiaochun.firetable.tech/og.jpg' },
      { property: 'og:image:type', content: 'image/jpeg' },
      { property: 'og:image:width', content: '1936' },
      { property: 'og:image:height', content: '1024' },
      { property: 'og:image:alt', content: 'Project XiaoChun — 100% 浏览器原生二次元伴侣' },
      { property: 'og:locale', content: 'zh_CN' },
      { property: 'og:locale:alternate', content: 'en_US' },
      { property: 'og:locale:alternate', content: 'ja_JP' },
      { property: 'og:site_name', content: 'Project XiaoChun' },

      // Twitter
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:site', content: 'FireTablePlus' },
      { name: 'twitter:creator', content: 'FireTablePlus' },
      { name: 'twitter:title', content: 'Project XiaoChun — 100% 浏览器原生二次元伴侣' },
      { name: 'twitter:description', content: '100% 浏览器原生二次元伴侣 — WebLLM + EMAGE + Edge-TTS。支持无缝换装、电影级Bloom后期与28项骨骼微调。' },
      { name: 'twitter:image', content: 'https://xiaochun.firetable.tech/og.jpg' },
      { name: 'twitter:image:alt', content: 'Project XiaoChun — 100% 浏览器原生二次元伴侣' },

      { title: 'Project XiaoChun' },
    ],
    links: [
      { rel: 'icon', type: 'image/png', href: '/favicon.png' },
      { rel: 'canonical', href: 'https://xiaochun.firetable.tech/' },
      { rel: 'alternate', hrefLang: 'zh-CN', href: 'https://xiaochun.firetable.tech/' },
      { rel: 'alternate', hrefLang: 'en', href: 'https://xiaochun.firetable.tech/' },
      { rel: 'alternate', hrefLang: 'ja', href: 'https://xiaochun.firetable.tech/' },
      { rel: 'alternate', hrefLang: 'x-default', href: 'https://xiaochun.firetable.tech/' },
      { rel: 'stylesheet', href: appCss },
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
          applicationSubCategory: 'Virtual Companion / 3D Avatar',
          operatingSystem: 'Any (modern browser; WebGPU optional for LLM)',
          inLanguage: ['zh-CN', 'en', 'ja'],
          author: {
            '@type': 'Organization',
            name: 'FireTable',
            url: 'https://github.com/FireTable',
          },
          description: '100% 浏览器原生二次元伴侣 — WebLLM（可用 WebGPU）+ EMAGE 全身动作（ONNX wasm + INT8，流式 motion_chunk）+ Edge-TTS。内置原子级无缝换装、电影级后期处理管线与28项骨骼微调。',
          browserRequirements: 'Modern browser with WebGL2; WebGPU recommended for WebLLM; EMAGE uses wasm (SharedArrayBuffer when cross-origin isolated)',
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
          },
          featureList: [
            '100% 浏览器端本地大语言模型推理 (WebLLM；可用 WebGPU)',
            'EMAGE 全身协同动作 (ONNX Runtime Web wasm + INT8；流式 T=64 motion_chunk)',
            'Edge-TTS 自然语音流式合成 (edge-tts-core)',
            '原子级无缝换装与增量 Delta 补丁系统 (WASM bspatch + IndexedDB 二级缓存，0帧 T-pose 跳变)',
            '电影级后期处理管线 (UnrealBloom 辉光、ToneMapping 与色调微调)',
            '双主题线稿世界 (Light / Dark Linework World)',
            '端侧持久化多级记忆系统 (IndexedDB)',
            '28项人体工程学骨骼与微观形变微调系统',
            '100% 纯本地隐私保证，零对话数据回传',
            '三语自适应沉浸交互 (中/英/日)',
            '跨源隔离时 ORT wasm 多线程 (COOP/COEP credentialless)',
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
          {/* ponytail: vconsole 只在 dev 模式挂载,生产 build 不带 WebConsole 实例。 */}
          {import.meta.env.DEV && <WebConsole />}
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
