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
    return <div className="w-full h-screen bg-[#0a0812]" />;
  }

  return (
    <React.Suspense fallback={null}>
      <ClientApp />
    </React.Suspense>
  );
}
