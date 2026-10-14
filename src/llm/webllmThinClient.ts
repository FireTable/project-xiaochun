/**
 * Thin main-thread client for web-llm's WebWorkerMLCEngineHandler.
 *
 * @mlc-ai/web-llm ships as a single ~6.5 MB ESM file that cannot be tree-shaken: importing only
 * `CreateWebWorkerMLCEngine` still evaluates all of it on the main thread. The client half of the protocol is small,
 * so it is re-implemented here and the library only ever loads inside llmWorker.ts.
 *
 * PROTOCOL PIN: mirrors WebWorkerMLCEngine of @mlc-ai/web-llm 0.2.84 (lib/index.js, class WebWorkerMLCEngine).
 * Messages are { kind, uuid, content }; the handler answers each request with kind "return" | "throw" (content = the
 * error's toString()), and pushes { kind: "initProgressCallback", uuid: "" } during reload. Streaming: one
 * "chatCompletionStreamInit", then one "completionStreamNextChunk" per chunk until the reply is not an object.
 * webllmThinClient.test.ts fails when the installed version changes, so re-check this file on every upgrade.
 * "xcModelList" is our own request, answered by llmWorker.ts with prebuiltAppConfig.model_list.
 */
import type {
  AppConfig,
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatOptions,
  InitProgressReport,
  ModelRecord,
} from '@mlc-ai/web-llm';

export const WEBLLM_PROTOCOL_VERSION = '0.2.84';

type Msg = { kind: string; uuid: string; content: unknown };
type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

const uuid = () => crypto.randomUUID();

export class ThinMLCEngine {
  private readonly pending = new Map<string, Pending>();
  private modelId: string[] | undefined;
  private chatOpts: ChatOptions[] | undefined;
  initProgressCallback: ((r: InitProgressReport) => void) | undefined;

  readonly chat = {
    completions: {
      create: (request: ChatCompletionRequest) => this.chatCompletion(request),
    },
  };

  readonly worker: Worker;

  constructor(worker: Worker, cfg?: { appConfig?: AppConfig; initProgressCallback?: (r: InitProgressReport) => void }) {
    this.worker = worker;
    worker.onmessage = (e: MessageEvent) => this.onmessage(e.data as Msg);
    worker.onerror = (e) => this.dispose(new Error(`LLM worker error: ${e.message || 'unknown'}`));
    if (cfg?.appConfig) this.setAppConfig(cfg.appConfig);
    this.initProgressCallback = cfg?.initProgressCallback;
  }

  /** Reject every in-flight request (worker terminated or crashed), so no caller hangs forever. */
  dispose(reason: unknown = new Error('LLM worker terminated')): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) p.reject(reason);
  }

  setAppConfig(appConfig: AppConfig): void {
    this.post({ kind: 'setAppConfig', uuid: uuid(), content: appConfig });
  }

  private post(msg: Msg): void {
    this.worker.postMessage(msg);
  }

  private request<T = unknown>(kind: string, content: unknown): Promise<T> {
    const id = uuid();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ kind, uuid: id, content });
    });
  }

  private onmessage(msg: Msg): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind === 'initProgressCallback') {
      this.initProgressCallback?.(msg.content as InitProgressReport);
      return;
    }
    if (msg.kind === 'return' || msg.kind === 'throw') {
      const p = this.pending.get(msg.uuid);
      if (!p) return;
      this.pending.delete(msg.uuid);
      if (msg.kind === 'return') p.resolve(msg.content);
      else p.reject(new Error(String(msg.content)));
      return;
    }
    console.warn('[webllmThinClient] unknown message kind from worker:', msg.kind);
  }

  /** prebuiltAppConfig.model_list from inside the worker (our "xcModelList" extension). */
  getModelList(): Promise<ModelRecord[]> {
    return this.request<ModelRecord[]>('xcModelList', null);
  }

  async reload(modelId: string | string[], chatOpts?: ChatOptions | ChatOptions[]): Promise<void> {
    const ids = Array.isArray(modelId) ? modelId : [modelId];
    const opts = chatOpts === undefined ? undefined : Array.isArray(chatOpts) ? chatOpts : [chatOpts];
    await this.request('reload', { modelId: ids, chatOpts: opts });
    this.modelId = ids;
    this.chatOpts = opts;
  }

  async unload(): Promise<void> {
    await this.request('unload', null);
    this.modelId = undefined;
    this.chatOpts = undefined;
  }

  resetChat(keepStats = false, modelId?: string): Promise<void> {
    return this.request('resetChat', { keepStats, modelId });
  }

  interruptGenerate(): void {
    void this.request('interruptGenerate', null).catch(() => {});
  }

  getMessage(modelId?: string): Promise<string> {
    return this.request('getMessage', { modelId });
  }

  runtimeStatsText(modelId?: string): Promise<string> {
    return this.request('runtimeStatsText', { modelId });
  }

  /** Same rule as web-llm's getModelIdToUse for the single-model case we use. */
  private selectModel(requested?: string | null): string {
    const loaded = this.modelId ?? [];
    if (requested) {
      if (!loaded.includes(requested)) throw new Error(`Specified model ${requested} for ChatCompletionRequest is not found in loaded models: ${loaded.join(', ')}`);
      return requested;
    }
    if (loaded.length !== 1) throw new Error('Multiple models loaded; ChatCompletionRequest.model must be set');
    return loaded[0]!;
  }

  chatCompletion(request: ChatCompletionRequest & { stream: true }): Promise<AsyncIterable<ChatCompletionChunk>>;
  chatCompletion(request: ChatCompletionRequest): Promise<AsyncIterable<ChatCompletionChunk> | ChatCompletion>;
  async chatCompletion(request: ChatCompletionRequest): Promise<AsyncIterable<ChatCompletionChunk> | ChatCompletion> {
    if (this.modelId === undefined) throw new Error('WebWorkerMLCEngine: model not loaded; call reload() first');
    const selectedModelId = this.selectModel(request.model);
    if (request.stream) {
      await this.request('chatCompletionStreamInit', { request, selectedModelId, modelId: this.modelId, chatOpts: this.chatOpts });
      return this.streamChunks(selectedModelId);
    }
    return this.request<ChatCompletion>('chatCompletionNonStreaming', { request, modelId: this.modelId, chatOpts: this.chatOpts });
  }

  private async *streamChunks(selectedModelId: string): AsyncGenerator<ChatCompletionChunk> {
    while (true) {
      const ret = await this.request<ChatCompletionChunk | void>('completionStreamNextChunk', { selectedModelId });
      if (typeof ret !== 'object' || ret === null) return;
      yield ret;
    }
  }
}
