import { createFileRoute } from '@tanstack/react-router';
import React, { useState, useEffect } from 'react';

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

  if (!mounted) {
    return (
      <div className="w-full h-screen bg-[#13111c] flex items-center justify-center text-white/70">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[#ea8377] border-t-transparent animate-spin" />
          <span className="text-xs font-medium tracking-wide">Project XiaoChun</span>
        </div>
      </div>
    );
  }

  return (
    <React.Suspense fallback={null}>
      <ClientApp />
    </React.Suspense>
  );
}
