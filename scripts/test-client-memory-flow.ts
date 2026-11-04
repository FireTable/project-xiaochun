/**
 * Verification script for client-memory core workflow.
 * Run with: npx tsx scripts/test-client-memory-flow.ts
 */
import {
  createClientMemory,
  MemoryStorageAdapter,
} from '../packages/client-memory/src/index';

async function main() {
  console.log('====================================================');
  console.log('🧪 Starting client-memory Core Workflow Verification');
  console.log('====================================================\n');

  const memory = createClientMemory({
    storage: new MemoryStorageAdapter(),
    workingMemoryLimit: 2,
    decayHalfLifeDays: 7,
  });

  await memory.init();
  console.log('✅ ClientMemoryEngine initialized successfully.\n');

  // 1. Simulate multi-turn dialogue
  console.log('--- Step 1: Simulating Conversational Ingestion ---');
  
  const turns = [
    {
      user: '小蠢你好！我叫阿豪，是一名全栈游戏工程师。我超级喜欢喝冰美式咖啡，最讨厌吃香菜！',
      assistant: '阿豪你好呀！记住了，全栈工程师，喜欢冰美式，绝对不加香菜～',
    },
    {
      user: '我家在杭州，家里养了一只柯基叫旺财。',
      assistant: '哇，杭州是个好地方！旺财这个名字太可爱了，柯基的小短腿跑起来一定很萌吧！',
    },
    {
      user: '今天调了一整天的三维骨骼与着色器 Bug，眼睛好酸好累。',
      assistant: '辛苦啦阿豪！快站起来活动一下，喝杯水，揉揉眼睛休息一下吧。',
    },
    {
      user: '周末我打算去海滩散步看日落散心。',
      assistant: '海滩散步超级治愈的！吹吹海风，看落日晚霞，心情一定会变好的。',
    },
  ];

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    console.log(`[Turn ${i + 1}] User: "${t.user}"`);
    const res = await memory.remember(t);
    console.log(`  -> Extracted Facts Count: ${res.profile.facts.length}`);
    if (res.newEpisode) {
      console.log(`  🎉 [Consolidation Triggered] New Episode Created: "${res.newEpisode.title}"`);
      console.log(`     Summary: ${res.newEpisode.summary}`);
      console.log(`     Entities: [${res.newEpisode.entities.join(', ')}]`);
    }
  }

  // Check Profile
  const profile = await memory.profileManager.get();
  console.log('\n--- Step 2: Verifying Extracted User Profile ---');
  console.log('Name:', profile.name);
  console.log('Traits:', JSON.stringify(profile.traits, null, 2));
  console.log('Extracted Facts:');
  profile.facts.forEach((f, idx) => {
    console.log(`  ${idx + 1}. [${f.category}] ${f.key}: ${f.value} (conf: ${f.confidence})`);
  });

  // 2. Import SillyTavern Lorebook
  console.log('\n--- Step 3: Importing SillyTavern Lorebook ---');
  const sampleLorebook = JSON.stringify({
    entries: {
      '0': {
        key: ['海滩', '日落', '夕阳'],
        content: '小蠢生活在海风轻拂的 Beach 3D 世界，这里的日落时间大约是傍晚 18:30，落日会将天空染成金橙色。',
        order: 100,
        constant: false,
      },
      '1': {
        key: ['旺财', '狗狗'],
        content: '小蠢很喜欢小动物，听到狗狗的名字会露出开心的笑容。',
        order: 90,
        constant: false,
      },
    },
  });

  const imported = await memory.lorebookManager.importSillyTavernJson(sampleLorebook, 'beach_lore');
  console.log(`✅ Successfully imported ${imported.length} lorebook entries.`);

  // 3. Test Retrieval & Assembly
  console.log('\n--- Step 4: Testing Dynamic Recall & KV Cache Context Assembly ---');
  const testQueries = [
    '小蠢，下午适合喝咖啡吗？',
    '海滩边的夕阳大概什么时候落山呀？',
    '今天周几了？', // Completely irrelevant query
  ];

  for (const q of testQueries) {
    console.log(`\nQuery: "${q}"`);
    const recall = await memory.recall(q);
    console.log(`  Working turns count: ${recall.workingTurns.length}`);
    console.log(`  Episode hits count: ${recall.episodes.length}`);
    console.log(`  Lorebook hits count: ${recall.lorebookHits.length}`);
    console.log(`  Matched facts count: ${recall.matchedFacts?.length ?? 0}`);

    if (recall.matchedFacts && recall.matchedFacts.length > 0) {
      console.log(`  -> Fact Hit: [${recall.matchedFacts[0].key}] ${recall.matchedFacts[0].value}`);
    }

    if (recall.lorebookHits.length > 0) {
      console.log(`  -> Lorebook Hit: "${recall.lorebookHits[0].content}"`);
    }

    const assembled = memory.assemble({
      systemPrompt: '你是可爱的3D陪伴小蠢，说话自然甜美。',
      userQuery: q,
      historyTurns: recall.workingTurns,
      profile: recall.profile,
      episodes: recall.episodes,
      lorebookHits: recall.lorebookHits,
      matchedFacts: recall.matchedFacts,
      lang: 'zh-CN',
    });

    console.log('  [Assembled Output Preview]:');
    console.log(`    System Prompt (Frozen): "${assembled.systemPrompt.replace(/\n+/g, ' ')}"`);
    console.log(`    Recalled Summary: "${assembled.recalledSummary || '(none)'}"`);
    console.log(`    Current User Message: "${assembled.messages[assembled.messages.length - 1].content.replace(/\n+/g, ' ')}"`);
  }

  console.log('\n====================================================');
  console.log('🎉 Core Workflow Verification Completed Successfully!');
  console.log('====================================================');
}

main().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
