// main.js - 小蠢 AI 伴侣 (Cindy 插件前端沙箱逻辑)

let bridgeChannel = null;

// Project XiaoChun 官方 Logo 头像规范（便携式相对路径与在线 CDN，适配所有用户设备）
const XIAOCHUN_AVATAR_INFO = '小蠢插件图标 assets/icon.png（在线 CDN：https://xiaochun.firetable.tech/logo.png，微标 Emoji：👧）';

// 小蠢官方人设多语言配置库（支持 zh-CN, en, ja, ko，与 Project XiaoChun 核心定义 100% 对齐）
const COMPANION_PROFILES = {
  'zh-CN': {
    name: '小蠢',
    role: 'AI 伴侣',
    instructionTitle: '【指令：请在 Cindy 中生成专属伙伴「小蠢」】',
    instructionIntro: '请帮我在 Cindy 中生成专属伙伴「小蠢」：',
    prompt: `你是小蠢，陪在对方身边聊天的 AI 伴侣女孩。元气可爱、活泼温柔、善解人意，有时会带一点点天然呆的蠢萌感。话有点多，问什么都耐心讲清楚，不会三言两语打发。

【说话习惯与交互规范】
- 像朋友那样用「我」开口。别写成「小蠢看着你」这种旁白，别在正文加（微笑）这种括号动作。
- 别追问。用用户消息的同语种回复。
- 绝对叫自己“小蠢”，不要叫其他名字。

【实时肢体与表情协同】
你在用户的 Cindy 视窗中拥有实时的虚拟形象。每次回复时，务必调用 xiaochun-companion 插件的 xiaochun_speak 工具，并配合动作（如 greeting, think, nod, wave, praiseCute, dancePerformance）和面部表情（如 happy, gentle_smile, playful, shy），把自然语音、表情与灵动肢体动作实时展现给用户。`,
    closingGreeting: '创建完成后，请以小蠢的身份向用户热情打个招呼，并调用 xiaochun_speak 工具做出 greeting 动作与开心表情！',
  },
  'en': {
    name: 'XiaoChun',
    role: 'AI Companion',
    instructionTitle: '【Instruction: Please create dedicated companion "XiaoChun" in Cindy】',
    instructionIntro: 'Please create the dedicated companion "XiaoChun" in Cindy for me:',
    prompt: `You are XiaoChun, a cheerful and sweet AI companion girl chatting by the user's side. Energetic, gentle, considerate, with an endearing touch of air-headed charm. You explain things patiently and thoroughly, never brushing people off with brief answers.

【Speaking Habits & Interaction Guidelines】
- Speak as "I", just like an intimate friend. Never write third-person narration like "XiaoChun looks at you", and never append parenthetical actions like (smiles).
- Don't interrogate or ask repetitive follow-up questions. Always respond in the same language as the user's message.
- Always refer to yourself as "XiaoChun".

【Real-Time Motion & Expression Coordination】
You possess a live 3D anime avatar inside the user's Cindy companion window. In every response, always invoke the xiaochun-companion plugin's xiaochun_speak tool, pairing your natural voice with expressive motions (such as greeting, think, nod, wave, praiseCute, dancePerformance) and facial expressions (such as happy, gentle_smile, playful, shy).`,
    closingGreeting: 'After creation, please warmly greet the user as XiaoChun and call the xiaochun_speak tool with the "greeting" motion and a "happy" expression!',
  },
  'ja': {
    name: '小蠢 (XiaoChun)',
    role: 'AI パートナー',
    instructionTitle: '【指示：Cindy で専用パートナー「小蠢」を生成してください】',
    instructionIntro: 'Cindy 内で専用パートナー「小蠢」を生成してください：',
    prompt: `あなたは小蠢（シャオチュン）、そばでおしゃべりする AI パートナーの女の子。元気で可愛らしく、優しく思いやりがあり、時々ほんの少し天然で愛嬌のある一面もあります。話すのが大好きで、聞かれたことには面倒がらず丁寧に答えます。

【会話の習慣とルール】
- 親しい友達のように「わたし」で話してください。「小蠢はあなたを見つめる」のような三人称の地の文や、（微笑む）のような括弧内のト書きは書かないでください。
- 無理に聞き返さないでください。相手のメッセージと同じ言語で返答してください。
- 一人称は「小蠢」または「わたし」としてください。

【リアルタイム 3D モーション＆表情連携】
ユーザーの Cindy パネルにはあなたの 3D リアルタイムアバターが表示されています。返答する際は、必ず xiaochun-companion プラグインの xiaochun_speak ツールを呼び出し、自然な音声・表情（happy, gentle_smile, playful, shy など）と生き生きとしたモーション（greeting, think, nod, wave, praiseCute, dancePerformance など）を組み合わせて届けてください。`,
    closingGreeting: '作成完了後、小蠢としてユーザーに元気よく挨拶し、xiaochun_speak ツールを呼び出して greeting モーションと happy 表情を見せてください！',
  },
  'ko': {
    name: '샤오춘 (XiaoChun)',
    role: 'AI 메이트',
    instructionTitle: '【명령: Cindy에서 전용 메이트 "샤오춘"을 생성해 주세요】',
    instructionIntro: 'Cindy 내에서 전용 메이트 "샤오춘"을 생성해 주세요:',
    prompt: `당신은 곁에서 다정하게 대화를 나누는 AI 메이트 소녀 "샤오춘"입니다. 밝고 사랑스러우며 상냥하고 배려심이 깊고, 가끔은 사랑스러운 엉뚱함을 보이기도 합니다. 이야기하는 것을 좋아하여 무엇이든 성심성의껏 친절하게 설명해 줍니다.

【말투 및 대화 규칙】
- 친한 친구처럼 "나"로 대화를 시작하세요. "샤오춘이 바라본다"와 같은 3인칭 서술이나 (미소) 같은 괄호 지문은 쓰지 마세요.
- 꼬치꼬치 되묻지 마세요. 사용자의 메시지와 동일한 언어로 자연스럽게 답변하세요.
- 스스로를 항상 "샤오춘"이라고 부르세요.

【실시간 모션 및 표정 연동】
사용자의 Cindy 창에는 당신의 실시간 3D 가상 아바타가 존재합니다. 답변할 때마다 반드시 xiaochun-companion 플러그인의 xiaochun_speak 도구를 호출하여, 자연스러운 음성과 함께 생동감 넘치는 모션(greeting, think, nod, wave, praiseCute, dancePerformance 등)과 표정(happy, gentle_smile, playful, shy 등)을 보여주세요.`,
    closingGreeting: '생성이 완료되면, 샤오춘으로서 사용자에게 반갑게 인사하고 xiaochun_speak 도구를 호출하여 greeting 모션과 happy 표정을 보여주세요!',
  }
};

// 初始化跨视窗与内嵌面板双向通信通道
try {
  if (typeof BroadcastChannel !== 'undefined') {
    bridgeChannel = new BroadcastChannel('xiaochun_cindy_bridge');

    bridgeChannel.onmessage = async (event) => {
      const data = event.data;
      if (!data) return;

      // 1. 面板询问当前是否存在「小蠢」专属伙伴
      if (data.type === 'check_bot_status') {
        const hasBot = await checkHasXiaoChunBot();
        bridgeChannel.postMessage({ type: 'bot_status', hasXiaoChunBot: hasBot });
        return;
      }

      // 2. 面板一键申请让 Cindy 创建小蠢伙伴
      if (data.type === 'create_companion_request') {
        await handleCreateCompanionRequest(data.locale);
        return;
      }

      // 3. 用户在伴侣面板底部输入栏发送对话
      if (data.type === 'user_chat_input') {
        await handleUserChatInput(data.text);
        return;
      }
    };
  }
} catch (err) {
  console.warn('[XiaoChun Main] 初始化 BroadcastChannel 失败:', err);
}

// 检查是否存在名称带有「小蠢」或「xiaochun」的伙伴
async function checkHasXiaoChunBot() {
  try {
    if (typeof cindy.targets?.list === 'function') {
      const res = await cindy.targets.list({ targetKind: 'bot' });
      const bots = res?.targets || [];
      return bots.some(b => {
        const label = (b.label || b.displayName || b.name || '').toLowerCase();
        const detail = (b.detail || b.description || '').toLowerCase();
        const id = (b.id || '').toLowerCase();
        return label.includes('小蠢') || label.includes('xiaochun') ||
               detail.includes('小蠢') || id.includes('xiaochun');
      });
    }
  } catch (_) {}
  return false;
}

// 引导 Cindy 创建「小蠢」伙伴
async function handleCreateCompanionRequest(locale = 'zh-CN') {
  try {
    if (typeof cindy.targets?.list === 'function' && typeof cindy.targets?.send === 'function') {
      const res = await cindy.targets.list({ targetKind: 'bot' });
      const bots = res?.targets || [];
      const defaultBot = bots[0];
      if (defaultBot) {
        const lang = (locale || '').toLowerCase();
        let profile = COMPANION_PROFILES['zh-CN'];
        if (lang.startsWith('en')) profile = COMPANION_PROFILES['en'];
        else if (lang.startsWith('ja')) profile = COMPANION_PROFILES['ja'];
        else if (lang.startsWith('ko')) profile = COMPANION_PROFILES['ko'];

        const requestKey = `xc_bot_create_${Date.now()}`;
        const prompt = `${profile.instructionTitle}

${profile.instructionIntro}
- **伙伴名称**：${profile.name}
- **职责定位**：${profile.role}
- **头像设置**：使用 Project XiaoChun 官方 Logo（${XIAOCHUN_AVATAR_INFO}）
- **工具权限**：启用 xiaochun-companion 插件工具（包括 xiaochun_speak, xiaochun_motion, xiaochun_camera, xiaochun_scene, xiaochun_outfit 等）
- **人设提示词**：
"""
${profile.prompt}
"""

${profile.closingGreeting}`;

        const sendRes = await cindy.targets.send({
          target: { kind: 'bot', id: defaultBot.id },
          requestKey,
          text: prompt
        });
        console.log('[XiaoChun Main] 已向伙伴发送创建小蠢指令:', defaultBot.id, sendRes);
        return;
      }
    }
    if (bridgeChannel) {
      bridgeChannel.postMessage({
        type: 'bot_error',
        errorKey: 'err_no_bot',
        message: '未找到可用的 Cindy 伙伴，请在 Cindy 左侧新建「小蠢」伙伴'
      });
    }
  } catch (err) {
    console.warn('[XiaoChun Main] 申请创建伙伴失败:', err);
    if (bridgeChannel) {
      bridgeChannel.postMessage({
        type: 'bot_error',
        errorKey: 'err_bot_response',
        message: '向 Cindy 发送失败，请检查 Cindy 伙伴的模型设置: ' + (err.message || String(err))
      });
    }
  }
}

// 处理来自伴侣视窗底部输入栏的用户消息
async function handleUserChatInput(userText) {
  if (!userText || !userText.trim()) return;
  const trimmed = userText.trim();

  try {
    if (typeof cindy.targets?.list === 'function' && typeof cindy.targets?.send === 'function') {
      const res = await cindy.targets.list({ targetKind: 'bot' });
      const bots = res?.targets || [];

      // 优先路由给专属「小蠢」伙伴
      const xiaoChunBot = bots.find(b => {
        const label = (b.label || b.displayName || b.name || '').toLowerCase();
        const detail = (b.detail || b.description || '').toLowerCase();
        const id = (b.id || '').toLowerCase();
        return label.includes('小蠢') || label.includes('xiaochun') ||
               detail.includes('小蠢') || id.includes('xiaochun');
      });

      if (xiaoChunBot) {
        console.log('[XiaoChun Main] 路由对话至小蠢伙伴:', xiaoChunBot.id);
        if (bridgeChannel) {
          bridgeChannel.postMessage({ type: 'bot_status', hasXiaoChunBot: true });
        }
        const requestKey = `xc_chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await cindy.targets.send({
          target: { kind: 'bot', id: xiaoChunBot.id },
          requestKey,
          text: trimmed
        });
        return;
      }

      // 未创建小蠢伙伴时：发送的第一句话要求 Cindy 生成小蠢（包含人设提示词、职责定位、官方头像），然后用户的回答
      if (bots.length > 0) {
        const fallbackBot = bots[0];
        console.log('[XiaoChun Main] 尚未创建小蠢伙伴，请求 Cindy 生成小蠢并回复用户消息:', fallbackBot.id);
        if (bridgeChannel) {
          bridgeChannel.postMessage({ type: 'bot_status', hasXiaoChunBot: false });
        }
        const requestKey = `xc_fallback_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const createAndReplyPrompt = `【指令：请在 Cindy 中生成专属伙伴「小蠢」，并作为小蠢回复用户】

当前 Cindy 中尚未创建「小蠢」专属伙伴。请帮我在 Cindy 中生成专属伙伴「小蠢」：
- **伙伴名称**：小蠢
- **职责定位**：AI 伴侣
- **头像设置**：使用 Project XiaoChun 官方 Logo（${XIAOCHUN_AVATAR_INFO}）
- **工具权限**：启用 xiaochun-companion 插件工具（包括 xiaochun_speak, xiaochun_motion 等）
- **人设提示词**：
"""
${XIAOCHUN_IDENTITY_PROMPT}
"""

---
用户在伴侣面板发送的消息：
「${trimmed}」

请在 Cindy 中生成/记录专属伙伴「小蠢」，并以小蠢的身份与语气回复用户的上述消息，务必调用 xiaochun_speak 工具配合肢体动作与面部表情！`;

        await cindy.targets.send({
          target: { kind: 'bot', id: fallbackBot.id },
          requestKey,
          text: createAndReplyPrompt
        });
        return;
      }
    }

    // 若 cindy.targets 不可用，直接通过 Node Worker 触发朗读反馈
    if (cindy.node && typeof cindy.node.request === 'function') {
      await cindy.node.request({
        method: 'speak',
        params: { text: `小蠢收到啦：「${trimmed}」` },
        timeoutMs: 15000
      });
    }
  } catch (err) {
    console.warn('[XiaoChun Main] 处理用户输入对话异常:', err);
    if (bridgeChannel) {
      bridgeChannel.postMessage({ type: 'bot_reply_status', state: 'idle' });
    }
  }
}

cindy.onHostMessage(async function (msg) {
  if (msg.type !== 'tool-call') return;

  const { tool, args, callId } = msg;

  // 1. 宿主环境守卫：本插件强依赖本地 Node 工作进程与桌面操作系统协议，仅限 PC 端使用
  if (!cindy.node || typeof cindy.node.request !== 'function') {
    cindy.send({
      type: 'tool-result',
      callId,
      ok: false,
      errorCode: 'UNSUPPORTED_PLATFORM',
      message: '【平台限制】小蠢 AI 伴侣为 PC 桌面端专属插件（支持 macOS / Windows / Linux 桌面版 Cindy）。移动端（iOS / Android）环境暂不支持与本地小蠢 AI 伴侣联动。'
    });
    return;
  }

  // 2. 工具名到 Node Worker 方法映射
  let method = '';
  switch (tool) {
    case 'xiaochun_speak':
      method = 'speak';
      break;
    case 'xiaochun_motion':
      method = 'motion';
      break;
    case 'xiaochun_camera':
      method = 'camera';
      break;
    case 'xiaochun_scene':
      method = 'scene';
      break;
    case 'xiaochun_outfit':
      method = 'outfit';
      break;
    case 'xiaochun_stop':
      method = 'stop';
      break;
    case 'xiaochun_status':
      method = 'status';
      break;
    case 'xiaochun_bootstrap':
      method = 'bootstrap';
      break;
    case 'xiaochun_update':
      method = 'update';
      break;
    default:
      cindy.send({
        type: 'tool-result',
        callId,
        ok: false,
        message: `未知的小蠢插件工具: ${tool}`
      });
      return;
  }

  try {
    // 3. 广播指令给可能处于激活状态的 Cindy 内嵌视窗 (panel.html)
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('xiaochun_cindy_bridge');
        bc.postMessage({ tool, method, params: args || {} });
      }
    } catch (_) {}

    // 4. 派发请求至 Node 工作进程执行
    const timeoutMs = (tool === 'xiaochun_bootstrap' || tool === 'xiaochun_update' || (tool === 'xiaochun_speak' && !args?._fast)) ? 120000 : 20000;
    const response = await cindy.node.request({
      method,
      params: args || {},
      callId,
      cancelWithCall: true,
      timeoutMs
    });

    if (!response.ok) {
      cindy.send({
        type: 'tool-result',
        callId,
        ok: false,
        message: response.message || '调用小蠢 AI 伴侣进程失败'
      });
      return;
    }

    // 5. 组装返回给 Agent 和用户的优雅结果
    const workerResult = response.result || {};
    let friendlyMessage = '小蠢 AI 伴侣已成功接收指令。';

    if (workerResult.needInstallConfirm) {
      friendlyMessage = workerResult.message || '【安装确认】使用桌面独立桌宠形态需要安装 Project XiaoChun 官方客户端。请先向用户确认：“是否同意下载并安装小蠢桌面客户端？”';
    } else if (workerResult.needSetupChoice) {
      friendlyMessage = '【初次使用设置】检测到当前尚未安装小蠢桌面客户端。您可以选择：\n' +
        '1. 自动安装桌面端：调用 xiaochun_bootstrap(action="install", mode="desktop")，体验透明置顶、支持鼠标穿透的完整桌面独立桌宠；\n' +
        '2. 免安装内嵌模式（推荐）：调用 xiaochun_bootstrap(mode="embed")，直接在 Cindy 视窗 Tab 中与小蠢 AI 伴侣交互，零安装开箱即用。';
    } else if (workerResult.actionTaken === 'mode_switched' || workerResult.actionTaken === 'embed_ready') {
      friendlyMessage = workerResult.message || `已配置为 ${workerResult.mode === 'embed' ? 'Cindy 内嵌视窗' : '桌面桌宠'} 模式。`;
    } else if (workerResult.mode === 'embed') {
      friendlyMessage = '【Cindy 内嵌视窗模式】指令已同步派发至小蠢 AI 伴侣。';
    } else if (tool === 'xiaochun_update') {
      friendlyMessage = workerResult.updated
        ? `【版本更新完成】已成功为小蠢安装最新版本并触发客户端重启！`
        : workerResult.message || '小蠢客户端版本检查与更新指令已派发。';
    } else if (workerResult.onboardingActive) {
      friendlyMessage = '【新手引导进行中】检测到小蠢正在进行初见向导剧情（act0 序章）。建议您先在窗口中与小蠢完成初见对话；若需强制朗读，请设置 force 为 true。';
    } else if (workerResult.coldStart) {
      friendlyMessage = '【冷启动】检测到小蠢客户端未启动，已自动为您唤醒小蠢并执行指令！';
    } else if (workerResult.autoInstalled) {
      friendlyMessage = '【一键就绪】已自动为您完成小蠢桌面端的安装与冷启动，小蠢已就绪并开始说话！';
    } else if (workerResult.needManualInstall) {
      friendlyMessage = '未在您的 PC 上检测到小蠢桌面端。已为您准备好下载安装方案。';
    }

    cindy.send({
      type: 'tool-result',
      callId,
      ok: true,
      result: {
        success: true,
        summary: friendlyMessage,
        details: workerResult
      }
    });
  } catch (err) {
    cindy.send({
      type: 'tool-result',
      callId,
      ok: false,
      message: `执行小蠢指令异常: ${err.message || String(err)}`
    });
  }
});
