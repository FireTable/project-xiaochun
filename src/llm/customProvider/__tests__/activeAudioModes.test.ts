import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseActiveSttMode,
  parseActiveTtsMode,
  readActiveSttMode,
  writeActiveSttMode,
  readActiveTtsMode,
  writeActiveTtsMode,
  subscribeActiveSttMode,
  subscribeActiveTtsMode,
  STT_MODE_KEY,
  TTS_MODE_KEY,
} from '../../activeAudioModes';
import {
  KNOWN_LLM_TEMPLATES,
  KNOWN_STT_TEMPLATES,
  KNOWN_TTS_TEMPLATES,
} from '../types';

describe('activeAudioModes suite', () => {
  let mockStore: Record<string, string> = {};

  beforeEach(() => {
    mockStore = {};
    const mockLocalStorage = {
      getItem: (key: string) => mockStore[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStore[key] = value;
      },
      removeItem: (key: string) => {
        delete mockStore[key];
      },
      clear: () => {
        mockStore = {};
      },
    };

    (globalThis as any).window = {
      localStorage: mockLocalStorage,
    };
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  describe('parseActiveSttMode', () => {
    it('defaults to builtin when null or empty', () => {
      expect(parseActiveSttMode(null)).toEqual({ kind: 'builtin' });
      expect(parseActiveSttMode('')).toEqual({ kind: 'builtin' });
      expect(parseActiveSttMode('builtin')).toEqual({ kind: 'builtin' });
    });

    it('parses local mode correctly', () => {
      expect(parseActiveSttMode('local')).toEqual({ kind: 'local' });
    });

    it('parses custom provider mode correctly', () => {
      expect(parseActiveSttMode('custom:prov_123')).toEqual({
        kind: 'custom',
        providerId: 'prov_123',
      });
    });

    it('falls back to builtin on invalid custom string', () => {
      expect(parseActiveSttMode('custom:')).toEqual({ kind: 'builtin' });
      expect(parseActiveSttMode('random_nonsense')).toEqual({ kind: 'builtin' });
    });
  });

  describe('parseActiveTtsMode', () => {
    it('defaults to builtin when null or empty', () => {
      expect(parseActiveTtsMode(null)).toEqual({ kind: 'builtin' });
      expect(parseActiveTtsMode('builtin')).toEqual({ kind: 'builtin' });
    });

    it('parses custom provider mode correctly', () => {
      expect(parseActiveTtsMode('custom:tts_abc')).toEqual({
        kind: 'custom',
        providerId: 'tts_abc',
      });
    });

    it('falls back to builtin on invalid string', () => {
      expect(parseActiveTtsMode('custom:')).toEqual({ kind: 'builtin' });
      expect(parseActiveTtsMode('other')).toEqual({ kind: 'builtin' });
    });
  });

  describe('localStorage read/write and subscription', () => {
    it('reads and writes STT mode, triggering subscription callback', () => {
      const listener = vi.fn();
      const unsub = subscribeActiveSttMode(listener);

      expect(readActiveSttMode()).toEqual({ kind: 'builtin' });

      writeActiveSttMode({ kind: 'custom', providerId: 'prov_minimax' });
      expect(mockStore[STT_MODE_KEY]).toBe('custom:prov_minimax');
      expect(readActiveSttMode()).toEqual({ kind: 'custom', providerId: 'prov_minimax' });
      expect(listener).toHaveBeenCalledWith({ kind: 'custom', providerId: 'prov_minimax' });

      writeActiveSttMode({ kind: 'local' });
      expect(mockStore[STT_MODE_KEY]).toBe('local');
      expect(readActiveSttMode()).toEqual({ kind: 'local' });
      expect(listener).toHaveBeenCalledWith({ kind: 'local' });

      unsub();
      writeActiveSttMode({ kind: 'builtin' });
      expect(listener).toHaveBeenCalledTimes(2); // unsubscribed
    });

    it('reads and writes TTS mode, triggering subscription callback', () => {
      const listener = vi.fn();
      const unsub = subscribeActiveTtsMode(listener);

      expect(readActiveTtsMode()).toEqual({ kind: 'builtin' });

      writeActiveTtsMode({ kind: 'custom', providerId: 'tts_siliconflow' });
      expect(mockStore[TTS_MODE_KEY]).toBe('custom:tts_siliconflow');
      expect(readActiveTtsMode()).toEqual({ kind: 'custom', providerId: 'tts_siliconflow' });
      expect(listener).toHaveBeenCalledWith({ kind: 'custom', providerId: 'tts_siliconflow' });

      unsub();
    });
  });

  describe('template definitions', () => {
    it('contains valid LLM, STT, and TTS templates', () => {
      expect(KNOWN_LLM_TEMPLATES.length).toBeGreaterThanOrEqual(4);
      expect(KNOWN_STT_TEMPLATES.some((t) => t.id === 'stt-groq')).toBe(true);
      expect(KNOWN_STT_TEMPLATES.some((t) => t.id === 'stt-minimax')).toBe(true);
      expect(KNOWN_TTS_TEMPLATES.some((t) => t.id === 'tts-siliconflow')).toBe(true);
      expect(KNOWN_TTS_TEMPLATES.some((t) => t.defaultVoice !== undefined)).toBe(true);
    });
  });
});
