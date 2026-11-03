/**
 * dropDockerfatAssets — Cloudflare Pages 单文件上限 25 MiB,生产 bundle 需要去掉:
 * 1. onnxruntime-web 的 ort-wasm-simd-threaded*.wasm(jsep 变体 26.5 MiB 超限; 非 JSEP 13.3 MiB 也改走 CDN)
 *    各 ORT 调用方 import 'onnxruntime-web/wasm'(非 JSEP) 并设 ort.env.wasm.wasmPaths 指向
 *    APP_CONFIG.ort.wasmBase(自有 CDN xiaochun/ort/<version>/),运行时根本不用本地这份。
 *    generateBundle 钩子兜底删 —— WASM 走 Rollup bundle。
 * 2. EMAGE ONNX 模型(emage_step.onnx 504 MB + 6 个 VQ 30 MB)
 *    生产走 R2(VITE_EMAGE_BASE_PROD 默认 https://cdn.firetable.tech/xiaochun/emage/),
 *    本地 dev 仍读 public/onnx 软链 —— dist/ 删掉不影响本地文件。
 *    ONNX 来自 publicDir 拷贝,generateBundle 看不到,用 closeBundle 钩子从磁盘删。
 *
 * ponytail: 两类都删,运行时不碰(都走 CDN)。
 */

import path from 'path';
import type { Plugin } from 'vite';

export function dropDockerfatAssets(): Plugin {
  return {
    name: 'drop-dockerfat-assets',
    generateBundle(_options, bundle) {
      for (const file of Object.keys(bundle)) {
        // ORT runtime wasm (含 jsep/jspi/asyncify 变体及 onnxruntime-web/wasm 构建里 new URL(..., import.meta.url) 引出的
        // 带 hash 文件, 如 ort-wasm-simd-threaded-<hash>.wasm 13.3 MiB): 一律不进产物, 运行时由 wasmPaths 指向自有 CDN。
        if (/(^|\/)ort-wasm-simd-threaded[^/]*\.wasm$/.test(file)) {
          delete bundle[file];
        }
      }
    },
    async closeBundle() {
      const fs = await import('node:fs/promises');
      const nodePath = await import('node:path');
      const onnxDir = nodePath.resolve(import.meta.dirname, 'dist/client/onnx');
      try {
        const files = await fs.readdir(onnxDir);
        for (const f of files) {
          if (f.endsWith('.onnx')) {
            await fs.unlink(nodePath.join(onnxDir, f));
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