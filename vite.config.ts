import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import path from 'path';
import { EdgeTTS } from 'edge-tts-universal';

/**
 * dropDockerfatAssets — Cloudflare Pages 单文件上限 25 MiB,生产 bundle 需要去掉:
 * 1. onnxruntime-web 的 ort-wasm-simd-threaded.jsep.wasm(WebGPU EP variant,26.5 MiB)
 *    EMAGE 已在 src/motion/emageWorker.ts 设 ort.env.wasm.wasmPaths 指向 jsDelivr
 *    CDN,运行时根本不用本地这份。generateBundle 钩子删 —— WASM 走 Rollup bundle。
 * 2. EMAGE ONNX 模型(emage_step.onnx 504 MB + 6 个 VQ 30 MB)
 *    生产走 R2(VITE_EMAGE_BASE=https://cdn.firetable.tech/xiaochun/),
 *    本地 dev 仍读 public/onnx 软链 —— dist/ 删掉不影响本地文件。
 *    ONNX 来自 publicDir 拷贝,generateBundle 看不到,用 closeBundle 钩子从磁盘删。
 *
 * ponytail: 两类都删,运行时不碰(都走 CDN)。
 */
function dropDockerfatAssets(): Plugin {
  return {
    name: 'drop-dockerfat-assets',
    generateBundle(_options, bundle) {
      for (const file of Object.keys(bundle)) {
        if (file.includes('ort-wasm-simd-threaded.jsep') && file.endsWith('.wasm')) {
          delete bundle[file];
        }
      }
    },
    async closeBundle() {
      // 删除 publicDir 拷贝过去的 ONNX,本地源文件不动
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const onnxDir = path.resolve(import.meta.dirname, 'dist/client/onnx');
      try {
        // 1. 删除 publicDir 拷贝过去的 ONNX,本地源文件不动
        const files = await fs.readdir(onnxDir);
        for (const f of files) {
          if (f.endsWith('.onnx')) {
            await fs.unlink(path.join(onnxDir, f));
            console.log(`[dropDockerfatAssets] removed dist/client/onnx/${f}`);
          }
        }
      } catch (e: any) {
        if (e.code !== 'ENOENT') console.warn('[dropDockerfatAssets]', e.message);
      }

      // 2. 删除误入 dist/server/assets 的客户端专用 Web Worker 脚本 (llmWorker, emageWorker)
      // 避免 Workers 超过 3 MiB 免费限制
      const serverAssetsDir = path.resolve(import.meta.dirname, 'dist/server/assets');
      try {
        const sFiles = await fs.readdir(serverAssetsDir);
        for (const f of sFiles) {
          if (f.includes('Worker') || f.includes('emageWorker') || f.includes('llmWorker')) {
            await fs.unlink(path.join(serverAssetsDir, f));
            console.log(`[dropDockerfatAssets] removed unused server asset: dist/server/assets/${f}`);
          }
        }
      } catch (e: any) {
        if (e.code !== 'ENOENT') console.warn('[dropDockerfatAssets]', e.message);
      }
    },
  };
}

/**
 * localApiPlugin — 本地开发原生全功能中间件:
 * 1. 提供 /api/tts 小蠢语音合成 (完全脱离 Python server.py)
 * 2. 生产环境部署到 Cloudflare Pages 时，由 functions/api/tts.ts 原生无缝接管
 */
function localApiPlugin(): Plugin {
  return {
    name: 'local-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const host = req.headers.host || 'localhost:5185';
        const url = new URL(req.url || '', `http://${host}`);

        // 2. 本地 Node 极速处理 /api/tts (完全脱离 Python 服务)
        if (url.pathname === '/api/tts') {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.end();
            return;
          }

          let bodyText = '';
          req.on('data', (chunk) => { bodyText += chunk; });
          req.on('end', async () => {
            try {
              let text = url.searchParams.get('text') || '';
              let voice = url.searchParams.get('voice') || 'zh-CN-XiaoyiNeural';
              let pitch = url.searchParams.get('pitch') || '+10Hz';

              if (bodyText) {
                try {
                  const parsed = JSON.parse(bodyText);
                  if (parsed.text) text = parsed.text;
                  if (parsed.voice) voice = parsed.voice;
                  if (parsed.pitch) pitch = parsed.pitch;
                } catch {}
              }

              if (!text.trim()) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'text is required' }));
                return;
              }

              const tts = new EdgeTTS(text.trim(), voice, { pitch, rate: '+0%' });
              const result = await tts.synthesize();
              const buffer = Buffer.from(await result.audio.arrayBuffer());
              res.setHeader('Content-Type', 'audio/mpeg');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Cache-Control', 'public, max-age=86400');
              res.end(buffer);
            } catch (err: any) {
              console.error('[Local Vite TTS Error]', err);
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: String(err?.message || err) }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    react(),
    localApiPlugin(),
    dropDockerfatAssets(),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web', '@mlc-ai/web-llm'],
  },
  ssr: {
    noExternal: ['lucide-react'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@mlc-ai/web-llm')) {
            return 'vendor-webllm';
          }
          if (id.includes('node_modules/three') || id.includes('@pixiv/three-vrm')) {
            return 'vendor-three';
          }
        },
      },
    },
  },
  server: {
    port: 5185,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
});