/**
 * sileroVad.ts — High-precision Neural Voice Activity Detector (Silero VAD v5).
 *
 * Runs locally via onnxruntime-web. Filters out mechanical keyboard clicks,
 * breathing, wind, and background noise while preserving 100% of speech onsets
 * via an internal 300ms pre-speech ring buffer.
 */
import * as ort from 'onnxruntime-web';
import { APP_CONFIG } from '@/config';

export type SileroVadConfig = {
  sampleRate?: number;
  /** Probability threshold (0..1) to enter speech state. Default 0.50. */
  startThreshold?: number;
  /** Probability threshold below which audio is considered silence. Default 0.35. */
  silenceThreshold?: number;
  /** Required continuous silence duration to end utterance (ms). Default 450ms. */
  silenceMs?: number;
  /** Max utterance length (ms). Default 20000ms. */
  maxMs?: number;
  /** Consecutive speech frames required before locking speech start. Default 3 (~96ms). */
  minSpeechFrames?: number;
  /** Pre-speech audio buffer duration to prepend (ms) so first consonants are never clipped. */
  prerollMs?: number;
  /** Silero VAD v5 model path or URL. */
  modelPath?: string;
};

export type SileroVadEvent =
  | { type: 'speech_start' }
  | { type: 'speech_end'; pcm: Float32Array; durationMs: number }
  | { type: 'frame'; prob: number; rms: number; inSpeech: boolean };

const DEFAULT_MODEL_PATH = '/models/silero_vad_v5.onnx';
const FALLBACK_MODEL_URL =
  'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/silero_vad_v5.onnx';

export class SileroVad {
  private session: ort.InferenceSession | null = null;
  private stateTensor: ort.Tensor | null = null;
  private srTensor: ort.Tensor | null = null;
  private readonly cfg: Required<SileroVadConfig>;
  private readonly frameSamples = 512; // 32ms at 16kHz for Silero VAD v5
  private readonly prerollMaxSamples: number;

  private pcmBuffer: number[] = [];
  private prerollRing: number[] = [];
  private speechHold: number[] = [];
  private utterance: number[] = [];

  private inSpeech = false;
  private consecutiveSpeechFrames = 0;
  private consecutiveSilenceSamples = 0;
  private totalSpeechSamples = 0;
  private isProcessing = false;
  private initPromise: Promise<void> | null = null;

  constructor(cfg?: SileroVadConfig) {
    this.cfg = {
      sampleRate: 16000,
      startThreshold: 0.50,
      silenceThreshold: 0.35,
      silenceMs: 450,
      maxMs: APP_CONFIG.stt.vadMaxMs ?? 20000,
      minSpeechFrames: 3,
      prerollMs: 300,
      modelPath: DEFAULT_MODEL_PATH,
      ...cfg,
    };
    this.prerollMaxSamples = Math.round((this.cfg.prerollMs / 1000) * this.cfg.sampleRate);
  }

  /** Initialize ONNX runtime session for Silero VAD. */
  async init(): Promise<void> {
    if (this.session) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        // Try local model first, fallback to CDN if needed
        let session: ort.InferenceSession;
        try {
          session = await ort.InferenceSession.create(this.cfg.modelPath, {
            executionProviders: ['wasm'],
          });
        } catch (localErr) {
          console.warn('[Silero VAD] Local model load failed, trying fallback CDN...', localErr);
          session = await ort.InferenceSession.create(FALLBACK_MODEL_URL, {
            executionProviders: ['wasm'],
          });
        }

        this.session = session;
        this.resetState();
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  isReady(): boolean {
    return this.session !== null;
  }

  private resetState(): void {
    // Silero VAD v5 state tensor shape: [2, 1, 128]
    const stateData = new Float32Array(2 * 1 * 128);
    this.stateTensor = new ort.Tensor('float32', stateData, [2, 1, 128]);
    this.srTensor = new ort.Tensor('int64', new BigInt64Array([BigInt(this.cfg.sampleRate)]), [1]);
  }

  reset(): void {
    this.pcmBuffer = [];
    this.prerollRing = [];
    this.speechHold = [];
    this.utterance = [];
    this.inSpeech = false;
    this.consecutiveSpeechFrames = 0;
    this.consecutiveSilenceSamples = 0;
    this.totalSpeechSamples = 0;
    this.isProcessing = false;
    this.resetState();
  }

  /** Whether the VAD has locked speech start and is actively tracking an utterance. */
  isInSpeech(): boolean {
    return this.inSpeech;
  }

  /** Whether speech is either locked or currently accumulating initial onset candidate frames. */
  isSpeechCandidate(): boolean {
    return this.inSpeech || this.consecutiveSpeechFrames > 0;
  }

  private pushPreroll(frame: number[]): void {
    this.prerollRing.push(...frame);
    if (this.prerollRing.length > this.prerollMaxSamples) {
      this.prerollRing.splice(0, this.prerollRing.length - this.prerollMaxSamples);
    }
  }

  /**
   * Process 16kHz mono float32 audio chunk and emit VAD events.
   * If model is not yet ready, uses mathematical RMS gate as temporary fallback.
   * Internal mutex prevents overlapping inference sessions on Web Audio callbacks.
   */
  async processChunk(
    chunk: Float32Array,
    onEvent: (ev: SileroVadEvent) => void,
  ): Promise<void> {
    for (let i = 0; i < chunk.length; i++) {
      this.pcmBuffer.push(chunk[i]!);
    }

    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const { frameSamples } = this;
      const { startThreshold, silenceThreshold, silenceMs, maxMs, sampleRate, minSpeechFrames } =
        this.cfg;
      const silenceSamplesNeed = Math.round((silenceMs / 1000) * sampleRate);
      const maxSamplesNeed = Math.round((maxMs / 1000) * sampleRate);

      while (this.pcmBuffer.length >= frameSamples) {
        const frameArray = this.pcmBuffer.splice(0, frameSamples);
        const frameF32 = new Float32Array(frameArray);

        // Compute frame RMS for volume meter
        let sumSq = 0;
        for (let i = 0; i < frameArray.length; i++) {
          const v = frameArray[i]!;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / frameArray.length);

        let speechProb = 0;

        if (this.session && this.stateTensor && this.srTensor) {
          try {
            const inputTensor = new ort.Tensor('float32', frameF32, [1, frameSamples]);
            const feeds: Record<string, ort.Tensor> = {
              input: inputTensor,
              state: this.stateTensor,
              sr: this.srTensor,
            };
            const outputs = await this.session.run(feeds);
            speechProb = (outputs.output?.data as Float32Array)?.[0] ?? 0;
            if (outputs.stateN) {
              this.stateTensor = outputs.stateN;
            }
          } catch (e) {
            console.warn('[Silero VAD] Inference error, fallback to RMS', e);
            speechProb = rms >= 0.015 ? 0.7 : 0.05;
          }
        } else {
          // Fallback before ONNX ready
          speechProb = rms >= 0.015 ? 0.7 : 0.05;
        }

        const isSpeechFrame = speechProb >= startThreshold;
        const isSilenceFrame = speechProb < silenceThreshold;

        if (!this.inSpeech) {
          this.pushPreroll(frameArray);

          if (isSpeechFrame) {
            this.consecutiveSpeechFrames++;
            this.speechHold.push(...frameArray);

            if (this.consecutiveSpeechFrames >= minSpeechFrames) {
              this.inSpeech = true;
              const holdLen = this.speechHold.length;
              const pre = this.prerollRing.slice(0, Math.max(0, this.prerollRing.length - holdLen));
              this.utterance = pre.concat(this.speechHold);
              this.totalSpeechSamples = this.utterance.length;
              this.consecutiveSilenceSamples = 0;
              this.speechHold = [];
              this.prerollRing = [];
              onEvent({ type: 'speech_start' });
            }
          } else {
            this.consecutiveSpeechFrames = 0;
            this.speechHold = [];
          }

          onEvent({ type: 'frame', prob: speechProb, rms, inSpeech: false });
        } else {
          // In speech
          this.utterance.push(...frameArray);
          this.totalSpeechSamples += frameArray.length;

          if (isSilenceFrame) {
            this.consecutiveSilenceSamples += frameArray.length;
          } else {
            this.consecutiveSilenceSamples = 0;
          }

          onEvent({ type: 'frame', prob: speechProb, rms, inSpeech: true });

          const hitSilence = this.consecutiveSilenceSamples >= silenceSamplesNeed;
          const hitMax = this.totalSpeechSamples >= maxSamplesNeed;

          if (hitSilence || hitMax) {
            const pcm = Float32Array.from(this.utterance);
            const durationMs = (pcm.length / sampleRate) * 1000;
            this.inSpeech = false;
            this.consecutiveSpeechFrames = 0;
            this.consecutiveSilenceSamples = 0;
            this.totalSpeechSamples = 0;
            this.utterance = [];
            this.speechHold = [];
            const tail = Math.min(pcm.length, this.prerollMaxSamples);
            this.prerollRing = Array.from(pcm.subarray(pcm.length - tail));
            onEvent({ type: 'speech_end', pcm, durationMs });
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /** Force flush leftover speech on mic stop. */
  flush(): Float32Array | null {
    if (!this.inSpeech && this.utterance.length === 0 && this.speechHold.length === 0) {
      this.reset();
      return null;
    }
    const pcm = Float32Array.from(
      this.inSpeech ? this.utterance : this.prerollRing.concat(this.speechHold),
    );
    this.reset();
    return pcm;
  }

  dispose(): void {
    this.reset();
    this.session = null;
    this.initPromise = null;
  }
}
