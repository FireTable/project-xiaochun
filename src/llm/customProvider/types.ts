/**
 * providers/types.ts — 自定义 provider 配置类型 + 已知服务模板（支持 LLM / STT / TTS 多模态）。
 *
 * ponytail: 纯类型 + 静态模板，零外部依赖。前端直接对接 OpenAI-compatible
 * HTTP 服务（Ollama / LM Studio / vLLM / Groq / MiniMax / 硅基流动 / OpenAI 等），不引入额外 npm SDK。
 */

export type ProviderProtocol = 'openai-compatible';

export type ProviderType = 'llm' | 'stt' | 'tts';

export interface ProviderProfile {
  id: string;
  /** 模态类型：'llm' (默认) | 'stt' | 'tts' */
  type?: ProviderType;
  name: string;
  protocol: ProviderProtocol;
  baseURL: string;
  /** ponytail: 加密后存在 IndexedDB，运行时解密回明文用于 Authorization header。 */
  apiKey: string;
  model: string;
  /** 仅 TTS 类型使用：音色名称（如 alloy、alex、female-tianmei 等） */
  voice?: string;
  /** ponytail: 用过的 model 列表（给下拉做 autocomplete）。 */
  recentModels?: string[];
  createdAt: number;
  lastUsedAt?: number;
  /** ponytail: 最后一次 /v1/models 探测的结果，UI 显示"上次探测成功 / 失败"。 */
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

/** 服务模板 — UI 上一键填 baseURL / 默认 model / 默认 voice。labelKey / hintKey 是 i18n key 或原始描述。 */
export interface ProviderTemplate {
  id: string;
  type?: ProviderType;
  labelKey: string;
  defaultBaseURL: string;
  defaultModel: string;
  defaultVoice?: string;
  hintKey?: string;
}

/** LLM 文本大模型服务模板 */
export const KNOWN_LLM_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'custom',
    type: 'llm',
    labelKey: 'providerConfig.templates.custom',
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  {
    id: 'ollama',
    type: 'llm',
    labelKey: 'providerConfig.templates.ollama',
    defaultBaseURL: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    hintKey: 'providerConfig.hintOllama',
  },
  {
    id: 'lm-studio',
    type: 'llm',
    labelKey: 'providerConfig.templates.lmStudio',
    defaultBaseURL: 'http://localhost:1234/v1',
    defaultModel: 'qwen2.5-7b-instruct',
    hintKey: 'providerConfig.hintLmStudio',
  },
  {
    id: 'vllm',
    type: 'llm',
    labelKey: 'providerConfig.templates.vllm',
    defaultBaseURL: 'http://localhost:8000/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
  },
  {
    id: 'localai',
    type: 'llm',
    labelKey: 'providerConfig.templates.localai',
    defaultBaseURL: 'http://localhost:8080/v1',
    defaultModel: 'gpt-4',
  },
];

/** 向下兼容别名 */
export const KNOWN_TEMPLATES = KNOWN_LLM_TEMPLATES;

/** 🎙️ STT 语音识别服务模板 (POST /v1/audio/transcriptions) */
export const KNOWN_STT_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'stt-custom',
    type: 'stt',
    labelKey: 'providerConfig.templates.custom',
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultModel: 'whisper-1',
  },
  {
    id: 'stt-cf',
    type: 'stt',
    labelKey: 'Cloudflare Workers AI (Whisper Turbo)',
    defaultBaseURL: 'https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1',
    defaultModel: '@cf/openai/whisper-large-v3-turbo',
  },
  {
    id: 'stt-groq',
    type: 'stt',
    labelKey: 'providerConfig.templates.sttGroq',
    defaultBaseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'whisper-large-v3-turbo',
  },
  {
    id: 'stt-minimax',
    type: 'stt',
    labelKey: 'providerConfig.templates.sttMiniMax',
    defaultBaseURL: 'https://api.minimax.chat/v1',
    defaultModel: 'asr-1.0',
  },
  {
    id: 'stt-siliconflow',
    type: 'stt',
    labelKey: 'providerConfig.templates.sttSiliconFlow',
    defaultBaseURL: 'https://api.siliconflow.cn/v1',
    defaultModel: 'FunAudioLLM/SenseVoiceSmall',
  },
  {
    id: 'stt-openai',
    type: 'stt',
    labelKey: 'OpenAI Whisper',
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultModel: 'whisper-1',
  },
];

/** 🔊 TTS 语音合成服务模板 (POST /v1/audio/speech) */
export const KNOWN_TTS_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'tts-custom',
    type: 'tts',
    labelKey: 'providerConfig.templates.custom',
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultModel: 'tts-1',
    defaultVoice: 'alloy',
  },
  {
    id: 'tts-openai',
    type: 'tts',
    labelKey: 'OpenAI (TTS-1)',
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultModel: 'tts-1',
    defaultVoice: 'alloy',
  },
  {
    id: 'tts-siliconflow',
    type: 'tts',
    labelKey: 'providerConfig.templates.ttsSiliconFlow',
    defaultBaseURL: 'https://api.siliconflow.cn/v1',
    defaultModel: 'FunAudioLLM/CosyVoice-300M-25Hz',
    defaultVoice: 'alex',
  },
  {
    id: 'tts-minimax',
    type: 'tts',
    labelKey: 'providerConfig.templates.ttsMiniMax',
    defaultBaseURL: 'https://api.minimax.chat/v1',
    defaultModel: 'speech-01-turbo',
    defaultVoice: 'female-tianmei',
  },
];
