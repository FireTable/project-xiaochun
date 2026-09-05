/**
 * chatWorkflow.ts — 对话生成的总入口(dispatcher + 跨 provider 收尾)。
 *
 * ponytail: 唯一调度方 — 根据 active key 选 provider,构造 messages,
 * 调 provider.runChat({ messages, thinking, maxTokens }),收尾做空重试 +
 * 输出清洗 + 兜底台词。provider 不知道 retry / clean 这些横切关注点。
 *
 * webLLM 路径见 ./webLLMProvider,自定义 HTTP 见 ./customProvider。
 */

import { langFromSystemPrompt, XIAOCHUN_SYSTEM_PROMPT, wrapUserContent } from '@/llm/prompts';
import { applyRecall, recallForChat } from '@/memory';
import type { Lang } from '@/i18n';
import { customChatProvider } from './customProvider';
import { webllmChatProvider, ModelSwitchedError, isThinkingEnabled, preloadWebLLM } from './webLLMProvider';
import { resolveEffectiveSettings } from './userSettings';
import type { ChatProvider, LlmMilestoneKey, MilestoneFn, ChatMessage, RunChatOptions, RunChatFn } from './chatTypes';

export type { LlmMilestoneKey };

/**
 * ponytail: provider 工厂 — 轮询所有 ChatProvider,第一个 isActive 命中即返回。
 * webllm 放最后作为默认兜底,没 custom 激活时挑它。新 provider 在这里加一项即可。
 */
const CHAT_PROVIDERS: ChatProvider[] = [customChatProvider, webllmChatProvider];

export async function getActiveChatRunner(): Promise<RunChatFn> {
  for (const p of CHAT_PROVIDERS) {
    if (await p.isActive()) return p.runChat;
  }
  return webllmChatProvider.runChat;
}

/**
 * ponytail: 通用回复清洗 — 剥离 <think> / markdown / 小说前缀等。
 * webLLM 与 自定义 HTTP provider 输出都过这一道,语义一致。
 */
function extractCleanSpeech(text: string): string {
  let raw = text || '';
  if (raw.includes('</think>')) {
    raw = raw.split('</think>').pop() || '';
  }
  raw = raw.replace(/<think>[\s\S]*$/gi, '');
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.speech === 'string') return parsed.speech.trim();
  } catch { }
  raw = raw.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
  raw = raw.replace(/\*[^*]*\*/g, '');
  raw = raw.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  return raw;
}

function getFriendlyFallbackSpeech(lang: Lang): string {
  switch (lang) {
    case 'ja':
      return '{"speech":"ちょっとスマホのメモリがいっぱいでぼーっとしちゃった…もう一度言ってくれる？"}';
    case 'en':
      return '{"speech":"Whew, graphics memory was tight and I spaced out for a second... could you say that again?"}';
    case 'zh-CN':
    default:
      return '{"speech":"唔……刚才显存稍微有点吃紧，小蠢晃了下神～你刚才说什么来着？"}';
  }
}

/**
 * 对话生成接口 — 纯前端本地推理对话
 * @param systemPrompt 可选覆盖,缺省用 XIAOCHUN_SYSTEM_PROMPT['zh-CN']。
 *   ponytail: 由 chatDirector 在调用时根据当前 i18n 语言注入,实现"用户用什么语言问,就用什么语言答"。
 * @param lang 可选覆盖,缺省从 systemPrompt 反推。用户在 AdvancedSettings 改了 system prompt
 *   后,反推 trick 会失效 — 这里必须由 chatDirector 用 bindSystemContext 注入真实 lang。
 */
export async function generateSpeechReply(
  userText: string,
  onMilestone?: MilestoneFn,
  systemPrompt: string = XIAOCHUN_SYSTEM_PROMPT['zh-CN'],
  lang?: Lang,
): Promise<string> {
  const effectiveLang: Lang = lang ?? langFromSystemPrompt(systemPrompt);
  // ponytail: 用户可能改了记忆轮数 — 走 effective 解析(override 优先,否则设备默认)。
  const { memoryTurns } = await resolveEffectiveSettings(effectiveLang);
  const mem = await recallForChat(userText, memoryTurns);
  const recalled = applyRecall(systemPrompt, mem, effectiveLang);

  // ponytail: messages 一次组装,两条路径共用 — 当前 user 文本走 wrapUserContent,
  // 把 lang 编码到 prompt 里(让模型知道回答用哪种语言)。
  const messages: ChatMessage[] = [
    { role: 'system', content: recalled.system },
    ...recalled.history,
    { role: 'user', content: wrapUserContent(userText, effectiveLang) },
  ];

  const wantThink = isThinkingEnabled();

  const runOpts: RunChatOptions = {
    messages,
    thinking: wantThink,
    onMilestone,
  };

  // ponytail: 选 provider 通过 factory — chatWorkflow 不知道 webllm / custom 谁在跑。
  // 失败时 webllm 已自带 unload + fallback 重试,只有最终失败才回退到角色兜底台词。
  const run = await getActiveChatRunner();

  let raw: string;
  try {
    onMilestone?.('thinking');
    // ponytail: 一次打印整段请求 — 跨 webllm / custom 都从 chatWorkflow 统一发出,
    // dev 看 console 能直接展开看 system / history / 当前 user 全貌,不必逐条 log。
    console.log('[chatWorkflow → runChat]', { messages, thinking: wantThink });
    raw = await run(runOpts);
  } catch (err) {
    if (err instanceof ModelSwitchedError) {
      console.warn('[chatWorkflow] 模型已切换,放弃本次过期生成结果');
      return '';
    }
    console.error('[chatWorkflow] provider 推理失败,返回优雅角色兜底台词:', err);
    raw = getFriendlyFallbackSpeech(effectiveLang);
  }

  let cleanSpeech = extractCleanSpeech(raw);
  // ponytail: 思考模式 + 拿到空内容 → 关掉 thinking 再试一次,部分模型只输出
  // <think> 块时这个回退能把正文挖出来。
  if (!cleanSpeech.trim() && wantThink && raw !== getFriendlyFallbackSpeech(effectiveLang)) {
    try {
      raw = await run({ ...runOpts, thinking: false });
      cleanSpeech = extractCleanSpeech(raw);
    } catch (err) {
      if (!(err instanceof ModelSwitchedError)) {
        console.warn('[chatWorkflow] 二次重试失败,使用兜底:', err);
        cleanSpeech = extractCleanSpeech(getFriendlyFallbackSpeech(effectiveLang));
      }
    }
  }

  console.log('[Chat Raw Output]:', raw);
  console.log('[Chat Clean Speech]:', cleanSpeech);

  return cleanSpeech;
}

// ponytail: 重导出 webLLM 预热入口,方便 vrmEngine 等在启动时一次性 import。
export { preloadWebLLM };
