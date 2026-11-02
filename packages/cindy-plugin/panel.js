(function () {
  const iframe = document.getElementById('xiaochun-frame');
  const loadingOverlay = document.getElementById('loading-overlay');
  const btnRetry = document.getElementById('btn-retry');

  let currentPort = 23518;
  let isFrameLoaded = false;
  let handshakePort = null;

  function hideLoading() {
    isFrameLoaded = true;
    if (loadingOverlay) {
      loadingOverlay.classList.add('hidden');
    }
  }

  function showRetry() {
    if (!isFrameLoaded && btnRetry && loadingOverlay) {
      loadingOverlay.classList.remove('hidden');
      btnRetry.classList.add('show');
    }
  }

  const chatBarContainer = document.getElementById('chat-bar-container');

  function revealChatBar() {
    let onboarded = true;
    try {
      const isFirst = localStorage.getItem('xc_onboarding_completed_v1') !== '1' && localStorage.getItem('xc_cindy_onboarded_v1') !== '1';
      if (isFirst) onboarded = false;
    } catch (_) {}
    if (!onboarded) return;

    if (chatBarContainer && !chatBarContainer.classList.contains('ready')) {
      console.log('[XiaoChun Panel] 伴侣视窗与引擎已就绪，平滑浮现底部对话栏');
      chatBarContainer.classList.add('ready');
    }
  }

  // 1. 获取本地桥接服务端口并载入伴侣视窗
  async function initEmbedFrame() {
    try {
      const res = await fetch('/bridge-port.json?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        if (data && data.port) {
          currentPort = data.port;
        }
      }
    } catch (_) {}

    const hostOrigin = window.location.origin;
    // 首次进入 Cindy 伴侣视窗时，带上 &onboarding=1 开启沉浸式新手剧情向导（Act 0 序章·初遇小蠢）
    let hasCompletedOnboarding = false;
    try {
      hasCompletedOnboarding = localStorage.getItem('xc_onboarding_completed_v1') === '1' || localStorage.getItem('xc_cindy_onboarded_v1') === '1';
    } catch (_) {}
    const onboardingParam = !hasCompletedOnboarding ? '&onboarding=1' : '';

    // 纯净伴侣视窗：挂载头顶气泡、换装菜单、换场景菜单与 GitHub 图标，开启原生全屏 LoadingOverlay，排除透明背景选项（Cindy 视窗背景不透明），交由 Cindy 作为统一对话大脑
    const targetUrl = `http://127.0.0.1:${currentPort}/embed/?host=${encodeURIComponent(hostOrigin)}&scene=beach3d&scenes=beach3d,light,dark&ui=bubble,outfit,scene,github&heavy=motion&enableLoadingOverlay=1${onboardingParam}`;
    console.log('[XiaoChun Panel] 正在载入小蠢 AI 伴侣:', targetUrl);
    iframe.src = targetUrl;

    // 建立与后台 Node Worker 的实时 SSE 指令接收通道，激活 hasActivePanel 状态
    connectBridgeSse();

    // 4 秒安全兜底浮现输入栏（防止离线或弱网下 postMessage 握手遗失导致输入框永久不显）
    setTimeout(revealChatBar, 4000);

    // 12 秒超时未完成加载显示重试按钮
    setTimeout(showRetry, 12000);
  }

  iframe.onload = () => {
    isFrameLoaded = true;
    hideLoading();
    // 场景载入后延时 1.5 秒平滑浮现底部对话栏 (即使 postMessage 握手遗失也能可靠呈现)
    setTimeout(revealChatBar, 1500);
  };

  btnRetry.onclick = () => {
    btnRetry.classList.remove('show');
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
    initEmbedFrame();
  };

  // 2. 与 /embed 内部的消息通信通道握手
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    // 握手接收: /embed 页面发出 xc.ready
    if (msg.type === 'xc.ready') {
      console.log('[XiaoChun Panel] 收到小蠢 AI 伴侣就绪事件:', msg);
      hideLoading();
      setTimeout(revealChatBar, 500);
      const channel = new MessageChannel();
      handshakePort = channel.port1;

      handshakePort.onmessage = (e) => {
        const ev = e.data;
        console.log('[XiaoChun Panel] 小蠢 AI 伴侣内部事件:', ev);
        if (ev && (ev.type === 'xc.story.complete' || ev.type === 'xc.onboarding.complete')) {
          try {
            localStorage.setItem('xc_cindy_onboarded_v1', '1');
            localStorage.setItem('xc_onboarding_completed_v1', '1');
          } catch (_) {}
          if (chatBarContainer) chatBarContainer.classList.add('ready');
        }
        // 当模型完全加载 (xc.loaded) 或进入待机 (xc.state phase=idle) 时，正式浮现底部对话栏 (若向导已完成)
        if (ev && (ev.type === 'xc.loaded' || ev.payload?.phase === 'idle')) {
          revealChatBar();
        }
      };

      // 回复 xc.init 握手，把 MessagePort 转移给 iframe
      iframe.contentWindow.postMessage(
        { type: 'xc.init', v: 1, payload: { allowedHostOrigins: [window.location.origin] } },
        '*',
        [channel.port2]
      );
    }
  });

  // 协议指令下发辅助
  function sendToXiaochun(type, payload) {
    if (handshakePort) {
      handshakePort.postMessage({ type, v: 1, payload });
    } else if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type, v: 1, payload }, '*');
    }
  }

  // 3. 与 Node Worker 建立持久 SSE 长连接（用于接收 Cindy 工具调用并激活 hasActivePanel 状态）
  let sseInstance = null;
  function connectBridgeSse() {
    if (sseInstance) {
      try { sseInstance.close(); } catch (_) {}
      sseInstance = null;
    }

    try {
      const sseUrl = `http://127.0.0.1:${currentPort}/events`;
      console.log('[XiaoChun Panel] 连接 Node Worker SSE 长连接:', sseUrl);
      sseInstance = new EventSource(sseUrl);

      sseInstance.onopen = () => {
        console.log('[XiaoChun Panel] SSE 长连接已建立，小蠢已就绪接收指令！');
      };

      sseInstance.onmessage = (event) => {
        try {
          if (!event.data || event.data.startsWith(':')) return;
          const msg = JSON.parse(event.data);
          if (msg && msg.method) {
            handleInboundCommand(msg.method, msg.params);
          }
        } catch (err) {
          console.warn('[XiaoChun Panel] 解析 SSE 消息失败:', err);
        }
      };

      sseInstance.onerror = () => {
        try { sseInstance.close(); } catch (_) {}
        sseInstance = null;
        // 3 秒后自动重试重连
        setTimeout(connectBridgeSse, 3000);
      };
    } catch (err) {
      console.warn('[XiaoChun Panel] SSE 连接异常:', err);
    }
  }

  // 4. 监听来自 Cindy 插件主通道的广播（支持 BroadcastChannel 通信）
  let bc = null;
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');
  const iconSend = document.getElementById('icon-send');
  const iconLoading = document.getElementById('icon-loading');
  const tipPill = document.getElementById('companion-tip-pill');
  const tipText = document.getElementById('tip-text');
  const btnCreateTeammate = document.getElementById('btn-create-teammate');
  const btnCloseTip = document.getElementById('btn-close-tip');

  let isSending = false;
  let sendTimeoutTimer = null;

  function setSendingState(sending) {
    isSending = sending;
    if (btnSend) {
      btnSend.disabled = sending;
      if (sending) {
        btnSend.classList.remove('active');
      } else if (chatInput && chatInput.value.trim().length > 0) {
        btnSend.classList.add('active');
      }
    }
    if (chatInput) chatInput.disabled = sending;
    if (iconSend) iconSend.style.display = sending ? 'none' : 'block';
    if (iconLoading) iconLoading.style.display = sending ? 'block' : 'none';

    if (sending) {
      if (sendTimeoutTimer) clearTimeout(sendTimeoutTimer);
      // 15 秒超时强制解挂，防止网络或进程未响应卡死 UI
      sendTimeoutTimer = setTimeout(() => {
        setSendingState(false);
      }, 15000);
    } else {
      if (sendTimeoutTimer) {
        clearTimeout(sendTimeoutTimer);
        sendTimeoutTimer = null;
      }
    }
  }

  // 监听输入实时点亮小蠢珊瑚桃色发送按钮，聚焦时检测伙伴状态
  if (chatInput && btnSend) {
    chatInput.addEventListener('input', () => {
      const hasText = chatInput.value.trim().length > 0;
      btnSend.classList.toggle('active', hasText);
    });
    chatInput.addEventListener('focus', () => {
      if (bc) bc.postMessage({ type: 'check_bot_status' });
    });
  }

  // 绑定底部输入栏提交事件
  if (chatForm && chatInput) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = (chatInput.value || '').trim();
      if (!text || isSending) return;

      console.log('[XiaoChun Panel] 发送用户输入:', text);
      setSendingState(true);

      // 通过 BroadcastChannel 广播给主逻辑 main.js
      if (bc) {
        bc.postMessage({
          type: 'user_chat_input',
          text,
          timestamp: Date.now()
        });
      }

      // 清空输入框并聚焦
      chatInput.value = '';
      if (btnSend) btnSend.classList.remove('active');
    });
  }

  // 绑定一键创建专属伙伴按钮
  if (btnCreateTeammate) {
    btnCreateTeammate.addEventListener('click', () => {
      if (btnCreateTeammate.disabled) return;
      btnCreateTeammate.disabled = true;
      if (tipText) tipText.textContent = '已发送创建指令，Cindy 正在生成小蠢伙伴...';

      if (bc) {
        bc.postMessage({
          type: 'create_companion_request',
          timestamp: Date.now()
        });
      }

      setTimeout(() => {
        if (tipPill) tipPill.classList.add('hidden');
      }, 4000);
    });
  }

  if (btnCloseTip) {
    btnCloseTip.addEventListener('click', () => {
      if (tipPill) tipPill.classList.add('hidden');
      try {
        sessionStorage.setItem('xc_tip_dismissed', '1');
      } catch (_) {}
    });
  }

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('xiaochun_cindy_bridge');
      bc.onmessage = (event) => {
        const data = event.data;
        if (!data) return;

        // 处理伙伴状态回报
        if (data.type === 'bot_status') {
          if (data.hasXiaoChunBot) {
            if (tipPill) tipPill.classList.add('hidden');
          } else {
            const dismissed = sessionStorage.getItem('xc_tip_dismissed');
            if (!dismissed && tipPill) tipPill.classList.remove('hidden');
          }
          return;
        }

        // 处理错误回报
        if (data.type === 'bot_error') {
          setSendingState(false);
          if (tipText) tipText.textContent = data.message || '伙伴响应异常，请检查 Cindy 模型';
          if (tipPill) tipPill.classList.remove('hidden');
          return;
        }

        // 处理回复重置状态
        if (data.type === 'bot_reply_status') {
          if (data.state === 'idle' || data.state === 'speaking') {
            setSendingState(false);
          }
          return;
        }

        handleInboundCommand(data.method || data.action || data.tool, data.params || data.args || data);
      };

      // 视窗挂载后主动询问伙伴状态
      setTimeout(() => {
        bc.postMessage({ type: 'check_bot_status' });
      }, 800);

      // 窗口切回前台时重新核对伙伴状态
      window.addEventListener('focus', () => {
        bc.postMessage({ type: 'check_bot_status' });
      });

      // 当提示条可见时，每 4 秒轮询一次伙伴状态（Cindy 创建成功后无需刷新即可自动隐藏引导）
      setInterval(() => {
        if (tipPill && !tipPill.classList.contains('hidden')) {
          bc.postMessage({ type: 'check_bot_status' });
        }
      }, 4000);
    }
  } catch (err) {
    console.warn('[XiaoChun Panel] BroadcastChannel 不可用:', err);
  }

  // 处理下发给小蠢的命令
  function handleInboundCommand(method, params) {
    console.log('[XiaoChun Panel] 执行指令:', method, params);
    // 收到说话指令时重置输入状态
    if (method === 'speak' || method === 'xiaochun_speak') {
      setSendingState(false);
    }

    params = params || {};
    switch (method) {
      case 'speak':
      case 'xiaochun_speak':
        if (params.expression) sendToXiaochun('xc.expression', { name: params.expression });
        if (params.motion) sendToXiaochun('xc.motion', { name: params.motion });
        sendToXiaochun('xc.say', { text: params.text || '' });
        break;
      case 'motion':
      case 'xiaochun_motion':
        sendToXiaochun('xc.motion', { name: params.name, loop: Boolean(params.loop) });
        break;
      case 'camera':
      case 'xiaochun_camera':
        if (params.action === 'reset' || params.reset) {
          sendToXiaochun('xc.camera', { reset: true });
        } else if (params.action === 'pan_up' || params.panUp) {
          sendToXiaochun('xc.camera', { movement: 'pedestal_up', durationSec: 2.2 });
        } else if (params.shot) {
          sendToXiaochun('xc.camera', { shot: params.shot });
        }
        break;
      case 'scene':
      case 'xiaochun_scene':
        sendToXiaochun('xc.setScene', { id: params.name || params.scene });
        break;
      case 'outfit':
      case 'xiaochun_outfit':
        sendToXiaochun('xc.setOutfit', { id: params.name || params.outfit || params.key });
        break;
      case 'stop':
      case 'xiaochun_stop':
        sendToXiaochun('xc.stop', {});
        break;
      case 'story':
      case 'xiaochun_story':
      case 'onboarding':
      case 'xiaochun_onboarding':
        sendToXiaochun('xc.onboarding.start', {});
        break;
    }
  }

  // 启动加载
  initEmbedFrame();
})();
