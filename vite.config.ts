import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { EdgeTTS } from 'edge-tts-universal';

/**
 * dropOnnxWasm — Cloudflare Pages 单文件上限 25 MiB,onnxruntime-web 的
 * ort-wasm-simd-threaded.jsep.wasm(WebGPU EP variant)单文件 26.5 MiB,超限。
 * EMAGE 已在 src/motion/emageWorker.ts 设 ort.env.wasm.wasmPaths 指向 jsDelivr,
 * 运行时根本不用本地这份 WASM,Vite 是因为静态 import.meta.url 把它顺手打包了。
 * ponytail: 从最终 bundle 里直接删掉,运行时照样走 CDN,Cloudflare 上传不报错。
 */
function dropOnnxWasm(): Plugin {
  return {
    name: 'drop-onnx-wasm',
    generateBundle(_options, bundle) {
      for (const file of Object.keys(bundle)) {
        if (file.includes('ort-wasm-simd-threaded.jsep') && file.endsWith('.wasm')) {
          delete bundle[file];
        }
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
  plugins: [tailwindcss(), tanstackStart(), react(), localApiPlugin(), dropOnnxWasm()],
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