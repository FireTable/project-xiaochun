import { CORE27_JOINT_COUNT } from './vendor/motion-data';

/**
 * One streamed window. `startFrame` is the session index of the first new
 * frame, matching the official demo's generationChunk.
 */
export interface ArdyMotionPiece {
  startFrame: number;
  frameCount: number;
  fps: number;
  joints: Float32Array;
  localRotations?: Float32Array;
  globalRotations?: Float32Array;
}

/** Accumulated session motion. Frames `[0, frameCount)` are world-space. */
export interface ArdyClipMotion {
  fps: number;
  frameCount: number;
  joints: Float32Array;
  localRotations?: Float32Array;
  globalRotations?: Float32Array;
}

const POSITION_STRIDE = CORE27_JOINT_COUNT * 3;
const ROTATION_STRIDE = CORE27_JOINT_COUNT * 9;

function takeFloat(
  data: Float32Array | undefined,
  count: number,
  label: string,
): Float32Array | undefined {
  if (!data) return undefined;
  if (data.length < count) {
    throw new Error(`ARDY ${label} is ${data.length} values, expected at least ${count}`);
  }
  return data.length === count ? data : data.slice(0, count);
}

/**
 * Keep `prefixFrames` of `previous`, then append `incoming`.
 * Same layout as the official demo's mergeFloatTrack: the incoming window
 * is written at the prefix, not at index 0.
 */
export function spliceTrack(
  previous: Float32Array,
  incoming: Float32Array,
  prefixFrames: number,
  stride: number,
): Float32Array {
  const prefix = prefixFrames * stride;
  const out = new Float32Array(prefix + incoming.length);
  if (prefix > 0) out.set(previous.subarray(0, prefix));
  out.set(incoming, prefix);
  return out;
}

/** Append one generation window. Official mergeMotion, Core27 strides. */
export function mergePiece(previous: ArdyClipMotion | null, piece: ArdyMotionPiece): ArdyClipMotion {
  const joints = takeFloat(piece.joints, piece.frameCount * POSITION_STRIDE, 'joints');
  if (!joints) throw new Error('ARDY chunk is missing joint positions');
  const local = takeFloat(piece.localRotations, piece.frameCount * ROTATION_STRIDE, 'local rotations');
  const globalRot = takeFloat(piece.globalRotations, piece.frameCount * ROTATION_STRIDE, 'global rotations');
  if (!previous) {
    if (piece.startFrame !== 0) throw new Error('ARDY stream must start at frame 0');
    return {
      fps: piece.fps,
      frameCount: piece.frameCount,
      joints,
      localRotations: local,
      globalRotations: globalRot,
    };
  }
  if (piece.fps !== previous.fps) throw new Error('ARDY chunks use different frame rates');
  if (piece.startFrame > previous.frameCount) {
    throw new Error(`ARDY chunk starts at ${piece.startFrame}, after ${previous.frameCount} frames`);
  }
  return {
    fps: piece.fps,
    frameCount: piece.startFrame + piece.frameCount,
    joints: spliceTrack(previous.joints, joints, piece.startFrame, POSITION_STRIDE),
    localRotations: previous.localRotations && local
      ? spliceTrack(previous.localRotations, local, piece.startFrame, ROTATION_STRIDE)
      : (local ?? previous.localRotations),
    globalRotations: previous.globalRotations && globalRot
      ? spliceTrack(previous.globalRotations, globalRot, piece.startFrame, ROTATION_STRIDE)
      : (globalRot ?? previous.globalRotations),
  };
}
