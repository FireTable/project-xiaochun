import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';
import { localApiPlugin } from './vite/localApiPlugin';
import { dropDockerfatAssets } from './vite/dropDockerfatAssets';

export default defineConfig({
  plugins: [
    basicSsl(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    react(),
    // ponytail: TTS_PROXY_URL 走 loadEnv 读 .env.local, EU 出口连不上 Microsoft 时反代到远端。
    localApiPlugin(loadEnv('development', process.cwd(), '').TTS_PROXY_URL?.trim()),
    dropDockerfatAssets(),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  ssr: {
    noExternal: ['@/components/ui/dropdown-menu'],
  },
  server: {
    host: '0.0.0.0',
    port: 5185,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5185,
  },
  build: {
    target: 'es2022',
  },
  optimizeDeps: {
    exclude: ['@mlc-ai/web-llm'],
  },
});