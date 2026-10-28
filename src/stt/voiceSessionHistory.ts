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

/** Decodes a RIFF WAV Base64 Data URL back into mono Float32Array PCM. */
export function wavDataUrlToPcm(dataUrl: string): { pcm: Float32Array; sampleRate: number } {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const binary =
    typeof atob !== 'undefined'
      ? atob(base64)
      : typeof (globalThis as unknown as { Buffer?: { from: (s: string, e: string) => { toString: (e: string) => string } } }).Buffer !== 'undefined'
        ? (globalThis as unknown as { Buffer: { from: (s: string, e: string) => { toString: (e: string) => string } } }).Buffer.from(base64, 'base64').toString('binary')
        : '';
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleRate = view.getUint32(24, true);

  // Search for "data" chunk offset
  let dataOffset = 44;
  for (let i = 36; i < bytes.length - 8; i++) {
    if (
      bytes[i] === 0x64 && // 'd'
      bytes[i + 1] === 0x61 && // 'a'
      bytes[i + 2] === 0x74 && // 't'
      bytes[i + 3] === 0x61    // 'a'
    ) {
      dataOffset = i + 8;
      break;
    }
  }

  const numSamples = Math.floor((bytes.length - dataOffset) / 2);
  const pcm = new Float32Array(numSamples);
  let src = dataOffset;
  for (let i = 0; i < numSamples; i++) {
    const s16 = view.getInt16(src, true);
    pcm[i] = s16 < 0 ? s16 / 0x8000 : s16 / 0x7fff;
    src += 2;
  }
  return { pcm, sampleRate: sampleRate || 16000 };
}

/** Check if the browser supports standard Web Speech API SpeechRecognition (once). */
export const isSpeechRecognitionSupported =
  typeof window !== 'undefined' &&
  Boolean(
    (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
      .SpeechRecognition ||
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .webkitSpeechRecognition,
  );

/**
 * Feeds a recorded audio WAV Data URL to browser native SpeechRecognition.
 * Plays the audio so the microphone can capture and recognize it, returning the recognized text.
 */
export function testWithSpeechRecognition(
  audioDataUrl: string,
  options: {
    lang?: string;
    onStart?: () => void;
  } = {},
): Promise<{ text: string; durationMs: number }> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Window is not defined'));
      return;
    }
    const SR =
      (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any })
        .SpeechRecognition ||
      (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any })
        .webkitSpeechRecognition;

    if (!SR) {
      reject(new Error('SpeechRecognition is not supported in this browser'));
      return;
    }

    try {
      const recognition = new SR();
      recognition.lang = options.lang || 'zh-CN';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      const audio = new Audio(audioDataUrl);
      const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
      let recognizedText = '';
      let isSettled = false;

      const finish = (text: string, err?: Error) => {
        if (isSettled) return;
        isSettled = true;
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {}
        try {
          recognition.abort();
        } catch {}
        if (err) {
          reject(err);
        } else {
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const durationMs = Math.round(now - startTime);
          resolve({ text, durationMs });
        }
      };

      recognition.onstart = () => {
        options.onStart?.();
        // Play the recorded speech so microphone captures the sound
        audio.play().catch((e) => {
          console.warn('[SpeechRecognition] Audio play warning:', e);
        });
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript || '';
        recognizedText = transcript;
      };

      recognition.onerror = (event: any) => {
        const errType = String(event.error || '');
        if (errType === 'no-speech') {
          // Soft: finish with empty recognized text rather than fatal reject
          finish(recognizedText || '');
        } else {
          finish(recognizedText, new Error(`SpeechRecognition error: ${errType}`));
        }
      };

      recognition.onend = () => {
        finish(recognizedText);
      };

      audio.onended = () => {
        setTimeout(() => {
          try {
            recognition.stop();
          } catch {}
        }, 300);
      };

      recognition.start();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
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
