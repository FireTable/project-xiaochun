import type { Trans } from './zh-CN';

/**
 * 英文文案。结构必须满足 `Trans`,漏译/键名错误 TS 直接报错。
 * ponytail: langLabels 与 zh-CN 保持同字面值(母语名不翻译)。
 */
export const en: Trans = {
  meta: {
    lang: 'en',
    name: 'Project XiaoChun',
    version: '0.0.0',
  },
  app: {
    dropZoneHint: 'Release to load this `.vrm` model',
  },
  header: {
    uploadVrm: 'Upload VRM',
    settingsPanel: 'Settings / Debug Panel',
    settingsPanelTitle: 'Collapse panel',
    switchLang: {
      tooltip: 'Switch language / 切换语言',
    },
    langLabels: {
      'zh-CN': '中文',
      en: 'English',
      ja: '日本語',
    },
  },
  chat: {
    placeholder: 'Talk to XiaoChun… (e.g. say hi)',
    sending: 'Thinking…',
    send: 'Send',
  },
  loading: {
    title: 'XiaoChun is waking up…',
    parsingModel: 'Hmm… memorizing your look…',
    loadingModel: 'XiaoChun is dressing up as {{name}}…',
    loadingWebGpu: 'XiaoChun\'s brain is warming up…',
    thinking: 'XiaoChun is thinking hard…',
  },
  bubble: {
    thinking: 'Hmm… let me think…',
    speaking: 'Here we go~',
    tts: 'Warming up my voice…',
    emage: 'Picking a pose for you… ({{seconds}}s)',
    loadingWebGpu: 'XiaoChun\'s brain is warming up…',
    greeting: 'Hi! Glad to chat with you!',
  },
  panel: {
    title: 'Debug / Settings Panel',
    expressionsLabel: '🎭 Preset Expressions',
    lightsLabel: '💡 Light Channels',
    globalLight: 'Global Light Multiplier',
    fov: 'Camera FOV',
    brightness: 'Intensity',
    lightChannels: {
      dir: '☀️ Key Light (Sun)',
      hemi: '🌤️ Hemisphere Sky',
      front: '🔦 Face Spot',
      fill: '✨ Rim Backlight',
      leg: '🦵 Leg Soft Light',
      arm: '💪 Arm Spot',
    },
    expressionList: {
      neutral: '😐 Neutral',
      happy: '😊 Happy',
      angry: '😡 Angry',
      sad: '😢 Sad',
      relaxed: '😌 Relaxed',
      surprised: '😲 Surprised',
    },
  },
  error: {
    llm: 'Local LLM error: {{message}}',
    loadVrmFailed: 'Failed to load VRM file',
    loadFailed: 'Load failed',
  },
};
