/**
 * emageSeed.ts: host-side `seed` for the SLIM emage_step (cls_* only).
 *
 * The full emage_step.onnx computed `seed` in-graph:
 *   argmax(cls_*) -> vq decode (face/upper/hands/lower) -> 6D -> axis-angle -> 55-joint assembly
 *   -> motion_inference[:, -4:, :]
 * The slim step (packages/emage-onnx) outputs only cls_upper / cls_hands / cls_lower, so the same seed
 * is rebuilt here from the FULL 64-frame window's argmax indices using the vq_*_idx + postprocess sessions
 * the worker already loads. The face branch is gone, so the jaw 6D is fixed to identity [1,0,0,0,1,0].
 *
 * IMPORTANT: postprocess with an all-zero face_dec yields a wrong jaw 6D ([0,0,1,1,0,0]); the jaw must be
 * written explicitly (see fillIdentityJaw).
 *
 * Pure TypeScript with no imports, so it can be exercised from plain Node (type stripping) by
 * packages/emage-onnx/js/verify_slim.mjs. ORT calls are injected through `SeedDeps`.
 */

export const FACE_DEC_DIM = 106;
export const UPPER_DEC_DIM = 78;
export const HANDS_DEC_DIM = 180;
export const LOWER_DEC_DIM = 61;
/** 6D rotation of the identity matrix (first 6 of the 106 face_dec dims is the jaw). */
export const JAW_IDENTITY_6D = [1, 0, 0, 0, 1, 0] as const;

export interface SeedDeps {
  /** Greedy index per frame; the worker's own argmax2d. */
  argmax2d(data: Float32Array, T: number, C: number): BigInt64Array;
  /** Run vq_<part>_idx on [1,T] int64 indices, return the decoded floats ([1,T,D] flattened, copied). */
  runVq(part: 'upper' | 'hands' | 'lower', indices: BigInt64Array, T: number): Promise<Float32Array>;
  /** Run postprocess; return motion_inference ([1,T,337] flattened, copied). */
  runPostprocess(
    faceDec: Float32Array,
    upperDec: Float32Array,
    handsDec: Float32Array,
    lowerDec: Float32Array,
    T: number,
  ): Promise<Float32Array>;
}

export function fillIdentityJaw(faceDec: Float32Array, T: number): Float32Array {
  for (let t = 0; t < T; t++) {
    const b = t * FACE_DEC_DIM;
    for (let i = 0; i < 6; i++) faceDec[b + i] = JAW_IDENTITY_6D[i]!;
  }
  return faceDec;
}

/**
 * @returns Float32Array [seedFrames * mdim] = last `seedFrames` frames of motion_inference of the window.
 */
export async function computeSeedFromLogits(
  deps: SeedDeps,
  clsUpper: Float32Array,
  clsHands: Float32Array,
  clsLower: Float32Array,
  T: number,
  codebookSize: number,
  mdim: number,
  seedFrames: number,
): Promise<Float32Array> {
  const upperDec = await deps.runVq('upper', deps.argmax2d(clsUpper, T, codebookSize), T);
  const handsDec = await deps.runVq('hands', deps.argmax2d(clsHands, T, codebookSize), T);
  const lowerDec = await deps.runVq('lower', deps.argmax2d(clsLower, T, codebookSize), T);
  const faceDec = fillIdentityJaw(new Float32Array(T * FACE_DEC_DIM), T);
  const mi = await deps.runPostprocess(faceDec, upperDec, handsDec, lowerDec, T);
  return mi.slice((T - seedFrames) * mdim, T * mdim);
}
