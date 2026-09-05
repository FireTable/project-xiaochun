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

/** 已知本地服务模板 — UI 上一键填 baseURL/默认 model。labelKey / hintKey 是 i18n key,UI 层 t(...) 渲染。 */
export interface ProviderTemplate {
  id: string;
  labelKey: string;
  defaultBaseURL: string;
  defaultModel: string;
  hintKey?: string;
}

export const KNOWN_TEMPLATES: ProviderTemplate[] = [
  // ponytail: 自定义放首位 — 用户最常用 baseURL/API key 输入场景,优先触达。
  {
    id: 'custom',
    labelKey: 'providerConfig.templates.custom',
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  {
    id: 'ollama',
    labelKey: 'providerConfig.templates.ollama',
    defaultBaseURL: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    hintKey: 'providerConfig.hintOllama',
  },
  {
    id: 'lm-studio',
    labelKey: 'providerConfig.templates.lmStudio',
    defaultBaseURL: 'http://localhost:1234/v1',
    defaultModel: 'qwen2.5-7b-instruct',
    hintKey: 'providerConfig.hintLmStudio',
  },
  {
    id: 'vllm',
    labelKey: 'providerConfig.templates.vllm',
    defaultBaseURL: 'http://localhost:8000/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
  },
  {
    id: 'localai',
    labelKey: 'providerConfig.templates.localai',
    defaultBaseURL: 'http://localhost:8080/v1',
    defaultModel: 'gpt-4',
  },
];