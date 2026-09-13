import type { VRM } from '@pixiv/three-vrm';
import type { PoseBuffer } from './poseBuffer';

/**
 * Per-source traits the pipeline/constraints read instead of engine flags
 * (`isThinking`, `emageLive`, …).
 */
export interface MotionTraits {
  /** When false, BodyTurn must not step (speech / planted stance). */
  allowLocomotion: boolean;
  /** Gaze adds thinking head sway (thinking VRMA). */
  thinkSway: boolean;
  /** Glance-away probability for Gaze. Omit → constraint default. */
  glanceChance?: number;
}

export const DEFAULT_MOTION_TRAITS: MotionTraits = {
  allowLocomotion: true,
  thinkSway: false,
};

export interface MotionSource {
  readonly id: string;
  traits: MotionTraits;
  bind(vrm: VRM): void;
  /** Evaluate this frame into `out`. Must not be the unique VRM bone writer. */
  sample(dt: number, time: number, out: PoseBuffer): void;
  isActive(): boolean;
  stop(): void;
}

export type ConstraintPhase = 'pre-commit' | 'post-commit';

export interface ConstraintContext {
  vrm: VRM;
  delta: number;
  time: number;
  pose: PoseBuffer;
  source: MotionSource;
  camera?: import('three').Camera;
  isSpeaking?: boolean;
  manualExpression?: string | null;
}

export interface MotionConstraint {
  readonly id: string;
  readonly phase: ConstraintPhase;
  bind(vrm: VRM): void;
  apply(ctx: ConstraintContext): void;
}

export interface PlayHandle {
  readonly sourceId: string;
  stop: (fadeDuration?: number) => void;
  pause?: () => void;
  resume?: () => void;
  isPlaying: () => boolean;
}
