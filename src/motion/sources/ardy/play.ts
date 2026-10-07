import type { VRM } from '@pixiv/three-vrm';
import type { AnimationClip } from 'three';
import type { UniversalMotionHandle } from '@/motion/sources/clip';
import {
  ardyClipFromResult,
  measureArdyHipsHeight,
  type ArdyClipMotion,
} from './clip';
import {
  ArdyCancelled,
  ardyHistoryFrames,
  ardyStreamFrameCount,
  cancelActiveArdy,
  ensureArdyLoaded,
  generateArdy,
  isArdyCancelled,
  releaseArdyRuntime,
  type ArdyModelLimits,
  type ArdyProgress,
} from './client';
import { mergePiece, type ArdyMotionPiece } from './merge';
import { ARDY_REPLAN_REMAINING_FRAMES } from './model';
import type { RuntimeGenerationChunk, RuntimeGenerationResult } from './vendor/runtime/engine';

export type { ArdyProgress };
export { isArdyCancelled, releaseArdyRuntime };

export interface ArdyPlaybackHooks {
  play: (clip: AnimationClip) => Promise<UniversalMotionHandle>;
  extend: (clip: AnimationClip) => void;
  setHoldAtEnd: (hold: boolean) => void;
  setPlaybackTick: (tick: ((time: number, duration: number) => void) | null) => void;
  clipEpoch: () => number;
}

function asPiece(payload: RuntimeGenerationChunk | RuntimeGenerationResult): ArdyMotionPiece {
  return {
    startFrame: payload.startFrame,
    frameCount: payload.frameCount,
    fps: payload.fps,
    joints: payload.joints,
    localRotations: payload.localRotations,
    globalRotations: payload.globalRotations,
  };
}

class ArdyPlayback {
  private closed = false;
  private failed = false;
  private busy = false;
  private canAppend = false;
  private started = false;
  private gotChunk = false;
  private frameCount = 0;
  private fps = 20;
  private lastTime = 0;
  private epoch = -1;
  private motion: ArdyClipMotion | null = null;
  private limits: ArdyModelLimits | null = null;
  private tail: Promise<void> = Promise.resolve();
  private readonly hipsHeight: number;
  private readonly firstHandle: Promise<UniversalMotionHandle>;
  private readonly vrm: VRM;
  private readonly hooks: ArdyPlaybackHooks;
  private readonly prompt: string;
  private readonly onProgress: ArdyProgress | undefined;
  private resolveStart: (handle: UniversalMotionHandle) => void;
  private rejectStart: (error: unknown) => void;

  constructor(
    vrm: VRM,
    hooks: ArdyPlaybackHooks,
    prompt: string,
    onProgress?: ArdyProgress,
  ) {
    this.vrm = vrm;
    this.hooks = hooks;
    this.prompt = prompt;
    this.onProgress = onProgress;
    this.hipsHeight = measureArdyHipsHeight(vrm);
    let resolveStart: (handle: UniversalMotionHandle) => void = () => {};
    let rejectStart: (error: unknown) => void = () => {};
    this.firstHandle = new Promise((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });
    this.resolveStart = resolveStart;
    this.rejectStart = rejectStart;
  }

  start(): Promise<UniversalMotionHandle> {
    void this.generate('replace').catch((error: unknown) => this.fail(error));
    return this.firstHandle;
  }

  /** Stop asking for more windows. Does not fade the clip; the caller owns that. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.canAppend = false;
    if (current === this) current = null;
    this.hooks.setPlaybackTick(null);
    this.hooks.setHoldAtEnd(false);
    cancelActiveArdy();
    if (!this.started && !this.failed) {
      this.failed = true;
      this.rejectStart(new ArdyCancelled());
    }
  }

  private readonly onPlayback = (time: number): void => {
    this.lastTime = time;
    if (this.epoch >= 0 && this.hooks.clipEpoch() !== this.epoch) {
      this.close();
      return;
    }
    this.considerAppend();
  };

  private ownsMixer(): boolean {
    return this.epoch < 0 || this.hooks.clipEpoch() === this.epoch;
  }

  private considerAppend(): void {
    if (this.closed || this.failed || this.busy || !this.canAppend || this.frameCount < 1) return;
    if (!this.ownsMixer()) {
      this.close();
      return;
    }
    const frame = Math.min(
      this.frameCount - 1,
      Math.max(0, Math.floor(this.lastTime * this.fps + 1e-4)),
    );
    if (this.frameCount - frame - 1 > ARDY_REPLAN_REMAINING_FRAMES) return;
    void this.generate('append').catch((error: unknown) => this.fail(error));
  }

  private async generate(mode: 'replace' | 'append'): Promise<void> {
    if (this.closed || this.failed) return;
    this.busy = true;
    this.gotChunk = false;
    let continueAfter = false;
    try {
      const model = this.limits ?? await ensureArdyLoaded(this.onProgress);
      if (this.closed || this.failed) return;
      this.limits = model;
      this.fps = model.fps;
      const result = await generateArdy({
        prompt: this.prompt,
        mode,
        durationFrames: ardyStreamFrameCount(model),
        seed: mode === 'replace' ? Math.floor(Math.random() * 0x7fffffff) : 0,
        historyFrames: ardyHistoryFrames(model),
        onProgress: this.onProgress,
        onChunk: (chunk) => this.enqueue(asPiece(chunk)),
      });
      if (!this.gotChunk) this.enqueue(asPiece(result));
      await this.tail;
      if (this.closed || this.failed || !this.ownsMixer()) return;
      this.canAppend = true;
      continueAfter = true;
    } finally {
      this.busy = false;
    }
    if (continueAfter) this.considerAppend();
  }

  private enqueue(piece: ArdyMotionPiece): void {
    this.gotChunk = true;
    this.tail = this.tail.then(() => this.apply(piece)).catch((error: unknown) => {
      this.fail(error);
    });
  }

  private async apply(piece: ArdyMotionPiece): Promise<void> {
    if (this.closed || this.failed) return;
    if (!this.ownsMixer()) {
      this.close();
      return;
    }
    this.motion = mergePiece(this.motion, piece);
    this.frameCount = this.motion.frameCount;
    this.fps = this.motion.fps;
    const clip = ardyClipFromResult(this.vrm, this.motion, this.hipsHeight);
    if (!this.started) {
      const handle = await this.hooks.play(clip);
      if (this.closed || this.failed) {
        handle.stop();
        return;
      }
      this.started = true;
      this.epoch = this.hooks.clipEpoch();
      this.hooks.setPlaybackTick(this.onPlayback);
      this.resolveStart(this.wrap(handle));
    } else {
      this.hooks.extend(clip);
    }
    this.onProgress?.(`${this.frameCount} frames`);
  }

  private wrap(handle: UniversalMotionHandle): UniversalMotionHandle {
    return {
      name: handle.name,
      duration: handle.duration,
      pause: () => handle.pause(),
      resume: () => handle.resume(),
      isPlaying: () => handle.isPlaying(),
      stop: (fade) => {
        this.close();
        handle.stop(fade);
      },
    };
  }

  private fail(error: unknown): void {
    if (this.failed) return;
    if (this.closed || isArdyCancelled(error)) {
      if (!this.started) {
        this.failed = true;
        this.closed = true;
        if (current === this) current = null;
        this.rejectStart(error instanceof Error ? error : new ArdyCancelled());
      }
      return;
    }
    this.failed = true;
    this.canAppend = false;
    this.hooks.setPlaybackTick(null);
    this.hooks.setHoldAtEnd(false);
    cancelActiveArdy();
    const message = error instanceof Error ? error.message : String(error);
    this.onProgress?.(message);
    if (!this.started) {
      this.closed = true;
      if (current === this) current = null;
      this.rejectStart(error instanceof Error ? error : new Error(message));
    }
  }
}

let current: ArdyPlayback | null = null;

export function stopArdyPlayback(): void {
  current?.close();
}

export function playArdyMotion(
  vrm: VRM,
  hooks: ArdyPlaybackHooks,
  prompt: string,
  onProgress?: ArdyProgress,
): Promise<UniversalMotionHandle> {
  stopArdyPlayback();
  const playback = new ArdyPlayback(vrm, hooks, prompt, onProgress);
  current = playback;
  return playback.start();
}
