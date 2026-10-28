/**
 * Project XiaoChun — SDK & Window Protocol Capability Test Harness
 *
 * 用法:
 *   1. 启动项目: pnpm dev 或 pnpm tauri:dev
 *   2. 打开浏览器控制台 (DevTools: F12 / Cmd+Opt+I)
 *   3. 复制本脚本全文粘贴至 Console 回车，即可在页面右上角生成半透明浮动交互测试面板 (HUD)！
 */

(function initXiaoChunSdkTester() {
  // 1. 检查运行环境
  if (typeof window === 'undefined') {
    console.error('[XiaoChun-Tester] 必须在浏览器或 Webview 环境中运行');
    return;
  }

  const xc = window.xiaochun;
  const vrm = window.vrmEngine;

  if (!xc || !vrm) {
    console.error(
      '[XiaoChun-Tester] 未检测到 window.xiaochun 或 window.vrmEngine！\n' +
      '请确保主应用已加载完毕 (非 /embed 独立页面)。'
    );
    return;
  }

  // 避免重复挂载
  const existingPanel = document.getElementById('xc-sdk-tester-hud');
  if (existingPanel) {
    existingPanel.remove();
  }

  // 2. 状态仓与日志
  const state = {
    currentAction: '就绪 (Idle)',
    currentTurnState: vrm.turnState || 'idle',
    currentMotion: '自然待机 (NaturalIdle)',
    currentExpression: 'neutral',
    currentCamera: '默认自由机位 (Medium)',
    isRunningTour: false,
    logs: [],
  };

  function addLog(msg, type = 'info') {
    const time = new Date().toLocaleTimeString();
    state.logs.unshift({ time, msg, type });
    if (state.logs.length > 30) state.logs.pop();
    console.log(`%c[XiaoChun SDK] ${time} ${msg}`, type === 'warn' ? 'color: #f59e0b;' : type === 'success' ? 'color: #10b981; font-weight: bold;' : 'color: #38bdf8;');
    renderLogs();
  }

  // 3. 构建浮动 Bento HUD 界面
  const hud = document.createElement('div');
  hud.id = 'xc-sdk-tester-hud';
  hud.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: 380px;
    max-height: 90vh;
    background: rgba(15, 20, 35, 0.88);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 20px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.65), 0 0 24px rgba(234, 131, 119, 0.15);
    color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    z-index: 999999;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    user-select: none;
    box-sizing: border-box;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  hud.innerHTML = `
    <!-- Header -->
    <div id="xc-hud-header" style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.04);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      cursor: move;
    ">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span id="xc-live-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
        <span style="font-weight: 700; font-size: 13px; letter-spacing: 0.5px; background: linear-gradient(135deg, #f87171, #fb923c); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">XiaoChun SDK Tester</span>
      </div>
      <div style="display: flex; gap: 6px;">
        <button id="xc-btn-min" style="background: rgba(255,255,255,0.08); border: none; border-radius: 6px; width: 22px; height: 22px; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px;">_</button>
        <button id="xc-btn-close" style="background: rgba(255,255,255,0.08); border: none; border-radius: 6px; width: 22px; height: 22px; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 13px;">✕</button>
      </div>
    </div>

    <!-- Body Container -->
    <div id="xc-hud-body" style="padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto;">

      <!-- Live Status Bento -->
      <div style="
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 10px 12px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        font-size: 11px;
      ">
        <div>
          <div style="color: #64748b; font-size: 10px; margin-bottom: 2px;">交互状态 (TurnState)</div>
          <span id="xc-val-turn" style="font-weight: 600; color: #38bdf8; padding: 1px 6px; border-radius: 4px; background: rgba(56, 189, 248, 0.15);">idle</span>
        </div>
        <div>
          <div style="color: #64748b; font-size: 10px; margin-bottom: 2px;">面部表情 (Expression)</div>
          <span id="xc-val-expr" style="font-weight: 600; color: #f472b6; padding: 1px 6px; border-radius: 4px; background: rgba(244, 114, 182, 0.15);">neutral</span>
        </div>
        <div>
          <div style="color: #64748b; font-size: 10px; margin-bottom: 2px;">当前动作 (Motion)</div>
          <span id="xc-val-motion" style="font-weight: 600; color: #34d399; padding: 1px 6px; border-radius: 4px; background: rgba(52, 211, 153, 0.15); display: inline-block; max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">standby</span>
        </div>
        <div>
          <div style="color: #64748b; font-size: 10px; margin-bottom: 2px;">镜头景别 (Camera)</div>
          <span id="xc-val-camera" style="font-weight: 600; color: #fbbf24; padding: 1px 6px; border-radius: 4px; background: rgba(251, 191, 36, 0.15); display: inline-block; max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">medium</span>
        </div>
      </div>

      <!-- Action Status Banner -->
      <div id="xc-status-banner" style="
        background: linear-gradient(135deg, rgba(234, 131, 119, 0.12), rgba(243, 208, 154, 0.08));
        border: 1px solid rgba(234, 131, 119, 0.25);
        border-radius: 10px;
        padding: 8px 12px;
        font-size: 11px;
        color: #fca5a5;
        display: flex;
        align-items: center;
        gap: 8px;
      ">
        <span style="font-size: 14px;">⚡</span>
        <span id="xc-status-text" style="font-weight: 500; flex: 1;">准备就绪，点击下方按钮测试各项能力</span>
      </div>

      <!-- 1-Click Auto Tour Button -->
      <button id="xc-btn-tour" style="
        background: linear-gradient(135deg, #ea8377, #f97316);
        border: none;
        border-radius: 10px;
        padding: 9px 14px;
        color: #ffffff;
        font-weight: 700;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        box-shadow: 0 4px 14px rgba(234, 131, 119, 0.35);
        transition: transform 0.15s, opacity 0.15s;
      ">
        <span>🚀 启动全能力电影级巡礼演示 (Auto Tour)</span>
      </button>

      <!-- Manual Test Button Matrix -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">手动交互测试 (Manual Triggers)</div>

        <!-- Row 1: Speech & Stop -->
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 6px;">
          <button id="xc-btn-speak" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 7px; color: #f1f5f9; cursor: pointer; font-size: 11px; text-align: left;">🗣️ 说话 (Speak)</button>
          <button id="xc-btn-stop" style="background: rgba(239, 68, 68, 0.18); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 8px; padding: 7px; color: #fca5a5; cursor: pointer; font-size: 11px; font-weight: 600;">⏹️ 停止</button>
        </div>

        <!-- Row 2: Motions -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">
          <button id="xc-btn-m-wave" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px; color: #e2e8f0; cursor: pointer; font-size: 11px;">👋 挥手 (Wave)</button>
          <button id="xc-btn-m-jump" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px; color: #e2e8f0; cursor: pointer; font-size: 11px;">✨ 惊跳 (Jump)</button>
          <button id="xc-btn-m-heart" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px; color: #e2e8f0; cursor: pointer; font-size: 11px;">💖 比心 (Heart)</button>
        </div>

        <!-- Row 3: Motion Groups -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">
          <button id="xc-btn-g-cute" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px; color: #e2e8f0; cursor: pointer; font-size: 11px;">🎲 卖萌组</button>
          <button id="xc-btn-g-greet" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px; color: #e2e8f0; cursor: pointer; font-size: 11px;">🎲 问候组</button>
          <button id="xc-btn-g-dance" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px; color: #e2e8f0; cursor: pointer; font-size: 11px;">💃 舞蹈组</button>
        </div>

        <!-- Row 4: Expressions -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">
          <button id="xc-btn-e-smile" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px; color: #e2e8f0; cursor: pointer; font-size: 11px;">😊 温柔浅笑</button>
          <button id="xc-btn-e-shy" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px; color: #e2e8f0; cursor: pointer; font-size: 11px;">😳 羞涩低回</button>
          <button id="xc-btn-e-play" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px; color: #e2e8f0; cursor: pointer; font-size: 11px;">😜 俏皮灵动</button>
        </div>

        <!-- Row 5: Camera Controls -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 5px;">
          <button id="xc-btn-c-close" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px 4px; color: #fbbf24; cursor: pointer; font-size: 10px;">🎥 特写推近</button>
          <button id="xc-btn-c-full" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px 4px; color: #fbbf24; cursor: pointer; font-size: 10px;">🎥 全景+45°</button>
          <button id="xc-btn-c-panup" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px 4px; color: #fbbf24; cursor: pointer; font-size: 10px;">🎥 裙摆升降</button>
          <button id="xc-btn-c-reset" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px 4px; color: #94a3b8; cursor: pointer; font-size: 10px;">🔄 镜头复位</button>
        </div>
      </div>

      <!-- Real-Time Event Log Terminal -->
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">实时调度日志 (Logs)</span>
          <span id="xc-btn-clear-log" style="font-size: 10px; color: #94a3b8; cursor: pointer;">清空</span>
        </div>
        <div id="xc-log-terminal" style="
          background: rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          height: 110px;
          overflow-y: auto;
          padding: 6px 8px;
          font-family: ui-monospace, Menlo, Monaco, Consolas, monospace;
          font-size: 10px;
          line-height: 1.4;
          display: flex;
          flex-direction: column-reverse;
          gap: 3px;
        "></div>
      </div>
    </div>
  `;

  document.body.appendChild(hud);

  // 4. DOM 引用与实时渲染
  const valTurn = document.getElementById('xc-val-turn');
  const valExpr = document.getElementById('xc-val-expr');
  const valMotion = document.getElementById('xc-val-motion');
  const valCamera = document.getElementById('xc-val-camera');
  const statusText = document.getElementById('xc-status-text');
  const logTerminal = document.getElementById('xc-log-terminal');
  const liveDot = document.getElementById('xc-live-dot');

  function renderLogs() {
    if (!logTerminal) return;
    logTerminal.innerHTML = state.logs
      .slice(0, 15)
      .map((l) => `<div style="color: ${l.type === 'warn' ? '#f59e0b' : l.type === 'success' ? '#34d399' : '#94a3b8'};"><span style="opacity:0.4;">[${l.time}]</span> ${l.msg}</div>`)
      .join('');
  }

  function setStatus(text, motion = null, expr = null, cam = null) {
    if (statusText) statusText.innerText = text;
    if (motion) {
      state.currentMotion = motion;
      if (valMotion) valMotion.innerText = motion;
    }
    if (expr) {
      state.currentExpression = expr;
      if (valExpr) valExpr.innerText = expr;
    }
    if (cam) {
      state.currentCamera = cam;
      if (valCamera) valCamera.innerText = cam;
    }
  }

  // 定时高频轮询更新底层实时状态
  const pollTimer = setInterval(() => {
    if (vrm) {
      const turn = vrm.turnState || 'idle';
      state.currentTurnState = turn;
      if (valTurn) {
        valTurn.innerText = turn;
        valTurn.style.color = turn === 'speaking' ? '#f43f5e' : turn === 'thinking' ? '#fbbf24' : '#38bdf8';
      }
      if (vrm.manualExpression && valExpr) {
        valExpr.innerText = vrm.manualExpression;
      }
    }
  }, 200);

  // 5. 拖拽与折叠交互
  const header = document.getElementById('xc-hud-header');
  let isDragging = false, startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = hud.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    hud.style.right = 'auto';
    hud.style.left = `${initialLeft}px`;
    hud.style.top = `${initialTop}px`;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    hud.style.left = `${Math.max(10, initialLeft + dx)}px`;
    hud.style.top = `${Math.max(10, initialTop + dy)}px`;
  });

  window.addEventListener('mouseup', () => { isDragging = false; });

  const btnMin = document.getElementById('xc-btn-min');
  const hudBody = document.getElementById('xc-hud-body');
  let isMinimized = false;
  btnMin.addEventListener('click', () => {
    isMinimized = !isMinimized;
    hudBody.style.display = isMinimized ? 'none' : 'flex';
    btnMin.innerText = isMinimized ? '□' : '_';
  });

  document.getElementById('xc-btn-close').addEventListener('click', () => {
    clearInterval(pollTimer);
    hud.remove();
    console.log('[XiaoChun-Tester] 面板已关闭');
  });

  document.getElementById('xc-btn-clear-log').addEventListener('click', () => {
    state.logs = [];
    renderLogs();
  });

  // 6. 全自动电影级巡礼演示 (Auto Tour)
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function runAutoTour() {
    if (state.isRunningTour) return;
    state.isRunningTour = true;
    const tourBtn = document.getElementById('xc-btn-tour');
    tourBtn.style.opacity = '0.5';
    tourBtn.innerText = '⏳ 正在演示全流程剧场中...';

    try {
      addLog('🎬 [Tour] 开始全流程全能力演练...', 'success');

      // 阶段 1: 镜头推近特写 + 浅笑表情 + 问候语音
      setStatus('阶段 1: 运镜推近 + 温柔浅笑 + 语音问候', 'waving', 'gentle_smile', 'close_up (push_in)');
      addLog('阶段 1: window.xiaochun.camera("close_up", { movement: "push_in" })');
      await xc.camera('close_up', { movement: 'push_in', durationSec: 1.5 });
      await xc.expression('gentle_smile', 0.9);
      await xc.motion('waving');
      addLog('阶段 1: window.xiaochun.speak(...)');
      await xc.speak('主人好呀！小春的动作组、表情和电影级镜头调度已经全部就绪啦！');
      await sleep(1000);

      // 阶段 2: 娇羞卖萌动作组 + 俏皮表情
      setStatus('阶段 2: 娇羞卖萌动作组 (praiseCute) + 俏皮表情', 'praiseCute (random)', 'playful', 'close_up');
      addLog('阶段 2: window.xiaochun.expression("playful", 0.95)');
      await xc.expression('playful', 0.95);
      addLog('阶段 2: window.xiaochun.motionGroup("praiseCute")');
      await xc.motionGroup('praiseCute');
      await xc.speak('看我给你比个可爱的卖萌动作组！');
      await sleep(2500);

      // 阶段 3: 电影级自下而上打量升降运镜 (panUp)
      setStatus('阶段 3: 电影级裙摆升降打量 (panUp 2.2s)', 'elegantStand', 'happy', 'panUp (pedestal)');
      addLog('阶段 3: window.xiaochun.camera.panUp(2.2)');
      await xc.expression('happy', 0.85);
      await xc.camera.panUp(2.2);
      await xc.speak('我的镜头还会自裙摆与脚踝自下而上缓缓打量哦，是不是很有电影感？');
      await sleep(1500);

      // 阶段 4: 全景全身展示 + 45 度环绕机位 + 华丽舞蹈组
      setStatus('阶段 4: 全景全身 (full) + 45° 环绕 + 舞蹈表演组', 'dancePerformance', 'gentle_smile', 'full (orbit: 45°)');
      addLog('阶段 4: window.xiaochun.camera("full", { orbitAngleDeg: 45, durationSec: 1.8 })');
      await xc.camera('full', { orbitAngleDeg: 45, durationSec: 1.8 });
      addLog('阶段 4: window.xiaochun.motionGroup("dancePerformance")');
      await xc.motionGroup('dancePerformance');
      await xc.speak('现在是全景全身环绕视角，小春为你献上一小段舞蹈！');
      await sleep(3500);

      // 阶段 5: 微距面部特写 + 害羞微表情
      setStatus('阶段 5: 面部微距特写 (extreme_close_up) + 羞怯微表情', 'shyBehindBack', 'shy', 'extreme_close_up');
      addLog('阶段 5: window.xiaochun.camera("extreme_close_up", { movement: "push_in", durationSec: 1.2 })');
      await xc.camera('extreme_close_up', { movement: 'push_in', durationSec: 1.2 });
      await xc.expression('shy', 0.9);
      await xc.speak('悄悄靠近一点点……主人辛苦啦，小春一直在身边陪着你哦。');
      await sleep(2000);

      // 阶段 6: 镜头平滑复位 + 自然归位
      setStatus('阶段 6: 镜头复位 (reset) + 表情回归自然', 'NaturalIdle', 'neutral', 'medium (free)');
      addLog('阶段 6: window.xiaochun.camera.reset() & expression("neutral")');
      await xc.camera.reset();
      await xc.expression('neutral');
      await xc.speak('演示完成！镜头已经交还给你自由旋转与缩放啦。');
      addLog('🎉 [Tour] 全流程演示圆满结束！', 'success');
      setStatus('全流程演示完成，已交还自由控制权', 'NaturalIdle', 'neutral', 'medium (free)');
    } catch (err) {
      addLog(`❌ [Tour Error] ${err.message || err}`, 'warn');
    } finally {
      state.isRunningTour = false;
      tourBtn.style.opacity = '1';
      tourBtn.innerText = '🚀 重新启动电影级巡礼演示 (Auto Tour)';
    }
  }

  document.getElementById('xc-btn-tour').addEventListener('click', runAutoTour);

  // 7. 单项交互按钮绑定
  document.getElementById('xc-btn-speak').addEventListener('click', async () => {
    const text = '主人，这是一句直接通过 window.xiaochun.speak 触发的测试台词！';
    addLog(`执行 speak("${text.slice(0, 18)}...")`);
    setStatus(`说话中: ${text.slice(0, 16)}...`);
    await xc.speak(text);
  });

  document.getElementById('xc-btn-stop').addEventListener('click', async () => {
    addLog('执行 stop() 紧急停播');
    setStatus('立即停播并回归待机', 'NaturalIdle', 'neutral');
    await xc.stop();
  });

  document.getElementById('xc-btn-m-wave').addEventListener('click', async () => {
    addLog('执行 motion("waving")');
    setStatus('播放动作: 挥手 (waving)', 'waving');
    await xc.motion('waving');
  });

  document.getElementById('xc-btn-m-jump').addEventListener('click', async () => {
    addLog('执行 motion("joyfulJump")');
    setStatus('播放动作: 惊喜惊跳 (joyfulJump)', 'joyfulJump');
    await xc.motion('joyfulJump');
  });

  document.getElementById('xc-btn-m-heart').addEventListener('click', async () => {
    addLog('执行 motion("handHeart")');
    setStatus('播放动作: 双手比心 (handHeart)', 'handHeart');
    await xc.motion('handHeart');
  });

  document.getElementById('xc-btn-g-cute').addEventListener('click', async () => {
    addLog('执行 motionGroup("praiseCute")');
    setStatus('动作组随机抽取: 娇羞卖萌组', 'praiseCute (抽选)');
    await xc.motionGroup('praiseCute');
  });

  document.getElementById('xc-btn-g-greet').addEventListener('click', async () => {
    addLog('执行 motionGroup("greeting")');
    setStatus('动作组随机抽取: 礼貌问候组', 'greeting (抽选)');
    await xc.motionGroup('greeting');
  });

  document.getElementById('xc-btn-g-dance').addEventListener('click', async () => {
    addLog('执行 motionGroup("dancePerformance")');
    setStatus('动作组随机抽取: 舞蹈表演组', 'dancePerformance (抽选)');
    await xc.motionGroup('dancePerformance');
  });

  document.getElementById('xc-btn-e-smile').addEventListener('click', async () => {
    addLog('执行 expression("gentle_smile", 0.9)');
    setStatus('切换表情: 温柔浅笑 (gentle_smile)', null, 'gentle_smile (0.9)');
    await xc.expression('gentle_smile', 0.9);
  });

  document.getElementById('xc-btn-e-shy').addEventListener('click', async () => {
    addLog('执行 expression("shy", 0.95)');
    setStatus('切换表情: 羞涩低回 (shy)', null, 'shy (0.95)');
    await xc.expression('shy', 0.95);
  });

  document.getElementById('xc-btn-e-play').addEventListener('click', async () => {
    addLog('执行 expression("playful", 0.9)');
    setStatus('切换表情: 俏皮灵动 (playful)', null, 'playful (0.9)');
    await xc.expression('playful', 0.9);
  });

  document.getElementById('xc-btn-c-close').addEventListener('click', async () => {
    addLog('执行 camera("close_up", { movement: "push_in" })');
    setStatus('运镜过渡: 半身特写 + 斯坦尼康推近', null, null, 'close_up (push_in)');
    await xc.camera('close_up', { movement: 'push_in', durationSec: 1.5 });
  });

  document.getElementById('xc-btn-c-full').addEventListener('click', async () => {
    addLog('执行 camera("full", { orbitAngleDeg: 45 })');
    setStatus('运镜过渡: 全身大景 + 侧方 45° 环绕', null, null, 'full (orbit: 45°)');
    await xc.camera('full', { orbitAngleDeg: 45, durationSec: 1.8 });
  });

  document.getElementById('xc-btn-c-panup').addEventListener('click', async () => {
    addLog('执行 camera.panUp(2.2)');
    setStatus('运镜过渡: 电影级自下而上打量升降', null, null, 'panUp (2.2s)');
    await xc.camera.panUp(2.2);
  });

  document.getElementById('xc-btn-c-reset').addEventListener('click', async () => {
    addLog('执行 camera.reset()');
    setStatus('镜头机位复位并交还自由控制', null, null, 'medium (free)');
    await xc.camera.reset();
  });

  addLog('✨ XiaoChun SDK 测试控制台已成功加载并挂载到页面右上角！', 'success');
  addLog('支持直接点击按钮或在控制台调用 window.xiaochun.*');
})();
