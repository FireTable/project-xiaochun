/**
 * providers/types.ts — 自定义 provider 配置类型 + 已知本地服务模板。
 *
 * ponytail: 纯类型 + 静态模板,零外部依赖。前端能直接 connect 的都是 OpenAI-compatible
 * HTTP 服务(Ollama / LM Studio / vLLM / LocalAI / 一众云厂商),不引入任何 npm SDK。
 */

export type ProviderProtocol = 'openai-compatible';

export interface ProviderProfile {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseURL: string;
  /** ponytail: 加密后存在 IndexedDB,运行时解密回明文用于 Authorization header。 */
  apiKey: string;
  model: string;
  /** ponytail: 用过的 model 列表(给下拉做 autocomplete)。 */
  recentModels?: string[];
  createdAt: number;
  lastUsedAt?: number;
  /** ponytail: 最后一次 /v1/models 探测的结果,UI 显示"上次探测成功 / 失败"。 */
  lastProbeOk?: boolean;
  lastProbeAt?: number;
  availableModels?: string[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatChunkDelta {
  content: string;
}

/** 已知本地服务模板 — UI 上一键填 baseURL/默认 model。 */
export interface ProviderTemplate {
  id: string;
  label: string;
  defaultBaseURL: string;
  defaultModel: string;
  hint?: string;
}

export const KNOWN_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'ollama',
    label: 'Ollama(本地)',
    defaultBaseURL: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    hint: '需先启动 ollama serve',
  },
  {
    id: 'lm-studio',
    label: 'LM Studio(本地)',
    defaultBaseURL: 'http://localhost:1234/v1',
    defaultModel: 'qwen2.5-7b-instruct',
    hint: '需先在 LM Studio 启动 OpenAI 兼容服务',
  },
  {
    id: 'vllm',
    label: 'vLLM(本地)',
    defaultBaseURL: 'http://localhost:8000/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
  },
  {
    id: 'localai',
    label: 'LocalAI(本地)',
    defaultBaseURL: 'http://localhost:8080/v1',
    defaultModel: 'gpt-4',
  },
  {
    id: 'custom',
    label: '自定义 OpenAI 兼容',
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
];