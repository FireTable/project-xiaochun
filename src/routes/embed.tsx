import { createFileRoute } from '@tanstack/react-router';
import React, { useEffect, useState } from 'react';

// 仅客户端动态加载 (three.js / WebLLM 相关代码不进 SSR bundle); 与 routes/index.tsx 同款。
const ClientEmbed = !import.meta.env.SSR
  ? React.lazy(() => import('@/embed/EmbedApp').then((m) => ({ default: m.EmbedApp })))
  : () => null;

export const Route = createFileRoute('/embed')({
  component: EmbedComponent,
  head: () => ({
    // /embed 不进搜索引擎 (主站才是落地页); 同时避免 iframe 页被当作重复内容收录。
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  }),
});

function EmbedComponent() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // SSR / mount 前什么都不画 (无 LoadingOverlay): 占位由宿主 SDK 负责, 且保证透明模式下不闪白。
  if (!mounted) return null;
  return (
    <React.Suspense fallback={null}>
      <ClientEmbed />
    </React.Suspense>
  );
}
