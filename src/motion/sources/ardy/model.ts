/** Family root. The manifest inside the download records the immutable revision. */
export const ARDY_MODEL_FAMILY_URL =
  'https://huggingface.co/intsuc/Llama-3-ARDY-Mini-Core40-Browser/resolve/main/';

export const ARDY_PROMPT_MAX_CHARS = 280;

/**
 * One streamed generate covers two denoiser windows. The second window is
 * already denoising while the first one plays. Matches the browser demo's
 * default 80-frame buffer when a window is 40 frames.
 */
export const ARDY_STREAM_WINDOWS = 2;

/** Ask for the next append when this many frames of playback remain. */
export const ARDY_REPLAN_REMAINING_FRAMES = 10;

/** History the next window conditions on. The demo never asks for more than 40. */
export const ARDY_HISTORY_FRAMES = 40;
