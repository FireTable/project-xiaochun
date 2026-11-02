// main.js - 小蠢 AI 伴侣 (Cindy 插件前端沙箱逻辑)

let bridgeChannel = null;

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
        await handleCreateCompanionRequest();
        return;
      }

      // 3. 用户在 3D 面板底部输入栏发送对话
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
      return bots.some(b => b.label?.includes('小蠢') || b.label?.toLowerCase().includes('xiaochun'));
    }
  } catch (_) {}
  return false;
}

// 引导 Cindy 创建「小蠢」伙伴
async function handleCreateCompanionRequest() {
  try {
    if (typeof cindy.targets?.list === 'function' && typeof cindy.targets?.send === 'function') {
      const res = await cindy.targets.list({ targetKind: 'bot' });
      const bots = res?.targets || [];
      const defaultBot = bots[0];
      if (defaultBot) {
        const requestKey = `xc_bot_create_${Date.now()}`;
        const prompt = '请调用 Cindy 内置系统工具 create_teammate 帮我创建一个专属伙伴「小蠢」：' +
          '名字为「小蠢」，职责为「3D AI 伴侣少女」，性格活泼治愈、元气灵动，' +
          '身份设定为小蠢 AI 伴侣，在回复时调用 xiaochun_speak 工具配合动作与表情。';
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
        message: '未找到可用的 Cindy 伙伴，请在 Cindy 左侧新建「小蠢」伙伴'
      });
    }
  } catch (err) {
    console.warn('[XiaoChun Main] 申请创建伙伴失败:', err);
    if (bridgeChannel) {
      bridgeChannel.postMessage({
        type: 'bot_error',
        message: '向 Cindy 发送失败，请检查 Cindy 伙伴的模型设置: ' + (err.message || String(err))
      });
    }
  }
}

// 处理来自 3D 舞台底部输入栏的用户消息
async function handleUserChatInput(userText) {
  if (!userText || !userText.trim()) return;
  const trimmed = userText.trim();

  try {
    if (typeof cindy.targets?.list === 'function' && typeof cindy.targets?.send === 'function') {
      const res = await cindy.targets.list({ targetKind: 'bot' });
      const bots = res?.targets || [];

      // 优先路由给专属「小蠢」伙伴
      const xiaoChunBot = bots.find(b => b.label?.includes('小蠢') || b.label?.toLowerCase().includes('xiaochun'));
      if (xiaoChunBot) {
        console.log('[XiaoChun Main] 路由对话至小蠢伙伴:', xiaoChunBot.id);
        const requestKey = `xc_chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await cindy.targets.send({
          target: { kind: 'bot', id: xiaoChunBot.id },
          requestKey,
          text: trimmed
        });
        return;
      }

      // 未创建小蠢伙伴时的零门槛兜底：投递给默认伙伴（如 Cindy），并附带角色设定前缀
      if (bots.length > 0) {
        const fallbackBot = bots[0];
        console.log('[XiaoChun Main] 兜底路由至现有伙伴:', fallbackBot.id);
        const requestKey = `xc_fallback_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const roleplayPrompt = `[请以小蠢（3D AI 伴侣少女）的元气可爱语气回复用户，并务必调用 xiaochun_speak 工具配合肢体动作与面部表情]\n用户：${trimmed}`;
        await cindy.targets.send({
          target: { kind: 'bot', id: fallbackBot.id },
          requestKey,
          text: roleplayPrompt
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

    if (workerResult.needSetupChoice) {
      friendlyMessage = '【初次使用设置】检测到当前尚未安装小蠢 3D 桌面客户端。您可以选择：\n' +
        '1. 自动安装桌面端（推荐）：调用 xiaochun_bootstrap(action="install", mode="desktop")，体验透明置顶、支持鼠标穿透的完整桌面 3D 桌宠；\n' +
        '2. 免安装内嵌模式：调用 xiaochun_bootstrap(mode="embed")，直接在 Cindy 视窗 Tab 中与小蠢 AI 伴侣交互，零安装开箱即用。';
    } else if (workerResult.actionTaken === 'mode_switched' || workerResult.actionTaken === 'embed_ready') {
      friendlyMessage = workerResult.message || `已配置为 ${workerResult.mode === 'embed' ? 'Cindy 内嵌视窗' : '桌面桌宠'} 模式。`;
    } else if (workerResult.mode === 'embed') {
      friendlyMessage = '【Cindy 内嵌视窗模式】指令已同步派发至小蠢 AI 伴侣。';
    } else if (tool === 'xiaochun_update') {
      friendlyMessage = workerResult.updated
        ? `【版本更新完成】已成功为小蠢安装最新版本并触发客户端重启！`
        : workerResult.message || '小蠢客户端版本检查与更新指令已派发。';
    } else if (workerResult.onboardingActive) {
      friendlyMessage = '【新手引导进行中】检测到小蠢正在进行初见向导剧情（art0 序章）。建议您先在桌面端窗口中与小蠢完成初见对话；若需强制朗读，请设置 force 为 true。';
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
