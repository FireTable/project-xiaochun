/**
 * voiceSessionHistory.ts — temporary session recording & analysis storage for DevDrawer.
 *
 * Requirements:
 * 1. Only active when DevDrawer is open (zero overhead when closed).
 * 2. Encodes 16kHz PCM to standard 16-bit mono WAV Data URL.
 * 3. Persists up to 10 latest speech utterances in sessionStorage.
 * 4. Enables audio playback and speech-to-text accuracy review.
 */
import { DEV_DRAWER_OPEN_KEY } from '@/lib/constants';

export const VOICE_HISTORY_SESSION_KEY = 'xiaochun_dev_voice_history';
export const MAX_VOICE_HISTORY = 10;
export const VOICE_HISTORY_UPDATE_EVENT = 'xc-voice-history-updated';

export interface VoiceAnalysisRecord {
  id: string;
  timestamp: number;
  text: string;
  durationMs: number;
  inferenceMs: number;
  rms: number;
  sampleRate: number;
  audioDataUrl: string; // data:audio/wav;base64,...
}

export interface RecordVoiceInput {
  text: string;
  pcm: Float32Array;
  sampleRate: number;
  durationMs: number;
  inferenceMs: number;
  rms: number;
}

/** Check if DevDrawer is currently open (active). */
export function isDevDrawerActive(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(DEV_DRAWER_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Converts mono Float32Array PCM to 16-bit PCM RIFF WAV Data URL. */
export function pcmToWavDataUrl(pcm: Float32Array, sampleRate: number): string {
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // "RIFF" chunk descriptor
  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + dataSize, true);
  // "WAVE" format
  view.setUint32(8, 0x57415645, false);

  // "fmt " sub-chunk
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true); // subchunk1 size (16 for PCM)
  view.setUint16(20, 1, true); // audio format (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample

  // "data" sub-chunk
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, dataSize, true);

  // Write 16-bit signed PCM samples
  let offset = 44;
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]!));
    const int16 = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  // Convert buffer to binary string -> base64
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }

  return `data:audio/wav;base64,${btoa(binary)}`;
}

/** Retrieve current list of voice analysis records from sessionStorage. */
export function getVoiceHistory(): VoiceAnalysisRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(VOICE_HISTORY_SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[VoiceHistory] Failed to parse sessionStorage history:', e);
    return [];
  }
}

/**
 * Save a new voice utterance record to sessionStorage.
 * Strictly enforced rule: Only executes if DevDrawer is active (or forceSave is passed).
 */
export function saveVoiceRecord(
  input: RecordVoiceInput,
  options: { forceSave?: boolean } = {},
): VoiceAnalysisRecord | null {
  if (typeof window === 'undefined') return null;

  // Gate check: Only write when DevDrawer is active
  if (!options.forceSave && !isDevDrawerActive()) {
    return null;
  }

  try {
    const audioDataUrl = pcmToWavDataUrl(input.pcm, input.sampleRate);
    const newRecord: VoiceAnalysisRecord = {
      id: `vrec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      text: input.text,
      durationMs: input.durationMs,
      inferenceMs: input.inferenceMs,
      rms: input.rms,
      sampleRate: input.sampleRate,
      audioDataUrl,
    };

    let list = getVoiceHistory();
    list.unshift(newRecord);
    if (list.length > MAX_VOICE_HISTORY) {
      list = list.slice(0, MAX_VOICE_HISTORY);
    }

    // Save with quota-overflow protection: discard oldest until write succeeds
    let saved = false;
    while (!saved && list.length > 0) {
      try {
        sessionStorage.setItem(VOICE_HISTORY_SESSION_KEY, JSON.stringify(list));
        saved = true;
      } catch {
        if (list.length > 1) {
          list.pop();
        } else {
          break;
        }
      }
    }

    window.dispatchEvent(new CustomEvent(VOICE_HISTORY_UPDATE_EVENT, { detail: newRecord }));
    return newRecord;
  } catch (err) {
    console.error('[VoiceHistory] Failed to save voice record:', err);
    return null;
  }
}

/** Clear all voice analysis records from sessionStorage. */
export function clearVoiceHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(VOICE_HISTORY_SESSION_KEY);
    window.dispatchEvent(new CustomEvent(VOICE_HISTORY_UPDATE_EVENT));
  } catch (e) {
    console.warn('[VoiceHistory] Failed to clear sessionStorage history:', e);
  }
}
