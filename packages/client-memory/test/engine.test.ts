import { describe, expect, it } from 'vitest';
import { createClientMemory } from '../src/engine';
import { MemoryStorageAdapter } from '../src/storage/MemoryStorageAdapter';

describe('client-memory > ClientMemoryEngine Full Lifecycle', () => {
  it('manages conversation turns, fact extraction, and recall', async () => {
    const memory = createClientMemory({
      storage: new MemoryStorageAdapter(),
      workingMemoryLimit: 2,
    });

    await memory.init();

    // Turn 1
    const res1 = await memory.remember({
      user: '你好小蠢，我叫阿豪，我喜欢喝冰美式',
      assistant: '你好呀阿豪！记住了，你喜欢喝冰美式～',
    });
    expect(res1.profile.name).toBe('阿豪');
    expect(res1.profile.facts.some((f) => f.value.includes('冰美式'))).toBe(true);

    // Turn 2
    await memory.remember({
      user: '今天写了一整天着色器代码，好累呀',
      assistant: '辛苦啦！要注意休息，别太拼命哦。',
    });

    // Recall
    const recall = await memory.recall('下午想喝点好喝的，你猜猜我想喝什么？');
    expect(recall.profile.name).toBe('阿豪');
    expect(recall.workingTurns.length).toBe(2);

    // Assemble
    const assembled = memory.assemble({
      systemPrompt: '你是可爱的3D陪伴小蠢。',
      userQuery: '下午想喝点好喝的，你猜猜我想喝什么？',
      historyTurns: recall.workingTurns,
      profile: recall.profile,
    });

    expect(assembled.messages[0].role).toBe('system');
    expect(assembled.messages[0].content).toContain('阿豪');
    // Ensure raw user text in history has no prompt debris
    expect(assembled.messages[1].content).toBe('你好小蠢，我叫阿豪，我喜欢喝冰美式');
  });

  it('consolidates unsummarized turns into episodes when threshold is reached', async () => {
    const memory = createClientMemory({
      storage: new MemoryStorageAdapter(),
      workingMemoryLimit: 2, // threshold = max(4, 2*2) = 4
    });

    await memory.init();

    for (let i = 1; i <= 4; i++) {
      await memory.remember({
        user: `第 ${i} 轮关于游戏着色器优化的讨论`,
        assistant: `小蠢收到了第 ${i} 轮消息`,
      });
    }

    const episodes = await memory.episodeManager.getAll();
    expect(episodes.length).toBe(1);
    expect(episodes[0].summary).toContain('互动');
  });

  it('matches SillyTavern lorebook entries within budget', async () => {
    const memory = createClientMemory({
      storage: new MemoryStorageAdapter(),
    });

    await memory.init();

    const stLorebook = JSON.stringify({
      entries: {
        '0': {
          key: ['海滩', '日落'],
          content: '小蠢生活在一个拥有24小时动态光照的海滩世界，日落时间约为傍晚18点30分。',
          order: 100,
        },
      },
    });

    await memory.lorebookManager.importSillyTavernJson(stLorebook, 'beach');
    const recall = await memory.recall('海滩上的夕阳好漂亮啊');

    expect(recall.lorebookHits.length).toBe(1);
    expect(recall.lorebookHits[0].content).toContain('海滩世界');
  });
});
