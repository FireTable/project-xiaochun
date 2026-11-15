/**
 * src/live/router/types.ts
 *
 * Public interfaces and communication types for Bilingual Intent Router.
 * Satisfies contracts from both PROJECT.md and SCOPE.md:
 * - Both `predict()` and `classify()` are supported
 * - Both `probabilities` and `scores = probabilities` are provided
 * - Both `guardrail` and `neural` sources are distinguished
 */

export type IntentClass = 'CHAT' | 'HEAVY';

export interface IntentProbabilities {
  CHAT: number;
  HEAVY: number;
}

export interface IntentPrediction {
  intent: IntentClass;
  confidence: number;
  probabilities: IntentProbabilities;
  scores: IntentProbabilities;
  latencyMs: number;
  source: 'guardrail' | 'neural';
  guardrailTriggered?: string;
}

export interface IntentManifest {
  version: string;
  architecture: string;
  classes: IntentClass[];
  maxSeqLen: number;
  vocabSize: number;
  temperature: number;
  confidenceThreshold: number;
  modelFile: string;
  modelBytes: number;
  vocabFile: string;
  quantization: string;
  inputNames: string[];
  outputNames: string[];
}

export interface IntentRouterClientOptions {
  modelUrl?: string;
  manifestUrl?: string;
  vocabUrl?: string;
  wasmPaths?: string;
  loopback?: boolean;
  numThreads?: number;
  confidenceThreshold?: number;
  forceNodeFallback?: boolean;
}

export interface IntentRouterClient {
  init(options?: Partial<IntentRouterClientOptions>): Promise<void>;
  predict(text: string): Promise<IntentPrediction>;
  classify(text: string): Promise<IntentPrediction>;
  warmup(): Promise<number>;
  isReady(): boolean;
  dispose(): Promise<void> | void;
}

export type WorkerInboundMsg =
  | {
      type: 'init';
      id: number;
      modelUrl?: string;
      manifestUrl?: string;
      vocabUrl?: string;
      wasmPaths?: string;
      loopback?: boolean;
      numThreads?: number;
      confidenceThreshold?: number;
    }
  | { type: 'predict'; id: number; text: string }
  | { type: 'warmup'; id: number }
  | { type: 'dispose'; id: number };

export type WorkerInboundPayload =
  | {
      type: 'init';
      modelUrl?: string;
      manifestUrl?: string;
      vocabUrl?: string;
      wasmPaths?: string;
      loopback?: boolean;
      numThreads?: number;
      confidenceThreshold?: number;
    }
  | { type: 'predict'; text: string }
  | { type: 'warmup' }
  | { type: 'dispose' };

export type WorkerOutboundMsg =
  | { type: 'ready'; id: number; manifest: Partial<IntentManifest> }
  | { type: 'prediction'; id: number; result: IntentPrediction }
  | { type: 'warmed'; id: number; latencyMs: number }
  | { type: 'disposed'; id: number }
  | { type: 'error'; id: number; message: string };
