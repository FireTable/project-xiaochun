import { describe, expect, it } from 'vitest';
import webllmPkg from '../../node_modules/@mlc-ai/web-llm/package.json?raw';
import webllmLib from '../../node_modules/@mlc-ai/web-llm/lib/index.js?raw';
import providerSrc from './webLLMProvider.ts?raw';
import clientSrc from './webllmThinClient.ts?raw';
import { WEBLLM_PROTOCOL_VERSION } from './webllmThinClient';

describe('webllmThinClient protocol pin', () => {
  it('matches the installed @mlc-ai/web-llm version (re-check webllmThinClient.ts after an upgrade)', () => {
    expect((JSON.parse(webllmPkg) as { version: string }).version).toBe(WEBLLM_PROTOCOL_VERSION);
  });

  it('the installed WebWorkerMLCEngine still uses every message kind the thin client sends', () => {
    const start = webllmLib.indexOf('class WebWorkerMLCEngine {');
    expect(start).toBeGreaterThan(0);
    const client = webllmLib.slice(start, webllmLib.indexOf('\n}\n', start));
    for (const kind of ['setAppConfig', 'reload', 'unload', 'resetChat', 'interruptGenerate', 'getMessage', 'runtimeStatsText',
      'chatCompletionStreamInit', 'completionStreamNextChunk', 'chatCompletionNonStreaming', 'initProgressCallback']) {
      expect(client, kind).toContain(`"${kind}"`);
    }
    expect(client).toContain('msg.kind == "return"');
    expect(client).toContain('"throw"');
  });

  it('the main thread has no static runtime import of @mlc-ai/web-llm (import type only)', () => {
    for (const [name, src] of [['webllmThinClient.ts', clientSrc], ['webLLMProvider.ts', providerSrc]] as const) {
      const stmts = src.match(/^import[^;]*from '@mlc-ai\/web-llm';/gms) ?? [];
      expect(stmts.filter((s: string) => !s.startsWith('import type')), name).toEqual([]);
    }
  });
});
