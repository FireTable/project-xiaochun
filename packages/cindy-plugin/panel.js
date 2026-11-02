(function () {
  const iframe = document.getElementById('xiaochun-frame');
  const loadingOverlay = document.getElementById('loading-overlay');
  const btnRetry = document.getElementById('btn-retry');
  const pageTitle = document.getElementById('page-title');
  const tipPill = document.getElementById('companion-tip-pill');
  const tipText = document.getElementById('tip-text');
  const btnCreateTeammate = document.getElementById('btn-create-teammate');
  const btnCloseTip = document.getElementById('btn-close-tip');
  const chatBarContainer = document.getElementById('chat-bar-container');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');
  const iconSend = document.getElementById('icon-send');
  const iconLoading = document.getElementById('icon-loading');

  let currentPort = 23518;
  let isFrameLoaded = false;
  let handshakePort = null;
  let currentLocale = 'zh-CN';
  let hasCompletedOnboarding = false;
  const pendingCommands = [];

  const I18N = {
    'zh-CN': {
      title: '小蠢 AI 伴侣',
      retry: '🔄 重新连接小蠢 AI 伴侣',
      tip_create: '生成专属「小蠢」伙伴',
      tip_add_btn: '立即添加',
      tip_close_aria: '关闭提示',
      tip_creating: '已发送创建指令，Cindy 正在生成小蠢伙伴...',
      input_placeholder: '和温柔可爱的小蠢聊聊天，按 Enter 发送...',
      btn_send_title: '发送',
      btn_send_aria: '发送消息',
      err_bot_response: '伙伴响应异常，请检查 Cindy 模型',
      err_no_bot: '未找到可用的 Cindy 伙伴，请在 Cindy 左侧新建「小蠢」伙伴'
    },
    'en': {
      title: 'XiaoChun AI Companion',
      retry: '🔄 Reconnect XiaoChun AI Companion',
      tip_create: 'Create exclusive "XiaoChun" partner',
      tip_add_btn: 'Add Now',
      tip_close_aria: 'Dismiss tip',
      tip_creating: 'Creation command sent, Cindy is generating XiaoChun partner...',
      input_placeholder: 'Chat with XiaoChun, press Enter to send...',
      btn_send_title: 'Send',
      btn_send_aria: 'Send message',
      err_bot_response: 'Partner response error, please check Cindy model settings',
      err_no_bot: 'No available Cindy partner found, please create XiaoChun partner in Cindy'
    },
    'ja': {
      title: '小蠢 AIパートナー',
      retry: '🔄 小蠢 AIパートナーに再接続',
      tip_create: '専属パートナー「小蠢」を生成',
      tip_add_btn: '今すぐ追加',
      tip_close_aria: 'ヒントを閉じる',
      tip_creating: '作成指示を送信しました。Cindy が小蠢パートナーを生成中...',
      input_placeholder: 'やさしく可愛い小蠢とおしゃべりしよう。Enter で送信...',
      btn_send_title: '送信',
      btn_send_aria: 'メッセージを送信',
      err_bot_response: 'パートナーの応答エラーです。Cindy のモデル設定を確認してください',
      err_no_bot: '利用可能な Cindy パートナーが見つかりません。左側で「小蠢」を作成してください'
    },
    'ko': {
      title: '샤오춘 AI 메이트',
      retry: '🔄 샤오춘 AI 메이트 다시 연결',
      tip_create: '전용 메이트 「샤오춘」 생성',
      tip_add_btn: '지금 추가',
      tip_close_aria: '안내 닫기',
      tip_creating: '생성 명령을 전송했습니다. Cindy가 샤오춘 메이트를 생성 중입니다...',
      input_placeholder: '다정하고 귀여운 샤오춘과 대화해보세요. Enter를 눌러 전송...',
      btn_send_title: '전송',
      btn_send_aria: '메시지 전송',
      err_bot_response: '메이트 응답 오류가 발생했습니다. Cindy 모델 설정을 확인해주세요',
      err_no_bot: '사용 가능한 Cindy 메이트를 찾을 수 없습니다. Cindy 좌측에서 샤오춘 메이트를 추가해주세요'
    }
  };

  function t(key) {
    const dict = I18N[currentLocale] || I18N['zh-CN'];
    return dict[key] || I18N['zh-CN'][key] || key;
  }

  function getEmbedSupportedLang(loc) {
    if (loc && loc.startsWith('zh')) return 'zh-CN';
    if (loc && loc.startsWith('ja')) return 'ja';
    return 'en';
  }

  function applyLocale(locale) {
    if (!I18N[locale]) {
      if (locale && locale.startsWith('zh')) locale = 'zh-CN';
      else if (locale && locale.startsWith('ja')) locale = 'ja';
      else if (locale && locale.startsWith('ko')) locale = 'ko';
      else locale = 'en';
    }
    currentLocale = locale;
    document.documentElement.lang = locale;

    if (pageTitle) pageTitle.textContent = t('title');
    if (btnRetry) btnRetry.textContent = t('retry');
    if (tipText && (!btnCreateTeammate || !btnCreateTeammate.disabled)) {
      tipText.textContent = t('tip_create');
    }
    if (btnCreateTeammate) btnCreateTeammate.textContent = t('tip_add_btn');
    if (btnCloseTip) btnCloseTip.setAttribute('aria-label', t('tip_close_aria'));
    if (chatInput) chatInput.setAttribute('placeholder', t('input_placeholder'));
    if (btnSend) {
      btnSend.setAttribute('title', t('btn_send_title'));
      btnSend.setAttribute('aria-label', t('btn_send_aria'));
    }

    // 动态同步给 Project XiaoChun 伴侣视窗
    const embedLang = getEmbedSupportedLang(locale);
    sendToXiaochun('xc.setConfig', { lang: embedLang });
  }

  async function resolveInitialLocale() {
    let detected = null;
    // 1. 优先尝试读取 Cindy 官方推荐的 /app-context 端点 (带超时保护防死锁)
    try {
      const r = await fetch('/app-context', { signal: AbortSignal.timeout(400) });
      if (r.ok) {
        const data = await r.json();
        if (data && data.context && data.context.locale) {
          detected = data.context.locale;
        } else if (data && data.locale) {
          detected = data.locale;
        }
      }
    } catch (_) {}

    // 2. 尝试 cindy.request 宿主桥接 (带超时保护防死锁)
    if (!detected) {
      try {
        if (typeof window.cindy !== 'undefined' && typeof window.cindy.request === 'function') {
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 400));
          const res = await Promise.race([window.cindy.request({ kind: 'app-context' }), timeoutPromise]);
          if (res && res.context && res.context.locale) {
            detected = res.context.locale;
          }
        }
      } catch (_) {}
    }

    if (!detected) {
      const urlLang = new URLSearchParams(window.location.search).get('lang');
      if (urlLang) detected = urlLang;
      else {
        const nav = (navigator.language || '').toLowerCase();
        if (nav.startsWith('zh')) detected = 'zh-CN';
        else if (nav.startsWith('ja')) detected = 'ja';
        else if (nav.startsWith('ko')) detected = 'ko';
        else detected = 'en';
      }
    }
    applyLocale(detected || 'zh-CN');
  }

  // 监听 Cindy 宿主语言动态变更
  if (typeof window.cindy !== 'undefined' && typeof window.cindy.onHostMessage === 'function') {
    window.cindy.onHostMessage((msg) => {
      if (msg && msg.type === 'host-context-changed') {
        const nextLocale = msg.context?.locale || msg.locale;
        if (nextLocale) {
          console.log('[XiaoChun Panel] 响应宿主语言切换:', nextLocale);
          applyLocale(nextLocale);
        }
      }
    });
  }

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
    currentPort = 23518;
    try {
      const res = await fetch('/bridge-port.json?t=' + Date.now(), { signal: AbortSignal.timeout(600) });
      if (res.ok) {
        const data = await res.json();
        if (data && data.port && typeof data.port === 'number') {
          currentPort = data.port;
        }
        if (data && data.onboardingCompleted === true) {
          hasCompletedOnboarding = true;
        }
      }
    } catch (_) {}

    // 如果 /bridge-port.json 未指示已完成，继续探测 worker 的 /api/companion-state
    if (!hasCompletedOnboarding) {
      try {
        const res2 = await fetch(`http://127.0.0.1:${currentPort}/api/companion-state?t=` + Date.now(), { signal: AbortSignal.timeout(600) });
        if (res2.ok) {
          const s = await res2.json();
          if (s && s.onboardingCompleted === true) {
            hasCompletedOnboarding = true;
          }
        }
      } catch (_) {}
    }

    if (!hasCompletedOnboarding) {
      try {
        hasCompletedOnboarding = localStorage.getItem('xc_onboarding_completed_v1') === '1' || localStorage.getItem('xc_cindy_onboarded_v1') === '1';
      } catch (_) {}
    }

    const hostOrigin = window.location.origin;
    // 若本地文件系统或缓存已记录完成向导，传递 onboarding=0；若未完成，传递 onboarding=auto 允许 iframe 结合自身存储自检
    const onboardingParam = hasCompletedOnboarding ? '&onboarding=0' : '&onboarding=auto';
    const embedLang = getEmbedSupportedLang(currentLocale);

    // 纯净伴侣视窗：挂载头顶气泡、换装菜单、换场景菜单与 GitHub 图标，开启原生全屏 LoadingOverlay，排除透明背景选项（Cindy 视窗背景不透明），交由 Cindy 作为统一对话大脑
    // 不传 scene 参数，确保 onboarding 时角色从纯粹虚空 (void) 完整起步，日常模式回退默认海滩
    const targetUrl = `http://127.0.0.1:${currentPort}/embed/?host=${encodeURIComponent(hostOrigin)}&ui=bubble,outfit,scene,github&heavy=motion&enableLoadingOverlay=1&lang=${encodeURIComponent(embedLang)}${onboardingParam}`;
    console.log('[XiaoChun Panel] 正在载入小蠢 AI 伴侣:', targetUrl);
    iframe.src = targetUrl;

    // 建立与后台 Node Worker 的实时 SSE 指令接收通道，激活 hasActivePanel 状态
    connectBridgeSse();

    // 仅在已完成向导的常态下，开启 4 秒安全兜底浮现输入栏；若处于新手向导中，严格等待 Act 0 完成事件
    if (hasCompletedOnboarding) {
      setTimeout(revealChatBar, 4000);
    }

    // 12 秒超时未完成加载显示重试按钮
    setTimeout(showRetry, 12000);
  }

  iframe.onload = () => {
    isFrameLoaded = true;
    hideLoading();
    // 仅在已完成向导时延时 1.5 秒平滑浮现底部对话栏
    if (hasCompletedOnboarding) {
      setTimeout(revealChatBar, 1500);
    }
  };

  btnRetry.onclick = () => {
    btnRetry.classList.remove('show');
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
    initEmbedFrame();
  };

  // 2. 与 /embed 内部的消息通信通道握手
  window.addEventListener('message', (event) => {
    if (iframe && event.source !== iframe.contentWindow) return;
    const expectedOrigin = `http://127.0.0.1:${currentPort}`;
    if (event.origin !== expectedOrigin && !event.origin.startsWith('http://127.0.0.1:')) return;
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
          hasCompletedOnboarding = true;
          try {
            localStorage.setItem('xc_cindy_onboarded_v1', '1');
            localStorage.setItem('xc_onboarding_completed_v1', '1');
          } catch (_) {}
          // 立即持久化记录至本地文件系统 SSOT，永不反复触发 onboarding
          fetch(`http://127.0.0.1:${currentPort}/api/companion-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ onboardingCompleted: true })
          }).catch(() => {});
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
        expectedOrigin,
        [channel.port2]
      );

      // 握手建立完毕，即刻将积压的消息队列排空下发给小蠢引擎
      while (pendingCommands.length > 0) {
        const item = pendingCommands.shift();
        try {
          handshakePort.postMessage({ type: item.type, v: 1, payload: item.payload });
        } catch (err) {
          console.warn('[XiaoChun Panel] 排空待发指令失败:', err);
        }
      }
    }
  });

  // 协议指令下发辅助
  function sendToXiaochun(type, payload) {
    if (handshakePort) {
      try {
        handshakePort.postMessage({ type, v: 1, payload });
      } catch (err) {
        console.warn('[XiaoChun Panel] postMessage to handshakePort failed:', err);
      }
    } else {
      pendingCommands.push({ type, payload });
      if (iframe && iframe.contentWindow) {
        try {
          const expectedOrigin = `http://127.0.0.1:${currentPort}`;
          iframe.contentWindow.postMessage({ type, v: 1, payload }, expectedOrigin);
        } catch (_) {}
      }
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
          if (msg && msg.method === 'panel_event' && msg.params) {
            handlePanelEvent(msg.params);
          } else if (msg && msg.method) {
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
  let isSending = false;
  let sendTimeoutTimer = null;

  function setSendingState(sending, resetMotion = false) {
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
      // 30 秒超时强制解挂，防止网络或进程未响应卡死 UI，并平滑恢复 idle 待机
      sendTimeoutTimer = setTimeout(() => {
        setSendingState(false, true);
      }, 30000);
    } else {
      if (sendTimeoutTimer) {
        clearTimeout(sendTimeoutTimer);
        sendTimeoutTimer = null;
      }
      if (resetMotion) {
        sendToXiaochun('xc.stop', {});
      }
    }
  }

  function handlePanelEvent(data) {
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
      setSendingState(false, true);
      const localizedMsg = data.errorKey ? (I18N[currentLocale]?.[data.errorKey] || I18N['zh-CN']?.[data.errorKey]) : (data.message || t('err_bot_response'));
      if (tipText) tipText.textContent = localizedMsg;
      if (tipPill) tipPill.classList.remove('hidden');
      return;
    }

    // 处理回复重置状态
    if (data.type === 'bot_reply_status') {
      if (data.state === 'idle') {
        setSendingState(false, true);
      } else if (data.state === 'speaking') {
        setSendingState(false, false);
      }
      return;
    }

    // 处理运行模式变更广播
    if (data.type === 'mode_changed') {
      console.log('[XiaoChun Panel] 响应运行形态变更广播:', data.mode);
      return;
    }

    handleInboundCommand(data.method || data.action || data.tool, data.params || data.args || data);
  }

  function triggerCheckBotStatus() {
    fetch(`http://127.0.0.1:${currentPort}/api/check-bot-status`, { method: 'POST' }).catch(() => {});
    if (bc) {
      try { bc.postMessage({ type: 'check_bot_status' }); } catch (_) {}
    }
  }

  // 监听输入实时点亮小蠢珊瑚桃色发送按钮，聚焦时检测伙伴状态
  if (chatInput && btnSend) {
    chatInput.addEventListener('input', () => {
      const hasText = chatInput.value.trim().length > 0;
      btnSend.classList.toggle('active', hasText);
    });
    chatInput.addEventListener('focus', () => {
      sendToXiaochun('xc.resume', {});
      triggerCheckBotStatus();
    });
  }

  // 用户在宿主面板发生任何交互（点击/触摸/按键）时，主动同步通知伴侣视窗解冻 Web Audio 上下文
  window.addEventListener('pointerdown', () => sendToXiaochun('xc.resume', {}), { passive: true });
  window.addEventListener('keydown', () => sendToXiaochun('xc.resume', {}), { passive: true });

  // 绑定底部输入栏提交事件
  if (chatForm && chatInput) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = (chatInput.value || '').trim();
      if (!text || isSending) return;

      console.log('[XiaoChun Panel] 发送用户输入:', text);
      setSendingState(true);

      // 1. 唤醒并解冻伴侣视窗的 Web Audio 上下文
      sendToXiaochun('xc.resume', {});

      // 2. 触发 thinking 状态与 thinking 动作组（对齐 speakText / say 思考管线）
      sendToXiaochun('xc.think', {});
      sendToXiaochun('xc.motion', { group: 'thinking', loop: true, mask: 'upperBody' });

      // 3. 通过本地 HTTP 桥接派发至 Node Worker -> Cindy main.js (主通道，跨进程稳定)
      fetch(`http://127.0.0.1:${currentPort}/api/chat-input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          locale: currentLocale,
          timestamp: Date.now()
        })
      }).catch(err => {
        console.warn('[XiaoChun Panel] HTTP chat-input 发送异常:', err);
      });

      // 4. 通过 BroadcastChannel 同步广播 (同域多开备用通道)
      if (bc) {
        try {
          bc.postMessage({
            type: 'user_chat_input',
            text,
            locale: currentLocale,
            timestamp: Date.now()
          });
        } catch (_) {}
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
      if (tipText) tipText.textContent = t('tip_creating');

      // 创建专属伙伴期间让小蠢同步进入专注思考姿态
      sendToXiaochun('xc.resume', {});
      sendToXiaochun('xc.think', {});
      sendToXiaochun('xc.motion', { group: 'thinking', loop: true, mask: 'upperBody' });

      // HTTP 桥接主通道
      fetch(`http://127.0.0.1:${currentPort}/api/create-companion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locale: currentLocale,
          timestamp: Date.now()
        })
      }).catch(err => {
        console.warn('[XiaoChun Panel] HTTP create-companion 发送异常:', err);
      });

      if (bc) {
        try {
          bc.postMessage({
            type: 'create_companion_request',
            locale: currentLocale,
            timestamp: Date.now()
          });
        } catch (_) {}
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
        handlePanelEvent(event.data);
      };

      // 视窗挂载后主动询问伙伴状态
      setTimeout(() => {
        triggerCheckBotStatus();
      }, 800);

      // 窗口切回前台时重新核对伙伴状态
      window.addEventListener('focus', () => {
        triggerCheckBotStatus();
      });

      // 当提示条可见时，每 4 秒轮询一次伙伴状态（Cindy 创建成功后无需刷新即可自动隐藏引导）
      setInterval(() => {
        if (tipPill && !tipPill.classList.contains('hidden')) {
          triggerCheckBotStatus();
        }
      }, 4000);
    }
  } catch (err) {
    console.warn('[XiaoChun Panel] BroadcastChannel 不可用:', err);
  }

  // 处理下发给小蠢的命令
  function handleInboundCommand(method, params) {
    console.log('[XiaoChun Panel] 执行指令:', method, params);
    // 收到说话指令时重置输入状态，但不打断思考动作，由 xc.say 优雅承接与交接
    if (method === 'speak' || method === 'xiaochun_speak') {
      setSendingState(false, false);
    }

    params = params || {};
    switch (method) {
      case 'speak':
      case 'xiaochun_speak':
        sendToXiaochun('xc.resume', {});
        sendToXiaochun('xc.say', {
          text: params.text || '',
          motion: params.motion,
          expression: params.expression,
          preserveMotion: Boolean(params.motion),
        });
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

  // 初始化语言并启动加载 (确保无论 initLocale 成功还是失败，均能无阻碍拉起视窗)
  void resolveInitialLocale().catch((err) => {
    console.warn('[XiaoChun Panel] 解析语言失败，使用默认 zh-CN:', err);
  }).finally(() => {
    initEmbedFrame();
  });
})();
