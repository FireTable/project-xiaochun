/**
 * Energy VAD — trailing-silence segmentation (no Silero).
 *
 * Speech starts when short-term RMS exceeds `startThreshold` for `startMs`.
 * Keeps ~prerollMs of audio before latch (otoji-style) so onsets are not shaved.
 * Utterance ends when trailing silence exceeds `silenceMs`, or duration hits `maxMs`.
 * Trailing silence is KEPT in the emitted PCM (less clipping).
 */
export type EnergyVadConfig = {
  sampleRate: number;
  /** Trailing silence to end utterance (ms). Default ~600. */
  silenceMs: number;
  /** Max utterance length (ms). Default ~20000. */
  maxMs: number;
  /** RMS to enter speech (0..1 float PCM scale). */
  startThreshold?: number;
  /** RMS below this counts as silence while in speech. */
  silenceThreshold?: number;
  /** Require this many ms above startThreshold before latching speech. */
  startMs?: number;
  /** Keep this many ms before speech latch (ring buffer). */
  prerollMs?: number;
  /** Frame hop for energy (samples). */
  frameSamples?: number;
};

export type EnergyVadEvent =
  | { type: 'speech_start' }
  | { type: 'speech_end'; pcm: Float32Array; durationMs: number }
  | { type: 'frame'; rms: number; inSpeech: boolean };

export class EnergyVad {
  private readonly cfg: Required<EnergyVadConfig>;
  private readonly prerollMax: number;
  private buf: number[] = [];
  private preroll: number[] = [];
  private hold: number[] = [];
  private inSpeech = false;
  private speechSamples = 0;
  private silenceSamples = 0;
  private startHoldSamples = 0;
  private utterance: number[] = [];

  constructor(cfg: EnergyVadConfig) {
    this.cfg = {
      startThreshold: 0.014,
      silenceThreshold: 0.008,
      startMs: 80,
      prerollMs: 300,
      frameSamples: 512,
      ...cfg,
    };
    this.prerollMax = Math.max(
      1,
      Math.round((this.cfg.prerollMs / 1000) * this.cfg.sampleRate),
    );
  }

  reset(): void {
    this.buf = [];
    this.preroll = [];
    this.hold = [];
    this.inSpeech = false;
    this.speechSamples = 0;
    this.silenceSamples = 0;
    this.startHoldSamples = 0;
    this.utterance = [];
  }

  private pushPreroll(frame: number[]): void {
    this.preroll.push(...frame);
    if (this.preroll.length > this.prerollMax) {
      this.preroll.splice(0, this.preroll.length - this.prerollMax);
    }
  }

  /** Feed mono float PCM (-1..1). May emit 0..n events. */
  push(chunk: Float32Array, onEvent: (ev: EnergyVadEvent) => void): void {
    const { frameSamples, sampleRate, startThreshold, silenceThreshold, startMs, silenceMs, maxMs } =
      this.cfg;
    const startHoldNeed = Math.max(1, Math.round((startMs / 1000) * sampleRate));
    const silenceNeed = Math.max(1, Math.round((silenceMs / 1000) * sampleRate));
    const maxNeed = Math.max(1, Math.round((maxMs / 1000) * sampleRate));

    for (let i = 0; i < chunk.length; i++) {
      this.buf.push(chunk[i]!);
    }

    while (this.buf.length >= frameSamples) {
      const frame = this.buf.splice(0, frameSamples);
      let sum = 0;
      for (let i = 0; i < frame.length; i++) {
        const v = frame[i]!;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / frame.length);
      const loud = rms >= startThreshold;
      const quiet = rms < silenceThreshold;

      if (!this.inSpeech) {
        this.pushPreroll(frame);
        if (loud) {
          this.startHoldSamples += frame.length;
          this.hold.push(...frame);
          if (this.startHoldSamples >= startHoldNeed) {
            this.inSpeech = true;
            const holdLen = this.hold.length;
            const pre = this.preroll.slice(0, Math.max(0, this.preroll.length - holdLen));
            this.utterance = pre.concat(this.hold);
            this.speechSamples = this.utterance.length;
            this.silenceSamples = 0;
            this.hold = [];
            this.preroll = [];
            onEvent({ type: 'speech_start' });
          }
        } else {
          this.startHoldSamples = 0;
          this.hold = [];
        }
        onEvent({ type: 'frame', rms, inSpeech: false });
        continue;
      }

      // Keep trailing silence in the buffer (do not drop on cut).
      this.utterance.push(...frame);
      this.speechSamples += frame.length;
      if (quiet) {
        this.silenceSamples += frame.length;
      } else {
        this.silenceSamples = 0;
      }
      onEvent({ type: 'frame', rms, inSpeech: true });

      const hitSilence = this.silenceSamples >= silenceNeed;
      const hitMax = this.speechSamples >= maxNeed;
      if (hitSilence || hitMax) {
        const pcm = Float32Array.from(this.utterance);
        const durationMs = (pcm.length / sampleRate) * 1000;
        this.inSpeech = false;
        this.speechSamples = 0;
        this.silenceSamples = 0;
        this.startHoldSamples = 0;
        this.utterance = [];
        this.hold = [];
        const tail = Math.min(pcm.length, this.prerollMax);
        this.preroll = Array.from(pcm.subarray(pcm.length - tail));
        onEvent({ type: 'speech_end', pcm, durationMs });
      }
    }
  }

  /** Force-end current utterance (mic toggle stop). Returns pcm or null. */
  flush(): Float32Array | null {
    if (!this.inSpeech && this.utterance.length === 0 && this.hold.length === 0) {
      this.reset();
      return null;
    }
    const pcm = Float32Array.from(
      this.inSpeech ? this.utterance : this.preroll.concat(this.hold),
    );
    this.reset();
    return pcm.length > 0 ? pcm : null;
  }
}
