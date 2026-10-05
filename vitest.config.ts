import path from 'node:path';
import { defineConfig } from 'vitest/config';

// 单测只覆盖纯逻辑层 (src/core/gesture, 无 DOM / three / Tauri 依赖), 用 node 环境即可。
// 刻意不复用 vite.config.ts (它带 Cloudflare / Tailwind / Tauri 相关插件, 单测用不到)。
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // 与 vite.config.ts 一致: 协议常量源码直引 (src/embed/params.ts 等会 import)
      '@firetable/project-xiaochun/protocol': path.resolve(import.meta.dirname, 'packages/project-xiaochun/src/protocol.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
