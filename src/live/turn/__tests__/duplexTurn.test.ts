import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ort from 'onnxruntime-web/wasm';
import { describe, expect, it } from 'vitest';

import { decideBimodalTurn } from '@/live/turn/bimodalTurnFusion';
import {
  DUPLEX_TURN_CLASSES,
  type DuplexTurnManifest,
  type DuplexTurnProbs,
} from '@/live/turn/types';
import {
  WHISPER_MAX_SAMPLES,
  WHISPER_N_FRAMES,
  WHISPER_N_MELS,
  WHISPER_SAMPLE_RATE,
  WhisperMel80Extractor,
} from '@/live/turn/whisperMel80';

interface MelFormulaTerm {
  fn: 'sin' | 'cos';
  amp: number;
  freqHz: number;
}

interface MelReferenceCase {
  name: string;
  length: number;
  encoding: 'samples' | 'harmonic_formula';
  samples?: number[];
  formula?: {
    sampleRate: number;
    length: number;
    terms: MelFormulaTerm[];
  };
  summary: {
    min: number;
    max: number;
    mean: number;
    std: number;
    l2Norm: number;
  };
  boundaryFrames: Record<string, number[]>;
  sampledPoints: [number, number, number][];
}

interface MelReferenceFixture {
  sampleRate: number;
  maxSamples: number;
  nMels: number;
  nFrames: number;
  paddingSide: 'left';
  cases: MelReferenceCase[];
}

function buildCaseWaveform(c: MelReferenceCase): Float32Array {
  if (c.encoding === 'samples' && c.samples) {
    return Float32Array.from(c.samples);
  }
  if (c.encoding === 'harmonic_formula' && c.formula) {
    const out = new Float32Array(c.formula.length);
    const { sampleRate, length, terms } = c.formula;
    for (let i = 0; i < length; i++) {
      let val = 0;
      for (const term of terms) {
        const phase = (2 * Math.PI * term.freqHz * i) / sampleRate;
        val += term.amp * (term.fn === 'sin' ? Math.sin(phase) : Math.cos(phase));
      }
      out[i] = val;
    }
    return out;
  }
  throw new Error(`Unsupported mel reference encoding for case ${c.name}`);
}

function softmaxWithTemperature(logits: ArrayLike<number>, temperature: number): DuplexTurnProbs {
  const temp = Math.max(0.05, temperature);
  let maxVal = -Infinity;
  for (let i = 0; i < DUPLEX_TURN_CLASSES.length; i++) {
    const s = logits[i] / temp;
    if (s > maxVal) maxVal = s;
  }
  const exps = new Float64Array(DUPLEX_TURN_CLASSES.length);
  let sum = 0;
  for (let i = 0; i < DUPLEX_TURN_CLASSES.length; i++) {
    const e = Math.exp(logits[i] / temp - maxVal);
    exps[i] = e;
    sum += e;
  }
  return {
    COMPLETE: exps[0] / sum,
    INCOMPLETE: exps[1] / sum,
    BACKCHANNEL: exps[2] / sum,
    WAIT_INTERRUPT: exps[3] / sum,
  };
}

function makeProbs(partial: Partial<DuplexTurnProbs>): DuplexTurnProbs {
  const base: DuplexTurnProbs = {
    COMPLETE: partial.COMPLETE ?? 0.05,
    INCOMPLETE: partial.INCOMPLETE ?? 0.05,
    BACKCHANNEL: partial.BACKCHANNEL ?? 0.05,
    WAIT_INTERRUPT: partial.WAIT_INTERRUPT ?? 0.05,
  };
  const sum = base.COMPLETE + base.INCOMPLETE + base.BACKCHANNEL + base.WAIT_INTERRUPT;
  return {
    COMPLETE: base.COMPLETE / sum,
    INCOMPLETE: base.INCOMPLETE / sum,
    BACKCHANNEL: base.BACKCHANNEL / sum,
    WAIT_INTERRUPT: base.WAIT_INTERRUPT / sum,
  };
}

describe('WhisperMel80Extractor', () => {
  const fixturePath = path.resolve(__dirname, 'fixtures/mel_reference.json');

  it('matches HuggingFace WhisperFeatureExtractor within < 1e-4 across short/medium/long cases', () => {
    const raw = fs.readFileSync(fixturePath, 'utf-8');
    const fixture = JSON.parse(raw) as MelReferenceFixture;

    expect(fixture.sampleRate).toBe(WHISPER_SAMPLE_RATE);
    expect(fixture.maxSamples).toBe(WHISPER_MAX_SAMPLES);
    expect(fixture.nMels).toBe(WHISPER_N_MELS);
    expect(fixture.nFrames).toBe(WHISPER_N_FRAMES);
    expect(fixture.paddingSide).toBe('left');
    expect(fixture.cases.length).toBeGreaterThanOrEqual(3);

    const extractor = new WhisperMel80Extractor();

    for (const c of fixture.cases) {
      const pcm = buildCaseWaveform(c);
      const mel = extractor.extract(pcm);
      expect(mel.length).toBe(WHISPER_N_MELS * WHISPER_N_FRAMES);

      let maxDiff = 0;

      // 1. Check all boundary frames [0, 1, 2, 399, 760, 797, 798, 799] across all 80 mel bins
      for (const [frameStr, expectedCol] of Object.entries(c.boundaryFrames)) {
        const frameIdx = Number(frameStr);
        expect(expectedCol.length).toBe(WHISPER_N_MELS);
        for (let m = 0; m < WHISPER_N_MELS; m++) {
          const actual = mel[m * WHISPER_N_FRAMES + frameIdx];
          const diff = Math.abs(actual - expectedCol[m]);
          if (diff > maxDiff) maxDiff = diff;
          expect(diff).toBeLessThan(1e-4);
        }
      }

      // 2. Check 240 stratified random (mel, frame) points
      for (const [m, t, expected] of c.sampledPoints) {
        const actual = mel[m * WHISPER_N_FRAMES + t];
        const diff = Math.abs(actual - expected);
        if (diff > maxDiff) maxDiff = diff;
        expect(diff).toBeLessThan(1e-4);
      }

      // 3. Check summary statistics (min, max, mean, std)
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      for (let i = 0; i < mel.length; i++) {
        const v = mel[i];
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
      const mean = sum / mel.length;
      let sq = 0;
      for (let i = 0; i < mel.length; i++) {
        const d = mel[i] - mean;
        sq += d * d;
      }
      const std = Math.sqrt(sq / mel.length);

      expect(Math.abs(min - c.summary.min)).toBeLessThan(1e-4);
      expect(Math.abs(max - c.summary.max)).toBeLessThan(1e-4);
      expect(Math.abs(mean - c.summary.mean)).toBeLessThan(1e-4);
      expect(Math.abs(std - c.summary.std)).toBeLessThan(1e-4);
      expect(maxDiff).toBeLessThan(1e-4);
    }
  });

  it('reuses preallocated buffers with zero extra allocations and deterministic repeatability', () => {
    const raw = fs.readFileSync(fixturePath, 'utf-8');
    const fixture = JSON.parse(raw) as MelReferenceFixture;
    const waveA = buildCaseWaveform(fixture.cases[0]);
    const waveB = buildCaseWaveform(fixture.cases[1]);

    const extractor = new WhisperMel80Extractor();
    const outA = extractor.extract(waveA);
    const snapshotA = Float32Array.from(outA);

    const outB = extractor.extract(waveB);
    expect(outB).toBe(outA);
    expect(outB.buffer).toBe(outA.buffer);

    const externalDst = new Float32Array(WHISPER_N_MELS * WHISPER_N_FRAMES);
    for (let i = 0; i < 10; i++) {
      const target = extractor.extract(i % 2 === 0 ? waveA : waveB, externalDst);
      expect(target).toBe(externalDst);
    }

    // Re-extract waveA after alternating calls to prove scratch buffers hold zero stale residue
    const outAAgain = extractor.extract(waveA, externalDst);
    expect(outAAgain).toBe(externalDst);
    for (let i = 0; i < snapshotA.length; i++) {
      expect(outAAgain[i]).toBe(snapshotA[i]);
    }
  });
});

describe('duplex-turn INT8 ONNX model', () => {
  const modelDir = path.resolve(process.cwd(), 'public/models/duplex-turn');
  const manifestPath = path.join(modelDir, 'manifest.json');
  const onnxPath = path.join(modelDir, 'duplex-turn-zh-en-v1.int8.onnx');

  it('loads INT8 model in onnxruntime and emits calibrated 4-class logits/probabilities', async () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(onnxPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as DuplexTurnManifest;
    expect(manifest.classes).toEqual([...DUPLEX_TURN_CLASSES]);
    expect(manifest.inputShape).toEqual([1, WHISPER_N_MELS, WHISPER_N_FRAMES]);
    expect(manifest.sampleRate).toBe(WHISPER_SAMPLE_RATE);
    expect(manifest.maxSamples).toBe(WHISPER_MAX_SAMPLES);
    expect(manifest.paddingSide).toBe('left');
    expect(manifest.temperature).toBeGreaterThan(0.05);

    const modelBytes = new Uint8Array(fs.readFileSync(onnxPath));
    expect(modelBytes.byteLength).toBeGreaterThan(4 * 1024 * 1024);
    expect(modelBytes.byteLength).toBeLessThan(20 * 1024 * 1024);

    if (ort.env?.wasm) {
      const distDir = path.resolve(process.cwd(), 'node_modules/onnxruntime-web/dist');
      if (fs.existsSync(distDir)) {
        ort.env.wasm.wasmPaths = `${pathToFileURL(distDir).href}/`;
      }
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.simd = true;
    }

    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
    });

    try {
      const extractor = new WhisperMel80Extractor();
      // 1.2s voiced multi-harmonic burst (simulates a short utterance ending at t=8.0s)
      const pcm = new Float32Array(Math.floor(1.2 * WHISPER_SAMPLE_RATE));
      for (let i = 0; i < pcm.length; i++) {
        const t = i / WHISPER_SAMPLE_RATE;
        const env = Math.sin((Math.PI * i) / pcm.length);
        pcm[i] =
          env *
          (0.28 * Math.sin(2 * Math.PI * 220 * t) +
            0.14 * Math.sin(2 * Math.PI * 580 * t) +
            0.07 * Math.cos(2 * Math.PI * 1420 * t));
      }

      const mel = extractor.extract(pcm);
      const inputTensor = new ort.Tensor('float32', mel, [1, WHISPER_N_MELS, WHISPER_N_FRAMES]);
      const inputName = session.inputNames[0] || 'input_features';
      const outputName = session.outputNames[0] || 'logits';

      const outputs = await session.run({ [inputName]: inputTensor });
      const logitsTensor = outputs[outputName];
      expect(logitsTensor).toBeDefined();
      expect(logitsTensor.dims).toEqual([1, 4]);

      const logits = logitsTensor.data as Float32Array;
      for (let i = 0; i < 4; i++) {
        expect(Number.isFinite(logits[i])).toBe(true);
      }

      const probs = softmaxWithTemperature(logits, manifest.temperature);
      const total =
        probs.COMPLETE + probs.INCOMPLETE + probs.BACKCHANNEL + probs.WAIT_INTERRUPT;
      expect(total).toBeCloseTo(1.0, 5);
      for (const cls of DUPLEX_TURN_CLASSES) {
        expect(probs[cls]).toBeGreaterThan(0);
        expect(probs[cls]).toBeLessThan(1);
      }
    } finally {
      if (typeof session.release === 'function') {
        await session.release();
      }
    }
  });
});

describe('decideBimodalTurn (Bilingual ZH/EN/CS Full-Duplex Fusion)', () => {
  it('commits clear ZH, EN, and EN-ZH Code-Switching complete questions', () => {
    const zh = decideBimodalTurn({
      probs: makeProbs({ COMPLETE: 0.86 }),
      stableText: '今天上海天气怎么样？',
      tailText: '',
      pauseMs: 280,
      assistantSpeaking: false,
      speechDurationMs: 1400,
      rmsDb: -24,
    });
    expect(zh.action).toBe('COMMIT_USER_TURN');
    expect(zh.turnClass).toBe('COMPLETE');

    const en = decideBimodalTurn({
      probs: makeProbs({ COMPLETE: 0.82 }),
      stableText: "What's the weather in Tokyo",
      tailText: 'today?',
      pauseMs: 300,
      assistantSpeaking: false,
      speechDurationMs: 1300,
      rmsDb: -26,
    });
    expect(en.action).toBe('COMMIT_USER_TURN');
    expect(en.combinedText).toBe("What's the weather in Tokyo today?");

    const cs = decideBimodalTurn({
      probs: makeProbs({ COMPLETE: 0.78 }),
      stableText: '帮我查一下这个 API 的',
      tailText: 'rate limit 是多少？',
      pauseMs: 260,
      assistantSpeaking: false,
      speechDurationMs: 1850,
      rmsDb: -25,
    });
    expect(cs.action).toBe('COMMIT_USER_TURN');
    expect(cs.combinedText).toBe('帮我查一下这个 API 的rate limit 是多少？');
  });

  it('holds and waits on incomplete ZH, EN, and CS utterances across pause tiers', () => {
    const zhShortPause = decideBimodalTurn({
      probs: makeProbs({ COMPLETE: 0.65, INCOMPLETE: 0.25 }), // even if acoustic leans slightly complete
      stableText: '我觉得这个方案因为',
      tailText: '',
      pauseMs: 260,
      assistantSpeaking: false,
      speechDurationMs: 1200,
    });
    expect(zhShortPause.action).toBe('CONTINUE_WAITING');
    expect(zhShortPause.turnClass).toBe('INCOMPLETE');

    const zhUnclosedCond = decideBimodalTurn({
      probs: makeProbs({ COMPLETE: 0.65, INCOMPLETE: 0.25 }),
      stableText: '如果按照这个方案',
      tailText: '',
      pauseMs: 280,
      assistantSpeaking: false,
      speechDurationMs: 1100,
    });
    expect(zhUnclosedCond.action).toBe('CONTINUE_WAITING');
    expect(zhUnclosedCond.turnClass).toBe('INCOMPLETE');

    const enSoftHold = decideBimodalTurn({
      probs: makeProbs({ INCOMPLETE: 0.75 }),
      stableText: 'Wait so when you configure the router and',
      tailText: '',
      pauseMs: 800,
      assistantSpeaking: false,
      speechDurationMs: 1900,
    });
    expect(enSoftHold.action).toBe('HOLD_SOFT');
    expect(enSoftHold.turnClass).toBe('INCOMPLETE');

    const csHold = decideBimodalTurn({
      probs: makeProbs({ COMPLETE: 0.52, INCOMPLETE: 0.35 }),
      stableText: '我刚才测试了那个 Whisper model',
      tailText: '但是',
      pauseMs: 300,
      assistantSpeaking: false,
      speechDurationMs: 2100,
    });
    expect(csHold.action).toBe('CONTINUE_WAITING');

    // Pure acoustic incomplete (no conjunction) holds up to 1.4s then commits gracefully
    const acousticIncompleteWait = decideBimodalTurn({
      probs: makeProbs({ INCOMPLETE: 0.72 }),
      stableText: '明天下午',
      tailText: '',
      pauseMs: 320,
      assistantSpeaking: false,
      speechDurationMs: 700,
    });
    expect(acousticIncompleteWait.action).toBe('CONTINUE_WAITING');

    // Timeout safety prevents infinite deadlock after > 1.5s pause
    const timeoutCommit = decideBimodalTurn({
      probs: makeProbs({ INCOMPLETE: 0.72 }),
      stableText: '然后我昨天说的那个文件',
      tailText: '',
      pauseMs: 1550,
      assistantSpeaking: false,
      speechDurationMs: 1600,
    });
    expect(timeoutCommit.action).toBe('COMMIT_USER_TURN');
  });

  it('treats ZH/EN/CS backchannels as BACKCHANNEL_ACK during assistant speech and NEVER barges in', () => {
    const cases = [
      { text: 'mm-hmm', probs: makeProbs({ BACKCHANNEL: 0.85 }) },
      { text: 'yeah', probs: makeProbs({ BACKCHANNEL: 0.78 }) },
      { text: '对对', probs: makeProbs({ BACKCHANNEL: 0.81 }) },
      { text: '嗯嗯', probs: makeProbs({ BACKCHANNEL: 0.84 }) },
      { text: 'yeah 对对', probs: makeProbs({ BACKCHANNEL: 0.74 }) },
      // Even when acoustic is uncertain, short pure backchannel must NOT trigger barge-in
      { text: 'got it', probs: makeProbs({ COMPLETE: 0.55, BACKCHANNEL: 0.35 }) },
      // Pure acoustic backchannel without finalized ASR text yet
      { text: '', probs: makeProbs({ BACKCHANNEL: 0.76 }) },
    ];

    for (const c of cases) {
      const decision = decideBimodalTurn({
        probs: c.probs,
        stableText: c.text,
        tailText: '',
        pauseMs: 320,
        assistantSpeaking: true,
        speechDurationMs: 420,
        rmsDb: -28,
      });
      expect(decision.action).toBe('BACKCHANNEL_ACK');
      expect(decision.action).not.toBe('BARGE_IN_COMMIT');
      expect(decision.turnClass).toBe('BACKCHANNEL');
    }
  });

  it('maps WAIT cues to WAIT_SILENT_HOLD when standalone and BARGE_IN_COMMIT when paired with query', () => {
    const holdCases = ['等一下', '先停一下', 'wait a sec', 'hold on', 'sorry wait 等一下'];
    for (const phrase of holdCases) {
      const res = decideBimodalTurn({
        probs: makeProbs({ WAIT_INTERRUPT: 0.82 }),
        stableText: phrase,
        tailText: '',
        pauseMs: 220,
        assistantSpeaking: true,
        speechDurationMs: 550,
        rmsDb: -22,
      });
      expect(res.action).toBe('WAIT_SILENT_HOLD');
      expect(res.turnClass).toBe('WAIT_INTERRUPT');
    }

    const csBargeIn = decideBimodalTurn({
      probs: makeProbs({ WAIT_INTERRUPT: 0.78, COMPLETE: 0.14 }),
      stableText: '等一下 wait a second，',
      tailText: '我问另一个问题',
      pauseMs: 220,
      assistantSpeaking: true,
      speechDurationMs: 1550,
      rmsDb: -20,
    });
    expect(csBargeIn.action).toBe('BARGE_IN_COMMIT');

    const substantiveInterrupt = decideBimodalTurn({
      probs: makeProbs({ COMPLETE: 0.79 }),
      stableText: 'Stop and explain the second option instead.',
      tailText: '',
      pauseMs: 260,
      assistantSpeaking: true,
      speechDurationMs: 1700,
      rmsDb: -21,
    });
    expect(substantiveInterrupt.action).toBe('BARGE_IN_COMMIT');
  });

  it('guards against sub-threshold silence / noise and formats ASCII vs CJK boundaries', () => {
    const silence = decideBimodalTurn({
      probs: makeProbs({ COMPLETE: 0.92 }),
      stableText: '',
      tailText: '',
      pauseMs: 1000,
      assistantSpeaking: false,
      speechDurationMs: 80,
      rmsDb: -68,
    });
    expect(silence.action).toBe('CONTINUE_WAITING');
    expect(silence.reason).toBe('silence_or_subthreshold_noise');

    const asciiJoin = decideBimodalTurn({
      probs: makeProbs({ COMPLETE: 0.8 }),
      stableText: 'check the',
      tailText: 'router?',
      pauseMs: 300,
      assistantSpeaking: false,
      speechDurationMs: 900,
    });
    expect(asciiJoin.combinedText).toBe('check the router?');

    const cjkJoin = decideBimodalTurn({
      probs: makeProbs({ COMPLETE: 0.8 }),
      stableText: '帮我看',
      tailText: '一下。',
      pauseMs: 300,
      assistantSpeaking: false,
      speechDurationMs: 900,
    });
    expect(cjkJoin.combinedText).toBe('帮我看一下。');
  });

  it('overrides noisy/synthetic acoustic BACKCHANNEL with COMPLETE when lexical completeness is satisfied', () => {
    // 1. Chinese substantive speech without punctuation under heavy acoustic BACKCHANNEL bias
    const zhNoisyBackchannel = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: '帮我查一下这个方案的可行性',
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 950,
      rmsDb: -22,
    });
    expect(zhNoisyBackchannel.action).toBe('COMMIT_USER_TURN');
    expect(zhNoisyBackchannel.turnClass).toBe('COMPLETE');
    expect(zhNoisyBackchannel.reason).toBe('lexical_complete_commit');

    // 2. Micro-pause (< 220ms) holds waiting but NEVER reports BACKCHANNEL for substantive speech
    const zhMicroPause = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: '帮我查一下这个方案的可行性',
      tailText: '',
      pauseMs: 140,
      assistantSpeaking: false,
      speechDurationMs: 950,
      rmsDb: -22,
    });
    expect(zhMicroPause.action).toBe('CONTINUE_WAITING');
    expect(zhMicroPause.turnClass).toBe('COMPLETE'); // Overridden from BACKCHANNEL
    expect(zhMicroPause.reason).toBe('awaiting_pause_threshold');

    // 3. English substantive speech without punctuation under acoustic BACKCHANNEL bias
    const enNoisyBackchannel = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.88, COMPLETE: 0.04 }),
      stableText: 'What is the recommended timeout for the database connection',
      tailText: '',
      pauseMs: 240,
      assistantSpeaking: false,
      speechDurationMs: 1600,
      rmsDb: -24,
    });
    expect(enNoisyBackchannel.action).toBe('COMMIT_USER_TURN');
    expect(enNoisyBackchannel.turnClass).toBe('COMPLETE');
    expect(enNoisyBackchannel.reason).toBe('lexical_complete_commit');

    // 4. Code-switching substantive speech without punctuation under acoustic BACKCHANNEL bias
    const csNoisyBackchannel = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.79, COMPLETE: 0.08 }),
      stableText: '帮我排查一下 WebGPU compute pipeline 的 OOM 崩溃',
      tailText: '',
      pauseMs: 220,
      assistantSpeaking: false,
      speechDurationMs: 1800,
      rmsDb: -20,
    });
    expect(csNoisyBackchannel.action).toBe('COMMIT_USER_TURN');
    expect(csNoisyBackchannel.turnClass).toBe('COMPLETE');
    expect(csNoisyBackchannel.reason).toBe('lexical_complete_commit');

    // 5. Genuine pure backchannel ("嗯嗯") preserves BACKCHANNEL behavior
    const genuineBackchannelWait = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.85, COMPLETE: 0.05 }),
      stableText: '嗯嗯',
      tailText: '',
      pauseMs: 300,
      assistantSpeaking: false,
      speechDurationMs: 350,
    });
    expect(genuineBackchannelWait.action).toBe('CONTINUE_WAITING');
    expect(genuineBackchannelWait.turnClass).toBe('BACKCHANNEL');

    // 6. Lexically incomplete utterance ("我觉得这个方案因为...") does NOT trigger lexical_complete_commit
    const incompleteWithConjunction = decideBimodalTurn({
      probs: makeProbs({ BACKCHANNEL: 0.82 }),
      stableText: '我觉得这个方案因为',
      tailText: '',
      pauseMs: 260,
      assistantSpeaking: false,
      speechDurationMs: 1100,
    });
    expect(incompleteWithConjunction.action).toBe('CONTINUE_WAITING');
    expect(incompleteWithConjunction.turnClass).toBe('INCOMPLETE');
  });
});
