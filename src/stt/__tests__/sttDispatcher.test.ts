import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  transcribeRemote,
  isRemoteSttAvailable,
  tripCircuit,
  resetCircuit,
} from '../sttDispatcher';
import * as storeModule from '../../llm/customProvider/store';

describe('sttDispatcher suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('isRemoteSttAvailable & circuit breaker', () => {
    it('returns false for local mode', () => {
      expect(isRemoteSttAvailable({ kind: 'local' })).toBe(false);
    });

    it('returns true for builtin when circuit is closed', () => {
      resetCircuit({ kind: 'builtin' });
      expect(isRemoteSttAvailable({ kind: 'builtin' })).toBe(true);
    });

    it('trips circuit on failure and marks remote unavailable for cooldown window', () => {
      tripCircuit({ kind: 'builtin' }, '429 Quota Exceeded');
      expect(isRemoteSttAvailable({ kind: 'builtin' })).toBe(false);

      resetCircuit({ kind: 'builtin' });
      expect(isRemoteSttAvailable({ kind: 'builtin' })).toBe(true);
    });
  });

  describe('transcribeRemote', () => {
    it('throws error in local mode without making fetch requests', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const pcm = new Float32Array(160);

      await expect(
        transcribeRemote(pcm, 16000, { kind: 'local' }),
      ).rejects.toThrow('Local only mode active');

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('successfully calls /api/stt in builtin mode', async () => {
      resetCircuit({ kind: 'builtin' });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: '你好小春' }),
      } as any);

      const pcm = new Float32Array(160);
      const res = await transcribeRemote(pcm, 16000, { kind: 'builtin' });

      expect(res.text).toBe('你好小春');
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/stt',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'audio/wav' },
        }),
      );
    });

    it('trips circuit on 429 and throws error', async () => {
      resetCircuit({ kind: 'builtin' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      } as any);

      const pcm = new Float32Array(160);
      await expect(
        transcribeRemote(pcm, 16000, { kind: 'builtin' }),
      ).rejects.toThrow('Cloudflare STT failed: HTTP 429');

      expect(isRemoteSttAvailable({ kind: 'builtin' })).toBe(false);
    });

    it('calls custom provider /audio/transcriptions with multipart formData', async () => {
      const customMode = { kind: 'custom' as const, providerId: 'prov_test' };
      resetCircuit(customMode);

      vi.spyOn(storeModule, 'getProviderDecrypted').mockResolvedValueOnce({
        id: 'prov_test',
        type: 'stt',
        name: 'MiniMax Test',
        protocol: 'openai-compatible',
        baseURL: 'https://api.minimax.chat/v1',
        apiKey: 'sk-secret-key',
        model: 'asr-1.0',
        createdAt: Date.now(),
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: '测试自定义识别成功' }),
      } as any);

      const pcm = new Float32Array(160);
      const res = await transcribeRemote(pcm, 16000, customMode);

      expect(res.text).toBe('测试自定义识别成功');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.minimax.chat/v1/audio/transcriptions',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer sk-secret-key' },
        }),
      );
    });
  });
});
