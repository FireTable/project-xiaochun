import { APP_CONFIG } from '../../config';

/**
 * Live Layer-1 writer selection. Priority: clip > emage > vrma > idle.
 * Tick and outfit-swap both call this so a new motion cannot add a director flag.
 */
export type LiveMotionWriter = 'idle' | 'vrma' | 'emage' | 'clip';

export interface LiveMotionFlags {
  clip: boolean;
  emage: boolean;
  vrma: boolean;
}

export function selectLiveMotionSource(live: LiveMotionFlags): LiveMotionWriter {
  if (live.clip) return 'clip';
  if (live.emage) return 'emage';
  if (live.vrma) return 'vrma';
  return 'idle';
}

export const SOURCE_FADE_DURATION = APP_CONFIG?.motionPipeline?.sourceFadeDuration ?? 0.75;
export const FINGER_MICRO_FADE_DURATION = APP_CONFIG?.motionPipeline?.fingerFadeDuration ?? 0.34;

export const WRITER_FADE_DURATION: Record<LiveMotionWriter, number> = {
  clip: SOURCE_FADE_DURATION,
  emage: SOURCE_FADE_DURATION,
  vrma: SOURCE_FADE_DURATION,
  idle: SOURCE_FADE_DURATION,
};

/** Pipeline still names universal clips `motion` (outfit-swap / playMotion). */
export function writerToPipelineSource(
  writer: LiveMotionWriter,
): 'idle' | 'vrma' | 'emage' | 'motion' {
  return writer === 'clip' ? 'motion' : writer;
}
