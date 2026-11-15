export const DUPLEX_TURN_CLASSES = [
  'COMPLETE',
  'INCOMPLETE',
  'BACKCHANNEL',
  'WAIT_INTERRUPT',
] as const;

export type DuplexTurnClass = (typeof DUPLEX_TURN_CLASSES)[number];

export type DuplexTurnProbs = Record<DuplexTurnClass, number>;

export interface DuplexTurnPrediction {
  label: DuplexTurnClass;
  probs: DuplexTurnProbs;
  confidence: number;
  inferMs: number;
  backend: 'wasm-simd';
}

export interface BimodalTurnInput {
  probs: DuplexTurnProbs;
  stableText: string;
  tailText: string;
  pauseMs: number;
  assistantSpeaking: boolean;
  speechDurationMs: number;
  rmsDb?: number;
}

export type BimodalAction =
  | 'CONTINUE_WAITING'
  | 'HOLD_SOFT'
  | 'BACKCHANNEL_ACK'
  | 'COMMIT_USER_TURN'
  | 'BARGE_IN_COMMIT'
  | 'WAIT_SILENT_HOLD';

export interface BimodalTurnDecision {
  action: BimodalAction;
  turnClass: DuplexTurnClass;
  probs: DuplexTurnProbs;
  reason: string;
  pauseMs: number;
  combinedText: string;
}

export interface DuplexTurnManifest {
  version: string;
  backbone: string;
  classes: readonly DuplexTurnClass[];
  temperature: number;
  inputShape: [number, number, number];
  sampleRate: number;
  windowSeconds: number;
  maxSamples: number;
  paddingSide: 'left';
  modelFile: string;
  modelBytes: number;
}

export interface DuplexTurnClientOptions {
  modelUrl?: string;
  manifestUrl?: string;
  wasmPaths?: string;
  loopback?: boolean;
  numThreads?: number;
  temperature?: number;
}
