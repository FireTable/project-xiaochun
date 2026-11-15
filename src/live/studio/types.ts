/**
 * types.ts — Contracts for the Standalone Bilingual Full-Duplex Experiment Console (`live-studio.html`).
 */

import type { DuplexTurnClass, DuplexTurnProbs } from '@/live/turn/types';
import type { LiveEmotionTag, TtsEngineMode } from '@/live/tts/types';

export type StudioTurnState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'backchannel';

export type HeavyEndpointMode = 'local-think' | 'custom-openai';

export type ScenarioId =
  | 'zh_banter'
  | 'en_cs_banter'
  | 'backchannel_hold'
  | 'barge_in_kv_truncation'
  | 'heavy_delegate_amend';

export interface StudioHeavySettings {
  mode: HeavyEndpointMode;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface StudioPersistConfig {
  ttsMode: TtsEngineMode;
  heavy: StudioHeavySettings;
}

export interface ModelStatusSnapshot {
  webgpuBrain: 'unloaded' | 'loading' | 'ready' | 'error';
  duplexTurn: 'unloaded' | 'loading' | 'ready' | 'error';
  kokoroTts: 'unloaded' | 'loading' | 'ready' | 'error';
  warmEdgeTts: 'unloaded' | 'warming' | 'ready' | 'error';
  embedStage: 'booting' | 'ready' | 'error';
}

export interface StageMetrics {
  fps: number;
  minFpsWindow: number;
  avgFrameMs: number;
  maxFrameMs: number;
  jankOver25: number;
  jankOver50: number;
  turnState: StudioTurnState;
  expression: LiveEmotionTag | string;
  bubbleText: string;
  micLevel: number;
  speakerLevel: number;
  echoDucking: boolean;
  inferenceActive: boolean;
  embedReady: boolean;
}

export interface LiveTelemetryRow {
  seq: number;
  ts: string;
  scenario: string;
  input: string;
  replyPreview: string;
  turnLabel: DuplexTurnClass | string;
  turnProbs?: DuplexTurnProbs;
  speculativeHit: boolean;
  ttftMs: number | null;
  ttsTtfaMs: number | null;
  firstSoundMs: number | null;
  minFps: number | null;
  jank25: number;
  jank50: number;
  wasInterrupted: boolean;
  ttsEngine: string;
  notes: string;
}

export interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'heavy';
  text: string;
  langHint?: 'zh' | 'en' | 'mixed';
  emotion?: LiveEmotionTag | string;
  interrupted?: boolean;
  delegateTaskId?: string;
  ts: number;
}

export interface ScenarioRunResult {
  id: ScenarioId;
  name: string;
  passed: boolean;
  durationMs: number;
  assertions: Array<{ label: string; ok: boolean; detail?: string }>;
  telemetry?: LiveTelemetryRow;
  error?: string;
}

export interface LiveStudioBridgeApi {
  readonly intentRouter?: {
    predict(text: string): Promise<{
      intent: string;
      confidence: number;
      latencyMs: number;
      source: string;
    }>;
    isReady(): boolean;
  };
  initAll(opts?: { includeBrain?: boolean }): Promise<ModelStatusSnapshot>;
  loadBrain(): Promise<ModelStatusSnapshot>;
  runScenario(id: ScenarioId): Promise<ScenarioRunResult>;
  runAllScenarios(): Promise<ScenarioRunResult[]>;
  getTelemetry(): {
    models: ModelStatusSnapshot;
    stage: StageMetrics;
    rows: LiveTelemetryRow[];
    transcript: TranscriptEntry[];
    scenarios: Record<string, ScenarioRunResult>;
  };
  sendTextTurn(text: string): Promise<void>;
  simulateVoiceTurn(pcmOrText: Float32Array | string): Promise<void>;
  triggerBargeIn(text: string): Promise<void>;
  setTtsMode(mode: TtsEngineMode): void;
}
