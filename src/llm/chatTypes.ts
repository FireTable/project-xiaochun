/**
 * chatTypes.ts — 跨 provider 的对话类型。
 *
 * ponytail: webLLMProvider / customProvider / chatWorkflow 共用一份 shape,
 * 调用约定统一在 RunChatOptions,provider 只实现「拿这些参数 → 返回 raw 字符串」,
 * 不再关心 retry / clean / milestone 等横切关注点。
 */

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

export type LlmMilestoneKey = 'loadingWebGpu' | 'thinking';

export type MilestoneFn = (
  key: LlmMilestoneKey,
  vars?: Record<string, unknown>,
) => void;

export interface RunChatOptions {
  messages: ChatMessage[];
  thinking: boolean;
  /** ponytail: 不传就不限 — 让 provider / 模型用自己的默认。 */
  maxTokens?: number;
  signal?: AbortSignal;
  onMilestone?: MilestoneFn;
}

/** provider 必须实现的最小接口 — 拿到 opts 返回原始 assistant 文本。 */
export type RunChatFn = (opts: RunChatOptions) => Promise<string>;

/**
 * ponytail: provider 描述符 — chatWorkflow 不知道 webllm / custom 谁在跑,
 * factory 轮询所有 provider,第一个 isActive 命中的就是当前激活的。
 * 双方完全同形,新加 provider 只需写一个 ChatProvider 实例注册进去。
 */
export interface ChatProvider {
  isActive(): Promise<boolean>;
  runChat: RunChatFn;
}
