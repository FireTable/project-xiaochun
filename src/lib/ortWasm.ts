/**
 * ortWasm.ts — onnxruntime-web wasmPaths 解析 (四处 ORT 调用方共用)。
 * 回环代理 (Cindy) 走 '/wasm/'；其余走 APP_CONFIG.ort.wasmBase (生产 = 自有 CDN，dev = node_modules)。
 * 结果必须以 '/' 结尾 (ORT 直接拼接文件名)。
 */
import { APP_CONFIG } from '@/config';

export const ORT_LOOPBACK_WASM_PATH = '/wasm/';

export function resolveOrtWasmPaths(loopback: boolean): string {
  if (loopback) return ORT_LOOPBACK_WASM_PATH;
  const base = APP_CONFIG.ort.wasmBase;
  return base.endsWith('/') ? base : `${base}/`;
}
