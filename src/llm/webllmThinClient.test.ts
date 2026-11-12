import { describe, expect, it } from 'vitest';
import webllmPkg from '../../node_modules/@mlc-ai/web-llm/package.json?raw';
import webllmLib from '../../node_modules/@mlc-ai/web-llm/lib/index.js?raw';
import providerSrc from './webLLMProvider.ts?raw';
import clientSrc from './webllmThinClient.ts?raw';
import { ThinMLCEngine, WEBLLM_PROTOCOL_VERSION } from './webllmThinClient';

describe('webllmThinClient protocol pin', () => {
  it('matches the installed @mlc-ai/web-llm version (re-check webllmThinClient.ts after an upgrade)', () => {
    expect((JSON.parse(webllmPkg) as { version: string }).version).toBe(WEBLLM_PROTOCOL_VERSION);
  });

  it('the installed WebWorkerMLCEngine still uses every message kind the thin client sends', () => {
    const start = webllmLib.indexOf('class WebWorkerMLCEngine {');
    expect(start).toBeGreaterThan(0);
    const client = webllmLib.slice(start, webllmLib.indexOf('\n}\n', start));
    for (const kind of [
      'setAppConfig',
      'reload',
      'unload',
      'resetChat',
      'interruptGenerate',
      'getMessage',
      'runtimeStatsText',
      'chatCompletionStreamInit',
      'completionStreamNextChunk',
      'completionStreamReturn',
      'chatCompletionNonStreaming',
      'initProgressCallback',
    ]) {
      expect(client, kind).toContain(`"${kind}"`);
    }
    expect(client).toContain('msg.kind == "return"');
    expect(client).toContain('"throw"');
  });

  it('the main thread has no static runtime import of @mlc-ai/web-llm (import type only)', () => {
    for (const [name, src] of [
      ['webllmThinClient.ts', clientSrc],
      ['webLLMProvider.ts', providerSrc],
    ] as const) {
      const stmts = src.match(/^import[^;]*from '@mlc-ai\/web-llm';/gms) ?? [];
      expect(stmts.filter((s: string) => !s.startsWith('import type')), name).toEqual([]);
    }
  });

  it('tracks streamId across streaming chunks and sends completionStreamReturn on early break', async () => {
    const sent: Array<{ kind: string; uuid: string; content: any }> = [];
    const fakeWorker = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      onerror: null as ((e: ErrorEvent) => void) | null,
      postMessage(msg: { kind: string; uuid: string; content: any }) {
        sent.push(msg);
        queueMicrotask(() => {
          if (msg.kind === 'reload' || msg.kind === 'chatCompletionStreamInit' || msg.kind === 'completionStreamReturn') {
            fakeWorker.onmessage?.({ data: { kind: 'return', uuid: msg.uuid, content: null } } as MessageEvent);
          } else if (msg.kind === 'completionStreamNextChunk') {
            fakeWorker.onmessage?.({
              data: {
                kind: 'return',
                uuid: msg.uuid,
                content: { id: 'c1', choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }] },
              },
            } as MessageEvent);
          }
        });
      },
    } as unknown as Worker;

    const client = new ThinMLCEngine(fakeWorker);
    client.setFramePacing({ enabled: true, maxDispatchesPerEncoder: 24 });
    expect(sent[0]).toMatchObject({
      kind: 'xcSetFramePacing',
      content: { enabled: true, maxDispatchesPerEncoder: 24 },
    });

    await client.reload('MiniCPM-V-4.7-1B-q4f16_1-MLC');
    const stream = await client.chatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });

    const initMsg = sent.find((m) => m.kind === 'chatCompletionStreamInit');
    expect(initMsg?.content.streamId).toBeTypeOf('string');

    for await (const chunk of stream) {
      expect(chunk.choices[0]?.delta.content).toBe('hello');
      break; // early exit must trigger completionStreamReturn with the exact same streamId
    }

    const nextMsg = sent.find((m) => m.kind === 'completionStreamNextChunk');
    const returnMsg = sent.find((m) => m.kind === 'completionStreamReturn');
    expect(nextMsg?.content).toEqual({ streamId: initMsg?.content.streamId });
    expect(returnMsg?.content).toEqual({ streamId: initMsg?.content.streamId });
  });
});
