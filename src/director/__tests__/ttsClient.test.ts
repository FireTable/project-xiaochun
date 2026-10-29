import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requestTTSAudio } from '../ttsClient';
import * as storeModule from '../../llm/customProvider/store';

describe('ttsClient suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls /api/tts in builtin mode', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream(),
    } as any);

    const res = await requestTTSAudio(
      {
        text: '你好，我是小春',
        voice: 'zh-CN-XiaoyiNeural',
        pitch: '+10Hz',
        rate: '+0%',
        volume: '+0%',
      },
      { kind: 'builtin' },
    );

    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/tts',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '你好，我是小春',
          voice: 'zh-CN-XiaoyiNeural',
          pitch: '+10Hz',
          rate: '+0%',
          volume: '+0%',
        }),
      }),
    );
  });

  it('calls custom provider /audio/speech with OpenAI protocol in custom mode', async () => {
    vi.spyOn(storeModule, 'getProviderDecrypted').mockResolvedValueOnce({
      id: 'tts_prov_1',
      type: 'tts',
      name: 'Custom SiliconFlow CosyVoice',
      protocol: 'openai-compatible',
      baseURL: 'https://api.siliconflow.cn/v1',
      apiKey: 'sk-silicon-key',
      model: 'FunAudioLLM/CosyVoice-300M-25Hz',
      voice: 'alex',
      createdAt: Date.now(),
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream(),
    } as any);

    const res = await requestTTSAudio(
      {
        text: '今天天气真好',
        voice: 'zh-CN-XiaoyiNeural',
        pitch: '+10Hz',
        rate: '+0%',
        volume: '+0%',
      },
      { kind: 'custom', providerId: 'tts_prov_1' },
    );

    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.siliconflow.cn/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer sk-silicon-key',
        },
        body: JSON.stringify({
          model: 'FunAudioLLM/CosyVoice-300M-25Hz',
          input: '今天天气真好',
          voice: 'alex',
          response_format: 'mp3',
        }),
      }),
    );
  });

  it('throws descriptive error on HTTP failure for ChatDirector error handling', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
      body: null,
    } as any);

    await expect(
      requestTTSAudio(
        {
          text: '测试失败',
          voice: 'zh-CN-XiaoyiNeural',
          pitch: '+10Hz',
          rate: '+0%',
          volume: '+0%',
        },
        { kind: 'builtin' },
      ),
    ).rejects.toThrow('语音合成服务异常: HTTP 502');
  });
});
