#!/usr/bin/env node
/**
 * cindy-cdp-onboarding.mjs — 通过 Chrome DevTools Protocol (CDP) 让 Cindy 内嵌的小蠢伴侣重新进入新手引导 (Act 0 序章)
 *
 * 前置要求:
 *   Cindy 需携带调试端口启动:
 *   killall Cindy && open -a /Applications/Cindy.app --args --remote-debugging-port=9222
 *
 * 用法:
 *   node scripts/cindy-cdp-onboarding.mjs
 */

const CDP_PORT = process.env.CDP_PORT || 9222;
const CDP_BASE = `http://127.0.0.1:${CDP_PORT}`;

async function main() {
  console.log(`🔍 正在连接 Cindy CDP 调试端口: ${CDP_BASE}...`);

  let targets;
  try {
    const res = await fetch(`${CDP_BASE}/json/list`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    targets = await res.json();
  } catch (err) {
    console.error(`\n❌ 无法连接到 Cindy CDP 端口 (${CDP_BASE})。`);
    console.error(`原因: 当前运行的 Cindy 进程未携带 --remote-debugging-port=${CDP_PORT} 参数。`);
    console.error(`\n👉 请在终端执行以下命令重新启动 Cindy 开启调试模式:`);
    console.error(`   killall Cindy && open -a /Applications/Cindy.app --args --remote-debugging-port=${CDP_PORT}\n`);
    process.exit(1);
  }

  console.log(`📋 检测到 ${targets.length} 个页面/视图目标:`);
  for (const t of targets) {
    console.log(`   - [${t.type}] ${t.title || '(无标题)'} -> ${t.url}`);
  }

  // 1. 优先寻找 /embed 伴侣内核 iframe
  let embedTarget = targets.find(t => t.url && t.url.includes('/embed'));
  // 2. 若 iframe 未以独立 target 呈现，寻找 panel.html
  let panelTarget = targets.find(t => t.url && t.url.includes('xiaochun-companion') && t.url.includes('panel.html'));

  const chosenTarget = embedTarget || panelTarget;
  if (!chosenTarget || !chosenTarget.webSocketDebuggerUrl) {
    console.error('\n⚠️ 未找到小蠢伴侣相关的页面目标 (需先在 Cindy 中打开小蠢插件或侧边栏)。');
    process.exit(1);
  }

  console.log(`\n🎯 命中目标: [${chosenTarget.type}] ${chosenTarget.url}`);
  console.log(`🔌 正在连接 WebSocket: ${chosenTarget.webSocketDebuggerUrl}...`);

  const ws = new WebSocket(chosenTarget.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
    setTimeout(() => reject(new Error('WebSocket 连接超时')), 3000);
  });

  console.log('✅ WebSocket 握手成功，正在派发新手引导触发指令...');

  let msgId = 1;
  function sendCdp(method, params = {}) {
    return new Promise((resolve) => {
      const id = msgId++;
      const handler = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.id === id) {
            ws.removeEventListener('message', handler);
            resolve(data.result);
          }
        } catch (_) {}
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // 执行上下文脚本
  const isEmbed = Boolean(chosenTarget.url && chosenTarget.url.includes('/embed'));
  const scriptToEval = isEmbed
    ? `(() => {
        try {
          localStorage.removeItem('xc_onboarding_completed_v1');
          localStorage.removeItem('xc_cindy_onboarded_v1');
        } catch (_) {}
        window.dispatchEvent(new CustomEvent('xc-trigger-onboarding'));
        return { ok: true, target: 'embed-iframe', location: window.location.href };
      })()`
    : `(() => {
        try {
          localStorage.removeItem('xc_onboarding_completed_v1');
          localStorage.removeItem('xc_cindy_onboarded_v1');
        } catch (_) {}
        if (typeof sendToXiaochun === 'function') {
          sendToXiaochun('xc.onboarding.start', {});
          return { ok: true, target: 'panel-bridge', location: window.location.href };
        }
        const iframe = document.getElementById('xiaochun-frame');
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.dispatchEvent(new CustomEvent('xc-trigger-onboarding'));
          return { ok: true, target: 'panel-iframe-dispatch', location: window.location.href };
        }
        return { ok: false, error: '未找到通信通道' };
      })()`;

  // 若同时检测到 panelTarget，顺带向其通知隐藏输入栏以保证全屏纯净感
  if (panelTarget && panelTarget.webSocketDebuggerUrl) {
    try {
      const panelWs = new WebSocket(panelTarget.webSocketDebuggerUrl);
      await new Promise(r => panelWs.onopen = r);
      panelWs.send(JSON.stringify({
        id: 999,
        method: 'Runtime.evaluate',
        params: {
          expression: `(() => {
            const bar = document.getElementById('chat-bar-container');
            if (bar) bar.classList.remove('ready');
          })()`
        }
      }));
      setTimeout(() => { try { panelWs.close(); } catch (_) {} }, 500);
    } catch (_) {}
  }

  const evalRes = await sendCdp('Runtime.evaluate', {
    expression: scriptToEval,
    returnByValue: true
  });

  console.log('\n🎉 执行结果:', JSON.stringify(evalRes?.result?.value ?? evalRes, null, 2));
  console.log('✨ 小蠢伴侣已成功切换至虚空序章并重新进入新手引导 (Act 0)！');

  ws.close();
}

main().catch(err => {
  console.error('❌ 执行失败:', err);
  process.exit(1);
});
