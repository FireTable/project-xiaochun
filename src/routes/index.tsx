import { createFileRoute } from '@tanstack/react-router';
import React, { useState, useEffect } from 'react';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { APP_CONFIG } from '@/config';
import { isDev } from '@/lib/utils';
import { PERF_FLAGS } from '@/perfFlags';

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

  const shouldSkipOverlay = isDev() && APP_CONFIG.dev.disableLoadingOverlayInDev;

  if (PERF_FLAGS.singleMountOverlay) {
    // One LoadingOverlay instance for the whole boot (SSR → hydration → lazy App): it is always the first child, so
    // React keeps the same elements (hero img + warp canvas) instead of remounting it in the Suspense fallback and
    // again inside App. App drives it through loadingStore.
    const skip = shouldSkipOverlay || (APP_CONFIG.dev.disableLoadingOverlayInDev && mounted && Boolean((window as any).__VRM_ALREADY_READY__));
    return (
      <>
        {skip ? null : <LoadingOverlay />}
        {mounted && (
          <React.Suspense fallback={null}>
            <ClientApp />
          </React.Suspense>
        )}
      </>
    );
  }

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
