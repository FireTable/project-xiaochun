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

  // 1. 获取本地桥接服务端口并载入 3D 视窗
  async function initEmbedFrame() {
    // 主动唤醒小蠢桌面 AI 伴侣进程
    try {
      fetch('/wake').catch(() => {});
    } catch (_) {}

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
    // 纯净伴侣视窗：挂载头顶气泡、换装菜单、换场景菜单与 GitHub 图标，开启原生全屏 LoadingOverlay，交由 Cindy 作为统一对话大脑
    const targetUrl = `http://127.0.0.1:${currentPort}/embed/?host=${encodeURIComponent(hostOrigin)}&scene=beach3d&ui=bubble,outfit,scene,github&heavy=motion&enableLoadingOverlay=1`;
    console.log('[XiaoChun Panel] 正在载入小蠢 AI 伴侣:', targetUrl);
    iframe.src = targetUrl;

    // 建立与后台 Node Worker 的实时 SSE 指令接收通道，激活 hasActivePanel 状态
    connectBridgeSse();

    // 12 秒超时未完成加载显示重试按钮
    setTimeout(showRetry, 12000);
  }

  iframe.onload = () => {
    isFrameLoaded = true;
    hideLoading();
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
      const channel = new MessageChannel();
      handshakePort = channel.port1;

      handshakePort.onmessage = (e) => {
        console.log('[XiaoChun Panel] 小蠢 AI 伴侣内部事件:', e.data);
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
      const sseUrl = `http://127.0.0.1:${currentPort}/sse`;
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
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('xiaochun_cindy_bridge');
      bc.onmessage = (event) => {
        const data = event.data;
        if (!data) return;
        handleInboundCommand(data.method || data.action || data.tool, data.params || data.args || data);
      };
    }
  } catch (err) {
    console.warn('[XiaoChun Panel] BroadcastChannel 不可用:', err);
  }

  // 处理下发给小蠢的命令
  function handleInboundCommand(method, params) {
    console.log('[XiaoChun Panel] 执行指令:', method, params);
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
    }
  }

  // 启动加载
  initEmbedFrame();
})();
