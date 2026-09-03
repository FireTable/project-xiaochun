import type { Trans } from './zh-CN';

/**
 * 日文文案。结构必须满足 `Trans`,漏译/键名错误 TS 直接报错。
 * ponytail: 模型名「小蠢」保留原文,因为是产品代号。
 */
export const ja: Trans = {
  meta: {
    lang: 'ja',
    name: 'Project XiaoChun',
    version: '0.0.0',
  },
  app: {
    dropZoneHint: 'マウスを離すとこの `.vrm` モデルを読み込みます',
  },
  header: {
    uploadVrm: 'VRMをアップロード',
    settingsPanel: '設定 / デバッグパネル',
    settingsPanelTitle: 'パネルを閉じる',
    switchLang: {
      tooltip: '言語を切り替え / Switch language',
    },
    langLabels: {
      'zh-CN': '中文',
      en: 'English',
      ja: '日本語',
    },
  },
  chat: {
    placeholder: '小蠢と話す… (例: 挨拶して)',
    sending: '考え中…',
    send: '送信',
  },
  loading: {
    title: '小蠢が目覚めてる…',
    parsingModel: 'んー…あなたの姿を覚える…',
    loadingModel: '小蠢が着替えている… ({{name}})',
    loadingWebGpu: '小蠢の脳を温めてる…',
    thinking: '小蠢が真剣に考えてる…',
  },
  bubble: {
    thinking: 'うーん…考え中…',
    speaking: 'いってきます～',
    tts: '声のお準備…',
    emage: 'ポーズを考えるね… ({{seconds}}秒)',
    loadingWebGpu: '小蠢の脳を温めてる…',
    greeting: 'こんにちは!お話しできて嬉しいです!',
  },
  panel: {
    title: 'デバッグ / 設定パネル',
    expressionsLabel: '🎭 プリセット表情',
    lightsLabel: '💡 ライトチャンネル',
    globalLight: '全体光量倍率',
    fov: 'カメラ視野角 (FOV)',
    brightness: '強度',
    lightChannels: {
      dir: '☀️ キー (太陽)',
      hemi: '🌤️ 半球光',
      front: '🔦 顔面スポット',
      fill: '✨ リムバックライト',
      leg: '🦵 脚部ソフト',
      arm: '💪 腕スポット',
    },
    expressionList: {
      neutral: '😐 デフォルト',
      happy: '😊 嬉しい',
      angry: '😡 怒り',
      sad: '😢 悲しい',
      relaxed: '😌 リラックス',
      surprised: '😲 驚き',
    },
  },
  error: {
    llm: 'ローカル LLM エラー: {{message}}',
    loadVrmFailed: 'VRM ファイルの読み込みに失敗しました',
    loadFailed: '読み込み失敗',
  },
};
