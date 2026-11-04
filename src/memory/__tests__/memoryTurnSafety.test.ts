import { describe, expect, it } from 'vitest';
import {
  applyRecall,
  clearAssembledUserContent,
  getClientMemory,
  rememberTurn,
  type ExtendedRecall,
} from '../index';
import type { Lang } from '@/i18n';
import type { UserProfile } from '@firetable/client-memory';

const createMockProfile = (name = '小王'): UserProfile => ({
  id: 'user_master',
  name,
  relationshipStage: 'friend',
  intimacyScore: 10,
  traits: {},
  facts: [],
  updatedAt: Date.now(),
});

describe('memory > Concurrency & State Machine Turn Safety', () => {
  it('prevents aborted/interrupted turn from contaminating subsequent turns', async () => {
    clearAssembledUserContent();
    const memory = getClientMemory();

    const mockRecallA: ExtendedRecall = {
      entities: { facts: [], likes: [], dislikes: [] },
      recent: [],
      rawResult: {
        profile: createMockProfile('阿豪'),
        workingTurns: [],
        episodes: [],
        lorebookHits: [],
        matchedFacts: [
          {
            id: 'fact_1',
            category: 'preference',
            key: 'like',
            value: '冰美式',
            confidence: 5,
            ts: Date.now(),
          },
        ],
      },
    };

    // Turn 1 (Query A): assembled with hint
    const queryA = '我想喝咖啡';
    const recalledA = applyRecall('你是小蠢', mockRecallA, 'zh-CN' as Lang, queryA);
    expect(recalledA.currentUserContent).toContain('冰美式');
    expect(recalledA.currentUserContent).toContain(queryA);

    // Suppose Turn 1 gets ABORTED (e.g. user interruption, TTS failure, etc.)
    // rememberTurn is NEVER called for Query A.

    // Turn 2 (Query B): unrelated turn, called directly with rememberTurn without hint
    const queryB = '今天天气不错';
    const replyB = '是呀，阳光很好！';
    await rememberTurn(queryB, replyB);

    // Verify stored turn: Turn 2 must NOT have Turn 1's content or hint!
    const turns = await memory.recall('今天天气');
    const lastTurn = turns.workingTurns[turns.workingTurns.length - 1];
    expect(lastTurn.user).toBe(queryB);
    expect(lastTurn.user).not.toContain('冰美式');
    expect(lastTurn.assistant).toBe(replyB);
  });

  it('prevents concurrent interleaved turns from cross-pollinating', async () => {
    clearAssembledUserContent();
    const memory = getClientMemory();

    const mockRecallX: ExtendedRecall = {
      entities: { facts: [], likes: [], dislikes: [] },
      recent: [],
      rawResult: {
        profile: createMockProfile('小王'),
        workingTurns: [],
        episodes: [],
        lorebookHits: [],
        matchedFacts: [
          {
            id: 'f_x',
            category: 'preference',
            key: 'like',
            value: '苹果',
            confidence: 5,
            ts: Date.now(),
          },
        ],
      },
    };

    const mockRecallY: ExtendedRecall = {
      entities: { facts: [], likes: [], dislikes: [] },
      recent: [],
      rawResult: {
        profile: createMockProfile('小王'),
        workingTurns: [],
        episodes: [],
        lorebookHits: [],
        matchedFacts: [
          {
            id: 'f_y',
            category: 'preference',
            key: 'like',
            value: '香蕉',
            confidence: 5,
            ts: Date.now(),
          },
        ],
      },
    };

    const queryX = '吃水果吗';
    const queryY = '黄色水果';

    // Interleaving: X assembled, then Y assembled
    const resX = applyRecall('你是小蠢', mockRecallX, 'zh-CN' as Lang, queryX);
    const resY = applyRecall('你是小蠢', mockRecallY, 'zh-CN' as Lang, queryY);

    expect(resX.currentUserContent).toContain('苹果');
    expect(resY.currentUserContent).toContain('香蕉');

    // Turn X resolves and commits first
    await rememberTurn(queryX, '好的，给你苹果');

    // Turn Y resolves and commits second
    await rememberTurn(queryY, '好的，给你香蕉');

    const recent = await memory.recall('水果');
    const turnXRecord = recent.workingTurns.find((t) => t.assistant === '好的，给你苹果');
    const turnYRecord = recent.workingTurns.find((t) => t.assistant === '好的，给你香蕉');

    expect(turnXRecord).toBeDefined();
    expect(turnXRecord?.user).toContain('苹果');
    expect(turnXRecord?.user).not.toContain('香蕉');

    expect(turnYRecord).toBeDefined();
    expect(turnYRecord?.user).toContain('香蕉');
    expect(turnYRecord?.user).not.toContain('苹果');
  });
});
