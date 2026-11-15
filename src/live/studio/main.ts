/**
 * main.ts — Standalone Bilingual Full-Duplex Experiment Console (`public/live-studio.html`).
 *
 * Connects:
 * - Left Stage: `/embed?scene=beach3d&preset=normal` over same-origin `MessageChannel`
 *   with `xc.audio.begin` (`live: true`, `firstSliceSec: 0.32`), `xc.audio.chunk`,
 *   `xc.clock`, `xc.turnState`, `xc.expression`, `xc.bubble`, `xc.inference.state`.
 * - Right Console: WebGPU `MiniCPM5-2B` (with stateful KV fallback when unloaded),
 *   `DuplexTurnClient` + `decideBimodalTurn`, `DuplexEar` (16kHz VAD/ASR + 0.56x echo ducking),
 *   `StudioTtsRouter` (Warm Edge-TTS + Local Kokoro), `LiveSpeechPlayer` (24kHz WebAudio + 45ms fade),
 *   and 5-Scenario Automated E2E Verification Harness (`window.__LIVE_STUDIO__`).
 */

import './studio.css';
import {
  getActiveModelId,
  getWebLLMEngine,
  isWebLLMReady,
  resetWebLLMChat,
} from '@/llm/webLLMProvider';
import { recallForChat } from '@/memory';
import { LiveOrchestrator } from '@/live/brain/liveOrchestrator';
import { createIntentRouterClient, type IntentRouterClient } from '@/live/router';
import type { BrainMessage, HeavyWorkerConfig, LiveLanguageHint } from '@/live/brain/types';
import { DuplexEar } from '@/live/audio/duplexEar';
import { LiveSpeechPlayer, type AudioContextLike } from '@/live/audio/liveSpeechPlayer';
import { DuplexTurnClient } from '@/live/turn/duplexTurnClient';
import { decideBimodalTurn } from '@/live/turn/bimodalTurnFusion';
import type { BimodalTurnDecision, DuplexTurnProbs } from '@/live/turn/types';
import { detectLanguageHint } from '@/live/tts/affectiveClauseSlicer';
import type { LiveEmotionTag, TtsEngineMode } from '@/live/tts/types';
import { EmbedStageClient, FrameCadenceMonitor } from './embedHost';
import {
  createDynamicStudioKvAdapter,
  synthesizeOfflineFallbackPcm24k,
} from './fallbackKvAdapter';
import {
  SCENARIO_ORDER,
  SCENARIO_TITLES,
  executeAllVerificationScenarios,
  executeVerificationScenario,
  synthesizeSimulatedUserSpeech16k,
  type ScenarioRuntimeController,
  type TurnExecutionOutcome,
} from './scenarioHarness';
import { TelemetryStore } from './telemetry';
import { StudioTtsRouter } from './ttsRouter';
import type {
  HeavyEndpointMode,
  LiveStudioBridgeApi,
  ModelStatusSnapshot,
  ScenarioId,
  ScenarioRunResult,
  StageMetrics,
  StudioPersistConfig,
  StudioTurnState,
} from './types';

const STORAGE_KEY = 'xiaochun_live_studio_cfg_v1';

declare global {
  interface Window {
    __LIVE_STUDIO__?: LiveStudioBridgeApi;
  }
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing Live Studio element #${id}`);
  return node as T;
}

function loadPersistedConfig(): StudioPersistConfig {
  const fallback: StudioPersistConfig = {
    ttsMode: 'auto',
    heavy: {
      mode: 'local-think',
      baseUrl: '',
      apiKey: '',
      model: '',
    },
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StudioPersistConfig>;
    return {
      ttsMode:
        parsed.ttsMode === 'edge-warm' ||
        parsed.ttsMode === 'kokoro-local' ||
        parsed.ttsMode === 'auto'
          ? parsed.ttsMode
          : 'auto',
      heavy: {
        mode: parsed.heavy?.mode === 'custom-openai' ? 'custom-openai' : 'local-think',
        baseUrl: typeof parsed.heavy?.baseUrl === 'string' ? parsed.heavy.baseUrl : '',
        apiKey: typeof parsed.heavy?.apiKey === 'string' ? parsed.heavy.apiKey : '',
        model: typeof parsed.heavy?.model === 'string' ? parsed.heavy.model : '',
      },
    };
  } catch {
    return fallback;
  }
}

function savePersistedConfig(cfg: StudioPersistConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore storage quota errors
  }
}

function toHeavyWorkerConfig(cfg: StudioPersistConfig): HeavyWorkerConfig {
  return {
    mode: cfg.heavy.mode === 'custom-openai' ? 'custom-openai' : 'local-thinking',
    apiBaseUrl: cfg.heavy.baseUrl.trim() || undefined,
    apiKey: cfg.heavy.apiKey.trim() || undefined,
    model: cfg.heavy.model.trim() || undefined,
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function inferFallbackProbs(params: {
  pauseMs: number;
  speechDurationMs: number;
  assistantSpeaking: boolean;
  hintedProbs?: DuplexTurnProbs;
}): DuplexTurnProbs {
  if (params.hintedProbs) return params.hintedProbs;
  if (params.assistantSpeaking) {
    if (params.speechDurationMs <= 500) {
      return { COMPLETE: 0.12, INCOMPLETE: 0.14, BACKCHANNEL: 0.68, WAIT_INTERRUPT: 0.06 };
    }
    return { COMPLETE: 0.25, INCOMPLETE: 0.1, BACKCHANNEL: 0.05, WAIT_INTERRUPT: 0.6 };
  }
  if (params.pauseMs < 300) {
    return { COMPLETE: 0.28, INCOMPLETE: 0.62, BACKCHANNEL: 0.05, WAIT_INTERRUPT: 0.05 };
  }
  return { COMPLETE: 0.82, INCOMPLETE: 0.12, BACKCHANNEL: 0.04, WAIT_INTERRUPT: 0.02 };
}

class LiveStudioController implements ScenarioRuntimeController, LiveStudioBridgeApi {
  readonly orchestrator: LiveOrchestrator;
  readonly ear: DuplexEar;
  player!: LiveSpeechPlayer;
  readonly duplexTurn: DuplexTurnClient;
  readonly ttsRouter: StudioTtsRouter;
  readonly embedHost: EmbedStageClient;
  readonly cadence: FrameCadenceMonitor;
  readonly telemetry: TelemetryStore;
  readonly intentRouter: IntentRouterClient;

  private config: StudioPersistConfig;
  private models: ModelStatusSnapshot;
  private turnState: StudioTurnState = 'idle';
  private currentExpression: LiveEmotionTag | string = 'neutral';
  private bubbleText = '';
  private inferenceActive = false;
  private micDb = -60;
  private speakerRms = 0;
  private echoDucking = false;
  private hasRealAudioCtx = false;

  private speechAbortController = new AbortController();
  private speechQueueChain: Promise<void> = Promise.resolve();
  private speechSessionSeq = 0;
  private currentTurnDelegateStartMs: number | null = null;
  private currentTurnStartMs = 0;
  private currentTurnHeavyChunks: string[] = [];
  private activeAssistantEntryId: string | null = null;
  private activeHeavyEntryId: string | null = null;

  private hookDelegateStarted: (() => void) | null = null;
  private hookHeavyClause: ((text: string, emotion: LiveEmotionTag) => void) | null = null;

  private drainWaiters = new Set<() => void>();
  private scenarioResults: Record<string, ScenarioRunResult> = {};
  private hudRenderTimer = 0;
  private initPromise: Promise<ModelStatusSnapshot> | null = null;
  private micStarting = false;
  private liveProbeInFlight = false;
  private pendingLiveProbeArgs: {
    pcm16k: Float32Array;
    stableText: string;
    tailText: string;
    pauseMs: number;
    speechDurationMs: number;
    rmsDb: number;
    assistantSpeaking: boolean;
  } | null = null;
  private liveSpeculativeText = '';
  private liveDraftUserEntryId: string | null = null;

  // DOM references
  private readonly dom = {
    embedIframe: el<HTMLIFrameElement>('embed-stage'),
    embedStatus: el<HTMLSpanElement>('stage-embed-status'),
    btnInitAll: el<HTMLButtonElement>('btn-init-all'),
    hudFps: el<HTMLElement>('hud-fps'),
    hudMaxMs: el<HTMLElement>('hud-max-ms'),
    hudJank: el<HTMLElement>('hud-jank'),
    hudTurnState: el<HTMLElement>('hud-turn-state'),
    hudExpr: el<HTMLElement>('hud-expr'),
    hudInfer: el<HTMLElement>('hud-infer'),
    meterMicFill: el<HTMLDivElement>('meter-mic-fill'),
    hudMicDb: el<HTMLSpanElement>('hud-mic-db'),
    meterSpkFill: el<HTMLDivElement>('meter-spk-fill'),
    hudEchoDuck: el<HTMLSpanElement>('hud-echo-duck'),
    hudBubbleText: el<HTMLParagraphElement>('hud-bubble-text'),

    statusBrain: el<HTMLSpanElement>('status-brain'),
    btnLoadBrain: el<HTMLButtonElement>('btn-load-brain'),
    statusTurn: el<HTMLSpanElement>('status-turn'),
    btnLoadTurn: el<HTMLButtonElement>('btn-load-turn'),
    statusTts: el<HTMLSpanElement>('status-tts'),
    selectTtsMode: el<HTMLSelectElement>('select-tts-mode'),
    btnLoadKokoro: el<HTMLButtonElement>('btn-load-kokoro'),
    statusHeavy: el<HTMLSpanElement>('status-heavy'),
    selectHeavyMode: el<HTMLSelectElement>('select-heavy-mode'),
    customOpenAiFields: el<HTMLDivElement>('custom-openai-fields'),
    inputOpenAiBase: el<HTMLInputElement>('input-openai-base'),
    inputOpenAiKey: el<HTMLInputElement>('input-openai-key'),
    inputOpenAiModel: el<HTMLInputElement>('input-openai-model'),

    btnMicToggle: el<HTMLButtonElement>('btn-mic-toggle'),
    btnRunSuite: el<HTMLButtonElement>('btn-run-suite'),
    btnStopTurn: el<HTMLButtonElement>('btn-stop-turn'),
    btnClearLog: el<HTMLButtonElement>('btn-clear-log'),
    manualForm: el<HTMLFormElement>('manual-turn-form'),
    inputManualText: el<HTMLInputElement>('input-manual-text'),

    scenarioOverall: el<HTMLSpanElement>('scenario-overall'),
    scenarioList: el<HTMLDivElement>('scenario-list'),
    transcriptCount: el<HTMLSpanElement>('transcript-count'),
    transcriptLog: el<HTMLDivElement>('transcript-log'),
    telemetryCount: el<HTMLSpanElement>('telemetry-count'),
    telemetryTbody: el<HTMLTableSectionElement>('telemetry-tbody'),
  };

  constructor() {
    this.config = loadPersistedConfig();
    this.models = {
      webgpuBrain: isWebLLMReady() ? 'ready' : 'unloaded',
      duplexTurn: 'unloaded',
      kokoroTts: 'unloaded',
      warmEdgeTts: 'unloaded',
      embedStage: 'booting',
    };

    this.telemetry = new TelemetryStore();
    this.cadence = new FrameCadenceMonitor();
    this.ttsRouter = new StudioTtsRouter();
    this.ttsRouter.setMode(this.config.ttsMode);
    this.duplexTurn = new DuplexTurnClient();
    this.intentRouter = createIntentRouterClient();
    void this.intentRouter.init().then(() => this.intentRouter.warmup()).catch(() => {});

    this.embedHost = new EmbedStageClient(this.dom.embedIframe, {
      onReady: () => {
        this.models.embedStage = 'ready';
        this.dom.embedStatus.textContent = 'Embed: beach3d ready (MessageChannel)';
        this.embedHost.setTurnState(this.turnState);
        this.embedHost.setInferenceActive(this.inferenceActive);
        this.renderModelStatuses();
      },
      onError: (_code, msg) => {
        this.models.embedStage = 'error';
        this.dom.embedStatus.textContent = `Embed error: ${msg}`;
        this.renderModelStatuses();
      },
    });

    this.player = this.buildSpeechPlayer(null);

    this.ear = new DuplexEar({
      enableAsr: true,
      playbackRmsProvider: () => this.player.getCurrentPlaybackRms(),
      isAssistantSpeakingProvider: () => this.player.isPlaying(),
      onTranscript: (ev) => {
        const clean = ev.fullText.trim();
        if (!clean) return;
        this.setTurnState(this.player.isPlaying() ? 'speaking' : 'listening');
        if (!this.scenarioRunning && this.ear.getState().micActive) {
          this.setBubble(`[Mic] ${clean}`, true);
          const langHint = detectLanguageHint(clean);
          if (this.liveDraftUserEntryId) {
            this.telemetry.updateTranscript(this.liveDraftUserEntryId, {
              text: clean,
              langHint,
            });
          } else {
            const entry = this.telemetry.addTranscript({
              role: 'user',
              text: clean,
              langHint,
            });
            this.liveDraftUserEntryId = entry.id;
          }
        }
      },
      onAsrProgress: (percent) => {
        const st = this.ear.getState();
        if (st.micActive && !st.asrReady && !this.micStarting) {
          this.dom.btnMicToggle.textContent = `Mic Live (ASR ${Math.round(percent)}%)`;
        }
      },
      onStateChange: (state) => {
        if (this.micStarting) return;
        this.dom.btnMicToggle.setAttribute('aria-pressed', state.micActive ? 'true' : 'false');
        if (!state.micActive) {
          this.liveDraftUserEntryId = null;
          this.liveSpeculativeText = '';
          this.pendingLiveProbeArgs = null;
          this.dom.btnMicToggle.textContent = 'Start Full-Duplex Mic';
        } else {
          this.dom.btnMicToggle.textContent = state.asrReady
            ? 'Stop Full-Duplex Mic'
            : 'Mic Live (Loading ASR...)';
        }
      },
      onMicroPauseProbe: (ev) => {
        if (this.scenarioRunning || ev.assistantSpeaking || !ev.fullText.trim()) return;
        void this.handleLiveMicroPauseProbe(ev.pcm16k, ev.fullText, ev.pauseMs, ev.speechDurationMs, ev.rmsDb);
      },
      onTurnProbe: (ev) => {
        if (this.scenarioRunning || !ev.fullText.trim()) return;
        void this.handleLiveTurnProbe(
          ev.pcm16k,
          ev.stableText,
          ev.tailText,
          ev.pauseMs,
          ev.speechDurationMs,
          ev.rmsDb,
          ev.assistantSpeaking,
        );
      },
      onBargeInCandidate: (ev) => {
        if (this.scenarioRunning || !this.player.isPlaying()) return;
        if (ev.partialText.trim().length >= 6) {
          void this.handleLiveBargeInCandidate(ev.partialText);
        }
      },
      onRms: (ev) => {
        this.micDb = ev.rmsDb;
        this.speakerRms = this.player.getCurrentPlaybackRms();
        this.echoDucking = ev.duckingActive;
      },
      onError: (err) => {
        this.telemetry.addTranscript({
          role: 'system',
          text: `Audio/ASR notice: ${err.message}`,
        });
      },
    });

    this.orchestrator = new LiveOrchestrator({
      kvAdapter: createDynamicStudioKvAdapter(),
      intentRouter: this.intentRouter,
      heavyConfig: toHeavyWorkerConfig(this.config),
      events: {
        onSpeculativeStart: () => {
          this.setInferenceActive(true);
          if (!this.player.isPlaying()) {
            const micLive = !this.scenarioRunning && this.ear.getState().micActive;
            this.setTurnState(micLive ? 'listening' : 'thinking');
          }
        },
        onFrontDelta: (_delta, cleanAccum, emotion) => {
          this.telemetry.markTtft();
          this.setExpression(emotion, 0.85);
          this.setBubble(cleanAccum, true);
          this.upsertLiveAssistantTranscript(cleanAccum, emotion);
        },
        onSpeakChunk: (chunk) => {
          this.telemetry.appendReplyText(chunk.text);
          if (chunk.source === 'heavy') {
            this.currentTurnHeavyChunks.push(chunk.text);
            this.hookHeavyClause?.(chunk.text, chunk.emotion);
            this.telemetry.addTranscript({
              role: 'heavy',
              text: chunk.text,
              emotion: chunk.emotion,
            });
          }
          this.enqueueSpeechSynthesis(chunk.seq, chunk.text, chunk.emotion);
        },
        onDelegateStarted: (task) => {
          if (this.currentTurnDelegateStartMs === null) {
            this.currentTurnDelegateStartMs = Math.round(
              performance.now() - this.currentTurnStartMs,
            );
          }
          this.activeHeavyEntryId = this.telemetry.addTranscript({
            role: 'heavy',
            text: `[Heavyworker delegated] ${task}`,
          }).id;
          this.hookDelegateStarted?.();
        },
        onHeavyDelta: (_delta, cleanAccum, emotion) => {
          if (this.activeHeavyEntryId) {
            this.telemetry.updateTranscript(this.activeHeavyEntryId, {
              text: cleanAccum,
              emotion,
            });
          }
        },
        onTurnComplete: (_turnId, fullReply, metrics) => {
          this.setInferenceActive(false);
          const t = this.telemetry.getActiveTurn();
          if (t) {
            this.telemetry.markTurnClassification(
              t.turnLabel,
              t.turnProbs,
              metrics.wasSpeculativeHit,
            );
            this.telemetry.markTtft(metrics.ttftMs);
          }
          if (this.activeAssistantEntryId && fullReply.trim()) {
            this.telemetry.updateTranscript(this.activeAssistantEntryId, {
              text: fullReply,
            });
          }
          this.activeAssistantEntryId = null;
          if (!this.player.isPlaying() && this.speechQueueChainResolved()) {
            this.setTurnState(
              !this.scenarioRunning && this.ear.getState().micActive ? 'listening' : 'idle',
            );
          }
        },
      },
    });
  }

  private speechChainPendingCount = 0;
  private scenarioRunning = false;
  private nextClauseSeq = 0;
  private readonly clauseTurnSeqMap = new Map<number, number | null>();

  private speechQueueChainResolved(): boolean {
    return this.speechChainPendingCount === 0;
  }

  private buildSpeechPlayer(audioCtx: AudioContextLike | null): LiveSpeechPlayer {
    this.hasRealAudioCtx = Boolean(audioCtx);
    return new LiveSpeechPlayer({
      audioContext: audioCtx ?? undefined,
      headless: !audioCtx,
      clock: audioCtx ? undefined : () => performance.now() / 1000,
      autoTick: true,
      onPcmChunk: (ev) => {
        const sid = this.embedHost.getActiveAudioStreamId();
        if (sid) {
          this.embedHost.pushAudioChunk(sid, ev.chunk, 24_000);
        }
      },
      onClockTick: (ev) => {
        this.speakerRms = ev.rms;
        this.echoDucking = this.player?.isPlaying() ?? false;
        this.embedHost.sendClock(ev.sessionOffsetSec, true);
      },
      onClauseStart: (ev) => {
        const mappedTurnSeq = this.clauseTurnSeqMap.get(ev.seq) ?? null;
        this.clauseTurnSeqMap.delete(ev.seq);
        this.telemetry.markFirstSoundForSeq(mappedTurnSeq);
        this.setTurnState('speaking');
        this.setExpression(ev.emotion ?? 'neutral', 0.85);
        this.setBubble(ev.clauseText, true);
      },
      onDrain: (ev) => {
        this.speakerRms = 0;
        this.echoDucking = false;
        this.embedHost.sendClock(ev.durationSec, false);
        this.embedHost.endAudioStream(undefined, false);
        this.setBubble('', false);
        const micLive = !this.scenarioRunning && this.ear.getState().micActive;
        this.setTurnState(
          this.orchestrator.getState() === 'thinking'
            ? 'thinking'
            : micLive
              ? 'listening'
              : 'idle',
        );
        if (micLive && !this.liveProbeInFlight && this.orchestrator.getState() !== 'thinking') {
          const earState = this.ear.getState();
          const leftover = `${earState.stableText}${earState.tailText}`.trim();
          if (leftover && !earState.inSpeech) {
            void this.handleLiveTurnProbe(
              this.ear.getRollingWindow16k(),
              earState.stableText,
              earState.tailText,
              Math.max(earState.silenceMs, 1500),
              Math.max(earState.speechDurationMs, 420),
              this.micDb,
              false,
            );
          }
        }
        this.resolveDrainWaitersIfDone();
      },
      onAbort: () => {
        this.speakerRms = 0;
        this.echoDucking = false;
        this.embedHost.endAudioStream(undefined, true);
        this.setBubble('', false);
        this.resolveDrainWaitersIfDone();
      },
    });
  }

  private async ensureLiveOrHeadlessPlayer(resumeTimeoutMs = 60): Promise<void> {
    if (this.hasRealAudioCtx) {
      await this.player.ensureRunning().catch(() => {});
      return;
    }
    if (typeof AudioContext === 'undefined') return;
    try {
      const ctx = new AudioContext({ sampleRate: 24_000 });
      await Promise.race([
        ctx.resume(),
        new Promise<void>((resolve) => setTimeout(resolve, resumeTimeoutMs)),
      ]);
      if (ctx.state === 'running' && !this.player.isPlaying()) {
        this.player.dispose();
        this.player = this.buildSpeechPlayer(ctx as unknown as AudioContextLike);
        await this.player.ensureRunning();
      } else if (ctx.state !== 'running') {
        await ctx.close().catch(() => {});
      }
    } catch {
      // keep headless clock player cleanly
    }
  }

  private resolveDrainWaitersIfDone(): void {
    if (this.speechChainPendingCount > 0 || this.player.isPlaying()) return;
    for (const resolve of this.drainWaiters) {
      resolve();
    }
    this.drainWaiters.clear();
  }

  mount(): void {
    this.hydrateControlsFromConfig();
    this.bindUiEvents();
    this.renderScenarioCards();

    this.telemetry.subscribe(() => {
      this.renderTranscript();
      this.renderTelemetryTable();
    });

    this.cadence.start(() => {
      if (!this.hudRenderTimer) {
        this.hudRenderTimer = window.setTimeout(() => {
          this.hudRenderTimer = 0;
          this.renderHud();
        }, 90);
      }
    });

    void this.embedHost.connect();
    this.renderHud();
    this.renderModelStatuses();

    window.__LIVE_STUDIO__ = this;
  }

  private hydrateControlsFromConfig(): void {
    this.dom.selectTtsMode.value = this.config.ttsMode;
    this.dom.selectHeavyMode.value = this.config.heavy.mode;
    this.dom.inputOpenAiBase.value = this.config.heavy.baseUrl;
    this.dom.inputOpenAiKey.value = this.config.heavy.apiKey;
    this.dom.inputOpenAiModel.value = this.config.heavy.model;
    this.syncHeavyConfigUi();
  }

  private syncHeavyConfigUi(): void {
    const isCustom = this.config.heavy.mode === 'custom-openai';
    this.dom.customOpenAiFields.hidden = !isCustom;
    this.dom.statusHeavy.textContent = isCustom
      ? `openai: ${this.config.heavy.model || 'custom'}`
      : 'local <think>';
  }

  private bindUiEvents(): void {
    const unlockAudio = () => {
      void this.ensureLiveOrHeadlessPlayer(400);
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });

    this.dom.btnInitAll.addEventListener('click', () => {
      void this.initAll();
    });

    this.dom.btnLoadBrain.addEventListener('click', () => {
      void this.loadWebGpuBrain();
    });

    this.dom.btnLoadTurn.addEventListener('click', () => {
      void this.loadDuplexTurn();
    });

    this.dom.btnLoadKokoro.addEventListener('click', async () => {
      this.models.kokoroTts = 'loading';
      this.renderModelStatuses();
      try {
        await this.ttsRouter.loadKokoro();
        this.models.kokoroTts = 'ready';
      } catch {
        this.models.kokoroTts = 'error';
      }
      this.renderModelStatuses();
    });

    this.dom.selectTtsMode.addEventListener('change', () => {
      this.setTtsMode(this.dom.selectTtsMode.value as TtsEngineMode);
    });

    const onHeavyChange = () => {
      this.config.heavy = {
        mode: this.dom.selectHeavyMode.value as HeavyEndpointMode,
        baseUrl: this.dom.inputOpenAiBase.value,
        apiKey: this.dom.inputOpenAiKey.value,
        model: this.dom.inputOpenAiModel.value,
      };
      savePersistedConfig(this.config);
      this.syncHeavyConfigUi();
      this.orchestrator.updateHeavyConfig(toHeavyWorkerConfig(this.config));
    };
    this.dom.selectHeavyMode.addEventListener('change', onHeavyChange);
    this.dom.inputOpenAiBase.addEventListener('change', onHeavyChange);
    this.dom.inputOpenAiKey.addEventListener('change', onHeavyChange);
    this.dom.inputOpenAiModel.addEventListener('change', onHeavyChange);

    this.dom.btnMicToggle.addEventListener('click', () => {
      void this.toggleFullDuplexMic();
    });

    this.dom.btnRunSuite.addEventListener('click', () => {
      void this.runAllScenarios();
    });

    this.dom.btnStopTurn.addEventListener('click', () => {
      void this.stopAllActive();
    });

    this.dom.btnClearLog.addEventListener('click', () => {
      this.telemetry.clear();
      this.scenarioResults = {};
      this.dom.scenarioOverall.textContent = 'Idle';
      this.renderScenarioCards();
    });

    document.querySelectorAll<HTMLButtonElement>('button[data-scenario]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.scenario as ScenarioId | undefined;
        if (id) void this.runScenario(id);
      });
    });

    document.querySelectorAll<HTMLButtonElement>('button[data-prompt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const prompt = btn.dataset.prompt;
        if (prompt) void this.sendTextTurn(prompt);
      });
    });

    document.querySelectorAll<HTMLButtonElement>('button[data-barge]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = btn.dataset.barge;
        if (text) void this.triggerBargeIn(text);
      });
    });

    this.dom.manualForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const text = this.dom.inputManualText.value.trim();
      if (!text) return;
      this.dom.inputManualText.value = '';
      void this.sendTextTurn(text);
    });
  }

  private setTurnState(state: StudioTurnState): void {
    this.turnState = state;
    this.embedHost.setTurnState(state);
    this.dom.hudTurnState.textContent = state;
  }

  private setExpression(expr: LiveEmotionTag | string, intensity = 0.85): void {
    this.currentExpression = expr || 'neutral';
    this.embedHost.setExpression(this.currentExpression, intensity);
    this.dom.hudExpr.textContent = this.currentExpression;
  }

  private setBubble(text: string, visible: boolean): void {
    this.bubbleText = visible ? text : '';
    this.embedHost.setBubble(text, visible);
    this.dom.hudBubbleText.textContent =
      visible && text.trim() ? text : '(waiting for speech)';
  }

  private setInferenceActive(active: boolean): void {
    this.inferenceActive = active;
    this.embedHost.setInferenceActive(active);
    this.dom.hudInfer.textContent = active ? 'WebLLM active (throttled)' : 'idle';
    this.dom.hudInfer.className = active ? 'kv-value warn' : 'kv-value ok';
  }

  private upsertLiveAssistantTranscript(text: string, emotion: LiveEmotionTag): void {
    if (!this.activeAssistantEntryId) {
      this.activeAssistantEntryId = this.telemetry.addTranscript({
        role: 'assistant',
        text,
        emotion,
      }).id;
    } else {
      this.telemetry.updateTranscript(this.activeAssistantEntryId, {
        text,
        emotion,
      });
    }
  }

  private enqueueSpeechSynthesis(_seq: number, text: string, emotion: LiveEmotionTag): void {
    const clean = text.trim();
    if (!clean) return;
    const sessionSeq = this.speechSessionSeq;
    const turnSeq = this.telemetry.getActiveTurn()?.seq ?? null;
    const clauseSeq = ++this.nextClauseSeq;
    this.clauseTurnSeqMap.set(clauseSeq, turnSeq);
    const signal = this.speechAbortController.signal;
    this.speechChainPendingCount += 1;

    // Synthesize immediately while preserving strict clause ordering into LiveSpeechPlayer
    const synthPromise = (async () => {
      try {
        const res = await this.ttsRouter.synthesize({
          text: clean,
          emotion,
          languageHint: detectLanguageHint(clean),
          signal,
        });
        return {
          pcm24k: res.pcm24k,
          ttfaMs: res.ttfaMs,
          engine: res.engine,
        };
      } catch (err) {
        if (signal.aborted || (err as Error)?.name === 'AbortError') {
          return null;
        }
        // Offline/sandbox fallback waveform so 24kHz player + EMAGE host-clock remain functional
        return {
          pcm24k: synthesizeOfflineFallbackPcm24k(clean),
          ttfaMs: 12,
          engine: 'offline-tone-fallback',
        };
      }
    })();

    this.speechQueueChain = this.speechQueueChain
      .then(async () => {
        const synthesized = await synthPromise;
        if (!synthesized || signal.aborted || sessionSeq !== this.speechSessionSeq) {
          this.clauseTurnSeqMap.delete(clauseSeq);
          return;
        }
        await this.ensureLiveOrHeadlessPlayer();
        this.telemetry.markTtsTtfaForSeq(turnSeq, synthesized.ttfaMs, synthesized.engine);

        if (!this.embedHost.getActiveAudioStreamId()) {
          this.embedHost.beginAudioStream({
            sampleRate: 24_000,
            text: clean,
            firstSliceSec: 0.32,
            hostClock: true,
            audible: false,
            motion: true,
            lipsync: true,
          });
        }

        await this.player.enqueueClause({
          seq: clauseSeq,
          text: clean,
          pcm24k: synthesized.pcm24k,
          emotion,
        });
      })
      .finally(() => {
        this.speechChainPendingCount = Math.max(0, this.speechChainPendingCount - 1);
        this.resolveDrainWaitersIfDone();
      });
  }

  private abortSpeechInternal(fadeMs = 45): { heardText: string; abortLatencyMs: number } {
    const t0 = performance.now();
    this.speechSessionSeq += 1;
    this.speechAbortController.abort();
    this.speechAbortController = new AbortController();
    const res = this.player.abortAndFade(fadeMs);
    this.embedHost.endAudioStream(undefined, true);
    this.setBubble('', false);
    const abortLatencyMs = performance.now() - t0;
    this.telemetry.markInterrupted();
    this.resolveDrainWaitersIfDone();
    return {
      heardText: res.heardText,
      abortLatencyMs,
    };
  }

  async initAll(opts?: { includeBrain?: boolean }): Promise<ModelStatusSnapshot> {
    if (this.initPromise) return this.initPromise;
    const shouldLoadBrain =
      opts?.includeBrain ??
      (typeof navigator !== 'undefined' && 'gpu' in navigator);
    this.initPromise = (async () => {
      this.dom.btnInitAll.disabled = true;
      await Promise.allSettled([
        this.embedHost.connect(),
        this.ensureLiveOrHeadlessPlayer(400),
        this.warmupTtsEngines(),
        this.loadDuplexTurn(),
        this.intentRouter.init().then(() => this.intentRouter.warmup()).catch(() => {}),
        recallForChat('warmup', 1).catch(() => {}),
        ...(shouldLoadBrain ? [this.loadWebGpuBrain()] : []),
      ]);
      this.dom.btnInitAll.disabled = false;
      this.renderModelStatuses();
      return { ...this.models };
    })().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  async loadBrain(): Promise<ModelStatusSnapshot> {
    await this.loadWebGpuBrain();
    return { ...this.models };
  }

  private async loadWebGpuBrain(): Promise<void> {
    if (isWebLLMReady()) {
      this.models.webgpuBrain = 'ready';
      this.renderModelStatuses();
      return;
    }
    this.models.webgpuBrain = 'loading';
    this.dom.statusBrain.textContent = `loading ${getActiveModelId()}...`;
    this.renderModelStatuses();
    try {
      const engine = await getWebLLMEngine({
        onProgressText: (txt) => {
          this.dom.statusBrain.textContent = txt.slice(0, 40);
          if (isWebLLMReady()) {
            this.models.webgpuBrain = 'ready';
            this.renderModelStatuses();
          }
        },
      });
      await engine.chat.completions
        .create({
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 2,
          extra_body: { enable_thinking: false },
        })
        .catch(() => {});
      await resetWebLLMChat().catch(() => {});
      this.models.webgpuBrain = 'ready';
    } catch {
      this.models.webgpuBrain = 'error';
    }
    this.renderModelStatuses();
  }

  private async loadDuplexTurn(): Promise<void> {
    if (this.duplexTurn.isReady()) {
      this.models.duplexTurn = 'ready';
      this.renderModelStatuses();
      return;
    }
    this.models.duplexTurn = 'loading';
    this.renderModelStatuses();
    try {
      await this.duplexTurn.init();
      await this.duplexTurn.warmup();
      this.models.duplexTurn = 'ready';
    } catch {
      this.models.duplexTurn = 'error';
    }
    this.renderModelStatuses();
  }

  private async warmupTtsEngines(): Promise<void> {
    this.models.warmEdgeTts = 'warming';
    if (this.config.ttsMode === 'kokoro-local' && !this.ttsRouter.kokoro.isReady()) {
      this.models.kokoroTts = 'loading';
    }
    this.renderModelStatuses();

    const { edgeOk, kokoroReady } = await this.ttsRouter.warmupSelected();
    this.models.warmEdgeTts = edgeOk ? 'ready' : 'error';
    this.models.kokoroTts =
      kokoroReady || this.ttsRouter.kokoro.isReady()
        ? 'ready'
        : this.config.ttsMode === 'kokoro-local'
          ? 'error'
          : 'unloaded';
    this.renderModelStatuses();
  }

  private async toggleFullDuplexMic(): Promise<void> {
    if (this.micStarting) return;
    const state = this.ear.getState();
    if (state.micActive) {
      await this.ear.stop();
      this.liveDraftUserEntryId = null;
      this.liveSpeculativeText = '';
      this.pendingLiveProbeArgs = null;
      await this.orchestrator.cancelSpeculativeDraft();
      this.dom.btnMicToggle.setAttribute('aria-pressed', 'false');
      this.dom.btnMicToggle.textContent = 'Start Full-Duplex Mic';
      this.setBubble('', false);
      this.setTurnState('idle');
      return;
    }

    this.micStarting = true;
    this.liveDraftUserEntryId = null;
    this.liveSpeculativeText = '';
    this.pendingLiveProbeArgs = null;
    this.dom.btnMicToggle.disabled = true;
    this.dom.btnMicToggle.setAttribute('aria-pressed', 'true');
    this.dom.btnMicToggle.textContent = 'Requesting Mic...';
    this.telemetry.addTranscript({
      role: 'system',
      text: 'Requesting microphone permission & starting full-duplex audio...',
    });

    try {
      // Trigger playback unlock without awaiting before getUserMedia() so transient user activation is preserved.
      void this.ensureLiveOrHeadlessPlayer(400);
      await this.ear.startMic({ awaitAsr: false });

      const afterStart = this.ear.getState();
      if (!this.duplexTurn.isReady() && this.models.duplexTurn === 'unloaded') {
        void this.loadDuplexTurn();
      }
      if (
        this.models.warmEdgeTts === 'unloaded' ||
        (this.config.ttsMode === 'kokoro-local' &&
          !this.ttsRouter.kokoro.isReady() &&
          this.models.kokoroTts === 'unloaded')
      ) {
        void this.warmupTtsEngines();
      }
      this.dom.btnMicToggle.setAttribute('aria-pressed', 'true');
      this.dom.btnMicToggle.textContent = afterStart.asrReady
        ? 'Stop Full-Duplex Mic'
        : 'Mic Live (Loading ASR...)';
      this.setTurnState('listening');
      this.telemetry.addTranscript({
        role: 'system',
        text: afterStart.asrReady
          ? 'Full-duplex microphone active (16kHz Worklet + streaming ASR ready).'
          : 'Full-duplex microphone active (16kHz Worklet). Streaming ASR is loading in background...',
      });

      if (!afterStart.asrReady) {
        void this.ear
          .initAsr()
          .then(() => {
            if (this.ear.getState().micActive && !this.micStarting) {
              this.dom.btnMicToggle.textContent = 'Stop Full-Duplex Mic';
              this.telemetry.addTranscript({
                role: 'system',
                text: 'Streaming ASR model ready.',
              });
            }
          })
          .catch((asrErr) => {
            this.telemetry.addTranscript({
              role: 'system',
              text: `Streaming ASR init failed: ${(asrErr as Error)?.message ?? String(asrErr)}`,
            });
          });
      }
    } catch (err) {
      this.dom.btnMicToggle.setAttribute('aria-pressed', 'false');
      this.dom.btnMicToggle.textContent = 'Start Full-Duplex Mic';
      this.setTurnState('idle');
      this.telemetry.addTranscript({
        role: 'system',
        text: `Microphone start failed: ${(err as Error)?.message ?? String(err)}`,
      });
    } finally {
      this.micStarting = false;
      this.dom.btnMicToggle.disabled = false;
    }
  }

  private async handleLiveMicroPauseProbe(
    pcm16k: Float32Array,
    fullText: string,
    pauseMs: number,
    speechDurationMs: number,
    rmsDb: number,
  ): Promise<void> {
    const decision = await this.classifyBimodalTurn({
      pcm16k,
      stableText: fullText,
      tailText: '',
      pauseMs,
      speechDurationMs,
      rmsDb,
      assistantSpeaking: false,
    });
    if (
      decision.action === 'HOLD_SOFT' ||
      decision.action === 'COMMIT_USER_TURN' ||
      pauseMs >= 220
    ) {
      const earState = this.ear.getState();
      const liveText = `${earState.stableText}${earState.tailText}`.trim();
      if (this.scenarioRunning || !earState.micActive || this.player.isPlaying() || !liveText) {
        return;
      }
      this.liveSpeculativeText = fullText;
      await this.orchestrator.startSpeculativeDraft(
        fullText,
        detectLanguageHint(fullText),
      );
    }
  }

  private async handleLiveTurnProbe(
    pcm16k: Float32Array,
    stableText: string,
    tailText: string,
    pauseMs: number,
    speechDurationMs: number,
    rmsDb: number,
    assistantSpeaking: boolean,
  ): Promise<void> {
    if (this.liveProbeInFlight) {
      const incomingText = `${stableText}${tailText}`.trim();
      const prev = this.pendingLiveProbeArgs;
      const prevText = prev ? `${prev.stableText}${prev.tailText}`.trim() : '';
      const nextPauseMs =
        prev && incomingText === prevText ? Math.max(prev.pauseMs, pauseMs) : pauseMs;
      this.pendingLiveProbeArgs = {
        pcm16k,
        stableText,
        tailText,
        pauseMs: nextPauseMs,
        speechDurationMs,
        rmsDb,
        assistantSpeaking,
      };
      return;
    }

    let decision: BimodalTurnDecision;
    this.liveProbeInFlight = true;
    try {
      decision = await this.classifyBimodalTurn({
        pcm16k,
        stableText,
        tailText,
        pauseMs,
        speechDurationMs,
        rmsDb,
        assistantSpeaking,
      });
    } finally {
      this.liveProbeInFlight = false;
    }

    if (this.scenarioRunning || !this.ear.getState().micActive) {
      this.pendingLiveProbeArgs = null;
      return;
    }

    if (decision.action === 'BACKCHANNEL_ACK') {
      const existingUserEntryId = this.liveDraftUserEntryId ?? undefined;
      this.liveDraftUserEntryId = null;
      this.liveSpeculativeText = '';
      this.pendingLiveProbeArgs = null;
      this.handleBackchannelDuringSpeech(
        decision.combinedText || stableText || tailText,
        decision,
        existingUserEntryId,
      );
      await this.orchestrator.cancelSpeculativeDraft();
      this.ear.markTurnCommitted(true);
      return;
    }

    if (decision.action === 'WAIT_SILENT_HOLD') {
      this.liveDraftUserEntryId = null;
      this.liveSpeculativeText = '';
      this.pendingLiveProbeArgs = null;
      await this.orchestrator.cancelSpeculativeDraft();
      this.ear.markTurnCommitted(true);
      await this.executeBargeInInterruption(this.player.getHeardTranscript());
      return;
    }

    if (decision.action === 'BARGE_IN_COMMIT') {
      const text = (decision.combinedText || stableText || tailText).trim();
      const existingUserEntryId = this.liveDraftUserEntryId ?? undefined;
      this.liveDraftUserEntryId = null;
      this.liveSpeculativeText = '';
      this.pendingLiveProbeArgs = null;
      await this.orchestrator.cancelSpeculativeDraft();
      this.ear.markTurnCommitted(true);
      this.setBubble('', false);
      await this.executeBargeInInterruption(this.player.getHeardTranscript());
      if (text) {
        await this.sendTextTurn(text, existingUserEntryId);
      }
      return;
    }

    if (decision.action === 'COMMIT_USER_TURN') {
      const text = (decision.combinedText || stableText || tailText).trim();
      if (!text) return;
      const existingUserEntryId = this.liveDraftUserEntryId ?? undefined;
      const preSpeculativeText = this.liveSpeculativeText.trim() || undefined;
      this.liveDraftUserEntryId = null;
      this.liveSpeculativeText = '';
      this.pendingLiveProbeArgs = null;
      this.ear.markTurnCommitted(true);
      this.setBubble('', false);
      await this.ensureLiveOrHeadlessPlayer(60);
      await this.runTurnFromSimulatedAudio({
        scenario: 'live-mic',
        userText: text,
        lang: detectLanguageHint(text),
        decision,
        preSpeculativeText,
        waitForDrain: false,
        existingUserEntryId,
      });
      return;
    }

    const next = this.pendingLiveProbeArgs;
    this.pendingLiveProbeArgs = null;
    if (next) {
      const earState = this.ear.getState();
      if (
        earState.micActive &&
        !this.scenarioRunning &&
        `${earState.stableText}${earState.tailText}`.trim().length > 0
      ) {
        void this.handleLiveTurnProbe(
          next.pcm16k,
          next.stableText,
          next.tailText,
          next.pauseMs,
          next.speechDurationMs,
          next.rmsDb,
          next.assistantSpeaking,
        );
      }
    }
  }

  private async handleLiveBargeInCandidate(partialText: string): Promise<void> {
    const decision = await this.classifyBimodalTurn({
      pcm16k: this.ear.getRollingWindow16k(),
      stableText: partialText,
      tailText: '',
      pauseMs: 80,
      speechDurationMs: 280,
      rmsDb: this.micDb,
      assistantSpeaking: true,
    });
    if (decision.action === 'WAIT_SILENT_HOLD' || decision.action === 'BARGE_IN_COMMIT') {
      await this.executeBargeInInterruption(this.player.getHeardTranscript());
    }
  }

  private async stopAllActive(): Promise<void> {
    this.abortSpeechInternal(45);
    await this.orchestrator.handleBargeIn(this.player.getHeardTranscript(), {
      heavyAction: 'abort',
    });
    this.setInferenceActive(false);
    this.setTurnState('idle');
  }

  // ===========================================================================
  // ScenarioRuntimeController + LiveStudioBridgeApi Methods
  // ===========================================================================

  setTtsMode(mode: TtsEngineMode): void {
    this.config.ttsMode = mode;
    this.ttsRouter.setMode(mode);
    this.dom.selectTtsMode.value = mode;
    savePersistedConfig(this.config);
    this.renderModelStatuses();
    if (mode === 'kokoro-local' && !this.ttsRouter.kokoro.isReady()) {
      void this.warmupTtsEngines();
    }
  }

  async resetConversation(): Promise<void> {
    this.abortSpeechInternal(0);
    await this.waitForPlaybackDrain(500);
    this.clauseTurnSeqMap.clear();
    if (this.config.ttsMode !== 'kokoro-local') {
      void this.ttsRouter.warmEdge();
    }
    this.ear.resetUtterance();
    await this.orchestrator.reset();
    this.activeAssistantEntryId = null;
    this.activeHeavyEntryId = null;
    this.setBubble('', false);
    this.setExpression('neutral', 0.5);
    this.setInferenceActive(false);
    this.setTurnState('idle');
  }

  async classifyBimodalTurn(params: {
    pcm16k: Float32Array;
    stableText: string;
    tailText: string;
    pauseMs: number;
    speechDurationMs: number;
    rmsDb: number;
    assistantSpeaking: boolean;
    hintedProbs?: DuplexTurnProbs;
  }): Promise<BimodalTurnDecision> {
    let probs: DuplexTurnProbs;
    if (this.duplexTurn.isReady()) {
      try {
        const pred = await this.duplexTurn.predict(params.pcm16k);
        probs = pred.probs;
      } catch {
        probs = inferFallbackProbs(params);
      }
    } else {
      probs = inferFallbackProbs(params);
    }

    return decideBimodalTurn({
      probs,
      stableText: params.stableText,
      tailText: params.tailText,
      pauseMs: params.pauseMs,
      speechDurationMs: params.speechDurationMs,
      rmsDb: params.rmsDb,
      assistantSpeaking: params.assistantSpeaking,
    });
  }

  async runTurnFromSimulatedAudio(opts: {
    scenario: string;
    userText: string;
    preSpeculativeText?: string;
    lang?: LiveLanguageHint;
    decision: BimodalTurnDecision;
    waitForDrain?: boolean;
    existingUserEntryId?: string;
    onDelegateStarted?: () => void;
    onHeavyClause?: (text: string, emotion: LiveEmotionTag) => void;
  }): Promise<TurnExecutionOutcome> {
    const lang = opts.lang ?? detectLanguageHint(opts.userText);
    this.cadence.beginTurnWindow();
    this.currentTurnStartMs = performance.now();
    this.currentTurnDelegateStartMs = null;
    this.currentTurnHeavyChunks = [];
    this.activeAssistantEntryId = null;
    this.activeHeavyEntryId = null;
    this.hookDelegateStarted = opts.onDelegateStarted ?? null;
    this.hookHeavyClause = opts.onHeavyClause ?? null;

    if (opts.existingUserEntryId) {
      this.telemetry.updateTranscript(opts.existingUserEntryId, {
        text: opts.userText,
        langHint: lang,
      });
    } else {
      this.telemetry.addTranscript({
        role: 'user',
        text: opts.userText,
        langHint: lang,
      });
    }

    this.telemetry.beginTurn({
      scenario: opts.scenario,
      input: opts.userText,
      turnLabel: opts.decision.turnClass,
      turnProbs: opts.decision.probs,
      speculativeHit: false,
    });

    this.setInferenceActive(true);
    this.setTurnState('thinking');

    const metrics = opts.preSpeculativeText
      ? await this.orchestrator.commitOrCancelSpeculative(opts.userText, true, lang)
      : await this.orchestrator.handleUserTurn(opts.userText, lang);

    if (opts.waitForDrain !== false) {
      await this.waitForPlaybackDrain(25_000);
    }

    const activeRow = this.telemetry.getActiveTurn();
    const replyText = activeRow?.replyChunks.join(' ').trim() ?? '';
    const frameWindow = this.cadence.snapshotTurnWindow();
    const row = this.telemetry.commitTurn(frameWindow);

    this.hookDelegateStarted = null;
    this.hookHeavyClause = null;

    return {
      replyText,
      delegated: Boolean(metrics?.delegated),
      delegateTriggeredAtMs: this.currentTurnDelegateStartMs,
      heavyCommentary: this.currentTurnHeavyChunks.join(' '),
      speculativeHit: Boolean(metrics?.wasSpeculativeHit),
      telemetryRow: row,
    };
  }

  handleBackchannelDuringSpeech(
    ackText: string,
    decision: BimodalTurnDecision,
    existingUserEntryId?: string,
  ): { aborted: boolean; playerStillActive: boolean } {
    this.orchestrator.handleBackchannelAck(ackText);
    const formatted = `[backchannel] ${ackText}`;
    if (existingUserEntryId) {
      this.telemetry.updateTranscript(existingUserEntryId, {
        text: formatted,
        langHint: detectLanguageHint(ackText),
      });
    } else {
      this.telemetry.addTranscript({
        role: 'user',
        text: formatted,
        langHint: detectLanguageHint(ackText),
      });
    }
    this.telemetry.addNote(`backchannel:${decision.action}`);
    this.setTurnState('backchannel');
    window.setTimeout(() => {
      if (this.player.isPlaying()) {
        this.setTurnState('speaking');
      } else if (this.turnState === 'backchannel') {
        this.setTurnState(
          !this.scenarioRunning && this.ear.getState().micActive ? 'listening' : 'idle',
        );
      }
    }, 320);

    return {
      aborted: false,
      playerStillActive: this.player.isPlaying(),
    };
  }

  async executeBargeInInterruption(heardFallbackText: string): Promise<{
    abortLatencyMs: number;
    heardText: string;
    truncated: boolean;
    interruptedText: string;
  }> {
    const abortInfo = this.abortSpeechInternal(45);
    const heard = abortInfo.heardText.trim() || heardFallbackText;
    const trunc = await this.orchestrator.handleBargeIn(heard, {
      heavyAction: 'abort',
    });
    if (this.activeAssistantEntryId) {
      this.telemetry.updateTranscript(this.activeAssistantEntryId, {
        text: trunc.interruptedText,
        interrupted: true,
      });
    }
    this.setInferenceActive(false);
    this.setTurnState('listening');
    return {
      abortLatencyMs: abortInfo.abortLatencyMs,
      heardText: heard,
      truncated: trunc.truncated,
      interruptedText: trunc.interruptedText,
    };
  }

  async waitForPlaybackActive(minMsElapsed = 160, timeoutMs = 6000): Promise<boolean> {
    const deadline = performance.now() + timeoutMs;
    const minSamples = Math.floor((minMsElapsed / 1000) * 24_000);
    while (performance.now() < deadline) {
      if (this.player.isPlaying() && this.player.getState().sampleOffset >= minSamples) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.player.isPlaying();
  }

  async waitForPlaybackDrain(timeoutMs = 25_000): Promise<void> {
    if (this.speechChainPendingCount === 0 && !this.player.isPlaying()) return;
    await new Promise<void>((resolve) => {
      const onDone = () => {
        clearTimeout(timer);
        this.drainWaiters.delete(onDone);
        resolve();
      };
      const timer = setTimeout(onDone, timeoutMs);
      this.drainWaiters.add(onDone);
    });
  }

  async waitForHeavyCompletion(timeoutMs = 12_000): Promise<string | null> {
    return Promise.race([
      this.orchestrator.waitForActiveHeavyTask(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  }

  getStats() {
    return this.orchestrator.getStats();
  }

  getHistory(): readonly BrainMessage[] {
    return this.orchestrator.getHistory();
  }

  async sendTextTurn(text: string, existingUserEntryId?: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    await this.ensureLiveOrHeadlessPlayer(400);
    const pcm = synthesizeSimulatedUserSpeech16k(600, 400);
    const decision = await this.classifyBimodalTurn({
      pcm16k: pcm,
      stableText: trimmed,
      tailText: '',
      pauseMs: 420,
      speechDurationMs: 650,
      rmsDb: -18,
      assistantSpeaking: false,
      hintedProbs: { COMPLETE: 0.9, INCOMPLETE: 0.06, BACKCHANNEL: 0.02, WAIT_INTERRUPT: 0.02 },
    });
    await this.runTurnFromSimulatedAudio({
      scenario: 'manual',
      userText: trimmed,
      lang: detectLanguageHint(trimmed),
      decision,
      waitForDrain: false,
      existingUserEntryId,
    });
  }

  async simulateVoiceTurn(pcmOrText: Float32Array | string): Promise<void> {
    if (typeof pcmOrText === 'string') {
      const pcm = synthesizeSimulatedUserSpeech16k(750, 420);
      this.ear.feedSimulatedPcm16k(pcm, { transcriptHint: pcmOrText, isFinalHint: true });
      await this.sendTextTurn(pcmOrText);
      return;
    }
    this.ear.feedSimulatedPcm16k(pcmOrText);
  }

  async triggerBargeIn(text: string): Promise<void> {
    const pcm = synthesizeSimulatedUserSpeech16k(550, 220, 0.28);
    this.ear.feedSimulatedPcm16k(pcm, { transcriptHint: text, isFinalHint: true });
    const decision = await this.classifyBimodalTurn({
      pcm16k: pcm,
      stableText: text,
      tailText: '',
      pauseMs: 220,
      speechDurationMs: 550,
      rmsDb: -15,
      assistantSpeaking: this.player.isPlaying(),
      hintedProbs: { COMPLETE: 0.14, INCOMPLETE: 0.05, BACKCHANNEL: 0.03, WAIT_INTERRUPT: 0.78 },
    });

    if (decision.action === 'BACKCHANNEL_ACK') {
      this.handleBackchannelDuringSpeech(text, decision);
      return;
    }

    await this.executeBargeInInterruption(this.player.getHeardTranscript());
    if (decision.action === 'BARGE_IN_COMMIT' || decision.action === 'COMMIT_USER_TURN') {
      await this.sendTextTurn(text);
    }
  }

  async runScenario(id: ScenarioId): Promise<ScenarioRunResult> {
    this.scenarioRunning = true;
    this.dom.scenarioOverall.textContent = `Running ${id}...`;
    try {
      const res = await executeVerificationScenario(id, this);
      this.scenarioResults[id] = res;
      this.renderScenarioCards();
      const total = SCENARIO_ORDER.filter((k) => this.scenarioResults[k]?.passed).length;
      this.dom.scenarioOverall.textContent = `${total}/${Object.keys(this.scenarioResults).length} passed`;
      return res;
    } finally {
      this.scenarioRunning = false;
    }
  }

  async runAllScenarios(): Promise<ScenarioRunResult[]> {
    this.scenarioRunning = true;
    this.dom.btnRunSuite.disabled = true;
    this.dom.scenarioOverall.textContent = 'Running 5-scenario suite...';
    try {
      const results = await executeAllVerificationScenarios(this, (res) => {
        this.scenarioResults[res.id] = res;
        this.renderScenarioCards();
      });
      const passed = results.filter((r) => r.passed).length;
      this.dom.scenarioOverall.textContent = `${passed}/${results.length} PASSED`;
      return results;
    } finally {
      this.dom.btnRunSuite.disabled = false;
      this.scenarioRunning = false;
    }
  }

  getTelemetry() {
    const stage: StageMetrics = {
      fps: this.cadence.getCurrentFps(),
      minFpsWindow: this.cadence.snapshotTurnWindow().minFps,
      avgFrameMs: this.cadence.getAvgFrameMs(),
      maxFrameMs: this.cadence.getMaxFrameMs(),
      jankOver25: this.cadence.getTotalJank().jank25,
      jankOver50: this.cadence.getTotalJank().jank50,
      turnState: this.turnState,
      expression: this.currentExpression,
      bubbleText: this.bubbleText,
      micLevel: Math.min(1, Math.max(0, (this.micDb + 60) / 60)),
      speakerLevel: Math.min(1, this.speakerRms * 5),
      echoDucking: this.echoDucking,
      inferenceActive: this.inferenceActive,
      embedReady: this.models.embedStage === 'ready',
    };
    return {
      models: { ...this.models },
      stage,
      rows: this.telemetry.getRows(),
      transcript: this.telemetry.getTranscript(),
      scenarios: { ...this.scenarioResults },
    };
  }

  // ===========================================================================
  // UI Rendering (Clean functional telemetry, zero decorative indicators)
  // ===========================================================================

  private renderHud(): void {
    const fps = this.cadence.getCurrentFps();
    const maxMs = this.cadence.getMaxFrameMs();
    const jank = this.cadence.getTotalJank();

    this.dom.hudFps.textContent = fps.toFixed(1);
    this.dom.hudFps.className =
      fps >= 55 ? 'kv-value ok' : fps >= 40 ? 'kv-value warn' : 'kv-value danger';
    this.dom.hudMaxMs.textContent = `${maxMs.toFixed(1)} ms`;
    this.dom.hudJank.textContent = `${jank.jank25} / ${jank.jank50}`;

    const micPct = Math.round(Math.min(100, Math.max(0, ((this.micDb + 60) / 60) * 100)));
    const spkPct = Math.round(Math.min(100, this.speakerRms * 450));
    this.dom.meterMicFill.style.width = `${micPct}%`;
    this.dom.hudMicDb.textContent = `${Math.round(this.micDb)} dB`;
    this.dom.meterSpkFill.style.width = `${spkPct}%`;
    this.dom.hudEchoDuck.textContent = this.echoDucking
      ? 'Echo Duck: 0.56x active'
      : 'Echo Duck: off';
  }

  private renderModelStatuses(): void {
    this.dom.statusBrain.textContent =
      this.models.webgpuBrain === 'ready'
        ? `ready (${getActiveModelId()})`
        : `${this.models.webgpuBrain} (kv fallback active)`;
    this.dom.statusTurn.textContent =
      this.models.duplexTurn === 'error'
        ? 'bimodal acoustic fallback'
        : this.models.duplexTurn;
    this.dom.statusTts.textContent = `mode: ${this.config.ttsMode} | edge: ${this.models.warmEdgeTts} | kokoro: ${this.models.kokoroTts}`;
  }

  private renderScenarioCards(): void {
    const html = SCENARIO_ORDER.map((id) => {
      const r = this.scenarioResults[id];
      const cls = !r ? '' : r.passed ? 'pass' : 'fail';
      const statusText = !r
        ? 'pending'
        : r.passed
          ? `PASS (${r.durationMs}ms)`
          : `FAIL (${r.durationMs}ms)`;
      const lines = (r?.assertions ?? [])
        .map((a) => `${a.ok ? '[OK]' : '[FAIL]'} ${escapeHtml(a.label)}${a.detail ? ` — ${escapeHtml(a.detail)}` : ''}`)
        .join('<br/>');
      return `
        <div class="scenario-card ${cls}">
          <div class="scenario-card-title">
            <span>${escapeHtml(SCENARIO_TITLES[id])}</span>
            <span>${escapeHtml(statusText)}</span>
          </div>
          <div class="scenario-assert">${lines || 'Not yet run'}</div>
        </div>
      `;
    }).join('');
    this.dom.scenarioList.innerHTML = html;
  }

  private renderTranscript(): void {
    const entries = this.telemetry.getTranscript();
    this.dom.transcriptCount.textContent = `${entries.length} entries`;
    this.dom.transcriptLog.innerHTML = entries
      .map(
        (m) => `
      <div class="msg-row ${escapeHtml(m.role)}">
        <div class="msg-meta">${escapeHtml(m.role.toUpperCase())}${m.emotion ? ` · ${escapeHtml(m.emotion)}` : ''}${m.interrupted ? ' · [interrupted]' : ''}</div>
        <div>${escapeHtml(m.text)}</div>
      </div>`,
      )
      .join('');
    this.dom.transcriptLog.scrollTop = this.dom.transcriptLog.scrollHeight;
  }

  private renderTelemetryTable(): void {
    const rows = this.telemetry.getRows();
    this.dom.telemetryCount.textContent = `${rows.length} rows`;
    this.dom.telemetryTbody.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td class="mono">${r.seq}</td>
        <td title="${escapeHtml(r.input)}"><strong>${escapeHtml(r.scenario)}</strong>: ${escapeHtml(r.input.slice(0, 28))}</td>
        <td class="mono">${escapeHtml(r.turnLabel)}</td>
        <td class="mono">${r.speculativeHit ? 'HIT' : 'miss'}</td>
        <td class="mono">${r.ttftMs ?? '-'} ms</td>
        <td class="mono">${r.ttsTtfaMs ?? '-'} ms</td>
        <td class="mono">${r.firstSoundMs ?? '-'} ms</td>
        <td class="mono">${r.minFps ?? '-'}</td>
        <td class="mono">${r.jank25} / ${r.jank50}</td>
        <td class="mono">${r.wasInterrupted ? 'INT' : escapeHtml(r.ttsEngine)}</td>
      </tr>`,
      )
      .join('');
  }
}

const controller = new LiveStudioController();
controller.mount();
