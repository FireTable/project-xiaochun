/**
 * 中文文案。`Trans` 是单一可信源,其它语言文件必须满足该类型。
 * ponytail: 不要在这里写 `as const`,否则其它语言会因为字面值差异报红。
 */
export const zhCN = {
  meta: {
    lang: 'zh-CN',
    name: 'Project XiaoChun',
    version: '0.0.0',
  },
  app: {
    dropZoneHint: '松开鼠标加载该 `.vrm` 模型',
  },
  header: {
    uploadVrm: '上传 VRM',
    settingsPanel: '设置 / 调试面板',
    settingsPanelTitle: '收起面板',
    switchLang: {
      tooltip: '切换语言 / Switch language',
    },
    /** ponytail: 语言菜单显示用的母语名,所有语言文件都保持这三个键。 */
    langLabels: {
      'zh-CN': '中文',
      en: 'English',
      ja: '日本語',
    },
  },
  chat: {
    placeholder: '跟小蠢说话… (例如: 跟我打个招呼)',
    sending: '思考中…',
    send: '发送',
  },
  loading: {
    title: '小蠢正在醒来…',
    parsingModel: '嗯…让小蠢记住你的模样…',
    // ponytail: `name` 是模型文件名变量,走 i18next 插值。
    loadingModel: '小蠢正在打扮成{{name}}…',
    loadingWebGpu: '小蠢的大脑要热身一下…',
    thinking: '小蠢在认真想哦…',
    madBadge: 'SSR ★★★★★',
    madCardRole: 'AUTONOMOUS ANIME VTUBER',
    madCardName: '小 蠢 · XiaoChun',
    madTagHair: '珊瑚橘粉发',
    madTagWebGpu: '原生 WebGPU 引擎',
    madBreakBtn: '破次元变身 3D 舞台',
    madBreaking: '⚡ 破次元穿越中...',
    madPreviewBreakBtn: '🚀 体验 2D 破次元 → 3D 入场',
    madBubbleSticker: '蠢蠢欲动中…',
    madVoiceBeaconTitle: '小蠢的声音信标:',
    madVoiceBeaconQuote: '“今天也要一起愉快地聊天哦~ 我已经在浏览器里准备好啦！✨”',
    madSysTitle: 'xiaochun.sys',
    madBgmStatus: 'BGM // 动作同步',
    madStageActive: '● 3D 舞台就绪',
    madStageReady: '✨ 3D 小蠢已就绪，已切换为 VRMA 自然待机动作',
    madChatPlaceholder: '跟小蠢说点什么吧...',
    madShaderCompiling: 'MToon 着色器与材质编译中…',
    madMeshDecoding: '高保真网格与表情形态解压…',
    madMotionSync: '全身协同动作引擎预热…',
    madPipelineReady: '破次元管线准备就绪！',
    madGenshinProgressHint: '✦ 提示：基于 WebGPU 原生渲染，支持 60FPS 实时光影与微表情追踪',
  },
  bubble: {
    thinking: '嗯嗯…让小蠢想想嘛…',
    speaking: '来啦来啦～',
    tts: '嗯…让嗓子热一下…',
    // ponytail: `seconds` 来自 audio buffer 时长,运行时格式化。
    emage: '嗯…想想怎么动… ({{seconds}}s)',
    // ponytail: 这个本来该走 LoadingOverlay,但 webLLM milestone 走的是 bubble status 通道,
    // 兜底翻译一下避免 i18next 把 key 原样吐出来。
    loadingWebGpu: '小蠢的大脑要热身一下…',
    greeting: '你好呀!很高兴和你聊天!',
  },
  panel: {
    title: '调试 / 设置面板',
    expressionsLabel: '🎭 预设表情',
    lightsLabel: '💡 独立灯光通道',
    globalLight: '全局总光照倍率',
    fov: '镜头视场角 (FOV)',
    brightness: '亮度',
    lightChannels: {
      dir: '☀️ 主直射日光 (Key)',
      hemi: '🌤️ 半球环境天光 (Hemi)',
      front: '🔦 面部专属射灯 (Face)',
      fill: '✨ 背后轮廓微光 (Rim)',
      leg: '🦵 腿部漫射柔光 (Leg)',
      arm: '💪 双臂专属射灯 (Arms)',
    },
    expressionList: {
      neutral: '😐 默认',
      happy: '😊 开心',
      angry: '😡 愤怒',
      sad: '😢 悲伤',
      relaxed: '😌 放松',
      surprised: '😲 惊讶',
    },
  },
  error: {
    llm: '端侧 LLM 异常: {{message}}',
    loadVrmFailed: '无法加载 VRM 文件',
    loadFailed: '加载失败',
  },
};

export type Trans = typeof zhCN;
