import '@/lib/api';
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
import { TauriWindowFrame } from '@/components/TauriWindowFrame';
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
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'theme-color', content: '#ea8377' },
      { name: 'description', content: 'Dual-mode anime companion & transparent desktop pet (Tauri 2.x + Web) — WebLLM (WebGPU), Cognitive Memory Engine (@firetable/client-memory with SillyTavern Lorebook & episodic journal), On-Device Streaming Speech Recognition (@firetable/stream-asr) with sub-50ms causal latency & neural VAD barge-in interruption, EMAGE full-body gestures (ONNX wasm INT8), Edge-TTS with Tone.js 3D spatial vocal DSP, real-time 24h Beach 3D solar stage, StoryDirector interactive prologue, zero-pop outfit swap, and external protocol (xiaochun://).' },
      { name: 'keywords', content: 'Project XiaoChun, 小蠢, 小蠢AI伴侣, client-memory, 端侧记忆, 认知记忆系统, 记忆设置, SillyTavern, 酒馆世界书, 情景回忆, 遗忘衰减, 二次元伴侣, 桌面宠物, 桌宠, 透明桌宠, 虚拟伴侣, AI伴侣, 语音识别, 端上STT, SenseVoice, Silero VAD, CT-Transformer, 实时标点, 全双工打断, barge-in, StoryDirector, 故事模式, 序章剧情, 语音美化, 空间声学, 自适应距离衰减, 原声直通, 3D spatial audio, vocal post-processing, Tone.js, distance attenuation, 二次元换装, 角色穿脱, 后期处理, Bloom辉光, 线稿主题, 海滩舞台, Beach 3D, 24h solar cycle, 24小时昼夜交替, 骨骼微调, desktop pet, transparent companion, Tauri 2, deep link, anime companion, virtual companion, speech to text, on-device STT, outfit swap, postfx, anime bloom, VRM, VRM morph, WebLLM, WebGPU, ONNX Runtime Web, wasm, INT8, Edge-TTS, EMAGE, streaming motion, three.js, browser-native, リアルタイムAI, バーチャルコンパニオン, 3Dアバター, デスクトップマスコット, 音声認識' },
      { name: 'robots', content: 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1' },
      { name: 'format-detection', content: 'telephone=no' },
      { name: 'application-name', content: 'Project XiaoChun' },

      // GEO & Dublin Core
      { name: 'geo.region', content: 'GLOBAL' },
      { name: 'geo.placename', content: 'Global' },
      { name: 'DC.title', content: 'Project XiaoChun (小蠢) — 100% 客户端原生二次元伴侣与透明桌宠' },
      { name: 'DC.creator', content: 'FireTable' },
      { name: 'DC.subject', content: '3D Anime Companion, Desktop Pet, Tauri 2, WebLLM, WebGPU LLM, Cognitive Memory, SillyTavern Lorebook, EMAGE ONNX wasm INT8, VRM, Outfit Swap, Post-processing, Tone.js Vocal Processing, 3D Spatial Audio, Beach 3D Scene, 24-Hour Solar Arc, StoryDirector Cinematic Engine, Silero VAD v5, CT-Transformer Punctuation' },
      { name: 'DC.language', content: 'zh-CN, ja, en' },
      { name: 'DC.coverage', content: 'World' },

      // Open Graph
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: 'Project XiaoChun (小蠢) — 100% 浏览器原生二次元伴侣' },
      { property: 'og:description', content: '100% 浏览器原生二次元伴侣 — WebLLM + 多层端侧认知记忆 (@firetable/client-memory，画像提取 + 情景回忆日记 + 酒馆 SillyTavern 世界书兼容) + 多模态语音听写 (Silero VAD v5 全双工打断 + CT-Transformer 实时标点) + EMAGE 全身协同动作 + Edge-TTS 及 Tone.js 3D 空间声学。内置 24 小时海滩日光循环、互动剧情演播引擎、无缝原子换装与电影级辉光后期，纯本地隐私零后端。' },
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
      { name: 'twitter:title', content: 'Project XiaoChun (小蠢) — 100% 浏览器原生二次元伴侣' },
      { name: 'twitter:description', content: '100% 浏览器原生二次元伴侣 — WebLLM + 端侧认知记忆与酒馆世界书 (@firetable/client-memory) + Silero VAD v5 全双工打断听写 + EMAGE 协同动作 + Edge-TTS 与 3D 空间声学。支持 24h 海滩昼夜循环、交互剧情序章、无缝换装与电影级Bloom后期。' },
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

      // AI Agent 发现、语料直达与服务协议
      { rel: 'service-doc', type: 'text/markdown', href: '/llms.txt', title: 'LLM Summary' },
      { rel: 'describedby', type: 'text/markdown', href: '/llms-full.txt', title: 'Full Technical Docs' },
      { rel: 'alternate', type: 'text/markdown', href: '/llms.txt', title: 'Project XiaoChun (Markdown)' },
      { rel: 'api-catalog', type: 'application/linkset+json', href: '/.well-known/api-catalog' },
      { rel: 'service-doc', type: 'text/markdown', href: '/auth.md', title: 'Agent Auth Policy' },
      { rel: 'author', href: 'https://firetable.tech' },

      { rel: 'stylesheet', href: appCss },
    ],
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'WebApplication',
              '@id': 'https://xiaochun.firetable.tech/#webapp',
              name: 'Project XiaoChun (小蠢)',
              alternateName: '小蠢二次元伴侣',
              url: 'https://xiaochun.firetable.tech',
              applicationCategory: 'EntertainmentApplication',
              applicationSubCategory: 'Virtual Companion / 3D Avatar / Desktop Pet',
              operatingSystem: 'Any (modern browser with WebGL2; WebGPU recommended for WebLLM)',
              inLanguage: ['zh-CN', 'en', 'ja'],
              author: { '@id': 'https://firetable.tech/#author' },
              publisher: { '@id': 'https://firetable.tech/#author' },
              sourceCode: { '@id': 'https://xiaochun.firetable.tech/#sourcecode' },
              description: '100% 浏览器原生二次元伴侣 — WebLLM（可用 WebGPU）+ 多模态语音听写（Silero VAD v5 全双工打断 + CT-Transformer 实时标点）+ EMAGE 全身动作（ONNX wasm + INT8，流式 motion_chunk）+ Edge-TTS 与 Tone.js 客户端语音美化（3D 距离自适应空间声学）。内置 24 小时海滩日光舞台、交互式剧情演播引擎、原子级无缝换装、电影级后期处理管线与28项骨骼微调。',
              browserRequirements: 'Modern browser with WebGL2; WebGPU recommended for WebLLM; EMAGE uses wasm (SharedArrayBuffer when cross-origin isolated)',
              screenshot: 'https://xiaochun.firetable.tech/og.jpg',
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
              },
              featureList: [
                '100% 浏览器端本地大语言模型推理 (WebLLM；可用 WebGPU)',
                '实时 24 小时昼夜日光循环与 3D 海滩舞台 (Beach 3D World；日出/正午/落日/星夜动态平滑插值与天空盒天体漫游)',
                '全双工语音交互与沉浸打断 (Silero VAD v5 极速打断、防自听回音门控与 CT-Transformer int8 实时双阶段标点)',
                '交互式剧情演播引擎 (StoryDirectorEngine；多分支选择、电影级机位运镜、程序化背景环境音效)',
                '一键动作融合与姿态平滑过渡 (Universal Motion API；Quintic 0.75s 连续加速度平滑换姿)',
                'EMAGE 全身协同动作 (ONNX Runtime Web wasm + INT8；流式 T=64 motion_chunk)',
                'Edge-TTS 自然语音流式合成 (edge-tts-core)',
                'Tone.js 客户端语音美化与 3D 镜头自适应空间声学 (近场贴耳共鸣、原声直通纯净旁路与 8m+ 视距衰减)',
                '原子级无缝换装与增量 Delta 补丁系统 (WASM bspatch + IndexedDB 二级缓存，0帧 T-pose 跳变)',
                '电影级后期处理管线 (UnrealBloom 辉光、ToneMapping 与色调微调)',
                '双主题线稿世界 (Light / Dark Linework World)',
                '多层端侧认知记忆系统 (@firetable/client-memory；画像特征、情景回忆日记、酒馆 SillyTavern 世界书与 Stanford 遗忘衰减打分)',
                '28项人体工程学骨骼与微观形变微调系统',
                '100% 纯本地隐私保证，零对话数据回传',
                '三语自适应沉浸交互 (中/英/日)',
                '跨源隔离时 ORT wasm 多线程 (COOP/COEP credentialless)',
              ],
            },
            {
              '@type': 'SoftwareApplication',
              '@id': 'https://xiaochun.firetable.tech/#desktop-companion',
              name: 'Project XiaoChun Desktop Companion',
              alternateName: '小蠢透明桌面宠物',
              applicationCategory: 'DesktopEnhancement',
              operatingSystem: 'macOS (Apple Silicon & Intel), Windows 10/11, Linux',
              softwareVersion: '0.2.15',
              downloadUrl: 'https://github.com/FireTable/Project-XiaoChun/releases',
              installUrl: 'https://raw.githubusercontent.com/FireTable/project-xiaochun/main/scripts/install.sh',
              author: { '@id': 'https://firetable.tech/#author' },
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
              },
            },
            {
              '@type': 'SoftwareSourceCode',
              '@id': 'https://xiaochun.firetable.tech/#sourcecode',
              name: 'Project XiaoChun Source Code',
              codeRepository: 'https://github.com/FireTable/Project-XiaoChun',
              programmingLanguage: ['TypeScript', 'Rust', 'GLSL', 'WGSL'],
              license: 'https://opensource.org/licenses/MIT',
              author: { '@id': 'https://firetable.tech/#author' },
            },
            {
              '@type': 'Person',
              '@id': 'https://firetable.tech/#author',
              name: 'FireTable',
              url: 'https://firetable.tech',
              jobTitle: 'Creator & Lead Architect',
              sameAs: [
                'https://github.com/FireTable',
                'https://x.com/FireTablePlus',
                'https://t.me/m070122',
              ],
            },
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
          {/* Vite compile-time DEV only — keep raw import.meta.env.DEV so
              production bundles tree-shake vconsole. Runtime UI uses isDev(). */}
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
        <TauriWindowFrame />
        <div id="root">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
