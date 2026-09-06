import { createFileRoute } from '@tanstack/react-router';
import React, { useState, useEffect } from 'react';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { APP_CONFIG } from '@/config';

// 仅在客户端动态加载 App (包含 Three.js 和 WebLLM 等大型浏览器专属模块),
// 避免将数兆重的客户端运行时打入 SSR / Cloudflare Worker bundle。
const ClientApp = !import.meta.env.SSR
  ? React.lazy(() => import('@/App').then((m) => ({ default: m.App })))
  : () => null;

export const Route = createFileRoute('/')({
  component: IndexComponent,
});

function IndexComponent() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const shouldSkipOverlay = import.meta.env.DEV && APP_CONFIG.dev.disableLoadingOverlayInDev;

  // SSR 及客户端 mount 前渲染 LoadingOverlay, 杜绝白屏/黑屏空窗
  if (!mounted) {
    return shouldSkipOverlay ? null : <LoadingOverlay />;
  }

  return (
    <React.Suspense fallback={shouldSkipOverlay ? null : <LoadingOverlay />}>
      <ClientApp />
    </React.Suspense>
  );
}