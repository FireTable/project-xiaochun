import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunChatOptions } from '../chatTypes';

const runChatSpy = vi.fn(async (_opts: RunChatOptions) => '{"speech":"我看到图片里的内容啦～"}');

const getActiveProviderSpy = vi.fn(async () => ({ id: 'p1', name: 'Vision API', model: 'gpt-4o', baseURL: 'http://localhost' }));

vi.mock('../customProvider', () => ({
  customChatProvider: {
    isActive: vi.fn(async () => true),
    runChat: (opts: RunChatOptions) => runChatSpy(opts),
  },
  getActiveProvider: () => getActiveProviderSpy(),
}));

vi.mock('../userSettings', () => ({
  resolveEffectiveSettings: vi.fn(async () => ({ memoryTurns: 4 })),
}));

vi.mock('@/memory', () => ({
  recallForChat: vi.fn(async () => ({ history: [], facts: [], episodes: [], lore: [] })),
  applyRecall: vi.fn((system: string, _mem: unknown, _lang: string, userText: string) => ({
    system,
    history: [],
    currentUserContent: userText,
  })),
}));

import {
  dataTransferHasImage,
  dataTransferHasVrm,
  dispatchVisionDrop,
  isVisionDropActive,
  setVisionDropHandler,
  subscribeVisionDropActive,
} from '../visionDropBus';
import { clearEphemeralVisionContext, generateSpeechReply } from '../chatWorkflow';
import { applyRecall } from '@/memory';

describe('visionDropBus model-gated drag-and-drop', () => {
  afterEach(() => {
    setVisionDropHandler(null);
    runChatSpy.mockClear();
  });

  it('ignores image drops when no vision model handler is active, and dispatches when active', () => {
    const events: boolean[] = [];
    const unsub = subscribeVisionDropActive((active) => events.push(active));

    expect(isVisionDropActive()).toBe(false);
    const mockFile = { name: 'photo.png', type: 'image/png' } as File;
    expect(dispatchVisionDrop([mockFile])).toBe(false);

    const received: File[][] = [];
    setVisionDropHandler((files) => received.push(files));
    expect(isVisionDropActive()).toBe(true);
    expect(events).toEqual([true]);

    expect(dispatchVisionDrop([mockFile])).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual([mockFile]);

    setVisionDropHandler(null);
    expect(isVisionDropActive()).toBe(false);
    expect(events).toEqual([true, false]);
    expect(dispatchVisionDrop([mockFile])).toBe(false);

    unsub();
  });

  it('accurately distinguishes image DataTransfers from .vrm outfit DataTransfers', () => {
    const imgDt = {
      items: [{ kind: 'file', type: 'image/webp' }],
      files: [{ name: 'screen.webp', type: 'image/webp' }],
    } as unknown as DataTransfer;
    expect(dataTransferHasImage(imgDt)).toBe(true);
    expect(dataTransferHasVrm(imgDt)).toBe(false);

    const vrmDt = {
      items: [{ kind: 'file', type: 'application/octet-stream' }],
      files: [{ name: 'XiaoChun_Summer.vrm', type: 'application/octet-stream' }],
    } as unknown as DataTransfer;
    expect(dataTransferHasImage(vrmDt)).toBe(false);
    expect(dataTransferHasVrm(vrmDt)).toBe(true);
  });
});

describe('generateSpeechReply multimodal imageUrls payload', () => {
  afterEach(() => {
    runChatSpy.mockClear();
    clearEphemeralVisionContext();
    getActiveProviderSpy.mockResolvedValue({
      id: 'p1',
      name: 'Vision API',
      model: 'gpt-4o',
      baseURL: 'http://localhost',
    });
  });

  it('keeps user content as plain string when imageUrls is omitted or empty', async () => {
    const reply = await generateSpeechReply('你好呀', undefined, 'SYS', 'zh-CN', undefined, []);
    expect(reply).toBe('我看到图片里的内容啦～');
    expect(runChatSpy).toHaveBeenCalledTimes(1);
    const sentMessages = runChatSpy.mock.calls[0]![0].messages;
    expect(sentMessages.at(-1)).toEqual({
      role: 'user',
      content: '你好呀',
    });
  });

  it('formats user content as OpenAI/MLC multimodal ChatContentPart[] when imageUrls are provided', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await generateSpeechReply(
      '帮我看看这张图里有什么？',
      undefined,
      'SYS',
      'zh-CN',
      undefined,
      [dataUrl],
    );
    expect(runChatSpy).toHaveBeenCalledTimes(1);
    const sentMessages = runChatSpy.mock.calls[0]![0].messages;
    expect(sentMessages.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: '帮我看看这张图里有什么？' },
      ],
    });
  });

  it('re-hydrates the previous turn image in history on follow-up turns for KV-cache prefix continuity, and drops it if switched to text model', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await generateSpeechReply('这张图是什么？', undefined, 'SYS', 'zh-CN', undefined, [dataUrl]);

    vi.mocked(applyRecall).mockReturnValueOnce({
      system: 'SYS',
      history: [
        { role: 'user', content: '这张图是什么？' },
        { role: 'assistant', content: '我看到图片里的内容啦～' },
      ],
      currentUserContent: '那右上角是什么颜色？',
    });

    await generateSpeechReply('那右上角是什么颜色？', undefined, 'SYS', 'zh-CN');
    const turn2Messages = runChatSpy.mock.calls[1]![0].messages;
    expect(turn2Messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: '这张图是什么？' },
      ],
    });

    // Switching to a text-only model clears ephemeral vision context cleanly
    getActiveProviderSpy.mockResolvedValueOnce({
      id: 'p2',
      name: 'Text API',
      model: 'deepseek-chat',
      baseURL: 'http://localhost',
    });
    vi.mocked(applyRecall).mockReturnValueOnce({
      system: 'SYS',
      history: [
        { role: 'user', content: '这张图是什么？' },
        { role: 'assistant', content: '我看到图片里的内容啦～' },
      ],
      currentUserContent: '继续聊聊',
    });

    await generateSpeechReply('继续聊聊', undefined, 'SYS', 'zh-CN');
    const turn3Messages = runChatSpy.mock.calls[2]![0].messages;
    expect(turn3Messages[1]).toEqual({
      role: 'user',
      content: '这张图是什么？',
    });
  });
});
