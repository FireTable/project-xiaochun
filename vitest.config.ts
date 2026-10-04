import path from 'node:path';
import { defineConfig } from 'vitest/config';

// 单测只覆盖纯逻辑层 (src/core/gesture, 无 DOM / three / Tauri 依赖), 用 node 环境即可。
// 刻意不复用 vite.config.ts (它带 Cloudflare / Tailwind / Tauri 相关插件, 单测用不到)。
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
