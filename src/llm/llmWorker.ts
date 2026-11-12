/**
 * llmWorker.ts — WebLLM Dedicated Web Worker
 *
 * 在独立的后台工作线程中使用 WebGPU 运行大语言模型,
 * 配合 @firetable/web-runtime 与 @firetable/web-llm 的协同帧率节流 (Frame Pacing),
 * 确保首次加载权重、WGSL 着色器编译与多模态推理期间,浏览器主线程的 Three.js 3D 渲染保持丝滑!
 *
 * Custom worker protocol extensions for ThinMLCEngine (webllmThinClient.ts):
 * - "xcModelList": returns prebuiltAppConfig.model_list without loading @mlc-ai/web-llm on main thread.
 * - "xcSetFramePacing": dynamically toggles cooperative WebGPU frame pacing ('smooth' vs hidden-tab 'turbo').
 */

import './polyfill';
import {
  WebWorkerMLCEngineHandler,
  prebuiltAppConfig,
  setWebGPUFramePacing,
  type WebGPUFramePacingOptions,
} from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
  const d = msg.data as { kind?: string; uuid?: string; content?: unknown } | undefined;
  if (d?.kind === 'xcModelList') {
    self.postMessage({ kind: 'return', uuid: d.uuid, content: prebuiltAppConfig.model_list });
    return;
  }
  if (d?.kind === 'xcSetFramePacing') {
    setWebGPUFramePacing((d.content ?? {}) as Partial<WebGPUFramePacingOptions>);
    return;
  }
  handler.onmessage(msg);
};
