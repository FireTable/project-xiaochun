import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  pcmToWavDataUrl,
  wavDataUrlToPcm,
  isDevDrawerActive,
  getVoiceHistory,
  saveVoiceRecord,
  clearVoiceHistory,
  VOICE_HISTORY_SESSION_KEY,
} from '../voiceSessionHistory';
import { DEV_DRAWER_OPEN_KEY } from '@/lib/constants';

function createMockStorage() {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key]! : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
}

describe('voiceSessionHistory', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalWindow = (globalThis as any).window;

  beforeAll(() => {
    const mockLocal = createMockStorage();
    const mockSession = createMockStorage();
    (globalThis as any).localStorage = mockLocal;
    (globalThis as any).sessionStorage = mockSession;
    (globalThis as any).window = {
      dispatchEvent: () => true,
    };
  });

  afterAll(() => {
    (globalThis as any).localStorage = originalLocalStorage;
    (globalThis as any).sessionStorage = originalSessionStorage;
    (globalThis as any).window = originalWindow;
  });

  beforeEach(() => {
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
  });

  describe('pcmToWavDataUrl', () => {
    it('generates a valid data:audio/wav;base64 URL with correct RIFF header', () => {
      const pcm = new Float32Array(1600); // 100ms at 16kHz
      for (let i = 0; i < pcm.length; i++) {
        pcm[i] = Math.sin((i / 16000) * 2 * Math.PI * 440); // 440Hz sine wave
      }
      const dataUrl = pcmToWavDataUrl(pcm, 16000);
      expect(dataUrl.startsWith('data:audio/wav;base64,')).toBe(true);

      const base64 = dataUrl.replace('data:audio/wav;base64,', '');
      const binary = atob(base64);
      expect(binary.length).toBe(44 + 1600 * 2); // 44-byte WAV header + 16-bit samples
      // RIFF header
      expect(binary.slice(0, 4)).toBe('RIFF');
      expect(binary.slice(8, 12)).toBe('WAVE');
      expect(binary.slice(12, 16)).toBe('fmt ');
      expect(binary.slice(36, 40)).toBe('data');
    });

    it('accurately decodes WAV Data URL back to Float32Array PCM', () => {
      const origPcm = new Float32Array([0.1, -0.5, 0.75, -0.2, 0.0]);
      const dataUrl = pcmToWavDataUrl(origPcm, 16000);
      const { pcm, sampleRate } = wavDataUrlToPcm(dataUrl);

      expect(sampleRate).toBe(16000);
      expect(pcm.length).toBe(origPcm.length);
      for (let i = 0; i < origPcm.length; i++) {
        expect(pcm[i]).toBeCloseTo(origPcm[i]!, 3);
      }
    });
  });

  describe('DevDrawer Gating', () => {
    it('isDevDrawerActive reflects localStorage value', () => {
      expect(isDevDrawerActive()).toBe(false);

      localStorage.setItem(DEV_DRAWER_OPEN_KEY, '1');
      expect(isDevDrawerActive()).toBe(true);

      localStorage.setItem(DEV_DRAWER_OPEN_KEY, '0');
      expect(isDevDrawerActive()).toBe(false);
    });

    it('strictly does not save when DevDrawer is closed', () => {
      localStorage.setItem(DEV_DRAWER_OPEN_KEY, '0');
      const pcm = new Float32Array(1600);

      const saved = saveVoiceRecord({
        text: '测试未打开抽屉时不写入',
        pcm,
        sampleRate: 16000,
        durationMs: 100,
        inferenceMs: 25,
        rms: 0.15,
      });

      expect(saved).toBeNull();
      expect(getVoiceHistory().length).toBe(0);
      expect(sessionStorage.getItem(VOICE_HISTORY_SESSION_KEY)).toBeNull();
    });

    it('saves voice record when DevDrawer is open', () => {
      localStorage.setItem(DEV_DRAWER_OPEN_KEY, '1');
      const pcm = new Float32Array(1600);

      const saved = saveVoiceRecord({
        text: '你好小春，这是第一条测试',
        pcm,
        sampleRate: 16000,
        durationMs: 100,
        inferenceMs: 42,
        rms: 0.18,
      });

      expect(saved).not.toBeNull();
      expect(saved?.text).toBe('你好小春，这是第一条测试');
      expect(saved?.durationMs).toBe(100);
      expect(saved?.inferenceMs).toBe(42);

      const history = getVoiceHistory();
      expect(history.length).toBe(1);
      expect(history[0]?.text).toBe('你好小春，这是第一条测试');
    });
  });

  describe('Capacity and FIFO eviction', () => {
    it('caps history at 10 items and keeps the newest on top', () => {
      localStorage.setItem(DEV_DRAWER_OPEN_KEY, '1');
      const pcm = new Float32Array(160);

      for (let i = 1; i <= 15; i++) {
        saveVoiceRecord({
          text: `Record #${i}`,
          pcm,
          sampleRate: 16000,
          durationMs: 10,
          inferenceMs: 10,
          rms: 0.1,
        });
      }

      const history = getVoiceHistory();
      expect(history.length).toBe(10);
      expect(history[0]?.text).toBe('Record #15'); // Newest
      expect(history[9]?.text).toBe('Record #6');  // Oldest kept
    });

    it('clearVoiceHistory removes all items', () => {
      localStorage.setItem(DEV_DRAWER_OPEN_KEY, '1');
      saveVoiceRecord({
        text: 'Record to clear',
        pcm: new Float32Array(160),
        sampleRate: 16000,
        durationMs: 10,
        inferenceMs: 10,
        rms: 0.1,
      });

      expect(getVoiceHistory().length).toBe(1);
      clearVoiceHistory();
      expect(getVoiceHistory().length).toBe(0);
      expect(sessionStorage.getItem(VOICE_HISTORY_SESSION_KEY)).toBeNull();
    });
  });
});
