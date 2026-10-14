/**
 * llmWorker.ts — WebLLM Dedicated Web Worker
 *
 * 在独立的后台工作线程中使用 WebGPU 运行大语言模型,
 * 确保千万次矩阵乘法推理过程中,浏览器主线程的 Three.js 3D 渲染保持 60 FPS 绝对丝滑!
 *
 * "xcModelList" is our extension for the thin main-thread client (webllmThinClient.ts): it returns
 * prebuiltAppConfig.model_list so the main thread never has to import @mlc-ai/web-llm.
 */

import './polyfill';
import { WebWorkerMLCEngineHandler, prebuiltAppConfig } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
  const d = msg.data as { kind?: string; uuid?: string } | undefined;
  if (d?.kind === 'xcModelList') {
    self.postMessage({ kind: 'return', uuid: d.uuid, content: prebuiltAppConfig.model_list });
    return;
  }
  handler.onmessage(msg);
};
