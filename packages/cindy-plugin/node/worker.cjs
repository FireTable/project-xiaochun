// node/worker.cjs - 小蠢 AI 伴侣 (Node.js 运行时宿主与系统桥接进程)

const readline = require('node:readline');
const { exec, execFile, execFileSync, execSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');

// 统一标准输出 JSON-RPC 响应，日志仅允许输出到 stderr
function reply(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function log(...args) {
  process.stderr.write(`[XiaoChun-Worker] ${args.join(' ')}\n`);
}

// ── 插件二级命名空间存储目录：~/.cindy/plugins/xiaochun-companion/ ──
function getPluginDataDir() {
  const cindyDir = path.join(os.homedir(), '.cindy');
  const baseDir = fs.existsSync(cindyDir)
    ? path.join(cindyDir, 'plugins', 'xiaochun-companion')
    : path.join(os.tmpdir(), 'cindy-plugins', 'xiaochun-companion');
  try {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
  } catch (_) {}
  return baseDir;
}

// 自动平滑迁移老目录中的历史文件（若存在），并彻底清理旧根目录平铺文件
function migrateLegacyStorageOnce() {
  try {
    const cindyDir = path.join(os.homedir(), '.cindy');
    if (!fs.existsSync(cindyDir)) return;
    const dataDir = getPluginDataDir();

    // 1. 迁移或清理老配置 xiaochun-plugin-config.json -> config.json
    const legacyCfg = path.join(cindyDir, 'xiaochun-plugin-config.json');
    const newCfg = path.join(dataDir, 'config.json');
    if (fs.existsSync(legacyCfg)) {
      if (!fs.existsSync(newCfg)) {
        try { fs.copyFileSync(legacyCfg, newCfg); } catch (_) {}
      }
      try { fs.unlinkSync(legacyCfg); } catch (_) {}
    }

    // 2. 迁移或清理老状态 xiaochun-companion-state.json -> state.json
    const legacyState = path.join(cindyDir, 'xiaochun-companion-state.json');
    const newState = path.join(dataDir, 'state.json');
    if (fs.existsSync(legacyState)) {
      if (!fs.existsSync(newState)) {
        try { fs.copyFileSync(legacyState, newState); } catch (_) {}
      }
      try { fs.unlinkSync(legacyState); } catch (_) {}
    }

    // 3. 彻底删除老缓存目录 ~/.cindy/xiaochun-cache
    const legacyCache = path.join(cindyDir, 'xiaochun-cache');
    if (fs.existsSync(legacyCache)) {
      try { fs.rmSync(legacyCache, { recursive: true, force: true }); } catch (_) {}
    }
  } catch (_) {}
}

migrateLegacyStorageOnce();

// ── 插件形态配置持久化 (desktop: 独立桌面桌宠 / embed: Cindy 内嵌视窗 / auto: 自动识别) ──
function getConfigFilePath() {
  return path.join(getPluginDataDir(), 'config.json');
}

function readPluginConfig() {
  try {
    const p = getConfigFilePath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return { preferredMode: 'embed', ...parsed };
    }
  } catch {}
  return { preferredMode: 'embed' };
}

function savePluginConfig(patch) {
  try {
    const p = getConfigFilePath();
    const cur = readPluginConfig();
    const next = { ...cur, ...patch };
    fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf-8');
    return next;
  } catch (err) {
    log('保存插件配置失败:', err.message);
    return patch;
  }
}

// ── 伴侣运行时状态持久化 (新手向导、场景、服装，作为本地唯一真理源 SSOT) ──
function getCompanionStatePath() {
  return path.join(getPluginDataDir(), 'state.json');
}

function readCompanionState() {
  let state = {
    onboardingCompleted: false,
    onboardingActive: false,
    currentScene: 'beach3d',
    currentOutfit: null
  };

  try {
    const p = getCompanionStatePath();
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      state = { ...state, ...parsed };
    }
  } catch {}

  if (!state.onboardingCompleted) {
    try {
      const cfg = readPluginConfig();
      if (cfg && cfg.onboardingCompleted) {
        state.onboardingCompleted = true;
      }
    } catch {}
  }

  if (!state.onboardingCompleted) {
    try {
      const rt = readRuntimeState();
      if (rt && rt.onboardingCompleted) {
        state.onboardingCompleted = true;
        if (rt.currentScene) state.currentScene = rt.currentScene;
        if (rt.currentOutfit) state.currentOutfit = rt.currentOutfit;
      }
    } catch {}
  }

  return state;
}

function writeBridgePortFile() {
  if (bridgePort <= 0) return;
  const companionState = readCompanionState();
  const cfg = readPluginConfig();
  const portData = JSON.stringify({
    port: bridgePort,
    onboardingCompleted: Boolean(companionState.onboardingCompleted),
    preferredMode: cfg.preferredMode || 'embed',
    timestamp: Date.now()
  });
  try {
    fs.writeFileSync(path.join(os.tmpdir(), 'xiaochun-bridge-port.json'), portData, 'utf-8');
  } catch {}
  if (process.env.XIAOCHUN_TEST_MODE !== '1') {
    try {
      fs.writeFileSync(path.join(__dirname, '..', 'bridge-port.json'), portData, 'utf-8');
    } catch {}
  }
}

function saveCompanionState(patch) {
  try {
    const cur = readCompanionState();
    const next = { ...cur, ...patch, updatedAt: Date.now() };

    const p = getCompanionStatePath();
    fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf-8');

    if (patch.onboardingCompleted !== undefined) {
      savePluginConfig({ onboardingCompleted: Boolean(patch.onboardingCompleted) });
    }

    const tmpStatePath = path.join(os.tmpdir(), 'xiaochun-runtime-state.json');
    try {
      let tmpData = {};
      if (fs.existsSync(tmpStatePath)) {
        tmpData = JSON.parse(fs.readFileSync(tmpStatePath, 'utf-8'));
      }
      fs.writeFileSync(tmpStatePath, JSON.stringify({ ...tmpData, ...next }), 'utf-8');
    } catch {}

    writeBridgePortFile();
    return next;
  } catch (err) {
    log('保存伴侣状态失败:', err.message);
    return patch;
  }
}

// ── Cindy 内嵌视窗 (panel.html) 的轻量 SSE/HTTP 桥接与小蠢 AI 伴侣反向代理服务 ──
const sseClients = new Set();
let bridgePort = 0;
const PREFERRED_BRIDGE_PORT = 23518;

const bridgeServer = http.createServer((req, res) => {
  const reqOrigin = req.headers.origin || '';
  let isAllowedOrigin = false;
  if (!reqOrigin) {
    // 允许非浏览器或同源直连（无 Origin 请求标头）
    isAllowedOrigin = true;
  } else if (reqOrigin.startsWith('cindy-ghost:')) {
    // 允许来自 Cindy 插件协议的面板及设置页
    isAllowedOrigin = true;
  } else {
    try {
      const parsed = new URL(reqOrigin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        // 严格精确匹配本地回环主机名，杜绝前缀伪造（如 127.0.0.1.attacker.com）与沙箱 null 越权
        isAllowedOrigin = (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
      }
    } catch {}
  }

  if (!isAllowedOrigin) {
    log(`[安全拦截] 阻止来自外部未授权域名的桥接请求: ${reqOrigin}`);
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: unauthorized origin' }));
    return;
  }

  const allowOrigin = (isAllowedOrigin && reqOrigin) ? reqOrigin : '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqPath = (req.url || '').split('?')[0];
  if (reqPath === '/events' || reqPath === '/sse') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    if (req.socket) req.socket.unref();
    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  if (reqPath === '/bridge-port' || reqPath === '/bridge-port.json') {
    const companionState = readCompanionState();
    const cfg = readPluginConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      port: bridgePort,
      onboardingCompleted: Boolean(companionState.onboardingCompleted),
      mode: resolveActiveMode(),
      preferredMode: cfg.preferredMode || 'embed',
      timestamp: Date.now()
    }));
    return;
  }

  // ── 伴侣状态持久化 API ──
  if (reqPath === '/api/companion-state') {
    if (req.method === 'GET') {
      const state = readCompanionState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...state, port: bridgePort }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const saved = saveCompanionState(data);
          log('[伴侣状态] 成功持久化保存伴侣状态:', JSON.stringify(saved));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, state: saved }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // ── 面板聊天输入端点 (HTTP -> JSON-RPC 通知 Cindy 主逻辑 main.js) ──
  if (reqPath === '/api/chat-input' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const userText = data.text;
        const locale = data.locale || 'zh-CN';
        log('[面板输入] 收到用户对话输入:', userText);
        reply({
          jsonrpc: '2.0',
          method: 'user_chat_input',
          params: { text: userText, locale, timestamp: Date.now() }
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── 伴侣重新进入新手引导端点 (支持外部脚本 / CDP / 调试一键触发) ──
  if (reqPath === '/api/trigger-onboarding') {
    saveCompanionState({ onboardingCompleted: false, onboardingActive: true });
    broadcastToEmbedPanel('onboarding', {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: '已派发新手引导触发指令' }));
    return;
  }

  // ── 面板申请创建小蠢专属伙伴端点 ──
  if (reqPath === '/api/create-companion' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const locale = data.locale || 'zh-CN';
        log('[面板申请] 收到创建专属伙伴请求, 语言:', locale);
        reply({
          jsonrpc: '2.0',
          method: 'create_companion_request',
          params: { locale, timestamp: Date.now() }
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── 面板核对伙伴存在状态端点 ──
  if ((reqPath === '/api/check-bot-status' || reqPath === '/api/bot-status') && (req.method === 'GET' || req.method === 'POST')) {
    reply({
      jsonrpc: '2.0',
      method: 'check_bot_status',
      params: { timestamp: Date.now() }
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── 供设置面板 (settings.html) 与前端查询与切换运行形态的轻量 API ──
  if (reqPath === '/api/config') {
    if (req.method === 'GET') {
      const cfg = readPluginConfig();
      const status = checkClientInstalled();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        preferredMode: cfg.preferredMode || 'embed',
        activeMode: resolveActiveMode(),
        installed: status.installed,
        running: checkClientRunning(),
        appPath: status.path,
        platform: process.platform,
        arch: process.arch
      }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (data.preferredMode && ['embed', 'desktop'].includes(data.preferredMode)) {
            savePluginConfig({ preferredMode: data.preferredMode });
            log(`[设置面板] 用户手动将运行模式切换为: ${data.preferredMode}`);
          }
          const updatedCfg = readPluginConfig();
          const status = checkClientInstalled();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            preferredMode: updatedCfg.preferredMode || 'embed',
            activeMode: resolveActiveMode(),
            installed: status.installed,
            running: checkClientRunning(),
            platform: process.platform,
            arch: process.arch
          }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  if (reqPath === '/api/install' && req.method === 'POST') {
    log('[设置面板] 用户点击确认安装桌面端客户端...');
    bootstrapClient('install', 'desktop', true).then((result) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

// ── 本地磁盘资产缓存机制（加速首屏加载、消除换端口重复拉取、坚决不缓存 HTML 页面） ──
function getAssetCacheDir() {
  const cacheDir = path.join(getPluginDataDir(), 'cache');
  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
  } catch (_) {}
  return cacheDir;
}

const MIME_TYPES = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.vrm': 'model/gltf-binary',
  '.vrmbase': 'application/octet-stream',
  '.vrmaddon': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2'
};

function isHtmlPageRequest(cleanUrl) {
  if (cleanUrl === '/' || cleanUrl === '/embed' || cleanUrl === '/embed/' || cleanUrl.endsWith('.html')) {
    return true;
  }
  return false;
}

function isCacheableAsset(cleanUrl) {
  if (isHtmlPageRequest(cleanUrl)) return false;
  if (cleanUrl.startsWith('/api/') || cleanUrl.startsWith('/bridge-port') || cleanUrl.startsWith('/events') || cleanUrl.startsWith('/sse')) {
    return false;
  }
  return (
    cleanUrl.startsWith('/assets/') ||
    cleanUrl.startsWith('/emage/') ||
    cleanUrl.startsWith('/onnx/') ||
    cleanUrl.startsWith('/stt/') ||
    cleanUrl.startsWith('/wasm/') ||
    cleanUrl.startsWith('/audio/') ||
    cleanUrl.endsWith('.vrmaddon') ||
    cleanUrl.endsWith('.vrmbase') ||
    cleanUrl.endsWith('.vrm') ||
    cleanUrl.endsWith('.onnx') ||
    cleanUrl.endsWith('.wasm') ||
    cleanUrl.endsWith('.mp3') ||
    cleanUrl.endsWith('.png') ||
    cleanUrl.endsWith('.jpg') ||
    cleanUrl.endsWith('.webp') ||
    cleanUrl.endsWith('.svg') ||
    cleanUrl.endsWith('.woff2') ||
    cleanUrl.endsWith('.css')
  );
}

  // ── 反向代理路由解析：根据路径将请求分发至对应上游服务器，严格保持 127.0.0.1 域内 ──
  const cleanUrl = (req.url || '').split('?')[0];
  const isJsAsset = cleanUrl.endsWith('.js');
  const isAudioOrTts = cleanUrl === '/api/tts' || cleanUrl.startsWith('/audio/') || cleanUrl.endsWith('.mp3');
  const isHeavyModelOrAsset = cleanUrl.endsWith('.vrmaddon') || cleanUrl.endsWith('.vrmbase') || cleanUrl.endsWith('.onnx') || cleanUrl.endsWith('.wasm');
  const isHtml = isHtmlPageRequest(cleanUrl);
  const shouldCache = req.method === 'GET' && isCacheableAsset(cleanUrl);

  let targetHost = 'xiaochun.firetable.tech';
  let targetPath = req.url;

  if (cleanUrl.startsWith('/emage/') || cleanUrl.startsWith('/onnx/')) {
    targetHost = 'cdn.firetable.tech';
    const subPath = cleanUrl.replace(/^\/(emage|onnx)\//, '');
    const query = (req.url || '').includes('?') ? '?' + (req.url || '').split('?')[1] : '';
    targetPath = `/xiaochun/emage/${subPath}${query}`;
  } else if (cleanUrl.startsWith('/stt/')) {
    targetHost = 'cdn.firetable.tech';
    const subPath = cleanUrl.replace(/^\/stt\//, '');
    const query = (req.url || '').includes('?') ? '?' + (req.url || '').split('?')[1] : '';
    targetPath = `/xiaochun/stt/${subPath}${query}`;
  } else if (cleanUrl.startsWith('/wasm/')) {
    targetHost = 'cdn.jsdelivr.net';
    const subPath = cleanUrl.replace(/^\/wasm\//, '');
    const query = (req.url || '').includes('?') ? '?' + (req.url || '').split('?')[1] : '';
    targetPath = `/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/${subPath}${query}`;
  }

  // 1. 优先尝试从本地磁盘资产缓存读取（极速命中，零网络开销，Origin 无关）
  const cacheDir = getAssetCacheDir();
  const cacheKey = crypto.createHash('sha256').update(`${targetHost}:${targetPath}`).digest('hex');
  const ext = path.extname(cleanUrl) || '';
  const cacheFilePath = path.join(cacheDir, `${cacheKey}${ext}`);

  if (shouldCache) {
    try {
      if (fs.existsSync(cacheFilePath)) {
        const stat = fs.statSync(cacheFilePath);
        if (stat.size > 0) {
          const mime = MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': stat.size,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Access-Control-Allow-Origin': '*',
            'Cross-Origin-Opener-Policy': 'unsafe-none',
            'Cross-Origin-Embedder-Policy': 'unsafe-none',
            'X-XiaoChun-Cache': 'HIT'
          });
          fs.createReadStream(cacheFilePath).pipe(res);
          return;
        }
      }
    } catch (err) {
      log('读取磁盘缓存异常, 降级至网络直连:', err.message);
    }
  }

  // 代理请求始终强制要求上游以 identity (未压缩原始数据) 返回，
  // 确保写入磁盘缓存并经由 127.0.0.1 服务本地 iframe 时，CSS / JS / WASM / 模型数据均为原始数据，绝不出现 zstd/br 二进制乱码导致 CSS 样式解析崩溃！
  const forwardHeaders = {
    ...req.headers,
    host: targetHost,
    origin: `https://${targetHost}`,
    referer: `https://${targetHost}/`,
    'accept-encoding': 'identity'
  };

  const proxyReq = https.request({
    hostname: targetHost,
    port: 443,
    path: targetPath,
    method: req.method,
    headers: forwardHeaders
  }, (proxyRes) => {
    // 自动重定向处理 (例如 /embed -> /embed/)
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      let loc = proxyRes.headers.location;
      // 保持在 127.0.0.1 域内重定向
      if (loc.startsWith('https://xiaochun.firetable.tech')) {
        loc = loc.replace('https://xiaochun.firetable.tech', '');
      }
      res.writeHead(proxyRes.statusCode, {
        ...proxyRes.headers,
        location: loc,
        'access-control-allow-origin': '*',
      });
      res.end();
      return;
    }

    const headers = { ...proxyRes.headers };
    // 移除阻碍 Electron iframe 嵌入与通信的严格限制标头
    delete headers['content-security-policy'];
    delete headers['content-security-policy-report-only'];
    headers['access-control-allow-origin'] = '*';
    headers['cross-origin-opener-policy'] = 'unsafe-none';
    headers['cross-origin-embedder-policy'] = 'unsafe-none';

    // 核心安全与更新保证：对 HTML 页面强制禁止缓存，确保前端发版后一刷新即拉取最新页面！
    if (isHtml) {
      headers['cache-control'] = 'no-cache, no-store, must-revalidate';
      headers['pragma'] = 'no-cache';
      headers['expires'] = '0';
    }

    // 针对 JS 核心资产补丁：放行 cindy-ghost: 协议的 origin 校验，实现双向 postMessage 握手并写入磁盘缓存
    if (isJsAsset) {
      delete headers['content-encoding'];
      let body = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', chunk => { body += chunk; });
      proxyRes.on('end', () => {
        let modified = body;
        // 关键补丁：解决 WHATWG 规范下 new URL('cindy-ghost:...').origin 返回 "null" 的标准行为，
        // 确保 normalizeOrigin 能够正确返回 cindy-ghost://xiaochun-companion
        if (modified.includes('protocol!==`https:`') || modified.includes('protocol!==\"https:\"') || modified.includes('cindy-ghost')) {
          modified = modified.replace(
            /t\.protocol!==`https:`&&t\.protocol!==`http:`(?:&&t\.protocol!==`cindy-ghost:`)?\?null:t\.origin/g,
            "t.protocol===`cindy-ghost:`?(t.protocol+`//`+t.host):(t.protocol!==`https:`&&t.protocol!==`http:`?null:t.origin)"
          );
        }
        headers['content-length'] = Buffer.byteLength(modified, 'utf8');

        // 写入磁盘缓存（下次请求直接命中）
        if (shouldCache && proxyRes.statusCode === 200) {
          try {
            fs.writeFileSync(cacheFilePath, modified, 'utf8');
          } catch (_) {}
        }

        res.writeHead(proxyRes.statusCode, headers);
        res.end(modified);
      });
      return;
    }

    // 其他重型静态资产 (VRM, ONNX, WASM, 图片, 音频等)：在向客户端流式输出的同时写入磁盘缓存
    if (shouldCache && proxyRes.statusCode === 200) {
      headers['cache-control'] = 'public, max-age=31536000, immutable';
      res.writeHead(proxyRes.statusCode, headers);
      const tmpFile = `${cacheFilePath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const fileStream = fs.createWriteStream(tmpFile);
      let streamFailed = false;

      fileStream.on('error', () => {
        streamFailed = true;
        try { fs.unlinkSync(tmpFile); } catch (_) {}
      });

      proxyRes.on('data', (chunk) => {
        res.write(chunk);
        if (!streamFailed) fileStream.write(chunk);
      });

      proxyRes.on('end', () => {
        res.end();
        if (!streamFailed) {
          fileStream.end(() => {
            try {
              fs.renameSync(tmpFile, cacheFilePath);
            } catch (_) {
              try { fs.unlinkSync(tmpFile); } catch (_) {}
            }
          });
        }
      });

      proxyRes.on('error', () => {
        streamFailed = true;
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        res.end();
      });
      return;
    }

    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    log('代理请求失败:', req.url, err.message);
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('XiaoChun Proxy Error: ' + err.message);
  });

  req.pipe(proxyReq);
});

const CANDIDATE_PORTS = [PREFERRED_BRIDGE_PORT, 23519, 23520];
let portRetryAttempts = 0;
const MAX_PORT_RETRIES = process.env.XIAOCHUN_TEST_MODE === '1' ? 0 : 2;

function startBridgeServer(candidateIndex = 0) {
  const currentPort = candidateIndex < CANDIDATE_PORTS.length ? CANDIDATE_PORTS[candidateIndex] : 0;

  const errorHandler = (err) => {
    bridgeServer.removeListener('listening', listenHandler);
    if (err.code === 'EADDRINUSE' && currentPort !== 0) {
      if (portRetryAttempts < MAX_PORT_RETRIES) {
        portRetryAttempts++;
        log(`端口 ${currentPort} 暂时被占用 (可能正处于重载释放中)，250ms 后进行第 ${portRetryAttempts} 次复用重试...`);
        setTimeout(() => {
          startBridgeServer(candidateIndex);
        }, 250);
        return;
      }
      portRetryAttempts = 0;
      const nextCandidate = candidateIndex + 1;
      log(`端口 ${currentPort} 持续占用，尝试候选端口序列 [${candidateIndex + 1}]...`);
      startBridgeServer(nextCandidate);
    } else {
      log('桥接服务器发生错误 (非致命):', err.message);
    }
  };

  const listenHandler = () => {
    bridgeServer.removeListener('error', errorHandler);
    const addr = bridgeServer.address();
    bridgePort = addr ? addr.port : currentPort;
    bridgeServer.unref();
    log(`内嵌视窗与反向代理服务器就绪: http://127.0.0.1:${bridgePort}`);
    writeBridgePortFile();
  };

  bridgeServer.once('error', errorHandler);
  bridgeServer.once('listening', listenHandler);
  bridgeServer.listen(currentPort, '127.0.0.1');
}

function cleanupBridgeServer() {
  try {
    bridgeServer.close();
  } catch (_) {}
}
process.on('SIGTERM', () => { cleanupBridgeServer(); process.exit(0); });
process.on('SIGINT', () => { cleanupBridgeServer(); process.exit(0); });
process.on('exit', () => { cleanupBridgeServer(); });

startBridgeServer();

function broadcastToEmbedPanel(method, params) {
  const payload = `data: ${JSON.stringify({ method, params, timestamp: Date.now() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {}
  }
}

// 跨平台打开 URL 或文件
function openUrl(targetUrl, appPath = null, isDev = false) {
  // 自动化测试环境下执行 DryRun 拦截，杜绝产生系统级脱机悬挂进程
  if (process.env.XIAOCHUN_TEST_MODE === '1') {
    log(`[测试模式 DryRun] 拦截外部唤起: ${targetUrl}`);
    return Promise.resolve(true);
  }

  return new Promise((resolve, reject) => {
    // 如果是本地开发编译产物（非 .app 包），脱机拉起并立即放行
    if (isDev && appPath && fs.existsSync(appPath)) {
      log(`本地开发模式：通过原生二进制独立拉起协议指令 (${appPath} ${targetUrl})`);
      try {
        const child = spawn(appPath, [targetUrl], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
        resolve(true);
      } catch (err) {
        log(`开发二进制启动失败:`, err.message);
        reject(err);
      }
      return;
    }

    let cmd = 'open';
    let args = [targetUrl];

    if (process.platform === 'win32') {
      cmd = 'cmd.exe';
      args = ['/c', 'start', '', targetUrl];
    } else if (process.platform === 'linux') {
      cmd = 'xdg-open';
      args = [targetUrl];
    }

    execFile(cmd, args, (error) => {
      if (error) {
        log(`唤起失败 (${cmd} ${targetUrl}):`, error.message);
        reject(error);
      } else {
        resolve(true);
      }
    });
  });
}

// 检查小蠢桌面端是否已在电脑上安装
function checkClientInstalled() {
  if (process.platform === 'darwin') {
    // 1. 检查 macOS 常见 App 目录
    const standardPaths = [
      '/Applications/Project XiaoChun.app',
      path.join(os.homedir(), 'Applications', 'Project XiaoChun.app'),
      '/Applications/Project.XiaoChun.app',
      path.join(os.homedir(), 'Applications', 'Project.XiaoChun.app'),
      '/Applications/xiaochun.app',
      path.join(os.homedir(), 'Applications', 'xiaochun.app')
    ];
    for (const p of standardPaths) {
      if (fs.existsSync(p)) return { installed: true, path: p };
    }

    // 2. 本地裸调试二进制回退 (仅当显式设置 XIAOCHUN_DEV_BIN=1 时开启，避免未打包的 debug 二进制在无本地前端 dev 服务器时启动成透明幽灵窗口)
    if (process.env.XIAOCHUN_DEV_BIN === '1') {
      const devBin = path.join(__dirname, '..', '..', '..', 'src-tauri', 'target', 'debug', 'project-xiaochun');
      if (fs.existsSync(devBin)) {
        return { installed: true, path: devBin, isDev: true };
      }
    }

    // 2. 检查 LaunchServices 登记的 Bundle ID
    try {
      const out = execSync("mdfind \"kMDItemCFBundleIdentifier == 'tech.firetable.xiaochun'\"", {
        encoding: 'utf-8',
        timeout: 1500
      });
      const foundPath = out.trim().split('\n')[0];
      if (foundPath && fs.existsSync(foundPath)) {
        return { installed: true, path: foundPath };
      }
    } catch {}

    return { installed: false, path: null };
  }

  if (process.platform === 'win32') {
    // 检查 Windows 注册表与常见路径
    try {
      execSync('reg query HKCU\\Software\\Classes\\xiaochun', { timeout: 1500 });
      return { installed: true, path: 'Registry: xiaochun://' };
    } catch {}

    const winPath = path.join(process.env.LOCALAPPDATA || '', 'Project XiaoChun', 'project-xiaochun.exe');
    if (fs.existsSync(winPath)) return { installed: true, path: winPath };
    return { installed: false, path: null };
  }

  // Linux
  try {
    const whichOut = execSync('which project-xiaochun', { encoding: 'utf-8', timeout: 1000 }).trim();
    if (whichOut) return { installed: true, path: whichOut };
  } catch {}
  const localBin = path.join(os.homedir(), '.local', 'bin', 'project-xiaochun');
  if (fs.existsSync(localBin)) return { installed: true, path: localBin };

  return { installed: false, path: null };
}

// 检查小蠢桌面端当前是否在线运行
function checkClientRunning() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist', { encoding: 'utf-8', timeout: 1500 });
      return /project-xiaochun/i.test(out);
    }
    // macOS / Linux
    const out = execSync('pgrep -f "project-xiaochun|Project XiaoChun"', { encoding: 'utf-8', timeout: 1000 }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

// 判定当前活动的运行形态 ('desktop' 桌面桌宠 / 'embed' Cindy 内嵌视窗)
// 核心架构准则：默认严格为 'embed' 内嵌模式！
// 只有当用户显式选择 'desktop'（通过 settings 配置或明确告知 Agent）时，才激活桌面模式
function resolveActiveMode() {
  const cfg = readPluginConfig();
  if (cfg.preferredMode === 'desktop') return 'desktop';
  return 'embed';
}

// 读取小蠢运行时跨进程状态（新手引导状态、当前场景、当前服装）
function readRuntimeState() {
  const candidates = [
    '/tmp/xiaochun-runtime-state.json',
    path.join(os.tmpdir(), 'xiaochun-runtime-state.json'),
    path.join(os.homedir(), 'Library', 'Application Support', 'tech.firetable.xiaochun', 'runtime-state.json'),
    path.join(process.env.APPDATA || '', 'tech.firetable.xiaochun', 'runtime-state.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        return JSON.parse(content);
      }
    } catch {}
  }
  return null;
}

// 下载工具封装 (跟随 302 重定向)
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    function get(currentUrl, hops = 0) {
      if (hops > 5) {
        reject(new Error('下载重定向次数过多'));
        return;
      }
      https.get(currentUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          get(response.headers.location, hops + 1);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`下载失败 HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }).on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }
    get(url);
  });
}

// 解析最新发布版本的安装包资产（严格区分 macOS DMG / Windows EXE / Linux AppImage）
async function resolveLatestInstallerAsset(platform = process.platform, arch = process.arch) {
  const isArm = arch === 'arm64' || arch === 'aarch64';
  const apiUrl = 'https://api.github.com/repos/FireTable/project-xiaochun/releases/latest';

  let matchPattern;
  let fallbackUrl;
  let fileType = 'dmg';

  if (platform === 'darwin') {
    fileType = 'dmg';
    matchPattern = isArm ? /aarch64.*\.dmg$/i : /x64.*\.dmg$/i;
    fallbackUrl = `https://github.com/FireTable/project-xiaochun/releases/download/v0.2.2/Project.XiaoChun_0.2.2_${isArm ? 'aarch64' : 'x64'}.dmg`;
  } else if (platform === 'win32') {
    fileType = 'exe';
    matchPattern = /_x64-setup\.exe$/i;
    fallbackUrl = 'https://github.com/FireTable/project-xiaochun/releases/download/v0.2.2/Project.XiaoChun_0.2.2_x64-setup.exe';
  } else {
    // Linux
    fileType = 'AppImage';
    matchPattern = /_amd64\.AppImage$/i;
    fallbackUrl = 'https://github.com/FireTable/project-xiaochun/releases/download/v0.2.2/Project.XiaoChun_0.2.2_amd64.AppImage';
  }

  try {
    const data = await new Promise((resolve, reject) => {
      https.get(apiUrl, { headers: { 'User-Agent': 'XiaoChun-Cindy-Plugin' } }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });

    if (data && Array.isArray(data.assets)) {
      const asset = data.assets.find(a => matchPattern.test(a.name));
      if (asset && asset.browser_download_url) {
        log(`动态解析到 GitHub 资产 (${platform}/${arch}): ${asset.browser_download_url}`);
        return {
          url: asset.browser_download_url,
          name: asset.name,
          platform,
          fileType
        };
      }
    }
  } catch (err) {
    log('解析最新 GitHub Release 资产失败，使用基线版本回退:', err.message);
  }

  // 默认已知可用基线版本回退
  return {
    url: fallbackUrl,
    name: path.basename(fallbackUrl),
    platform,
    fileType
  };
}

// 自动完成冷启动安装 / 就绪准备 / 双模切换
async function bootstrapClient(action = 'ensure', targetMode = null, userConfirmed = false) {
  if (targetMode && ['desktop', 'embed'].includes(targetMode)) {
    savePluginConfig({ preferredMode: targetMode });
  }
  const cfg = readPluginConfig();
  const mode = targetMode || cfg.preferredMode || 'embed';
  const status = checkClientInstalled();
  const isRunning = checkClientRunning();

  // 测试环境下拦截耗时的真实物理下载安装
  if (process.env.XIAOCHUN_TEST_MODE === '1' && (action === 'install' || !status.installed)) {
    log('[测试模式 DryRun] 拦截物理下载安装，模拟就绪');
    return {
      success: true,
      mode: mode === 'desktop' ? 'desktop' : 'embed',
      installed: true,
      running: true,
      actionTaken: 'test_mock_ready'
    };
  }

  // 1. 内嵌视窗模式 (embed) —— 核心默认形态，免安装 0 门槛
  if (mode === 'embed' || action === 'switch_embed') {
    savePluginConfig({ preferredMode: 'embed' });
    return {
      success: true,
      mode: 'embed',
      installed: status.installed,
      running: isRunning,
      canEmbed: true,
      embedUrl: 'https://xiaochun.firetable.tech/embed',
      hasActivePanel: sseClients.size > 0,
      actionTaken: 'embed_ready',
      message: '小蠢 Cindy 内嵌视窗模式已就绪！直接在 Cindy 侧边栏/Tab 中使用，免安装。'
    };
  }

  // 2. 桌面模式 (desktop)
  if (mode === 'desktop' || action === 'switch_desktop' || action === 'switch_mode') {
    // 2.1 若已安装：直接唤醒或就绪
    if (status.installed) {
      savePluginConfig({ preferredMode: 'desktop' });
      if (!isRunning && (action === 'launch' || action === 'ensure' || action === 'switch_mode' || action === 'switch_desktop')) {
        log('小蠢桌面客户端已安装但未运行，唤醒桌面桌宠...');
        await openUrl('xiaochun://action?type=ping', status.path, status.isDev);
      }
      return {
        success: true,
        mode: 'desktop',
        installed: true,
        running: true,
        appPath: status.path,
        actionTaken: isRunning ? 'already_running' : 'cold_started',
        message: '已成功激活小蠢桌面独立桌宠形态！'
      };
    }

    // 2.2 若未安装，且用户尚未明确确认安装 (action !== 'install' 或 userConfirmed !== true)：严禁私自静默下载，必须向用户确认！
    if (action !== 'install' || !userConfirmed) {
      const installPkgDesc = process.platform === 'win32'
        ? '自动下载官方 Windows 安装包 (.exe) 并免管理员权限安装至用户目录'
        : (process.platform === 'darwin'
            ? '自动下载官方 macOS 磁盘镜像 (.dmg) 并安装至应用程序目录（免提权）'
            : '自动下载官方 Linux AppImage 安装包并就绪');

      return {
        success: false,
        mode: 'embed', // 暂留在安全的 embed 模式
        needInstallConfirm: true,
        installed: false,
        running: false,
        platform: process.platform,
        actionTaken: 'prompt_choice',
        message: '切换至桌面桌宠模式需要安装 Project XiaoChun 桌面客户端（全屏透明置顶、支持鼠标穿透）。请确认是否开始自动下载并安装？',
        actionToProceed: 'xiaochun_bootstrap(action="install", mode="desktop", userConfirmed=true)',
        guide: {
          website: 'https://xiaochun.firetable.tech',
          releases: 'https://github.com/FireTable/project-xiaochun/releases',
          options: [
            {
              id: 'install_desktop',
              title: '确认下载并安装桌面端',
              description: installPkgDesc,
              action: 'xiaochun_bootstrap(action="install", mode="desktop", userConfirmed=true)'
            },
            {
              id: 'keep_embed',
              title: '继续使用内嵌视窗（推荐）',
              description: '直接在 Cindy 内与小蠢互动，0 门槛开箱即用',
              action: 'xiaochun_bootstrap(mode="embed")'
            }
          ]
        }
      };
    }

    // 2.3 用户明确授权安装 (action === 'install' 且 userConfirmed === true)：执行物理安装流程
    savePluginConfig({ preferredMode: 'desktop' });
  }

  // 严防任何通过非 desktop 路径传入 action='install' 绕过校验
  if (action === 'install' && !userConfirmed && process.env.XIAOCHUN_TEST_MODE !== '1') {
    return {
      success: false,
      mode: 'embed',
      needInstallConfirm: true,
      message: '安装小蠢桌面客户端需要获取用户的明确同意。请向用户确认后方可执行。'
    };
  }

  // 若已安装且用户指定重新安装
  if (status.installed && action !== 'install') {
    return {
      success: true,
      mode: 'desktop',
      installed: true,
      running: isRunning,
      appPath: status.path,
      actionTaken: 'none'
    };
  }

  // 未安装且用户确认安装情况：区分 macOS (DMG) 与 Windows (EXE)
  if (process.platform === 'darwin') {
    log('开始在 macOS 上执行小蠢客户端自动化安装引导...');
    try {
      const assetInfo = await resolveLatestInstallerAsset('darwin', process.arch);
      const dmgUrl = assetInfo.url;
      const tmpDmg = path.join(os.tmpdir(), `XiaoChun_Setup_${Date.now()}.dmg`);

      log(`正在下载 macOS 客户端镜像: ${dmgUrl}`);
      await downloadFile(dmgUrl, tmpDmg);

      log('正在挂载磁盘镜像...');
      const attachOut = execFileSync('hdiutil', ['attach', tmpDmg, '-nobrowse', '-readonly'], { encoding: 'utf-8' });
      const mountMatch = attachOut.match(/\/Volumes\/[^\n\t\r]+/);
      const mountPoint = mountMatch ? mountMatch[0].trim() : null;

      if (!mountPoint || !fs.existsSync(mountPoint)) {
        throw new Error('挂载 DMG 失败');
      }

      const files = fs.readdirSync(mountPoint);
      const appName = files.find(f => f.endsWith('.app')) || 'Project XiaoChun.app';
      const srcApp = path.join(mountPoint, appName);

      // 优先安装到 /Applications；若无写权限则回退到当前用户的 ~/Applications
      let destDir = '/Applications';
      try {
        fs.accessSync(destDir, fs.constants.W_OK);
      } catch {
        destDir = path.join(os.homedir(), 'Applications');
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      }

      const destApp = path.join(destDir, 'Project XiaoChun.app');
      log(`正在将应用复制到 ${destApp}...`);
      if (fs.existsSync(destApp)) {
        fs.rmSync(destApp, { recursive: true, force: true });
      }
      fs.cpSync(srcApp, destApp, { recursive: true });

      // 卸载镜像并清理临时文件
      try {
        execFileSync('hdiutil', ['detach', mountPoint, '-quiet']);
        fs.unlinkSync(tmpDmg);
      } catch {}

      // 移除 macOS Gatekeeper 隔离属性
      try {
        execFileSync('xattr', ['-cr', destApp]);
      } catch {}

      log('安装完成，启动小蠢桌面端...');
      execFileSync('open', ['-a', destApp]);

      savePluginConfig({ preferredMode: 'desktop' });
      return {
        success: true,
        mode: 'desktop',
        installed: true,
        running: true,
        appPath: destApp,
        autoInstalled: true,
        actionTaken: 'auto_installed_and_launched'
      };
    } catch (installErr) {
      log('macOS 自动化下载安装失败，回退为手动引导方案:', installErr.message);
      return {
        success: false,
        mode: 'desktop',
        installed: false,
        running: false,
        needManualInstall: true,
        canEmbed: true,
        error: installErr.message,
        guide: {
          website: 'https://xiaochun.firetable.tech',
          releases: 'https://github.com/FireTable/project-xiaochun/releases',
          curlScript: 'curl -fsSL https://xiaochun.firetable.tech/scripts/install.sh | bash'
        }
      };
    }
  }

  // Windows 平台安装流程 (下载 x64-setup.exe 并执行免提权用户安装)
  if (process.platform === 'win32') {
    log('开始在 Windows 上执行小蠢客户端自动化安装引导...');
    try {
      const assetInfo = await resolveLatestInstallerAsset('win32', process.arch);
      const installerUrl = assetInfo.url;
      const tmpExe = path.join(os.tmpdir(), `XiaoChun_Setup_${Date.now()}.exe`);

      log(`正在下载 Windows 客户端安装包: ${installerUrl}`);
      await downloadFile(installerUrl, tmpExe);

      log(`安装程序已下载至: ${tmpExe}，正在执行免提权用户安装...`);
      // NSIS 安装包传入 /S 参数执行当前用户静默安装
      try {
        execFileSync(tmpExe, ['/S'], { timeout: 120000 });
      } catch (runErr) {
        log('静默安装触发完成或超时，调起标准安装向导:', runErr.message);
        execFile('cmd.exe', ['/c', 'start', '""', tmpExe]);
      }

      // 扫描 Windows 常用安装位置
      const standardWinPaths = [
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Project XiaoChun', 'project-xiaochun.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Project XiaoChun', 'project-xiaochun.exe'),
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Project XiaoChun', 'project-xiaochun.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Project XiaoChun', 'project-xiaochun.exe')
      ];

      const foundExe = standardWinPaths.find(p => fs.existsSync(p));
      if (foundExe) {
        log(`已找到安装完成的 Windows 客户端: ${foundExe}，正在启动...`);
        execFile('cmd.exe', ['/c', 'start', '""', foundExe]);
        savePluginConfig({ preferredMode: 'desktop' });
        return {
          success: true,
          mode: 'desktop',
          installed: true,
          running: true,
          appPath: foundExe,
          autoInstalled: true,
          actionTaken: 'auto_installed_and_launched'
        };
      }

      savePluginConfig({ preferredMode: 'desktop' });
      return {
        success: true,
        mode: 'desktop',
        installed: true,
        running: true,
        appPath: tmpExe,
        autoInstalled: true,
        actionTaken: 'installer_launched',
        message: '已启动 Windows 安装程序，安装完成后小蠢将自动就绪！'
      };
    } catch (installErr) {
      log('Windows 自动化下载安装失败，回退为手动引导方案:', installErr.message);
      return {
        success: false,
        mode: 'desktop',
        installed: false,
        running: false,
        needManualInstall: true,
        canEmbed: true,
        error: installErr.message,
        guide: {
          website: 'https://xiaochun.firetable.tech',
          releases: 'https://github.com/FireTable/project-xiaochun/releases'
        }
      };
    }
  }

  // Linux / 其他环境友好回退
  return {
    success: false,
    mode: 'desktop',
    installed: false,
    running: false,
    needManualInstall: true,
    canEmbed: true,
    guide: {
      website: 'https://xiaochun.firetable.tech',
      releases: 'https://github.com/FireTable/project-xiaochun/releases',
      curlScript: 'curl -fsSL https://xiaochun.firetable.tech/scripts/install.sh | bash'
    }
  };
}

// 发送协议指令到小蠢（支持桌面端与 Cindy 内嵌视窗双模自适应）
async function dispatchProtocol(action, params = {}) {
  const activeMode = resolveActiveMode();

  // A. 内嵌视窗模式：通过 SSE 桥接器直接广播给 panel.html
  if (activeMode === 'embed') {
    log(`[内嵌视窗模式] 派发指令至 Cindy Panel: ${action}`, JSON.stringify(params));
    broadcastToEmbedPanel(action, params);
    return {
      success: true,
      mode: 'embed',
      action,
      target: 'panel',
      hasActivePanel: sseClients.size > 0
    };
  }

  // B. 桌面模式
  const installStatus = checkClientInstalled();
  const wasRunning = checkClientRunning();
  let autoInstalled = false;

  // 1. 如果尚未安装，严禁私自静默下载，必须拦截并提示用户确认安装！
  if (!installStatus.installed) {
    log('桌面端尚未安装，提示用户确认安装...');
    const bootstrapRes = await bootstrapClient('ensure', 'desktop');
    if (bootstrapRes.needInstallConfirm || !bootstrapRes.installed) {
      return bootstrapRes;
    }
  }

  // 2. 长文本安全处理：超过 400 字符走临时文件模式，彻底杜绝命令行截断
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (k === 'text' && typeof v === 'string' && v.length > 400) {
      const tmpFile = path.join(os.tmpdir(), `xiaochun_speech_${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, v, 'utf-8');
      query.set('file', tmpFile);
    } else {
      query.set(k, String(v));
    }
  }

  const queryString = query.toString();
  const url = queryString ? `xiaochun://${action}?${queryString}` : `xiaochun://${action}`;
  log(`派发协议指令: ${url}`);
  try {
    await openUrl(url, installStatus.path, installStatus.isDev);
  } catch (err) {
    if (String(err).includes('kLSApplicationNotFoundErr') || String(err).includes('No application knows')) {
      log('LaunchServices 未找到协议注册，尝试执行 bootstrap 就绪...');
      const bootRes = await bootstrapClient('ensure');
      if (bootRes.autoInstalled) {
        await openUrl(url, bootRes.appPath, false);
      } else {
        return {
          success: false,
          needManualInstall: true,
          guide: bootRes.guide,
          error: err.message
        };
      }
    } else {
      throw err;
    }
  }

  return {
    success: true,
    mode: 'desktop',
    action,
    coldStart: !wasRunning,
    autoInstalled,
    appPath: installStatus.path
  };
}

// 监听 Cindy 宿主发送的标准输入 JSON-RPC 请求
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch (err) {
    return;
  }

  const { id, method, params } = request;

  try {
    if (method === 'status') {
      const installStatus = checkClientInstalled();
      const isRunning = checkClientRunning();
      const runtimeState = readRuntimeState();
      const companionState = readCompanionState();
      const cfg = readPluginConfig();
      const activeMode = resolveActiveMode();
      reply({
        jsonrpc: '2.0',
        id,
        result: {
          platform: process.platform,
          arch: process.arch,
          mode: activeMode,
          preferredMode: cfg.preferredMode || 'auto',
          canEmbed: true,
          embedUrl: 'https://xiaochun.firetable.tech/embed',
          hasActivePanel: sseClients.size > 0,
          isInstalled: installStatus.installed,
          isRunning,
          appPath: installStatus.path,
          onboardingCompleted: Boolean(companionState.onboardingCompleted || runtimeState?.onboardingCompleted),
          onboardingActive: companionState.onboardingActive || (runtimeState ? Boolean(runtimeState.onboardingActive) : false),
          currentScene: companionState.currentScene || runtimeState?.currentScene || 'beach3d',
          currentOutfit: companionState.currentOutfit || runtimeState?.currentOutfit || null
        }
      });
      return;
    }

    if (method === 'panel_broadcast') {
      broadcastToEmbedPanel('panel_event', params || {});
      reply({ jsonrpc: '2.0', id, result: { success: true } });
      return;
    }

    if (method === 'bootstrap') {
      const { action, mode, userConfirmed } = params || {};
      const res = await bootstrapClient(action || 'ensure', mode || null, Boolean(userConfirmed));
      reply({ jsonrpc: '2.0', id, result: res });
      return;
    }

    if (method === 'speak') {
      const { text, motion, expression, force } = params || {};
      if (!text) {
        reply({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: '必须提供 text 朗读内容' }
        });
        return;
      }
      const runtimeState = readRuntimeState();
      const isOnboarding = runtimeState ? Boolean(runtimeState.onboardingActive) : false;
      if (isOnboarding && !force) {
        reply({
          jsonrpc: '2.0',
          id,
          result: {
            success: false,
            onboardingActive: true,
            message: '小蠢当前正在进行新手引导（act0 序章剧情向导）。建议您先在小蠢窗口完成向导，或传入 force=true 强制插话。'
          }
        });
        return;
      }
      const res = await dispatchProtocol('speak', {
        text,
        motion,
        expression,
        force: force ? 'true' : undefined
      });
      reply({ jsonrpc: '2.0', id, result: res });
      return;
    }

    if (method === 'motion') {
      const { name, loop } = params || {};
      if (!name) {
        reply({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: '必须提供动作名称 name' }
        });
        return;
      }
      const res = await dispatchProtocol('motion', { name, loop: loop ? 'true' : 'false' });
      reply({ jsonrpc: '2.0', id, result: res });
      return;
    }

    if (method === 'camera') {
      const cameraParams = { ...(params || {}) };
      if (cameraParams.action === 'reset') {
        cameraParams.reset = 'true';
      } else if (cameraParams.action === 'pan_up' || cameraParams.action === 'panUp') {
        cameraParams.panUp = 'true';
      }
      const res = await dispatchProtocol('camera', cameraParams);
      reply({ jsonrpc: '2.0', id, result: res });
      return;
    }

    if (method === 'scene') {
      const { name, scene, persist } = params || {};
      const sceneName = name || scene;
      if (!sceneName) {
        reply({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: '必须提供场景名称 name 或 scene' }
        });
        return;
      }
      if (sceneName === 'transparent') {
        reply({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Cindy 伴侣视窗不支持 transparent 透明场景，请选择 beach3d / light / dark / void' }
        });
        return;
      }
      const res = await dispatchProtocol('scene', {
        name: sceneName,
        persist: persist !== false ? 'true' : 'false'
      });
      reply({ jsonrpc: '2.0', id, result: res });
      return;
    }

    if (method === 'outfit') {
      const { name, outfit, key } = params || {};
      const outfitName = name || outfit || key;
      if (!outfitName) {
        reply({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: '必须提供服装名称 name, outfit 或 key' }
        });
        return;
      }
      const res = await dispatchProtocol('outfit', { name: outfitName });
      reply({ jsonrpc: '2.0', id, result: res });
      return;
    }

    if (method === 'update') {
      const { mode, userConfirmed } = params || {};
      const targetMode = mode || 'check'; // 核心安全加固：默认 mode 严格为 'check'
      const status = checkClientInstalled();
      const isRunning = checkClientRunning();

      // 安全防线 1：若客户端未在电脑上安装，严禁通过 update 借道安装！
      if (!status.installed) {
        reply({
          jsonrpc: '2.0',
          id,
          result: {
            isRunning: false,
            installed: false,
            mode: 'embed',
            message: '当前小蠢以 Cindy 内嵌伴侣视窗运行（免安装开箱即用）。本地电脑未安装桌面客户端，无需更新。'
          }
        });
        return;
      }

      // 安全防线 2：若当前处于 embed 模式且未激活桌面端
      const activeMode = resolveActiveMode();
      if (activeMode === 'embed' && targetMode !== 'check') {
        reply({
          jsonrpc: '2.0',
          id,
          result: {
            isRunning: false,
            installed: true,
            mode: 'embed',
            message: '当前活跃形态为 Cindy 内嵌伴侣视窗。如需更新已安装的桌面桌宠客户端，请先切换至桌面模式或启动桌面端。'
          }
        });
        return;
      }

      // 客户端正在运行
      if (isRunning) {
        log('小蠢客户端正在运行，通过协议触发原生版本更新与重启流程...');
        const res = await dispatchProtocol('update', { mode: targetMode });
        reply({
          jsonrpc: '2.0',
          id,
          result: {
            ...res,
            updated: true,
            mode: targetMode,
            message: targetMode === 'check' ? '已触发桌面端版本更新检测' : '已派发更新指令，桌面端正在下载并即将重启'
          }
        });
        return;
      }

      // 客户端已安装但当前未运行
      log(`小蠢客户端未运行，查询 GitHub Releases 最新版本 (${process.platform}/${process.arch})...`);
      const assetInfo = await resolveLatestInstallerAsset(process.platform, process.arch);
      if (targetMode === 'check' || !userConfirmed) {
        reply({
          jsonrpc: '2.0',
          id,
          result: {
            isRunning: false,
            installed: true,
            platform: process.platform,
            latestReleaseAsset: assetInfo.url,
            assetName: assetInfo.name,
            fileType: assetInfo.fileType,
            message: `桌面客户端已安装但未运行。GitHub Releases (${process.platform}) 最新资源: ${assetInfo.name}`
          }
        });
        return;
      }

      // 仅当用户在对话中明确要求且 userConfirmed: true 时才执行更新安装
      log('客户端已安装且用户确认更新，执行更新安装...');
      const bootRes = await bootstrapClient('install', 'desktop', true);
      reply({
        jsonrpc: '2.0',
        id,
        result: {
          ...bootRes,
          updated: bootRes.autoInstalled,
          message: bootRes.autoInstalled ? '已成功下载并为小蠢安装最新版本！' : bootRes.guide?.website
        }
      });
      return;
    }

    if (method === 'stop') {
      const res = await dispatchProtocol('stop', {});
      reply({ jsonrpc: '2.0', id, result: res });
      return;
    }

    reply({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `不支持的方法: ${method}` }
    });
  } catch (error) {
    log('执行方法报错:', error);
    reply({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: error.message || 'Node 进程内部执行失败' }
    });
  }
});
