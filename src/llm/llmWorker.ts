/**
 * llmWorker.ts — WebLLM Dedicated Web Worker
 * 
 * 在独立的后台工作线程中使用 WebGPU 运行轻量大语言模型 (Qwen3 0.6B q4f16_1)，
 * 确保千万次矩阵乘法推理过程中，浏览器主线程的 Three.js 3D 渲染保持 60 FPS 绝对丝滑！
 */

import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
