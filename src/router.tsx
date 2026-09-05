import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function createRouter() {
  // ponytail: tsconfig 没开 strictNullChecks,TanStack Router 强类型断言会红,这里 any 兜底
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
  } as any);
}

export function getRouter() {
  return createRouter();
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}