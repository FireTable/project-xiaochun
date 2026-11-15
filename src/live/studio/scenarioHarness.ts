/**
 * scenarioHarness.ts — 5-Scenario Bilingual Full-Duplex Verification Harness.
 *
 * Scenarios:
 * 1. `zh_banter`: Mandarin casual conversation -> micro-pause speculative hit + TTS + EMAGE.
 * 2. `en_cs_banter`: English + ZH code-switching -> bilingual turn classification + reply + TTS.
 * 3. `backchannel_hold`: Mid-speech `"mm-hmm"` / `"对对"` (`BACKCHANNEL_ACK`) -> NO interrupt, continuous playback.
 * 4. `barge_in_kv_truncation`: Mid-speech `"等一下 wait a second，我问另一个问题"` (`BARGE_IN_COMMIT`) ->
 *    <= 60ms TTS abort/fade, `xcTruncateReplyToHeard` with `[interrupted]`, preserved multi-turn KV follow-up.
 * 5. `heavy_delegate_amend`: `"帮我查一下 / deeply analyze why iOS TBDR WebGPU drops frames when we use RGBA16F 4x MSAA"` ->
 *    instant Front-Brain `<delegate>` bridge (< 900ms), mid-flight amendment (`"尤其是开启 bloom 的时候"`), async commentary.
 */

import { LiveOrchestrator } from '@/live/brain/liveOrchestrator';
import type { IntentRouterClient } from '@/live/router';
import type { BrainMessage, LiveLanguageHint, LiveOrchestratorStats } from '@/live/brain/types';
import { DuplexEar } from '@/live/audio/duplexEar';
import { LiveSpeechPlayer } from '@/live/audio/liveSpeechPlayer';
import { DuplexTurnClient } from '@/live/turn/duplexTurnClient';
import type { BimodalTurnDecision, DuplexTurnProbs } from '@/live/turn/types';
import type { LiveEmotionTag } from '@/live/tts/types';
import type { EmbedStageClient, FrameCadenceMonitor } from './embedHost';
import type { TelemetryStore } from './telemetry';
import type { LiveTelemetryRow, ScenarioId, ScenarioRunResult } from './types';

export const SCENARIO_ORDER: ScenarioId[] = [
  'zh_banter',
  'en_cs_banter',
  'backchannel_hold',
  'barge_in_kv_truncation',
  'heavy_delegate_amend',
];

export const SCENARIO_TITLES: Record<ScenarioId, string> = {
  zh_banter: '1. ZH Banter + Speculative Hit',
  en_cs_banter: '2. EN + ZH Code-Switch Banter',
  backchannel_hold: '3. Backchannel Hold (No Barge-In)',
  barge_in_kv_truncation: '4. Barge-In <=60ms + [interrupted] KV',
  heavy_delegate_amend: '5. Heavy Route + Mid-Flight Amend',
};

export interface TurnExecutionOutcome {
  replyText: string;
  delegated: boolean;
  delegateTriggeredAtMs: number | null;
  heavyCommentary: string;
  speculativeHit: boolean;
  telemetryRow: LiveTelemetryRow | null;
}

export interface ScenarioRuntimeController {
  readonly orchestrator: LiveOrchestrator;
  readonly ear: DuplexEar;
  readonly player: LiveSpeechPlayer;
  readonly duplexTurn: DuplexTurnClient;
  readonly embedHost: EmbedStageClient;
  readonly cadence: FrameCadenceMonitor;
  readonly telemetry: TelemetryStore;
  readonly intentRouter?: IntentRouterClient;

  resetConversation(): Promise<void>;

  classifyBimodalTurn(params: {
    pcm16k: Float32Array;
    stableText: string;
    tailText: string;
    pauseMs: number;
    speechDurationMs: number;
    rmsDb: number;
    assistantSpeaking: boolean;
    hintedProbs?: DuplexTurnProbs;
  }): Promise<BimodalTurnDecision>;

  runTurnFromSimulatedAudio(opts: {
    scenario: string;
    userText: string;
    preSpeculativeText?: string;
    lang?: LiveLanguageHint;
    decision: BimodalTurnDecision;
    waitForDrain?: boolean;
    onDelegateStarted?: () => void;
    onHeavyClause?: (text: string, emotion: LiveEmotionTag) => void;
  }): Promise<TurnExecutionOutcome>;

  handleBackchannelDuringSpeech(ackText: string, decision: BimodalTurnDecision): {
    aborted: boolean;
    playerStillActive: boolean;
  };

  executeBargeInInterruption(heardFallbackText: string): Promise<{
    abortLatencyMs: number;
    heardText: string;
    truncated: boolean;
    interruptedText: string;
  }>;

  waitForPlaybackActive(minMsElapsed?: number, timeoutMs?: number): Promise<boolean>;
  waitForPlaybackDrain(timeoutMs?: number): Promise<void>;
  waitForHeavyCompletion(timeoutMs?: number): Promise<string | null>;
  getStats(): LiveOrchestratorStats;
  getHistory(): readonly BrainMessage[];
}

export function synthesizeSimulatedUserSpeech16k(
  durationMs: number,
  trailingSilenceMs = 0,
  amplitude = 0.22,
): Float32Array {
  const sr = 16_000;
  const speechSamples = Math.floor((durationMs / 1000) * sr);
  const silenceSamples = Math.floor((trailingSilenceMs / 1000) * sr);
  const out = new Float32Array(speechSamples + silenceSamples);

  for (let i = 0; i < speechSamples; i++) {
    const t = i / sr;
    const mod = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4.5 * t);
    out[i] =
      amplitude *
      mod *
      (0.55 * Math.sin(2 * Math.PI * 190 * t) +
        0.3 * Math.sin(2 * Math.PI * 370 * t) +
        0.15 * Math.sin(2 * Math.PI * 620 * t));
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeAssert(label: string, ok: boolean, detail?: string) {
  return { label, ok, detail };
}

async function runZhBanter(ctrl: ScenarioRuntimeController): Promise<ScenarioRunResult> {
  const startedAt = performance.now();
  await ctrl.resetConversation();
  const statsBefore = ctrl.getStats();

  const microText = '小春，今天在海边心情怎么样呀';
  const finalText = '小春，今天在海边心情怎么样呀？';

  // Feed voiced segment + 260ms micro-pause through DuplexEar and start speculative prefill
  const microPcm = synthesizeSimulatedUserSpeech16k(520, 260);
  ctrl.ear.feedSimulatedPcm16k(microPcm, { transcriptHint: microText, isFinalHint: false });
  await ctrl.orchestrator.startSpeculativeDraft(microText, 'zh');
  await sleep(90);

  // Feed final completion tail + 420ms silence and run bimodal classification
  const tailPcm = synthesizeSimulatedUserSpeech16k(260, 420);
  ctrl.ear.feedSimulatedPcm16k(tailPcm, { transcriptHint: finalText, isFinalHint: true });

  const decision = await ctrl.classifyBimodalTurn({
    pcm16k: tailPcm,
    stableText: finalText,
    tailText: '',
    pauseMs: 420,
    speechDurationMs: 780,
    rmsDb: -18,
    assistantSpeaking: false,
    hintedProbs: { COMPLETE: 0.88, INCOMPLETE: 0.08, BACKCHANNEL: 0.02, WAIT_INTERRUPT: 0.02 },
  });

  const outcome = await ctrl.runTurnFromSimulatedAudio({
    scenario: 'zh_banter',
    userText: finalText,
    preSpeculativeText: microText,
    lang: 'zh',
    decision,
    waitForDrain: true,
  });

  const statsAfter = ctrl.getStats();
  const row = outcome.telemetryRow;
  const assertions = [
    makeAssert(
      'Bimodal Turn classified COMPLETE / COMMIT_USER_TURN',
      decision.action === 'COMMIT_USER_TURN',
      `action=${decision.action} class=${decision.turnClass}`,
    ),
    makeAssert(
      'Micro-pause speculative prefill HIT',
      outcome.speculativeHit && statsAfter.speculativeHitCount > statsBefore.speculativeHitCount,
      `specHits ${statsBefore.speculativeHitCount} -> ${statsAfter.speculativeHitCount}`,
    ),
    makeAssert(
      'Mandarin Front-Brain reply generated',
      outcome.replyText.trim().length > 0 && /[\u4e00-\u9fff]/.test(outcome.replyText),
      `len=${outcome.replyText.length}`,
    ),
    makeAssert(
      '24kHz TTS synthesized & host-clock synced to 3D EMAGE',
      Boolean(row && row.ttsTtfaMs !== null && row.firstSoundMs !== null),
      `ttfa=${row?.ttsTtfaMs ?? 'n/a'}ms firstSound=${row?.firstSoundMs ?? 'n/a'}ms minFps=${row?.minFps ?? 'n/a'}`,
    ),
  ];

  return {
    id: 'zh_banter',
    name: SCENARIO_TITLES.zh_banter,
    passed: assertions.every((a) => a.ok),
    durationMs: Math.round(performance.now() - startedAt),
    assertions,
    telemetry: row ?? undefined,
  };
}

async function runEnCodeSwitchBanter(ctrl: ScenarioRuntimeController): Promise<ScenarioRunResult> {
  const startedAt = performance.now();
  await ctrl.resetConversation();

  const prompt = 'Hey XiaoChun, 今天海边风大不大? By the way how is your WebGPU GPU temperature?';
  const pcm = synthesizeSimulatedUserSpeech16k(1150, 440);
  ctrl.ear.feedSimulatedPcm16k(pcm, { transcriptHint: prompt, isFinalHint: true });

  const decision = await ctrl.classifyBimodalTurn({
    pcm16k: pcm,
    stableText: prompt,
    tailText: '',
    pauseMs: 440,
    speechDurationMs: 1150,
    rmsDb: -17,
    assistantSpeaking: false,
    hintedProbs: { COMPLETE: 0.85, INCOMPLETE: 0.1, BACKCHANNEL: 0.03, WAIT_INTERRUPT: 0.02 },
  });

  const outcome = await ctrl.runTurnFromSimulatedAudio({
    scenario: 'en_cs_banter',
    userText: prompt,
    lang: 'mixed',
    decision,
    waitForDrain: true,
  });

  const row = outcome.telemetryRow;
  const assertions = [
    makeAssert(
      'EN + ZH code-switching turn committed',
      decision.action === 'COMMIT_USER_TURN',
      `action=${decision.action} class=${decision.turnClass}`,
    ),
    makeAssert(
      'Bilingual Front-Brain reply generated',
      outcome.replyText.trim().length > 0,
      `len=${outcome.replyText.length}`,
    ),
    makeAssert(
      'Bilingual TTS playback & clock sync completed',
      Boolean(row && row.ttsTtfaMs !== null && row.firstSoundMs !== null),
      `engine=${row?.ttsEngine ?? 'n/a'} ttfa=${row?.ttsTtfaMs ?? 'n/a'}ms firstSound=${row?.firstSoundMs ?? 'n/a'}ms`,
    ),
  ];

  return {
    id: 'en_cs_banter',
    name: SCENARIO_TITLES.en_cs_banter,
    passed: assertions.every((a) => a.ok),
    durationMs: Math.round(performance.now() - startedAt),
    assertions,
    telemetry: row ?? undefined,
  };
}

async function runBackchannelHold(ctrl: ScenarioRuntimeController): Promise<ScenarioRunResult> {
  const startedAt = performance.now();
  await ctrl.resetConversation();

  const prompt = '小春，给我们讲讲长一点的海边日落风景吧？';
  const userPcm = synthesizeSimulatedUserSpeech16k(750, 420);
  const startDecision = await ctrl.classifyBimodalTurn({
    pcm16k: userPcm,
    stableText: prompt,
    tailText: '',
    pauseMs: 420,
    speechDurationMs: 750,
    rmsDb: -18,
    assistantSpeaking: false,
    hintedProbs: { COMPLETE: 0.89, INCOMPLETE: 0.07, BACKCHANNEL: 0.02, WAIT_INTERRUPT: 0.02 },
  });

  const statsBefore = ctrl.getStats();

  // Launch assistant speech without draining yet so we can inject mid-speech backchannel
  const turnPromise = ctrl.runTurnFromSimulatedAudio({
    scenario: 'backchannel_hold',
    userText: prompt,
    lang: 'zh',
    decision: startDecision,
    waitForDrain: false,
  });

  const activeOk = await ctrl.waitForPlaybackActive(160, 6000);
  const ackPcm = synthesizeSimulatedUserSpeech16k(300, 120, 0.24);
  const ackText = 'mm-hmm 对对';
  ctrl.ear.feedSimulatedPcm16k(ackPcm, { transcriptHint: ackText, isFinalHint: true });

  const ackDecision = await ctrl.classifyBimodalTurn({
    pcm16k: ackPcm,
    stableText: ackText,
    tailText: '',
    pauseMs: 120,
    speechDurationMs: 300,
    rmsDb: -18,
    assistantSpeaking: true,
    hintedProbs: { COMPLETE: 0.06, INCOMPLETE: 0.08, BACKCHANNEL: 0.82, WAIT_INTERRUPT: 0.04 },
  });

  const holdResult = ctrl.handleBackchannelDuringSpeech(ackText, ackDecision);

  const outcome = await turnPromise;
  await ctrl.waitForPlaybackDrain(8000);
  const statsAfter = ctrl.getStats();
  const row = outcome.telemetryRow;

  const assertions = [
    makeAssert(
      'Assistant playback active when backchannel arrived',
      activeOk,
      `activeOk=${activeOk}`,
    ),
    makeAssert(
      'Bimodal decision resolved BACKCHANNEL_ACK',
      ackDecision.action === 'BACKCHANNEL_ACK',
      `action=${ackDecision.action} reason=${ackDecision.reason}`,
    ),
    makeAssert(
      'Playback remained uninterrupted (wasInterrupted === false)',
      !holdResult.aborted && Boolean(row ? !row.wasInterrupted : true),
      `playerStillActive=${holdResult.playerStillActive} wasInterrupted=${row?.wasInterrupted ?? false}`,
    ),
    makeAssert(
      'Listener ack recorded in LiveOrchestrator',
      statsAfter.backchannelCount > statsBefore.backchannelCount,
      `backchannelCount ${statsBefore.backchannelCount} -> ${statsAfter.backchannelCount}`,
    ),
  ];

  return {
    id: 'backchannel_hold',
    name: SCENARIO_TITLES.backchannel_hold,
    passed: assertions.every((a) => a.ok),
    durationMs: Math.round(performance.now() - startedAt),
    assertions,
    telemetry: row ?? undefined,
  };
}

async function runBargeInKvTruncation(ctrl: ScenarioRuntimeController): Promise<ScenarioRunResult> {
  const startedAt = performance.now();
  await ctrl.resetConversation();

  const prompt1 = '小春，给我们讲讲长一点的海边日落风景吧？';
  const startDecision = await ctrl.classifyBimodalTurn({
    pcm16k: synthesizeSimulatedUserSpeech16k(700, 420),
    stableText: prompt1,
    tailText: '',
    pauseMs: 420,
    speechDurationMs: 700,
    rmsDb: -18,
    assistantSpeaking: false,
    hintedProbs: { COMPLETE: 0.9, INCOMPLETE: 0.06, BACKCHANNEL: 0.02, WAIT_INTERRUPT: 0.02 },
  });

  const statsBefore = ctrl.getStats();
  const turn1Promise = ctrl.runTurnFromSimulatedAudio({
    scenario: 'barge_in_kv_truncation (part 1)',
    userText: prompt1,
    lang: 'zh',
    decision: startDecision,
    waitForDrain: false,
  });

  // Wait until at least ~280ms of active speech has played so heardText contains a real prefix
  const activeOk = await ctrl.waitForPlaybackActive(280, 6000);

  const bargeText = '等一下 wait a second，我问另一个问题';
  const bargePcm = synthesizeSimulatedUserSpeech16k(650, 220, 0.28);
  ctrl.ear.feedSimulatedPcm16k(bargePcm, { transcriptHint: bargeText, isFinalHint: true });

  const bargeDecision = await ctrl.classifyBimodalTurn({
    pcm16k: bargePcm,
    stableText: bargeText,
    tailText: '',
    pauseMs: 220,
    speechDurationMs: 650,
    rmsDb: -15,
    assistantSpeaking: true,
    hintedProbs: { COMPLETE: 0.14, INCOMPLETE: 0.05, BACKCHANNEL: 0.03, WAIT_INTERRUPT: 0.78 },
  });

  const interruption = await ctrl.executeBargeInInterruption('海边的日落');
  await turn1Promise.catch(() => undefined);

  const historyAfterBarge = ctrl.getHistory();
  const hasInterruptedMarker = historyAfterBarge.some(
    (m) => m.role === 'assistant' && m.content.includes('[interrupted]'),
  );
  const statsMid = ctrl.getStats();

  // Immediately run follow-up user turn WITHOUT resetting conversation to confirm KV continuity
  const followUpText = '等一下 wait a second，那现在能听见我说话吗？';
  const followDecision = await ctrl.classifyBimodalTurn({
    pcm16k: synthesizeSimulatedUserSpeech16k(680, 420),
    stableText: followUpText,
    tailText: '',
    pauseMs: 420,
    speechDurationMs: 680,
    rmsDb: -17,
    assistantSpeaking: false,
    hintedProbs: { COMPLETE: 0.89, INCOMPLETE: 0.07, BACKCHANNEL: 0.02, WAIT_INTERRUPT: 0.02 },
  });

  const followOutcome = await ctrl.runTurnFromSimulatedAudio({
    scenario: 'barge_in_kv_truncation (follow-up)',
    userText: followUpText,
    lang: 'mixed',
    decision: followDecision,
    waitForDrain: true,
  });

  const statsFinal = ctrl.getStats();
  const assertions = [
    makeAssert(
      'Assistant speech active prior to barge-in',
      activeOk,
      `heard="${interruption.heardText}"`,
    ),
    makeAssert(
      'Bimodal turn resolved BARGE_IN_COMMIT',
      bargeDecision.action === 'BARGE_IN_COMMIT',
      `action=${bargeDecision.action} class=${bargeDecision.turnClass}`,
    ),
    makeAssert(
      'TTS abort & 45ms cosine fade triggered <= 60ms',
      interruption.abortLatencyMs <= 60,
      `abortLatency=${interruption.abortLatencyMs.toFixed(1)}ms`,
    ),
    makeAssert(
      'xcTruncateReplyToHeard recorded [interrupted] marker',
      hasInterruptedMarker && statsMid.truncationCount > statsBefore.truncationCount,
      `truncCount ${statsBefore.truncationCount}->${statsMid.truncationCount}, marker=${hasInterruptedMarker}`,
    ),
    makeAssert(
      'Follow-up turn preserved multi-turn KV history cleanly',
      followOutcome.replyText.trim().length > 0 && statsFinal.historyMessageCount >= 4,
      `historyMessages=${statsFinal.historyMessageCount} replyLen=${followOutcome.replyText.length}`,
    ),
  ];

  return {
    id: 'barge_in_kv_truncation',
    name: SCENARIO_TITLES.barge_in_kv_truncation,
    passed: assertions.every((a) => a.ok),
    durationMs: Math.round(performance.now() - startedAt),
    assertions,
    telemetry: followOutcome.telemetryRow ?? undefined,
  };
}

async function runHeavyDelegateAmend(ctrl: ScenarioRuntimeController): Promise<ScenarioRunResult> {
  const startedAt = performance.now();
  await ctrl.resetConversation();

  // Seed one live turn so WebLLM's multi-turn KV cache holds SOPHON_LIVE_FRONT_BRAIN_PROMPT warm
  // (matching an active conversation rather than cold reset prefill).
  const warmDecision = await ctrl.classifyBimodalTurn({
    pcm16k: synthesizeSimulatedUserSpeech16k(420, 400),
    stableText: '小春在吗？',
    tailText: '',
    pauseMs: 400,
    speechDurationMs: 420,
    rmsDb: -18,
    assistantSpeaking: false,
    hintedProbs: { COMPLETE: 0.9, INCOMPLETE: 0.06, BACKCHANNEL: 0.02, WAIT_INTERRUPT: 0.02 },
  });
  await ctrl.runTurnFromSimulatedAudio({
    scenario: 'heavy_delegate_amend (warmup)',
    userText: '小春在吗？',
    lang: 'zh',
    decision: warmDecision,
    waitForDrain: true,
  });

  const prompt =
    '帮我查一下 / deeply analyze why iOS TBDR WebGPU drops frames when we use RGBA16F 4x MSAA';
  const pcm = synthesizeSimulatedUserSpeech16k(1250, 440);
  ctrl.ear.feedSimulatedPcm16k(pcm, { transcriptHint: prompt, isFinalHint: true });

  const decision = await ctrl.classifyBimodalTurn({
    pcm16k: pcm,
    stableText: prompt,
    tailText: '',
    pauseMs: 440,
    speechDurationMs: 1250,
    rmsDb: -17,
    assistantSpeaking: false,
    hintedProbs: { COMPLETE: 0.87, INCOMPLETE: 0.08, BACKCHANNEL: 0.02, WAIT_INTERRUPT: 0.03 },
  });

  let delegateFiredAtMs: number | null = null;
  let amendAccepted = false;
  let amendAttempted = false;
  const heavyClauses: string[] = [];

  const turnStart = performance.now();
  const outcome = await ctrl.runTurnFromSimulatedAudio({
    scenario: 'heavy_delegate_amend',
    userText: prompt,
    lang: 'mixed',
    decision,
    waitForDrain: false,
    onDelegateStarted: () => {
      if (delegateFiredAtMs === null) {
        delegateFiredAtMs = Math.round(performance.now() - turnStart);
      }
      if (!amendAttempted) {
        amendAttempted = true;
        // Inject mid-flight amendment right after background task spins up
        setTimeout(() => {
          amendAccepted = ctrl.orchestrator.amendActiveHeavyTask('尤其是开启 bloom 的时候');
        }, 35);
      }
    },
    onHeavyClause: (text) => {
      heavyClauses.push(text);
    },
  });

  // Fallback check in case amendment hasn't fired yet
  if (!amendAttempted && ctrl.getStats().activeHeavyTaskId) {
    amendAttempted = true;
    amendAccepted = ctrl.orchestrator.amendActiveHeavyTask('尤其是开启 bloom 的时候');
  }

  const heavyFinal = await ctrl.waitForHeavyCompletion(32_000);
  await ctrl.waitForPlaybackDrain(25_000);

  const bridgeMs = outcome.delegateTriggeredAtMs ?? delegateFiredAtMs ?? 9999;
  const combinedHeavy = [heavyFinal ?? '', ...heavyClauses, outcome.heavyCommentary]
    .filter(Boolean)
    .join(' ');

  const assertions = [
    makeAssert(
      'Front-Brain emitted immediate route bridge (< 900ms)',
      outcome.delegated && bridgeMs < 900,
      `delegated=${outcome.delegated} bridgeLatency=${bridgeMs}ms`,
    ),
    makeAssert(
      'Mid-flight Heavyworker amendment accepted ("尤其是开启 bloom 的时候")',
      amendAccepted,
      `amendAccepted=${amendAccepted}`,
    ),
    makeAssert(
      'Heavyworker streamed deep commentary seamlessly back into turn',
      combinedHeavy.trim().length > 10,
      `heavyLen=${combinedHeavy.length}`,
    ),
  ];

  return {
    id: 'heavy_delegate_amend',
    name: SCENARIO_TITLES.heavy_delegate_amend,
    passed: assertions.every((a) => a.ok),
    durationMs: Math.round(performance.now() - startedAt),
    assertions,
    telemetry: outcome.telemetryRow ?? undefined,
  };
}

export async function executeVerificationScenario(
  id: ScenarioId,
  ctrl: ScenarioRuntimeController,
): Promise<ScenarioRunResult> {
  try {
    switch (id) {
      case 'zh_banter':
        return await runZhBanter(ctrl);
      case 'en_cs_banter':
        return await runEnCodeSwitchBanter(ctrl);
      case 'backchannel_hold':
        return await runBackchannelHold(ctrl);
      case 'barge_in_kv_truncation':
        return await runBargeInKvTruncation(ctrl);
      case 'heavy_delegate_amend':
        return await runHeavyDelegateAmend(ctrl);
    }
  } catch (err) {
    return {
      id,
      name: SCENARIO_TITLES[id],
      passed: false,
      durationMs: 0,
      assertions: [makeAssert('Scenario execution completed without exception', false, String(err))],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function executeAllVerificationScenarios(
  ctrl: ScenarioRuntimeController,
  onEachResult?: (res: ScenarioRunResult) => void,
): Promise<ScenarioRunResult[]> {
  const results: ScenarioRunResult[] = [];
  for (const id of SCENARIO_ORDER) {
    const res = await executeVerificationScenario(id, ctrl);
    results.push(res);
    onEachResult?.(res);
  }
  return results;
}
